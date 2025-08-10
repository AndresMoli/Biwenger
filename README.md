
# Biwenger Scraper (Playwright) + GitHub Pages

Extrae automáticamente tu **plantilla** y **mercado** de Biwenger y publica un **JSON público** para que tu analista (yo 😉) lo lea sin que tengas que pasar nada.

## ¿Qué hace?
- Inicia sesión en Biwenger con Playwright.
- Visita tu **equipo** y el **mercado** de tu liga.
- Extrae jugadores (nombre, posición, precio, estado) y tu **saldo** (si es detectable).
- Genera `public/data.json` y lo publica en **GitHub Pages** (branch `gh-pages`).

## Requisitos
- Cuenta de GitHub.
- Crear **Secrets** en el repositorio:
  - `BIWENGER_EMAIL`
  - `BIWENGER_PASSWORD`
  - `LIGA_ID` (el ID numérico de tu liga, p. ej. `123456`).

> **Aviso:** Biwenger no tiene API pública y puede cambiar su interfaz. Este scraper usa selectores "elásticos". Si cambia mucho, habrá que ajustar los selectores.

## Pasos de instalación (rápidos)
1. Crea un repositorio vacío en GitHub (público o privado).
2. Sube estos archivos al repositorio (o arrastra el ZIP entero).
3. Ve a **Settings → Secrets and variables → Actions → New repository secret** y añade:
   - `BIWENGER_EMAIL` = tu email de Biwenger
   - `BIWENGER_PASSWORD` = tu contraseña
   - `LIGA_ID` = el ID de tu liga
4. Activa **Pages**:
   - En **Settings → Pages**, elige **Deploy from a branch**.
   - **Branch:** `gh-pages` / **folder:** `/ (root)`.
5. Lanza el workflow manualmente la primera vez:
   - Pestaña **Actions → Scrape Biwenger → Run workflow**.
6. En cuanto termine, tu JSON estará en:
   - `https://TU_USUARIO.github.io/TU_REPO/data.json`

## Uso
Cada día a las **07:00 (hora España)** el workflow correrá solo (cron `05:00 UTC`). Yo podré leer esa URL y preparar tu **informe de jornada** sin que me pases nada.

## Estructura del JSON
```json
{
  "scrapedAt": "2025-08-10T05:00:00.000Z",
  "leagueId": "123456",
  "balance": 5340000,
  "team": [ { "name": "...", "position": "DEF", "team": "RMA", "price": 4500000, "status": "ok" } ],
  "market": [ { "name": "...", "position": "MED", "price": 3200000, "trend": "+3%" } ]
}
```

## Notas
- Si tu equipo/mercado no cargan por cookies/popup, prueba lanzar el workflow manualmente y revisa el log.
- Ajusta el cron en `.github/workflows/scrape.yml` si quieres otra hora.
- Puedes ampliar el scraper con más campos (rival próxima jornada, % titularidad, etc.) si se ven en tu liga.
