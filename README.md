# 投資紀錄

Static v2 dashboard for a private portfolio. The site is plain HTML, CSS, and JavaScript for GitHub Pages at `/investment/`. It does not contain holdings, account totals, sheet IDs, or API keys.

The private workbook stays in Google Sheets. A container-bound Apps Script web app, kept out of this repository, is the only place that reads it. This frontend stores that web app URL and a bearer token in this app's IndexedDB on the device.

## What you see

- 團隊方案, when the adapter adds an optional `data.teamPlan` block. 計劃 is split into 總覽, 策略, 配置, 時間表, and 持股. 策略 shows one strategy at a time. 批准 lists `approvals`, including blocking items. 團隊 has the weekly notes, the members, and a reply box. If `teamPlan` is missing or null, 計劃 says 團隊方案未同步 and the account pages stay as they are. A plan older than three days is marked stale. Nothing is treated as approved until `status` is `approved`. Approving here does not place a broker order.
- Futu account totals (stocks and options, funds, cash), unrealised P/L, holdings, and deals, when `data.futu` is present. The last sync time and a stale or missed-sync warning stay on 總覽. If `futu` is missing or null, those pages say 富途未同步 instead of showing spreadsheet holdings.
- The adapter and token setup screen.

An empty install shows setup text, not sample balances. Text from the adapter is rendered as text, not HTML.

## Colour and layout

Green is up and red is down, with `+`/`−` and `▲`/`▼`, matching the US market convention. Zero is grey. The interface language is Traditional Chinese (`zh-Hant-HK`). Clocks use `Europe/Helsinki` and are labelled EET or EEST（赫爾辛基）. The language does not select the timezone. Return percentages on the sheet are ratios: `0.05` renders as `▲ +5.00%` in green.

The bottom bar on a phone is 總覽, 計劃, 批准, 團隊, and 設定. 持倉 and 成交 open from cards on 總覽, and from `#portfolio` and `#trades`. On a wide window the same bar sticks to the top. `#plan/strategy/core` opens that strategy. `#team` still opens 計劃. `#team/h/0` and `#plan/holdings/0` open a holding. `#approvals` opens the queue. The last main tab, plan section, and strategy are remembered. A fresh visit opens 總覽. A horizontal swipe moves between the five main tabs without taking over vertical scrolling. Switching a tab scrolls back to the top.

## Run the tests

```bash
node --test tests/*.test.mjs
```

`tests/browser.test.mjs` needs Chrome. The GitHub Actions test workflow runs the unit tests and the secret scan.

## GitHub Pages

This branch does not publish the site. After the pull request is merged to `main`:

1. In the repository settings, open Pages and set the source to GitHub Actions.
2. The workflow `.github/workflows/pages.yml` uploads the `site/` directory. The project site is served at `https://calebchanpakpak.github.io/investment/`.

Relative URLs are used so the same files work under `/investment/`. The service worker scope is `./` (that is `/investment/` on GitHub Pages). Its cache name is `investment-v2-shell-7`. It caches the static shell only, and it does not intercept other origins, so the Apps Script POST and the public USD/HKD request are untouched. A waiting worker shows 有新版本，按此更新 and reloads after `SKIP_WAITING`. Other apps on the same `github.io` host are outside that scope. The path is not a security boundary: IndexedDB is shared by the whole origin, which the settings screen says explicitly. This app's snapshot database is `investment-v2-snapshot` and its refresh lock is `investment-v2-refresh`, separate from `investment-tracker-v2`, Vault, and Calendar.

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

`redirect` is `follow`, `cache` is `no-store`, and there is no `Authorization` header, so Apps Script does not get a CORS preflight. The response must be JSON `{ "ok": true, "error": null, "data": { … } }` readable with a normal CORS response. `no-cors` is not used. The client calls `getPortfolio` and, when you approve, reject, or reply, `submitResponse`. The token stays in the JSON body. A queued reply is stored in IndexedDB (`investment-v2-outbox`) and sent again when the network returns. If the adapter does not recognise the action, the page says 後台未支援 and stops retrying that item.

