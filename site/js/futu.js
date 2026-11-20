import { fmtMoney, fmtPrice, fmtQty, fmtSignedMoney, fmtSignedPctPoints, formatHelsinkiTime } from './format.js';

/** A sync older than this is shown as stale. Equal to 24h is still fresh. */
export const FUTU_STALE_MS = 24 * 60 * 60 * 1000;

/**
 * Option market_value from the adapter is already the contract total
 * (premium × qty × 100). Do not multiply it again.
 */
export const OPTION_MULTIPLIER = 100;

const OPTION_CODE = /^[A-Z]+\.[A-Z][A-Z0-9]*\d{6}[CP]\d+$/;

const KIND_LABEL = {
  option: '期權',
  etf: 'ETF',
  stock: '股票',
};

/** Buy/cover use the up tone (green). Sell/short use the down tone (red). */
const DEAL_SIDES = {
  BUY: { label: '買入', tone: 'up' },
  SELL: { label: '賣出', tone: 'down' },
  BUY_BACK: { label: '補回', tone: 'up' },
  SELL_SHORT: { label: '沽空', tone: 'down' },
};

function stringField(value) {
  if (value == null) return '';
  return String(value).trim();
}

function finite(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function futuBlock(data) {
  const futu = data?.futu;
  if (!futu || typeof futu !== 'object' || Array.isArray(futu)) return null;
  return futu;
}

export function hasFutu(data) {
  return futuBlock(data) != null;
}

export function isOptionCode(code) {
  return OPTION_CODE.test(stringField(code).toUpperCase());
}

export function positionKind(position) {
  if (isOptionCode(position?.code)) return 'option';
  if (/\bETF\b/i.test(stringField(position?.name))) return 'etf';
  return 'stock';
}

export function underlyingSymbol(code) {
  const upper = stringField(code).toUpperCase();
  if (!upper) return '';
  const option = upper.match(/^[A-Z]+\.([A-Z][A-Z0-9]*)\d{6}[CP]\d+$/);
  if (option) return option[1];
  const stock = upper.match(/^[A-Z]+\.(.+)$/);
  if (stock) return stock[1];
  return upper;
}

export function parseSyncedAt(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const date = new Date(value.trim());
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function nowMs(now) {
  const date = now instanceof Date ? now : new Date(now);
  const ms = date.getTime();
  return Number.isNaN(ms) ? null : ms;
}

function isOlderThan(date, now) {
  const ms = nowMs(now);
  if (ms == null) return true;
  return ms - date.getTime() > FUTU_STALE_MS;
}

export function isFutuStale(syncedAt, now = new Date()) {
  const parsed = parseSyncedAt(syncedAt);
  if (!parsed) return true;
  return isOlderThan(parsed, now);
}

function formatQty(qty, kind) {
  const text = fmtQty(qty);
  if (text === '—') return text;
  return `${text} ${kind === 'option' ? '張' : '股'}`;
}

export function formatMarketValue(value, currency) {
  const money = fmtMoney(value);
  if (money === '—') return money;
  if (currency === 'USD') return `US$ ${money}`;
  if (currency === 'HKD') return `HK$ ${money}`;
  return currency ? `${money} ${currency}` : money;
}

export function formatPl(plVal, plRatio, currency) {
  const money = fmtSignedMoney(plVal);
  const pct = fmtSignedPctPoints(plRatio);
  if (money === '—' && pct === '—') return '—';
  const suffix = currency ? ` ${currency}` : '';
  return `${money}（${pct}）${suffix}`;
}

export function positionSideLabel(side) {
  const raw = stringField(side);
  if (!raw) return '';
  const key = raw.toUpperCase();
  if (key === 'LONG') return '好倉';
  if (key === 'SHORT') return '淡倉';
  return raw;
}

export function dealSide(side) {
  const raw = stringField(side);
  const known = DEAL_SIDES[raw.toUpperCase()];
  if (known) return known;
  return { label: raw || '—', tone: 'flat' };
}

export function dealSortKey(value) {
  const raw = stringField(value);
  if (!raw) return 0;
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(raw)) {
    const parsed = Date.parse(raw);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (match) {
    return Date.UTC(+match[1], +match[2] - 1, +match[3], +match[4], +match[5], +(match[6] || 0));
  }
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? 0 : parsed;
}

export function formatDealTime(value) {
  const raw = stringField(value);
  if (!raw) return '—';
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2})?$/.test(raw)) return raw.replace('T', ' ');
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(raw)) {
    const formatted = formatHelsinkiTime(raw);
    if (formatted !== '—') return formatted;
  }
  return raw;
}

