import assert from 'node:assert/strict';
import test from 'node:test';
import { installDom } from './dom-shim.mjs';
import { readFileSync } from 'node:fs';
import {
  ER_API_URL,
  FRANKFURTER_URL,
  convertUsdToHkd,
  fetchUsdHkd,
  formatHkdApprox,
  formatRateLine,
  fresherQuote,
  parseErApi,
  parseFrankfurter,
  rateStatus,
  readFxCache,
  writeFxCache,
} from '../site/js/fx.js';
import { buildCache } from '../scripts/fetch-public-cache.mjs';
import { renderApp } from '../site/js/render.js';

installDom();

const sheet = JSON.parse(readFileSync(new URL('./fixtures/portfolio.json', import.meta.url), 'utf8'));
const futu = JSON.parse(readFileSync(new URL('./fixtures/futu.json', import.meta.url), 'utf8'));
const NOW = new Date('2026-11-19T12:00:00Z');

test('USD to HKD conversion rounds to cents and refuses a missing rate', () => {
  assert.equal(convertUsdToHkd(10483.16, 7.78), 81558.98);
  assert.equal(convertUsdToHkd(12.5, 7.8), 97.5);
  assert.equal(convertUsdToHkd(10, 0), null);
  assert.equal(convertUsdToHkd(10, null), null);
  assert.equal(formatHkdApprox(81558.98), '≈ HK$ 81,558.98');
  assert.equal(formatHkdApprox(null), null);
});

test('rate line uses the source timestamp and marks a quote older than 24h as cached', () => {
  const fresh = { rate: 7.78, asOf: '2026-11-19T00:00:02.000Z', source: 'ExchangeRate-API' };
  assert.equal(rateStatus(fresh, NOW), 'fresh');
  assert.equal(formatRateLine(fresh), '1 USD = 7.78 HKD · 更新於 2026-11-19 02:00 EET（赫爾辛基）');
  const stale = { rate: 7.77, asOf: '2026-11-18T00:00:00.000Z' };
  assert.equal(rateStatus(stale, NOW), 'stale');
  assert.match(formatRateLine(stale, { stale: true }), /快取（已超過 24 小時）/);
  assert.equal(rateStatus(null, NOW), 'missing');
  assert.equal(rateStatus({ rate: 7.7 }, NOW), 'missing');
});

test('parsers accept the public payloads and reject anything that is not USD/HKD', () => {
  const er = parseErApi({
    result: 'success',
    base_code: 'USD',
    time_last_update_unix: Date.parse('2026-11-19T00:00:02Z') / 1000,
    rates: { HKD: 7.78, EUR: 0.9 },
  });
  assert.equal(er.rate, 7.78);
  assert.equal(er.asOf, '2026-11-19T00:00:02.000Z');
  assert.equal(parseErApi({ result: 'error', rates: { HKD: 7.7 } }), null);
  assert.equal(parseErApi({ result: 'success', base_code: 'EUR', rates: { HKD: 8 } }), null);
  const frank = parseFrankfurter({ amount: 1, base: 'USD', date: '2026-11-18', rates: { HKD: 7.77 } });
  assert.equal(frank.rate, 7.77);
  assert.equal(frank.dateOnly, true);
  assert.equal(frank.asOfDate, '2026-11-18');
  assert.equal(parseFrankfurter({ base: 'EUR', date: '2026-11-18', rates: { HKD: 8 } }), null);
});

test('client fetch tries ExchangeRate-API then Frankfurter and sends no portfolio data', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (String(url).includes('open.er-api.com')) {
      return { ok: false, status: 503, json: async () => ({}) };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ amount: 1, base: 'USD', date: '2026-11-18', rates: { HKD: 7.77 } }),
    };
  };
  const quote = await fetchUsdHkd(fetchImpl);
  assert.equal(quote.rate, 7.77);
  assert.equal(quote.source, 'Frankfurter');
  assert.deepEqual(calls.map((call) => call.url), [ER_API_URL, FRANKFURTER_URL]);
  for (const call of calls) {
    assert.equal(call.init.method, 'GET');
    assert.equal(call.init.body, undefined);
    assert.equal(JSON.stringify(call.init).includes('token'), false);
    assert.equal(JSON.stringify(call.init).includes('portfolio'), false);
  }
});

