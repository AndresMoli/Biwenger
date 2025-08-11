import { chromium } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const {
  BIWENGER_EMAIL,
  BIWENGER_PASSWORD,
  LIGA_ID,
  PUBLIC_OUT_PATH,
  FETCH_CLAUSE // "true" para rascar clausula en la ficha de cada jugador
} = process.env;

if (!BIWENGER_EMAIL || !BIWENGER_PASSWORD || !LIGA_ID) {
  console.error('Faltan BIWENGER_EMAIL, BIWENGER_PASSWORD o LIGA_ID');
  process.exit(1);
}

const OUT_PATH = PUBLIC_OUT_PATH || './public/data.json';
const OUT_DIR  = path.dirname(OUT_PATH);

// ------------ Utilidades ------------
async function ensureDir(p) { try { fs.mkdirSync(p, { recursive: true }); } catch {} }
async function snap(page, name) {
  await ensureDir(OUT_DIR);
  try { await page.screenshot({ path: path.join(OUT_DIR, `${name}.png`), fullPage: true }); } catch {}
}
const clean = (s)=> String(s||'').replace(/\u00A0/g,' ').replace(/\s+/g,' ').trim();
const money = (s)=>{ const m = clean(s).match(/(\d[\d\.]*)/); return m ? Number(m[1].replace(/\./g,'')) : null; };
const normPos = (p)=>{
  if (!p) return null; p = p.toUpperCase().trim();
  if (p==='DL'||p==='DEL') return 'DEL';
  if (p==='DF'||p==='DEF') return 'DEF';
  if (p==='MC'||p==='MED'||p==='MI'||p==='MD') return 'MED';
  if (p==='POR'||p==='GK'||p==='GKP') return 'POR';
  return p;
};
async function clickIfVisible(page, selector, timeout = 6000) {
  const el = page.locator(selector).first();
  if (await el.isVisible().catch(()=>false)) { await el.click({ timeout }); return true; }
  return false;
}

// ------------ Login / Navegación ------------
async function acceptCookies(page) {
  const sels = [
    'button:has-text("Aceptar")','button:has-text("Acepto")','button:has-text("Aceptar y cerrar")',
    'button:has-text("Accept")','[aria-label*="acept" i]','[id*="didomi"][id*="accept" i]'
  ];
  for (const s of sels) { if (await clickIfVisible(page, s, 1500)) break; }
}

async function login(page) {
  await page.goto('https://biwenger.as.com/', { waitUntil: 'networkidle' });
  await snap(page,'01-home');
  await acceptCookies(page);
  await clickIfVisible(page, 'text=/¡?COMIENZA A JUGAR!?/i');
  await page.waitForLoadState('networkidle');
  await clickIfVisible(page, 'a[role="button"]:has-text("Ya tengo cuenta")', 6000)
    || await clickIfVisible(page, 'text=Ya tengo cuenta', 6000);

  const emailSel = 'input[name="email"]';
  const passSel  = 'input[name="password"]';
  await page.waitForSelector(emailSel, { timeout: 20000 });
  await page.fill(emailSel, BIWENGER_EMAIL);
  await page.waitForSelector(passSel, { timeout: 20000 });
  await page.fill(passSel, BIWENGER_PASSWORD);
  await clickIfVisible(page, 'button:has-text("INICIAR SESIÓN")', 8000)
    || await page.locator(passSel).press('Enter');
  await page.waitForLoadState('networkidle');
  await snap(page, '02-post-login');
  if ((await page.url()).includes('/login')) throw new Error('Login no completado (seguimos en /login)');
}

