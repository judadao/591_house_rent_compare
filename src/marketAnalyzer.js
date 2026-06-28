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

  const unitValue = (item) => {
    if (!item.area) return null;
    if (item.mode === "sale") return item.pricePerPing || (item.totalPrice ? item.totalPrice / item.area : null);
    return item.rentPerPing || (item.monthlyRent ? item.monthlyRent / item.area : null);
  };

  const primaryValue = (item) => {
    if (item.mode === "sale") return item.totalPrice || null;
    return item.monthlyRent || item.price || null;
  };

  const similarityScore = (base, item) => {
    let score = 0;
    if (base.city && item.city === base.city) score += 18;
    if (base.district && item.district === base.district) score += 24;
    if (base.addressRoad && item.addressRoad === base.addressRoad) score += 16;
    if (base.buildingType && item.buildingType === base.buildingType) score += 18;
    if (base.type && item.type === base.type) score += 10;
    if (base.rooms && item.rooms === base.rooms) score += 8;
    if (base.area && item.area) score += Math.max(0, 12 - (Math.abs(item.area - base.area) / base.area) * 30);
    if (base.age && item.age) score += Math.max(0, 6 - Math.abs(item.age - base.age));
    return Math.round(score * 10) / 10;
  };

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
    const comparables = items
      .filter((item) => isComparable(base, item, options))
      .map((item) => ({ ...item, similarityScore: similarityScore(base, item) }))
      .sort((a, b) => b.similarityScore - a.similarityScore)
      .slice(0, 20);

    const primaryValues = comparables.map(primaryValue);
    const unitValues = comparables.map(unitValue);
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
      confidence: comparables.length >= 12 ? "high" : comparables.length >= 5 ? "medium" : "low",
      medianPrimary,
      medianUnit,
      p25Primary: percentile(primaryValues, 0.25),
      p75Primary: percentile(primaryValues, 0.75),
      p25Unit: percentile(unitValues, 0.25),
      p75Unit: percentile(unitValues, 0.75),
      diffPercent,
      comparables
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
    unitValue,
    primaryValue,
    similarityScore,
    isComparable,
    analyzeBucket,
    analyzeMarket,
    estimateMortgagePayment
  };

  globalScope.RentCompareMarketAnalyzer = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
