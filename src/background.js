importScripts("listingParser.js", "pollingStore.js");

const parser = globalThis.RentCompareParser;
const polling = globalThis.HouseMarketPollingStore;
const POLL_ALARM_NAME = "house-market-poll";
const MARKET_DATA_VERSION = 11;
const REGION_REFRESH_KEY = "marketRegionRefreshState";
const analysisInFlight = new Set();
const REGION_SECTION_IDS = {
  "新北市|板橋區": { regionid: 3, section: 26 }
};
const RENT_STATION_IDS = {
  "新北市|板橋區|府中": { metro: 168, station: 4275 },
  "新北市|板橋區|板新": { metro: 168, station: 4275 },
  "新北市|板橋區|新埔": { metro: 168, station: 4275 }
};

const waitForTabComplete = (tabId, timeoutMs = 15000) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error("搜尋頁載入逾時"));
    }, timeoutMs);

    const listener = (updatedTabId, changeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === "complete") {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };

    chrome.tabs.onUpdated.addListener(listener);
  });

const storageGetItems = async () => {
  const data = await chrome.storage.local.get({ listings: [] });
  return data.listings || [];
};

const storageSetItems = (items) => chrome.storage.local.set({ listings: items });

const storageGetWatchlist = async () => {
  const data = await chrome.storage.local.get({ [polling.WATCHLIST_KEY]: [] });
  return data[polling.WATCHLIST_KEY] || [];
};

const storageSetWatchlist = (watchlist) => chrome.storage.local.set({ [polling.WATCHLIST_KEY]: watchlist });

const addToWatchlist = async (listing, mode = "") => {
  const watchlist = await storageGetWatchlist();
  await storageSetWatchlist(polling.addWatch(watchlist, listing, mode));
};

const regionCacheKey = (base, mode = base.mode) =>
  [base.city || "", base.district || "", mode || ""].join("|");

const regionDataIsFresh = (state = {}, key, now = Date.now()) => {
  const timestamp = Date.parse(state[key] || "");
  return Number.isFinite(timestamp) && now - timestamp < polling.DEFAULT_POLL_MINUTES * 60 * 1000;
};

const injectContentScripts = async (tabId) => {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["src/listingParser.js", "src/marketAnalyzer.js", "src/contentScript.js"]
  });
};

const sendToTab = async (tabId, message) => {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch {
    await injectContentScripts(tabId);
    return chrome.tabs.sendMessage(tabId, message);
  }
};

const upsertItems = async (items) => {
  const existing = await storageGetItems();
  const byId = new Map(existing.map((item) => [item.id || item.url, item]));
  for (const item of items) {
    if (!item?.url || (!item?.price && !item?.totalPrice && !item?.monthlyRent)) continue;
    byId.set(item.id || item.url, { ...byId.get(item.id || item.url), ...item });
  }
  const next = [...byId.values()].sort((a, b) => Date.parse(b.collectedAt) - Date.parse(a.collectedAt));
  await storageSetItems(next);
  await chrome.storage.local.set({
    marketDataVersion: MARKET_DATA_VERSION,
    [polling.MARKET_DATA_UPDATED_AT_KEY]: new Date().toISOString()
  });
  return { added: next.length - existing.length, total: next.length };
};

const marketSearchUrls = (base, analysisMode = base.mode) => {
  const searchBase = { ...base, mode: analysisMode };
  const keywordGroups = parser.buildRegionalSearchKeywords(searchBase);
  const urls = [];
  const add = (label, url, marketKind = "listing") => urls.push({ label, url, marketKind });
  const regionSection = REGION_SECTION_IDS[`${searchBase.city}|${searchBase.district}`];

  if (regionSection) {
    const structured = new URL(searchBase.mode === "sale" ? "https://sale.591.com.tw/" : "https://rent.591.com.tw/list");
    structured.searchParams.set(searchBase.mode === "sale" ? "regionid" : "region", regionSection.regionid);
    structured.searchParams.set("section", regionSection.section);
    if (searchBase.mode === "sale") structured.searchParams.set("shType", "list");
    add(`591 ${searchBase.mode === "sale" ? "買房" : "租屋"} ${searchBase.city}${searchBase.district}`, structured.toString(), "listing");
  }

  for (const keywords of keywordGroups) {
    if (searchBase.mode === "sale") {
      const sale591 = new URL("https://sale.591.com.tw/");
      sale591.searchParams.set("keywords", keywords);
      add(`591 買屋開價 ${keywords}`, sale591.toString(), "listing");
    } else {
      const rent591 = new URL("https://rent.591.com.tw/");
      rent591.searchParams.set("keywords", keywords);
      add(`591 租屋 ${keywords}`, rent591.toString(), "listing");
    }
  }

  return urls;
};

