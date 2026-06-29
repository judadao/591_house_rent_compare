const ENABLED_KEY = "rentAverageEnabled";

const enabledInput = document.querySelector("#enabled");
const rescanButton = document.querySelector("#rescan");
const supportButton = document.querySelector("#support");
const statusNode = document.querySelector("#status");
const SUPPORT_URL = "https://www.buymeacoffee.com/dd_7777";

const setStatus = (message, isError = false) => {
  statusNode.textContent = message;
  statusNode.classList.toggle("error", isError);
};

const activeTab = async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
};

const sendToActiveTab = async (message) => {
  const tab = await activeTab();
  if (!tab?.id || !/rent\.591\.com\.tw/.test(tab.url || "")) {
    throw new Error("請先開啟 591 租屋搜尋頁。");
  }

  try {
    return await chrome.tabs.sendMessage(tab.id, message);
  } catch {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["src/listingParser.js", "src/contentScript.js"]
    });
    return chrome.tabs.sendMessage(tab.id, message);
  }
};

const setEnabled = async (enabled) => {
  await chrome.storage.local.set({ [ENABLED_KEY]: enabled });
  const response = await sendToActiveTab({ type: "SET_RENT_AVERAGE_ENABLED", enabled });
  setStatus(enabled ? `已啟用，找到 ${response?.count || 0} 筆。` : "已停用並清除標註。");
};

const rescan = async () => {
  rescanButton.disabled = true;
  try {
    const response = await chrome.runtime.sendMessage({ type: "RESCAN_ACTIVE_RENT_TAB" });
    if (!response?.ok) throw new Error(response?.error || "重新掃描失敗");
    setStatus(`已重新掃描，找到 ${response.count || 0} 筆。`);
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    rescanButton.disabled = false;
  }
};

document.addEventListener("DOMContentLoaded", async () => {
  const data = await chrome.storage.local.get({ [ENABLED_KEY]: true });
  enabledInput.checked = data[ENABLED_KEY] !== false;
  setStatus(enabledInput.checked ? "目前已啟用。" : "目前已停用。");

  enabledInput.addEventListener("change", () => {
    setEnabled(enabledInput.checked).catch((error) => {
      setStatus(error.message, true);
    });
  });
  rescanButton.addEventListener("click", rescan);
  supportButton.addEventListener("click", () => {
    chrome.tabs.create({ url: SUPPORT_URL });
  });
});
