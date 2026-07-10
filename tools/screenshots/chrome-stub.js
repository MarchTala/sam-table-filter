// Screenshot harness: stubs the chrome.* extension APIs with mock SAM data
// so the popup can run in a plain browser page. All tickers and figures are
// invented — no real SAM Table content.
const MOCK_ITEMS = [
  { category: "Growth Stocks", code: "ALI", name: "Ayala Land", current: 27.5, buyBelow: 32.0, target: 48.0, growth: 74.55, maxPct: 15, dividend: 1.7, fromTarget: -42.71, action: "Continue Buying" },
  { category: "Growth Stocks", code: "ICT", name: "Int'l Container Terminal", current: 388.0, buyBelow: 310.0, target: 420.0, growth: 8.25, maxPct: 15, dividend: 2.9, fromTarget: -7.62, action: "Hold" },
  { category: "Growth Stocks", code: "JFC", name: "Jollibee Foods", current: 248.0, buyBelow: 265.0, target: 340.0, growth: 37.1, maxPct: 15, dividend: 1.1, fromTarget: -27.06, action: "Continue Buying" },
  { category: "Growth Stocks", code: "CNVRG", name: "Converge ICT", current: 17.8, buyBelow: 14.0, target: 19.0, growth: 6.74, maxPct: 10, dividend: 0.0, fromTarget: -6.32, action: "Slice 50%" },
  { category: "Growth Stocks", code: "WLCON", name: "Wilcon Depot", current: 9.9, buyBelow: 16.0, target: 22.0, growth: 122.22, maxPct: 10, dividend: 1.5, fromTarget: -55.0, action: "Stop Buying" },
  { category: "Dividend Stocks (BOSS)", code: "MER", name: "Meralco", current: 512.0, buyBelow: 430.0, target: 560.0, growth: 9.38, maxPct: 20, dividend: 4.6, fromTarget: -8.57, action: "Hold" },
  { category: "Dividend Stocks (BOSS)", code: "TEL", name: "PLDT Inc.", current: 1290.0, buyBelow: 1400.0, target: 1750.0, growth: 35.66, maxPct: 20, dividend: 7.2, fromTarget: -26.29, action: "Continue Buying" },
  { category: "Dividend Stocks (BOSS)", code: "AREIT", name: "AREIT Inc.", current: 41.2, buyBelow: 44.0, target: 52.0, growth: 26.21, maxPct: 20, dividend: 5.4, fromTarget: -20.77, action: "Continue Buying" },
  { category: "Dividend Stocks (BOSS)", code: "GLO", name: "Globe Telecom", current: 2250.0, buyBelow: 1900.0, target: 2400.0, growth: 6.67, maxPct: 20, dividend: 4.4, fromTarget: -6.25, action: "Slice 50%" },
  { category: "REITs", code: "RCR", name: "RL Commercial REIT", current: 6.4, buyBelow: 6.8, target: 8.5, growth: 32.81, maxPct: 20, dividend: 6.8, fromTarget: -24.71, action: "Continue Buying" },
  { category: "REITs", code: "MREIT", name: "MREIT Inc.", current: 13.5, buyBelow: 14.5, target: 17.0, growth: 25.93, maxPct: 20, dividend: 6.1, fromTarget: -20.59, action: "Hold" },
  { category: "Mutual Funds & UITFs", code: "SALEF", name: "Sun Life Equity Fund", current: 4.21, buyBelow: 4.5, target: 5.2, growth: 23.52, maxPct: 25, dividend: 0.0, fromTarget: -19.04, action: "Continue Buying" },
];

const store = {};
window.chrome = {
  tabs: {
    query: async () => [{ id: 1, url: "https://members.trulyrichclub.com/member/recommendations/sam" }],
    sendMessage: async () => ({ ok: true, items: MOCK_ITEMS, lastUpdated: "July 8, 2026", scrapedAt: Date.now() }),
    onUpdated: { addListener() {}, removeListener() {} },
    get: async () => ({ status: "complete", url: "" }),
    create: async () => ({ id: 2 }),
    remove: async () => {},
  },
  storage: {
    local: {
      get: async (keys) => {
        const out = {};
        (Array.isArray(keys) ? keys : [keys]).forEach((k) => { if (k in store) out[k] = store[k]; });
        return out;
      },
      set: async (obj) => Object.assign(store, obj),
    },
  },
  runtime: { getManifest: () => ({ version: "1.1.0" }) },
  scripting: { executeScript: async () => {} },
};