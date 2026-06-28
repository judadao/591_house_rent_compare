const test = require("node:test");
const assert = require("node:assert/strict");

const analyzer = require("../src/marketAnalyzer");

const baseSale = {
  mode: "sale",
  marketKind: "listing",
  city: "台北市",
  district: "信義區",
  buildingType: "電梯大樓",
  rooms: 2,
  area: 25,
  totalPrice: 3000,
  pricePerPing: 120
};

test("separates sale listing market and transaction market", () => {
  const result = analyzer.analyzeMarket(baseSale, [
    { ...baseSale, id: "l1", totalPrice: 2800, pricePerPing: 112, marketKind: "listing" },
    { ...baseSale, id: "l2", totalPrice: 3000, pricePerPing: 120, marketKind: "listing" },
    { ...baseSale, id: "t1", totalPrice: 2500, pricePerPing: 100, marketKind: "transaction" },
    { ...baseSale, id: "t2", totalPrice: 2600, pricePerPing: 104, marketKind: "transaction" }
  ]);

  assert.equal(result.mode, "sale");
  assert.equal(result.listing.label, "待售開價行情");
  assert.equal(result.transaction.label, "實價登錄成交行情");
  assert.equal(result.listing.medianPrimary, 2900);
  assert.equal(result.listing.medianUnit, 116);
  assert.equal(result.transaction.medianPrimary, 2550);
  assert.equal(result.transaction.medianUnit, 102);
});

test("analyzes rent market by monthly rent and rent per ping", () => {
  const baseRent = {
    mode: "rent",
    marketKind: "listing",
    city: "台北市",
    district: "大安區",
    type: "整層住家",
    rooms: 2,
    area: 20,
    monthlyRent: 32000
  };
  const result = analyzer.analyzeMarket(baseRent, [
    { ...baseRent, id: "r1", monthlyRent: 30000 },
    { ...baseRent, id: "r2", monthlyRent: 34000 }
  ]);

  assert.equal(result.mode, "rent");
  assert.equal(result.rent.label, "租屋行情");
  assert.equal(result.rent.medianPrimary, 32000);
  assert.equal(result.rent.medianUnit, 1600);
});

test("summarizes rent prices by MRT distance ranges and same target area", () => {
  const baseRent = {
    mode: "rent",
    marketKind: "listing",
    city: "台北市",
    district: "大安區",
    rooms: 2,
    area: 20,
    monthlyRent: 32000,
    transitDistanceMeters: 450,
    latitude: 25.033,
    longitude: 121.565
  };
  const result = analyzer.analyzeMarket(baseRent, [
    { ...baseRent, id: "r-500m", monthlyRent: 30000, transitDistanceMeters: 400 },
    { ...baseRent, id: "r-large", area: 45, monthlyRent: 90000, transitDistanceMeters: 450 },
    { ...baseRent, id: "r-1km", monthlyRent: 34000, transitDistanceMeters: 900 },
    { ...baseRent, id: "r-2km", monthlyRent: 38000, transitDistanceMeters: 1500 },
    { ...baseRent, id: "r-unknown", monthlyRent: 38000, transitDistanceMeters: null }
  ]);
  const buckets = Object.fromEntries(result.rent.rentDistanceBuckets.map((bucket) => [bucket.label, bucket]));

  assert.equal(buckets["距捷運 0-500m"].count, 1);
  assert.equal(Math.round(buckets["距捷運 0-500m"].averagePrimary), 30000);
  assert.equal(Math.round(buckets["距捷運 0-500m"].diffPercent * 10) / 10, 6.7);
  assert.equal(buckets["距捷運 500m-1km"].count, 1);
  assert.equal(Math.round(buckets["距捷運 500m-1km"].averagePrimary), 34000);
  assert.equal(buckets["距捷運 1-2km"].count, 1);
  assert.equal(Math.round(buckets["距捷運 1-2km"].averagePrimary), 38000);
  assert.equal(buckets["捷運距離未知"].count, 1);
  assert.equal(Math.round(buckets["捷運距離未知"].averagePrimary), 38000);
});

test("rent comparison ignores manual area filters and uses current area plus minus two ping", () => {
  const baseRent = {
    mode: "rent",
    marketKind: "listing",
    city: "台北市",
    district: "大安區",
    area: 20,
    monthlyRent: 32000,
    latitude: 25.033,
    longitude: 121.565
  };
  const result = analyzer.analyzeMarket(baseRent, [
    { ...baseRent, id: "fit-low", area: 18, monthlyRent: 30000 },
    { ...baseRent, id: "fit-high", area: 22, monthlyRent: 34000 },
    { ...baseRent, id: "too-small", area: 17.9, monthlyRent: 20000 },
    { ...baseRent, id: "too-large", area: 22.1, monthlyRent: 60000 }
  ], { compareAreaPreset: "custom", compareAreaMin: 30 });

  assert.equal(result.rent.areaRange.label, "估算坪數：18-22坪（目標20坪，-2/+2坪）");
  assert.deepEqual(result.rent.calculationComparables.map((item) => item.id), ["fit-low", "fit-high"]);
  assert.deepEqual(result.rent.comparables.filter((item) => item.usedForEstimate).map((item) => item.id), ["fit-low", "fit-high"]);
  assert.equal(result.rent.medianPrimary, 32000);
});

