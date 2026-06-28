const $ = (selector) => document.querySelector(selector);

const DEFAULT_OPTIONS = {
  areaTolerance: 0.25,
  matchDistrict: false,
  matchType: false,
  matchRooms: false
};

const state = {
  current: null,
  items: [],
  options: { ...DEFAULT_OPTIONS }
};

const parser = globalThis.RentCompareParser;
const analyzer = globalThis.RentCompareMarketAnalyzer;

const escapeHtml = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

const currency = (value) => (Number.isFinite(value) ? `$${Math.round(value).toLocaleString("zh-TW")}` : "-");
const wan = (value) => (Number.isFinite(value) ? `${Math.round(value).toLocaleString("zh-TW")} 萬` : "-");
const unitWan = (value) => (Number.isFinite(value) ? `${Math.round(value * 10) / 10} 萬/坪` : "-");
const ping = (value) => (Number.isFinite(value) ? `${Number(value).toFixed(1)} 坪` : "-");
const boolText = (value) => (value ? "有" : "未判斷");

const setStatus = (message, isError = false) => {
  const status = $("#status");
  status.textContent = message;
  status.classList.toggle("error", isError);
};

const storageGet = () =>
  chrome.storage.local.get({ listings: [], options: DEFAULT_OPTIONS }).then((data) => ({
    items: data.listings || [],
    options: { ...DEFAULT_OPTIONS, ...(data.options || {}) }
  }));

const storageSetListings = (listings) => chrome.storage.local.set({ listings });
const storageSetOptions = (options) => chrome.storage.local.set({ options });

const qualityIssues = (listing) => {
  if (!listing) return ["尚未讀取物件"];
  const issues = [];
  if (listing.mode === "sale" && !listing.totalPrice && !listing.pricePerPing) issues.push("缺買賣價格");
  if (listing.mode === "rent" && !listing.monthlyRent) issues.push("缺租金");
  if (!listing.area) issues.push("缺坪數");
  if (!listing.city || !listing.district) issues.push("缺區域");
  if (!listing.type && !listing.buildingType) issues.push("缺型態");
  if (!listing.rooms && (listing.type === "整層住家" || listing.mode === "sale")) issues.push("缺房數");
  return issues;
};

const upsertItems = async (items) => {
  const existing = state.items.length ? state.items : (await storageGet()).items;
  const byId = new Map(existing.map((item) => [item.id || item.url, item]));

  for (const item of items) {
    if (!item?.url || (!item?.price && !item?.totalPrice && !item?.monthlyRent)) continue;
    byId.set(item.id || item.url, { ...byId.get(item.id || item.url), ...item });
  }

  const next = [...byId.values()].sort((a, b) => Date.parse(b.collectedAt) - Date.parse(a.collectedAt));
  await storageSetListings(next);
  state.items = next;
  render();
  return next.length - existing.length;
};

const activeTab = async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
};

const sendToActiveTab = async (type) => {
  const tab = await activeTab();
  if (!tab?.id) throw new Error("找不到目前分頁");
  if (!/(591|lvr\.land\.moi)/.test(tab.url || "")) {
    throw new Error("請先開啟支援的房屋網站頁面");
  }

  try {
    return await chrome.tabs.sendMessage(tab.id, { type });
  } catch {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["src/listingParser.js", "src/marketAnalyzer.js", "src/contentScript.js"]
    });
    return chrome.tabs.sendMessage(tab.id, { type });
  }
};

const waitForTabComplete = (tabId, timeoutMs = 12000) =>
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

const scrapeTab = async (tabId, type) => {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["src/listingParser.js", "src/marketAnalyzer.js", "src/contentScript.js"]
  });
  return chrome.tabs.sendMessage(tabId, { type });
};

const marketSearchUrl = () => {
  if (!state.current) return "";
  return parser.buildMarketSearchUrl(state.current);
};

const marketSearchUrls = () => {
  if (!state.current) return [];
  const base = state.current;
  const keywords = parser.buildBroadMarketSearchKeywords(base);
  const urls = [];
  const add = (label, url, marketKind = "listing") => urls.push({ label, url, marketKind });

  if (base.mode === "sale") {
    add("591 買屋開價", parser.buildMarketSearchUrl({ ...base, mode: "sale" }), "listing");
    add("實價登錄", `https://lvr.land.moi.gov.tw/`, "transaction");
  } else {
    add("591 租屋", parser.buildMarketSearchUrl({ ...base, mode: "rent" }), "listing");
  }

  return urls;
};

