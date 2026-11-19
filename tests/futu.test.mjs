import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { installDom } from './dom-shim.mjs';
import { fmtSignedPctFromRatio, fmtSignedPctPoints } from '../site/js/format.js';
import {
  OPTION_MULTIPLIER,
  prepareFutu,
} from '../site/js/futu.js';
import { readPortfolioResponse } from '../site/js/portfolio.js';
import { renderApp } from '../site/js/render.js';
import { buildConsiderations } from '../site/js/scenario.js';

installDom();

const sheet = JSON.parse(readFileSync(new URL('./fixtures/portfolio.json', import.meta.url), 'utf8'));
const futu = JSON.parse(readFileSync(new URL('./fixtures/futu.json', import.meta.url), 'utf8'));
const FRESH = new Date('2026-11-19T12:00:00+02:00');
const STALE = new Date('2026-11-20T03:13:22+02:00');
const FETCHED_AT = '2026-11-19T01:16:00Z';

function withFutu(block = futu) {
  return { ...sheet, futu: block };
}

function render(portfolio, now = FRESH) {
  const root = document.createElement('div');
  renderApp(root, {
    now,
    marketStatus: 'error',
    market: null,
    symbolsStatus: 'error',
    symbols: null,
    connection: { endpointHost: 'script.google.com' },
    portfolioStatus: 'ready',
    portfolio,
    portfolioFetchedAt: FETCHED_AT,
    portfolioError: null,
    query: '',
    results: [],
    selected: null,
    endpointDraft: '',
    tokenDraft: '',
    settingsMessage: '',
  }, {
    reload() {},
    search() {},
    select() {},
    save() {},
    clear() {},
  });
  return root;
}

function portfolioText(root) {
  return root.querySelector('#portfolio').textContent;
}

test('fixture pl_ratio is percentage points and option market value is not scaled again', () => {
  assert.equal(OPTION_MULTIPLIER, 100);
  assert.equal(fmtSignedPctPoints(-12.18), '−12.18%');
  assert.equal(fmtSignedPctFromRatio(-12.18), '−1218.00%');
  const view = prepareFutu(withFutu(), FRESH);
  assert.equal(view.stale, false);
  assert.equal(view.syncedLabel, '2026-11-19 03:13 EET（赫爾辛基）');
  assert.deepEqual(view.positions.map((position) => position.kind), ['stock', 'etf', 'option', 'option', 'stock']);
  assert.equal(view.totals.length, 1);
  assert.equal(view.totals[0].marketValue, 10483.16);
  assert.equal(view.totals[0].pl, -1481.82);
  assert.deepEqual(view.deals.map((deal) => deal.dealId), ['D20261118TSLA', 'D20261118NASA', 'D20261117PUT']);
  const boundary = new Date('2026-11-20T03:13:21+02:00');
  assert.equal(prepareFutu(withFutu(), boundary).stale, false);
  assert.equal(prepareFutu(withFutu(), new Date(boundary.getTime() + 1)).stale, true);
});

