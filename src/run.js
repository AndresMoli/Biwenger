import { chromium } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const {
  BIWENGER_EMAIL,
  BIWENGER_PASSWORD,
  LIGA_ID,
  PUBLIC_OUT_PATH
} = process.env;

if (!BIWENGER_EMAIL || !BIWENGER_PASSWORD || !LIGA_ID) {
  console.error("Faltan variables de entorno: BIWENGER_EMAIL, BIWENGER_PASSWORD, LIGA_ID");
  process.exit(1);
}

const OUT_PATH = PUBLIC_OUT_PATH || './public/data.json';
const OUT_DIR  = path.dirname(OUT_PATH);

async function saveShot(page, name) {
  try {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    await page.screenshot({ path: path.join(OUT_DIR, `${name}.png`), fullPage: true });
  } catch {}
}

async function acceptCookies(page) {
  const sels = [
    'button:has-text("Aceptar")',
    'button:has-text("Acepto")',
    'button:has-text("Aceptar y cerrar")',
    'button:has-text("Consent")',
    'button:has-text("Agree")',
    '[aria-label*="acept" i]',
    '[id*="didomi"][id*="accept" i]',
    'button[aria-label*="Accept" i]',
  ];
  for (const s of sels) {
    const el = page.locator(s).first();
    if (await el.isVisible().catch(()=>false)) {
      try { await el.click({ timeout: 1000 }); break; } catch {}
    }
  }
}

async function fillLogin(page) {
  // Ir a la pantalla REAL de login (gracias por la URL)
  await page.goto('https://biwenger.as.com/login', { waitUntil: 'networkidle' });
  await acceptCookies(page);

  const emailSel = 'input[type="email"], input[name="email"], input[placeholder*="email" i]';
  const passSel  = 'input[type="password"], input[name="password"], input[placeholder*="contraseña" i]';
  const submitSel = 'button[type="submit"], button:has-text("Entrar"), button:has-text("Iniciar sesión")';

  await page.waitForSelector(emailSel, { timeout: 20000 });
  await page.fill(emailSel, BIWENGER_EMAIL);

  await page.waitForSelector(passSel, { timeout: 20000 });
  await page.fill(passSel, BIWENGER_PASSWORD);

  // Click en el botón o Enter
  try { await page.click(submitSel, { timeout: 10000 }); } catch {}
  try { await page.locator(passSel).press('Enter'); } catch {}

  // Esperar a salir del login
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500);
  if ((await page.url()).includes('/login')) {
    throw new Error('Login no completado: seguimos en /login');
  }
}

async function gotoLeague(page) {
  // Cargar la liga por ID
  await page.goto(`https://biwenger.as.com/app/#/league/${LIGA_ID}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
}

async function openTab(page, text, hrefPart) {
  const options = [
    `a[href*="${hrefPart}"]`,
    `a:has-text("${text}")`,
    `button:has-text("${text}")`,
    `text=${text}`
  ];
  for (const sel of options) {
    const loc = page.locator(sel).first();
    if (await loc.isVisible().catch(()=>false)) {
      try { await loc.click({ timeout: 6000 }); break; } catch {}
    }
  }
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(800);
}

async function scrapeList(page, selectorCandidates) {
  // Esperar a que exista alguno de los selectores candidatos
  let ok = false;
  for (const sel of selectorCandidates) {
    try { await page.waitForSelector(sel, { timeout: 15000 }); ok = true; break; } catch {}
  }
  if (!ok) return [];

  return page.evaluate((sels) => {
    const pick = (sel) => Array.from(document.querySelectorAll(sel));
    let nodes = [];
    for (const s of sels) {
      nodes = pick(s);
      if (nodes.length) break;
    }
    const parsePrice = (s) => {
      const m = String(s||'').match(/(\d[\d\.]*)(?:\s?€| M| M€)?/i);
      return m ? Number(m[1].replace(/\./g,'')) : null;
    };
    const out = [];
    nodes.forEach(n => {
      const t = (n.innerText||'').trim();
      if (!t) return;
      const name = (t.match(/^[A-ZÁÉÍÓÚÑÜ][\wÁÉÍÓÚÑüÜ .'\-]{2,}/m) || [null])[0];
      const pos  = (t.match(/\b(POR|DEF|MED|DEL)\b/) || [null])[0];
      const team = (t.match(/\(([A-Z]{2,3})\)/) || [null,null])[1];
      const price = parsePrice(t);
      const status = (t.match(/(lesión|lesionado|duda|sanción|baja|ok|titular|doubt)/i) || [null])[0];
      const trend = (t.match(/[\+\-]\d+%/) || [null])[0];
      if (name && pos) {
        out.push({
          name: name.trim(),
          position: pos,
          team: team || null,
          price,
          status: status ? status.toLowerCase() : null,
          trend: trend || null
        });
      }
    });
    return out;
  }, selectorCandidates);
}

async function scrape() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    console.log('➡️ Abriendo login…');
    await page.goto('https://biwenger.as.com/', { waitUntil: 'networkidle' });
    await acceptCookies(page);
    await fillLogin(page);
    console.log('✅ Login ok');

    console.log('➡️ Cargando liga…');
    await gotoLeague(page);

    console.log('➡️ Equipo…');
    await openTab(page, 'Equipo', 'team');
    const equipo = await scrapeList(page, [
      '[class*="player"]',
      '[class*="card"]',
      '[class*="lineup"]'
    ]);
    console.log(`✅ Equipo: ${equipo.length}`);

    console.log('➡️ Mercado…');
    await openTab(page, 'Mercado', 'market');
    const mercado = await scrapeList(page, [
      'table tr',
      '[class*="market"] [class*="row"]',
      '[class*="market"] [class*="item"]'
    ]);
    console.log(`✅ Mercado: ${mercado.length}`);

    // Saldo (best-effort)
    let saldo = null;
    try {
      const allText = await page.locator('body').innerText();
      const n = (allText.match(/(?:Saldo|Presupuesto|€)\s*([\d\.]+)/i) || [null,null])[1];
      saldo = n ? Number(n.replace(/\./g,'')) : null;
    } catch {}

    const payload = {
      scrapedAt: new Date().toISOString(),
      leagueId: LIGA_ID,
      balance: saldo,
      team: equipo.map(o => ({ ...o, source: 'equipo' })),
      market: mercado.map(o => ({ ...o, source: 'mercado' }))
    };

    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.writeFileSync(OUT_PATH, JSON.stringify(payload, null, 2));
    console.log(`💾 Guardado en ${OUT_PATH}`);
  } catch (e) {
    console.error('❌ Error en scraping:', e?.message || e);
    await saveShot(page, 'error');
    throw e;
  } finally {
    await browser.close();
  }
}

scrape().catch(() => process.exit(1));