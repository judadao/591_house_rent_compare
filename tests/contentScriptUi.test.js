const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { JSDOM } = require("jsdom");

const root = path.resolve(__dirname, "..");

const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const createChromeMock = () => {
  const listeners = [];
  const storage = {
    listings: [
      {
        id: "sale-1",
        url: "https://sale.591.com.tw/home/house/detail/2/1.html",
        mode: "sale",
        marketKind: "listing",
        title: "同區電梯大樓",
        city: "新北市",
        district: "板橋區",
        areaBlock: "江子翠",
        buildingType: "電梯大樓",
        rooms: 2,
        area: 25,
        totalPrice: 1800,
        pricePerPing: 72,
        age: 8,
        collectedAt: "2026-01-01T00:00:00.000Z"
      },
      {
        id: "rent-1",
        url: "https://rent.591.com.tw/rent-detail-1.html",
        mode: "rent",
        marketKind: "listing",
        title: "同區租屋",
        city: "新北市",
        district: "板橋區",
        areaBlock: "江子翠",
        buildingType: "電梯大樓",
        rooms: 2,
        area: 24,
        monthlyRent: 32000,
        rentPerPing: 1333,
        collectedAt: "2026-01-01T00:00:00.000Z"
      }
    ],
    options: {},
    panelEnabled: false,
    panelMode: "",
    analysisTimestamps: {},
    marketDataVersion: 11,
    autoAnalysisEnabled: true
  };
  const sentMessages = [];

  return {
    storage,
    sentMessages,
    api: {
      storage: {
        local: {
          get(defaults) {
            return Promise.resolve({ ...defaults, ...storage });
          },
          set(values) {
            Object.assign(storage, values);
            return Promise.resolve();
          }
        }
      },
      runtime: {
        onMessage: {
          addListener(listener) {
            listeners.push(listener);
          }
        },
        sendMessage(message) {
          sentMessages.push(message);
          return Promise.resolve({ ok: true, scraped: 3, added: 2 });
        }
      },
      __dispatch(message) {
        let response;
        for (const listener of listeners) {
          listener(message, {}, (value) => {
            response = value;
          });
        }
        return response;
      }
    }
  };
};

const loadContentScript = async (options = {}) => {
  const html = options.html || `<!doctype html><html><head>
      <meta property="og:title" content="新北市板橋區江子翠電梯大樓">
      <meta name="description" content="新北市板橋區文化路二段 電梯大樓 總價 1,800萬 25坪 2房1廳1衛 屋齡 8年">
    </head><body>
      <h1>新北市板橋區江子翠電梯大樓</h1>
      <div class="price">1,800萬</div>
      <main>新北市板橋區文化路二段 電梯大樓 總價 1,800萬 25坪 2房1廳1衛 屋齡 8年</main>
    </body></html>`;
  const dom = new JSDOM(
    html,
    {
      url: options.url || "https://sale.591.com.tw/home/house/detail/2/123.html",
      runScripts: "outside-only"
    }
  );
  const chrome = createChromeMock();
  if (options.storage) Object.assign(chrome.storage, options.storage);
  dom.window.chrome = chrome.api;
  dom.window.setInterval = () => 0;
  dom.window.setTimeout = (fn) => {
    fn();
    return 0;
  };

  const context = dom.getInternalVMContext();
  vm.runInContext(read("src/listingParser.js"), context);
  vm.runInContext(read("src/marketAnalyzer.js"), context);
  vm.runInContext(read("src/contentScript.js"), context);
  await flush();
  return { dom, chrome };
};

test("extension toggle message opens and closes the in-page panel", async () => {
  const { dom, chrome } = await loadContentScript();

  assert.equal(dom.window.document.querySelector("#hmk-panel"), null);
  const opened = chrome.api.__dispatch({ type: "TOGGLE_PANEL" });
  await flush();
  assert.equal(opened.visible, true);
  assert.ok(dom.window.document.querySelector("#hmk-panel"));
  assert.match(dom.window.document.querySelector("#hmk-panel").textContent, /本機資料：買房開價 1 筆/);
  assert.equal(chrome.storage.panelEnabled, true);

  const closed = chrome.api.__dispatch({ type: "TOGGLE_PANEL" });
  await flush();
  assert.equal(closed.visible, false);
  assert.equal(dom.window.document.querySelector("#hmk-panel"), null);
  assert.equal(chrome.storage.panelEnabled, false);
});