const regionalMarketSources = (base, analysisMode = base.mode) => {
  const searchBase = { ...base, mode: analysisMode };
  const sources = [];
  const add = (label, url, marketKind = "listing") => sources.push({ label, url, marketKind });
  const regionSection = REGION_SECTION_IDS[`${searchBase.city}|${searchBase.district}`];
  if (regionSection) {
    if (searchBase.mode === "rent") {
      const focused = rentFocusedSource(searchBase, regionSection);
      if (focused) add(focused.label, focused.url, "listing");
    }
    const structured = new URL(searchBase.mode === "sale" ? "https://sale.591.com.tw/" : "https://rent.591.com.tw/list");
    structured.searchParams.set(searchBase.mode === "sale" ? "regionid" : "region", regionSection.regionid);
    structured.searchParams.set("section", regionSection.section);
    if (searchBase.mode === "sale") structured.searchParams.set("shType", "list");
    add(`591 ${searchBase.mode === "sale" ? "買房" : "租屋"} ${searchBase.city}${searchBase.district}`, structured.toString(), "listing");
  }
  return sources.length ? sources : marketSearchUrls(searchBase, analysisMode).slice(0, 1);
};

const rentAcreageBuckets = (area) => {
  if (!Number.isFinite(area)) return "";
  if (area <= 10) return "0_10,10_20";
  if (area <= 20) return "10_20,0_10";
  if (area <= 30) return "20_30,10_20";
  if (area <= 40) return "30_40,20_30";
  return "40_,30_40";
};

const rentPriceBuckets = (rent) => {
  if (!Number.isFinite(rent)) return "";
  if (rent <= 10000) return "0_5000,5000_10000,10000_20000";
  if (rent <= 20000) return "10000_20000,5000_10000,0_5000";
  if (rent <= 30000) return "20000_30000,10000_20000";
  if (rent <= 50000) return "30000_50000,20000_30000";
  return "50000_,30000_50000";
};

const rentFocusedSource = (base, regionSection) => {
  const url = new URL("https://rent.591.com.tw/list");
  url.searchParams.set("region", regionSection.regionid);
  url.searchParams.set("section", regionSection.section);
  const price = rentPriceBuckets(base.monthlyRent || base.price);
  const acreage = rentAcreageBuckets(base.area);
  if (price) url.searchParams.set("price", price);
  if (acreage) url.searchParams.set("acreage", acreage);
  const station = RENT_STATION_IDS[`${base.city}|${base.district}|${base.transitStation || ""}`];
  if (station) {
    url.searchParams.set("metro", station.metro);
    url.searchParams.set("station", station.station);
  } else if (base.areaBlock || base.transitStation) {
    url.searchParams.set("keywords", base.transitStation || base.areaBlock);
  }
  return { label: `591 租屋焦點 ${base.city}${base.district}`, url: url.toString() };
};

const enrichWithSearchContext = (item, base, mode, source) => ({
  ...item,
  mode,
  city: item.city || base.city || "",
  district: item.district || base.district || "",
  addressRoad: item.addressRoad || base.addressRoad || "",
  areaBlock: item.areaBlock || base.areaBlock || "",
  transitStation: item.transitStation || base.transitStation || "",
  latitude: item.latitude ?? null,
  longitude: item.longitude ?? null,
  marketKind: source.marketKind,
  sourceLabel: source.label,
  searchContext: {
    city: base.city || "",
    district: base.district || "",
    areaBlock: base.areaBlock || "",
    addressRoad: base.addressRoad || "",
    transitStation: base.transitStation || ""
  }
});

const scrapeLoadedTab = async (tabId, source, base, mode) => {
  await injectContentScripts(tabId);
  let response = { listings: [] };
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, attempt === 0 ? 1800 : 1000));
    response = await chrome.tabs.sendMessage(tabId, { type: "SCRAPE_LIST" });
    if ((response?.listings || []).length >= 5) break;
  }
  const listings = (response?.listings || []).map((item) => enrichWithSearchContext(item, base, mode, source));
  return mode === "rent" ? enrichRentDetailCoordinates(tabId, listings) : listings;
};

