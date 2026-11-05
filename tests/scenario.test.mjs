import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { DISCLAIMER, buildConsiderations } from '../site/js/scenario.js';

const portfolio = JSON.parse(readFileSync(new URL('./fixtures/portfolio.json', import.meta.url), 'utf8'));
const schedule = {
  ok: true,
  fetchedAt: '2026-11-05T08:00:00Z',
  meetings: [
    { start: '2026-10-27', end: '2026-10-28', sep: false, kind: 'meeting' },
    { start: '2026-12-08', end: '2026-12-09', sep: true, kind: 'meeting' },
  ],
};

test('checklist is rules-based, conditional, and does not invent earnings', () => {
  const far = buildConsiderations({
    now: new Date('2026-11-05T15:00:00Z'),
    portfolio,
    portfolioLoaded: true,
    symbol: { ticker: 'EXMP', cik: '0000000001', name: 'Example Industries' },
    schedule,
    newsState: { state: 'ok' },
  });
  assert.equal(far.ai, false);
  assert.equal(far.title, '一般規則考慮');
  assert.match(DISCLAIMER, /唔係人工智能研究/);
  assert.ok(far.items.some((item) => item.id === 'disclaimer'));
  assert.ok(far.items.some((item) => item.id === 'held'));
  assert.ok(far.items.some((item) => item.id === 'concentration' && /EXMP/.test(item.text) && /唔係買賣建議/.test(item.text)));
  assert.ok(far.items.some((item) => item.id === 'fomc-next' && /2026-12-08/.test(item.text) && /唔係利率預測/.test(item.text)));
  assert.ok(far.items.some((item) => item.id === 'no-earnings-calendar' && /唔會填一個估計日期/.test(item.text)));
  assert.equal(JSON.stringify(far).includes('目標價'), false);

  const soon = buildConsiderations({
    now: new Date('2026-12-01T15:00:00Z'),
    portfolioLoaded: false,
    schedule,
    newsState: { state: 'stale' },
  });
  assert.ok(soon.items.some((item) => item.id === 'no-portfolio'));
  assert.ok(soon.items.some((item) => item.id === 'fomc-soon'));
  assert.ok(soon.items.some((item) => item.id === 'news-stale'));
  assert.equal(soon.items.some((item) => item.id === 'concentration'), false);
});