const renderFacts = () => {
  const listing = state.current;
  const facts = $("#currentListing");
  const quality = $("#quality");

  if (!listing) {
    facts.innerHTML = "<dt>狀態</dt><dd>尚未讀取</dd>";
    quality.textContent = "請在 591 物件頁或搜尋頁使用。";
    quality.className = "quality warn";
    return;
  }

  facts.innerHTML = [
    ["標題", listing.title || "-"],
    ["模式", listing.mode === "sale" ? "買房" : "租屋"],
    ["價格", listing.mode === "sale" ? `${wan(listing.totalPrice)} / ${unitWan(listing.pricePerPing)}` : `${currency(listing.monthlyRent)} / 月`],
    ["坪數", ping(listing.area)],
    ["區域", [listing.city, listing.district].filter(Boolean).join("") || "-"],
    ["型態", listing.buildingType || listing.type || "-"],
    ["格局", listing.rooms ? `${listing.rooms} 房` : "-"],
    ["樓層", listing.floor && listing.totalFloors ? `${listing.floor}/${listing.totalFloors} 樓` : "-"],
    ["設備", [`電梯:${boolText(listing.hasElevator)}`, `車位:${boolText(listing.hasParking)}`].join(" ")]
  ]
    .map(([key, value]) => `<dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value)}</dd>`)
    .join("");

  const issues = qualityIssues(listing);
  quality.textContent = issues.length ? `資料提醒：${issues.join("、")}` : "資料完整度良好。";
  quality.className = issues.length ? "quality warn" : "quality ok";
};

const renderComparison = () => {
  const reports = $("#marketReports");
  const base = state.current;

  if (!base) {
    reports.innerHTML = `<div class="summary">開啟支援的房屋物件頁後可分析。</div>`;
    return;
  }

  const report = analyzer.analyzeMarket(base, state.items, {
    areaTolerance: state.options.areaTolerance,
    matchDistrict: state.options.matchDistrict,
    matchBuildingType: state.options.matchType,
    matchRooms: state.options.matchRooms
  });

  const buckets = base.mode === "sale" ? [report.listing, report.transaction] : [report.rent];
  reports.innerHTML = buckets.map(renderMarketBucket).join("");
};

const renderMarketBucket = (bucket) => {
  const hasData = bucket.count > 0;
  const diff =
    bucket.diffPercent === null
      ? ""
      : bucket.diffPercent >= 0
        ? `偏高 ${Math.abs(bucket.diffPercent).toFixed(1)}%`
        : `偏低 ${Math.abs(bucket.diffPercent).toFixed(1)}%`;
  const unitText = state.current?.mode === "sale" ? unitWan(bucket.medianUnit) : `${currency(bucket.medianUnit)}/坪`;
  const primaryText = state.current?.mode === "sale" ? wan(bucket.medianPrimary) : currency(bucket.medianPrimary);
  const pricedCount = bucket.pricedCount ?? bucket.count;

  return `
    <article class="market-report">
      <h3>${escapeHtml(bucket.label)}</h3>
      ${
        hasData
          ? `<p class="summary">找到 <strong>${bucket.count}</strong> 個範圍物件，其中 <strong>${escapeHtml(pricedCount)}</strong> 個可估價。中位數 <strong>${escapeHtml(primaryText)}</strong>，每坪 <strong>${escapeHtml(unitText)}</strong>${diff ? `，目前約 <strong>${escapeHtml(diff)}</strong>` : ""}。</p>`
          : `<p class="summary">目前沒有足夠資料。請按「分析附近行情」自動補資料，或匯入/收集更多同區案例。</p>`
      }
      <ol class="comparables">
        ${bucket.comparables.slice(0, 12).map(renderComparable).join("")}
      </ol>
    </article>
  `;
};

const renderComparable = (item) => {
  const priceText = item.mode === "sale" ? `${wan(item.totalPrice)} / ${unitWan(analyzer.unitValue(item))}` : `${currency(item.monthlyRent)} / ${currency(analyzer.unitValue(item))}/坪`;
  const meta = [[item.city, item.district].filter(Boolean).join(""), item.buildingType || item.type, ping(item.area), item.marketKind === "transaction" ? "成交" : "開價"]
    .filter(Boolean)
    .join(" / ");
  return `<li><a href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer">${escapeHtml(item.title || item.district || "物件")}</a><br><span>${escapeHtml(priceText)} / ${escapeHtml(meta)} / 相似度 ${escapeHtml(item.similarityScore)}</span></li>`;
};

const renderOptions = () => {
  $("#areaTolerance").value = String(state.options.areaTolerance);
  $("#matchDistrict").checked = state.options.matchDistrict;
  $("#matchType").checked = state.options.matchType;
  $("#matchRooms").checked = state.options.matchRooms;
};

const render = () => {
  renderFacts();
  renderComparison();
  renderOptions();
  $("#storeCount").textContent = `${state.items.length} 筆已收集`;
};