test("panel buttons switch comparison mode and trigger analysis", async () => {
  const { dom, chrome } = await loadContentScript();
  chrome.storage.analysisTimestamps = { "analysis:123:sale": Date.now(), "analysis:123:rent": Date.now() };
  chrome.api.__dispatch({ type: "TOGGLE_PANEL" });
  await flush();

  const rentMode = dom.window.document.querySelector('[data-mode="rent"]');
  assert.ok(rentMode);
  rentMode.click();
  await flush();
  assert.equal(chrome.storage.panelMode, "rent");
  assert.match(dom.window.document.querySelector("#hmk-panel").textContent, /租金估算條件/);
  assert.match(dom.window.document.querySelector("#hmk-panel").textContent, /-2\/\+2/);
  assert.equal(dom.window.document.querySelector('[data-area-preset="20_30"]'), null);
  assert.equal(dom.window.document.querySelector(".hmk-rent-minus").value, "2");
  assert.equal(dom.window.document.querySelector(".hmk-rent-plus").value, "2");
  assert.equal(dom.window.document.querySelector(".hmk-rent-radius").value, "3");
  assert.equal(dom.window.document.querySelector(".hmk-rent-radius").max, "20");
  dom.window.document.querySelector(".hmk-rent-minus").value = "1";
  dom.window.document.querySelector(".hmk-rent-plus").value = "3";
  dom.window.document.querySelector(".hmk-rent-radius").value = "5";
  dom.window.document.querySelector(".hmk-rent-radius").dispatchEvent(new dom.window.Event("change"));
  await flush();
  assert.equal(chrome.storage.options.rentEstimateArea, "");
  assert.equal(chrome.storage.options.rentAreaMinusPing, "1");
  assert.equal(chrome.storage.options.rentAreaPlusPing, "3");
  assert.equal(chrome.storage.options.rentEstimateRadiusKm, "5");

  const action = dom.window.document.querySelector(".hmk-action");
  assert.ok(action);
  action.click();
  await flush();
  assert.equal(chrome.sentMessages.length, 1);
  assert.equal(chrome.sentMessages.at(-1).type, "ANALYZE_NEARBY");
  assert.equal(chrome.sentMessages.at(-1).analysisMode, "rent");
  assert.match(dom.window.document.querySelector("#hmk-panel").textContent, /已用本機資料完成分析/);

  assert.equal(dom.window.document.querySelector(".hmk-reset"), null);
});

test("rent panel displays current unit rent and a sane high diff", async () => {
  const { dom, chrome } = await loadContentScript({
    url: "https://rent.591.com.tw/2695915",
    html: `<!doctype html><html><head>
      <meta property="og:title" content="新北市板橋區新埔電梯大樓">
      <meta name="description" content="新北市板橋區文化路二段 電梯大樓 租金 26,959 元 15坪 2房1廳1衛 捷運新埔站300公尺">
    </head><body>
      <h1>新北市板橋區新埔電梯大樓</h1>
      <main>新北市板橋區文化路二段 電梯大樓 租金 26,959 元 15坪 2房1廳1衛 捷運新埔站300公尺</main>
      <script>window.__NUXT__={"coords":["25.0170","121.4760"]};</script>
    </body></html>`,
    storage: {
      listings: [
        {
          id: "sample-rent-1791",
          url: "https://rent.591.com.tw/2686515",
          mode: "rent",
          marketKind: "listing",
          title: "新北市板橋區新埔電梯大樓",
          city: "新北市",
          district: "板橋區",
          buildingType: "電梯大樓",
          rooms: 2,
          area: 15,
          monthlyRent: 26865,
          latitude: 25.018,
          longitude: 121.476,
          collectedAt: "2026-01-01T00:00:00.000Z"
        }
      ],
      analysisTimestamps: { "analysis:2695915:rent": Date.now() },
      autoAnalysisEnabled: false
    }
  });

  chrome.api.__dispatch({ type: "TOGGLE_PANEL" });
  await flush();

  const text = dom.window.document.querySelector("#hmk-panel").textContent;
  assert.match(text, /\$26,959 \/ \$1,797\/坪/);
  assert.match(text, /\$26,865/);
  assert.match(text, /\$1,791\/坪/);
  assert.match(text, /偏高 0\.3%/);
  assert.doesNotMatch(text, /偏低 0\.9%/);
});

