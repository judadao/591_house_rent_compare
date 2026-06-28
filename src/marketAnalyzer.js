(function initMarketAnalyzer(globalScope) {
  const percentile = (values, ratio) => {
    const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
    if (!sorted.length) return null;
    const index = (sorted.length - 1) * ratio;
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    if (lower === upper) return sorted[lower];
    return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
  };

  const median = (values) => percentile(values, 0.5);

  const average = (values) => {
    const finite = values.filter(Number.isFinite);
    if (!finite.length) return null;
    return finite.reduce((sum, value) => sum + value, 0) / finite.length;
  };

  const unitValue = (item) => {
    if (!item.area) return null;
    if (item.mode === "sale") return item.pricePerPing || (item.totalPrice ? item.totalPrice / item.area : null);
    return item.rentPerPing || (item.monthlyRent ? item.monthlyRent / item.area : null);
  };

  const primaryValue = (item) => {
    if (item.mode === "sale") return item.totalPrice || null;
    return item.monthlyRent || item.price || null;
  };

  const autoAreaRange = (area) => {
    if (!Number.isFinite(area)) return { min: null, max: null, label: "權狀不限" };
    if (area < 20) return { min: null, max: 20, label: "權狀20坪以下" };
    if (area < 30) return { min: 20, max: 30, label: "權狀20-30坪" };
    if (area < 40) return { min: 30, max: 40, label: "權狀30-40坪" };
    return { min: 40, max: null, label: "權狀40坪以上" };
  };

  const resolveAreaRange = (base, options = {}) => {
    if (options.compareAreaPreset === "all") return { min: null, max: null, label: "權狀不限" };
    const min = Number.isFinite(Number(options.compareAreaMin)) ? Number(options.compareAreaMin) : null;
    const max = Number.isFinite(Number(options.compareAreaMax)) ? Number(options.compareAreaMax) : null;
    if (min !== null || max !== null) {
      return {
        min,
        max,
        label: min !== null && max !== null ? `權狀${min}-${max}坪` : min !== null ? `權狀${min}坪以上` : `權狀${max}坪以下`
      };
    }
    return { min: null, max: null, label: "權狀不限" };
  };

  const areaRangeMatch = (item, range) => {
    if (!range || (range.min === null && range.max === null)) return true;
    if (!Number.isFinite(item.area)) return false;
    if (range.min !== null && item.area < range.min) return false;
    if (range.max !== null && item.area > range.max) return false;
    return true;
  };

  const looksLikeSearchPage = (item) => {
    const title = String(item?.title || "");
    return /買房\s*[|｜]\s*中古屋買賣|中古屋買賣房屋出售|591售屋網$/.test(title) && !item.area && !primaryValue(item);
  };

  const isUsableMarketItem = (item) =>
    !looksLikeSearchPage(item) &&
    (Boolean(item.area) || Number.isFinite(primaryValue(item)) || Number.isFinite(unitValue(item)));

  const distanceKm = (a, b) => {
    if (!Number.isFinite(a.latitude) || !Number.isFinite(a.longitude) || !Number.isFinite(b.latitude) || !Number.isFinite(b.longitude)) {
      return null;
    }
    const toRad = (value) => (value * Math.PI) / 180;
    const radius = 6371;
    const dLat = toRad(b.latitude - a.latitude);
    const dLng = toRad(b.longitude - a.longitude);
    const lat1 = toRad(a.latitude);
    const lat2 = toRad(b.latitude);
    const h =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    return radius * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  };

  const MRT_LINES = [
    ["頂埔", "永寧", "土城", "海山", "亞東醫院", "府中", "板橋", "新埔", "江子翠", "龍山寺", "西門", "台北車站", "善導寺", "忠孝新生", "忠孝復興", "忠孝敦化", "國父紀念館", "市政府", "永春", "後山埤", "昆陽", "南港", "南港展覽館"],
    ["淡水", "紅樹林", "竹圍", "關渡", "忠義", "復興崗", "北投", "奇岩", "唭哩岸", "石牌", "明德", "芝山", "士林", "劍潭", "圓山", "民權西路", "雙連", "中山", "台北車站", "台大醫院", "中正紀念堂", "東門", "大安森林公園", "大安", "信義安和", "台北101", "象山"],
    ["迴龍", "丹鳳", "輔大", "新莊", "頭前庄", "先嗇宮", "三重", "菜寮", "台北橋", "大橋頭", "民權西路", "中山國小", "行天宮", "松江南京", "忠孝新生", "東門", "古亭", "頂溪", "永安市場", "景安", "南勢角"],
    ["松山", "南京三民", "台北小巨蛋", "南京復興", "松江南京", "中山", "北門", "西門", "小南門", "中正紀念堂", "古亭", "台電大樓", "公館", "萬隆", "景美", "大坪林", "七張", "新店區公所", "新店"],
    ["動物園", "木柵", "萬芳社區", "萬芳醫院", "辛亥", "麟光", "六張犁", "科技大樓", "大安", "忠孝復興", "南京復興", "中山國中", "松山機場", "大直", "劍南路", "西湖", "港墘", "文德", "內湖", "大湖公園", "葫洲", "東湖", "南港軟體園區", "南港展覽館"]
  ];

  const stationDistance = (a, b) => {
    if (!a || !b) return null;
    if (a === b) return 0;
    let best = null;
    for (const line of MRT_LINES) {
      const ai = line.indexOf(a);
      const bi = line.indexOf(b);
      if (ai === -1 || bi === -1) continue;
      const distance = Math.abs(ai - bi);
      best = best === null ? distance : Math.min(best, distance);
    }
    return best;
  };

  const sameOrNearbyStation = (baseStation, itemStation, maxStops = 1) => {
    const stops = stationDistance(baseStation, itemStation);
    return stops !== null && stops <= maxStops;
  };

  const basicScopeMatch = (base, item) => {
    if (base.mode !== item.mode) return false;
    if (base.city && item.city && base.city !== item.city) return false;
    return true;
  };

  const scopedMarketItems = (base, items, options = {}) => {
    const maxStationStops = Number(options.maxStationStops ?? 1);
    const minScopeCount = Number(options.minScopeCount ?? 12);
    const radiusKm = Number(options.radiusKm ?? 30);
    const candidates = items.filter((item) => basicScopeMatch(base, item) && isUsableMarketItem(item));
    const selected = new Map();
    const addMatches = (matcher) => {
      for (const item of candidates) {
        if (matcher(item)) selected.set(item.id || item.url || JSON.stringify(item), item);
      }
      return selected.size >= minScopeCount;
    };

    if (base.transitStation) {
      addMatches((item) =>
        sameOrNearbyStation(base.transitStation, item.transitStation, maxStationStops) ||
        sameOrNearbyStation(base.transitStation, item.searchContext?.transitStation, maxStationStops)
      );
      if (selected.size >= minScopeCount) return [...selected.values()];
    }

    if (base.areaBlock && addMatches((item) => item.areaBlock === base.areaBlock || item.searchContext?.areaBlock === base.areaBlock)) return [...selected.values()];
    if (base.district && addMatches((item) => item.district === base.district || item.searchContext?.district === base.district)) return [...selected.values()];
    if (addMatches((item) => {
      const distance = distanceKm(base, item);
      return distance !== null && distance <= radiusKm;
    })) return [...selected.values()];
    if (options.regionScope === "city" || selected.size < minScopeCount) {
      addMatches((item) => base.city && (item.city === base.city || item.searchContext?.city === base.city));
    }
    return [...selected.values()];
  };

  const marketScopeMatch = (base, item, options = {}) => scopedMarketItems(base, [item], options).length > 0;

  const summarizeValues = (items) => {
    const primaryValues = items.map(primaryValue);
    const unitValues = items.map(unitValue);
    return {
      count: items.length,
      averagePrimary: average(primaryValues),
      averageUnit: average(unitValues),
      medianPrimary: median(primaryValues),
      medianUnit: median(unitValues),
      p25Primary: percentile(primaryValues, 0.25),
      p75Primary: percentile(primaryValues, 0.75),
      p25Unit: percentile(unitValues, 0.25),
      p75Unit: percentile(unitValues, 0.75)
    };
  };

  const ageBucketLabel = (age) => {
    if (!Number.isFinite(age)) return "屋齡未知";
    if (age <= 5) return "0-5年";
    if (age <= 10) return "6-10年";
    if (age <= 20) return "11-20年";
    if (age <= 30) return "21-30年";
    return "31年以上";
  };

  const mainAreaBucketLabel = (mainArea) => {
    if (!Number.isFinite(mainArea)) return "主建未知";
    if (mainArea < 10) return "主建10坪以下";
    if (mainArea < 20) return "主建10-20坪";
    if (mainArea < 30) return "主建20-30坪";
    if (mainArea < 40) return "主建30-40坪";
    return "主建40坪以上";
  };

  const groupSummary = (items, labeler) => {
    const groups = new Map();
    for (const item of items) {
      const label = labeler(item);
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label).push(item);
    }
    return [...groups.entries()]
      .map(([label, groupItems]) => ({ label, ...summarizeValues(groupItems) }))
      .sort((a, b) => b.count - a.count);
  };

  const sliceMarket = (base, items, options = {}) => {
    const scopeItems = scopedMarketItems(base, items, options);
    const sameSizeTolerance = Number(options.sameSizeTolerance ?? 0.1);
    const sameSizeItems = base.area
      ? scopeItems.filter((item) => item.area && item.area >= base.area * (1 - sameSizeTolerance) && item.area <= base.area * (1 + sameSizeTolerance))
      : [];
    const sameMainAreaItems = base.mainArea
      ? scopeItems.filter((item) => item.mainArea && item.mainArea >= base.mainArea * (1 - sameSizeTolerance) && item.mainArea <= base.mainArea * (1 + sameSizeTolerance))
      : [];
    const featureItems = scopeItems.filter((item) => {
      if (base.buildingType && item.buildingType && base.buildingType !== item.buildingType) return false;
      if (base.rooms && item.rooms && base.rooms !== item.rooms) return false;
      if (base.hasElevator && !item.hasElevator) return false;
      if (base.hasParking && !item.hasParking) return false;
      return true;
    });

    return {
      scopeCount: scopeItems.length,
      scopeSummary: summarizeValues(scopeItems),
      ageBuckets: groupSummary(scopeItems, (item) => ageBucketLabel(item.age)),
      mainAreaBuckets: groupSummary(scopeItems, (item) => mainAreaBucketLabel(item.mainArea)),
      sameSizeSummary: summarizeValues(sameSizeItems),
      sameMainAreaSummary: summarizeValues(sameMainAreaItems),
      featureSummary: summarizeValues(featureItems)
    };
  };

  const rentDistanceSummary = (base, items, options = {}) => {
    if (base.mode !== "rent") return [];
    const areaRange = resolveAreaRange(base, options);
    const pricedItems = items
      .filter((item) => basicScopeMatch(base, item) && isUsableMarketItem(item) && areaRangeMatch(item, areaRange))
      .filter((item) => Number.isFinite(primaryValue(item)));
    const baseRent = primaryValue(base);
    const build = (label, matcher) => {
      const group = pricedItems.filter(matcher);
      const summary = summarizeValues(group);
      const diffPercent = baseRent && summary.averagePrimary
        ? ((baseRent - summary.averagePrimary) / summary.averagePrimary) * 100
        : null;
      return {
        label,
        count: group.length,
        averagePrimary: summary.averagePrimary,
        medianPrimary: summary.medianPrimary,
        averageUnit: summary.averageUnit,
        medianUnit: summary.medianUnit,
        diffPercent
      };
    };

    return [
      build("1km內", (item) => {
        const distance = distanceKm(base, item);
        return distance !== null && distance <= 1;
      }),
      build("3km內", (item) => {
        const distance = distanceKm(base, item);
        return distance !== null && distance <= 3;
      }),
      build("5km內", (item) => {
        const distance = distanceKm(base, item);
        return distance !== null && distance <= 5;
      }),
      build("同行政區不限距離", (item) =>
        base.district && (item.district === base.district || item.searchContext?.district === base.district)
      )
    ];
  };

  const similarityScore = (base, item) => {
    let score = 0;
    if (base.city && item.city === base.city) score += 18;
    if (base.district && item.district === base.district) score += 24;
    const stops = stationDistance(base.transitStation, item.transitStation);
    if (stops === 0) score += 28;
    else if (stops === 1) score += 18;
    if (base.addressRoad && item.addressRoad === base.addressRoad) score += 16;
    if (base.buildingType && item.buildingType === base.buildingType) score += 18;
    if (base.type && item.type === base.type) score += 10;
    if (base.rooms && item.rooms === base.rooms) score += 8;
    if (base.area && item.area) score += Math.max(0, 12 - (Math.abs(item.area - base.area) / base.area) * 30);
    if (base.age && item.age) score += Math.max(0, 6 - Math.abs(item.age - base.age));
    return Math.round(score * 10) / 10;
  };

  const areaDeltaRatio = (base, item) => {
    if (!base.area || !item.area) return null;
    return Math.abs(item.area - base.area) / base.area;
  };

  const comparableRankedItems = (base, items) =>
    items
      .map((item) => ({
        ...item,
        distanceKm: distanceKm(base, item),
        similarityScore: similarityScore(base, item),
        areaDeltaRatio: areaDeltaRatio(base, item)
      }))
      .sort((a, b) => {
        const areaA = Number.isFinite(a.areaDeltaRatio) ? Math.round(a.areaDeltaRatio * 10000) / 10000 : null;
        const areaB = Number.isFinite(b.areaDeltaRatio) ? Math.round(b.areaDeltaRatio * 10000) / 10000 : null;
        if (areaA !== null && areaB !== null && areaA !== areaB) {
          return areaA - areaB;
        }
        if (areaA !== null && areaB === null) return -1;
        if (areaA === null && areaB !== null) return 1;
        const hasDistanceA = Number.isFinite(a.distanceKm);
        const hasDistanceB = Number.isFinite(b.distanceKm);
        if (hasDistanceA && hasDistanceB && a.distanceKm !== b.distanceKm) return a.distanceKm - b.distanceKm;
        if (hasDistanceA && !hasDistanceB) return -1;
        if (!hasDistanceA && hasDistanceB) return 1;
        return b.similarityScore - a.similarityScore;
      });

  const isComparable = (base, item, options = {}) => {
    const tolerance = Number(options.areaTolerance ?? 0.25);
    if (base.mode !== item.mode) return false;
    if (base.city && item.city && base.city !== item.city) return false;
    if (options.regionScope === "district" && base.district && item.district && base.district !== item.district) return false;
    if (options.regionScope !== "city" && options.matchDistrict !== false && base.district && item.district && base.district !== item.district) return false;
    if (options.matchBuildingType === true && base.buildingType && item.buildingType && base.buildingType !== item.buildingType) return false;
    if (options.matchRooms === true && base.rooms && item.rooms && base.rooms !== item.rooms) return false;
    if (base.area && item.area && (item.area < base.area * (1 - tolerance) || item.area > base.area * (1 + tolerance))) return false;
    return Number.isFinite(primaryValue(item));
  };

  const analyzeBucket = (base, items, label, options = {}) => {
    const scopedItems = scopedMarketItems(base, items, options);
    const areaRange = resolveAreaRange(base, options);
    const areaScopedItems = scopedItems.filter((item) => areaRangeMatch(item, areaRange));
    const strictComparables = comparableRankedItems(
      base,
      areaScopedItems.filter((item) => isComparable(base, item, { ...options, areaTolerance: 999 }))
    );
    const minComparableCount = Number(options.minComparableCount ?? 5);
    const comparableMode = strictComparables.length >= minComparableCount ? "strict" : "scope";
    const comparables = (comparableMode === "strict" ? strictComparables : comparableRankedItems(base, areaScopedItems)).slice(0, 20);
    const pricedComparables = comparables.filter((item) => Number.isFinite(primaryValue(item)));

    const primaryValues = pricedComparables.map(primaryValue);
    const unitValues = pricedComparables.map(unitValue);
    const basePrimary = primaryValue(base);
    const baseUnit = unitValue(base);
    const medianPrimary = median(primaryValues);
    const medianUnit = median(unitValues);
    const compareValue = base.mode === "sale" ? baseUnit : basePrimary;
    const benchmark = base.mode === "sale" ? medianUnit : medianPrimary;
    const diffPercent = benchmark && compareValue ? ((compareValue - benchmark) / benchmark) * 100 : null;

    return {
      label,
      count: comparables.length,
      pricedCount: pricedComparables.length,
      confidence: pricedComparables.length >= 12 ? "high" : pricedComparables.length >= 5 ? "medium" : "low",
      medianPrimary,
      medianUnit,
      p25Primary: percentile(primaryValues, 0.25),
      p75Primary: percentile(primaryValues, 0.75),
      p25Unit: percentile(unitValues, 0.25),
      p75Unit: percentile(unitValues, 0.75),
      diffPercent,
      comparableMode,
      areaRange,
      rentDistanceBuckets: base.mode === "rent" ? rentDistanceSummary(base, items, options) : [],
      scopeCount: scopedItems.length,
      areaScopeCount: areaScopedItems.length,
      comparables,
      marketSlice: sliceMarket(base, items, options)
    };
  };

  const analyzeMarket = (base, items, options = {}) => {
    if (!base) return null;
    const analysisMode = options.analysisMode || base.mode;
    const benchmarkBase = { ...base, mode: analysisMode };
    const sameMode = items.filter((item) => item.mode === analysisMode);
    if (analysisMode === "sale") {
      return {
        mode: "sale",
        listing: analyzeBucket(benchmarkBase, sameMode.filter((item) => item.marketKind === "listing"), "待售開價行情", options),
        transaction: analyzeBucket(benchmarkBase, sameMode.filter((item) => item.marketKind === "transaction"), "實價登錄成交行情", options)
      };
    }
    return {
      mode: "rent",
      rent: analyzeBucket(benchmarkBase, sameMode.filter((item) => item.marketKind === "listing"), "租屋行情", options)
    };
  };

  const estimateMortgagePayment = ({
    totalPrice,
    pricePerPing,
    area,
    downPaymentRatio = 0.2,
    annualRate = 0.025,
    years = 30
  }) => {
    const estimatedTotalPrice = totalPrice || (pricePerPing && area ? pricePerPing * area : null);
    if (!estimatedTotalPrice) return null;
    const principal = estimatedTotalPrice * 10000 * (1 - downPaymentRatio);
    const monthlyRate = annualRate / 12;
    const months = years * 12;
    if (!monthlyRate) return principal / months;
    return (principal * monthlyRate * (1 + monthlyRate) ** months) / ((1 + monthlyRate) ** months - 1);
  };

  const api = {
    percentile,
    median,
    average,
    unitValue,
    primaryValue,
    autoAreaRange,
    resolveAreaRange,
    areaRangeMatch,
    isUsableMarketItem,
    distanceKm,
    stationDistance,
    sameOrNearbyStation,
    marketScopeMatch,
    scopedMarketItems,
    summarizeValues,
    mainAreaBucketLabel,
    sliceMarket,
    rentDistanceSummary,
    similarityScore,
    isComparable,
    analyzeBucket,
    analyzeMarket,
    estimateMortgagePayment
  };

  globalScope.RentCompareMarketAnalyzer = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
