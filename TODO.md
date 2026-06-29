# TODO

## Current Scope

Build a focused Chrome extension for 591 rental search pages:

- Calculate the average monthly rent from listings visible on the current search page.
- Show the page average inline.
- Mark each listing price as above, below, or equal to that average.
- Keep only a small popup for enable/disable and rescan controls.
- Remove floating-panel, sale-comparison, local-cache, and background-crawling UI.

## Completed In This Pass

- [x] Replaced the old in-page market panel with inline search-result annotations.
- [x] Limited manifest host permissions to `rent.591.com.tw`.
- [x] Added a small extension popup toggle for turning annotations on and off.
- [x] Simplified the background script to only trigger a manual rescan from the extension icon.
- [x] Updated tests for search-page average badges and the new icon behavior.
- [x] Updated README to document the new rental-search-only direction.

## Testing Direction

- Parser unit tests cover reusable text extraction.
- Content-script jsdom tests cover page summary and per-card badges.
- Background tests cover manual rescan messaging and content-script injection fallback.
- Manual browser testing should cover 591 rent search pages after changing filters, pagination, and keyword searches.

## Later Improvements

- Add fixture-based tests using saved 591 rent search HTML snapshots.
- Support averages by currently visible sorted/filtered result page only, with a clear label if infinite-scroll results are appended.
- Consider optional averages by rent type or ping bucket if the UI can stay inline and unobtrusive.
