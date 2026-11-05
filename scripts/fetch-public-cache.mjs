/**
 * Refresh the PUBLIC market cache only.
 * This process must never receive portfolio endpoints, sheet IDs, or API keys.
 *
 * Sources:
 * - CNBC RSS (headlines + links): https://www.cnbc.com/id/10000664/device/rss/rss.html
 * - Fed FOMC calendar: https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm
 * - SEC company tickers: https://www.sec.gov/files/company_tickers.json
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCnbcRss } from './lib/rss.mjs';
import { parseFomcCalendar } from './lib/fomc.mjs';
import { compactSecTickers } from './lib/symbols.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.join(root, 'site', 'data');
const cachePath = path.join(dataDir, 'market-cache.json');
const symbolsPath = path.join(dataDir, 'symbols.json');

export const NEWS_URL = 'https://www.cnbc.com/id/10000664/device/rss/rss.html';
export const FED_URL = 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm';
export const SEC_TICKERS_URL = 'https://www.sec.gov/files/company_tickers.json';
export const SEC_DOCS_URL = 'https://www.sec.gov/search-filings/edgar-search-assistance/accessing-edgar-data';

const USER_AGENT = process.env.SEC_CONTACT_USER_AGENT
  || 'investment-public-cache public-cache@example.com';

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

async function fetchText(url, { accept = '*/*' } = {}) {
  const response = await fetch(url, {
    redirect: 'follow',
    headers: {
      'User-Agent': USER_AGENT,
      Accept: accept,
    },
    signal: AbortSignal.timeout(25000),
  });
  if (!response.ok) {
    throw new Error(`http_${response.status}`);
  }
  return response.text();
}

function retainedNews(previous, attemptedAt, error) {
  const prior = previous?.news;
  return {
    ok: false,
    error,
    refreshAttemptedAt: attemptedAt,
    source: newsSource(),
    fetchedAt: prior?.fetchedAt || null,
    channelTitle: prior?.channelTitle || null,
    channelLink: prior?.channelLink || null,
    channelLastBuild: prior?.channelLastBuild || null,
    items: Array.isArray(prior?.items) ? prior.items : [],
  };
}

function newsSource() {
  return {
    name: 'CNBC',
    feedUrl: NEWS_URL,
    homeUrl: 'https://www.cnbc.com/finance/',
    rights: 'Headline, link, published time, and a short description only. Full articles stay on CNBC. The feed TTL is 60 minutes; this file is a delayed cache, not a live feed.',
  };
}

function scheduleSource() {
  return {
    name: 'Board of Governors of the Federal Reserve System',
    url: FED_URL,
    note: 'Announced dates parsed from the official FOMC calendar. Not a rate forecast. Future dates remain tentative until the Fed confirms them.',
  };
}

export async function buildCache({ now = new Date(), fetchImpl = fetchText, previous = null } = {}) {
  const attemptedAt = now.toISOString();
  let news;
  try {
    const xml = await fetchImpl(NEWS_URL, { accept: 'application/rss+xml, application/xml, text/xml' });
    const parsed = parseCnbcRss(xml);
    if (!parsed.ok) throw new Error(parsed.error || 'rss_not_xml');
    news = {
      ok: true,
      error: null,
      refreshAttemptedAt: attemptedAt,
      source: newsSource(),
      fetchedAt: attemptedAt,
      channelTitle: parsed.channelTitle,
      channelLink: parsed.channelLink,
      channelLastBuild: parsed.channelLastBuild,
      items: parsed.items,
    };
  } catch (error) {
    news = retainedNews(previous, attemptedAt, error.message || 'news_fetch_failed');
  }

  let schedule;
  try {
    const html = await fetchImpl(FED_URL, { accept: 'text/html' });
    const parsed = parseFomcCalendar(html);
    if (!parsed.ok) throw new Error(parsed.error || 'fomc_page_unrecognized');
    schedule = {
      ok: true,
      error: null,
      refreshAttemptedAt: attemptedAt,
      source: scheduleSource(),
      fetchedAt: attemptedAt,
      pageLastUpdate: parsed.pageLastUpdate,
      pageNote: parsed.pageNote,
      meetings: parsed.meetings,
    };
  } catch (error) {
    const prior = previous?.schedule;
    schedule = {
      ok: false,
      error: error.message || 'schedule_fetch_failed',
      refreshAttemptedAt: attemptedAt,
      source: scheduleSource(),
      fetchedAt: prior?.fetchedAt || null,
      pageLastUpdate: prior?.pageLastUpdate || null,
      pageNote: prior?.pageNote || null,
      meetings: Array.isArray(prior?.meetings) ? prior.meetings : [],
    };
  }

  return {
    schema: 1,
    generatedAt: attemptedAt,
    disclaimer: 'Delayed public cache. Not real-time quotes, not a forecast, and not portfolio data.',
    news,
    schedule,
  };
}

export async function buildSymbols({ now = new Date(), fetchImpl = fetchText, previous = null } = {}) {
  const attemptedAt = now.toISOString();
  const source = {
    name: 'SEC EDGAR company_tickers.json',
    url: SEC_TICKERS_URL,
    docs: SEC_DOCS_URL,
    note: 'Public ticker, CIK, and conformed name associations. The SEC does not guarantee accuracy or scope. Many fund tickers are absent.',
  };
  try {
    const text = await fetchImpl(SEC_TICKERS_URL, { accept: 'application/json' });
    const parsed = compactSecTickers(JSON.parse(text));
    if (!parsed.ok) throw new Error(parsed.error || 'tickers_unrecognized');
    return {
      schema: 1,
      ok: true,
      error: null,
      refreshAttemptedAt: attemptedAt,
      fetchedAt: attemptedAt,
      source,
      count: parsed.rows.length,
      rows: parsed.rows,
    };
  } catch (error) {
    return {
      schema: 1,
      ok: false,
      error: error.message || 'tickers_fetch_failed',
      refreshAttemptedAt: attemptedAt,
      fetchedAt: previous?.fetchedAt || null,
      source,
      count: Array.isArray(previous?.rows) ? previous.rows.length : 0,
      rows: Array.isArray(previous?.rows) ? previous.rows : [],
    };
  }
}

async function main() {
  await mkdir(dataDir, { recursive: true });
  const previousCache = await readJson(cachePath);
  const previousSymbols = await readJson(symbolsPath);
  const cache = await buildCache({ previous: previousCache });
  const symbols = await buildSymbols({ previous: previousSymbols });
  await writeFile(cachePath, `${JSON.stringify(cache, null, 2)}\n`);
  await writeFile(symbolsPath, `${JSON.stringify(symbols)}\n`);
  console.log(JSON.stringify({
    newsOk: cache.news.ok,
    newsError: cache.news.error,
    newsItems: cache.news.items.length,
    newsTitle: cache.news.channelTitle,
    scheduleOk: cache.schedule.ok,
    scheduleError: cache.schedule.error,
    meetings: cache.schedule.meetings.length,
    pageLastUpdate: cache.schedule.pageLastUpdate,
    symbolsOk: symbols.ok,
    symbolsError: symbols.error,
    symbols: symbols.count,
  }, null, 2));
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
