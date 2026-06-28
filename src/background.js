importScripts("listingParser.js", "pollingStore.js");

const parser = globalThis.RentCompareParser;
const polling = globalThis.HouseMarketPollingStore;
const POLL_ALARM_NAME = "house-market-poll";
const MARKET_DATA_VERSION = 2;

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
  await chrome.storage.local.set({ marketDataVersion: MARKET_DATA_VERSION });
  return { added: next.length - existing.length, total: next.length };
};

const marketSearchUrls = (base, analysisMode = base.mode) => {
  const searchBase = { ...base, mode: analysisMode };
  const keywordGroups = parser.buildRegionalSearchKeywords(searchBase);
  const urls = [];
  const add = (label, url, marketKind = "listing") => urls.push({ label, url, marketKind });

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

const scrapeSearchTab = async (source, base, mode) => {
  const tab = await chrome.tabs.create({ url: source.url, active: false });
  try {
    await waitForTabComplete(tab.id);
    await new Promise((resolve) => setTimeout(resolve, 1800));
    await injectContentScripts(tab.id);
    const response = await chrome.tabs.sendMessage(tab.id, { type: "SCRAPE_LIST" });
    return (response?.listings || []).map((item) => enrichWithSearchContext(item, base, mode, source));
  } finally {
    if (tab.id) await chrome.tabs.remove(tab.id);
  }
};

const analyzeNearby = async (listing, requestedMode = "") => {
  await upsertItems([listing]);
  await addToWatchlist(listing, requestedMode);
  let scraped = [];
  const modes = requestedMode ? [requestedMode] : listing.mode === "rent" ? ["rent", "sale"] : ["sale"];
  for (const mode of modes) {
    for (const source of marketSearchUrls(listing, mode).slice(0, 4)) {
      try {
        scraped = scraped.concat(await scrapeSearchTab(source, listing, mode));
      } catch {
        continue;
      }
    }
  }
  const result = await upsertItems(scraped);
  return { scraped: scraped.length, added: result.added, total: result.total };
};

const resetAndAnalyzeNearby = async (listing, requestedMode = "") => {
  await chrome.storage.local.set({
    listings: [],
    analysisTimestamps: {},
    marketDataVersion: MARKET_DATA_VERSION,
    [polling.WATCHLIST_KEY]: [],
    [polling.POLL_STATE_KEY]: {}
  });
  return analyzeNearby(listing, requestedMode);
};

const pollWatchlist = async () => {
  const data = await chrome.storage.local.get({
    [polling.WATCHLIST_KEY]: [],
    [polling.POLL_STATE_KEY]: {}
  });
  const watchlist = data[polling.WATCHLIST_KEY] || [];
  let pollState = data[polling.POLL_STATE_KEY] || {};
  const due = polling.dueWatches(watchlist, pollState);
  let scraped = 0;
  let added = 0;
  for (const watch of due) {
    try {
      const result = await analyzeNearby(watch.listing, watch.analysisMode);
      scraped += result.scraped || 0;
      added += result.added || 0;
    } finally {
      pollState = polling.markPolled(pollState, watch);
    }
  }

  await chrome.storage.local.set({ [polling.POLL_STATE_KEY]: pollState });
  return { checked: due.length, scraped, added };
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "ANALYZE_NEARBY") {
    analyzeNearby(message.listing, message.analysisMode)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "RESET_AND_ANALYZE") {
    resetAndAnalyzeNearby(message.listing, message.analysisMode)
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
