import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parseFomcCalendar } from '../scripts/lib/fomc.mjs';

const html = readFileSync(new URL('./fixtures/fomc.html', import.meta.url), 'utf8');

test('FOMC parser reads announced dates, cross-month ranges, and notation votes', () => {
  const parsed = parseFomcCalendar(html);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.pageLastUpdate, 'October 28, 2026');
  assert.match(parsed.pageNote, /January 25-26, 2031/);
  assert.deepEqual(parsed.meetings.map((meeting) => [meeting.start, meeting.end, meeting.sep, meeting.kind]), [
    ['2030-01-27', '2030-01-28', false, 'meeting'],
    ['2030-04-30', '2030-05-01', true, 'meeting'],
    ['2030-08-22', '2030-08-22', false, 'notation'],
  ]);
});

test('unrecognized calendar HTML fails closed', () => {
  const parsed = parseFomcCalendar('<html><p>no meetings here</p></html>');
  assert.equal(parsed.ok, false);
  assert.equal(parsed.meetings.length, 0);
});