test("empty market sections still keep a single analyze button", async () => {
  const { dom, chrome } = await loadContentScript();
  chrome.storage.listings = [];
  chrome.storage.analysisTimestamps = { "analysis:123:sale": Date.now() };
  chrome.api.__dispatch({ type: "TOGGLE_PANEL" });
  await flush();

  const actions = dom.window.document.querySelectorAll(".hmk-action");
  assert.equal(actions.length, 1);
  assert.match(dom.window.document.querySelector("#hmk-panel").textContent, /按上方/);

  actions[0].click();
  await flush();
  assert.equal(chrome.sentMessages.length, 1);
  assert.equal(chrome.sentMessages[0].type, "ANALYZE_NEARBY");
});

test("opening the panel automatically triggers analysis when local data is thin", async () => {
  const { chrome } = await loadContentScript();
  chrome.storage.analysisTimestamps = {};

  chrome.api.__dispatch({ type: "TOGGLE_PANEL" });
  await flush();
  await flush();

  assert.equal(chrome.sentMessages.length, 1);
  assert.equal(chrome.sentMessages[0].type, "ANALYZE_NEARBY");
});

test("opening the panel automatically rebuilds outdated local data", async () => {
  const { chrome } = await loadContentScript();
  chrome.storage.marketDataVersion = 0;
  chrome.storage.analysisTimestamps = { "analysis:123:sale": Date.now() };

  chrome.api.__dispatch({ type: "TOGGLE_PANEL" });
  await flush();
  await flush();

  assert.equal(chrome.sentMessages.length, 1);
  assert.equal(chrome.sentMessages[0].type, "RESET_AND_ANALYZE");
});

test("auto analysis slider disables automatic requests", async () => {
  const { dom, chrome } = await loadContentScript();
  chrome.storage.autoAnalysisEnabled = false;
  chrome.storage.analysisTimestamps = {};

  chrome.api.__dispatch({ type: "TOGGLE_PANEL" });
  await flush();
  await flush();

  assert.equal(chrome.sentMessages.length, 0);
  const toggle = dom.window.document.querySelector(".hmk-auto-toggle");
  assert.ok(toggle);
  assert.equal(toggle.checked, false);
});

test("panel shows fixed estimate area rule instead of selectable area presets", async () => {
  const { dom, chrome } = await loadContentScript();
  chrome.storage.analysisTimestamps = { "analysis:123:sale": Date.now() };

  chrome.api.__dispatch({ type: "TOGGLE_PANEL" });
  await flush();

  assert.match(dom.window.document.querySelector("#hmk-panel").textContent, /估算坪數規則/);
  assert.match(dom.window.document.querySelector("#hmk-panel").textContent, /±2 坪/);
  assert.equal(dom.window.document.querySelector("[data-area-preset]"), null);
});

test("scrapes 591 Nuxt showing objects from list pages", async () => {
  const { dom, chrome } = await loadContentScript();
  dom.window.document.body.innerHTML = `
    <script>
      window.__NUXT__={state:{"cache":{"items":[
        {showing_object:{target_id:20100989,title:"板橋華廈三房",price_text:"1,388萬",unit_price_text:"55.1萬\\u002F坪",area_text:"25.18坪"},showing_count_7d:62},
        {showing_object:{target_id:20338704,title:"板橋江子翠華廈",price_text:"1,880萬",unit_price_text:"55.6萬\\u002F坪",area_text:"37.31坪"},showing_count_7d:24}
      ]}}};
    </script>
  `;

  const response = chrome.api.__dispatch({ type: "SCRAPE_LIST" });

  assert.equal(response.ok, true);
  assert.equal(response.listings.length, 2);
  assert.equal(response.listings[0].id, "20100989");
  assert.equal(response.listings[0].area, 25.18);
  assert.equal(response.listings[0].totalPrice, 1388);
  assert.equal(response.listings[0].pricePerPing, 55.1);
});

test("scrapes 591 rent cards as rent listings", async () => {
  const { dom, chrome } = await loadContentScript();
  dom.window.document.body.innerHTML = `
    <article>
      <a href="https://rent.591.com.tw/987654">板橋江子翠華廈整層住家</a>
      <div>新北市板橋區 華廈 整層住家 2房1廳1衛 25坪 租金 32,000 元/月 可開伙</div>
    </article>
  `;

  const response = chrome.api.__dispatch({ type: "SCRAPE_LIST" });

  assert.equal(response.ok, true);
  assert.equal(response.listings.length, 1);
  assert.equal(response.listings[0].id, "987654");
  assert.equal(response.listings[0].mode, "rent");
  assert.equal(response.listings[0].monthlyRent, 32000);
  assert.equal(response.listings[0].area, 25);
  assert.equal(response.listings[0].buildingType, "華廈");
});
