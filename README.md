# 📊 Biwenger Scraper & Dashboard

Este proyecto automatiza la extracción de datos de **Biwenger** (tu equipo y el mercado) usando [Playwright](https://playwright.dev/) y los publica en GitHub Pages.

---

## 🚀 ¿Qué hace?

1. **Inicia sesión** en Biwenger (idioma forzado a español).
2. **Captura datos** de:
   - Tu **equipo** (`/team`)
   - El **mercado** (`/market`)
   - **Saldo disponible**
3. Guarda:
   - `data.json` con toda la información estructurada.
   - Capturas de pantalla (`public/*.png`) para depuración.
4. Publica todo en **GitHub Pages** (rama `gh-pages`).

---

## 📂 Estructura de ramas

- **[main](https://github.com/andresmoli/Biwenger/tree/main)** → Código fuente y workflow.
  - [`src/run.js`](https://github.com/andresmoli/Biwenger/blob/main/src/run.js) → Script principal de Playwright.
  - `.github/workflows/` → Workflow de GitHub Actions.

- **[gh-pages](https://github.com/andresmoli/Biwenger/tree/gh-pages)** → Resultados publicados.
  - [`data.json`](https://raw.githubusercontent.com/andresmoli/Biwenger/gh-pages/data.json) → Datos estructurados (equipo + mercado + saldo).
  - [`99-ok.png`](https://andresmoli.github.io/Biwenger/99-ok.png) → Captura final de la ejecución.
  - [`equipo.png`](https://andresmoli.github.io/Biwenger/equipo.png) → Imagen completa de tu plantilla.

---

## 🌍 Acceso rápido a los resultados

- **JSON en crudo:**  
  [`data.json`](https://raw.githubusercontent.com/andresmoli/Biwenger/gh-pages/data.json)

- **Dashboard visual (GitHub Pages):**  
  [andresmoli.github.io/Biwenger](https://andresmoli.github.io/Biwenger/)

- **Capturas:**  
  - [99-ok.png](https://andresmoli.github.io/Biwenger/99-ok.png)  
  - [equipo.png](https://andresmoli.github.io/Biwenger/equipo.png)

---

## ⚙️ Variables necesarias

Configura en **Settings → Secrets and variables → Actions**:

| Variable             | Descripción                        |
|----------------------|------------------------------------|
| `BIWENGER_EMAIL`     | Email de tu cuenta Biwenger        |
| `BIWENGER_PASSWORD`  | Contraseña de tu cuenta            |
| `LIGA_ID`            | ID de tu liga (en la URL de la liga) |

---

## 📸 Ejemplo de salida

![Equipo](https://andresmoli.github.io/Biwenger/equipo.png)

---

✏️ **Autor:** [@andresmoli](https://github.com/andresmoli)  
💡 **Automatizado con:** GitHub Actions + Playwright
