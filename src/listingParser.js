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
    const area = partial.area || numberFrom(raw.match(/(\d+(?:\.\d+)?)\s*坪/)?.[1]);
    const price = partial.price || numberFrom(raw.match(/([\d,]+)\s*(?:元\/月|元|\/月)/)?.[1]);
    const url = partial.url || fallbackUrl;

    return {
      id: partial.id || listingIdFromUrl(url),
      url,
      title: partial.title || "",
      price,
      area,
      city: partial.city || region.city,
      district: partial.district || region.district,
      type: partial.type || inferType(raw),
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

  const api = {
    numberFrom,
    listingIdFromUrl,
    parseRegion,
    parseLayout,
    inferType,
    parseFloor,
    parseFeatureFlags,
    normalizeListing
  };

  globalScope.RentCompareParser = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
