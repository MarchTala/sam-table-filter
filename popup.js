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
  view: "dashboard", // "dashboard" | "favorites" | "settings"
  detailCode: null,
  favorites: new Set(),
  settings: { theme: "system", density: "comfortable" },
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

const ACTION_ICON = { buy: "i-trend-up", stop: "i-stop", hold: "i-hold", slice: "i-slice", other: "i-dot" };

function icon(id, cls = "i") {
  return `<svg class="${cls}" aria-hidden="true"><use href="#${id}"/></svg>`;
}

function fmt(n, digits = 2) {
  if (n == null) return "—";
  return n.toLocaleString("en-PH", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

// ---------- theme & settings ----------

function applySettings() {
  const root = document.documentElement;
  if (state.settings.theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", state.settings.theme);
  root.setAttribute("data-density", state.settings.density);

  document.querySelectorAll("#themeSeg [data-theme-opt]").forEach((b) =>
    b.setAttribute("aria-checked", b.dataset.themeOpt === state.settings.theme ? "true" : "false")
  );
  document.querySelectorAll("#densitySeg [data-density-opt]").forEach((b) =>
    b.setAttribute("aria-checked", b.dataset.densityOpt === state.settings.density ? "true" : "false")
  );
}

async function loadPrefs() {
  const { samPrefs, samFavorites } = await chrome.storage.local.get(["samPrefs", "samFavorites"]);
  if (samPrefs) Object.assign(state.settings, samPrefs);
  if (Array.isArray(samFavorites)) state.favorites = new Set(samFavorites);
  applySettings();
}

function savePrefs() {
  chrome.storage.local.set({ samPrefs: state.settings, samFavorites: [...state.favorites] });
}

// ---------- toast ----------

let toastTimer = null;
function showToast(msg, iconId = "i-check") {
  const t = $("toast");
  clearTimeout(toastTimer);
  t.classList.remove("hide");
  t.innerHTML = `${icon(iconId)}<span></span>`;
  t.lastElementChild.textContent = msg;
  t.hidden = false;
  toastTimer = setTimeout(() => {
    t.classList.add("hide");
    toastTimer = setTimeout(() => { t.hidden = true; t.classList.remove("hide"); }, 200);
  }, 1800);
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
  $("meta").textContent = parts.join(" · ") || " ";

  $("sourceHint").textContent = state.scrapedAt
    ? `${state.source === "live" ? "Live" : "Cached"} · read ${new Date(state.scrapedAt).toLocaleString()}`
    : "No data yet";
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
  $("staleMsg").innerHTML = state.needsLogin
    ? `Cached data${when} — you're logged out. ` +
      `<a href="${SAM_URL}" target="_blank" rel="noopener">Log in ↗</a> then refresh.`
    : `Cached data${when} — couldn't fetch fresh data. ` +
      `<a href="${SAM_URL}" target="_blank" rel="noopener">Open the SAM page ↗</a> and refresh there.`;
  note.hidden = false;
}

// Quick stats: total + the three most common action groups, click to filter
const STAT_DEFS = [
  { key: "all", label: "Stocks", icon: "i-layers", color: "var(--accent)", bg: "var(--accent-soft)" },
  { key: "buy", label: "Buy", icon: "i-trend-up", color: "var(--buy)", bg: "var(--buy-bg)" },
  { key: "hold", label: "Hold", icon: "i-hold", color: "var(--hold)", bg: "var(--hold-bg)" },
  { key: "stop", label: "Stop", icon: "i-stop", color: "var(--stop)", bg: "var(--stop-bg)" },
];

function actionsOfClass(cls) {
  return [...new Set(state.items.filter((it) => actionClass(it.action) === cls).map((it) => it.action))];
}

function statFilterActive(cls) {
  if (cls === "all") return state.activeActions.size === 0;
  const actions = actionsOfClass(cls);
  return actions.length > 0 &&
    state.activeActions.size === actions.length &&
    actions.every((a) => state.activeActions.has(a));
}

function renderStats() {
  const wrap = $("stats");
  wrap.innerHTML = "";
  STAT_DEFS.forEach((def) => {
    const count = def.key === "all"
      ? state.items.length
      : state.items.filter((it) => actionClass(it.action) === def.key).length;

    const btn = document.createElement("button");
    btn.className = "statcard";
    btn.style.setProperty("--sc", def.color);
    btn.style.setProperty("--scbg", def.bg);
    btn.setAttribute("aria-pressed", statFilterActive(def.key) ? "true" : "false");
    btn.title = def.key === "all" ? "Show all stocks" : `Filter: ${def.label}`;
    btn.innerHTML =
      `<span class="sc-top">${icon(def.icon)}<span class="sc-label">${def.label}</span></span>` +
      `<span class="sc-num">${count}</span>`;
    btn.addEventListener("click", () => {
      if (def.key === "all" || statFilterActive(def.key)) {
        state.activeActions.clear();
      } else {
        state.activeActions = new Set(actionsOfClass(def.key));
      }
      renderStats();
      renderControls();
      renderList();
    });
    wrap.appendChild(btn);
  });
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

  if (actions.length) {
    const all = document.createElement("button");
    all.className = "chip all";
    all.setAttribute("aria-pressed", state.activeActions.size === 0 ? "true" : "false");
    all.innerHTML = `${icon("i-layers")}All`;
    all.addEventListener("click", () => {
      state.activeActions.clear();
      renderStats();
      renderControls();
      renderList();
    });
    chips.appendChild(all);
  }

  actions.forEach((action) => {
    const cls = actionClass(action);
    const btn = document.createElement("button");
    btn.className = `chip ${cls}`;
    btn.setAttribute("aria-pressed", state.activeActions.has(action) ? "true" : "false");
    btn.title = action;
    btn.innerHTML = `${icon(ACTION_ICON[cls])}${actionShort(action)} <span class="count">${counts.get(action)}</span>`;
    btn.addEventListener("click", () => {
      state.activeActions.has(action)
        ? state.activeActions.delete(action)
        : state.activeActions.add(action);
      renderStats();
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

function buildCard(it, { showName = true } = {}) {
  const row = document.createElement("div");
  row.className = "item";
  row.tabIndex = 0;
  row.setAttribute("role", "button");
  row.setAttribute("aria-label", `${it.code} details`);

  const head = document.createElement("div");
  head.className = "head";
  const code = document.createElement("span");
  code.className = "code";
  code.textContent = it.code;
  head.appendChild(code);
  if (showName) {
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = it.name || it.category;
    head.appendChild(name);
  }

  const badge = document.createElement("span");
  badge.className = `badge ${actionClass(it.action)}`;
  badge.textContent = it.action;

  const star = document.createElement("button");
  star.className = "starbtn" + (state.favorites.has(it.code) ? " on" : "");
  star.setAttribute("aria-label", state.favorites.has(it.code) ? `Unfavorite ${it.code}` : `Favorite ${it.code}`);
  star.setAttribute("aria-pressed", state.favorites.has(it.code) ? "true" : "false");
  star.innerHTML = icon("i-star");
  star.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleFavorite(it.code);
  });

  row.appendChild(head);
  row.appendChild(badge);
  row.appendChild(star);

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

  const open = () => openDetail(it.code);
  row.addEventListener("click", open);
  row.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); }
  });

  return row;
}

function renderList() {
  const list = $("list");
  const empty = $("empty");
  const items = filtered();

  list.innerHTML = "";
  if (!items.length) {
    empty.hidden = false;
    $("emptyMsg").textContent = state.items.length
      ? "No recommendations match the current filters."
      : state.needsLogin
        ? "Your trulyrichclub.com session has expired. Log in once, then refresh."
        : "No recommendations found. Open the SAM Table page, then refresh.";
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
    list.appendChild(buildCard(it, { showName: !!it.name || !grouping }));
  });
}

function renderFavorites() {
  const list = $("favList");
  const empty = $("favEmpty");
  const items = state.items.filter((it) => state.favorites.has(it.code));

  list.innerHTML = "";
  empty.hidden = items.length > 0;
  items.forEach((it) => list.appendChild(buildCard(it)));

  const badge = $("favBadge");
  badge.hidden = state.favorites.size === 0;
  badge.textContent = state.favorites.size;
}

function toggleFavorite(code) {
  const adding = !state.favorites.has(code);
  adding ? state.favorites.add(code) : state.favorites.delete(code);
  savePrefs();
  renderFavorites();
  if (state.view === "dashboard") renderList();
  if (state.detailCode) renderDetailFav();
  showToast(adding ? `${code} added to favorites` : `${code} removed from favorites`, "i-star");
}

// ---------- skeleton ----------

function setSkeleton(on) {
  const skel = $("skeleton");
  if (on) {
    skel.innerHTML = Array.from({ length: 6 }, () =>
      `<div class="skel">
        <div class="top"><span class="bar w40"></span><span class="bar w25"></span></div>
        <div class="grid">${'<span class="bar"></span>'.repeat(6)}</div>
      </div>`
    ).join("");
    $("list").hidden = true;
    $("empty").hidden = true;
  } else {
    skel.innerHTML = "";
    $("list").hidden = false;
  }
  skel.hidden = !on;
}

// ---------- detail panel ----------

function renderDetailFav() {
  const btn = $("detailFav");
  const on = state.detailCode && state.favorites.has(state.detailCode);
  btn.classList.toggle("on", !!on);
  btn.setAttribute("aria-pressed", on ? "true" : "false");
}

function openDetail(code) {
  const it = state.items.find((x) => x.code === code);
  if (!it) return;
  state.detailCode = code;

  const growthCls = it.growth != null && it.growth < 0 ? "down" : "up";
  const ftCls = it.fromTarget != null && it.fromTarget > 0 ? "down" : "up";
  const cell = (label, value, cls = "") =>
    `<div class="d-cell"><i>${label}</i><b class="${cls}">${value}</b></div>`;

  const body = $("detailBody");
  body.innerHTML = `
    <section class="d-hero">
      <div class="d-head">
        <span class="d-code"></span>
        <span class="badge ${actionClass(it.action)}"></span>
      </div>
      <div class="d-name"></div>
      <span class="d-cat"></span>
      <div class="d-prices">
        <div class="d-price"><i>Current</i><b>${fmt(it.current)}</b></div>
        <div class="d-price"><i>Buy below</i><b>${fmt(it.buyBelow)}</b></div>
        <div class="d-price"><i>Target</i><b>${fmt(it.target)}</b></div>
      </div>
    </section>
    <div class="d-grid">
      ${cell("Expected growth", `${fmt(it.growth)}%`, growthCls)}
      ${cell("From target", `${fmt(it.fromTarget)}%`, ftCls)}
      ${cell("Dividend yield", `${fmt(it.dividend, 1)}%`)}
      ${cell("Max allocation", it.maxPct != null ? `${fmt(it.maxPct, 0)}%` : "—")}
    </div>
    <div class="d-actions">
      <button id="dCopy" class="btn ghost">${icon("i-copy")}Copy ticker</button>
      <a class="btn ghost" href="${SAM_URL}" target="_blank" rel="noopener">${icon("i-external")}SAM page</a>
    </div>
  `;
  // user-controlled strings go in via textContent
  body.querySelector(".d-code").textContent = it.code;
  body.querySelector(".badge").textContent = it.action;
  body.querySelector(".d-name").textContent = it.name || " ";
  body.querySelector(".d-cat").textContent = it.category || "";

  body.querySelector("#dCopy").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(it.code);
      showToast(`${it.code} copied to clipboard`);
    } catch {
      showToast("Couldn't copy", "i-alert");
    }
  });

  renderDetailFav();
  const panel = $("detail");
  panel.classList.remove("closing");
  panel.hidden = false;
  $("detailBack").focus();
}