test('rendering the futu fixture lists positions, totals, and deals newest first', () => {
  const root = render(withFutu());
  const text = portfolioText(root);
  assert.match(text, /Futu 實盤持倉/);
  assert.match(text, /最後同步：2026-11-19 03:13 EET（赫爾辛基）/);
  assert.match(text, /2 隻股票 · 1 隻 ETF · 2 個期權/);
  assert.match(text, /US\$ 10,483\.16/);
  assert.match(text, /−1,481\.82/);
  assert.equal(text.includes('超過 24 小時'), false);
  assert.equal(root.querySelector('[data-futu-stale]'), null);

  const codes = [...root.querySelectorAll('#futu article[data-code]')].map((el) => el.getAttribute('data-code'));
  assert.deepEqual(codes, [
    'US.NVDA',
    'US.NASA',
    'US.NVDA261123P162500',
    'US.NVDA261123C162500',
    'US.TSLA',
  ]);
  assert.equal(root.querySelector('[data-code="US.NVDA"]').getAttribute('data-kind'), 'stock');
  assert.equal(root.querySelector('[data-code="US.NASA"]').getAttribute('data-kind'), 'etf');
  assert.equal(root.querySelector('[data-code="US.NVDA261123P162500"]').getAttribute('data-kind'), 'option');
  assert.equal(root.querySelector('[data-code="US.NVDA261123C162500"]').getAttribute('data-kind'), 'option');
  assert.equal(root.querySelectorAll('.option-note').length, 2);
  assert.match(root.querySelector('[data-code="US.NVDA"]').textContent, /NVIDIA/);
  assert.match(root.querySelector('[data-code="US.NVDA"]').textContent, /25 股/);
  assert.match(root.querySelector('[data-code="US.NVDA"]').textContent, /173\.016/);
  assert.match(root.querySelector('[data-code="US.NVDA"]').textContent, /151\.94/);
  assert.match(root.querySelector('[data-code="US.NVDA"]').textContent, /US\$ 3,798\.50/);
  assert.match(root.querySelector('[data-code="US.NVDA"]').textContent, /−526\.90（−12\.18%） USD/);
  assert.match(root.querySelector('[data-code="US.NVDA"] .futu-pl').className, /\bdown\b/);
  assert.match(root.querySelector('[data-code="US.NASA"]').textContent, /Tema Space Innovators ETF/);
  assert.match(root.querySelector('[data-code="US.NASA"]').textContent, /ETF/);
  assert.match(root.querySelector('[data-code="US.NASA"]').textContent, /−808\.30（−69\.56%） USD/);
  assert.match(root.querySelector('[data-code="US.NVDA261123P162500"]').textContent, /NVDA 261123 162\.50P/);
  assert.match(root.querySelector('[data-code="US.NVDA261123P162500"]').textContent, /1 張/);
  assert.match(root.querySelector('[data-code="US.NVDA261123P162500"]').textContent, /US\$ 1,225\.00/);
  assert.match(root.querySelector('[data-code="US.NVDA261123P162500"]').textContent, /\+260\.00（\+26\.94%） USD/);
  assert.match(root.querySelector('[data-code="US.NVDA261123P162500"] .futu-pl').className, /\bup\b/);
  assert.equal(root.querySelector('[data-code="US.NVDA261123P162500"]').textContent.includes('122,500'), false);
  assert.match(root.querySelector('[data-code="US.NVDA261123C162500"]').textContent, /NVDA 261123 162\.50C/);
  assert.match(root.querySelector('[data-code="US.NVDA261123C162500"]').textContent, /US\$ 76\.00/);
  assert.match(root.querySelector('[data-code="US.NVDA261123C162500"]').textContent, /−602\.00（−88\.79%） USD/);
  assert.match(root.querySelector('[data-code="US.TSLA"]').textContent, /Tesla/);
  assert.match(root.querySelector('[data-code="US.TSLA"]').textContent, /13 股/);
  assert.match(root.querySelector('[data-code="US.TSLA"]').textContent, /371\.891/);
  assert.match(root.querySelector('[data-code="US.TSLA"]').textContent, /\+195\.38（\+4\.04%） USD/);

  const dealIds = [...root.querySelectorAll('#futu-deals article')].map((el) => el.getAttribute('data-deal-id'));
  assert.deepEqual(dealIds, ['D20261118TSLA', 'D20261118NASA', 'D20261117PUT']);
  assert.match(root.querySelector('[data-deal-id="D20261118TSLA"]').textContent, /2026-11-18 15:40:01 · 1 股 × \$380\.10/);
  assert.match(root.querySelector('[data-deal-id="D20261118TSLA"]').textContent, /買入/);
  assert.match(root.querySelector('[data-deal-id="D20261118NASA"]').textContent, /賣出/);
  assert.match(root.querySelector('[data-deal-id="D20261118NASA"] .down').className, /\bdown\b/);
  assert.match(root.querySelector('[data-deal-id="D20261117PUT"]').textContent, /期權/);
  assert.match(root.querySelector('[data-deal-id="D20261117PUT"]').textContent, /合約乘數 100/);

  const holdings = root.querySelector('#sheet-holdings');
  const trades = root.querySelector('#sheet-trades');
  assert.equal(holdings.tagName, 'DETAILS');
  assert.equal(trades.tagName, 'DETAILS');
  assert.equal(holdings.getAttribute('open'), null);
  assert.match(holdings.textContent, /試算表手動持倉（次要）/);
  assert.match(holdings.textContent, /EXMP/);
  assert.match(trades.textContent, /試算表交易紀錄（手動）/);
  assert.match(trades.textContent, /EXMP/);
  assert.match(text, /試算表總覽/);
  assert.equal(root.querySelector('#portfolio h3').textContent.includes('交易列表（最新先）'), false);
});

