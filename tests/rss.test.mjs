import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parseCnbcRss } from '../scripts/lib/rss.mjs';

const xml = readFileSync(new URL('./fixtures/rss.xml', import.meta.url), 'utf8');

test('RSS keeps CNBC headlines and drops other hosts', () => {
  const parsed = parseCnbcRss(xml);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.channelTitle, 'Example Finance');
  assert.equal(parsed.items.length, 1);
  assert.equal(parsed.items[0].title, 'Example Industries rises in a synthetic market brief');
  assert.equal(parsed.items[0].link, 'https://www.cnbc.com/2026/11/05/example-industries.html');
  assert.equal(parsed.items[0].publishedAt, '2026-11-05T11:30:00.000Z');
  assert.match(parsed.items[0].summary, /EXMP/);
  assert.equal(parsed.channelLastBuild, '2026-11-05T12:00:00.000Z');
});

test('non-RSS input is an error with no items', () => {
  const parsed = parseCnbcRss('<html>not a feed</html>');
  assert.equal(parsed.ok, false);
  assert.equal(parsed.error, 'rss_not_xml');
  assert.deepEqual(parsed.items, []);
});