test('local cache round-trips the last good quote and ignores a zero rate', () => {
  const mem = new Map();
  const storage = {
    getItem: (key) => mem.get(key) || null,
    setItem: (key, value) => mem.set(key, value),
  };
  writeFxCache({ rate: 7.78, asOf: '2026-11-19T00:00:02.000Z', source: 'ExchangeRate-API' }, storage);
  assert.equal(readFxCache(storage).rate, 7.78);
  writeFxCache({ rate: 0, asOf: '2026-11-19T00:00:02.000Z' }, storage);
  assert.equal(readFxCache(storage).rate, 7.78);
  assert.equal(fresherQuote(
    { rate: 7.7, asOf: '2026-11-18T00:00:00.000Z' },
    { rate: 7.8, asOf: '2026-11-19T00:00:00.000Z' },
  ).rate, 7.8);
});

test('the public cache pipeline stores USD/HKD and falls back when the first source fails', async () => {
  const calls = [];
  const primary = await buildCache({
    now: new Date('2026-11-19T12:00:00Z'),
    fetchImpl: async (url) => {
      calls.push(String(url));
      if (String(url) === ER_API_URL) {
        return JSON.stringify({
          result: 'success',
          base_code: 'USD',
          time_last_update_unix: Date.parse('2026-11-19T00:00:02Z') / 1000,
          rates: { HKD: 7.78 },
        });
      }
      throw new Error('skip');
    },
  });
  assert.equal(primary.fx.ok, true);
  assert.equal(primary.fx.rate, 7.78);
  assert.equal(primary.fx.asOf, '2026-11-19T00:00:02.000Z');
  assert.equal(calls.includes(ER_API_URL), true);
  assert.equal(calls.some((url) => url.includes('token') || url.includes('portfolio')), false);

  const fallback = await buildCache({
    now: new Date('2026-11-19T12:00:00Z'),
    previous: { fx: { rate: 7.5, asOf: '2026-11-01T00:00:00.000Z', fetchedAt: '2026-11-01T00:00:00.000Z' } },
    fetchImpl: async (url) => {
      if (String(url) === FRANKFURTER_URL) {
        return JSON.stringify({ amount: 1, base: 'USD', date: '2026-11-18', rates: { HKD: 7.77 } });
      }
      throw new Error('http_503');
    },
  });
  assert.equal(fallback.fx.ok, true);
  assert.equal(fallback.fx.rate, 7.77);
  assert.equal(fallback.fx.source.name, 'Frankfurter');

  const retained = await buildCache({
    now: new Date('2026-11-19T12:00:00Z'),
    previous: { fx: { rate: 7.5, asOf: '2026-11-01T00:00:00.000Z', fetchedAt: '2026-11-01T00:00:00.000Z' } },
    fetchImpl: async () => { throw new Error('http_503'); },
  });
  assert.equal(retained.fx.ok, false);
  assert.equal(retained.fx.rate, 7.5);
  assert.equal(retained.fx.asOf, '2026-11-01T00:00:00.000Z');
});

function renderPortfolio(extra = {}) {
  const root = document.createElement('div');
  renderApp(root, {
    now: NOW,
    tab: 'overview',
    marketStatus: 'error',
    market: null,
    symbolsStatus: 'error',
    symbols: null,
    connection: { endpointHost: 'script.google.com' },
    portfolioStatus: 'ready',
    portfolio: { ...sheet, futu },
    portfolioFetchedAt: '2026-11-19T01:16:00Z',
    portfolioError: null,
    query: '',
    results: [],
    selected: null,
    endpointDraft: '',
    tokenDraft: '',
    settingsMessage: '',
    ...extra,
  }, { reload() {}, search() {}, select() {}, save() {}, clear() {} });
  return root;
}

test('overview shows the HKD line only from a real quote', () => {
  const missing = renderPortfolio({ fxStatus: 'missing', fxQuote: null });
  assert.match(missing.querySelector('#overview').textContent, /港元匯率未能載入，暫時只顯示美元/);
  assert.equal(missing.querySelector('#overview').textContent.includes('≈ HK$'), false);

  const fresh = renderPortfolio({
    fxStatus: 'fresh',
    fxQuote: { rate: 7.78, asOf: '2026-11-19T00:00:02.000Z', source: 'ExchangeRate-API' },
  });
  const overview = fresh.querySelector('#overview').textContent;
  assert.match(overview, /US\$ 10,483\.16/);
  assert.match(overview, /≈ HK\$ 81,558\.98/);
  assert.match(overview, /1 USD = 7\.78 HKD/);
  const positions = fresh.querySelector('#portfolio').textContent;
  assert.match(positions, /≈ HK\$ 81,558\.98/);

  const stale = renderPortfolio({
    fxStatus: 'stale',
    fxQuote: { rate: 7.78, asOf: '2026-11-17T00:00:00.000Z' },
  });
  assert.equal(stale.querySelector('[data-fx-status="stale"]') != null, true);
  assert.match(stale.querySelector('[data-fx-status="stale"]').textContent, /快取（已超過 24 小時）/);
});
