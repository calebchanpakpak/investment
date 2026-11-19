import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { installDom } from './dom-shim.mjs';
import { renderApp } from '../site/js/render.js';
import { assessFutuSync, lastScheduledRun, syncMessage } from '../site/js/sync-health.js';

installDom();

const sheet = JSON.parse(readFileSync(new URL('./fixtures/portfolio.json', import.meta.url), 'utf8'));
const futu = JSON.parse(readFileSync(new URL('./fixtures/futu.json', import.meta.url), 'utf8'));

function at(iso, syncedAt = futu.syncedAt) {
  return assessFutuSync({ futu: { ...futu, syncedAt } }, new Date(iso));
}

test('scheduled instants follow Europe/Helsinki including DST', () => {
  assert.equal(lastScheduledRun(new Date('2026-03-30T13:40:00Z')).toISOString(), '2026-03-30T13:00:00.000Z');
  assert.equal(lastScheduledRun(new Date('2026-10-23T20:30:00Z')).toISOString(), '2026-10-23T20:15:00.000Z');
  assert.equal(lastScheduledRun(new Date('2026-10-26T14:40:00Z')).toISOString(), '2026-10-26T14:00:00.000Z');
  assert.equal(lastScheduledRun(new Date('2026-11-21T10:00:00Z')).toISOString(), '2026-11-20T21:15:00.000Z');
});

test('weekday grace, weekend gap, and DST boundaries', () => {
  const thursdayNoon = at('2026-11-19T10:00:00Z');
  assert.equal(thursdayNoon.level, 'ok');

  const duringGrace = at('2026-11-19T14:29:00Z', '2026-11-19T08:00:00Z');
  assert.equal(duringGrace.level, 'ok');

  const atGraceBoundary = at('2026-11-19T14:30:00Z', '2026-11-19T08:00:00Z');
  assert.equal(atGraceBoundary.level, 'ok');

  const afterGrace = at('2026-11-19T14:31:00Z', '2026-11-19T08:00:00Z');
  assert.equal(afterGrace.level, 'missed');

  const fiveMinutesEarly = at('2026-11-19T14:40:00Z', '2026-11-19T13:55:00Z');
  assert.equal(fiveMinutesEarly.level, 'ok');

  const tooEarly = at('2026-11-19T14:40:00Z', '2026-11-19T13:54:59Z');
  assert.equal(tooEarly.level, 'missed');

  const fridaySync = '2026-11-20T21:20:00Z';
  const saturday = at('2026-11-21T10:00:00Z', fridaySync);
  assert.equal(saturday.level, 'ok');
  assert.equal(saturday.scheduled.toISOString(), '2026-11-20T21:15:00.000Z');
  const sunday = at('2026-11-22T10:00:00Z', fridaySync);
  assert.equal(sunday.level, 'stale');
  assert.equal(sunday.scheduled.toISOString(), '2026-11-20T21:15:00.000Z');
  const mondayMorning = at('2026-11-23T12:00:00Z', '2026-11-23T06:00:00Z');
  assert.equal(mondayMorning.level, 'ok');
  assert.equal(mondayMorning.scheduled.toISOString(), '2026-11-20T21:15:00.000Z');

  const missedMonday = at('2026-11-23T14:40:00Z', '2026-11-23T07:00:00Z');
  assert.equal(missedMonday.level, 'missed');

  const summer = at('2026-03-30T13:40:00Z', '2026-03-30T12:50:00Z');
  assert.equal(summer.level, 'missed');
  assert.equal(at('2026-03-30T13:40:00Z', '2026-03-30T12:55:00Z').level, 'ok');

  const winterWeekend = at('2026-10-24T10:00:00Z', '2026-10-23T20:20:00Z');
  assert.equal(winterWeekend.level, 'ok');
  assert.equal(at('2026-10-26T12:00:00Z', '2026-10-23T20:20:00Z').level, 'stale');
});

test('a sync older than 24h is the only warning, and a missing futu block is neutral', () => {
  const stale = at('2026-11-20T01:13:22Z');
  assert.equal(stale.level, 'stale');
  assert.match(syncMessage(stale), /超過 24 小時/);
  assert.doesNotMatch(syncMessage(stale), /上次自動同步（/);

  const absent = assessFutuSync(sheet, new Date('2026-11-19T12:00:00Z'));
  assert.equal(absent.level, 'absent');
  assert.match(syncMessage(absent), /富途未同步過/);
  assert.equal(assessFutuSync({ futu: null }, new Date()).level, 'absent');

  const missing = assessFutuSync({ futu: { positions: [], deals: [] } }, new Date('2026-11-19T18:00:00Z'));
  assert.equal(missing.level, 'missing');
  assert.match(syncMessage(missing), /未能確認實盤同步時間/);
});

test('the overview banner and header badge share one missed-sync message', () => {
  const root = document.createElement('div');
  renderApp(root, {
    now: new Date('2026-11-19T16:40:00+02:00'),
    tab: 'overview',
    marketStatus: 'error',
    market: null,
    symbolsStatus: 'error',
    symbols: null,
    connection: { endpointHost: 'script.google.com' },
    portfolioStatus: 'ready',
    portfolio: { ...sheet, futu },
    portfolioFetchedAt: '2026-11-19T14:40:00Z',
    portfolioError: null,
    refreshPhase: 'fresh',
    query: '',
    results: [],
    selected: null,
    endpointDraft: '',
    tokenDraft: '',
    settingsMessage: '',
  }, { reload() {}, search() {}, select() {}, save() {}, clear() {} });
  const banners = [...root.querySelectorAll('[data-sync-health="missed"]')];
  assert.ok(banners.length >= 1);
  assert.equal(root.querySelector('[data-futu-stale]'), null);
  assert.match(banners[0].textContent, /⚠️ 上次自動同步（2026-11-19 16:00 EET（赫爾辛基））未成功/);
  assert.match(banners[0].textContent, /Futu OpenD 有冇開同登入/);
  assert.match(banners[0].textContent, /最後成功同步：2026-11-19 03:13 EET（赫爾辛基）/);
  assert.equal(new Set(banners.map((node) => node.textContent)).size, 1);
  assert.equal(root.querySelector('[data-sync-badge]').textContent, '同步未成功');
  const hidden = root.querySelector('#overview').getAttribute('hidden');
  assert.equal(hidden, null);
});
