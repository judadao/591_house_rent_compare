(function initPollingStore(globalScope) {
  const WATCHLIST_KEY = "marketWatchlist";
  const POLL_STATE_KEY = "marketPollState";
  const DEFAULT_POLL_MINUTES = 180;
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

  const api = {
    WATCHLIST_KEY,
    POLL_STATE_KEY,
    DEFAULT_POLL_MINUTES,
    MAX_WATCHLIST_ITEMS,
    watchKey,
    normalizeWatch,
    addWatch,
    dueWatches,
    markPolled
  };

  globalScope.HouseMarketPollingStore = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
