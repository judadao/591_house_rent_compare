# 591 House Rent Compare

Chrome MV3 extension for comparing a 591 listing against locally collected 591 market data. It focuses on Taiwan housing decisions: buying compares asking prices and transaction benchmarks separately, while renting compares nearby rent by similar size and distance.

## Features

- Auto panel on supported 591 listing pages.
- Compare sale listings against sale asking prices and government transaction data separately.
- Compare sale listings against rental market to estimate same-location rental yield context.
- Compare rent listings by current listing size and address distance.
- Shows current rent, current rent per ping, estimated market rent, market rent per ping, and high/low percentage.
- Local-first cache with 15-minute polling guard to avoid excessive background tabs.
- Only uses 591 and government real-price registration data.
- Keeps detailed sections collapsed by default: rent estimate controls, rent distance buckets, main-area buckets, and age buckets.

## Install Locally

1. Open Chrome and go to `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this repository folder.
5. Open a supported 591 rent or sale detail page.
6. Click the extension icon to toggle the in-page panel.

## Usage

Open a 591 listing page such as:

- `https://rent.591.com.tw/<listing-id>`
- `https://sale.591.com.tw/home/house/detail/...`

The panel reads the current listing automatically. Click **分析附近行情** to collect or refresh local comparables. During background analysis, the extension may open non-active tabs and close them after scraping. The panel shows status text while this is happening.

For rent listings, open **租金估算條件** if you want to adjust:

- `- 坪數`: lower area tolerance.
- `+ 坪數`: upper area tolerance.
- `地址距離`: max distance in km, using parsed coordinates.

Initial controls are collapsed, but once you adjust rent controls they stay open after recalculation.

## Rent Estimate Rules

Rent estimates use comparable listings that match:

- Same mode: rent.
- Same city when available.
- Area range based on the current listing, default `-2/+2` ping.
- Address distance within the selected km range when coordinates are available.

The displayed market rent is normalized as:

```text
market monthly rent = median rent per ping * current listing ping
```

This prevents small listings from making a larger listing's monthly median look too low. High/low percentage is calculated from rent per ping. For example, if current rent is `$1,797/坪` and market median is `$1,791/坪`, it displays roughly `偏高 0.3%`.

## Sale Estimate Rules

Sale mode separates:

- 591 sale asking price listings.
- Government transaction benchmarks.

The comparison prioritizes nearby MRT/area context when available, then area block, district, city, and coordinate distance fallback. Price summaries include same-size, main-area, feature, age, and main-area buckets.

## Data & Privacy

Data is stored in Chrome local storage. The extension does not require login credentials and does not upload listing data to a server. Local data can become stale or incorrect when 591 markup changes, so parser tests cover known page shapes and regressions.

## Development

Install dependencies:

```bash
npm install
```

Run syntax checks:

```bash
npm run check
```

Run tests:

```bash
npm test
```

The test suite includes parser, market analyzer, polling, background, and jsdom content-script UI tests.

## Project Structure

- `manifest.json`: Chrome extension manifest.
- `src/contentScript.js`: In-page panel, current page scraping, UI rendering.
- `src/background.js`: Background analysis and tab orchestration.
- `src/listingParser.js`: Listing normalization and text parsing.
- `src/marketAnalyzer.js`: Market slicing, estimates, and diff calculations.
- `src/pollingStore.js`: Local watch and polling helpers.
- `src/popup.*`: Extension popup UI.
- `tests/`: Node and jsdom tests.

## Known Limits

591 page markup can change. If a page shows impossible values, such as `$240 / $16/坪` for rent, update parser selectors and add a regression test using that page shape.