test("rent estimate badges follow current listing area plus minus two ping", () => {
  const baseRent = {
    mode: "rent",
    marketKind: "listing",
    city: "新北市",
    district: "板橋區",
    area: 19,
    monthlyRent: 30000
  };
  const result = analyzer.analyzeMarket(baseRent, [
    { ...baseRent, id: "area-7", area: 7, monthlyRent: 9000 },
    { ...baseRent, id: "area-17", area: 17, monthlyRent: 28000 },
    { ...baseRent, id: "area-19", area: 19, monthlyRent: 30000 },
    { ...baseRent, id: "area-21", area: 21, monthlyRent: 32000 },
    { ...baseRent, id: "area-16-9", area: 16.9, monthlyRent: 26000 },
    { ...baseRent, id: "area-21-1", area: 21.1, monthlyRent: 34000 }
  ]);

  assert.equal(result.rent.areaRange.label, "估算坪數：17-21坪（目標19坪，-2/+2坪）");
  assert.deepEqual(result.rent.calculationComparables.map((item) => item.id), ["area-19", "area-17", "area-21"]);
  assert.deepEqual(result.rent.comparables.filter((item) => item.usedForEstimate).map((item) => item.id), ["area-19", "area-17", "area-21"]);
  assert.deepEqual(result.rent.comparables.slice(0, 3).map((item) => item.id), ["area-19", "area-17", "area-21"]);
  assert.deepEqual(result.rent.comparables.filter((item) => !item.usedForEstimate).map((item) => item.id), ["area-16-9", "area-21-1", "area-7"]);
});

test("rent estimate uses custom target area minus plus and MRT radius with unit rent diff", () => {
  const baseRent = {
    mode: "rent",
    marketKind: "listing",
    city: "新北市",
    district: "板橋區",
    area: 13,
    monthlyRent: 16999,
    transitDistanceMeters: 448
  };
  const result = analyzer.analyzeMarket(baseRent, [
    { ...baseRent, id: "fit-near", area: 14, monthlyRent: 14000, transitDistanceMeters: 900 },
    { ...baseRent, id: "fit-edge", area: 16, monthlyRent: 16000, transitDistanceMeters: 3000 },
    { ...baseRent, id: "too-small", area: 11.9, monthlyRent: 9000, transitDistanceMeters: 500 },
    { ...baseRent, id: "too-far", area: 14, monthlyRent: 12000, transitDistanceMeters: 3100 }
  ], {
    rentEstimateArea: 14,
    rentAreaMinusPing: 1,
    rentAreaPlusPing: 2,
    rentEstimateRadiusKm: 3
  });

  assert.equal(result.rent.areaRange.label, "估算坪數：13-16坪（目標14坪，-1/+2坪）");
  assert.equal(result.rent.estimateScopeLabel, "估算坪數：13-16坪（目標14坪，-1/+2坪），距捷運 3km 內");
  assert.deepEqual(result.rent.calculationComparables.map((item) => item.id), ["fit-near", "fit-edge"]);
  assert.equal(Math.round(result.rent.medianUnit), 1000);
  assert.equal(Math.round(result.rent.diffPercent * 10) / 10, 30.8);
});

test("does not estimate when current listing area is unknown", () => {
  const baseRent = {
    mode: "rent",
    marketKind: "listing",
    city: "新北市",
    district: "板橋區",
    area: null,
    monthlyRent: 30000
  };
  const result = analyzer.analyzeMarket(baseRent, [
    { ...baseRent, id: "area-7", area: 7, monthlyRent: 9000 },
    { ...baseRent, id: "area-19", area: 19, monthlyRent: 30000 }
  ]);

  assert.equal(result.rent.areaRange.label, "估算坪數：目前物件坪數未知，暫不估算");
  assert.equal(result.rent.estimateCount, 0);
  assert.equal(result.rent.medianPrimary, null);
  assert.deepEqual(result.rent.comparables.map((item) => item.usedForEstimate), [false, false]);
});

test("can compare a sale listing against rental market", () => {
  const result = analyzer.analyzeMarket(baseSale, [
    {
      mode: "rent",
      marketKind: "listing",
      city: "台北市",
      district: "信義區",
      buildingType: "電梯大樓",
      rooms: 2,
      area: 24,
      monthlyRent: 42000
    }
  ], { analysisMode: "rent" });

  assert.equal(result.mode, "rent");
  assert.equal(result.rent.medianPrimary, 42000);
});