async function openLeague(page) {
  await page.goto(`https://biwenger.as.com/league/${LIGA_ID}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  await snap(page,'03-league');
}
async function openTab(page, text, hrefPart) {
  const tries = [`a[href*="${hrefPart}"]`,`a:has-text("${text}")`,`button:has-text("${text}")`,`text=${text}`];
  for (const sel of tries) { if (await clickIfVisible(page, sel, 5000)) break; }
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(400);
}

// ------------ Scrapers ------------
async function scrapeMarket(page) {
  await page.waitForSelector('player-card', { timeout: 15000 }).catch(()=>{});
  const players = await page.evaluate(() => {
    function C(s){return String(s||'').replace(/\u00A0/g,' ').replace(/\s+/g,' ').trim();}
    function M(s){const m=C(s).match(/(\d[\d\.]*)/);return m?Number(m[1].replace(/\./g,'')):null;}
    function P(p){if(!p)return null;p=p.toUpperCase().trim();
      if(p==='DL'||p==='DEL')return'DEL';
      if(p==='DF'||p==='DEF')return'DEF';
      if(p==='MC'||p==='MED'||p==='MI'||p==='MD')return'MED';
      if(p==='POR'||p==='GK'||p==='GKP')return'POR';
      return p;}

    const cards = Array.from(document.querySelectorAll('player-card'));
    const out = [];
    for (const card of cards) {
      let name = card.querySelector('h3 a')?.textContent || card.querySelector('.sr-only')?.textContent || '';
      name = C(name);

      const posEl = card.querySelector('player-position');
      const posTxt = C(posEl?.textContent || '');
      const position = P(posTxt || posEl?.getAttribute('title') || posEl?.getAttribute('aria-label'));
      const teamA = card.querySelector('.team-pos a.team');
      const team = C(teamA?.getAttribute('aria-label') || teamA?.getAttribute('title') || '');

      const listedPrice = M(card.querySelector('.price h4')?.textContent);
      let marketPrice = null;
      const sellBtn = card.querySelector('button[aria-label*="Precio de venta"]');
      if (sellBtn) marketPrice = M(sellBtn.getAttribute('aria-label'));

      // ⏳ plazo: <time-relative title="Su venta finaliza 13/8/25, 10:22.">en 2 días</time-relative>
      const timeRel = card.querySelector('time-relative');
      const timeRemaining = C(timeRel?.textContent || '') || null;
      const deadlineRaw = C(timeRel?.getAttribute('title') || '');
      // extrae la fecha del title si existe
      let deadline = null;
      const m = deadlineRaw.match(/finaliza\s+(.+?)\.*$/i);
      if (m && m[1]) deadline = m[1];

      const url = card.querySelector('.photo a, h3 a')?.getAttribute('href') || null;
      if (name) {
        out.push({
          name,
          position: position || null,
          team: team || null,
          price: (marketPrice != null ? marketPrice : listedPrice) ?? null,
          listedPrice: listedPrice ?? null,
          timeRemaining,
          deadline,
          url
        });
      }
    }
    return out;
  });

  // Saldo (primer <balance> de la barra de estado)
  const balance = await page.evaluate(() => {
    function C(s){return String(s||'').replace(/\u00A0/g,' ').replace(/\s+/g,' ').trim();}
    function M(s){const m=C(s).match(/(\d[\d\.]*)/);return m?Number(m[1].replace(/\./g,'')):null;}
    const cont = document.querySelector('.sticky-status transfer-market-user-status');
    if (!cont) return null;
    const bal = cont.querySelector('balance');
    return M(bal?.textContent || '');
  });

  return { players, balance };
}

async function scrapeTeam(page) {
  await page.waitForSelector('player-card', { timeout: 15000 }).catch(()=>{});
  const players = await page.evaluate(() => {
    function C(s){return String(s||'').replace(/\u00A0/g,' ').replace(/\s+/g,' ').trim();}
    function M(s){const m=C(s).match(/(\d[\d\.]*)/);return m?Number(m[1].replace(/\./g,'')):null;}
    function P(p){if(!p)return null;p=p.toUpperCase().trim();
      if(p==='DL'||p==='DEL')return'DEL';
      if(p==='DF'||p==='DEF')return'DEF';
      if(p==='MC'||p==='MED'||p==='MI'||p==='MD')return'MED';
      if(p==='POR'||p==='GK'||p==='GKP')return'POR';
      return p;}

    const out = [];
    const cards = Array.from(document.querySelectorAll('player-card'));
    for (const card of cards) {
      let name = card.querySelector('h3 a')?.textContent || card.querySelector('.sr-only')?.textContent || '';
      name = C(name);
      const posEl = card.querySelector('player-position');
      const posTxt = C(posEl?.textContent || '');
      const position = P(posTxt || posEl?.getAttribute('title') || posEl?.getAttribute('aria-label'));
      const teamA = card.querySelector('.team-pos a.team');
      const team = C(teamA?.getAttribute('aria-label') || teamA?.getAttribute('title') || '');
      const price = M(card.querySelector('.price h4')?.textContent);
      const url = card.querySelector('.photo a, h3 a')?.getAttribute('href') || null;
      if (name) out.push({ name, position: position||null, team: team||null, price: price??null, url });
    }
    return out;
  });

  return players;
}

// Enriquecer SIEMPRE con cláusula y propietario visitando la ficha del jugador
async function enrichFromProfile(context, players, concurrency = 5) {
  if (!players?.length) return players;

  // limitador de concurrencia sencillo
  let idx = 0;
  const out = players.map(p => ({ ...p }));
  async function worker() {
    const page = await context.newPage();
    try {
      while (idx < players.length) {
        const i = idx++;
        const p = players[i];
        if (!p?.url) continue;

        const full = p.url.startsWith('http') ? p.url : `https://biwenger.as.com${p.url}`;
        try {
          await page.goto(full, { waitUntil: 'domcontentloaded' });
          // espera “suave”: la ficha termina de pintar componentes Angular
          await page.waitForTimeout(600);
          // intenta esperar al bloque de cláusula si existe
          await page.waitForSelector('player-clause, span:has-text("Cláusula")', { timeout: 4000 }).catch(()=>{});

          const details = await page.evaluate(() => {
            const C = (s)=>String(s||'').replace(/\u00A0/g,' ').replace(/\s+/g,' ').trim();
            const M = (s)=>{ const m=C(s).match(/(\d[\d\.]*)/); return m?Number(m[1].replace(/\./g,'')):null; };

            // Cláusula y depositado
            let clause = null, clauseDeposited = null;
            const clauseBlock = document.querySelector('player-clause') || document.querySelector('span:has(> strong)');
            if (clauseBlock) {
              const strongs = clauseBlock.querySelectorAll('strong');
              if (strongs[0]) clause = M(strongs[0].textContent);
              if (strongs[1]) clauseDeposited = M(strongs[1].textContent);
              // fallback por texto
              if (!clause) {
                const t = C(clauseBlock.textContent || '');
                const m = t.match(/Cláusula.*?([\d\.]+)\s*€/i);
                if (m) clause = M(m[1]);
              }
            }

            // Propietario actual (bloque “Propietario …”)
            let owner = null, ownerUrl = null;
            const ownerLink = document.querySelector('div:has(> user-link) a[href^="/user/"]') ||
                              document.querySelector('a[href^="/user/"]');
            if (ownerLink) {
              owner = C(ownerLink.textContent);
              ownerUrl = ownerLink.getAttribute('href') || null;
            }

            return { clause, clauseDeposited, owner, ownerUrl };
          });

          out[i] = { ...out[i], ...details };
        } catch { /* continuar con el resto */ }
      }
    } finally {
      await page.close();
    }
  }

  // lanzar N workers
  const workers = Array.from({ length: Math.min(concurrency, players.length) }, () => worker());
  await Promise.all(workers);
  return out;
}