The token is a single shared secret. Anyone with the device, or with another page on the same origin, can read IndexedDB. It is not multi-user authentication.

`getPortfolio` may include `data.futu`: `{ syncedAt, positions, deals, account }`. `syncedAt` is an ISO time and is shown in Europe/Helsinki. Position `pl_ratio` is a percentage point value (`-12.18` renders as −12.18%), unlike spreadsheet returns which stay ratios. Option `market_value` is already the contract total (multiplier 100) and is not multiplied again. This page never calls Futu and does not store a brokerage token. A sync older than 24 hours is marked stale. Deals are listed newest first. Deal timestamps that have no timezone are shown as recorded.

`getPortfolio` may also include `data.teamPlan`. Every field is optional. The page reads `generatedAt`, `planVersion`, `status`, `nav`, `currency`, `summary`, `overview` (`headline`, `bullets`), `actionsForYou` (`due`, `priority`, `text`, `ticketId`, `amountUsd`, `price`, `status`), `strategies` (including `expected.bearPct`, `expected.basePct`, `expected.bullPct`, `expected.horizon`, `expected.expectedProfitUsd`, `expected.assumptions`), `allocation`, `holdings` (including `term`, `action`, `thesis`, `stopLoss`, `takeProfit`, `targets`, `expectedReturnPct`), `timetable` (including `stopLoss` and `takeProfit`), `weeklyReports`, `team`, `risks`, and `openQuestions`. Percent fields are already in percentage points. Timetable `date`, `time`, and `tz` are converted to Europe/Helsinki for display.

The previous Apps Script `doGet` dashboard was left public on purpose. This repository does not disable it. Do not describe the portfolio as protected until every route checks a secret on the server. The private adapter notes for that deployment are not in this repo.

A cached portfolio response is the last successful read. It does not make the spreadsheet recalculate faster, and it is not a broker quote. The phone renders that snapshot immediately, then refreshes on open, when the tab becomes visible, when the network returns, and about every five minutes while the page is visible. One refresh runs at a time. Failures back off from 5 seconds to 5 minutes. The header pill is the refresh status; tap it to refresh, or open 設定 when the token is rejected.

Weekday Futu syncs are expected at 16:00 and 23:15 Europe/Helsinki. If `futu.syncedAt` misses the latest run, after a 30 minute grace, 總覽 shows one warning and the header shows 同步未成功. A sync older than 24 hours replaces that with the stronger stale message. No `futu` block shows a neutral “not synced yet” line instead.

USD totals on 總覽 and 持倉 also show an approximate HKD amount from a public keyless rate (ExchangeRate-API, then Frankfurter). The request sends only the USD/HKD pair. A rate older than 24 hours is labelled as cached. If none has loaded, the USD figure stays and a short note says the HKD rate could not be loaded.

## Sources and limits

| Data | Source | What is stored | Limit |
| --- | --- | --- | --- |
| Account, holdings, deals | Your Apps Script adapter, optional `data.futu` | Nothing in this repo. The device keeps the last response in IndexedDB. | Not a live broker quote. Sync time is the Mac's last push. |
| Team plan | The same adapter, optional `data.teamPlan` | Nothing in this repo. | Not an order. Draft until `status` is `approved`. |
| USD/HKD | [open.er-api.com](https://open.er-api.com/v6/latest/USD), fallback [Frankfurter](https://api.frankfurter.app/latest?from=USD&to=HKD) | The pair and the source timestamp, in this device's local storage | No API key. The request is only the currency pair. A quote older than 24 hours is shown as cached, not live. |

Finnhub is not wired up. A provider key must not be added to the client or this repository. The only extra request is the public USD/HKD rate above.

## Private backend

The Apps Script that reads the workbook is intentionally absent here. Deploy it separately in the bound script project. Keep `doGet`, `getData`, and the daily `recordDailyValue` trigger. Add the token-gated `doPost` beside them.
