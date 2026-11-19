import { fmtMoney, formatHelsinkiTime } from './format.js';

/** Public, keyless USD rates. The request is only the currency pair. */
export const ER_API_URL = 'https://open.er-api.com/v6/latest/USD';
export const FRANKFURTER_URL = 'https://api.frankfurter.app/latest?from=USD&to=HKD';
export const FX_STALE_MS = 24 * 60 * 60 * 1000;
export const FX_LOCAL_KEY = 'investment-v2-usd-hkd';

export function convertUsdToHkd(usd, rate) {
  const amount = Number(usd);
  const fx = Number(rate);
  if (!Number.isFinite(amount) || !Number.isFinite(fx) || !(fx > 0)) return null;
  return Math.round((amount * fx + Number.EPSILON) * 100) / 100;
}

export function formatFxRate(rate) {
  const n = Number(rate);
  if (!Number.isFinite(n) || !(n > 0)) return '—';
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}

export function formatHkdApprox(hkd) {
  const money = fmtMoney(hkd);
  if (money === '—') return null;
  return `≈ HK$ ${money}`;
}

export function formatRateLine(quote, { stale = false } = {}) {
  if (!quote || !(Number(quote.rate) > 0)) return '';
  const rateText = formatFxRate(quote.rate);
  const when = quote.dateOnly && quote.asOfDate ? quote.asOfDate : formatHelsinkiTime(quote.asOf);
  const suffix = stale ? ' · 快取（已超過 24 小時）' : '';
  return `1 USD = ${rateText} HKD · 更新於 ${when}${suffix}`;
}

export function rateStatus(quote, now = new Date()) {
  if (!quote || !(Number(quote.rate) > 0) || !quote.asOf) return 'missing';
  const at = Date.parse(quote.asOf);
  if (!Number.isFinite(at)) return 'missing';
  const current = now instanceof Date ? now.getTime() : Date.parse(now);
  if (!Number.isFinite(current)) return 'missing';
  if (current - at > FX_STALE_MS) return 'stale';
  return 'fresh';
}

function quoteFrom(rate, asOf, extra) {
  if (!Number.isFinite(rate) || !(rate > 0) || !asOf || Number.isNaN(Date.parse(asOf))) return null;
  return { pair: 'USD/HKD', rate, asOf: new Date(asOf).toISOString(), ...extra };
}

export function parseErApi(json) {
  if (!json || json.result !== 'success') return null;
  if (json.base_code && json.base_code !== 'USD') return null;
  const rate = Number(json.rates?.HKD);
  let asOf = null;
  if (Number.isFinite(Number(json.time_last_update_unix)) && Number(json.time_last_update_unix) > 0) {
    asOf = new Date(Number(json.time_last_update_unix) * 1000).toISOString();
  } else if (json.time_last_update_utc) {
    const parsed = new Date(json.time_last_update_utc);
    if (!Number.isNaN(parsed.getTime())) asOf = parsed.toISOString();
  }
  return quoteFrom(rate, asOf, { source: 'ExchangeRate-API', sourceUrl: ER_API_URL });
}

export function parseFrankfurter(json) {
  if (!json || (json.base && json.base !== 'USD')) return null;
  const rate = Number(json.rates?.HKD);
  if (typeof json.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(json.date)) return null;
  return quoteFrom(rate, `${json.date}T00:00:00.000Z`, {
    source: 'Frankfurter',
    sourceUrl: FRANKFURTER_URL,
    dateOnly: true,
    asOfDate: json.date,
  });
}

export function parseMarketFx(fx) {
  if (!fx || typeof fx !== 'object') return null;
  const rate = Number(fx.rate);
  const asOf = fx.asOf;
  const source = typeof fx.source === 'string' ? fx.source : (fx.source?.name || 'market-cache');
  return quoteFrom(rate, asOf, {
    source,
    sourceUrl: fx.sourceUrl || fx.source?.url || null,
    dateOnly: Boolean(fx.dateOnly),
    asOfDate: fx.asOfDate || null,
  });
}

export function fresherQuote(a, b) {
  if (!a || !(Number(a.rate) > 0)) return b || null;
  if (!b || !(Number(b.rate) > 0)) return a;
  const aAt = Date.parse(a.asOf);
  const bAt = Date.parse(b.asOf);
  if (!Number.isFinite(aAt)) return b;
  if (!Number.isFinite(bAt)) return a;
  return aAt >= bAt ? a : b;
}

export function readFxCache(storage = globalThis.localStorage) {
  if (!storage) return null;
  try {
    const raw = storage.getItem(FX_LOCAL_KEY);
    if (!raw) return null;
    const json = JSON.parse(raw);
    return quoteFrom(Number(json?.rate), json?.asOf, {
      source: json?.source || '',
      sourceUrl: json?.sourceUrl || null,
      dateOnly: Boolean(json?.dateOnly),
      asOfDate: json?.asOfDate || null,
    });
  } catch {
    return null;
  }
}

export function writeFxCache(quote, storage = globalThis.localStorage) {
  if (!storage || !quote || !(Number(quote.rate) > 0)) return;
  storage.setItem(FX_LOCAL_KEY, JSON.stringify({
    rate: quote.rate,
    asOf: quote.asOf,
    source: quote.source || '',
    sourceUrl: quote.sourceUrl || null,
    dateOnly: Boolean(quote.dateOnly),
    asOfDate: quote.asOfDate || null,
  }));
}

export async function fetchUsdHkd(fetchImpl = globalThis.fetch) {
  const attempts = [
    [ER_API_URL, parseErApi],
    [FRANKFURTER_URL, parseFrankfurter],
  ];
  let lastError = null;
  for (const [url, parse] of attempts) {
    try {
      const response = await fetchImpl(url, { method: 'GET', cache: 'no-store', signal: AbortSignal.timeout(8000) });
      if (!response?.ok) throw new Error(`http_${response?.status || 0}`);
      const parsed = parse(await response.json());
      if (!parsed) throw new Error('fx_unrecognized');
      return parsed;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('fx_failed');
}