test("estimates mortgage monthly payment", () => {
  const payment = analyzer.estimateMortgagePayment({
    totalPrice: 3000,
    downPaymentRatio: 0.2,
    annualRate: 0.024,
    years: 30
  });

  assert.equal(Math.round(payment), 93586);
});

test("city scope keeps same city while allowing broader districts", () => {
  const result = analyzer.analyzeMarket(baseSale, [
    { ...baseSale, id: "same-city", district: "大安區", totalPrice: 2700, pricePerPing: 108, marketKind: "listing" },
    { ...baseSale, id: "other-city", city: "新北市", district: "板橋區", totalPrice: 1800, pricePerPing: 72, marketKind: "listing" }
  ], { regionScope: "city", matchDistrict: false });

  assert.equal(result.listing.count, 1);
  assert.equal(result.listing.comparables[0].id, "same-city");
});

test("market slice uses nearby stations and sorts comparables by km distance", () => {
  const base = {
    ...baseSale,
    latitude: 25.033,
    longitude: 121.565,
    transitStation: "市政府",
    age: 8
  };
  const sameStationFarther = { ...base, id: "same-station-farther", latitude: 25.06, longitude: 121.59, totalPrice: 3200, pricePerPing: 128, age: 12, marketKind: "listing" };
  const nearbyStationNearer = { ...base, id: "nearby-station-nearer", transitStation: "永春", latitude: 25.034, longitude: 121.566, totalPrice: 3100, pricePerPing: 124, age: 9, marketKind: "listing" };
  const farStation = { ...base, id: "far-station", transitStation: "江子翠", latitude: 25.03, longitude: 121.47, totalPrice: 2500, pricePerPing: 100, age: 25, marketKind: "listing" };
  const result = analyzer.analyzeMarket(base, [sameStationFarther, nearbyStationNearer, farStation]);

  assert.equal(result.listing.marketSlice.scopeCount, 3);
  assert.equal(result.listing.marketSlice.sameSizeSummary.count, 3);
  assert.equal(result.listing.comparables[0].id, "nearby-station-nearer");
  assert.equal(result.listing.comparables[1].id, "same-station-farther");
  assert.ok(result.listing.comparables[0].distanceKm < result.listing.comparables[1].distanceKm);

  const strictResult = analyzer.analyzeMarket(base, [sameStationFarther, nearbyStationNearer, farStation], { minScopeCount: 1 });
  assert.equal(strictResult.listing.marketSlice.scopeCount, 2);
});

test("market slice groups main area buckets including unknown", () => {
  const base = { ...baseSale, city: "新北市", district: "板橋區", transitStation: "江子翠", mainArea: 22 };
  const result = analyzer.analyzeMarket(base, [
    { ...base, id: "known", mainArea: 22, totalPrice: 2000, pricePerPing: 80, marketKind: "listing" },
    { ...base, id: "unknown", mainArea: null, totalPrice: 1800, pricePerPing: 72, marketKind: "listing" }
  ]);
  const labels = result.listing.marketSlice.mainAreaBuckets.map((bucket) => bucket.label);

  assert.ok(labels.includes("主建20-30坪"));
  assert.ok(labels.includes("主建未知"));
  assert.equal(result.listing.marketSlice.sameMainAreaSummary.count, 1);
});

test("market scope falls back to area block when coordinates are absent", () => {
  const base = { ...baseSale, city: "新北市", district: "板橋區", areaBlock: "江子翠" };
  const items = [
    { ...base, id: "same-block", totalPrice: 2000, pricePerPing: 80, marketKind: "listing" },
    { ...base, id: "other-block", areaBlock: "府中", totalPrice: 1800, pricePerPing: 72, marketKind: "listing" }
  ];
  const result = analyzer.analyzeMarket(base, items);
  const strictResult = analyzer.analyzeMarket(base, items, { minScopeCount: 1 });

  assert.equal(result.listing.marketSlice.scopeCount, 2);
  assert.equal(strictResult.listing.marketSlice.scopeCount, 1);
  assert.equal(strictResult.listing.comparables[0].id, "same-block");
});

test("market scope accepts inherited search context", () => {
  const base = { ...baseSale, city: "新北市", district: "板橋區", areaBlock: "江子翠" };
  const result = analyzer.analyzeMarket(base, [
    {
      ...baseSale,
      id: "inherited",
      city: "",
      district: "",
      areaBlock: "",
      totalPrice: 2100,
      pricePerPing: 84,
      marketKind: "listing",
      searchContext: { city: "新北市", district: "板橋區", areaBlock: "江子翠" }
    }
  ]);

  assert.equal(result.listing.marketSlice.scopeCount, 1);
  assert.equal(result.listing.comparables[0].id, "inherited");
});

