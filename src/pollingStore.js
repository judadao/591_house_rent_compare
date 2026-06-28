(function initPollingStore(globalScope) {
  const WATCHLIST_KEY = "marketWatchlist";
  const POLL_STATE_KEY = "marketPollState";
  const MARKET_DATA_UPDATED_AT_KEY = "marketDataUpdatedAt";
  const POLL_STATUS_KEY = "marketPollStatus";
  const DEFAULT_POLL_MINUTES = 15;
  const MAX_WATCHLIST_ITEMS = 30;

  const watchKey = (listing, mode = "") => `${listing.id || listing.url}:${mode || listing.mode || "auto"}`;

  const normalizeWatch = (listing, mode = "") => ({
    key: watchKey(listing, mode),
    listing,
    analysisMode: mode,
    updatedAt: new Date().toISOString()
  });

  const addWatch = (watchlist, listing, mode = "") => {
    const next = [normalizeWatch(listing, mode), ...watchlist.filter((item) => item.key !== watchKey(listing, mode))];
    return next.slice(0, MAX_WATCHLIST_ITEMS);
  };

  const dueWatches = (watchlist, pollState = {}, now = Date.now(), intervalMinutes = DEFAULT_POLL_MINUTES) => {
    const intervalMs = intervalMinutes * 60 * 1000;
    return watchlist.filter((watch) => now - (pollState[watch.key] || 0) >= intervalMs);
  };

  const markPolled = (pollState = {}, watch, now = Date.now()) => ({
    ...pollState,
    [watch.key]: now
  });

  const dataIsFresh = (updatedAt, now = Date.now(), minAgeMinutes = DEFAULT_POLL_MINUTES) => {
    const timestamp = Date.parse(updatedAt || "");
    if (!Number.isFinite(timestamp)) return false;
    return now - timestamp < minAgeMinutes * 60 * 1000;
  };

  const api = {
    WATCHLIST_KEY,
    POLL_STATE_KEY,
    MARKET_DATA_UPDATED_AT_KEY,
    POLL_STATUS_KEY,
    DEFAULT_POLL_MINUTES,
    MAX_WATCHLIST_ITEMS,
    watchKey,
    normalizeWatch,
    addWatch,
    dueWatches,
    markPolled,
    dataIsFresh
  };

  globalScope.HouseMarketPollingStore = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
