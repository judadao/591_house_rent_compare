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
