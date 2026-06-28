const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const flushAll = async () => {
  for (let index = 0; index < 8; index += 1) await flush();
};

const loadBackground = (storageOverrides = {}) => {
  const alarmListeners = [];
  const updatedListeners = [];
  const storage = {
    listings: [],
    marketWatchlist: [],
    marketPollState: {},
    marketDataUpdatedAt: "2026-01-01T00:00:00.000Z",
    ...storageOverrides
  };
  const tabs = {
    created: [],
    updated: [],
    removed: []
  };
  let nextTabId = 10;

  const chrome = {
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
    scripting: {
      executeScript() {
        return Promise.resolve();
      }
    },
    tabs: {
      create({ url }) {
        const tab = { id: nextTabId++, url };
        tabs.created.push(tab);
        setTimeout(() => {
          updatedListeners.forEach((listener) => listener(tab.id, { status: "complete" }));
        }, 0);
        return Promise.resolve(tab);
      },
      update(tabId, { url }) {
        tabs.updated.push({ tabId, url });
        setTimeout(() => {
          updatedListeners.forEach((listener) => listener(tabId, { status: "complete" }));
        }, 0);
        return Promise.resolve({ id: tabId, url });
      },
      remove(tabId) {
        tabs.removed.push(tabId);
        return Promise.resolve();
      },
      sendMessage() {
        return Promise.resolve({
          listings: [
            {
              id: "sale-found",
              url: "https://sale.591.com.tw/home/house/detail/2/200.html",
              mode: "sale",
              marketKind: "listing",
              title: "板橋華廈",
              totalPrice: 1800,
              area: 25
            }
          ]
        });
      },
      onUpdated: {
        addListener(listener) {
          updatedListeners.push(listener);
        },
        removeListener(listener) {
          const index = updatedListeners.indexOf(listener);
          if (index >= 0) updatedListeners.splice(index, 1);
        }
      }
    },
    runtime: { onMessage: { addListener() {} } },
    alarms: {
      create() {},
      onAlarm: {
        addListener(listener) {
          alarmListeners.push(listener);
        }
      }
    },
    action: { onClicked: { addListener() {} } },
    onInstalled: { addListener() {} },
    onStartup: { addListener() {} }
  };
  chrome.runtime.onInstalled = { addListener() {} };
  chrome.runtime.onStartup = { addListener() {} };

  const context = {
    chrome,
    console,
    setTimeout(fn, ms) {
      if (ms >= 10000) return 0;
      return setTimeout(fn, 0);
    },
    clearTimeout,
    URL,
    Date,
    Promise,
    importScripts(...files) {
      for (const file of files) {
        vm.runInContext(read(path.join("src", file)), context);
      }
    }
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(read("src/background.js"), context);
  return { alarmListeners, storage, tabs };
};

const assertPollingUsesOneBackgroundTab = async (analysisMode) => {
  const dueListing = {
    id: `current-${analysisMode}`,
    url: analysisMode === "sale" ? "https://sale.591.com.tw/home/house/detail/2/123.html" : "https://rent.591.com.tw/123",
    mode: analysisMode,
    city: "新北市",
    district: "板橋區",
    buildingType: "華廈",
    totalPrice: 1800,
    monthlyRent: 32000,
    area: 25
  };
  const { alarmListeners, storage, tabs } = loadBackground({
    marketWatchlist: [
      { key: `current-${analysisMode}:${analysisMode}`, listing: dueListing, analysisMode },
      { key: `other-${analysisMode}:${analysisMode}`, listing: { ...dueListing, id: `other-${analysisMode}` }, analysisMode },
      { key: `third-${analysisMode}:${analysisMode}`, listing: { ...dueListing, id: `third-${analysisMode}` }, analysisMode }
    ]
  });

  alarmListeners[0]({ name: "house-market-poll" });
  await flushAll();

  assert.equal(tabs.created.length, 1);
  assert.equal(tabs.updated.length, 0);
  assert.equal(tabs.removed.length, 1);
  assert.equal(storage.marketPollStatus.state, "done");
  assert.match(storage.marketPollStatus.message, /檢查 1 筆/);
  assert.equal(Object.keys(storage.marketPollState).length, 1);
};

test("polling processes only one due sale watch with one source", async () => {
  await assertPollingUsesOneBackgroundTab("sale");
});

test("polling processes only one due rent watch with one source", async () => {
  await assertPollingUsesOneBackgroundTab("rent");
});
