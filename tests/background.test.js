const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const loadBackground = ({ sendMessageFails = false, tabUrl = "https://rent.591.com.tw/list?region=1" } = {}) => {
  const messageListeners = [];
  const executedScripts = [];
  const sentMessages = [];

  const chrome = {
    scripting: {
      executeScript(details) {
        executedScripts.push(details);
        return Promise.resolve();
      }
    },
    tabs: {
      query() {
        return Promise.resolve([{ id: 99, url: tabUrl }]);
      },
      sendMessage(tabId, message) {
        sentMessages.push({ tabId, message });
        if (sendMessageFails && sentMessages.length === 1) return Promise.reject(new Error("not injected"));
        return Promise.resolve({ ok: true, count: 2, average: 15000 });
      }
    },
    runtime: {
      onMessage: {
        addListener(listener) {
          messageListeners.push(listener);
        }
      }
    }
  };

  const context = { chrome, console, Promise };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(read("src/background.js"), context);

  const sendRuntimeMessage = (message) =>
    new Promise((resolve) => {
      for (const listener of messageListeners) {
        const isAsync = listener(message, {}, resolve);
        if (isAsync) return;
      }
      resolve(undefined);
    });

  return { sendRuntimeMessage, executedScripts, sentMessages };
};

test("popup rescan message asks the active rent tab to annotate the page average", async () => {
  const { sendRuntimeMessage, executedScripts, sentMessages } = loadBackground();

  const response = await sendRuntimeMessage({ type: "RESCAN_ACTIVE_RENT_TAB" });

  assert.equal(response.ok, true);
  assert.equal(response.count, 2);
  assert.equal(executedScripts.length, 0);
  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0].tabId, 99);
  assert.equal(sentMessages[0].message.type, "ANNOTATE_RENT_AVERAGE");
});

test("popup rescan injects scripts when the content script is not loaded yet", async () => {
  const { sendRuntimeMessage, executedScripts, sentMessages } = loadBackground({ sendMessageFails: true });

  const response = await sendRuntimeMessage({ type: "RESCAN_ACTIVE_RENT_TAB" });

  assert.equal(response.ok, true);
  assert.equal(executedScripts.length, 1);
  assert.deepEqual([...executedScripts[0].files], ["src/listingParser.js", "src/contentScript.js"]);
  assert.equal(sentMessages.length, 2);
  assert.equal(sentMessages[1].message.type, "ANNOTATE_RENT_AVERAGE");
});

test("popup rescan ignores non-rent tabs", async () => {
  const { sendRuntimeMessage, executedScripts, sentMessages } = loadBackground({ tabUrl: "https://example.test/" });

  const response = await sendRuntimeMessage({ type: "RESCAN_ACTIVE_RENT_TAB" });

  assert.equal(response.ok, false);
  assert.match(response.error, /591 租屋搜尋頁/);
  assert.equal(executedScripts.length, 0);
  assert.equal(sentMessages.length, 0);
});
