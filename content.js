// SAM Table Filter — content script
// Answers scrape requests from the popup using the shared parser (parser.js).

(() => {
  if (window.__samTableFilterLoaded) return;
  window.__samTableFilterLoaded = true;

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg && msg.type === "SAM_SCRAPE") {
      try {
        sendResponse({
          ok: true,
          items: SamParser.parseTables(document),
          lastUpdated: SamParser.findLastUpdated(document),
          url: location.href,
          scrapedAt: Date.now(),
        });
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    }
    return true;
  });
})();