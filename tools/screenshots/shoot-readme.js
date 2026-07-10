// Regenerates the README screenshots (assets/screenshot-*.png).
//
// Loads the real popup with chrome.* stubbed and mock data (chrome-stub.js),
// captures dashboard / favorites / settings / open-dropdowns in light and
// dark at 2x, composites each pair into a diagonal half-light/half-dark
// framed image, and writes the results into ../../assets/.
//
// Usage:  npm install && npx playwright install chromium && npm run shoot
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

const ROOT = path.resolve(__dirname, "..", "..");
const OUT = path.join(__dirname, "out");
fs.mkdirSync(OUT, { recursive: true });

// Test page = real popup.html, with sources pointed at the repo root and the
// chrome stub injected before any extension script runs.
const TEST_PAGE = path.join(__dirname, "popup-test.html");
const html = fs
  .readFileSync(path.join(ROOT, "popup.html"), "utf8")
  .replace('href="popup.css"', 'href="../../popup.css"')
  .replace('<script src="parser.js">', '<script src="chrome-stub.js"></script><script src="../../parser.js">')
  .replace('<script src="popup.js">', '<script src="../../popup.js">');
fs.writeFileSync(TEST_PAGE, html);

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 460, height: 600 }, deviceScaleFactor: 2 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("file://" + TEST_PAGE);
  await page.waitForTimeout(900);

  // seed favorites, then suppress the toast
  await page.evaluate(() => { ["ALI", "TEL", "AREIT"].forEach((c) => toggleFavorite(c)); });
  await page.waitForTimeout(150);
  const hideToast = () => page.evaluate(() => { document.getElementById("toast").hidden = true; });
  await hideToast();

  const shot = (name) => page.screenshot({ path: path.join(OUT, name + ".png") });
  const nav = async (v) => { await page.locator(`[data-nav="${v}"]`).click(); await page.waitForTimeout(300); await hideToast(); };

  // LIGHT set (select Light explicitly so the settings segmented control reads right)
  await nav("settings");
  await page.locator('[data-theme-opt="light"]').click();
  await page.waitForTimeout(250);
  await nav("dashboard"); await shot("dash-light");
  await nav("favorites"); await shot("fav-light");
  await nav("settings"); await shot("settings-light");

  // DARK set
  await page.locator('[data-theme-opt="dark"]').click();
  await page.waitForTimeout(250);
  await shot("settings-dark");
  await nav("dashboard"); await shot("dash-dark");
  await nav("favorites"); await shot("fav-dark");

  // Dropdown showcase: native <select> popups aren't capturable, so inject
  // design-matched menu panels (built from the extension's own CSS tokens)
  // under both selects.
  await nav("dashboard");
  await page.evaluate(() => {
    const controls = document.querySelector(".controls");
    const check = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';
    function openMenu(selId, options, activeIdx) {
      const wrap = document.getElementById(selId).closest(".selectwrap");
      wrap.querySelector("select").style.borderColor = "var(--accent)";
      const cr = controls.getBoundingClientRect();
      const wr = wrap.getBoundingClientRect();
      const menu = document.createElement("div");
      menu.style.cssText =
        `position:absolute; z-index:50; left:${wr.left - cr.left}px; top:${wr.bottom - cr.top + 6}px;` +
        `min-width:${wr.width}px; background:var(--card); border:1px solid var(--line);` +
        `border-radius:12px; box-shadow:var(--shadow-3); padding:4px;`;
      options.forEach((label, i) => {
        const row = document.createElement("div");
        const active = i === activeIdx;
        row.style.cssText =
          "display:flex; align-items:center; justify-content:space-between; gap:10px;" +
          "padding:7px 10px; border-radius:8px; font-size:12px; white-space:nowrap;" +
          (active
            ? "background:var(--accent-soft); color:var(--accent-ink); font-weight:600;"
            : "color:var(--ink);");
        row.innerHTML = `<span></span>${active ? check : ""}`;
        row.firstChild.textContent = label;
        menu.appendChild(row);
      });
      controls.appendChild(menu);
    }
    const cats = [...document.getElementById("categorySel").options].map((o) => o.textContent);
    openMenu("categorySel", cats, 0);
    openMenu("sortSel", ["Page order", "Growth ↓", "Dividend ↓", "Below target", "Code A–Z"], 0);
  });
  await page.waitForTimeout(200);
  await shot("filters-dark"); // still in dark from the settings step
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
  await page.waitForTimeout(250);
  await shot("filters-light");

  // ---- composite: diagonal half-light/half-dark on a framed gradient ----
  const compose = async (lightImg, darkImg, outName) => {
    const pageHtml = `<!DOCTYPE html><html><head><style>
      * { margin:0; padding:0; box-sizing:border-box; }
      .frame {
        display:inline-block;
        padding:44px;
        background: linear-gradient(135deg, #dbeafe 0%, #e0e7ff 45%, #ede9fe 100%);
      }
      .stack {
        position:relative;
        width:460px; height:600px;
        border-radius:18px;
        overflow:hidden;
        box-shadow: 0 10px 24px rgba(15,23,42,.18), 0 30px 70px rgba(15,23,42,.28);
      }
      .stack img { position:absolute; inset:0; width:460px; height:600px; }
      .stack img.dark { clip-path: polygon(62% 0, 100% 0, 100% 100%, 38% 100%); }
      .seam {
        position:absolute; inset:0;
        clip-path: polygon(61.8% 0, 62.2% 0, 38.2% 100%, 37.8% 100%);
        background: rgba(255,255,255,.85);
      }
    </style></head><body>
      <div class="frame" id="frame">
        <div class="stack">
          <img src="${lightImg}.png">
          <img class="dark" src="${darkImg}.png">
          <div class="seam"></div>
        </div>
      </div>
    </body></html>`;
    const f = path.join(OUT, outName + ".html");
    fs.writeFileSync(f, pageHtml);
    const p2 = await browser.newPage({ deviceScaleFactor: 2 });
    await p2.goto("file://" + f);
    await p2.waitForTimeout(300);
    await p2.locator("#frame").screenshot({ path: path.join(OUT, outName + ".png") });
    await p2.close();
  };

  await compose("dash-light", "dash-dark", "readme-dashboard");
  await compose("fav-light", "fav-dark", "readme-favorites");
  await compose("settings-light", "settings-dark", "readme-settings");
  await compose("filters-light", "filters-dark", "readme-filters");

  await browser.close();

  // publish into assets/
  const ASSETS = path.join(ROOT, "assets");
  const MAP = {
    "readme-dashboard.png": "screenshot-dashboard.png",
    "readme-favorites.png": "screenshot-favorites.png",
    "readme-settings.png": "screenshot-settings.png",
    "readme-filters.png": "screenshot-filters.png",
  };
  for (const [src, dest] of Object.entries(MAP)) {
    fs.copyFileSync(path.join(OUT, src), path.join(ASSETS, dest));
    console.log("wrote assets/" + dest);
  }

  if (errors.length) {
    console.error("PAGE ERRORS:\n" + errors.join("\n"));
    process.exit(1);
  }
  console.log("Done — no page errors.");
})();