import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import {
  TIME_ZONE,
  V1_GLOBALS,
  declaredGlobals,
  formatDay,
  formatMonth,
  handlePost,
  readPortfolio,
  selfCheck,
  tokenMatches,
} from '../scripts/lib/portfolio-read.mjs';
import { fmtSignedPctFromRatio, toneClass } from '../site/js/format.js';

const LABELS = {
  equityA: { name: 'EXMP', kind: '股票' },
  equityB: { name: 'SAMP', kind: '股票' },
  fundUsd: { name: 'USD fund', kind: '貨幣基金' },
  fundHkd: { name: 'HKD fund', kind: '貨幣基金' },
};

const SENTINEL = 424242.42;

function gridSheet(rows) {
  return {
    calls: [],
    getLastRow() { return rows.length; },
    getRange(...args) {
      this.calls.push(args);
      if (args.length === 1) {
        throw new Error('table sheet was asked for an A1 cell');
      }
      const [row, column, numRows, numColumns] = args;
      const out = [];
      for (let offset = 0; offset < numRows; offset += 1) {
        const source = rows[row - 1 + offset] || [];
        const slice = [];
        for (let col = 0; col < numColumns; col += 1) slice.push(source[column - 1 + col]);
        out.push(slice);
      }
      return { getValues: () => out };
    },
  };
}

function priceSheet(cells) {
  return {
    calls: [],
    getRange(address) {
      this.calls.push(address);
      return { getValue: () => (Object.hasOwn(cells, address) ? cells[address] : null) };
    },
  };
}

function workbook({ prices, trades, monthly, settings, cashflow = {}, daily = {} } = {}) {
  const sheets = {
    現價: prices,
    交易紀錄: trades,
    每月表現: monthly,
    設定: settings,
    現金流: cashflow,
    每日總值: daily,
  };
  return {
    opened: 0,
    getSheetByName(name) {
      this.opened += 1;
      return sheets[name] || null;
    },
  };
}

const serialNov5 = 25569 + Date.UTC(2026, 10, 5) / 86400000;

function sampleContext(overrides = {}) {
  let reads = 0;
  const prices = priceSheet({
    E8: 7.8,
    C2: 2,
    D2: 10,
    E2: 12,
    F2: 24,
    C3: 0,
    D3: '',
    E3: null,
    F3: 0,
    F4: 5,
    G5: 78,
    G10: SENTINEL,
    F11: 100,
    C9: '',
    G12: 3,
    I13: 0.05,
  });
  const trades = gridSheet([
    ['日期', '方向', '代號', '數量', '價格', '金額', '備註'],
    [serialNov5, '買', 'EXMP', 2, 10, 20, 'synthetic'],
    ['2026-10-01', '買入合計', '', 2, '', 20, ''],
    ['2026-11-04', '賣', 'SAMP', 1, 4, 4, ''],
    [new Date('2026-11-05T20:35:00Z'), '買', ' LATE ', 1, 1, 1, ''],
  ]);
  const monthly = gridSheet([
    ['月份', 'nav', 'stocks', 'funds', 'cash', 'deposits', 'return', 'change', 'changePct'],
    ['2026-10', 10, 4, 3, 2, 9, 0.01, 1, 0.1],
    ['', 99, 0, 0, 0, 0, 0, 0, 0],
    [serialNov5, 11, 5, 3, 2, 9, 0.02, 1, 0.1],
  ]);
  const settings = gridSheet([
    ['項目', '值'],
    ['其他', 'ignore'],
    ['最後更新', new Date('2026-11-05T12:00:00Z')],
  ]);
  const ss = workbook({ prices, trades, monthly, settings });
  return {
    reads: () => reads,
    prices,
    expectedToken: 'correct-token',
    labels: LABELS,
    now: new Date('2026-11-05T20:35:00Z'),
    getSpreadsheet() {
      reads += 1;
      return ss;
    },
    ...overrides,
  };
}

test('sheet dates stay on the Helsinki calendar for serials, strings, and instants', () => {
  assert.equal(TIME_ZONE, 'Europe/Helsinki');
  assert.equal(formatDay(serialNov5), '2026-11-05');
  assert.equal(formatDay(String(serialNov5)), '2026-11-05');
  assert.equal(formatDay('2026-11-05'), '2026-11-05');
  assert.equal(formatMonth('2026-11'), '2026-11');
  assert.equal(formatMonth(serialNov5), '2026-11');
  assert.equal(formatDay(new Date('2026-11-05T20:35:00Z')), '2026-11-05');
  assert.equal(formatDay(new Date('2026-11-05T22:30:00Z')), '2026-11-06');
  assert.equal(formatDay(''), '');
  assert.equal(formatDay(new Date('not-a-date')), '');
});

