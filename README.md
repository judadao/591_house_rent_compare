# 591 Rent Compare

Chrome extension for collecting 591 rental listings while browsing and comparing a listing against similar homes in the same area.

## Install Locally

1. Open Chrome and go to `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this repository folder: `D:\JUDD\personal_pro\591_houseRent_comp`.

## Usage

1. Open a 591 rental listing page and click the extension icon.
2. Click **搜尋同區行情** to automatically open a background 591 search, collect comparable listings, and update the comparison.
3. Click **開啟搜尋頁** if you want to inspect the same search results yourself.
4. Click **儲存物件** to save the current listing without searching.
5. Open a 591 search result page and click **收集本頁列表** when you want to manually add more comparables.
6. Adjust **比較條件** when you want looser or stricter matches.
7. Click **匯出 CSV** to export the local dataset for spreadsheet analysis.

The extension stores data in Chrome local storage only. It does not log in, bypass verification, or run continuous background crawling. Automatic search only opens a normal 591 search result tab for the current listing conditions, collects visible results, then closes that tab.

## Development

```bash
npm test
npm run check
```

`npm test` runs parser unit tests. `npm run check` validates JavaScript syntax for extension scripts.

## Project Structure

- `manifest.json`: Chrome MV3 extension configuration.
- `src/listingParser.js`: Shared listing parsing and normalization logic.
- `src/contentScript.js`: Extracts listing data from 591 pages.
- `src/popup.html`: Extension popup markup.
- `src/popup.css`: Popup styling.
- `src/popup.js`: Storage, comparison logic, and UI behavior.
- `tests/listingParser.test.js`: Parser unit tests.
- `TODO.md`: Completed work, testing direction, and future backlog.

## Notes

591 page markup may change. If extraction becomes inaccurate, update selectors and parsing rules in `src/contentScript.js`.
