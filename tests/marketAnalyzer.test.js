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

test("market slice counts radius items and age buckets", () => {
  const base = {
    ...baseSale,
    latitude: 25.033,
    longitude: 121.565,
    age: 8
  };
  const near = { ...base, id: "near", latitude: 25.034, longitude: 121.566, totalPrice: 3100, pricePerPing: 124, age: 9, marketKind: "listing" };
  const far = { ...base, id: "far", latitude: 25.16, longitude: 121.7, totalPrice: 2500, pricePerPing: 100, age: 25, marketKind: "listing" };
  const result = analyzer.analyzeMarket(base, [near, far], { radiusKm: 2 });

  assert.equal(result.listing.marketSlice.scopeCount, 1);
  assert.equal(result.listing.marketSlice.ageBuckets[0].label, "6-10年");
  assert.equal(result.listing.marketSlice.sameSizeSummary.count, 1);
});

test("market scope falls back to area block when coordinates are absent", () => {
  const base = { ...baseSale, city: "新北市", district: "板橋區", areaBlock: "江子翠" };
  const result = analyzer.analyzeMarket(base, [
    { ...base, id: "same-block", totalPrice: 2000, pricePerPing: 80, marketKind: "listing" },
    { ...base, id: "other-block", areaBlock: "府中", totalPrice: 1800, pricePerPing: 72, marketKind: "listing" }
  ]);

  assert.equal(result.listing.marketSlice.scopeCount, 1);
  assert.equal(result.listing.comparables[0].id, "same-block");
});
