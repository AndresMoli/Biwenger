import { chromium } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const { BIWENGER_EMAIL, BIWENGER_PASSWORD, LIGA_ID, PUBLIC_OUT_PATH } = process.env;

if (!BIWENGER_EMAIL || !BIWENGER_PASSWORD || !LIGA_ID) {
  console.error('Faltan BIWENGER_EMAIL, BIWENGER_PASSWORD o LIGA_ID');
  process.exit(1);
}

const OUT_PATH = PUBLIC_OUT_PATH || './public/data.json';
const OUT_DIR  = path.dirname(OUT_PATH);

// ------------ Utilidades generales ------------
async function ensureDir(p) { try { fs.mkdirSync(p, { recursive: true }); } catch {} }
async function snap(page, name) {
  await ensureDir(OUT_DIR);
  try { await page.screenshot({ path: path.join(OUT_DIR, `${name}.png`), fullPage: true }); } catch {}
}

function cleanText(s) {
  return String(s || '')
    .replace(/\u00A0/g, ' ') // nbsp
    .replace(/\s+/g, ' ')
    .trim();
}

function parseMoney(s) {
  // Acepta: "4.650.000 €", "9.300.000 €", "≈ 3.650.000", "30.000 €"
  if (!s) return null;
  const txt = cleanText(s);
  const m = txt.match(/(\d[\d\.]*)/);
  return m ? Number(m[1].replace(/\./g, '')) : null;
}

function normalizePos(pos) {
  if (!pos) return null;
  const p = pos.toUpperCase().trim();
  // Posiciones posibles observadas: DL, DF; Biwenger: POR/DEF/MED/DEL
  if (p === 'DL' || p === 'DEL') return 'DEL';
  if (p === 'DF' || p === 'DEF') return 'DEF';
  if (p === 'MC' || p === 'MED' || p === 'MI' || p === 'MD') return 'MED';
  if (p === 'POR' || p === 'GK' || p === 'GKP') return 'POR';
  return p; // deja tal cual si ya es estándar
}

// ------------ Login y navegación ------------
async function clickIfVisible(page, selector, timeout = 6000) {
  const el = page.locator(selector).first();
  if (await el.isVisible().catch(() => false)) { await el.click({ timeout }); return true; }
  return false;
}

async function acceptCookies(page) {
  // En castellano por defecto, pero por si acaso, contempla inglés
  const sels = [
    'button:has-text("Aceptar")',
    'button:has-text("Acepto")',
    'button:has-text("Aceptar y cerrar")',
    'button:has-text("Accept")',
    '[aria-label*="acept" i]',
    '[id*="didomi"][id*="accept" i]'
  ];
  for (const s of sels) { if (await clickIfVisible(page, s, 1500)) break; }
}

async function login(page) {
  await page.goto('https://biwenger.as.com/', { waitUntil: 'networkidle' });
  await snap(page, '01-home');
  await acceptCookies(page);

  // ¡COMIENZA A JUGAR!
  await clickIfVisible(page, 'text=/¡?COMIENZA A JUGAR!?/i');

  // "Ya tengo cuenta"
  await page.waitForLoadState('networkidle');
  await clickIfVisible(page, 'a[role="button"]:has-text("Ya tengo cuenta")', 6000)
    || await clickIfVisible(page, 'text=Ya tengo cuenta', 6000);

  // Formulario
  const emailSel = 'input[name="email"]';
  const passSel  = 'input[name="password"]';
  await page.waitForSelector(emailSel, { timeout: 20000 });
  await page.fill(emailSel, BIWENGER_EMAIL);
  await page.waitForSelector(passSel, { timeout: 20000 });
  await page.fill(passSel, BIWENGER_PASSWORD);

  // INICIAR SESIÓN
  await clickIfVisible(page, 'button:has-text("INICIAR SESIÓN")', 8000)
    || await page.locator(passSel).press('Enter');

  await page.waitForLoadState('networkidle');
  await snap(page, '02-post-login');
  if ((await page.url()).includes('/login')) throw new Error('Login no completado (seguimos en /login)');
}

