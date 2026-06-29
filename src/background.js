const injectContentScript = async (tabId) => {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["src/listingParser.js", "src/contentScript.js"]
  });
};

const annotateTab = async (tabId) => {
  try {
    return await chrome.tabs.sendMessage(tabId, { type: "ANNOTATE_RENT_AVERAGE" });
  } catch {
    await injectContentScript(tabId);
    return chrome.tabs.sendMessage(tabId, { type: "ANNOTATE_RENT_AVERAGE" });
  }
};

const activeTab = async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "RESCAN_ACTIVE_RENT_TAB") return false;

  activeTab()
    .then((tab) => {
      if (!tab?.id || !/rent\.591\.com\.tw/.test(tab.url || "")) {
        return { ok: false, error: "請先開啟 591 租屋搜尋頁。" };
      }
      return annotateTab(tab.id).then((result) => ({ ok: true, ...(result || {}) }));
    })
    .then(sendResponse)
    .catch((error) => sendResponse({ ok: false, error: error.message || "重新掃描失敗" }));

  return true;
});
