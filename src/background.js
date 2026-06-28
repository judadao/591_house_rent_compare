importScripts("listingParser.js");

const parser = globalThis.RentCompareParser;

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

const upsertItems = async (items) => {
  const existing = await storageGetItems();
  const byId = new Map(existing.map((item) => [item.id || item.url, item]));
  for (const item of items) {
    if (!item?.url || (!item?.price && !item?.totalPrice && !item?.monthlyRent)) continue;
    byId.set(item.id || item.url, { ...byId.get(item.id || item.url), ...item });
  }
  const next = [...byId.values()].sort((a, b) => Date.parse(b.collectedAt) - Date.parse(a.collectedAt));
  await storageSetItems(next);
  return { added: next.length - existing.length, total: next.length };
};

const marketSearchUrls = (base) => {
  const keywords = parser.buildMarketSearchKeywords(base);
  const urls = [];
  const add = (label, url, marketKind = "listing") => urls.push({ label, url, marketKind });

  if (base.mode === "sale") {
    add("591 買屋開價", parser.buildMarketSearchUrl({ ...base, mode: "sale" }), "listing");
    add("樂屋買屋開價", `https://www.rakuya.com.tw/search/sale?keyword=${encodeURIComponent(keywords)}`, "listing");
    add("信義買屋開價", `https://www.sinyi.com.tw/buy/list/${encodeURIComponent(keywords)}-keyword`, "listing");
  } else {
    add("591 租屋", parser.buildMarketSearchUrl({ ...base, mode: "rent" }), "listing");
    add("樂屋租屋", `https://www.rakuya.com.tw/search/rent?keyword=${encodeURIComponent(keywords)}`, "listing");
  }

  return urls;
};

const scrapeSearchTab = async (source) => {
  const tab = await chrome.tabs.create({ url: source.url, active: false });
  try {
    await waitForTabComplete(tab.id);
    await new Promise((resolve) => setTimeout(resolve, 1800));
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["src/listingParser.js", "src/marketAnalyzer.js", "src/contentScript.js"]
    });
    const response = await chrome.tabs.sendMessage(tab.id, { type: "SCRAPE_LIST" });
    return (response?.listings || []).map((item) => ({
      ...item,
      marketKind: source.marketKind,
      sourceLabel: source.label
    }));
  } finally {
    if (tab.id) await chrome.tabs.remove(tab.id);
  }
};

const analyzeNearby = async (listing) => {
  await upsertItems([listing]);
  let scraped = [];
  for (const source of marketSearchUrls(listing)) {
    try {
      scraped = scraped.concat(await scrapeSearchTab(source));
    } catch {
      continue;
    }
  }
  const result = await upsertItems(scraped);
  return { scraped: scraped.length, added: result.added, total: result.total };
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "ANALYZE_NEARBY") {
    analyzeNearby(message.listing)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  return false;
});
