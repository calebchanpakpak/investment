/**
 * Read-only portfolio snapshot. Mirrors the fixed cells of the v1 Apps Script
 * reader. Holding names are supplied by the caller. This file has no account
 * totals and does not write to a spreadsheet.
 *
 * Apps Script Sheet.getRange(row, column, numRows, numColumns) uses a row
 * count, not an end row. Data tables start at row 2, so numRows is lastRow - 1.
 */

export const SHEET_PRICES = '現價';
export const SHEET_TRADES = '交易紀錄';
export const SHEET_MONTHLY = '每月表現';
export const SHEET_SETTINGS = '設定';
export const TIME_ZONE = 'Europe/Helsinki';

export const V1_GLOBALS = [
  'SHEET_TRADES',
  'SHEET_PRICES',
  'SHEET_MONTHLY',
  'SHEET_CASHFLOW',
  'SHEET_DAILY',
  'SHEET_SETTINGS',
  'TZ_HELSINKI',
  'doGet',
  'toSheetDate_',
  'formatDay_',
  'formatMonth_',
  'isBuySell_',
  'settingValue_',
  'getData',
  'recordDailyValue',
  'installTrigger',
];

const PRICE_CELLS = ['E8', 'C2', 'D2', 'E2', 'F2', 'C3', 'D3', 'E3', 'F3', 'F4', 'G5', 'G10', 'F11', 'C9', 'G12', 'I13'];

export function toSheetDate(value) {
  if (value === null || value === undefined || value === '') return null;
  if (Object.prototype.toString.call(value) === '[object Date]') {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const parsed = new Date(Math.round((value - 25569) * 86400 * 1000));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const text = String(value).trim();
  if (!text) return null;
  if (/^\d{4}-\d{2}(-\d{2})?/.test(text)) {
    const parts = text.substring(0, 10).split('-');
    return new Date(Date.UTC(Number(parts[0]), Number(parts[1]) - 1, parts[2] ? Number(parts[2]) : 1, 12, 0, 0));
  }
  if (/^\d+(\.\d+)?$/.test(text)) return toSheetDate(Number(text));
  const fallback = new Date(text);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
}

export function formatInTimeZone(date, timeZone, pattern) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const pick = (type) => parts.find((part) => part.type === type)?.value || '';
  if (pattern === 'yyyy-MM') return `${pick('year')}-${pick('month')}`;
  if (pattern === 'yyyy-MM-dd HH:mm') return `${pick('year')}-${pick('month')}-${pick('day')} ${pick('hour')}:${pick('minute')}`;
  return `${pick('year')}-${pick('month')}-${pick('day')}`;
}

export function formatDay(value, timeZone = TIME_ZONE) {
  const date = toSheetDate(value);
  if (!date) return '';
  return formatInTimeZone(date, timeZone, 'yyyy-MM-dd');
}

export function formatMonth(value, timeZone = TIME_ZONE) {
  const date = toSheetDate(value);
  if (!date) return '';
  return formatInTimeZone(date, timeZone, 'yyyy-MM');
}

