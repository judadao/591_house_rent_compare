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
    analysisTimestamps: {}
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

const loadContentScript = async () => {
  const dom = new JSDOM(
    `<!doctype html><html><head>
      <meta property="og:title" content="新北市板橋區江子翠電梯大樓">
      <meta name="description" content="新北市板橋區文化路二段 電梯大樓 總價 1,800萬 25坪 2房1廳1衛 屋齡 8年">
    </head><body>
      <h1>新北市板橋區江子翠電梯大樓</h1>
      <div class="price">1,800萬</div>
      <main>新北市板橋區文化路二段 電梯大樓 總價 1,800萬 25坪 2房1廳1衛 屋齡 8年</main>
    </body></html>`,
    {
      url: "https://sale.591.com.tw/home/house/detail/2/123.html",
      runScripts: "outside-only"
    }
  );
  const chrome = createChromeMock();
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
  assert.equal(chrome.storage.panelEnabled, true);

  const closed = chrome.api.__dispatch({ type: "TOGGLE_PANEL" });
  await flush();
  assert.equal(closed.visible, false);
  assert.equal(dom.window.document.querySelector("#hmk-panel"), null);
  assert.equal(chrome.storage.panelEnabled, false);
});

test("panel buttons switch comparison mode and trigger analysis", async () => {
  const { dom, chrome } = await loadContentScript();
  chrome.storage.analysisTimestamps = { "analysis:123:sale": Date.now() };
  chrome.api.__dispatch({ type: "TOGGLE_PANEL" });
  await flush();

  const rentMode = dom.window.document.querySelector('[data-mode="rent"]');
  assert.ok(rentMode);
  rentMode.click();
  await flush();
  assert.equal(chrome.storage.panelMode, "rent");
  assert.match(dom.window.document.querySelector("#hmk-panel").textContent, /租屋行情/);

  const action = dom.window.document.querySelector(".hmk-action");
  assert.ok(action);
  action.click();
  await flush();
  assert.equal(chrome.sentMessages.length, 1);
  assert.equal(chrome.sentMessages.at(-1).type, "ANALYZE_NEARBY");
  assert.equal(chrome.sentMessages.at(-1).analysisMode, "rent");
  assert.match(dom.window.document.querySelector("#hmk-panel").textContent, /已收集 3 筆/);
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

test("opening the panel does not automatically trigger network analysis", async () => {
  const { chrome } = await loadContentScript();
  chrome.storage.analysisTimestamps = {};

  chrome.api.__dispatch({ type: "TOGGLE_PANEL" });
  await flush();
  await flush();

  assert.equal(chrome.sentMessages.length, 0);
});