test('a sync older than 24 hours shows a stale hint', () => {
  const root = render(withFutu(), STALE);
  const banner = root.querySelector('[data-futu-stale]');
  assert.equal(banner.getAttribute('data-futu-stale'), 'age');
  assert.match(banner.className, /\bwarn\b/);
  assert.match(banner.textContent, /超過 24 小時/);
  assert.match(banner.textContent, /2026-11-19 03:13 EET（赫爾辛基）/);
  assert.match(banner.textContent, /請喺 Mac 再同步一次/);
  assert.match(portfolioText(root), /Futu 實盤持倉/);
  assert.match(portfolioText(root), /NVIDIA/);
});

test('missing, null, and absent futu keep the spreadsheet portfolio unchanged', () => {
  const absent = render(sheet);
  const nulled = render({ ...sheet, futu: null });
  assert.equal(portfolioText(absent), portfolioText(nulled));
  assert.equal(absent.querySelector('#futu'), null);
  assert.match(portfolioText(absent), /持倉明細/);
  assert.match(portfolioText(absent), /交易列表（最新先）/);
  assert.equal(portfolioText(absent).includes('Futu 實盤持倉'), false);
  assert.equal(portfolioText(absent).includes('試算表手動持倉'), false);
  assert.match(portfolioText(absent), /上次成功讀取：/);
  assert.equal(portfolioText(absent).includes('上次成功讀取後端'), false);

  const missingTime = render({ ...sheet, futu: { positions: [], deals: [] } });
  const missingText = portfolioText(missingTime);
  assert.match(missingText, /Futu 實盤持倉/);
  assert.match(missingText, /未能確認實盤同步時間/);
  assert.match(missingText, /未有實盤持倉/);
  assert.match(missingText, /未有富途成交/);
  assert.equal(missingTime.querySelector('[data-futu-stale]').getAttribute('data-futu-stale'), 'missing');

  assert.equal(prepareFutu({ futu: [] }), null);
  assert.equal(prepareFutu({}), null);
  assert.equal(prepareFutu(null), null);
});