export function normalizePosition(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const code = stringField(raw.code);
  const name = stringField(raw.name);
  const kind = positionKind({ code, name });
  const currency = stringField(raw.currency);
  const qty = finite(raw.qty);
  const plVal = finite(raw.pl_val);
  const plRatio = finite(raw.pl_ratio);
  return {
    code,
    name,
    kind,
    kindLabel: KIND_LABEL[kind],
    symbol: underlyingSymbol(code) || '—',
    qty,
    qtyLabel: formatQty(qty, kind),
    costLabel: fmtPrice(finite(raw.cost_price)),
    priceLabel: fmtPrice(finite(raw.current_price)),
    marketValue: finite(raw.market_value),
    marketValueLabel: formatMarketValue(finite(raw.market_value), currency),
    plVal,
    plRatio,
    plLabel: formatPl(plVal, plRatio, currency),
    currency,
    sideLabel: positionSideLabel(raw.position_side),
  };
}

export function normalizeDeal(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const code = stringField(raw.code);
  const name = stringField(raw.name);
  const kind = positionKind({ code, name });
  const side = dealSide(raw.trd_side);
  const createTime = stringField(raw.create_time);
  const qty = finite(raw.qty);
  const price = fmtPrice(finite(raw.price));
  const multiplier = kind === 'option' ? ' · 合約乘數 100' : '';
  const dealId = stringField(raw.deal_id);
  const orderId = stringField(raw.order_id);
  const ids = [];
  if (dealId) ids.push(`成交 ${dealId}`);
  if (orderId) ids.push(`訂單 ${orderId}`);
  return {
    dealId,
    orderId,
    code,
    name,
    kind,
    kindLabel: KIND_LABEL[kind],
    symbol: underlyingSymbol(code) || '—',
    sideLabel: side.label,
    sideTone: side.tone,
    createTime,
    detailLabel: `${formatDealTime(createTime)} · ${formatQty(qty, kind)} × ${price === '—' ? '—' : `$${price}`}${multiplier}`,
    idLabel: ids.join(' · '),
  };
}

export function sortDealsNewestFirst(deals) {
  return [...deals].sort((a, b) => dealSortKey(b.createTime) - dealSortKey(a.createTime));
}

function addMoney(current, value) {
  if (value == null) return current;
  const cents = Math.round(value * 100);
  if (current == null) return cents / 100;
  return (Math.round(current * 100) + cents) / 100;
}

export function summarizeByCurrency(positions) {
  const map = new Map();
  for (const position of positions) {
    const currency = position.currency || '';
    let row = map.get(currency);
    if (!row) {
      row = { currency, marketValue: null, pl: null };
      map.set(currency, row);
    }
    row.marketValue = addMoney(row.marketValue, position.marketValue);
    row.pl = addMoney(row.pl, position.plVal);
  }
  return [...map.values()].map((row) => ({
    currency: row.currency,
    marketValue: row.marketValue,
    pl: row.pl,
    marketValueLabel: formatMarketValue(row.marketValue, row.currency),
    plLabel: fmtSignedMoney(row.pl),
  }));
}

export function kindSummary(positions) {
  const counts = { stock: 0, etf: 0, option: 0 };
  for (const position of positions) {
    if (Object.hasOwn(counts, position.kind)) counts[position.kind] += 1;
  }
  const parts = [];
  if (counts.stock) parts.push(`${counts.stock} 隻股票`);
  if (counts.etf) parts.push(`${counts.etf} 隻 ETF`);
  if (counts.option) parts.push(`${counts.option} 個期權`);
  return parts.join(' · ');
}

function moneyDiff(a, b) {
  if (a == null || b == null) return null;
  return (Math.round(a * 100) - Math.round(b * 100)) / 100;
}

