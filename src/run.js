import { chromium } from '@playwright/test';
import fs from 'fs';

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

async function scrape() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  // 1) Login
  await page.goto('https://biwenger.as.com/');
  // Botón de login (puede variar, probamos varias opciones)
  const loginButtons = [
    page.getByRole('button', { name: /iniciar sesión|entrar/i }),
    page.locator('text=/Iniciar sesión|Entrar/i').first()
  ];
  for (const btn of loginButtons) {
    try { await btn.click({ timeout: 4000 }); break; } catch {}
  }

  // Campos
  try { await page.getByPlaceholder(/email/i).fill(BIWENGER_EMAIL, { timeout: 5000 }); } catch {}
  try { await page.getByPlaceholder(/contraseña|password/i).fill(BIWENGER_PASSWORD, { timeout: 5000 }); } catch {}

  // Enviar
  const submitButtons = [
    page.getByRole('button', { name: /iniciar sesión|entrar/i }),
    page.locator('button:has-text("Entrar")').first()
  ];
  for (const btn of submitButtons) {
    try { await btn.click({ timeout: 4000 }); break; } catch {}
  }

  await page.waitForLoadState('networkidle', { timeout: 15000 });

  // 2) Equipo
  // Vamos a la liga y a la vista de equipo
  try {
    await page.goto(`https://biwenger.as.com/app/#/league/${LIGA_ID}/team`, { waitUntil: 'load' });
  } catch {}
  await page.waitForTimeout(1500);

  const equipo = await page.evaluate(() => {
    const out = [];
    // Buscamos posibles contenedores de jugadores
    const candidates = Array.from(document.querySelectorAll('[class*="player"], [class*="card"], [class*="lineup"], [class*="squad"]'));
    candidates.forEach(c => {
      const text = (c.innerText || '').trim();
      if (!text) return;
      const name = (text.match(/^[A-ZÁÉÍÓÚÑÜ][\wÁÉÍÓÚÑüÜ .'\-]{2,}/m) || [null])[0];
      const pos  = (text.match(/\b(POR|DEF|MED|DEL)\b/) || [null])[0];
      const team = (text.match(/\(([A-Z]{2,3})\)/) || [null,null])[1];
      const price = (text.match(/(\d[\d\.]*)(?:\s?€| M| M€)/i) || [null,null])[1];
      const status = (text.match(/(lesión|lesionado|duda|sanción|baja|ok|titular|doubt)/i) || [null])[0];
      if (name && pos) {
        out.push({
          name: name.trim(),
          position: pos,
          team: team || null,
          price: price ? Number(price.replace(/\./g,'')) : null,
          status: status ? status.toLowerCase() : null,
          source: 'equipo'
        });
      }
    });
    return out;
  });

  // 3) Mercado
  try {
    await page.goto(`https://biwenger.as.com/app/#/league/${LIGA_ID}/market`, { waitUntil: 'load' });
  } catch {}
  await page.waitForTimeout(1500);

  const mercado = await page.evaluate(() => {
    const out = [];
    const rows = document.querySelectorAll('table tr, [class*="market"] [class*="row"], [class*="market"] [class*="item"]');
    rows.forEach(r => {
      const text = (r.innerText || '').trim();
      if (!text) return;
      const name = (text.match(/^[A-ZÁÉÍÓÚÑÜ][\wÁÉÍÓÚÑüÜ .'\-]{2,}/m) || [null])[0];
      const pos  = (text.match(/\b(POR|DEF|MED|DEL)\b/) || [null])[0];
      const price = (text.match(/(\d[\d\.]*)(?:\s?€| M| M€)/i) || [null,null])[1];
      const trend = (text.match(/[\+\-]\d+%/) || [null])[0];
      if (name && pos) {
        out.push({
          name: name.trim(),
          position: pos,
          price: price ? Number(price.replace(/\./g,'')) : null,
          trend: trend || null,
          source: 'mercado'
        });
      }
    });
    return out;
  });

  // 4) Saldo (best-effort)
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
    team: equipo,
    market: mercado
  };

  const outPath = PUBLIC_OUT_PATH || './public/data.json';
  fs.mkdirSync(outPath.split('/').slice(0,-1).join('/'), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
  await browser.close();
}

scrape().catch(e => { console.error(e); process.exit(1); });
