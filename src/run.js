import { chromium } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const { BIWENGER_EMAIL, BIWENGER_PASSWORD, LIGA_ID, PUBLIC_OUT_PATH } = process.env;
if (!BIWENGER_EMAIL || !BIWENGER_PASSWORD || !LIGA_ID) {
  console.error("Faltan BIWENGER_EMAIL, BIWENGER_PASSWORD o LIGA_ID");
  process.exit(1);
}

const OUT_PATH = PUBLIC_OUT_PATH || './public/data.json';
const OUT_DIR  = path.dirname(OUT_PATH);

async function ensureDir(p) { try { fs.mkdirSync(p, { recursive: true }); } catch {} }
async function snap(page, name) {
  await ensureDir(OUT_DIR);
  try { await page.screenshot({ path: path.join(OUT_DIR, `${name}.png`), fullPage: true }); } catch {}
}

async function clickIfVisible(page, selector, timeout = 6000) {
  const el = page.locator(selector).first();
  if (await el.isVisible().catch(()=>false)) { await el.click({ timeout }); return true; }
  return false;
}

async function login(page) {
  // 0) Home
  await page.goto('https://biwenger.as.com/', { waitUntil: 'networkidle' });
  await snap(page, '01-home');

  // 1) Cookies: botón "Aceptar" del modal
  await clickIfVisible(page, 'button:has-text("Aceptar")', 2000);

  // 2) Botón grande rojo ¡COMIENZA A JUGAR!
  await clickIfVisible(page, 'text=/¡?COMIENZA A JUGAR!?/i');

  // 3) Pantalla de registro -> link/botón "Ya tengo cuenta"
  //   (según tu HTML: <a role="button">Ya tengo cuenta</a>)
  await page.waitForLoadState('networkidle');
  await clickIfVisible(page, 'a[role="button"]:has-text("Ya tengo cuenta")', 6000)
    || await clickIfVisible(page, 'text=Ya tengo cuenta', 6000);

  // 4) Formulario de login: inputs por name exactos
  const emailSel = 'input[name="email"]';
  const passSel  = 'input[name="password"]';
  await page.waitForSelector(emailSel, { timeout: 20000 });
  await page.fill(emailSel, BIWENGER_EMAIL);
  await page.waitForSelector(passSel, { timeout: 20000 });
  await page.fill(passSel, BIWENGER_PASSWORD);

  // Botón "INICIAR SESIÓN"
  await clickIfVisible(page, 'button:has-text("INICIAR SESIÓN")', 8000)
    || await page.locator(passSel).press('Enter');

  await page.waitForLoadState('networkidle');
  await snap(page, '02-post-login');

  // Si algo salió mal y seguimos en login, corta
  const url = await page.url();
  if (/\/login/i.test(url)) throw new Error('Login no completado (seguimos en /login)');
}

async function gotoLeague(page) {
  await page.goto(`https://biwenger.as.com/app/#/league/${LIGA_ID}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await snap(page, '03-league');
}

async function openTab(page, text, hrefPart) {
  // Navega por enlace o por texto de pestaña
  const tries = [
    `a[href*="${hrefPart}"]`,
    `a:has-text("${text}")`,
    `button:has-text("${text}")`,
    `text=${text}`
  ];
  for (const sel of tries) {
    if (await clickIfVisible(page, sel, 5000)) break;
  }
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(600);
}

async function waitAny(page, sels, ms = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    for (const s of sels) {
      if (await page.locator(s).first().isVisible().catch(()=>false)) return true;
    }
    await page.waitForTimeout(250);
  }
  return false;
}

async function scrapeList(page, candidates) {
  await waitAny(page, candidates, 15000);
  return page.evaluate((sels) => {
    let nodes = [];
    for (const s of sels) {
      const list = Array.from(document.querySelectorAll(s));
      if (list.length) { nodes = list; break; }
    }
    const num = (str) => {
      const m = String(str||'').match(/(\d[\d\.]*)(?:\s?€| M| M€)?/i);
      return m ? Number(m[1].replace(/\./g,'')) : null;
    };
    const out = [];
    for (const n of nodes) {
      const t = (n.innerText||'').trim(); if (!t) continue;
      const name  = (t.match(/^[A-ZÁÉÍÓÚÑÜ][\wÁÉÍÓÚÑüÜ .'\-]{2,}/m)||[null])[0];
      const pos   = (t.match(/\b(POR|DEF|MED|DEL)\b/)||[null])[0];
      const team  = (t.match(/\(([A-Z]{2,3})\)/)||[null,null])[1];
      const price = num(t);
      const status= (t.match(/(lesión|lesionado|duda|sanción|baja|ok|titular|doubt)/i)||[null])[0];
      const trend = (t.match(/[\+\-]\d+%/)||[null])[0];
      if (name && pos) out.push({ name: name.trim(), position: pos, team: team||null, price, status: status?status.toLowerCase():null, trend: trend||null });
    }
    return out;
  }, candidates);
}

async function run() {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox','--disable-dev-shm-usage']
  });
  const context = await browser.newContext({
    viewport: { width: 1366, height: 850 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36'
  });
  const page = await context.newPage();

  try {
    console.log('➡️ Login…');
    await login(page);

    console.log('➡️ Liga…');
    await gotoLeague(page);

    console.log('➡️ Equipo…');
    await openTab(page, 'Equipo', 'team');
    const team = await scrapeList(page, ['[class*="player"]','[class*="card"]','[class*="lineup"]']);
    console.log(`✅ Equipo: ${team.length}`);

    console.log('➡️ Mercado…');
    await openTab(page, 'Mercado', 'market');
    const market = await scrapeList(page, ['table tr','[class*="market"] [class*="row"]','[class*="market"] [class*="item"]']);
    console.log(`✅ Mercado: ${market.length}`);

    // Saldo (best-effort)
    let balance = null;
    try {
      const txt = await page.locator('body').innerText();
      const m = txt.match(/(?:Saldo|Presupuesto|€)\s*([\d\.]+)/i);
      balance = m ? Number(m[1].replace(/\./g,'')) : null;
    } catch {}

    const payload = {
      scrapedAt: new Date().toISOString(),
      leagueId: LIGA_ID,
      balance,
      team: team.map(x => ({ ...x, source: 'equipo' })),
      market: market.map(x => ({ ...x, source: 'mercado' }))
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

run().catch(()=>process.exit(1));
