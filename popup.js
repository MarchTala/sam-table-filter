// SAM Table Filter — popup

const $ = (id) => document.getElementById(id);

const SAM_URL = "https://members.trulyrichclub.com/member/recommendations/sam";

const state = {
  items: [],
  lastUpdated: "",
  scrapedAt: null,
  needsLogin: false,
  source: null, // "live" | "cache"
  activeActions: new Set(), // empty = all
  category: "all",
  search: "",
  sort: "default",
};

function actionClass(action) {
  const a = (action || "").toLowerCase();
  if (a.includes("continue")) return "buy";
  if (a.includes("stop")) return "stop";
  if (a.includes("hold")) return "hold";
  if (a.includes("slice")) return "slice";
  return "other";
}

// Short chip labels so all action filters fit on one line
function actionShort(action) {
  const cls = actionClass(action);
  return { buy: "Buy", stop: "Stop", hold: "Hold", slice: "Slice" }[cls] || action;
}

function fmt(n, digits = 2) {
  if (n == null) return "—";
  return n.toLocaleString("en-PH", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

// ---------- data ----------

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function askContentScript(tabId) {
  return chrome.tabs.sendMessage(tabId, { type: "SAM_SCRAPE" });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Fetch the SAM page directly using the browser's logged-in session cookie.
// Works from any tab — no need to have the site open.
async function fetchDirect() {
  const res = await fetch(SAM_URL, { credentials: "include", cache: "no-store" });
  if (!res.ok) return { status: "error" };
  const doc = new DOMParser().parseFromString(await res.text(), "text/html");
  const items = SamParser.parseTables(doc);
  if (items.length) {
    return {
      status: "ok",
      data: { ok: true, items, lastUpdated: SamParser.findLastUpdated(doc), scrapedAt: Date.now() },
    };
  }
  // No tables in the raw HTML. Logged out — or the page renders its tables with JavaScript.
  const loggedOut = /login|signin/i.test(res.url) || doc.querySelector('input[type="password"]');
  return { status: loggedOut ? "login" : "empty" };
}

function waitForTabComplete(tabId, timeoutMs) {
  return new Promise((resolve) => {
    const timer = setTimeout(done, timeoutMs);
    function done() {
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      resolve();
    }
    function onUpdated(id, info) {
      if (id === tabId && info.status === "complete") done();
    }
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.get(tabId).then((t) => { if (t.status === "complete") done(); }).catch(done);
  });
}

// Last resort for JS-rendered pages: load the SAM page in a background tab,
// let its scripts build the tables, scrape, then close the tab.
async function tabScrape() {
  let tab;
  try {
    tab = await chrome.tabs.create({ url: SAM_URL, active: false });
    await waitForTabComplete(tab.id, 20000);
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["parser.js", "content.js"] });
    for (let tries = 0; tries < 10; tries++) {
      const res = await askContentScript(tab.id).catch(() => null);
      if (res?.ok && res.items?.length) return res;
      await sleep(500); // tables may still be building
    }
    const t = await chrome.tabs.get(tab.id).catch(() => null);
    if (t && /login|signin/i.test(t.url || "")) state.needsLogin = true;
    return null;
  } catch {
    return null;
  } finally {
    if (tab?.id != null) chrome.tabs.remove(tab.id).catch(() => {});
  }
}

async function scrape() {
  state.needsLogin = false;
  const tab = await getActiveTab();
  const onSite = tab?.url && tab.url.includes("members.trulyrichclub.com");

  if (onSite) {
    try {
      const res = await askContentScript(tab.id);
      if (res?.ok && res.items?.length) return saveAndUse(res);
    } catch {
      // content script not injected yet (e.g. page loaded before install) — inject and retry
      try {
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["parser.js", "content.js"] });
        const res = await askContentScript(tab.id);
        if (res?.ok && res.items?.length) return saveAndUse(res);
      } catch { /* fall through */ }
    }
  }

  try {
    const r = await fetchDirect();
    if (r.status === "ok") return saveAndUse(r.data);
    if (r.status === "login") {
      state.needsLogin = true;
    } else {
      // "empty" or "error": page is JS-rendered or fetch was blocked — try a background tab
      const res = await tabScrape();
      if (res) return saveAndUse(res);
    }
  } catch { /* offline or permission not granted — fall through to cache */ }

  const { samData } = await chrome.storage.local.get("samData");
  if (samData?.items?.length) {
    state.items = samData.items;
    state.lastUpdated = samData.lastUpdated || "";
    state.scrapedAt = samData.scrapedAt || null;
    state.source = "cache";
    return true;
  }
  return false;
}