test('getPortfolio reads only the fixed cells and keeps pnlPct as a ratio', () => {
  const ctx = sampleContext();
  const response = handlePost({
    postData: { contents: JSON.stringify({ action: 'getPortfolio', payload: { range: 'A1:ZZ' }, token: 'correct-token' }) },
  }, ctx);
  assert.equal(response.ok, true);
  assert.equal(response.data.overview.totalHkd, SENTINEL);
  assert.equal(response.data.overview.netDeposit, null);
  assert.equal(response.data.overview.pnlPct, 0.05);
  assert.equal(fmtSignedPctFromRatio(response.data.overview.pnlPct), '+5.00%');
  assert.equal(toneClass(response.data.overview.pnlPct), 'up');
  assert.equal(response.data.overview.lastUpdated, '2026-11-05');
  assert.deepEqual(response.data.holdings.map((holding) => holding.name), ['EXMP', 'SAMP', 'USD fund', 'HKD fund']);
  assert.equal(response.data.holdings[0].mvHkd, 24 * 7.8);
  assert.equal(response.data.holdings[1].qty, 0);
  assert.equal(response.data.holdings[1].mvHkd, 0);
  assert.equal(response.data.holdings[2].mvHkd, 5 * 7.8);
  assert.equal(response.data.holdings[3].mvUsd, 78 / 7.8);
  assert.deepEqual(response.data.monthly.map((row) => row.month), ['2026-10', '2026-11']);
  assert.deepEqual(response.data.trades.map((trade) => trade.ticker), ['LATE', 'SAMP', 'EXMP']);
  assert.deepEqual(response.data.trades.map((trade) => trade.date), ['2026-11-05', '2026-11-04', '2026-11-05']);
  assert.equal(ctx.reads(), 1);
  assert.ok(!ctx.prices.calls.includes('A1'));
  assert.ok(!ctx.prices.calls.includes('ZZ99'));
  for (const address of ['E8', 'C2', 'F2', 'F4', 'G5', 'G10', 'F11', 'C9', 'G12', 'I13']) {
    assert.ok(ctx.prices.calls.includes(address), address);
  }
});

test('a blank FX rate does not invent a converted market value', () => {
  const ctx = sampleContext();
  const response = handlePost({
    postData: { contents: JSON.stringify({ action: 'getPortfolio', payload: {}, token: 'correct-token' }) },
  }, {
    ...ctx,
    getSpreadsheet() {
      const base = ctx.getSpreadsheet();
      base.getSheetByName('現價').getRange = (address) => ({
        getValue: () => (address === 'E8' ? '' : priceValue(address)),
      });
      return base;
    },
  });
  assert.equal(response.data.overview.rate, null);
  assert.equal(response.data.holdings[3].mvUsd, null);
  assert.equal(response.data.overview.netDeposit, null);
});

function priceValue(address) {
  const cells = {
    C2: 1, D2: 1, E2: 1, F2: 1, C3: 1, D3: 1, E3: 1, F3: 1, F4: 1, G5: 10,
    G10: 1, F11: 1, C9: '', G12: -1, I13: -0.02,
  };
  return cells[address];
}

test('negative pnl ratio stays negative for the green-down tone', () => {
  const ctx = sampleContext();
  ctx.getSpreadsheet = () => {
    const ss = sampleContext().getSpreadsheet();
    const prices = ss.getSheetByName('現價');
    const original = prices.getRange.bind(prices);
    prices.getRange = (address) => (address === 'I13' ? { getValue: () => -0.02 } : original(address));
    return ss;
  };
  const response = handlePost({
    postData: { contents: JSON.stringify({ action: 'getPortfolio', token: 'correct-token' }) },
  }, ctx);
  assert.equal(response.data.overview.pnlPct, -0.02);
  assert.equal(fmtSignedPctFromRatio(response.data.overview.pnlPct), '−2.00%');
  assert.equal(toneClass(response.data.overview.pnlPct), 'down');
});

