# README screenshot harness

Regenerates the four split-theme screenshots in `assets/` (`screenshot-dashboard.png`, `screenshot-favorites.png`, `screenshot-settings.png`, `screenshot-filters.png`) whenever the popup UI changes.

## How it works

- `chrome-stub.js` fakes the `chrome.*` extension APIs and feeds the popup **mock data** (invented tickers and figures — never real SAM Table content), so no login is needed and nothing sensitive can end up in a screenshot.
- `shoot-readme.js` loads the real `popup.html`/`popup.css`/`popup.js` from the repo root in headless Chromium via Playwright, stars a few stocks, walks through Dashboard / Favorites / Settings in both themes, injects design-matched open-dropdown panels (native `<select>` popups can't be screenshotted), captures everything at 2×, composites each light/dark pair into a diagonal split on a framed gradient, and writes the results straight into `assets/`.

## Usage

```sh
cd tools/screenshots
npm install
npx playwright install chromium   # first run only
npm run shoot
```

Then review the updated images in `assets/` and commit them.

This folder is a maintainer tool only — it is not part of the extension and is excluded from the distributable zip.