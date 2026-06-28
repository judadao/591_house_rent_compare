const text = (node) => (node ? node.textContent.replace(/\s+/g, " ").trim() : "");

const numberFrom = (value) => {
  if (!value) return null;
  const match = String(value).replace(/,/g, "").match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
};

const absoluteUrl = (href) => {
  try {
    return new URL(href, location.href).toString();
  } catch {
    return "";
  }
};

const listingIdFromUrl = (url) => {
  const match = url.match(/(?:rent-detail-|\/)(\d+)(?:\.html)?(?:[?#].*)?$/);
  return match ? match[1] : url;
};

const getMeta = (property) => {
  const node = document.querySelector(`meta[property="${property}"], meta[name="${property}"]`);
  return node?.content?.trim() || "";
};

const parseRegion = (sourceText) => {
  const compact = sourceText.replace(/\s/g, "");
  const match = compact.match(/([\u4e00-\u9fa5]{2,3}[市縣])([\u4e00-\u9fa5]{1,4}[區鄉鎮市])/);
  return {
    city: match?.[1] || "",
    district: match?.[2] || ""
  };
};

const parseLayout = (sourceText) => {
  const compact = sourceText.replace(/\s/g, "");
  const layout = compact.match(/(\d+)房(?:\d+廳)?(?:\d+衛)?/);
  return {
    rooms: layout ? Number(layout[1]) : null,
    livingRooms: numberFrom(compact.match(/(\d+)廳/)?.[1]),
    bathrooms: numberFrom(compact.match(/(\d+)衛/)?.[1])
  };
};

const inferType = (sourceText) => {
  const types = ["整層住家", "獨立套房", "分租套房", "雅房", "車位", "其他"];
  return types.find((type) => sourceText.includes(type)) || "";
};

const normalizeListing = (partial) => {
  const raw = `${partial.title || ""} ${partial.description || ""} ${partial.address || ""}`;
  const region = parseRegion(raw);
  const layout = parseLayout(raw);
  const area = partial.area || numberFrom(raw.match(/(\d+(?:\.\d+)?)\s*坪/)?.[1]);
  const price = partial.price || numberFrom(raw.match(/([\d,]+)\s*元\/月/)?.[1]);

  return {
    id: partial.id || listingIdFromUrl(partial.url || location.href),
    url: partial.url || location.href,
    title: partial.title || document.title,
    price,
    area,
    city: partial.city || region.city,
    district: partial.district || region.district,
    type: partial.type || inferType(raw),
    rooms: partial.rooms ?? layout.rooms,
    livingRooms: partial.livingRooms ?? layout.livingRooms,
    bathrooms: partial.bathrooms ?? layout.bathrooms,
    address: partial.address || "",
    collectedAt: new Date().toISOString()
  };
};

const scrapeCurrentListing = () => {
  const bodyText = text(document.body);
  const title =
    text(document.querySelector("h1")) ||
    getMeta("og:title") ||
    document.title.replace("591租屋網", "").trim();
  const description = getMeta("description") || bodyText.slice(0, 3000);
  const price =
    numberFrom(text(document.querySelector('[class*="price"], [class*="Price"]'))) ||
    numberFrom(bodyText.match(/([\d,]+)\s*元\/月/)?.[1]);

  return normalizeListing({
    title,
    description,
    price,
    url: location.href,
    address: bodyText.match(/地址[:：]?\s*([^\n。]{6,80})/)?.[1] || ""
  });
};

const scrapeListCards = () => {
  const anchors = [...document.querySelectorAll('a[href*="rent-detail"], a[href*="/rent/"]')];
  const cards = anchors
    .map((anchor) => anchor.closest("li, article, section, div") || anchor)
    .filter((card, index, all) => card && all.indexOf(card) === index)
    .slice(0, 80);

  return cards
    .map((card) => {
      const anchor = card.querySelector('a[href*="rent-detail"], a[href*="/rent/"]') || card;
      const cardText = text(card);
      const url = absoluteUrl(anchor.href || "");
      if (!url || !cardText.match(/元|坪|房/)) return null;

      return normalizeListing({
        id: listingIdFromUrl(url),
        url,
        title: text(anchor) || cardText.slice(0, 60),
        description: cardText,
        price: numberFrom(cardText.match(/([\d,]+)\s*元/)?.[1]),
        area: numberFrom(cardText.match(/(\d+(?:\.\d+)?)\s*坪/)?.[1])
      });
    })
    .filter((item) => item && item.price && item.area);
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
