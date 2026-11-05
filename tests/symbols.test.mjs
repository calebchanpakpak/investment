import assert from 'node:assert/strict';
import test from 'node:test';
import { compactSecTickers, padCik } from '../scripts/lib/symbols.mjs';
import { companyLinks, searchSymbols } from '../site/js/search.js';

test('SEC ticker file compacts to ticker, zero-padded CIK, and name', () => {
  const parsed = compactSecTickers({
    0: { cik_str: 320193, ticker: 'aapl', title: 'Apple Inc.' },
    1: { cik_str: 320193, ticker: 'AAPL', title: 'Apple Inc.' },
    2: { cik_str: 'not-a-cik', ticker: 'BAD', title: 'Nope' },
  });
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.rows, [['AAPL', '0000320193', 'Apple Inc.']]);
  assert.equal(padCik(789019), '0000789019');
});

test('search prefers ticker prefix and company links stay on documented public sites', () => {
  const rows = [
    ['A', '0000000001', 'Agilent Example'],
    ['AAPL', '0000320193', 'Apple Inc.'],
    ['AAPLW', '0000320193', 'Apple Warrant Example'],
    ['MSFT', '0000789019', 'Microsoft Corp'],
  ];
  const found = searchSymbols(rows, 'aa');
  assert.deepEqual(found.map((row) => row[0]), ['AAPL', 'AAPLW']);
  const links = companyLinks(found[0]);
  assert.ok(links.every((link) => link.url.startsWith('https://')));
  assert.ok(links.some((link) => link.url.includes('sec.gov') && link.url.includes('0000320193')));
  assert.ok(links.some((link) => link.kind === 'search-link' && /搜尋連結/.test(link.label)));
});