export function sheetNumber(value) {
  if (value === '' || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function tokenMatches(expected, presented) {
  if (!expected || presented === null || presented === undefined) return false;
  const given = String(presented);
  const want = String(expected);
  if (!given || given.length !== want.length) return false;
  let mismatch = 0;
  for (let i = 0; i < given.length; i += 1) {
    mismatch |= given.charCodeAt(i) ^ want.charCodeAt(i);
  }
  return mismatch === 0;
}

function settingValue(settings, label) {
  if (!settings) return '';
  const last = settings.getLastRow();
  if (last < 2) return '';
  const rows = settings.getRange(2, 1, last - 1, 2).getValues();
  for (const row of rows) {
    if (String(row[0]).trim() === label) return row[1];
  }
  return '';
}

function equityHolding(cells, prefix, label) {
  const qty = sheetNumber(cells[`${prefix.qty}`]);
  const price = sheetNumber(cells[prefix.price]);
  const cost = sheetNumber(cells[prefix.cost]);
  const mvUsd = sheetNumber(cells[prefix.mvUsd]);
  const rate = sheetNumber(cells.rate);
  return {
    name: label.name,
    qty,
    price,
    cost,
    mvUsd,
    mvHkd: rate == null || mvUsd == null ? null : mvUsd * rate,
    kind: label.kind,
  };
}

/**
 * @param {object} ss spreadsheet with getSheetByName
 * @param {{equityA: object, equityB: object, fundUsd: object, fundHkd: object}} labels
 */
export function readPortfolio(ss, labels, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const prices = ss.getSheetByName(SHEET_PRICES);
  const trades = ss.getSheetByName(SHEET_TRADES);
  const monthly = ss.getSheetByName(SHEET_MONTHLY);
  const settings = ss.getSheetByName(SHEET_SETTINGS);
  if (!prices || !trades || !monthly) {
    throw new Error('read_failed');
  }
  const cells = {};
  for (const address of PRICE_CELLS) cells[address] = prices.getRange(address).getValue();
  const rate = sheetNumber(cells.E8);
  const fundUsd = sheetNumber(cells.F4);
  const fundHkd = sheetNumber(cells.G5);
  const holdings = [
    equityHolding({ ...cells, rate: cells.E8 }, { qty: 'C2', cost: 'D2', price: 'E2', mvUsd: 'F2' }, labels.equityA),
    equityHolding({ ...cells, rate: cells.E8 }, { qty: 'C3', cost: 'D3', price: 'E3', mvUsd: 'F3' }, labels.equityB),
    {
      name: labels.fundUsd.name,
      qty: null,
      price: null,
      cost: null,
      mvUsd: fundUsd,
      mvHkd: rate == null || fundUsd == null ? null : fundUsd * rate,
      kind: labels.fundUsd.kind,
    },
    {
      name: labels.fundHkd.name,
      qty: null,
      price: null,
      cost: null,
      mvUsd: rate ? fundHkd / rate : null,
      mvHkd: fundHkd,
      kind: labels.fundHkd.kind,
    },
  ];

  const monthlyData = [];
  const monthlyLast = monthly.getLastRow();
  if (monthlyLast >= 2) {
    const monthlyRows = monthly.getRange(2, 1, monthlyLast - 1, 9).getValues();
    for (const row of monthlyRows) {
      const month = formatMonth(row[0]);
      if (!month) continue;
      monthlyData.push({
        month,
        nav: sheetNumber(row[1]),
        stocks: sheetNumber(row[2]),
        funds: sheetNumber(row[3]),
        cash: sheetNumber(row[4]),
        deposits: sheetNumber(row[5]),
        returnPct: sheetNumber(row[6]),
        change: sheetNumber(row[7]),
        changePct: sheetNumber(row[8]),
      });
    }
  }

  const tradeList = [];
  const lastTradeRow = trades.getLastRow();
  if (lastTradeRow >= 2) {
    const tradeRows = trades.getRange(2, 1, lastTradeRow - 1, 7).getValues();
    for (let index = tradeRows.length - 1; index >= 0; index -= 1) {
      const row = tradeRows[index];
      const side = row[1];
      const ticker = row[2];
      if (side !== '買' && side !== '賣') continue;
      if (ticker === null || ticker === undefined || String(ticker).trim() === '') continue;
      const day = formatDay(row[0]);
      if (!day) continue;
      tradeList.push({
        date: day,
        side: String(side),
        ticker: String(ticker).trim(),
        qty: sheetNumber(row[3]),
        price: sheetNumber(row[4]),
        amount: sheetNumber(row[5]),
        note: String(row[6] || ''),
      });
    }
  }

  let lastUpdated = '';
  try {
    const rawUpdated = settingValue(settings, '最後更新');
    if (rawUpdated !== '' && rawUpdated !== null && rawUpdated !== undefined) {
      lastUpdated = formatDay(rawUpdated) || String(rawUpdated);
    }
  } catch {
    lastUpdated = '';
  }
  if (!lastUpdated) {
    lastUpdated = formatInTimeZone(now, TIME_ZONE, 'yyyy-MM-dd HH:mm');
  }

  return {
    overview: {
      totalHkd: sheetNumber(cells.G10),
      totalUsd: sheetNumber(cells.F11),
      netDeposit: sheetNumber(cells.C9),
      pnlHkd: sheetNumber(cells.G12),
      pnlPct: sheetNumber(cells.I13),
      rate,
      lastUpdated,
    },
    holdings,
    monthly: monthlyData,
    trades: tradeList,
  };
}

export function failure(error) {
  return { ok: false, error, data: null };
}

export function handlePost(event, ctx) {
  let body;
  try {
    const raw = event && event.postData && event.postData.contents != null ? String(event.postData.contents) : '';
    if (!raw.trim()) return failure('bad_request');
    body = JSON.parse(raw);
    if (!body || typeof body !== 'object' || Array.isArray(body)) return failure('bad_request');
  } catch {
    return failure('bad_request');
  }
  if (!tokenMatches(ctx.expectedToken, body.token)) {
    return failure('unauthorized');
  }
  if (!body || body.action !== 'getPortfolio') {
    return failure('action_not_allowed');
  }
  try {
    return { ok: true, error: null, data: readPortfolio(ctx.getSpreadsheet(), ctx.labels, { now: ctx.now }) };
  } catch {
    return failure('read_failed');
  }
}

export function selfCheck(ss, tokenConfigured) {
  const names = ['交易紀錄', '現價', '每月表現', '現金流', '每日總值', '設定'];
  const missing = names.filter((name) => !ss.getSheetByName(name));
  return { missingSheets: missing, tokenConfigured: !!tokenConfigured };
}

export function declaredGlobals(source) {
  const names = new Set();
  for (const match of source.matchAll(/^function\s+([A-Za-z0-9_]+)/gm)) names.add(match[1]);
  for (const match of source.matchAll(/^var\s+([A-Za-z0-9_]+)/gm)) names.add(match[1]);
  return [...names];
}
