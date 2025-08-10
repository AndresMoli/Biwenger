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

async function clickMany(pageOrFrame, selectors, timeout = 3000) {
  for (const s of selectors) {
    const el = pageOrFrame.locator(s).first();
    if (await el.isVisible().catch(()=>false)) {
      try { await el.click({ timeout }); return true; } catch {}
    }
  }
  return false;
}

async function acceptCookiesEverywhere(page) {
  const sels = [
    'button:has-text("Aceptar")','button:has-text("Acepto")','button:has-text("Aceptar y cerrar")',
    'button:has-text("Agree")','button:has-text("Consent")','[aria-label*="acept" i]',
    '[id*="didomi"][id*="accept" i]'
  ];
  await clickMany(page, sels).catch(()=>{});
  for (const f of page.frames()) await clickMany(f, sels).catch(()=>{});
}

async function waitFillAnyFrame(page, selector, value, totalMs = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < totalMs) {
    // principal
    try {
      const el = page.locator(selector).first();
      if (await el.isVisible({ timeout: 500 }).catch(()=>false)) { await el.fill(value, { timeout: 1000 }); return true; }
    } catch {}
    // iframes
    for (const f of page.frames()) {
      try {
        const el = f.locator(selector).first();
        if (await el.isVisible({ timeout: 200 }).catch(()=>false)) { await el.fill(value, { timeout: 800 }); return true; }
      } catch {}
    }
    await page.waitForTimeout(300);
  }
  return false;
}

async function pressEnterAnyFrame(page, selector) {
  try { await page.locator(selector).press('Enter'); } catch {}
  for (const f of page.frames()) { try { await f.locator(selector).press('Enter'); } catch {} }
}

async function login(page) {
  console.log('➡️ Abriendo /login');
  await page.goto('https://biwenger.as.com/login', { waitUntil: 'networkidle' });
  await snap(page, '01-login');
  await acceptCookiesEverywhere(page);

  // 👇 NUEVO: si aterriza en registro, pulsar "Ya tengo cuenta"
  const alreadySelectors = [
    'text=Ya tengo cuenta',
    'button:has-text("Ya tengo cuenta")',
    'a:has-text("Ya tengo cuenta")'
  ];
  const switched = await clickMany(page, alreadySelectors, 4000);
  if (switched) {
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(800);
  }

  const emailSel = 'input[type="email"], input[name="email"], input[id*="email" i], input[placeholder*="email" i], input[name="username"]';
  const passSel  = 'input[type="password"], input[name="password"], input[id*="pass" i], input[placeholder*="contraseña" i]';

  const emailOk = await waitFillAnyFrame(page, emailSel, BIWENGER_EMAIL);
  const passOk  = await waitFillAnyFrame(page, passSel,  BIWENGER_PASSWORD);
  if (!emailOk || !passOk) {
    await snap(page, '02-no-form');
    throw new Error('No se localiza el formulario de login (email/password) en página ni iframes');
  }

  // Enviar
  const submitSels = [
    'button[type="submit"]','button:has-text("Entrar")','button:has-text("Iniciar sesión")','button:has-text("Acceder")','form button'
  ];
  let clicked = await clickMany(page, submitSels, 5000);
  if (!clicked) for (const f of page.frames()) { clicked ||= await clickMany(f, submitSels, 2000); }
  if (!clicked) await pressEnterAnyFrame(page, passSel);

  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1200);
  await snap(page, '03-post-login');

  if ((await page.url()).includes('/login')) throw new Error('Login no completado (seguimos en /login)');
  console.log('✅ Login OK');
}

async function gotoLeague(page) {
  console.log('➡️ Abriendo liga');
  await page.goto(`https://biwenger.as.com/app/#/league/${LIGA_ID}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await snap(page, '04-league');
}

async function openTab(page, text, hrefPart) {
  const sels = [`a[href*="${hrefPart}"]`,`a:has-text("${text}")`,`button:has-text("${text}")`,`text=${text}`];
  let ok = await clickMany(page, sels, 6000);
  if (!ok) for (const f of page.frames()) { ok ||= await clickMany(f, sels, 2000); }
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(600);
}

async function waitAny(page, sels, ms = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    for (const s of sels) if (await page.locator(s).first().isVisible().catch(()=>false)) return true;
    await page.waitForTimeout(250);
  }
  return false;
}

async function scrapeList(page, candidates) {
  await waitAny(page, candidates, 15000);
  return page.evaluate((sels) => {
    let nodes = [];
    for (const s of sels) { const n = Array.from(document.querySelectorAll(s)); if (n.length) { nodes = n; break; } }
    const num = s => { const m = String(s||'').match(/(\d[\d\.]*)(?:\s?€| M| M€)?/i); return m ? Number(m[1].replace(/\./g,'')) : null; };
    const out = [];
    for (const el of nodes) {
      const t = (el.innerText||'').trim(); if (!t) continue;
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
    args: ['--no-sandbox','--disable-dev-shm-usage','--disable-blink-features=AutomationControlled']
  });
  const context = await browser.newContext({
    viewport: { width: 1366, height: 850 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36'
  });
  await context.addInitScript(() => Object.defineProperty(navigator, 'webdriver', { get: () => false }));
  const page = await context.newPage();

  try {
    await login(page);
    await gotoLeague(page);

    console.log('➡️ Equipo');
    await openTab(page, 'Equipo', 'team');
    const team = await scrapeList(page, ['[class*="player"]','[class*="card"]','[class*="lineup"]']);
    console.log(`✅ Equipo: ${team.length}`);

    console.log('➡️ Mercado');
    await openTab(page, 'Mercado', 'market');
    const market = await scrapeList(page, ['table tr','[class*="market"] [class*="row"]','[class*="market"] [class*="item"]']);
    console.log(`✅ Mercado: ${market.length}`);

    // Saldo best-effort
    let balance = null;
    try { const txt = await page.locator('body').innerText(); const m = txt.match(/(?:Saldo|Presupuesto|€)\s*([\d\.]+)/i); balance = m ? Number(m[1].replace(/\./g,'')) : null; } catch {}

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