# TODO

## Scope

Build a practical Chrome extension that helps compare a 591 rental listing with locally collected listings from the same market.

## Completed In This Pass

- [x] Keep the extension local-first and avoid background crawling.
- [x] Split listing parsing into a testable shared module.
- [x] Improve extraction for city, district, layout, floor, rent type, and feature flags.
- [x] Add configurable comparison options for area range, district, rent type, and room count.
- [x] Add data quality hints for missing price, area, region, type, or room count.
- [x] Add CSV export for collected local listings.
- [x] Add a one-click same-area market search button.
- [x] Add a manual button to open the generated 591 market search page.
- [x] Add sale/rent mode normalization.
- [x] Separate sale asking-price market from transaction market.
- [x] Add in-page auto-display market panel.
- [x] Add background analysis request flow for the in-page panel.
- [x] Add Node-based parser tests and syntax checks.

## Testing Direction

- Parser unit tests cover core text extraction without needing Chrome or 591 live pages.
- Popup and content scripts receive syntax checks with `node --check`.
- Manual browser testing should cover a 591 detail page, a 591 search results page, and a non-591 page error state.
- Manual browser testing should verify **搜尋同區行情** opens a background result tab, collects visible listings, closes the tab, and refreshes comparison results.
- Manual browser testing should verify supported listing pages show the market panel automatically without opening the extension popup.
- Future integration tests should use saved HTML fixtures from 591 pages to catch markup changes.

## Later Improvements

- Add import/export JSON backup for Chrome local storage.
- Add per-city market filters and sort controls.
- Add saved comparison presets, for example "strict same building type" and "loose area benchmark".
- Add fixture-based tests once representative 591 HTML snapshots are available.
