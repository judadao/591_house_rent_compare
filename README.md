# House Market Compare

Chrome extension for analyzing Taiwan housing listings against nearby asking-price and transaction benchmarks.

## Install Locally

1. Open Chrome and go to `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this repository folder: `D:\JUDD\personal_pro\591_houseRent_comp`.

## Usage

1. Open a supported housing listing page.
2. Click the extension icon to toggle the in-page market panel.
3. The panel stays enabled while you switch listing pages until you close it.
4. Click **分析附近行情** in the page panel to collect nearby comparable listings.
5. For sale listings, switch between **比買房** and **比租屋**.
6. For sale comparison, the result separates **待售開價行情** and **實價登錄成交行情**.
7. For rent listings, the result shows **租屋行情** and estimates a rough monthly mortgage for buying a similar home.

## Market Comparison Shape

The panel summarizes the market by location first, then comparable conditions:

- Default location range: listings within 2km when coordinates are available.
- Fallback range: known area block, such as 府中 or 江子翠, then district, then city.
- Shows total listings inside the range.
- Shows price by age bucket, same-size listings, and listings matching extra conditions such as building type, room count, elevator, and parking.
- Sale prices and transaction prices are displayed separately.

The extension stores data in Chrome local storage only. It does not log in, bypass verification, or run continuous background crawling. Automatic analysis opens normal background search tabs for current listing conditions, collects visible results, then closes those tabs.

## Development

```bash
npm test
npm run check
```

`npm test` runs parser unit tests. `npm run check` validates JavaScript syntax for extension scripts.

## Project Structure

- `manifest.json`: Chrome MV3 extension configuration.
- `src/listingParser.js`: Shared listing parsing and normalization logic.
- `src/marketAnalyzer.js`: Comparable scoring and market benchmark calculations.
- `src/background.js`: Background search orchestration for the in-page panel.
- `src/contentScript.js`: Extracts listing data from 591 pages.
- `src/popup.html`: Extension popup markup.
- `src/popup.css`: Popup styling.
- `src/popup.js`: Storage, comparison logic, and UI behavior.
- `tests/listingParser.test.js`: Parser unit tests.
- `TODO.md`: Completed work, testing direction, and future backlog.

## Notes

591 page markup may change. If extraction becomes inaccurate, update selectors and parsing rules in `src/contentScript.js`.