/**
 * Account summary pushed by futu-sync (Futu accinfo_query, already in one currency).
 * Returns null when absent or without a usable total. The breakdown always sums to
 * the total: stocks/options = securities assets − cash (fallbacks below), funds,
 * bonds and cash come straight from Futu; anything left over is "other".
 */
export function normalizeAccount(raw, futuSyncedAt = '') {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const totalAssets = finite(raw.totalAssets);
  if (totalAssets == null) return null;
  const currency = /^[A-Z]{3}$/.test(stringField(raw.currency)) ? stringField(raw.currency) : 'USD';
  const cash = finite(raw.cash);
  const fundAssets = finite(raw.fundAssets);
  const bondAssets = finite(raw.bondAssets);
  const securitiesAssets = finite(raw.securitiesAssets);
  const marketValue = finite(raw.marketValue);
  let stocks = null;
  if (securitiesAssets != null && cash != null) stocks = moneyDiff(securitiesAssets, cash);
  else if (marketValue != null) stocks = marketValue;
  else stocks = moneyDiff(moneyDiff(moneyDiff(totalAssets, fundAssets ?? 0), bondAssets ?? 0), cash ?? 0);
  const known = [stocks, fundAssets, bondAssets, cash].reduce((sum, v) => addMoney(sum, v), null) ?? 0;
  const other = moneyDiff(totalAssets, known);
  const parts = [
    { key: 'stocks', label: '股票／期權', value: stocks },
    { key: 'funds', label: '基金', value: fundAssets },
    { key: 'bonds', label: '債券', value: bondAssets, hideZero: true },
    { key: 'cash', label: '現金', value: cash },
    { key: 'other', label: '其他（在途等）', value: other, hideZero: true },
  ].filter((part) => !(part.hideZero && (part.value == null || Math.abs(part.value) < 0.01)))
    .map((part) => ({ ...part, valueLabel: formatMarketValue(part.value, currency) }));
  const syncedAt = stringField(raw.syncedAt);
  const parsed = parseSyncedAt(syncedAt);
  const accounts = (Array.isArray(raw.accounts) ? raw.accounts : [])
    .map((a) => stringField(a?.last4).replace(/[^0-9A-Za-z]/g, '').slice(-4))
    .filter(Boolean);
  const cashByCurrency = raw.cashByCurrency && typeof raw.cashByCurrency === 'object' && !Array.isArray(raw.cashByCurrency)
    ? Object.entries(raw.cashByCurrency)
      .filter(([ccy, v]) => /^[A-Z]{3}$/.test(ccy) && finite(v) != null && Math.abs(finite(v)) >= 0.005)
      .map(([ccy, v]) => ({ currency: ccy, amount: finite(v), label: formatMarketValue(finite(v), ccy) }))
    : [];
  return {
    totalAssets,
    currency,
    totalLabel: formatMarketValue(totalAssets, currency),
    stocks,
    fundAssets,
    bondAssets,
    cash,
    other,
    parts,
    cashByCurrency,
    accountsLabel: accounts.length ? accounts.map((a) => `…${a}`).join('、') : '',
    syncedAt,
    syncedLabel: parsed ? formatHelsinkiTime(parsed.toISOString()) : '—',
    sameSync: !!syncedAt && syncedAt === stringField(futuSyncedAt),
  };
}

export function prepareFutu(data, now = new Date()) {
  const futu = futuBlock(data);
  if (!futu) return null;
  const positions = (Array.isArray(futu.positions) ? futu.positions : [])
    .map(normalizePosition)
    .filter(Boolean);
  const deals = sortDealsNewestFirst(
    (Array.isArray(futu.deals) ? futu.deals : []).map(normalizeDeal).filter(Boolean),
  );
  const syncedAt = typeof futu.syncedAt === 'string' ? futu.syncedAt.trim() : '';
  const parsed = parseSyncedAt(syncedAt);
  let staleReason = null;
  if (!parsed) staleReason = 'missing';
  else if (isOlderThan(parsed, now)) staleReason = 'age';
  return {
    syncedAt,
    syncedLabel: parsed ? formatHelsinkiTime(parsed.toISOString()) : '—',
    stale: staleReason != null,
    staleReason,
    positions,
    totals: summarizeByCurrency(positions),
    deals,
    kindSummary: kindSummary(positions),
    account: normalizeAccount(futu.account, syncedAt),
  };
}
