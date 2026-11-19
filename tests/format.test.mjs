import assert from 'node:assert/strict';
import test from 'node:test';
import { fmtPrice, fmtQty, fmtSignedMoney, fmtSignedPctFromRatio, fmtSignedPctPoints, toneClass } from '../site/js/format.js';

test('US tone marks gains up and losses down, with signs', () => {
  assert.equal(toneClass(1), 'up');
  assert.equal(toneClass(-1), 'down');
  assert.equal(toneClass(0), 'flat');
  assert.equal(fmtSignedMoney(12.5), '+12.50');
  assert.equal(fmtSignedMoney(-12.5), '−12.50');
  assert.equal(fmtSignedPctFromRatio(0.05), '+5.00%');
  assert.equal(fmtSignedPctFromRatio(-0.05), '−5.00%');
  assert.equal(fmtSignedPctFromRatio(0), '0.00%');
  assert.equal(fmtSignedMoney(null), '—');
  assert.equal(fmtSignedPctPoints(-12.18), '−12.18%');
  assert.equal(fmtSignedPctPoints(26.94), '+26.94%');
  assert.equal(fmtSignedPctPoints(0), '0.00%');
  assert.notEqual(fmtSignedPctPoints(-12.18), fmtSignedPctFromRatio(-12.18));
  assert.equal(fmtPrice(173.016), '173.016');
  assert.equal(fmtPrice(151.94), '151.94');
  assert.equal(fmtQty(25), '25');
  assert.equal(fmtQty(1.5), '1.5');
});