// ------------ Run ------------
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
    // Login + liga
    await login(page);
    await openLeague(page);



    // Equipo
    await openTab(page, 'Equipo', 'team');
    let team = await scrapeTeam(page);
    await snap(page, '04-equipo');  // imagen específica de tu plantilla
    team = await enrichFromProfile(context, team);  // ← SIEMPRE añade cláusula/propietario
    
    // Mercado
    await openTab(page, 'Mercado', 'market');
    let { players: market, balance } = await scrapeMarket(page);
    market = await enrichFromProfile(context, market); // ← también para los del mercado

    // Guardado principal + histórico con timestamp
    const now = new Date();
    const tsFile = now.toISOString().replace(/[-:]/g,'').slice(0,15).replace('T','_'); // AAAAMMDD_HHMMSS aprox
    const histDir = path.join(OUT_DIR, 'historicos');
    await ensureDir(histDir);

    const payload = {
      scrapedAt: now.toISOString(),
      leagueId: LIGA_ID,
      balance: balance ?? null,
      team: team.map(p => ({ ...p, source: 'equipo' })),
      market: market.map(p => ({ ...p, source: 'mercado' }))
    };

    // data.json (último)
    await ensureDir(OUT_DIR);
    fs.writeFileSync(OUT_PATH, JSON.stringify(payload, null, 2));
    // histórico
    const histPath = path.join(histDir, `${tsFile}.json`);
    fs.writeFileSync(histPath, JSON.stringify(payload, null, 2));

    await snap(page, '99-ok');
    console.log('💾 Guardado en:', OUT_PATH, 'y', histPath);

  } catch (e) {
    console.error('❌ Error:', e?.message || e);
    await snap(page, 'error');
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

run().catch(()=>process.exit(1));
