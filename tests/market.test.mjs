import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCache } from '../scripts/fetch-public-cache.mjs';
import { DELAY_NOTICE, matchHeadlines, newsViewState, scheduleViewState, sourceLabel } from '../site/js/market.js';

const now = new Date('2026-11-05T12:00:00Z');

test('news and schedule expose source, fetched time, and stale or error states', () => {
  const fresh = {
    ok: true,
    error: null,
    fetchedAt: '2026-11-05T11:00:00Z',
    source: { name: 'CNBC', feedUrl: 'https://www.cnbc.com/id/10000664/device/rss/rss.html' },
    items: [{ title: 'Example', link: 'https://www.cnbc.com/a', publishedAt: '2026-11-05T10:00:00Z', summary: '' }],
  };
  assert.equal(newsViewState(fresh, now).state, 'ok');
  assert.equal(sourceLabel(fresh).name, 'CNBC');
  assert.equal(newsViewState({ ...fresh, fetchedAt: '2026-11-01T00:00:00Z' }, now).state, 'stale');
  assert.equal(newsViewState({ ok: false, error: 'http_503', items: [], fetchedAt: null }, now).state, 'error');
  assert.equal(newsViewState({ ok: true, items: [], fetchedAt: fresh.fetchedAt }, now).state, 'empty');
  assert.equal(newsViewState({ ok: false, error: 'http_503', items: fresh.items, fetchedAt: '2026-11-04T00:00:00Z' }, now).state, 'stale');
  assert.match(DELAY_NOTICE, /唔係即時/);

  const schedule = {
    ok: true,
    fetchedAt: '2026-11-05T11:00:00Z',
    source: { name: 'Board of Governors of the Federal Reserve System', url: 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm' },
    meetings: [{ start: '2026-12-08', end: '2026-12-09' }],
  };
  assert.equal(scheduleViewState(schedule, now).state, 'ok');
  assert.equal(scheduleViewState(null, now).state, 'error');
});

test('headline match does not treat a short ticker as a substring', () => {
  const items = [
    { title: 'Example Industries updates guidance', summary: 'EXMP only' },
    { title: 'A story about applesauce', summary: 'no ticker' },
  ];
  assert.equal(matchHeadlines(items, { ticker: 'EXMP', name: 'Example Industries' }).length, 1);
  assert.equal(matchHeadlines(items, { ticker: 'A', name: 'Agilent' }).length, 0);
});

test('failed refresh keeps the previous public items and records the error', async () => {
  const previous = {
    news: {
      ok: true,
      fetchedAt: '2026-11-05T08:00:00.000Z',
      channelTitle: 'Example Finance',
      items: [{ title: 'Old synthetic headline', link: 'https://www.cnbc.com/old' }],
    },
    schedule: {
      ok: true,
      fetchedAt: '2026-11-05T08:00:00.000Z',
      meetings: [{ start: '2030-01-27', end: '2030-01-28', sep: false, kind: 'meeting' }],
      pageLastUpdate: 'October 28, 2026',
      pageNote: 'Note: synthetic',
    },
  };
  const cache = await buildCache({
    now: new Date('2026-11-05T12:00:00Z'),
    previous,
    fetchImpl: async () => { throw new Error('http_503'); },
  });
  assert.equal(cache.news.ok, false);
  assert.equal(cache.news.error, 'http_503');
  assert.equal(cache.news.items[0].title, 'Old synthetic headline');
  assert.equal(cache.news.fetchedAt, '2026-11-05T08:00:00.000Z');
  assert.equal(cache.schedule.ok, false);
  assert.equal(cache.schedule.meetings.length, 1);
  assert.doesNotMatch(JSON.stringify(cache), /script\.google\.com/);
});