const refreshCurrent = async () => {
  try {
    setStatus("讀取目前頁面...");
    const response = await sendToActiveTab("SCRAPE_CURRENT");
    state.current = response?.listing || null;
    setStatus(state.current ? "已讀取目前物件。" : "無法判斷目前物件。", !state.current);
    render();
  } catch (error) {
    setStatus(`讀取失敗：${error.message}`, true);
  }
};

const collectList = async () => {
  try {
    setStatus("收集本頁列表...");
    const response = await sendToActiveTab("SCRAPE_LIST");
    const listings = response?.listings || [];
    const added = await upsertItems(listings);
    setStatus(`已收集 ${listings.length} 筆可用資料，新增 ${added} 筆。`);
  } catch (error) {
    setStatus(`收集失敗：${error.message}`, true);
  }
};

const autoMarketSearch = async () => {
  try {
    if (!state.current) await refreshCurrent();
    if (!state.current) return;

    const url = marketSearchUrl();
    if (!url) throw new Error("目前物件缺少區域條件，無法組搜尋頁");

    setStatus("正在自動搜尋同區行情...");
    await upsertItems([state.current]);

    let total = 0;
    let addedTotal = 0;
    for (const source of marketSearchUrls()) {
      if (source.marketKind === "transaction") continue;
      const tab = await chrome.tabs.create({ url: source.url, active: false });
      try {
        await waitForTabComplete(tab.id);
        await new Promise((resolve) => setTimeout(resolve, 1800));
        const response = await scrapeTab(tab.id, "SCRAPE_LIST");
        const listings = (response?.listings || []).map((item) => ({ ...item, marketKind: source.marketKind }));
        total += listings.length;
        addedTotal += await upsertItems(listings);
      } finally {
        if (tab.id) await chrome.tabs.remove(tab.id);
      }
    }
    setStatus(`已分析附近行情：收集 ${total} 筆，新增 ${addedTotal} 筆。實價登錄區塊會和開價行情分開顯示。`);
  } catch (error) {
    setStatus(`自動搜尋失敗：${error.message}`, true);
  }
};

const openMarketSearch = async () => {
  try {
    if (!state.current) await refreshCurrent();
    if (!state.current) return;
    const url = marketSearchUrls()[0]?.url || marketSearchUrl();
    if (!url) throw new Error("目前物件缺少區域條件，無法組搜尋頁");
    await chrome.tabs.create({ url, active: true });
    setStatus("已開啟 591 同區行情搜尋頁。");
  } catch (error) {
    setStatus(`開啟失敗：${error.message}`, true);
  }
};

const saveCurrent = async () => {
  if (!state.current) await refreshCurrent();
  if (!state.current) return;
  await upsertItems([state.current]);
  setStatus("已儲存目前物件。");
};

const clearStore = async () => {
  await storageSetListings([]);
  state.items = [];
  render();
  setStatus("已清除本機資料。");
};

const exportCsv = () => {
  const columns = ["mode", "marketKind", "source", "title", "totalPrice", "pricePerPing", "monthlyRent", "rentPerPing", "area", "city", "district", "buildingType", "type", "rooms", "floor", "totalFloors", "url", "collectedAt"];
  const rows = [
    columns.join(","),
    ...state.items.map((item) =>
      columns
        .map((column) => `"${String(item[column] ?? "").replaceAll('"', '""')}"`)
        .join(",")
    )
  ];
  const blob = new Blob([`\uFEFF${rows.join("\n")}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `house-market-items-${new Date().toISOString().slice(0, 10)}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
};

const saveOptionsFromUi = async () => {
  state.options = {
    areaTolerance: Number($("#areaTolerance").value),
    matchDistrict: $("#matchDistrict").checked,
    matchType: $("#matchType").checked,
    matchRooms: $("#matchRooms").checked
  };
  await storageSetOptions(state.options);
  renderComparison();
};

document.addEventListener("DOMContentLoaded", async () => {
  const stored = await storageGet();
  state.items = stored.items;
  state.options = stored.options;
  render();
  await refreshCurrent();

  $("#refresh").addEventListener("click", refreshCurrent);
  $("#saveCurrent").addEventListener("click", saveCurrent);
  $("#autoMarketSearch").addEventListener("click", autoMarketSearch);
  $("#openMarketSearch").addEventListener("click", openMarketSearch);
  $("#collectList").addEventListener("click", collectList);
  $("#clearStore").addEventListener("click", clearStore);
  $("#exportCsv").addEventListener("click", exportCsv);
  $("#resetOptions").addEventListener("click", async () => {
    state.options = { ...DEFAULT_OPTIONS };
    await storageSetOptions(state.options);
    render();
  });
  $("#areaTolerance").addEventListener("change", saveOptionsFromUi);
  $("#matchDistrict").addEventListener("change", saveOptionsFromUi);
  $("#matchType").addEventListener("change", saveOptionsFromUi);
  $("#matchRooms").addEventListener("change", saveOptionsFromUi);
});