function closeDetail() {
  const panel = $("detail");
  if (panel.hidden) return;
  state.detailCode = null;
  panel.classList.add("closing");
  setTimeout(() => { panel.hidden = true; panel.classList.remove("closing"); }, 180);
}

// ---------- navigation ----------

function switchView(view) {
  state.view = view;
  closeDetail();
  $("viewDashboard").hidden = view !== "dashboard";
  $("viewFavorites").hidden = view !== "favorites";
  $("viewSettings").hidden = view !== "settings";
  document.querySelectorAll(".navbtn").forEach((b) => {
    const active = b.dataset.nav === view;
    b.classList.toggle("active", active);
    if (active) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  });
  if (view === "favorites") renderFavorites();
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
  showToast(`Exported ${items.length} rows`);
}

// ---------- refresh ----------

async function doRefresh() {
  const btn = $("refreshBtn");
  if (btn.disabled) return;
  btn.disabled = true;
  btn.classList.add("spinning");
  if (!state.items.length) setSkeleton(true);

  // keep the spinner visible for at least half a second so fast fetches still register
  await Promise.all([scrape(), sleep(500)]);

  setSkeleton(false);
  btn.classList.remove("spinning");
  btn.disabled = false;

  renderAll();
  if (state.source === "live") showToast("Data refreshed");
}

