import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { formatHelsinkiTime, helsinkiZoneAbbreviation, toneClass, fmtSignedPctFromRatio } from '../site/js/format.js';
import { formatDay } from '../scripts/lib/portfolio-read.mjs';

const siteDir = path.resolve(new URL('../site', import.meta.url).pathname);

function sourceFiles(dir, found = []) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) sourceFiles(full, found);
    else if (/\.(js|html|css|mjs)$/.test(name)) found.push(full);
  }
  return found;
}

test('user-facing instants use Europe/Helsinki with EET or EEST', () => {
  const winter = '2026-11-05T20:35:41Z';
  assert.equal(formatHelsinkiTime(winter), '2026-11-05 22:35 EET（赫爾辛基）');
  assert.equal(helsinkiZoneAbbreviation(new Date(winter)), 'EET');
  assert.equal(formatDay(new Date(winter), 'Europe/Helsinki'), '2026-11-05');
  assert.equal(formatDay(new Date(winter), 'Asia/Hong_Kong'), '2026-11-06');

  const summer = '2026-07-01T12:00:00Z';
  assert.equal(formatHelsinkiTime(summer), '2026-07-01 15:00 EEST（赫爾辛基）');
  assert.equal(helsinkiZoneAbbreviation(new Date('2026-03-29T00:30:00Z')), 'EET');
  assert.equal(helsinkiZoneAbbreviation(new Date('2026-03-29T01:30:00Z')), 'EEST');
  assert.equal(formatHelsinkiTime('2026-10-25T00:30:00Z'), '2026-10-25 03:30 EEST（赫爾辛基）');
  assert.equal(formatHelsinkiTime('2026-10-25T01:30:00Z'), '2026-10-25 03:30 EET（赫爾辛基）');
  assert.equal(formatHelsinkiTime('2026-01-15T22:30:00Z'), '2026-01-16 00:30 EET（赫爾辛基）');
  assert.equal(formatHelsinkiTime(''), '—');
  assert.equal(formatHelsinkiTime('not-a-date'), '—');
});

test('zh-HK copy does not relabel the clock as Hong Kong', () => {
  const blob = sourceFiles(siteDir).map((file) => readFileSync(file, 'utf8')).join('\n');
  assert.doesNotMatch(blob, /Asia\/Hong_Kong/);
  assert.doesNotMatch(blob, /香港時間/);
  assert.match(blob, /Europe\/Helsinki/);
});

test('a positive return ratio is red-up and a negative ratio is green-down', () => {
  assert.equal(fmtSignedPctFromRatio(0.05), '+5.00%');
  assert.equal(toneClass(0.05), 'up');
  assert.equal(fmtSignedPctFromRatio(-0.015), '−1.50%');
  assert.equal(toneClass(-0.015), 'down');
  assert.equal(fmtSignedPctFromRatio(0), '0.00%');
  assert.equal(toneClass(0), 'flat');
});
