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

const OUT_DIR = (PUBLIC_OUT_PATH && path.dirname(PUBLIC_OUT_PATH)) || './public';

async function saveShot(page, name) {
  try {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    await page.screenshot({ path: path.join(OUT_DIR, `${name}.png`), fullPage: true });
  } catch {}
}

async function acceptCookies(page) {
  const selectors = [
    'button:has-text("Aceptar")',
    'button:has-text("Acepto")',
    'button:has-text("Aceptar y cerrar")',
    'button:has-text("Consent")',
    'button:has-text("Agree")',
    '[aria-label*="acept"]',
    '[id*="didomi"][id*="accept"]',
  ];
  for (const sel of selectors) {
    const el = page.locator(sel);
    if (await el.first().isVisible().catch(()=>false)) {
      try { await el.first().click({ timeout: 1000 }); break; } catch {}
    }
  }
}

async function fillLogin(page) {
  // Ir directamente al login
  await page.goto('https://biwenger.as.com/app/#/login', { waitUntil: 'networkidle' });
  await acceptCookies(page);

  const emailSel = 'input[type="email"], input[name="email"], input[placeholder*="email" i]';
  const passSel  = 'input[type="password"], input[name="password"], input[placeholder*="contraseña" i]';

  await page.waitForSelector(emailSel, { timeout: 15000 });
  await page.fill(emailSel, BIWENGER_EMAIL, { timeout: 10000 });

  await page.waitForSelector(passSel, { timeout: 15000 });
  await page.fill(passSel, BIWENGER_PASSWORD, { timeout: 10000 });

  // Botón de enviar (varios posibles)
  const submitCandidates = [
    'button[type="submit"]',
    'button:has-text("Entrar")',
    'button:has-text("Iniciar sesión")',
    'form button',
  ];
  for (const sel of submitCandidates) {
    const btn = page.locator(sel).first();
    if (await btn.isVisible().catch(()=>false)) {
      try { await btn.click({ timeout: 5000 }); break; } catch {}
    }
  }

  // Alternativa: enter en password
  try { await page.locator(passSel).press('Enter'); } catch {}

  // Esperar a que ya no estemos en la ruta de login
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500);
  if ((await page.url()).includes('/login')) {
    throw new Error('Login no completado (seguimos en /login).');
  }
}

async function gotoLeague(page) {
  // Ir a la liga por id y esperar que cargue
  await page.goto(`https://biwenger.as.com/app/#/league/${LIGA_ID}`, { waitUntil: 'networkidle' });
  // Esperar algo típico de una liga (cabecera, tabs…)
  await page.waitForTimeout(1000);
}

async function gotoTab(page, text, hrefPart) {
  // Click por href o por texto (según esté renderizado)
  const options = [
    `a[href*="${hrefPart}"]`,
    `a:has-text("${text}")`,
    `button:has-text("${text}")`,
    `text=${text}`
  ];
  for (const sel of options) {
    const loc = page.locator(sel).first();
    if (await loc.isVisible().catch(()=>false)) {
      try { await loc.click({ timeout: 5000 }); break; } catch {}
    }
  }
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(800);
}

async function scrapeList(page, selectorCandidates, mapper) {
  // Esperar a que exista al menos uno de los candidatos
  let found = false;
  for (const sel of selectorCandidates) {
    try {
      await page.waitForSelector(sel, { timeout: 15000 });
      found = true; break;
    } catch {}
  }
  if (!found) return [];

  return page.evaluate((sels) => {
    const selectAll = (sel) => Array.from(document.querySelectorAll(sel));
    let nodes = [];
    for (const sel of sels) {
      if (nodes.length) break;
      nodes = selectAll(sel);
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

    console.log('➡️ Abriendo liga…');
    await gotoLeague(page);

    console.log('➡️ Equipo…');
    await gotoTab(page, 'Equipo', 'team');
    const equipo = await scrapeList(
      page,
      ['[class*="player"]', '[class*="card"]', '[class*="lineup"]'],
      null
    );
    console.log(`✅ Equipo: ${equipo.length}`);

    console.log('➡️ Mercado…');
    await gotoTab(page, 'Mercado', 'market');
    const mercado = await scrapeList(
      page,
      ['table tr', '[class*="market"] [class*="row"]', '[class*="market"] [class*="item"]'],
      null
    );
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
      team: equipo.map(o => ({...o, source: 'equipo'})),
      market: mercado.map(o => ({...o, source: 'mercado'}))
    };

    const outPath = PUBLIC_OUT_PATH || './public/data.json';
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
    console.log(`💾 Guardado en ${outPath}`);

  } catch (e) {
    console.error('❌ Error en scraping:', e?.message || e);
    await saveShot(page, 'error');
    throw e;
  } finally {
    await browser.close();
  }
}

scrape().catch(() => process.exit(1));