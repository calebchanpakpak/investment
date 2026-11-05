import assert from 'node:assert/strict';
import test from 'node:test';
import { fmtSignedMoney, fmtSignedPctFromRatio, toneClass } from '../site/js/format.js';

test('Futu HK tone uses red for up and green for down, with signs', () => {
  assert.equal(toneClass(1), 'up');
  assert.equal(toneClass(-1), 'down');
  assert.equal(toneClass(0), 'flat');
  assert.equal(fmtSignedMoney(12.5), '+12.50');
  assert.equal(fmtSignedMoney(-12.5), '−12.50');
  assert.equal(fmtSignedPctFromRatio(0.05), '+5.00%');
  assert.equal(fmtSignedPctFromRatio(-0.05), '−5.00%');
  assert.equal(fmtSignedPctFromRatio(0), '0.00%');
  assert.equal(fmtSignedMoney(null), '—');
});
