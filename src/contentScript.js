(function initContentScript() {
const parser = globalThis.RentCompareParser;

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
      address: jsonLd.address?.streetAddress || bodyText.match(/地址[:：]?\s*([^\n。]{6,80})/)?.[1] || ""
    },
    location.href
  );
};

const scrapeListCards = () => {
  const anchors = [...document.querySelectorAll('a[href*="rent-detail"], a[href*="/rent/"], a[href*="rent_id="]')];
  const cards = anchors
    .map((anchor) => anchor.closest("li, article, section, div") || anchor)
    .filter((card, index, all) => card && all.indexOf(card) === index)
    .slice(0, 100);

  return cards
    .map((card) => {
      const anchor = card.querySelector('a[href*="rent-detail"], a[href*="/rent/"], a[href*="rent_id="]') || card;
      const cardText = text(card);
      const url = absoluteUrl(anchor.href || "");
      if (!url || !/(元|坪|房|套房|雅房)/.test(cardText)) return null;

      return parser.normalizeListing(
        {
          id: parser.listingIdFromUrl(url),
          url,
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
})();
