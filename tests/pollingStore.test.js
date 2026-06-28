const test = require("node:test");
const assert = require("node:assert/strict");

const polling = require("../src/pollingStore");

test("adds listing watches uniquely and keeps latest first", () => {
  const listing = { id: "123", mode: "sale", url: "https://example.test/123" };
  const watchlist = polling.addWatch([], listing, "rent");
  const updated = polling.addWatch(watchlist, { ...listing, title: "updated" }, "rent");

  assert.equal(updated.length, 1);
  assert.equal(updated[0].key, "123:rent");
  assert.equal(updated[0].listing.title, "updated");
});

test("detects due watches and marks polling state", () => {
  const listing = { id: "123", mode: "sale", url: "https://example.test/123" };
  const watchlist = polling.addWatch([], listing, "sale");
  const now = 1000 * 60 * 60 * 4;

  assert.equal(polling.dueWatches(watchlist, {}, now, 180).length, 1);
  const state = polling.markPolled({}, watchlist[0], now);
  assert.equal(polling.dueWatches(watchlist, state, now + 1000, 180).length, 0);
  assert.equal(polling.dueWatches(watchlist, state, now + 1000 * 60 * 181, 180).length, 1);
});