const isRentDetailUrl = (url) => /^https:\/\/rent\.591\.com\.tw\/\d+(?:[/?#]|$)/.test(String(url || ""));

const enrichRentDetailCoordinates = async (tabId, listings) => {
  const candidates = listings
    .filter((item) => isRentDetailUrl(item.url) && (!Number.isFinite(item.latitude) || !Number.isFinite(item.longitude)))
    .slice(0, 12);
  const byKey = new Map(listings.map((item) => [item.id || item.url, item]));
  for (const item of candidates) {
    try {
      const loaded = waitForTabComplete(tabId);
      await chrome.tabs.update(tabId, { url: item.url });
      await loaded;
      await injectContentScripts(tabId);
      await new Promise((resolve) => setTimeout(resolve, 900));
      const response = await chrome.tabs.sendMessage(tabId, { type: "SCRAPE_CURRENT" });
      const detail = response?.listing;
      if (!detail) continue;
      byKey.set(item.id || item.url, {
        ...item,
        latitude: Number.isFinite(detail.latitude) ? detail.latitude : item.latitude,
        longitude: Number.isFinite(detail.longitude) ? detail.longitude : item.longitude,
        address: detail.address || item.address || "",
        addressRoad: detail.addressRoad || item.addressRoad || "",
        transitStation: detail.transitStation || item.transitStation || "",
        transitDistanceMeters: Number.isFinite(detail.transitDistanceMeters) ? detail.transitDistanceMeters : item.transitDistanceMeters
      });
    } catch {
      continue;
    }
  }
  return [...byKey.values()];
};

const scrapeSearchSources = async (sources, base, mode) => {
  if (!sources.length) return [];
  const tab = await chrome.tabs.create({ url: sources[0].url, active: false });
  const scraped = [];
  try {
    await waitForTabComplete(tab.id);
    scraped.push(...await scrapeLoadedTab(tab.id, sources[0], base, mode));
    for (const source of sources.slice(1)) {
      const loaded = waitForTabComplete(tab.id);
      await chrome.tabs.update(tab.id, { url: source.url });
      await loaded;
      scraped.push(...await scrapeLoadedTab(tab.id, source, base, mode));
    }
    return scraped;
  } finally {
    if (tab.id) await chrome.tabs.remove(tab.id);
  }
};

const analyzeNearby = async (listing, requestedMode = "", options = {}) => {
  const lockKey = polling.watchKey(listing, requestedMode || listing.mode || "");
  if (analysisInFlight.has(lockKey)) {
    return { scraped: 0, added: 0, total: (await storageGetItems()).length, skipped: true };
  }
  analysisInFlight.add(lockKey);
  try {
    await upsertItems([listing]);
    if (options.track !== false) await addToWatchlist(listing, requestedMode);
    let scraped = [];
    const modes = requestedMode ? [requestedMode] : listing.mode === "rent" ? ["rent", "sale"] : ["sale"];
    for (const mode of modes) {
      const sourceLimit = options.sourceLimit || (mode === "rent" ? 4 : 6);
      const sources = marketSearchUrls(listing, mode).slice(0, sourceLimit);
      try {
        scraped = scraped.concat(await scrapeSearchSources(sources, listing, mode));
      } catch {
        continue;
      }
    }
    const result = await upsertItems(scraped);
    return { scraped: scraped.length, added: result.added, total: result.total };
  } finally {
    analysisInFlight.delete(lockKey);
  }
};

const refreshRegionalMarketData = async (listing, requestedMode = "", options = {}) => {
  const modes = requestedMode ? [requestedMode] : listing.mode === "rent" ? ["rent", "sale"] : ["sale"];
  const stateData = await chrome.storage.local.get({ [REGION_REFRESH_KEY]: {} });
  const nextState = { ...(stateData[REGION_REFRESH_KEY] || {}) };
  let scraped = [];
  for (const mode of modes) {
    const key = regionCacheKey(listing, mode);
    if (!options.force && regionDataIsFresh(nextState, key)) continue;
    const lockKey = `region:${key}`;
    if (analysisInFlight.has(lockKey)) continue;
    analysisInFlight.add(lockKey);
    try {
      const sources = regionalMarketSources(listing, mode);
      scraped = scraped.concat(await scrapeSearchSources(sources, listing, mode));
      nextState[key] = new Date().toISOString();
    } finally {
      analysisInFlight.delete(lockKey);
    }
  }
  const result = await upsertItems(scraped);
  await chrome.storage.local.set({ [REGION_REFRESH_KEY]: nextState });
  return { scraped: scraped.length, added: result.added, total: result.total };
};

const setMarketRefreshStatus = (state, message) =>
  chrome.storage.local.set({
    [polling.POLL_STATUS_KEY]: {
      state,
      message,
      updatedAt: new Date().toISOString()
    }
  });

const queueRegionalRefresh = (listing, requestedMode = "", options = {}) => {
  setTimeout(() => {
    setMarketRefreshStatus("running", "正在背景分析行情資料，會自動開啟非作用分頁並在完成後關閉。")
      .then(() => refreshRegionalMarketData(listing, requestedMode, options))
      .then((result) => setMarketRefreshStatus("done", `背景分析完成：收集 ${result.scraped || 0} 筆，新增 ${result.added || 0} 筆。`))
      .catch((error) => setMarketRefreshStatus("idle", `背景分析失敗：${error?.message || "未知錯誤"}`));
  }, 0);
};

const analyzeFromLocalData = async (listing, requestedMode = "", options = {}) => {
  await upsertItems([listing]);
  if (options.track !== false) await addToWatchlist(listing, requestedMode);
  const mode = requestedMode || listing.mode;
  if (options.refresh !== false) queueRegionalRefresh(listing, requestedMode, { force: Boolean(options.forceRefresh) });
  const total = (await storageGetItems()).length;
  return { scraped: 0, added: 0, total, refreshing: options.refresh !== false, localOnly: true };
};

const resetAndAnalyzeNearby = async (listing, requestedMode = "", options = {}) => {
  await chrome.storage.local.set({
    listings: [],
    analysisTimestamps: {},
    marketDataVersion: MARKET_DATA_VERSION,
    [polling.MARKET_DATA_UPDATED_AT_KEY]: "",
    [polling.WATCHLIST_KEY]: [],
    [polling.POLL_STATE_KEY]: {},
    [REGION_REFRESH_KEY]: {}
  });
  return analyzeFromLocalData(listing, requestedMode, { ...options, forceRefresh: true });
};

const pollWatchlist = async () => {
  const data = await chrome.storage.local.get({
    [polling.WATCHLIST_KEY]: [],
    [polling.POLL_STATE_KEY]: {},
    [polling.MARKET_DATA_UPDATED_AT_KEY]: ""
  });
  if (polling.dataIsFresh(data[polling.MARKET_DATA_UPDATED_AT_KEY])) {
    await chrome.storage.local.set({
      [polling.POLL_STATUS_KEY]: {
        state: "skipped",
        message: "本機資料未滿 15 分鐘，略過本次更新。",
        updatedAt: new Date().toISOString()
      }
    });
    return { checked: 0, scraped: 0, added: 0, skipped: true };
  }

  const watchlist = data[polling.WATCHLIST_KEY] || [];
  let pollState = data[polling.POLL_STATE_KEY] || {};
  const due = polling.dueWatches(watchlist, pollState).slice(0, 1);
  if (!due.length) {
    await chrome.storage.local.set({
      [polling.POLL_STATUS_KEY]: {
        state: "idle",
        message: "沒有到期的追蹤物件。",
        updatedAt: new Date().toISOString()
      }
    });
    return { checked: 0, scraped: 0, added: 0 };
  }

  await chrome.storage.local.set({
    [polling.POLL_STATUS_KEY]: {
      state: "running",
      message: "正在背景更新行情資料...",
      updatedAt: new Date().toISOString()
    }
  });
  let scraped = 0;
  let added = 0;
  for (const watch of due) {
    try {
      const result = await refreshRegionalMarketData(watch.listing, watch.analysisMode, { track: false });
      scraped += result.scraped || 0;
      added += result.added || 0;
    } finally {
      pollState = polling.markPolled(pollState, watch);
    }
  }

  await chrome.storage.local.set({
    [polling.POLL_STATE_KEY]: pollState,
    [polling.POLL_STATUS_KEY]: {
      state: "done",
      message: `背景更新完成：檢查 ${due.length} 筆，收集 ${scraped} 筆，新增 ${added} 筆。`,
      updatedAt: new Date().toISOString()
    }
  });
  return { checked: due.length, scraped, added };
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "ANALYZE_NEARBY") {
    analyzeFromLocalData(message.listing, message.analysisMode, { forceRefresh: Boolean(message.forceRefresh) })
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "RESET_AND_ANALYZE") {
    resetAndAnalyzeNearby(message.listing, message.analysisMode, { sourceLimit: message.sourceLimit || null })
      .then((result) => sendResponse({ ok: true, reset: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  return false;
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(POLL_ALARM_NAME, {
    periodInMinutes: polling.DEFAULT_POLL_MINUTES
  });
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(POLL_ALARM_NAME, {
    periodInMinutes: polling.DEFAULT_POLL_MINUTES
  });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === POLL_ALARM_NAME) {
    pollWatchlist().catch(() => {});
  }
});

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab?.id) return;
  await sendToTab(tab.id, { type: "TOGGLE_PANEL" });
});
