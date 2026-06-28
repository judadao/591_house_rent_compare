(function initContentScript() {
if (globalThis.__rentCompareContentScriptLoaded) return;
globalThis.__rentCompareContentScriptLoaded = true;

const parser = globalThis.RentCompareParser;
const analyzer = globalThis.RentCompareMarketAnalyzer;

const text = (node) => (node ? node.textContent.replace(/\s+/g, " ").trim() : "");

const absoluteUrl = (href) => {
  try {
    return new URL(href, location.href).toString();
  } catch {
    return "";
  }
};

const getMeta = (property) => {
  const node = document.querySelector(`meta[property="${property}"], meta[name="${property}"]`);
  return node?.content?.trim() || "";
};

const getJsonLd = () => {
  const nodes = [...document.querySelectorAll('script[type="application/ld+json"]')];
  for (const node of nodes) {
    try {
      const parsed = JSON.parse(node.textContent);
      const data = Array.isArray(parsed) ? parsed[0] : parsed;
      if (data && typeof data === "object") return data;
    } catch {
      continue;
    }
  }
  return {};
};

const scrapeCurrentListing = () => {
  const bodyText = text(document.body);
  const jsonLd = getJsonLd();
  const title =
    text(document.querySelector("h1")) ||
    jsonLd.name ||
    getMeta("og:title") ||
    document.title.replace("591租屋網", "").trim();
  const description = getMeta("description") || jsonLd.description || bodyText.slice(0, 3500);
  const latitude =
    parser.numberFrom(jsonLd.geo?.latitude) ||
    parser.numberFrom(document.querySelector('[itemprop="latitude"]')?.content) ||
    parser.numberFrom(getMeta("place:location:latitude"));
  const longitude =
    parser.numberFrom(jsonLd.geo?.longitude) ||
    parser.numberFrom(document.querySelector('[itemprop="longitude"]')?.content) ||
    parser.numberFrom(getMeta("place:location:longitude"));
  const price =
    parser.numberFrom(text(document.querySelector('[class*="price"], [class*="Price"]'))) ||
    parser.numberFrom(jsonLd.offers?.price) ||
    parser.numberFrom(bodyText.match(/([\d,]+)\s*(?:元\/月|元|\/月)/)?.[1]);

  return parser.normalizeListing(
    {
      title,
      description,
      price,
      url: location.href,
      source: location.hostname,
      latitude,
      longitude,
      address: jsonLd.address?.streetAddress || bodyText.match(/地址[:：]?\s*([^\n。]{6,80})/)?.[1] || ""
    },
    location.href
  );
};

const scrapeListCards = () => {
  const linkSelector = [
    'a[href*="rent-detail"]',
    'a[href*="/rent/"]',
    'a[href*="rent_id="]',
    'a[href*="sale.591.com.tw"]',
    'a[href*="/home/house/detail"]',
    'a[href*="/buy/"]',
    'a[href*="/sale/"]',
    'a[href*="house"]'
  ].join(",");
  const anchors = [...document.querySelectorAll(linkSelector)];
  const cards = anchors
    .map((anchor) => anchor.closest("li, article, section, div") || anchor)
    .filter((card, index, all) => card && all.indexOf(card) === index)
    .slice(0, 100);

  return cards
    .map((card) => {
      const anchor = card.querySelector(linkSelector) || card;
      const cardText = text(card);
      const url = absoluteUrl(anchor.href || "");
      if (!url || !/(元|萬|坪|房|套房|雅房|大樓|公寓|華廈)/.test(cardText)) return null;

      return parser.normalizeListing(
        {
          id: parser.listingIdFromUrl(url),
          url,
          source: location.hostname,
          title: text(anchor) || cardText.slice(0, 70),
          description: cardText,
          price: parser.numberFrom(cardText.match(/([\d,]+)\s*(?:元\/月|元|\/月)/)?.[1]),
          area: parser.numberFrom(cardText.match(/(\d+(?:\.\d+)?)\s*坪/)?.[1])
        },
        location.href
      );
    })
    .filter((item) => item && item.price && item.area);
};

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

const panelStyles = `
  #hmk-panel{position:fixed;right:16px;top:88px;z-index:2147483647;width:340px;max-height:78vh;overflow:auto;border:1px solid #cbd5e1;border-radius:8px;background:#fff;color:#1f2933;box-shadow:0 16px 40px rgba(15,23,42,.22);font:13px/1.45 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
  #hmk-panel header{display:flex;justify-content:space-between;gap:8px;align-items:center;padding:10px 12px;background:#1f5f5b;color:#fff}
  #hmk-panel h2,#hmk-panel h3,#hmk-panel p{margin:0}
  #hmk-panel h2{font-size:15px}
  #hmk-panel h3{font-size:13px;margin:10px 0 5px}
  #hmk-panel button{border:0;border-radius:6px;padding:7px 9px;cursor:pointer;font-weight:650}
  #hmk-panel .hmk-close{background:rgba(255,255,255,.16);color:#fff}
  #hmk-panel .hmk-body{padding:10px 12px}
  #hmk-panel .hmk-current{margin-bottom:8px;color:#475569}
  #hmk-panel .hmk-action{width:100%;margin:8px 0;background:#236f68;color:#fff}
  #hmk-panel .hmk-switch{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin:8px 0}
  #hmk-panel .hmk-switch button{background:#e2e8f0;color:#334155}
  #hmk-panel .hmk-switch button.active{background:#236f68;color:#fff}
  #hmk-panel .hmk-muted{color:#64748b}
  #hmk-panel .hmk-report{border-top:1px solid #e2e8f0;padding-top:8px;margin-top:8px}
  #hmk-panel .hmk-slices{margin-top:8px;border-radius:6px;background:#f8fafc;padding:8px}
  #hmk-panel .hmk-slices p{margin:0 0 5px}
  #hmk-panel .hmk-slices summary{cursor:pointer;font-weight:650}
  #hmk-panel .hmk-slices ul{margin:5px 0 0;padding-left:18px}
  #hmk-panel strong{color:#0f766e}
  #hmk-panel ol{margin:6px 0 0;padding-left:18px}
  #hmk-panel li{margin-bottom:6px}
  #hmk-panel a{color:#1d4ed8;text-decoration:none;font-weight:650}
`;

const analysisKey = (listing, mode) => `analysis:${listing.id || listing.url}:${mode}`;

const requestNearbyAnalysis = async (listing, mode, { force = false } = {}) => {
  const key = analysisKey(listing, mode);
  const cooldownMs = 6 * 60 * 60 * 1000;
  const stored = await chrome.storage.local.get({ analysisTimestamps: {} });
  const lastRun = stored.analysisTimestamps[key] || 0;
  if (!force && Date.now() - lastRun < cooldownMs) {
    return { ok: true, skipped: true };
  }

  const response = await chrome.runtime.sendMessage({
    type: "ANALYZE_NEARBY",
    listing,
    analysisMode: listing.mode === "sale" ? mode : ""
  });
  if (response?.ok) {
    await chrome.storage.local.set({
      analysisTimestamps: {
        ...stored.analysisTimestamps,
        [key]: Date.now()
      }
    });
  }
  return response;
};

const marketBucketHtml = (bucket, mode) => {
  const hasData = bucket.count > 0;
  const slice = bucket.marketSlice || {};
  const unitText = mode === "sale" ? unitWan(bucket.medianUnit) : `${currency(bucket.medianUnit)}/坪`;
  const primaryText = mode === "sale" ? wan(bucket.medianPrimary) : currency(bucket.medianPrimary);
  const diff =
    bucket.diffPercent === null
      ? ""
      : bucket.diffPercent >= 0
        ? `偏高 ${Math.abs(bucket.diffPercent).toFixed(1)}%`
        : `偏低 ${Math.abs(bucket.diffPercent).toFixed(1)}%`;

  return `
    <section class="hmk-report">
      <h3>${escapeHtml(bucket.label)}</h3>
      <p class="hmk-muted">範圍內物件 <strong>${escapeHtml(slice.scopeCount ?? 0)}</strong> 筆，預設 5km 半徑；無座標時以區域塊/行政區估算。</p>
      ${
        hasData
          ? `<p>相似案例 <strong>${bucket.count}</strong> 筆，中位數 <strong>${escapeHtml(primaryText)}</strong>，每坪 <strong>${escapeHtml(unitText)}</strong>${diff ? `，目前約 <strong>${escapeHtml(diff)}</strong>` : ""}。</p>`
          : `<p class="hmk-muted">目前本機資料不足，按下方按鈕自動抓附近行情。</p><button class="hmk-action hmk-inline-action">分析附近行情</button>`
      }
      ${marketSliceHtml(slice, mode)}
      <ol>
        ${bucket.comparables
          .slice(0, 4)
          .map((item) => `<li><a href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer">${escapeHtml(item.title || "物件")}</a><br><span class="hmk-muted">${escapeHtml(item.mode === "sale" ? `${wan(item.totalPrice)} / ${unitWan(analyzer.unitValue(item))}` : `${currency(item.monthlyRent)} / ${currency(analyzer.unitValue(item))}/坪`)}</span></li>`)
          .join("")}
      </ol>
    </section>
  `;
};

const summaryPrice = (summary, mode) => {
  if (!summary || !summary.count) return "-";
  return mode === "sale"
    ? `${unitWan(summary.medianUnit)}`
    : `${currency(summary.medianPrimary)} / ${currency(summary.medianUnit)}/坪`;
};

const marketSliceHtml = (slice, mode) => {
  if (!slice?.scopeCount) return "";
  const ageRows = (slice.ageBuckets || [])
    .slice(0, 5)
    .map((bucket) => `<li>${escapeHtml(bucket.label)}：${escapeHtml(bucket.count)} 筆，${escapeHtml(summaryPrice(bucket, mode))}</li>`)
    .join("");

  return `
    <div class="hmk-slices">
      <p><strong>同坪數</strong>：${escapeHtml(slice.sameSizeSummary?.count || 0)} 筆，${escapeHtml(summaryPrice(slice.sameSizeSummary, mode))}</p>
      <p><strong>附加條件</strong>：${escapeHtml(slice.featureSummary?.count || 0)} 筆，${escapeHtml(summaryPrice(slice.featureSummary, mode))}</p>
      <details open>
        <summary>主要屋齡區間價格</summary>
        <ul>${ageRows || "<li>屋齡資料不足</li>"}</ul>
      </details>
    </div>
  `;
};

const renderInPagePanel = async (statusText = "") => {
  if (!analyzer || !chrome?.storage?.local) return;
  const current = scrapeCurrentListing();
  const data = await chrome.storage.local.get({ listings: [], options: {}, panelMode: "" });
  const panelMode = data.panelMode || current.mode;
  const report = analyzer.analyzeMarket(current, data.listings || [], { ...(data.options || {}), analysisMode: panelMode });
  const buckets = panelMode === "sale" ? [report.listing, report.transaction] : [report.rent];
  const saleReport = analyzer.analyzeMarket({ ...current, mode: "sale" }, data.listings || [], { ...(data.options || {}), analysisMode: "sale", regionScope: "city" });
  const estimatedPricePerPing = saleReport?.transaction?.medianUnit || saleReport?.listing?.medianUnit || null;
  const estimatedMortgage = current.mode === "rent"
    ? analyzer.estimateMortgagePayment({ pricePerPing: estimatedPricePerPing, area: current.area })
    : null;

  let panel = document.querySelector("#hmk-panel");
  if (!panel) {
    const style = document.createElement("style");
    style.textContent = panelStyles;
    document.documentElement.appendChild(style);
    panel = document.createElement("aside");
    panel.id = "hmk-panel";
    document.documentElement.appendChild(panel);
  }

  panel.innerHTML = `
    <header>
      <div>
        <h2>房價行情比較</h2>
        <p>${escapeHtml(current.mode === "sale" ? "買房：開價與實價分開看" : "租屋：附近租金行情")}</p>
      </div>
      <button class="hmk-close" title="關閉">×</button>
    </header>
    <div class="hmk-body">
      <p class="hmk-current">${escapeHtml([current.city, current.district, current.buildingType || current.type, ping(current.area)].filter(Boolean).join(" / "))}</p>
      ${
        current.mode === "sale"
          ? `<div class="hmk-switch"><button data-mode="sale" class="${panelMode === "sale" ? "active" : ""}">比買房</button><button data-mode="rent" class="${panelMode === "rent" ? "active" : ""}">比租屋</button></div>`
          : ""
      }
      <button class="hmk-action">分析附近行情</button>
      ${statusText ? `<p class="hmk-muted">${escapeHtml(statusText)}</p>` : ""}
      ${current.mode === "rent" ? `<section class="hmk-report"><h3>買這類房每月房貸估算</h3><p>${estimatedMortgage ? `以同區買賣行情估算，30 年期、2 成自備、年利率 2.5%，每月約 <strong>${escapeHtml(currency(estimatedMortgage))}</strong>。` : "目前買賣行情資料不足，分析附近行情後會嘗試估算。"}</p></section>` : ""}
      ${buckets.map((bucket) => marketBucketHtml(bucket, panelMode)).join("")}
    </div>
  `;

  panel.querySelector(".hmk-close").addEventListener("click", () => panel.remove());
  panel.querySelectorAll("[data-mode]").forEach((button) => {
    button.addEventListener("click", async () => {
      await chrome.storage.local.set({ panelMode: button.dataset.mode });
      await renderInPagePanel();
    });
  });
  panel.querySelectorAll(".hmk-action").forEach((button) => {
    button.addEventListener("click", async () => {
      panel.querySelectorAll(".hmk-action").forEach((actionButton) => {
        actionButton.disabled = true;
        actionButton.textContent = "分析中...";
      });
      const response = await requestNearbyAnalysis(current, panelMode, { force: true });
      await renderInPagePanel(response?.ok ? `已收集 ${response.scraped} 筆，新增 ${response.added} 筆。` : `分析失敗：${response?.error || "未知錯誤"}`);
    });
  });

  requestNearbyAnalysis(current, panelMode).then((response) => {
    if (response?.ok && !response.skipped && response.scraped > 0) {
      renderInPagePanel(`背景已更新：收集 ${response.scraped} 筆，新增 ${response.added} 筆。`).catch(() => {});
    }
  }).catch(() => {});
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "SCRAPE_CURRENT") {
    sendResponse({ ok: true, listing: scrapeCurrentListing() });
    return true;
  }

  if (message?.type === "SCRAPE_LIST") {
    sendResponse({ ok: true, listings: scrapeListCards() });
    return true;
  }

  return false;
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "TOGGLE_PANEL") {
    const panel = document.querySelector("#hmk-panel");
    if (panel) {
      panel.remove();
      chrome.storage.local.set({ panelEnabled: false });
      sendResponse({ ok: true, visible: false });
    } else {
      chrome.storage.local.set({ panelEnabled: true }).then(() => renderInPagePanel());
      sendResponse({ ok: true, visible: true });
    }
    return true;
  }

  return false;
});

let lastUrl = location.href;
const showPanelIfEnabled = async () => {
  if (/lvr\.land\.moi/.test(location.hostname)) return;
  const data = await chrome.storage.local.get({ panelEnabled: false });
  if (data.panelEnabled) await renderInPagePanel();
};

setTimeout(() => {
  showPanelIfEnabled().catch(() => {});
}, 800);

setInterval(() => {
  if (location.href === lastUrl) return;
  lastUrl = location.href;
  setTimeout(() => showPanelIfEnabled().catch(() => {}), 800);
}, 1000);
})();
