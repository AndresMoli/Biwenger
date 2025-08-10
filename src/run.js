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

  console.log("➡️ Abriendo Biwenger...");
  await page.goto('https://biwenger.as.com/', { waitUntil: 'networkidle' });

  console.log("➡️ Iniciando sesión...");
  try {
    await page.getByRole('button', { name: /iniciar sesión|entrar/i }).click({ timeout: 5000 });
  } catch {
    console.log("⚠️ Botón de login no encontrado, intentando localizador alternativo");
    await page.locator('text=/Iniciar sesión|Entrar/i').first().click({ timeout: 5000 });
  }

  await page.getByPlaceholder(/email/i).fill(BIWENGER_EMAIL);
  await page.getByPlaceholder(/contraseña|password/i).fill(BIWENGER_PASSWORD);

  try {
    await page.getByRole('button', { name: /iniciar sesión|entrar/i }).click();
  } catch {
    await page.locator('button:has-text("Entrar")').click();
  }

  await page.waitForLoadState('networkidle');

  console.log("➡️ Abriendo liga...");
  // Ir a la página principal de ligas
  await page.goto(`https://biwenger.as.com/app/#/league/${LIGA_ID}`, { waitUntil: 'networkidle' });

  console.log("➡️ Entrando en Equipo...");
  await page.click('a[href*="team"], text=Equipo', { timeout: 10000 });
  await page.waitForSelector('[class*="player"], [class*="card"], [class*="lineup"]', { timeout: 15000 });

  const equipo = await page.evaluate(() => {
    const out = [];
    const cards = document.querySelectorAll('[class*="player"], [class*="card"], [class*="lineup"]');
    cards.forEach(c => {
      const text = c.innerText || '';
      const name = (text.match(/^[A-ZÁÉÍÓÚÑÜ][\wÁÉÍÓÚÑüÜ .'-]{2,}/m) || [null])[0];
      const pos  = (text.match(/\b(POR|DEF|MED|DEL)\b/) || [null])[0];
      const team = (text.match(/\b\([A-Z]{2,3}\)\b/) || [null])[0]?.replace(/[()]/g,'');
      const price = (text.match(/(\d[\d\.]*)(?:[ ]?€| M| M€)/i) || [null])[1];
      const status = (text.match(/(lesión|lesionado|duda|sanción|baja|ok|titular)/i) || [null])[0];
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

  console.log(`✅ Equipo extraído: ${equipo.length} jugadores`);

  console.log("➡️ Entrando en Mercado...");
  await page.click('a[href*="market"], text=Mercado', { timeout: 10000 });
  await page.waitForSelector('table tr, [class*="market"] [class*="row"], [class*="market"] [class*="item"]', { timeout: 15000 });

  const mercado = await page.evaluate(() => {
    const out = [];
    const rows = document.querySelectorAll('table tr, [class*="market"] [class*="row"], [class*="market"] [class*="item"]');
    rows.forEach(r => {
      const text = r.innerText || '';
      const name = (text.match(/^[A-ZÁÉÍÓÚÑÜ][\wÁÉÍÓÚÑüÜ .'-]{2,}/m) || [null])[0];
      const pos  = (text.match(/\b(POR|DEF|MED|DEL)\b/) || [null])[0];
      const price = (text.match(/(\d[\d\.]*)(?:[ ]?€| M| M€)/i) || [null])[1];
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

  console.log(`✅ Mercado extraído: ${mercado.length} jugadores`);

  // Saldo
  let saldo = null;
  try {
    const allText = await page.locator('body').innerText();
    const n = (allText.match(/(?:Saldo|Presupuesto|€)\s*([\d\.]+)/i) || [null,null])[1];
    saldo = n ? Number(n.replace(/\./g,'')) : null;
  } catch {}

  // Guardar JSON
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
  console.log(`💾 Guardado en ${outPath}`);

  await browser.close();
}

scrape().catch(e => { 
  console.error("❌ Error en scraping:", e);
  process.exit(1); 
});