function saveAndUse(res) {
  state.items = res.items;
  state.lastUpdated = res.lastUpdated || "";
  state.scrapedAt = res.scrapedAt || Date.now();
  state.source = "live";
  chrome.storage.local.set({ samData: res });
  return true;
}

// ---------- filtering ----------

function filtered() {
  let out = state.items.slice();

  if (state.activeActions.size) {
    out = out.filter((it) => state.activeActions.has(it.action));
  }
  if (state.category !== "all") {
    out = out.filter((it) => it.category === state.category);
  }
  if (state.search.trim()) {
    const q = state.search.trim().toLowerCase();
    out = out.filter(
      (it) =>
        it.code.toLowerCase().includes(q) ||
        (it.name || "").toLowerCase().includes(q) ||
        (it.action || "").toLowerCase().includes(q)
    );
  }

  const by = (key, dir) =>
    out.sort((a, b) => {
      const av = a[key], bv = b[key];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return dir * (av - bv);
    });

  if (state.sort === "growth") by("growth", -1);
  else if (state.sort === "dividend") by("dividend", -1);
  else if (state.sort === "fromTarget") by("fromTarget", 1);
  else if (state.sort === "code") out.sort((a, b) => a.code.localeCompare(b.code));

  return out;
}

// ---------- rendering ----------

function renderMeta() {
  const parts = [];
  if (state.lastUpdated) parts.push(`Updated ${state.lastUpdated}`);
  if (state.scrapedAt)
    parts.push(`read ${new Date(state.scrapedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`);
  $("meta").textContent = parts.join(" · ");
}

function renderStale() {
  const note = $("staleNote");
  if (state.source !== "cache" || !state.items.length) {
    note.hidden = true;
    return;
  }
  const when = state.scrapedAt
    ? ` from ${new Date(state.scrapedAt).toLocaleString()}`
    : "";
  note.innerHTML = state.needsLogin
    ? `⚠️ Cached data${when} — you're logged out. ` +
      `<a href="${SAM_URL}" target="_blank" rel="noopener">Log in ↗</a> then hit Refresh.`
    : `⚠️ Cached data${when} — couldn't fetch fresh data. ` +
      `<a href="${SAM_URL}" target="_blank" rel="noopener">Open the SAM page ↗</a> and hit Refresh there.`;
  note.hidden = false;
}

function renderControls() {
  // action chips with counts
  const counts = new Map();
  state.items.forEach((it) => counts.set(it.action, (counts.get(it.action) || 0) + 1));

  const order = ["buy", "hold", "slice", "stop", "other"];
  const actions = [...counts.keys()].sort(
    (a, b) => order.indexOf(actionClass(a)) - order.indexOf(actionClass(b))
  );

  const chips = $("actionChips");
  chips.innerHTML = "";
  actions.forEach((action) => {
    const btn = document.createElement("button");
    btn.className = `chip ${actionClass(action)}`;
    btn.setAttribute("aria-pressed", state.activeActions.has(action) ? "true" : "false");
    btn.title = action;
    btn.innerHTML = `${actionShort(action)} <span class="count">${counts.get(action)}</span>`;
    btn.addEventListener("click", () => {
      state.activeActions.has(action)
        ? state.activeActions.delete(action)
        : state.activeActions.add(action);
      renderControls();
      renderList();
    });
    chips.appendChild(btn);
  });

  // categories
  const sel = $("categorySel");
  const current = state.category;
  sel.innerHTML = '<option value="all">All categories</option>';
  [...new Set(state.items.map((it) => it.category))].forEach((c) => {
    const opt = document.createElement("option");
    opt.value = c;
    opt.textContent = c;
    sel.appendChild(opt);
  });
  sel.value = [...sel.options].some((o) => o.value === current) ? current : "all";
}

