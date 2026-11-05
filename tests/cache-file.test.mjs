import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const cache = JSON.parse(readFileSync(new URL('../site/data/market-cache.json', import.meta.url), 'utf8'));
const symbols = JSON.parse(readFileSync(new URL('../site/data/symbols.json', import.meta.url), 'utf8'));

test('committed public cache names sources and does not pretend to be real-time portfolio data', () => {
  assert.equal(cache.schema, 1);
  assert.match(cache.disclaimer, /Not real-time/);
  assert.equal(cache.news.source.feedUrl, 'https://www.cnbc.com/id/10000664/device/rss/rss.html');
  assert.equal(cache.schedule.source.url, 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm');
  assert.ok(cache.news.items.length > 0);
  assert.ok(cache.news.items.every((item) => item.link.startsWith('https://') && item.link.includes('cnbc.com')));
  assert.ok(cache.news.items.every((item) => item.title && (item.publishedAt || item.publishedRaw)));
  assert.equal(typeof cache.news.fetchedAt, 'string');
  assert.ok(cache.schedule.meetings.length >= 8);
  assert.ok(cache.schedule.meetings.every((meeting) => /^\d{4}-\d{2}-\d{2}$/.test(meeting.start)));
  assert.equal(symbols.source.url, 'https://www.sec.gov/files/company_tickers.json');
  assert.ok(symbols.count > 1000);
  const blob = JSON.stringify(cache) + JSON.stringify({ count: symbols.count, source: symbols.source });
  assert.doesNotMatch(blob, /script\.google\.com|\u7e3d\u8cc7\u7522|\u9ad8\u9a30|\u83ef\u590f\u6e2f\u5143/);
});
