(function initParser(globalScope) {
  const TAIWAN_CITIES = [
    "台北市",
    "新北市",
    "桃園市",
    "台中市",
    "台南市",
    "高雄市",
    "基隆市",
    "新竹市",
    "嘉義市",
    "新竹縣",
    "苗栗縣",
    "彰化縣",
    "南投縣",
    "雲林縣",
    "嘉義縣",
    "屏東縣",
    "宜蘭縣",
    "花蓮縣",
    "台東縣",
    "澎湖縣",
    "金門縣",
    "連江縣"
  ];

  const RENT_TYPES = ["整層住家", "獨立套房", "分租套房", "雅房", "車位", "其他"];
  const BUILDING_TYPES = ["電梯大樓", "華廈", "公寓", "透天厝", "別墅", "套房", "店面", "辦公", "廠房", "土地", "車位"];

  const numberFrom = (value) => {
    if (!value) return null;
    const match = String(value).replace(/,/g, "").match(/\d+(?:\.\d+)?/);
    return match ? Number(match[0]) : null;
  };

  const listingIdFromUrl = (url) => {
    const match = String(url).match(/(?:rent-detail-|\/rent\/)(\d+)|rent_id=(\d+)|\/(\d+)\.html/);
    return match?.[1] || match?.[2] || match?.[3] || url;
  };

  const parseRegion = (sourceText) => {
    const compact = String(sourceText || "").replace(/\s/g, "");
    const city = TAIWAN_CITIES.find((name) => compact.includes(name)) || "";
    const afterCity = city ? compact.slice(compact.indexOf(city) + city.length) : compact;
    const district = afterCity.match(/([\u4e00-\u9fa5]{1,5}(?:區|鄉|鎮|市))/)?.[1] || "";
    return { city, district };
  };

  const parseLayout = (sourceText) => {
    const compact = String(sourceText || "").replace(/\s/g, "");
    const full = compact.match(/(\d+)房(?:(\d+)廳)?(?:(\d+)衛)?/);
    return {
      rooms: full ? Number(full[1]) : numberFrom(compact.match(/(\d+)房/)?.[1]),
      livingRooms: full?.[2] ? Number(full[2]) : numberFrom(compact.match(/(\d+)廳/)?.[1]),
      bathrooms: full?.[3] ? Number(full[3]) : numberFrom(compact.match(/(\d+)衛/)?.[1])
    };
  };

  const inferType = (sourceText) => RENT_TYPES.find((type) => String(sourceText || "").includes(type)) || "";

  const inferBuildingType = (sourceText) => BUILDING_TYPES.find((type) => String(sourceText || "").includes(type)) || "";

  const inferMode = (partial, raw) => {
    if (partial.mode) return partial.mode;
    const url = String(partial.url || "");
    if (/sale|buy|house|sinyi|rakuya/i.test(url)) return "sale";
    if (/rent/i.test(url)) return "rent";
    if (/萬\/坪|總價|售價|實價登錄|成交/.test(raw)) return "sale";
    return "rent";
  };

  const inferMarketKind = (partial, raw) => {
    if (partial.marketKind) return partial.marketKind;
    if (/實價登錄|成交|交易年月|移轉/.test(raw)) return "transaction";
    return "listing";
  };

  const parseAddressRoad = (sourceText) => {
    const compact = String(sourceText || "").replace(/\s/g, "");
    return compact.match(/([\u4e00-\u9fa5\d一二三四五六七八九十]+(?:路|街|大道|巷))/)?.[1] || "";
  };

  const parseFloor = (sourceText) => {
    const match = String(sourceText || "").match(/(?:樓層|樓別)?\s*(\d+)\s*\/\s*(\d+)\s*樓/);
    return {
      floor: match ? Number(match[1]) : null,
      totalFloors: match ? Number(match[2]) : null
    };
  };

  const parseFeatureFlags = (sourceText) => {
    const raw = String(sourceText || "");
    return {
      hasElevator: /電梯|有電梯/.test(raw),
      allowsCooking: /可開伙|能開伙/.test(raw),
      allowsPet: /可養寵物|可寵|寵物/.test(raw) && !/不可養寵物|禁寵|不可寵/.test(raw),
      hasParking: /車位|停車/.test(raw)
    };
  };

  const normalizeListing = (partial, fallbackUrl = "") => {
    const raw = `${partial.title || ""} ${partial.description || ""} ${partial.address || ""}`;
    const region = parseRegion(raw);
    const layout = parseLayout(raw);
    const floor = parseFloor(raw);
    const flags = parseFeatureFlags(raw);
    const mode = inferMode(partial, raw);
    const marketKind = inferMarketKind(partial, raw);
    const area = partial.area || partial.areaPing || numberFrom(raw.match(/(\d+(?:\.\d+)?)\s*坪/)?.[1]);
    const monthlyRent = partial.monthlyRent || (mode === "rent" ? numberFrom(raw.match(/([\d,]+)\s*(?:元\/月|元|\/月)/)?.[1]) : null);
    const totalPrice = partial.totalPrice || (mode === "sale" ? numberFrom(raw.match(/([\d,]+(?:\.\d+)?)\s*萬/)?.[1]) : null);
    const pricePerPing =
      partial.pricePerPing ||
      (mode === "sale" ? numberFrom(raw.match(/([\d,]+(?:\.\d+)?)\s*萬\/坪/)?.[1]) : null) ||
      (mode === "sale" && totalPrice && area ? totalPrice / area : null);
    const rentPerPing =
      partial.rentPerPing ||
      (mode === "rent" && monthlyRent && area ? monthlyRent / area : null);
    const price = partial.price || monthlyRent || totalPrice;
    const url = partial.url || fallbackUrl;

    return {
      id: partial.id || listingIdFromUrl(url),
      url,
      source: partial.source || "",
      mode,
      marketKind,
      title: partial.title || "",
      price,
      totalPrice,
      pricePerPing,
      monthlyRent,
      rentPerPing,
      area,
      areaPing: area,
      city: partial.city || region.city,
      district: partial.district || region.district,
      type: partial.type || inferType(raw),
      buildingType: partial.buildingType || inferBuildingType(raw),
      addressRoad: partial.addressRoad || parseAddressRoad(raw),
      age: partial.age || numberFrom(raw.match(/(?:屋齡|屋齡約)\s*(\d+(?:\.\d+)?)\s*年/)?.[1]),
      rooms: partial.rooms ?? layout.rooms,
      livingRooms: partial.livingRooms ?? layout.livingRooms,
      bathrooms: partial.bathrooms ?? layout.bathrooms,
      floor: partial.floor ?? floor.floor,
      totalFloors: partial.totalFloors ?? floor.totalFloors,
      address: partial.address || "",
      hasElevator: partial.hasElevator ?? flags.hasElevator,
      allowsCooking: partial.allowsCooking ?? flags.allowsCooking,
      allowsPet: partial.allowsPet ?? flags.allowsPet,
      hasParking: partial.hasParking ?? flags.hasParking,
      collectedAt: partial.collectedAt || new Date().toISOString()
    };
  };

  const buildMarketSearchKeywords = (listing) =>
    [
      listing.city,
      listing.district,
      listing.type,
      listing.rooms ? `${listing.rooms}房` : ""
    ]
      .filter(Boolean)
      .join(" ");

  const buildBroadMarketSearchKeywords = (listing) =>
    [
      listing.city,
      listing.district,
      listing.addressRoad
    ]
      .filter(Boolean)
      .join(" ");

  const buildRegionalSearchKeywords = (listing) => {
    const searches = [];
    const add = (...parts) => {
      const keywords = parts.filter(Boolean).join(" ");
      if (keywords && !searches.includes(keywords)) searches.push(keywords);
    };
    add(listing.city, listing.district, listing.addressRoad);
    add(listing.city, listing.district);
    add(listing.city);
    return searches;
  };

  const buildMarketSearchUrl = (listing) => {
    const keywords = buildBroadMarketSearchKeywords(listing) || buildMarketSearchKeywords(listing);
    const url = new URL(listing.mode === "sale" ? "https://sale.591.com.tw/" : "https://rent.591.com.tw/");
    if (keywords) url.searchParams.set("keywords", keywords);
    return url.toString();
  };

  const api = {
    numberFrom,
    listingIdFromUrl,
    parseRegion,
    parseLayout,
    inferType,
    inferBuildingType,
    inferMode,
    inferMarketKind,
    parseAddressRoad,
    parseFloor,
    parseFeatureFlags,
    normalizeListing,
    buildMarketSearchKeywords,
    buildBroadMarketSearchKeywords,
    buildRegionalSearchKeywords,
    buildMarketSearchUrl
  };

  globalScope.RentCompareParser = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
