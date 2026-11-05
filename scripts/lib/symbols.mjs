/**
 * Compact the SEC EDGAR company_tickers.json file.
 * Documented public dataset:
 * https://www.sec.gov/files/company_tickers.json
 * https://www.sec.gov/search-filings/edgar-search-assistance/accessing-edgar-data
 * The SEC does not guarantee accuracy or scope. Fund tickers often live in
 * company_tickers_mf.json and will be missing here.
 */

export function padCik(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (!digits) return null;
  return digits.padStart(10, '0').slice(-10);
}

export function compactSecTickers(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, error: 'tickers_unrecognized', rows: [] };
  }
  const rows = [];
  const seen = new Set();
  for (const entry of Object.values(payload)) {
    if (!entry || typeof entry !== 'object') continue;
    const ticker = String(entry.ticker || '').trim().toUpperCase();
    const title = String(entry.title || '').replace(/\s+/g, ' ').trim();
    const cik = padCik(entry.cik_str);
    if (!/^[A-Z0-9._-]{1,16}$/.test(ticker) || !title || !cik) continue;
    const key = `${ticker}|${cik}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push([ticker, cik, title]);
  }
  rows.sort((a, b) => a[0].localeCompare(b[0]) || a[2].localeCompare(b[2]));
  if (!rows.length) return { ok: false, error: 'tickers_empty', rows: [] };
  return { ok: true, error: null, rows };
}
