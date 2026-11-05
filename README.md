# 投資紀錄

Static v2 dashboard for a private portfolio. The site is plain HTML, CSS, and JavaScript for GitHub Pages at `/investment/`. It does not contain holdings, account totals, sheet IDs, or API keys.

The private workbook stays in Google Sheets. A container-bound Apps Script web app, kept out of this repository, is the only place that reads it. This frontend stores that web app URL and a bearer token in this app's IndexedDB on the device.

## What you see

- Portfolio totals, holdings, monthly history, and trades, only after you connect your own backend. An empty install shows setup text, not sample balances.
- US market headlines from a delayed public cache of the [CNBC RSS feed](https://www.cnbc.com/id/10000664/device/rss/rss.html). Headlines are not limited to your holdings.
- Announced FOMC dates parsed from the [Federal Reserve calendar](https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm).
- Company search over the SEC [company_tickers.json](https://www.sec.gov/files/company_tickers.json) file, with links to EDGAR and to CNBC or Google News search. Search links are not fetched articles.
- A rules checklist. It is not an AI write-up and it does not estimate future prices or earnings.

Each news item shows the source, the published time, and when this cache was fetched. Stale, failed, empty, and loading states stay visible. The cache is delayed. It is not a live quote.

## Colour and layout

Red is up and green is down, with `+` and `−`, matching the Futu HK convention. The interface language is Traditional Chinese (`zh-Hant-HK`). Clocks use `Europe/Helsinki` and are labelled EET or EEST（赫爾辛基）. The language does not select the timezone. Return percentages on the sheet are ratios: `0.05` renders as `+5.00%` in red.

## Run the tests

```bash
node --test tests/*.test.mjs
```

`tests/browser.test.mjs` needs Chrome. The GitHub Actions test workflow runs the unit tests and the secret scan.

Refresh the public cache locally with:

```bash
node scripts/fetch-public-cache.mjs
```

That command only requests the CNBC RSS URL, the Fed calendar, and the SEC ticker file. The SEC asks clients to send a contact string in `User-Agent`. The default is `investment-public-cache public-cache@example.com` (no personal mailbox). Set `SEC_CONTACT_USER_AGENT` in the scheduler environment if you have a real contact address; do not commit that address if it is private.

## GitHub Pages

This branch does not publish the site. After the pull request is merged to `main`:

1. In the repository settings, open Pages and set the source to GitHub Actions.
2. The workflow `.github/workflows/pages.yml` uploads the `site/` directory. The project site is served at `https://calebchanpakpak.github.io/investment/`.
3. Confirm the scheduled workflow `.github/workflows/refresh-market-cache.yml`. It runs at minute 15 every 6 hours and may commit only `site/data/market-cache.json` and `site/data/symbols.json`. GitHub can start that job later than the cron time. Its only permission is `contents: write` for that commit. It has no secrets. If CNBC, the Fed page, or the SEC file fails, the script keeps the last good rows, sets that section's `ok` to false, and the Actions run ends red after the commit. The page then shows a stale or error state and the source link. It does not describe the old rows as a fresh fetch.

Relative URLs are used so the same files work under `/investment/`. The service worker scope is `./` (that is `/investment/` on GitHub Pages). Its cache name is `investment-v2-shell-1`. Other apps on the same `github.io` host are outside that scope. The path is not a security boundary: IndexedDB is shared by the whole origin, which the settings screen says explicitly.

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

The previous Apps Script `doGet` dashboard was left public on purpose. This repository does not disable it. Do not describe the portfolio as protected until every route checks a secret on the server. The private adapter notes for that deployment are not in this repo.

A cached portfolio response is the last successful read. It does not make the spreadsheet recalculate faster, and it is not a broker quote.

## Sources and limits

| Data | Source | What is stored | Limit |
| --- | --- | --- | --- |
| Headlines | CNBC RSS `10000664` | Title, https link, published time, short description | CNBC's feed TTL is 60 minutes. This cache is scheduled every 6 hours and can be later. Displayed times are Helsinki EET/EEST. Full articles stay on CNBC. |
| FOMC dates | federalreserve.gov calendar | Parsed announced dates, the page note, and the page's own "Last Update" | Not a rate forecast. The Fed says future dates are tentative until confirmed. |
| Symbols | SEC `company_tickers.json` | Ticker, 10-digit CIK, conformed name | The SEC does not guarantee accuracy or coverage. Many fund tickers are absent. |

No unofficial market endpoints are called. Finnhub is not wired up. A provider key must not be added to the client or this repository. Company quote pages are outbound links only.

## Private backend

The Apps Script that reads the workbook is intentionally absent here. Deploy it separately in the bound script project. Keep `doGet`, `getData`, and the daily `recordDailyValue` trigger. Add the token-gated `doPost` beside them.