test('broker text is escaped and does not create elements', () => {
  const evil = structuredClone(withFutu());
  evil.futu.positions.push({
    code: 'US.<img src=x onerror=alert(1)>',
    name: '<script>alert("xss")</script>',
    qty: 1,
    cost_price: 1,
    current_price: 1,
    market_value: 1,
    pl_val: 1,
    pl_ratio: 1,
    currency: 'USD"><script>',
    position_side: '<b>LONG</b>',
  });
  evil.futu.deals.push({
    deal_id: '<script>deal</script>',
    order_id: '"><img>',
    code: 'US.EVIL',
    name: '<img src=x onerror=alert(1)>',
    qty: 1,
    price: 1,
    trd_side: 'BUY<script>',
    create_time: '2026-11-18 16:00:00',
  });
  const root = render(evil);
  assert.equal(root.querySelectorAll('script').length, 0);
  assert.equal(root.querySelectorAll('img').length, 0);
  assert.equal(root.querySelectorAll('b').length, 0);
  const text = root.textContent;
  assert.match(text, /<script>alert\("xss"\)<\/script>/);
  assert.match(text, /<img src=x onerror=alert\(1\)>/);
  assert.match(text, /USD"><script>/);
  assert.match(text, /<b>LONG<\/b>/);
  assert.match(text, /<script>deal<\/script>/);
  const injected = [...root.querySelectorAll('article[data-code]')].find((el) => el.getAttribute('data-code').includes('onerror'));
  assert.equal(injected.getAttribute('data-code'), 'US.<img src=x onerror=alert(1)>');
});

test('rules prefer futu holdings and warn when the sync is stale', () => {
  const fresh = buildConsiderations({
    now: FRESH,
    portfolio: withFutu(),
    portfolioLoaded: true,
    symbol: { ticker: 'NVDA', name: 'NVIDIA' },
  });
  assert.match(fresh.items.find((item) => item.id === 'held').text, /富途實盤包含 NVDA/);
  assert.match(fresh.items.find((item) => item.id === 'held').text, /2026-11-19 03:13 EET（赫爾辛基）/);
  const concentration = fresh.items.find((item) => item.id === 'concentration');
  assert.match(concentration.text, /Tesla/);
  assert.match(concentration.text, /48%/);
  assert.match(concentration.text, /唔係買賣建議/);
  assert.equal(concentration.text.includes('EXMP'), false);
  assert.equal(fresh.items.some((item) => item.id === 'futu-stale'), false);

  const other = buildConsiderations({
    now: FRESH,
    portfolio: withFutu(),
    portfolioLoaded: true,
    symbol: { ticker: 'EXMP', name: 'Example' },
  });
  assert.match(other.items.find((item) => item.id === 'not-held').text, /富途實盤入面未見 EXMP/);

  const stale = buildConsiderations({
    now: STALE,
    portfolio: withFutu(),
    portfolioLoaded: true,
  });
  assert.match(stale.items.find((item) => item.id === 'futu-stale').text, /超過 24 小時/);
});

test('currency totals stay separate and the adapter passes futu through', async () => {
  const view = prepareFutu({
    futu: {
      syncedAt: '2026-11-19T03:13:21+02:00',
      positions: [
        { code: 'US.AAA', name: 'Alpha', qty: 1, market_value: 10, pl_val: 1, currency: 'USD' },
        { code: 'HK.00005', name: 'Beta', qty: 2, market_value: 20, pl_val: -2, currency: 'HKD', position_side: 'SHORT' },
      ],
      deals: [
        { code: 'US.AAA', name: 'Alpha', qty: 1, price: 3, trd_side: 'SELL_SHORT', create_time: '2026-11-18 01:00:00' },
      ],
    },
  }, FRESH);
  assert.deepEqual(view.totals.map((row) => row.marketValueLabel), ['US$ 10.00', 'HK$ 20.00']);
  assert.equal(view.positions[1].sideLabel, '淡倉');
  assert.equal(view.deals[0].sideLabel, '沽空');

  const kept = await readPortfolioResponse({
    type: 'basic',
    json: async () => ({ ok: true, error: null, data: { overview: { totalHkd: 1 }, futu } }),
  });
  assert.equal(kept.futu.positions.length, 5);
  const cleared = await readPortfolioResponse({
    type: 'basic',
    json: async () => ({ ok: true, error: null, data: { overview: { totalHkd: 1 }, futu: null } }),
  });
  assert.equal(cleared.futu, null);
});

test('futu rendering does not build HTML from broker strings', () => {
  const files = ['futu.js', 'render.js', 'scenario.js', 'dom.js'];
  for (const name of files) {
    const source = readFileSync(new URL(`../site/js/${name}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /innerHTML|insertAdjacentHTML|outerHTML|document\.write/);
  }
});