async function openLeague(page) {
  await page.goto(`https://biwenger.as.com/league/${LIGA_ID}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  await snap(page, '03-league');
}

async function openTab(page, text, hrefPart) {
  const tries = [
    `a[href*="${hrefPart}"]`,
    `a:has-text("${text}")`,
    `button:has-text("${text}")`,
    `text=${text}`
  ];
  for (const sel of tries) { if (await clickIfVisible(page, sel, 5000)) break; }
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(400);
}

// ------------ Scrapers específicos con tu HTML real ------------
// MARKET: <player-card> con:
//  - Nombre: h3 a
//  - Posición: <player-position> (texto "DL"/"DF"...), title/aria-label tiene "Delantero"/"Defensa"
//  - Equipo: <a.team> con aria-label/title del equipo
//  - Precio real: botón con aria-label "Precio de venta: 9.300.000 €" (lo pedías como precio real)
//  - Precio listado (h4) dentro de .price (lo guardamos como listedPrice)
//  - Increment si aparece en <increment>
async function scrapeMarket(page) {
  // Espera a que haya player-card en el market
  await page.waitForSelector('player-card', { timeout: 15000 }).catch(() => {});
  const players = await page.evaluate(() => {
    function clean(s){ return String(s||'').replace(/\u00A0/g,' ').replace(/\s+/g,' ').trim(); }
    function money(s){ if(!s) return null; const m = clean(s).match(/(\d[\d\.]*)/); return m ? Number(m[1].replace(/\./g,'')) : null; }
    function normPos(p){
      if(!p) return null; p = p.toUpperCase().trim();
      if (p==='DL'||p==='DEL') return 'DEL';
      if (p==='DF'||p==='DEF') return 'DEF';
      if (p==='MC'||p==='MED'||p==='MI'||p==='MD') return 'MED';
      if (p==='POR'||p==='GK'||p==='GKP') return 'POR';
      return p;
    }

    const cards = Array.from(document.querySelectorAll('player-card'));
    const out = [];

    for (const card of cards) {
      // Nombre
      let name = card.querySelector('h3 a')?.textContent;
      if (!name) name = card.querySelector('.sr-only')?.textContent;
      name = clean(name);

      // Posición
      const posEl = card.querySelector('player-position');
      const posTxt = clean(posEl?.textContent || '');
      const position = normPos(posTxt || posEl?.getAttribute('title') || posEl?.getAttribute('aria-label'));

      // Equipo (aria-label/title en <a.team>)
      const teamA = card.querySelector('.team-pos a.team');
      const team = clean(teamA?.getAttribute('aria-label') || teamA?.getAttribute('title') || '');

      // Precio "listado" (h4 dentro de .price)
      const listedPrice = money(card.querySelector('.price h4')?.textContent);

      // Precio REAL de venta del mercado: botón con aria-label "Precio de venta: 9.300.000 €"
      // Si hay varios, nos quedamos con el que ponga "Precio de venta"
      let marketPrice = null;
      const sellBtn = card.querySelector('button[aria-label*="Precio de venta"]');
      if (sellBtn) marketPrice = money(sellBtn.getAttribute('aria-label'));

      // Incremento si aparece
      const increment = money(card.querySelector('increment')?.textContent);

      // URL jugador (por si quieres trazar)
      const url = card.querySelector('.photo a, h3 a')?.getAttribute('href') || null;

      if (name) {
        out.push({
          name,
          position: position || null,
          team: team || null,
          price: marketPrice != null ? marketPrice : listedPrice, // 👈 prioriza precio real
          listedPrice: listedPrice ?? null,
          increment: increment ?? null,
          url
        });
      }
    }
    return out;
  });

  // Saldo disponible en Market (sticky-status → transfer-market-user-status → primer <balance>)
  const balance = await page.evaluate(() => {
    function clean(s){ return String(s||'').replace(/\u00A0/g,' ').replace(/\s+/g,' ').trim(); }
    function money(s){ if(!s) return null; const m = clean(s).match(/(\d[\d\.]*)/); return m ? Number(m[1].replace(/\./g,'')) : null; }
    const cont = document.querySelector('.sticky-status transfer-market-user-status');
    if (!cont) return null;
    const bal = cont.querySelector('balance');
    return money(bal?.textContent || '');
  });

  return { players, balance };
}

// TEAM: estructura similar de <player-card>, sin botón de "Precio de venta". Precio en .price h4.
async function scrapeTeam(page) {
  await page.waitForSelector('player-card', { timeout: 15000 }).catch(() => {});
  const players = await page.evaluate(() => {
    function clean(s){ return String(s||'').replace(/\u00A0/g,' ').replace(/\s+/g,' ').trim(); }
    function money(s){ if(!s) return null; const m = clean(s).match(/(\d[\d\.]*)/); return m ? Number(m[1].replace(/\./g,'')) : null; }
    function normPos(p){
      if(!p) return null; p = p.toUpperCase().trim();
      if (p==='DL'||p==='DEL') return 'DEL';
      if (p==='DF'||p==='DEF') return 'DEF';
      if (p==='MC'||p==='MED'||p==='MI'||p==='MD') return 'MED';
      if (p==='POR'||p==='GK'||p==='GKP') return 'POR';
      return p;
    }

    const cards = Array.from(document.querySelectorAll('player-card'));
    const out = [];

    for (const card of cards) {
      let name = card.querySelector('h3 a')?.textContent;
      if (!name) name = card.querySelector('.sr-only')?.textContent;
      name = clean(name);

      const posEl = card.querySelector('player-position');
      const posTxt = clean(posEl?.textContent || '');
      const position = normPos(posTxt || posEl?.getAttribute('title') || posEl?.getAttribute('aria-label'));

      const teamA = card.querySelector('.team-pos a.team');
      const team = clean(teamA?.getAttribute('aria-label') || teamA?.getAttribute('title') || '');

      const price = money(card.querySelector('.price h4')?.textContent);
      const url = card.querySelector('.photo a, h3 a')?.getAttribute('href') || null;

      if (name) {
        out.push({
          name,
          position: position || null,
          team: team || null,
          price: price ?? null,
          url
        });
      }
    }
    return out;
  });

  return players;
}

// ------------ Runner principal ------------
async function run() {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox','--disable-dev-shm-usage']
  });
  const context = await browser.newContext({
    viewport: { width: 1366, height: 850 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
    locale: 'es-ES',
    extraHTTPHeaders: { 'Accept-Language': 'es-ES,es;q=0.9' }
  });
  const page = await context.newPage();

  try {
    // 1) Login y liga
    console.log('➡️ Login…');
    await login(page);

    console.log('➡️ Liga…');
    await openLeague(page);

    // 2) Equipo
    console.log('➡️ Equipo…');
    await openTab(page, 'Equipo', 'team');
    const team = await scrapeTeam(page);
    console.log(`✅ Equipo: ${team.length}`);

    // 3) Mercado
    console.log('➡️ Mercado…');
    await openTab(page, 'Mercado', 'market');
    const { players: market, balance } = await scrapeMarket(page);
    console.log(`✅ Mercado: ${market.length} | Saldo: ${balance ?? 'n/d'}`);

    // 4) Guardar JSON
    const payload = {
      scrapedAt: new Date().toISOString(),
      leagueId: LIGA_ID,
      balance: balance ?? null,
      team: team.map(p => ({ ...p, source: 'equipo' })),
      market: market.map(p => ({ ...p, source: 'mercado' }))
    };

    await ensureDir(OUT_DIR);
    fs.writeFileSync(OUT_PATH, JSON.stringify(payload, null, 2));
    console.log('💾 Guardado en', OUT_PATH);
    await snap(page, '99-ok');

  } catch (e) {
    console.error('❌ Error:', e?.message || e);
    await snap(page, 'error');
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

run().catch(() => process.exit(1));
