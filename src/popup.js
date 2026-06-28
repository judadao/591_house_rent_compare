const $ = (selector) => document.querySelector(selector);

const state = {
  current: null,
  listings: []
};

const escapeHtml = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

const currency = (value) => (value ? `$${Math.round(value).toLocaleString("zh-TW")}` : "-");
const ping = (value) => (value ? `${Number(value).toFixed(1)} 坪` : "-");

const setStatus = (message, isError = false) => {
  const status = $("#status");
  status.textContent = message;
  status.classList.toggle("error", isError);
};

const storageGet = () =>
  chrome.storage.local.get({ listings: [] }).then((data) => data.listings || []);

const storageSet = (listings) => chrome.storage.local.set({ listings });

const upsertListings = async (items) => {
  const existing = await storageGet();
  const byId = new Map(existing.map((item) => [item.id || item.url, item]));

  for (const item of items) {
    if (!item?.url || !item?.price) continue;
    byId.set(item.id || item.url, { ...byId.get(item.id || item.url), ...item });
  }

  const next = [...byId.values()].sort((a, b) => Date.parse(b.collectedAt) - Date.parse(a.collectedAt));
  await storageSet(next);
  state.listings = next;
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

  try {
    return await chrome.tabs.sendMessage(tab.id, { type });
  } catch {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["src/contentScript.js"]
    });
    return chrome.tabs.sendMessage(tab.id, { type });
  }
};

const renderFacts = () => {
  const listing = state.current;
  const facts = $("#currentListing");
  if (!listing) {
    facts.innerHTML = "<dt>狀態</dt><dd>尚未讀取</dd>";
    return;
  }

  facts.innerHTML = [
    ["標題", listing.title || "-"],
    ["租金", `${currency(listing.price)} / 月`],
    ["坪數", ping(listing.area)],
    ["區域", [listing.city, listing.district].filter(Boolean).join("") || "-"],
    ["類型", listing.type || "-"],
    ["格局", listing.rooms ? `${listing.rooms} 房` : "-"]
  ]
    .map(([key, value]) => `<dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value)}</dd>`)
    .join("");
};

const comparableScore = (base, item) => {
  let score = 0;
  if (base.district && item.district === base.district) score += 5;
  if (base.city && item.city === base.city) score += 2;
  if (base.type && item.type === base.type) score += 2;
  if (base.rooms && item.rooms === base.rooms) score += 2;
  if (base.area && item.area) score -= Math.abs(item.area - base.area) / base.area;
  return score;
};

const findComparables = () => {
  const base = state.current;
  if (!base) return [];
  const areaMin = base.area ? base.area * 0.8 : 0;
  const areaMax = base.area ? base.area * 1.2 : Infinity;

  return state.listings
    .filter((item) => item.url !== base.url)
    .filter((item) => !base.city || !item.city || item.city === base.city)
    .filter((item) => !base.district || !item.district || item.district === base.district)
    .filter((item) => !base.type || !item.type || item.type === base.type)
    .filter((item) => !base.rooms || !item.rooms || item.rooms === base.rooms)
    .filter((item) => !base.area || !item.area || (item.area >= areaMin && item.area <= areaMax))
    .sort((a, b) => comparableScore(base, b) - comparableScore(base, a))
    .slice(0, 8);
};

const median = (values) => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

const renderComparison = () => {
  const summary = $("#summary");
  const list = $("#comparables");
  const base = state.current;
  const comparables = findComparables();

  if (!base) {
    summary.textContent = "開啟 591 物件頁後可比較。";
    list.innerHTML = "";
    return;
  }

  if (!comparables.length) {
    summary.textContent = "尚無足夠的同條件資料。先到 591 搜尋結果頁按「收集本頁列表」。";
    list.innerHTML = "";
    return;
  }

  const medianPrice = median(comparables.map((item) => item.price));
  const medianUnit = median(comparables.map((item) => item.area ? item.price / item.area : null));
  const diff = medianPrice ? base.price - medianPrice : null;
  const diffText = diff === null ? "" : diff >= 0 ? `高 ${currency(diff)}` : `低 ${currency(Math.abs(diff))}`;

  summary.innerHTML = [
    `找到 <strong>${comparables.length}</strong> 筆相近物件。`,
    `中位租金 <strong>${currency(medianPrice)}</strong>，每坪 <strong>${currency(medianUnit)}</strong>。`,
    diffText ? `目前物件比中位數<strong>${diffText}</strong>。` : ""
  ].join(" ");

  list.innerHTML = comparables
    .map((item) => {
      const unit = item.area ? `${currency(item.price / item.area)}/坪` : "-";
      return `<li><a href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer">${escapeHtml(item.title || item.district || "物件")}</a><br>${escapeHtml(currency(item.price))} / ${escapeHtml(ping(item.area))} / ${escapeHtml(unit)}</li>`;
    })
    .join("");
};

const render = () => {
  renderFacts();
  renderComparison();
  $("#storeCount").textContent = `${state.listings.length} 筆已收集`;
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
    await upsertListings(listings);
    setStatus(`已從本頁收集 ${listings.length} 筆可用資料。`);
  } catch (error) {
    setStatus(`收集失敗：${error.message}`, true);
  }
};

const saveCurrent = async () => {
  if (!state.current) {
    await refreshCurrent();
  }
  if (!state.current) return;
  await upsertListings([state.current]);
  setStatus("已儲存目前物件。");
};

const clearStore = async () => {
  await storageSet([]);
  state.listings = [];
  render();
  setStatus("已清除本機資料。");
};

document.addEventListener("DOMContentLoaded", async () => {
  state.listings = await storageGet();
  render();
  await refreshCurrent();

  $("#refresh").addEventListener("click", refreshCurrent);
  $("#saveCurrent").addEventListener("click", saveCurrent);
  $("#collectList").addEventListener("click", collectList);
  $("#clearStore").addEventListener("click", clearStore);
});
