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
    { ...base, id: "near-size", district: "other", area: 29, totalPrice: 1688, pricePerPing: 58.2, marketKind: "listing" },
    { ...base, id: "far-size", district: "other", area: 22, totalPrice: 1398, pricePerPing: 63.5, marketKind: "listing" }
  ];
  const result = analyzer.analyzeMarket(base, items);

  assert.equal(result.listing.marketSlice.scopeCount, 3);
  assert.equal(result.listing.comparableMode, "scope");
  assert.equal(result.listing.count, 3);
  assert.equal(result.listing.comparables[0].id, "near-size");
  assert.equal(result.listing.comparables[1].id, "strict-one");
});
