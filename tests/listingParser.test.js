const test = require("node:test");
const assert = require("node:assert/strict");

const parser = require("../src/listingParser");

test("parses Taiwan city and district from listing text", () => {
  assert.deepEqual(parser.parseRegion("台北市 大安區 復興南路"), {
    city: "台北市",
    district: "大安區"
  });
});

test("parses layout, floor, and listing id", () => {
  assert.deepEqual(parser.parseLayout("整層住家 2房1廳1衛 18坪"), {
    rooms: 2,
    livingRooms: 1,
    bathrooms: 1
  });
  assert.deepEqual(parser.parseFloor("樓層 5/12樓"), {
    floor: 5,
    totalFloors: 12
  });
  assert.equal(parser.listingIdFromUrl("https://rent.591.com.tw/rent-detail-123456.html"), "123456");
});

test("normalizes a full listing record", () => {
  const listing = parser.normalizeListing({
    url: "https://rent.591.com.tw/rent-detail-555.html",
    title: "台北市信義區整層住家",
    description: "租金 32,000 元/月 25.5坪 2房1廳1衛 有電梯 可開伙 不可養寵物 車位"
  });

  assert.equal(listing.id, "555");
  assert.equal(listing.price, 32000);
  assert.equal(listing.mode, "rent");
  assert.equal(listing.marketKind, "listing");
  assert.equal(listing.area, 25.5);
  assert.equal(listing.city, "台北市");
  assert.equal(listing.district, "信義區");
  assert.equal(listing.type, "整層住家");
  assert.equal(listing.rooms, 2);
  assert.equal(listing.hasElevator, true);
  assert.equal(listing.allowsCooking, true);
  assert.equal(listing.allowsPet, false);
  assert.equal(listing.hasParking, true);
});

test("normalizes sale listing values separately from rent values", () => {
  const listing = parser.normalizeListing({
    url: "https://sale.591.com.tw/home/house/detail/2/777.html",
    title: "台北市信義區電梯大樓",
    description: "總價 3,200萬 25坪 2房1廳1衛 單價 128萬/坪 屋齡 12年"
  });

  assert.equal(listing.mode, "sale");
  assert.equal(listing.marketKind, "listing");
  assert.equal(listing.totalPrice, 3200);
  assert.equal(listing.pricePerPing, 128);
  assert.equal(listing.monthlyRent, null);
  assert.equal(listing.buildingType, "電梯大樓");
  assert.equal(listing.age, 12);
});

test("parses and infers main area from public facility ratio", () => {
  const direct = parser.normalizeListing({
    url: "https://sale.591.com.tw/home/house/detail/2/778.html",
    title: "新北市板橋區捷運江子翠站電梯大樓",
    description: "總價 3000萬 30坪 主建物 20坪 公設比 33%"
  });
  const inferred = parser.normalizeListing({
    url: "https://sale.591.com.tw/home/house/detail/2/779.html",
    title: "新北市板橋區近江子翠站電梯大樓",
    description: "總價 3000萬 30坪 公設比 33%"
  });

  assert.equal(direct.mainArea, 20);
  assert.equal(direct.mainAreaPing, 20);
  assert.equal(direct.publicFacilityRatio, 0.33);
  assert.equal(direct.transitStation, "江子翠");
  assert.equal(inferred.mainArea, 20.1);
});

test("builds market search url from current listing conditions", () => {
  const url = parser.buildMarketSearchUrl({
    city: "台北市",
    district: "信義區",
    type: "整層住家",
    rooms: 2
  });
  const parsed = new URL(url);

  assert.equal(parsed.origin, "https://rent.591.com.tw");
  assert.equal(parsed.searchParams.get("keywords"), "台北市 信義區");
});

test("builds regional search keywords from narrow to broad", () => {
  assert.deepEqual(parser.buildRegionalSearchKeywords({
    city: "台北市",
    district: "信義區",
    transitStation: "市政府",
    addressRoad: "松仁路"
  }), [
    "台北市 信義區 市政府捷運",
    "台北市 信義區 市政府站",
    "台北市 信義區 松仁路",
    "台北市 信義區",
    "台北市"
  ]);
});

test("infers known area block from road text", () => {
  const listing = parser.normalizeListing({
    title: "新北市板橋區電梯大樓",
    description: "文化路二段 25坪 2房 總價 1800萬"
  });

  assert.equal(listing.areaBlock, "江子翠");
});
