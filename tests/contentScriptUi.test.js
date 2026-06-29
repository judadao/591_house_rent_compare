const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { JSDOM } = require("jsdom");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const createChromeMock = (storage = {}) => {
  const listeners = [];
  const storageListeners = [];
  return {
    storage: {
      local: {
        get(defaults) {
          return Promise.resolve({ ...defaults, ...storage });
        },
        set(values) {
          for (const [key, newValue] of Object.entries(values)) {
            const oldValue = storage[key];
            storage[key] = newValue;
            storageListeners.forEach((listener) => listener({ [key]: { oldValue, newValue } }, "local"));
          }
          return Promise.resolve();
        }
      },
      onChanged: {
        addListener(listener) {
          storageListeners.push(listener);
        }
      }
    },
    runtime: {
      onMessage: {
        addListener(listener) {
          listeners.push(listener);
        }
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
  };
};

const loadContentScript = async (html, url = "https://rent.591.com.tw/list?region=1", storage = {}) => {
  const dom = new JSDOM(html, { url, runScripts: "outside-only" });
  dom.window.chrome = createChromeMock(storage);
  const context = dom.getInternalVMContext();
  vm.runInContext(read("src/listingParser.js"), context);
  vm.runInContext(read("src/contentScript.js"), context);
  await flush();
  await new Promise((resolve) => setTimeout(resolve, 600));
  return dom;
};

test("annotates 591 rental search cards against the page average", async () => {
  const dom = await loadContentScript(`<!doctype html><html><body>
    <main>
      <article>
        <a href="https://rent.591.com.tw/1001">板橋一房</a>
        <div class="price">10,000 元/月</div>
        <div>10坪 整層住家</div>
      </article>
      <article>
        <a href="https://rent.591.com.tw/1002">板橋兩房</a>
        <div class="price">20,000 元/月</div>
        <div>20坪 整層住家</div>
      </article>
      <article>
        <a href="https://rent.591.com.tw/1003">板橋三房</a>
        <div class="price">30,000 元/月</div>
        <div>30坪 整層住家</div>
      </article>
    </main>
  </body></html>`);

  const document = dom.window.document;
  const summary = document.querySelector("#rent-avg-compare-summary");
  const badges = [...document.querySelectorAll(".rent-avg-compare-badge")];

  assert.match(summary.textContent, /本頁租金平均 \$20,000/);
  assert.match(summary.textContent, /採計 3 筆/);
  assert.equal(badges.length, 3);
  assert.match(badges[0].textContent, /低於平均 \$10,000 \(50%\)/);
  assert.match(badges[1].textContent, /等於平均/);
  assert.match(badges[2].textContent, /高於平均 \$10,000 \(50%\)/);
  assert.equal(document.querySelectorAll("aside").length, 0);
});

test("message API can rescan the page and scrape rent listings", async () => {
  const dom = await loadContentScript(`<!doctype html><html><body>
    <section>
      <a href="https://rent.591.com.tw/987654">江子翠華廈</a>
      <span class="price">32,000 元/月</span>
      <span>25坪 2房1廳1衛 華廈 新北市板橋區</span>
    </section>
  </body></html>`);

  const annotateResponse = dom.window.chrome.__dispatch({ type: "ANNOTATE_RENT_AVERAGE" });
  const scrapeResponse = dom.window.chrome.__dispatch({ type: "SCRAPE_LIST" });

  assert.equal(annotateResponse.ok, true);
  assert.equal(annotateResponse.count, 1);
  assert.equal(Math.round(annotateResponse.average), 32000);
  assert.equal(scrapeResponse.ok, true);
  assert.equal(scrapeResponse.listings.length, 1);
  assert.equal(scrapeResponse.listings[0].id, "987654");
  assert.equal(scrapeResponse.listings[0].mode, "rent");
  assert.equal(scrapeResponse.listings[0].monthlyRent, 32000);
  assert.equal(scrapeResponse.listings[0].area, 25);
});

test("toggle message disables and clears rent average annotations", async () => {
  const dom = await loadContentScript(`<!doctype html><html><body>
    <main>
      <article>
        <a href="https://rent.591.com.tw/1001">板橋一房</a>
        <div class="price">10,000 元/月</div>
        <div>10坪 整層住家</div>
      </article>
      <article>
        <a href="https://rent.591.com.tw/1002">板橋兩房</a>
        <div class="price">20,000 元/月</div>
        <div>20坪 整層住家</div>
      </article>
    </main>
  </body></html>`);

  assert.ok(dom.window.document.querySelector("#rent-avg-compare-summary"));

  const response = dom.window.chrome.__dispatch({ type: "SET_RENT_AVERAGE_ENABLED", enabled: false });

  assert.equal(response.ok, true);
  assert.equal(response.enabled, false);
  assert.equal(dom.window.document.querySelector("#rent-avg-compare-summary"), null);
  assert.equal(dom.window.document.querySelector(".rent-avg-compare-badge"), null);
});

test("stored disabled state prevents automatic annotation", async () => {
  const dom = await loadContentScript(`<!doctype html><html><body>
    <main>
      <article>
        <a href="https://rent.591.com.tw/1001">板橋一房</a>
        <div class="price">10,000 元/月</div>
        <div>10坪 整層住家</div>
      </article>
    </main>
  </body></html>`, "https://rent.591.com.tw/list?region=1", { rentAverageEnabled: false });

  assert.equal(dom.window.document.querySelector("#rent-avg-compare-summary"), null);
  assert.equal(dom.window.document.querySelector(".rent-avg-compare-badge"), null);
});

test("does not annotate non-rental-detail pages", async () => {
  const dom = await loadContentScript(`<!doctype html><html><body>
    <main>
      <article>
        <a href="https://rent.591.com.tw/1001">板橋一房</a>
        <div class="price">10,000 元/月</div>
        <div>10坪 整層住家</div>
      </article>
    </main>
  </body></html>`, "https://rent.591.com.tw/1001");

  assert.equal(dom.window.document.querySelector("#rent-avg-compare-summary"), null);
  assert.equal(dom.window.document.querySelector(".rent-avg-compare-badge"), null);
});
