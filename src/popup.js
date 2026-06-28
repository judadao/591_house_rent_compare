const $ = (selector) => document.querySelector(selector);

const DEFAULT_OPTIONS = {
  areaTolerance: 0.2,
  matchDistrict: true,
  matchType: true,
  matchRooms: true
};

const state = {
  current: null,
  listings: [],
  options: { ...DEFAULT_OPTIONS }
};

const escapeHtml = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

const currency = (value) => (Number.isFinite(value) ? `$${Math.round(value).toLocaleString("zh-TW")}` : "-");
const ping = (value) => (Number.isFinite(value) ? `${Number(value).toFixed(1)} 坪` : "-");
const boolText = (value) => (value ? "有" : "未判斷");

const setStatus = (message, isError = false) => {
  const status = $("#status");
  status.textContent = message;
  status.classList.toggle("error", isError);
};

const storageGet = () =>
  chrome.storage.local.get({ listings: [], options: DEFAULT_OPTIONS }).then((data) => ({
    listings: data.listings || [],
    options: { ...DEFAULT_OPTIONS, ...(data.options || {}) }
  }));

const storageSetListings = (listings) => chrome.storage.local.set({ listings });
const storageSetOptions = (options) => chrome.storage.local.set({ options });

const qualityIssues = (listing) => {
  if (!listing) return ["尚未讀取物件"];
  const issues = [];
  if (!listing.price) issues.push("缺租金");
  if (!listing.area) issues.push("缺坪數");
  if (!listing.city || !listing.district) issues.push("缺區域");
  if (!listing.type) issues.push("缺型態");
  if (!listing.rooms && listing.type === "整層住家") issues.push("缺房數");
  return issues;
};

const upsertListings = async (items) => {
  const existing = state.listings.length ? state.listings : (await storageGet()).listings;
  const byId = new Map(existing.map((item) => [item.id || item.url, item]));

  for (const item of items) {
    if (!item?.url || !item?.price) continue;
    byId.set(item.id || item.url, { ...byId.get(item.id || item.url), ...item });
  }

  const next = [...byId.values()].sort((a, b) => Date.parse(b.collectedAt) - Date.parse(a.collectedAt));
  await storageSetListings(next);
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
  if (!tab.url?.includes("591.com.tw")) throw new Error("請先開啟 591 租屋頁面");

  try {
    return await chrome.tabs.sendMessage(tab.id, { type });
  } catch {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["src/listingParser.js", "src/contentScript.js"]
    });
    return chrome.tabs.sendMessage(tab.id, { type });
  }
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
    ["租金", `${currency(listing.price)} / 月`],
    ["坪數", ping(listing.area)],
    ["區域", [listing.city, listing.district].filter(Boolean).join("") || "-"],
    ["型態", listing.type || "-"],
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

const comparableScore = (base, item) => {
  let score = 0;
  if (base.district && item.district === base.district) score += 6;
  if (base.city && item.city === base.city) score += 3;
  if (base.type && item.type === base.type) score += 3;
  if (base.rooms && item.rooms === base.rooms) score += 2;
  if (base.hasElevator && item.hasElevator) score += 1;
  if (base.area && item.area) score -= Math.abs(item.area - base.area) / base.area;
  return score;
};

const findComparables = () => {
  const base = state.current;
  if (!base) return [];
  const tolerance = Number(state.options.areaTolerance);
  const areaMin = base.area ? base.area * (1 - tolerance) : 0;
  const areaMax = base.area ? base.area * (1 + tolerance) : Infinity;

  return state.listings
    .filter((item) => item.url !== base.url)
    .filter((item) => !base.city || !item.city || item.city === base.city)
    .filter((item) => !state.options.matchDistrict || !base.district || !item.district || item.district === base.district)
    .filter((item) => !state.options.matchType || !base.type || !item.type || item.type === base.type)
    .filter((item) => !state.options.matchRooms || !base.rooms || !item.rooms || item.rooms === base.rooms)
    .filter((item) => !base.area || !item.area || (item.area >= areaMin && item.area <= areaMax))
    .sort((a, b) => comparableScore(base, b) - comparableScore(base, a))
    .slice(0, 10);
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
    summary.textContent = "尚無足夠的同條件資料。先到 591 搜尋結果頁按「收集列表」。";
    list.innerHTML = "";
    return;
  }

  const medianPrice = median(comparables.map((item) => item.price));
  const medianUnit = median(comparables.map((item) => (item.area ? item.price / item.area : null)));
  const baseUnit = base.area ? base.price / base.area : null;
  const diff = medianPrice && base.price ? base.price - medianPrice : null;
  const diffText = diff === null ? "" : diff >= 0 ? `高 ${currency(diff)}` : `低 ${currency(Math.abs(diff))}`;

  summary.innerHTML = [
    `找到 <strong>${comparables.length}</strong> 筆相近物件。`,
    `中位租金 <strong>${currency(medianPrice)}</strong>，每坪 <strong>${currency(medianUnit)}</strong>。`,
    baseUnit ? `目前每坪 <strong>${currency(baseUnit)}</strong>。` : "",
    diffText ? `總租金比中位數<strong>${diffText}</strong>。` : ""
  ].join(" ");

  list.innerHTML = comparables
    .map((item) => {
      const unit = item.area ? `${currency(item.price / item.area)}/坪` : "-";
      const meta = [[item.city, item.district].filter(Boolean).join(""), item.type, ping(item.area), unit]
        .filter(Boolean)
        .join(" / ");
      return `<li><a href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer">${escapeHtml(item.title || item.district || "物件")}</a><br><span>${escapeHtml(currency(item.price))} / ${escapeHtml(meta)}</span></li>`;
    })
    .join("");
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
    const added = await upsertListings(listings);
    setStatus(`已收集 ${listings.length} 筆可用資料，新增 ${added} 筆。`);
  } catch (error) {
    setStatus(`收集失敗：${error.message}`, true);
  }
};

const saveCurrent = async () => {
  if (!state.current) await refreshCurrent();
  if (!state.current) return;
  await upsertListings([state.current]);
  setStatus("已儲存目前物件。");
};

const clearStore = async () => {
  await storageSetListings([]);
  state.listings = [];
  render();
  setStatus("已清除本機資料。");
};

const exportCsv = () => {
  const columns = ["title", "price", "area", "city", "district", "type", "rooms", "floor", "totalFloors", "url", "collectedAt"];
  const rows = [
    columns.join(","),
    ...state.listings.map((item) =>
      columns
        .map((column) => `"${String(item[column] ?? "").replaceAll('"', '""')}"`)
        .join(",")
    )
  ];
  const blob = new Blob([`\uFEFF${rows.join("\n")}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `591-rent-listings-${new Date().toISOString().slice(0, 10)}.csv`;
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
  state.listings = stored.listings;
  state.options = stored.options;
  render();
  await refreshCurrent();

  $("#refresh").addEventListener("click", refreshCurrent);
  $("#saveCurrent").addEventListener("click", saveCurrent);
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
