// SAM Table Filter — shared parsing
// Used by content.js (live page) and popup.js (HTML fetched with the session cookie).

(() => {
  function num(v) {
    if (v == null) return null;
    const n = parseFloat(String(v).replace(/,/g, "").replace(/%/g, "").trim());
    return Number.isFinite(n) ? n : null;
  }

  // Find the nearest heading-like element above a table => category name
  function categoryFor(table, doc) {
    let el = table;
    while (el && el !== doc.body) {
      let sib = el.previousElementSibling;
      while (sib) {
        if (/^H[1-6]$/.test(sib.tagName)) {
          const t = sib.textContent.trim();
          if (t) return t;
        }
        const heads = sib.querySelectorAll ? sib.querySelectorAll("h1,h2,h3,h4,h5,h6") : [];
        if (heads.length) {
          const t = heads[heads.length - 1].textContent.trim();
          if (t) return t;
        }
        // Some sites use bold/strong section titles instead of headings
        if (
          sib.matches &&
          sib.matches("p,div,span,strong,b") &&
          sib.textContent.trim().length > 0 &&
          sib.textContent.trim().length < 60 &&
          !sib.querySelector("table")
        ) {
          const t = sib.textContent.trim();
          if (/stocks|reit|fund|bond|boss|dividend|mature|growth/i.test(t)) return t;
        }
        sib = sib.previousElementSibling;
      }
      el = el.parentElement;
    }
    return "Uncategorized";
  }

  function headerMap(headers) {
    const map = {};
    headers.forEach((h, i) => {
      const k = h.toLowerCase().trim();
      if (map.code === undefined && /^(stocks?|code)$/.test(k)) map.code = i;
      else if (/fund name|^name$/.test(k)) map.name = i;
      else if (/current price/.test(k)) map.current = i;
      else if (/buy below/.test(k)) map.buyBelow = i;
      else if (/^target price/.test(k)) map.target = i;
      else if (/expected growth/.test(k)) map.growth = i;
      else if (/max/.test(k)) map.maxPct = i;
      else if (/dividend/.test(k)) map.dividend = i;
      else if (/from target/.test(k)) map.fromTarget = i;
      else if (/action/.test(k)) map.action = i;
    });
    return map;
  }

  function parseTables(doc) {
    const items = [];
    doc.querySelectorAll("table").forEach((table) => {
      let headers = [...table.querySelectorAll("thead th, thead td")].map((c) =>
        c.textContent.trim()
      );
      let rows = [...table.querySelectorAll("tbody tr")];

      if (!headers.length) {
        const all = [...table.querySelectorAll("tr")];
        if (!all.length) return;
        headers = [...all[0].children].map((c) => c.textContent.trim());
        rows = all.slice(1);
      }

      const map = headerMap(headers);
      if (map.action === undefined || map.code === undefined) return; // not a SAM table

      const category = categoryFor(table, doc);

      rows.forEach((tr) => {
        const cells = [...tr.children].map((c) => c.textContent.trim());
        if (!cells.length || !cells[map.code]) return;
        // Skip repeated header rows inside tbody
        if (/^(stocks?|code)$/i.test(cells[map.code])) return;

        items.push({
          category,
          code: cells[map.code] || "",
          name: map.name !== undefined ? cells[map.name] || "" : "",
          current: map.current !== undefined ? num(cells[map.current]) : null,
          buyBelow: map.buyBelow !== undefined ? num(cells[map.buyBelow]) : null,
          target: map.target !== undefined ? num(cells[map.target]) : null,
          growth: map.growth !== undefined ? num(cells[map.growth]) : null,
          maxPct: map.maxPct !== undefined ? num(cells[map.maxPct]) : null,
          dividend: map.dividend !== undefined ? num(cells[map.dividend]) : null,
          fromTarget: map.fromTarget !== undefined ? num(cells[map.fromTarget]) : null,
          action: map.action !== undefined ? cells[map.action] || "" : "",
        });
      });
    });
    return items;
  }

  function findLastUpdated(doc) {
    // innerText needs layout; DOMParser documents only have textContent
    const text = doc.body ? doc.body.innerText || doc.body.textContent || "" : "";
    const m = text.match(/Last Updated:?\s*([^\n]+)/i);
    return m ? m[1].trim() : "";
  }

  globalThis.SamParser = { parseTables, findLastUpdated };
})();