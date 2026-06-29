(function initRentSearchAverage() {
  if (globalThis.__rentSearchAverageLoaded) return;
  globalThis.__rentSearchAverageLoaded = true;

  const parser = globalThis.RentCompareParser;
  const STYLE_ID = "rent-avg-compare-style";
  const SUMMARY_ID = "rent-avg-compare-summary";
  const BADGE_CLASS = "rent-avg-compare-badge";
  const PROCESSED_ATTR = "data-rent-avg-compare";
  const ENABLED_KEY = "rentAverageEnabled";
  const REFRESH_DELAY_MS = 250;
  let refreshTimer = 0;
  let observer = null;
  let enabled = true;

  const text = (node) => (node ? node.textContent.replace(/\s+/g, " ").trim() : "");

  const absoluteUrl = (href) => {
    try {
      return new URL(href, location.href).toString();
    } catch {
      return "";
    }
  };

  const currency = (value) => (Number.isFinite(value) ? `$${Math.round(value).toLocaleString("zh-TW")}` : "-");

  const percentText = (value, average) => {
    if (!Number.isFinite(value) || !Number.isFinite(average) || average === 0) return "";
    const percent = Math.abs(((value - average) / average) * 100);
    return `${Math.round(percent * 10) / 10}%`;
  };

  const ensureStyles = () => {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      #${SUMMARY_ID}{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:10px 0;padding:10px 12px;border:1px solid #cbd5e1;border-radius:6px;background:#f8fafc;color:#334155;font:16px/1.45 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
      #${SUMMARY_ID} strong{color:#0f766e}
      .${BADGE_CLASS}{display:inline-flex;align-items:center;vertical-align:middle;margin-left:8px;padding:4px 8px;border-radius:4px;font:15px/1.4 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-weight:750;white-space:nowrap}
      .${BADGE_CLASS}.is-high{color:#b42318;background:#fee4e2}
      .${BADGE_CLASS}.is-low{color:#175cd3;background:#dbeafe}
      .${BADGE_CLASS}.is-average{color:#166534;background:#dcfce7}
    `;
    document.documentElement.appendChild(style);
  };

  const isRentSearchPage = () =>
    /(^|\.)rent\.591\.com\.tw$/.test(location.hostname) &&
    !/\/(?:\d+|rent-detail-\d+)/.test(location.pathname);

  const findRentAnchors = () =>
    [...document.querySelectorAll('a[href*="rent.591.com.tw"], a[href*="/rent/"], a[href*="rent-detail"]')]
      .filter((anchor) => {
        const url = absoluteUrl(anchor.href || "");
        if (!url) return false;
        if (/rent\.591\.com\.tw\/(?:list)?\?/.test(url)) return false;
        return /rent\.591\.com\.tw\/(?:\d+|rent-detail-\d+)|\/rent\/\d+|rent_id=\d+/.test(url);
      });

  const closestCard = (anchor) => {
    const candidates = [];
    let node = anchor;
    while (node && node !== document.body && candidates.length < 7) {
      if (node instanceof HTMLElement) candidates.push(node);
      node = node.parentElement;
    }
    return candidates.find((candidate) => {
      const raw = text(candidate);
      return /(?:元\/月|元|\/月)/.test(raw) && /(?:坪|房|套房|雅房|整層住家|租金)/.test(raw);
    }) || anchor;
  };

  const findPriceNode = (card) => {
    const nodes = [...card.querySelectorAll("span, div, strong, em, b, p")];
    return (
      nodes.find((node) => /[\d,]+\s*(?:元\/月|元|\/月)/.test(text(node))) ||
      nodes.find((node) => /[\d,]+/.test(text(node)) && /price|rent|money/i.test(node.className || "")) ||
      card
    );
  };

  const listingFromCard = (card, anchor) => {
    const cardText = text(card);
    const url = absoluteUrl(anchor.href || "");
    const price =
      parser.numberFrom(cardText.match(/([\d,]+)\s*元\/月/)?.[1]) ||
      parser.numberFrom(cardText.match(/租金[^\d]{0,20}([\d,]+)\s*(?:元|\/月)/)?.[1]) ||
      parser.numberFrom(cardText.match(/([\d,]+)\s*\/月/)?.[1]) ||
      parser.numberFrom(cardText.match(/([\d,]+)\s*元/)?.[1]);
    if (!price || price < 1000) return null;

    return {
      id: parser.listingIdFromUrl(url),
      url,
      card,
      anchor,
      priceNode: findPriceNode(card),
      monthlyRent: price,
      title: text(anchor) || cardText.slice(0, 80)
    };
  };

  const scrapeSearchPageListings = () => {
    const byKey = new Map();
    for (const anchor of findRentAnchors()) {
      const card = closestCard(anchor);
      const item = listingFromCard(card, anchor);
      if (!item) continue;
      byKey.set(item.id || item.url, item);
    }
    return [...byKey.values()];
  };

  const removeBadges = () => {
    document.querySelectorAll(`.${BADGE_CLASS}`).forEach((node) => node.remove());
    document.querySelectorAll(`[${PROCESSED_ATTR}]`).forEach((node) => node.removeAttribute(PROCESSED_ATTR));
  };

  const clearAnnotations = () => {
    observer?.disconnect();
    clearTimeout(refreshTimer);
    removeBadges();
    document.getElementById(SUMMARY_ID)?.remove();
    observer?.observe(document.documentElement, { childList: true, subtree: true });
    return { count: 0, average: null };
  };

  const renderSummary = (average, count) => {
    let summary = document.getElementById(SUMMARY_ID);
    if (!summary) {
      summary = document.createElement("div");
      summary.id = SUMMARY_ID;
      const target =
        document.querySelector('[class*="list"], [class*="List"], main, #app') ||
        document.body;
      target.prepend(summary);
    }
    summary.innerHTML = `本頁租金平均 <strong>${currency(average)}</strong><span>採計 ${count} 筆有價格的租屋物件</span>`;
  };

  const renderBadge = (item, average) => {
    if (item.priceNode?.getAttribute(PROCESSED_ATTR) === "1") return;
    const diff = item.monthlyRent - average;
    const className = Math.abs(diff) < 1 ? "is-average" : diff > 0 ? "is-high" : "is-low";
    const label = Math.abs(diff) < 1
      ? "等於平均"
      : diff > 0
        ? `高於平均 ${currency(diff)} (${percentText(item.monthlyRent, average)})`
        : `低於平均 ${currency(Math.abs(diff))} (${percentText(item.monthlyRent, average)})`;
    const badge = document.createElement("span");
    badge.className = `${BADGE_CLASS} ${className}`;
    badge.textContent = label;
    badge.title = `本頁平均租金 ${currency(average)}`;
    item.priceNode?.appendChild(badge);
    item.priceNode?.setAttribute(PROCESSED_ATTR, "1");
  };

  const annotateRentSearchPage = () => {
    if (!parser || !isRentSearchPage()) return { count: 0, average: null };
    if (!enabled) return clearAnnotations();
    observer?.disconnect();
    ensureStyles();
    removeBadges();
    const listings = scrapeSearchPageListings();
    const prices = listings.map((item) => item.monthlyRent).filter(Number.isFinite);
    const average = prices.length ? prices.reduce((sum, price) => sum + price, 0) / prices.length : null;
    const summary = document.getElementById(SUMMARY_ID);
    if (!Number.isFinite(average)) {
      summary?.remove();
      observer?.observe(document.documentElement, { childList: true, subtree: true });
      return { count: 0, average: null };
    }
    renderSummary(average, prices.length);
    listings.forEach((item) => renderBadge(item, average));
    observer?.observe(document.documentElement, { childList: true, subtree: true });
    return { count: listings.length, average };
  };

  const scheduleAnnotate = () => {
    if (!enabled) return;
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(annotateRentSearchPage, REFRESH_DELAY_MS);
  };

  const setEnabled = (value) => {
    enabled = value !== false;
    return enabled ? annotateRentSearchPage() : clearAnnotations();
  };

  globalThis.chrome?.runtime?.onMessage?.addListener?.((message, _sender, sendResponse) => {
    if (message?.type === "ANNOTATE_RENT_AVERAGE") {
      sendResponse({ ok: true, ...annotateRentSearchPage() });
      return true;
    }
    if (message?.type === "SET_RENT_AVERAGE_ENABLED") {
      sendResponse({ ok: true, enabled: message.enabled !== false, ...setEnabled(message.enabled) });
      return true;
    }
    if (message?.type === "GET_RENT_AVERAGE_STATE") {
      sendResponse({ ok: true, enabled });
      return true;
    }
    if (message?.type === "SCRAPE_LIST") {
      const listings = scrapeSearchPageListings().map(({ card, anchor, priceNode, ...item }) =>
        parser.normalizeListing({
          id: item.id,
          url: item.url,
          title: item.title,
          description: text(card),
          price: item.monthlyRent,
          mode: "rent",
          marketKind: "listing"
        }, item.url)
      );
      sendResponse({ ok: true, listings });
      return true;
    }
    return false;
  });

  const start = async () => {
    const data = await globalThis.chrome?.storage?.local?.get?.({ [ENABLED_KEY]: true });
    enabled = data?.[ENABLED_KEY] !== false;
    if (enabled) annotateRentSearchPage();
  };

  globalThis.chrome?.storage?.onChanged?.addListener?.((changes, areaName) => {
    if (areaName !== "local" || !changes[ENABLED_KEY]) return;
    setEnabled(changes[ENABLED_KEY].newValue);
  });

  setTimeout(() => {
    start().catch(() => annotateRentSearchPage());
  }, 500);
  observer = new MutationObserver(scheduleAnnotate);
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