test("falls back to scoped items when strict comparable list is too small", () => {
  const base = { ...baseSale, area: 30, totalPrice: 1900, pricePerPing: 63.3 };
  const items = [
    { ...base, id: "strict-one", area: 34, totalPrice: 1980, pricePerPing: 58.3, marketKind: "listing" },
    { ...base, id: "near-size", area: 29, totalPrice: 1688, pricePerPing: 58.2, marketKind: "listing" },
    { ...base, id: "far-size", district: "other", area: 22, totalPrice: 1398, pricePerPing: 63.5, marketKind: "listing" }
  ];
  const result = analyzer.analyzeMarket(base, items);

  assert.equal(result.listing.marketSlice.scopeCount, 3);
  assert.equal(result.listing.comparableMode, "area-estimate");
  assert.equal(result.listing.count, 3);
  assert.equal(result.listing.displayCount, 3);
  assert.equal(result.listing.estimateCount, 1);
  assert.equal(result.listing.comparables[0].id, "near-size");
  assert.equal(result.listing.comparables[1].id, "strict-one");
  assert.equal(result.listing.comparables[0].usedForEstimate, true);
  assert.equal(result.listing.comparables[1].usedForEstimate, false);
});

test("keeps scoped listings without price in the displayed comparable list", () => {
  const base = { ...baseSale, area: 30, totalPrice: 1900, pricePerPing: 63.3 };
  const result = analyzer.analyzeMarket(base, [
    { ...base, id: "priced", area: 29, totalPrice: 1688, pricePerPing: 58.2, marketKind: "listing" },
    { ...base, id: "unknown-price", area: 30, totalPrice: null, pricePerPing: null, price: null, marketKind: "listing" }
  ]);

  assert.equal(result.listing.marketSlice.scopeCount, 2);
  assert.equal(result.listing.count, 2);
  assert.equal(result.listing.pricedCount, 1);
  assert.ok(result.listing.comparables.some((item) => item.id === "unknown-price"));
});

test("filters empty 591 search pages out of market scope", () => {
  const base = { ...baseSale, city: "新北市", district: "板橋區", area: 30 };
  const result = analyzer.analyzeMarket(base, [
    {
      id: "search-page",
      url: "https://sale.591.com.tw/?regionid=3&section=26",
      mode: "sale",
      marketKind: "listing",
      city: "新北市",
      district: "板橋區",
      title: "新北市板橋區買屋｜中古屋買賣 - 591售屋網"
    },
    { ...base, id: "real-listing", area: 29, totalPrice: 1688, pricePerPing: 58.2, marketKind: "listing" }
  ]);

  assert.equal(result.listing.marketSlice.scopeCount, 1);
  assert.equal(result.listing.comparables.length, 1);
  assert.equal(result.listing.comparables[0].id, "real-listing");

  const rentBase = { mode: "rent", city: "新北市", district: "板橋區", area: 19, monthlyRent: 30000 };
  const rentResult = analyzer.analyzeMarket(rentBase, [
    {
      id: "rent-search-page",
      url: "https://rent.591.com.tw/list?region=3&section=26",
      mode: "rent",
      marketKind: "listing",
      city: "新北市",
      district: "板橋區",
      title: "板橋區租屋 | 新北市房屋出租 - 591租屋網"
    },
    { ...rentBase, id: "real-rent", marketKind: "listing", area: 19, monthlyRent: 30000 }
  ]);

  assert.equal(rentResult.rent.scopeCount, 1);
  assert.deepEqual(rentResult.rent.comparables.map((item) => item.id), ["real-rent"]);
  assert.equal(rentResult.rent.comparables[0].usedForEstimate, true);
});

test("estimates use current area plus minus two and ignore manual area filters", () => {
  const base = { ...baseSale, area: 30 };
  const items = [
    { ...base, id: "small", area: 18, totalPrice: 1200, pricePerPing: 66.7, marketKind: "listing" },
    { ...base, id: "fit", area: 29, totalPrice: 1500, pricePerPing: 60, marketKind: "listing" },
    { ...base, id: "large", area: 45, totalPrice: 2500, pricePerPing: 55.6, marketKind: "listing" }
  ];

  const unrestricted = analyzer.analyzeMarket(base, items);
  const customFilter = analyzer.analyzeMarket(base, items, { compareAreaPreset: "custom", compareAreaMin: 40 });

  assert.equal(unrestricted.listing.count, 3);
  assert.equal(unrestricted.listing.areaRange.label, "估算坪數：28-32坪（目前坪數±2坪）");
  assert.equal(unrestricted.listing.estimateCount, 1);
  assert.equal(unrestricted.listing.medianPrimary, 1500);
  assert.equal(customFilter.listing.estimateCount, 1);
  assert.equal(customFilter.listing.medianPrimary, 1500);
});
