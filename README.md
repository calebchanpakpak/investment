# 投資紀錄

Static v2 dashboard for a private portfolio. The site is plain HTML, CSS, and JavaScript for GitHub Pages at `/investment/`. It does not contain holdings, account totals, sheet IDs, or API keys.

The private workbook stays in Google Sheets. A container-bound Apps Script web app, kept out of this repository, is the only place that reads it. This frontend stores that web app URL and a bearer token in this app's IndexedDB on the device.

## What you see

- Portfolio totals, holdings, monthly history, and trades, only after you connect your own backend. An empty install shows setup text, not sample balances.
- Futu brokerage positions and deals when the adapter adds an optional `data.futu` block (synced from the owner's Mac, outside this repo). Those positions are shown first. Spreadsheet holdings and trades stay on the page as a secondary record. If `futu` is missing or null, the page is unchanged.
- US market headlines from a delayed public cache of the [CNBC RSS feed](https://www.cnbc.com/id/10000664/device/rss/rss.html). Headlines are not limited to your holdings.
- Announced FOMC dates parsed from the [Federal Reserve calendar](https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm).
- Company search over the SEC [company_tickers.json](https://www.sec.gov/files/company_tickers.json) file, with links to EDGAR and to CNBC or Google News search. Search links are not fetched articles.
- A rules checklist. It is not an AI write-up and it does not estimate future prices or earnings.

Each news item shows the source, the published time, and when this cache was fetched. Stale, failed, empty, and loading states stay visible. The cache is delayed. It is not a live quote.

## Colour and layout

Green is up and red is down, with `+`/`−` and `▲`/`▼`, matching the US market convention. Zero is grey. The interface language is Traditional Chinese (`zh-Hant-HK`). Clocks use `Europe/Helsinki` and are labelled EET or EEST（赫爾辛基）. The language does not select the timezone. Return percentages on the sheet are ratios: `0.05` renders as `▲ +5.00%` in green.

The page is split into five tabs: 總覽, 持倉, 成交, 市場, and 設定. On a phone the tab bar sits at the bottom, above the safe area. On a wide window it sticks to the top. Hash links such as `#portfolio`, `#futu`, `#market`, and `#settings` open the matching tab, and the last tab is remembered. A horizontal swipe moves between tabs without taking over vertical scrolling.

## Run the tests

```bash
node --test tests/*.test.mjs
```

`tests/browser.test.mjs` needs Chrome. The GitHub Actions test workflow runs the unit tests and the secret scan.

Refresh the public cache locally with:

```bash
node scripts/fetch-public-cache.mjs
```

That command requests the CNBC RSS URL, the Fed calendar, the SEC ticker file, and a public USD/HKD quote. It does not send portfolio data. The SEC asks clients to send a contact string in `User-Agent`. The default is `investment-public-cache public-cache@example.com` (no personal mailbox). Set `SEC_CONTACT_USER_AGENT` in the scheduler environment if you have a real contact address; do not commit that address if it is private.

## GitHub Pages

This branch does not publish the site. After the pull request is merged to `main`:

1. In the repository settings, open Pages and set the source to GitHub Actions.
2. The workflow `.github/workflows/pages.yml` uploads the `site/` directory. The project site is served at `https://calebchanpakpak.github.io/investment/`.
3. Confirm the scheduled workflow `.github/workflows/refresh-market-cache.yml`. It runs at minute 15 every 6 hours and may commit only `site/data/market-cache.json` and `site/data/symbols.json`. GitHub can start that job later than the cron time. Its only permission is `contents: write` for that commit. It has no secrets. If CNBC, the Fed page, or the SEC file fails, the script keeps the last good rows, sets that section's `ok` to false, and the Actions run ends red after the commit. The page then shows a stale or error state and the source link. It does not describe the old rows as a fresh fetch.

Relative URLs are used so the same files work under `/investment/`. The service worker scope is `./` (that is `/investment/` on GitHub Pages). Its cache name is `investment-v2-shell-3`. It caches the static shell only, and it does not intercept other origins, so the Apps Script POST and the public USD/HKD request are untouched. A waiting worker shows 有新版本，按此更新 and reloads after `SKIP_WAITING`. Other apps on the same `github.io` host are outside that scope. The path is not a security boundary: IndexedDB is shared by the whole origin, which the settings screen says explicitly. This app's snapshot database is `investment-v2-snapshot` and its refresh lock is `investment-v2-refresh`, separate from `investment-tracker-v2`, Vault, and Calendar.

## Portfolio connection

In 設定, save:

- Web app URL: `https://script.google.com/macros/s/…/exec`
- Bearer token, the value stored in Script property `INVESTMENT_TOKEN`

The browser sends:

```http
POST /exec
Content-Type: text/plain;charset=utf-8

{"action":"getPortfolio","payload":{},"token":"…"}
```

`redirect` is `follow`, `cache` is `no-store`, and there is no `Authorization` header, so Apps Script does not get a CORS preflight. The response must be JSON `{ "ok": true, "error": null, "data": { … } }` readable with a normal CORS response. `no-cors` is not used. The only client action is `getPortfolio`.

The token is a single shared secret. Anyone with the device, or with another page on the same origin, can read IndexedDB. It is not multi-user authentication.

`getPortfolio` may include `data.futu`: `{ syncedAt, positions, deals }`. `syncedAt` is an ISO time and is shown in Europe/Helsinki. Position `pl_ratio` is a percentage point value (`-12.18` renders as −12.18%), unlike spreadsheet returns which stay ratios. Option `market_value` is already the contract total (multiplier 100) and is not multiplied again. This page never calls Futu and does not store a brokerage token. A sync older than 24 hours is marked stale. Deals are listed newest first. Deal timestamps that have no timezone are shown as recorded.

The previous Apps Script `doGet` dashboard was left public on purpose. This repository does not disable it. Do not describe the portfolio as protected until every route checks a secret on the server. The private adapter notes for that deployment are not in this repo.

A cached portfolio response is the last successful read. It does not make the spreadsheet recalculate faster, and it is not a broker quote. The phone renders that snapshot immediately, then refreshes on open, when the tab becomes visible, when the network returns, and about every five minutes while the page is visible. One refresh runs at a time. Failures back off from 5 seconds to 5 minutes. The header pill is the refresh status; tap it to refresh, or open 設定 when the token is rejected.

Weekday Futu syncs are expected at 16:00 and 23:15 Europe/Helsinki. If `futu.syncedAt` misses the latest run, after a 30 minute grace, 總覽 shows one warning and the header shows 同步未成功. A sync older than 24 hours replaces that with the stronger stale message. No `futu` block shows a neutral “not synced yet” line instead.

USD totals on 總覽 and 持倉 also show an approximate HKD amount from a public keyless rate (ExchangeRate-API, then Frankfurter, also stored on the public market cache when that job runs). The request sends only the USD/HKD pair. A rate older than 24 hours is labelled as cached. If none has loaded, the USD figure stays and a short note says the HKD rate could not be loaded.

## Sources and limits

| Data | Source | What is stored | Limit |
| --- | --- | --- | --- |
| Headlines | CNBC RSS `10000664` | Title, https link, published time, short description | CNBC's feed TTL is 60 minutes. This cache is scheduled every 6 hours and can be later. Displayed times are Helsinki EET/EEST. Full articles stay on CNBC. |
| FOMC dates | federalreserve.gov calendar | Parsed announced dates, the page note, and the page's own "Last Update" | Not a rate forecast. The Fed says future dates are tentative until confirmed. |
| Symbols | SEC `company_tickers.json` | Ticker, 10-digit CIK, conformed name | The SEC does not guarantee accuracy or coverage. Many fund tickers are absent. |
| USD/HKD | [open.er-api.com](https://open.er-api.com/v6/latest/USD), fallback [Frankfurter](https://api.frankfurter.app/latest?from=USD&to=HKD) | The pair, the source timestamp, and when this cache fetched it | No API key. The request is only the currency pair. A quote older than 24 hours is shown as cached, not live. |

Finnhub is not wired up. A provider key must not be added to the client or this repository. Company quote pages are outbound links only. The only extra request is the public USD/HKD rate above.

## Private backend

The Apps Script that reads the workbook is intentionally absent here. Deploy it separately in the bound script project. Keep `doGet`, `getData`, and the daily `recordDailyValue` trigger. Add the token-gated `doPost` beside them.