function renderAll() {
  renderMeta();
  renderStats();
  renderControls();
  renderList();
  renderStale();
  if (state.view === "favorites") renderFavorites();
  else {
    const badge = $("favBadge");
    badge.hidden = state.favorites.size === 0;
    badge.textContent = state.favorites.size;
  }
}

// ---------- init ----------

async function init() {
  await loadPrefs();

  // search
  const search = $("search");
  search.addEventListener("input", (e) => {
    state.search = e.target.value;
    $("clearSearch").hidden = !state.search;
    renderList();
  });
  $("clearSearch").addEventListener("click", () => {
    search.value = "";
    state.search = "";
    $("clearSearch").hidden = true;
    renderList();
    search.focus();
  });

  $("categorySel").addEventListener("change", (e) => { state.category = e.target.value; renderList(); });
  $("sortSel").addEventListener("change", (e) => { state.sort = e.target.value; renderList(); });

  // header actions
  $("refreshBtn").addEventListener("click", doRefresh);
  $("emptyRefresh").addEventListener("click", doRefresh);
  $("settingsBtn").addEventListener("click", () => switchView("settings"));

  // bottom nav
  document.querySelectorAll(".navbtn").forEach((b) =>
    b.addEventListener("click", () => switchView(b.dataset.nav))
  );

  // settings
  document.querySelectorAll("#themeSeg [data-theme-opt]").forEach((b) =>
    b.addEventListener("click", () => {
      state.settings.theme = b.dataset.themeOpt;
      applySettings();
      savePrefs();
    })
  );
  document.querySelectorAll("#densitySeg [data-density-opt]").forEach((b) =>
    b.addEventListener("click", () => {
      state.settings.density = b.dataset.densityOpt;
      applySettings();
      savePrefs();
    })
  );
  $("exportBtn").addEventListener("click", exportCsv);
  $("versionHint").textContent = `v${chrome.runtime.getManifest().version}`;

  // detail panel
  $("detailBack").addEventListener("click", closeDetail);
  $("detailFav").addEventListener("click", () => {
    if (state.detailCode) toggleFavorite(state.detailCode);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeDetail();
    if (e.key === "/" && document.activeElement !== search) {
      e.preventDefault();
      switchView("dashboard");
      search.focus();
    }
  });

  setSkeleton(true);
  await scrape();
  setSkeleton(false);
  renderAll();
}

init();