test('unauthorized, missing, and wrong tokens never include balances or open the workbook', () => {
  const cases = [
    [{ postData: { contents: JSON.stringify({ action: 'getPortfolio', token: 'wrong-token' }) } }, 'correct-token'],
    [{ postData: { contents: JSON.stringify({ action: 'getPortfolio', token: 'correct-token' }) } }, ''],
    [{ postData: { contents: JSON.stringify({ action: 'getPortfolio' }) } }, 'correct-token'],
    [{ postData: { contents: JSON.stringify({ action: 'getPortfolio', token: 'short' }) } }, 'correct-token'],
  ];
  for (const [event, expectedToken] of cases) {
    let opened = 0;
    const response = handlePost(event, {
      expectedToken,
      labels: LABELS,
      getSpreadsheet() { opened += 1; throw new Error(`opened with ${SENTINEL}`); },
    });
    assert.equal(response.ok, false);
    assert.equal(response.error, 'unauthorized');
    assert.equal(response.data, null);
    assert.equal(opened, 0);
    assert.equal(JSON.stringify(response).includes(String(SENTINEL)), false);
    assert.equal(JSON.stringify(response).includes('EXMP'), false);
  }
  assert.equal(tokenMatches('correct-token', 'correct-token'), true);
  assert.equal(tokenMatches('correct-token', 'correct-tokem'), false);
});

test('invalid bodies and disallowed actions do not read the sheet', () => {
  const events = [
    {},
    { postData: { contents: '' } },
    { postData: { contents: '{' } },
    { postData: { contents: 'null' } },
    { postData: { contents: JSON.stringify({ action: 'recordDailyValue', token: 'correct-token' }) } },
    { postData: { contents: JSON.stringify({ action: 'getData', token: 'correct-token' }) } },
    { postData: { contents: JSON.stringify({ token: 'correct-token' }) } },
  ];
  for (const event of events) {
    let opened = 0;
    const response = handlePost(event, {
      expectedToken: 'correct-token',
      labels: LABELS,
      getSpreadsheet() { opened += 1; return { sentinel: SENTINEL }; },
    });
    assert.equal(response.ok, false);
    assert.equal(response.data, null);
    assert.equal(opened, 0);
    assert.ok(response.error === 'bad_request' || response.error === 'action_not_allowed');
    assert.equal(JSON.stringify(response).includes(String(SENTINEL)), false);
  }
});

test('a missing price sheet fails closed without echoing cell values', () => {
  const response = handlePost({
    postData: { contents: JSON.stringify({ action: 'getPortfolio', token: 'correct-token' }) },
  }, {
    expectedToken: 'correct-token',
    labels: LABELS,
    getSpreadsheet() {
      return workbook({ trades: gridSheet([[]]), monthly: gridSheet([[]]) });
    },
  });
  assert.deepEqual(response, { ok: false, error: 'read_failed', data: null });
});

test('self-check reports missing tabs and never returns values', () => {
  let ranged = 0;
  const ss = {
    getSheetByName(name) {
      if (name === '現價') {
        return { getRange() { ranged += 1; return { getValue: () => SENTINEL }; } };
      }
      return name === '交易紀錄' ? {} : null;
    },
  };
  const report = selfCheck(ss, false);
  assert.deepEqual(report.missingSheets, ['每月表現', '現金流', '每日總值', '設定']);
  assert.equal(report.tokenConfigured, false);
  assert.equal(selfCheck(workbook(), 'set').tokenConfigured, true);
  assert.equal(ranged, 0);
  assert.equal(JSON.stringify(report).includes(String(SENTINEL)), false);
});

test('private adapter source does not collide with v1 or mutate the sheet', { skip: existsSync('/opt/cursor/artifacts/investment-v2-private-adapter/InvestmentV2Adapter.gs') ? false : 'private adapter artifact is not on this machine' }, () => {
  const source = readFileSync('/opt/cursor/artifacts/investment-v2-private-adapter/InvestmentV2Adapter.gs', 'utf8');
  const names = declaredGlobals(source);
  const overlap = names.filter((name) => V1_GLOBALS.includes(name));
  assert.deepEqual(overlap, []);
  assert.equal(source.match(/^function doPost\b/gm).length, 1);
  assert.equal(source.includes('function doGet'), false);
  assert.equal(source.includes('function getData'), false);
  assert.equal(source.includes('function recordDailyValue'), false);
  assert.doesNotMatch(source, /\b(setValue|setValues|appendRow|clearContent|deleteRow|deleteRows)\s*\(/);
  assert.doesNotMatch(source, /\|\|\s*100000\b/);
  for (const address of ['E8', 'C2', 'F4', 'G5', 'G10', 'F11', 'C9', 'G12', 'I13']) {
    assert.match(source, new RegExp(`'${address}'`));
  }
  assert.equal(source.includes(String(SENTINEL)), false);
});
