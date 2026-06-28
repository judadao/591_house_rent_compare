# 591 Rent Compare

Chrome extension for collecting 591 rental listings while browsing and comparing a listing against similar homes in the same area.

## Install Locally

1. Open Chrome and go to `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this repository folder: `D:\JUDD\personal_pro\591_houseRent_comp`.

## Usage

1. Open a 591 rental listing page and click the extension icon.
2. Click **儲存目前物件** to save the current listing.
3. Open a 591 search result page and click **收集本頁列表**.
4. Return to a listing page to see same-area, same-type, similar-size rent comparisons.

The extension stores data in Chrome local storage only. It does not log in, bypass verification, or run background crawling.

## Project Structure

- `manifest.json`: Chrome MV3 extension configuration.
- `src/contentScript.js`: Extracts listing data from 591 pages.
- `src/popup.html`: Extension popup markup.
- `src/popup.css`: Popup styling.
- `src/popup.js`: Storage, comparison logic, and UI behavior.

## Notes

591 page markup may change. If extraction becomes inaccurate, update selectors and parsing rules in `src/contentScript.js`.
