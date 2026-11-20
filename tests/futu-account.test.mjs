import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { installDom } from './dom-shim.mjs';
import { normalizeAccount, prepareFutu } from '../site/js/futu.js';
import { renderApp } from '../site/js/render.js';

installDom();

const sheet = JSON.parse(readFileSync(new URL('./fixtures/portfolio.json', import.meta.url), 'utf8'));
const futu = JSON.parse(readFileSync(new URL('./fixtures/futu.json', import.meta.url), 'utf8'));
const NOW = new Date('2026-11-19T12:00:00+02:00');

// Shape pushed by futu-sync → adapter v6 (futu.account). Numbers are made up but consistent:
// total 15,234.50 = securities 10,999.32 (10,485.32 stocks/options + 514.00 cash) + funds 4,235.18.
const ACCOUNT = {
  currency: 'USD',
  totalAssets: 15234.5,
  securitiesAssets: 10999.32,
  fundAssets: 4235.18,
  bondAssets: 0,
  cash: 514,
  marketValue: 10485.32,
  cashByCurrency: { USD: 314, HKD: 1556.2 },
  assetsByCurrency: { USD: 15034.5 },
  accounts: [{ last4: '1234', type: 'CASH', totalAssets: 15234.5 }],
  source: 'futu accinfo_query',
  syncedAt: futu.syncedAt,
};

function withAccount(account) {
  return { ...sheet, futu: { ...futu, account } };
}

function render(portfolio, extra = {}) {
  const root = document.createElement('div');
  renderApp(root, {
    now: NOW,
    marketStatus: 'error',
    market: null,
    symbolsStatus: 'error',
    symbols: null,
    connection: { endpointHost: 'script.google.com' },
    portfolioStatus: 'ready',
    portfolio,
    portfolioFetchedAt: '2026-11-19T01:16:00Z',
    portfolioError: null,
    query: '',
    results: [],
    selected: null,
    endpointDraft: '',
    tokenDraft: '',
    settingsMessage: '',
    fxStatus: 'fresh',
    fxQuote: { rate: 7.78, asOf: '2026-11-19T00:00:02.000Z', source: 'ExchangeRate-API' },
    ...extra,
  }, { reload() {}, search() {}, select() {}, save() {}, clear() {} });
  return root;
}

test('normalizeAccount splits total into stocks/options, funds and cash that add up', () => {
  const a = normalizeAccount(ACCOUNT, futu.syncedAt);
  assert.equal(a.totalAssets, 15234.5);
  assert.equal(a.stocks, 10485.32);
  assert.equal(a.fundAssets, 4235.18);
  assert.equal(a.cash, 514);
  assert.deepEqual(a.parts.map((p) => p.key), ['stocks', 'funds', 'cash']);
  const sum = a.parts.reduce((s, p) => s + Math.round(p.value * 100), 0) / 100;
  assert.equal(sum, 15234.5);
  assert.equal(a.sameSync, true);
  assert.equal(a.accountsLabel, '…1234');
  assert.deepEqual(a.cashByCurrency.map((c) => c.label), ['US$ 314.00', 'HK$ 1,556.20']);
});

test('normalizeAccount fallbacks and leftovers', () => {
  // no securitiesAssets → market value; pending money shows as "other"
  const a = normalizeAccount({ currency: 'USD', totalAssets: 1000, marketValue: 600, fundAssets: 300, cash: 50 }, 'x');
  assert.equal(a.stocks, 600);
  assert.equal(a.other, 50);
  assert.deepEqual(a.parts.map((p) => p.key), ['stocks', 'funds', 'cash', 'other']);
  assert.equal(a.sameSync, false);
  // nothing but total → everything is stocks
  assert.equal(normalizeAccount({ totalAssets: 10 }).stocks, 10);
  for (const bad of [null, [], 'x', {}, { totalAssets: 'abc' }, { totalAssets: null }]) {
    assert.equal(normalizeAccount(bad), null);
  }
});

test('headline 總資產 uses the Futu account total with HKD, sync time and breakdown', () => {
  const root = render(withAccount(ACCOUNT));
  const card = root.querySelector('#overview #account-total');
  assert.ok(card);
  const text = card.textContent;
  assert.match(text, /總資產（美元）/);
  assert.match(text, /US\$ 15,234\.50/);
  assert.match(text, /HK\$/);
  assert.match(text, /118,524/); // 15,234.50 × 7.78
  assert.match(text, /同步：2026-11-19 03:13 EET（赫爾辛基）/);
  assert.equal(card.querySelector('[data-total-source]').getAttribute('data-total-source'), 'futu');
  assert.match(card.querySelector('[data-part="stocks"]').textContent, /股票／期權.*US\$ 10,485\.32/);
  assert.match(card.querySelector('[data-part="funds"]').textContent, /基金.*US\$ 4,235\.18/);
  assert.match(card.querySelector('[data-part="cash"]').textContent, /現金.*US\$ 514\.00/);
  assert.equal(card.querySelector('[data-part="bonds"]'), null);
  assert.match(text, /帳戶：…1234/);
  assert.equal(card.querySelector('[data-account-older]'), null);
  assert.equal(text.includes('手動紀錄'), false);
  assert.equal(root.querySelector('#sheet-overview'), null);
  assert.match(root.querySelector('#overview').textContent, /實盤市值（USD）/);
});

test('without futu.account the page says the account total is missing and keeps position value', () => {
  for (const portfolio of [withAccount(undefined), withAccount(null), withAccount({ totalAssets: 'x' })]) {
    const root = render(portfolio);
    assert.equal(root.querySelector('#overview #account-total'), null);
    const missing = root.querySelector('[data-total-source="missing"]');
    assert.match(missing.textContent, /富途未有傳帳戶總資產/);
    assert.equal(root.querySelector('#overview').textContent.includes('手動紀錄'), false);
    assert.match(root.querySelector('#overview').textContent, /實盤市值（USD）/);
  }
});

test('an account summary from an earlier sync is flagged', () => {
  const root = render(withAccount({ ...ACCOUNT, syncedAt: '2026-11-18T23:15:04+02:00' }));
  const older = root.querySelector('[data-account-older]');
  assert.ok(older);
  assert.match(older.textContent, /上次成功讀取/);
  assert.match(root.querySelector('#account-total').textContent, /同步：2026-11-18 23:15 EET/);
});

test('HKD rate missing still shows the USD total', () => {
  const root = render(withAccount(ACCOUNT), { fxStatus: 'missing', fxQuote: null });
  assert.match(root.querySelector('#account-total').textContent, /US\$ 15,234\.50/);
  assert.match(root.querySelector('#account-total').textContent, /港元匯率未能載入/);
});

test('prepareFutu exposes account and never a full account number', () => {
  const view = prepareFutu(withAccount({ ...ACCOUNT, accounts: [{ last4: '281756479012341234' }] }), NOW);
  assert.equal(view.account.accountsLabel, '…1234');
  assert.equal(prepareFutu({ ...sheet, futu }, NOW).account, null);
});
