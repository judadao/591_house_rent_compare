# House Market Compare

Chrome extension for analyzing Taiwan housing listings against nearby asking-price and transaction benchmarks.

## Install Locally

1. Open Chrome and go to `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this repository folder: `D:\JUDD\personal_pro\591_houseRent_comp`.

## Usage

1. Open a supported housing listing page.
2. The in-page market panel appears automatically.
3. Click **分析附近行情** in the page panel to collect nearby comparable listings without opening the extension popup.
4. For sale listings, the result separates **待售開價行情** and **實價登錄成交行情**.
5. For rent listings, the result shows **租屋行情**.
6. Use the popup for advanced filters, manual collection, clearing local data, and CSV export.

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