function renderList() {
  const list = $("list");
  const empty = $("empty");
  const items = filtered();

  list.innerHTML = "";
  if (!items.length) {
    empty.hidden = false;
    $("emptyMsg").textContent = state.items.length
      ? "No entries match the current filters."
      : state.needsLogin
        ? "Your trulyrichclub.com session has expired. Log in once, then click Refresh."
        : "Open the SAM Table page, then click Refresh.";
    return;
  }
  empty.hidden = true;

  let lastCat = null;
  const grouping = state.sort === "default";

  items.forEach((it) => {
    if (grouping && it.category !== lastCat) {
      lastCat = it.category;
      const cat = document.createElement("div");
      cat.className = "cat";
      cat.textContent = it.category;
      list.appendChild(cat);
    }

    const row = document.createElement("div");
    row.className = "item";

    const head = document.createElement("div");
    head.className = "head";
    const code = document.createElement("span");
    code.className = "code";
    code.textContent = it.code;
    head.appendChild(code);
    if (it.name || !grouping) {
      const name = document.createElement("span");
      name.className = "name";
      name.textContent = it.name || it.category;
      head.appendChild(name);
    }

    const badge = document.createElement("span");
    badge.className = `badge ${actionClass(it.action)}`;
    badge.textContent = it.action;

    row.appendChild(head);
    row.appendChild(badge);

    if (it.current != null) {
      const nums = document.createElement("div");
      nums.className = "nums";
      const growthCls = it.growth != null && it.growth < 0 ? "down" : "up";
      const ftCls = it.fromTarget != null && it.fromTarget > 0 ? "down" : "up";
      const stat = (label, value, cls = "") =>
        `<span class="stat"><i>${label}</i><b class="${cls}">${value}</b></span>`;
      nums.innerHTML =
        stat("Now", fmt(it.current)) +
        stat("Buy", fmt(it.buyBelow)) +
        stat("Target", fmt(it.target)) +
        stat("Growth", `${fmt(it.growth)}%`, growthCls) +
        stat("Div", `${fmt(it.dividend, 1)}%`) +
        stat("vs Tgt", `${fmt(it.fromTarget)}%`, ftCls);
      row.appendChild(nums);
    }

    list.appendChild(row);
  });
}

// ---------- CSV export ----------

function exportCsv() {
  const items = filtered();
  const cols = ["category", "code", "name", "current", "buyBelow", "target", "growth", "maxPct", "dividend", "fromTarget", "action"];
  const headers = ["Category", "Code", "Name", "Current Price", "Buy Below", "Target Price", "Expected Growth %", "Max %", "Dividend Yield %", "% From Target", "Action"];
  const esc = (v) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const csv = [headers.join(",")]
    .concat(items.map((it) => cols.map((c) => esc(it[c])).join(",")))
    .join("\n");

  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `sam-table-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ---------- init ----------

async function init() {
  $("search").addEventListener("input", (e) => { state.search = e.target.value; renderList(); });
  $("categorySel").addEventListener("change", (e) => { state.category = e.target.value; renderList(); });
  $("sortSel").addEventListener("change", (e) => { state.sort = e.target.value; renderList(); });
  $("exportBtn").addEventListener("click", exportCsv);
  $("refreshBtn").addEventListener("click", async () => {
    const btn = $("refreshBtn");
    if (btn.disabled) return;
    btn.disabled = true;
    btn.innerHTML = '<span class="spin"></span>Refreshing…';

    // keep the spinner visible for at least half a second so fast fetches still register
    await Promise.all([scrape(), new Promise((r) => setTimeout(r, 500))]);

    renderMeta();
    renderControls();
    renderList();
    renderStale();

    if (state.source === "live") {
      btn.textContent = "Updated ✓";
      btn.classList.add("ok");
      setTimeout(() => {
        btn.textContent = "Refresh";
        btn.classList.remove("ok");
        btn.disabled = false;
      }, 1200);
    } else {
      btn.textContent = "Refresh";
      btn.disabled = false;
    }
  });

  await scrape();
  renderMeta();
  renderControls();
  renderList();
  renderStale();
}

init();
