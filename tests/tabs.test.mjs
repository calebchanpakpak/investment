import assert from 'node:assert/strict';
import test from 'node:test';
import { installDom } from './dom-shim.mjs';
import { renderApp } from '../site/js/render.js';
import {
  adjacentTab,
  bindTabSwipe,
  chooseInitialTab,
  gestureBlocked,
  hashForTab,
  parseRoute,
  swipeIntent,
} from '../site/js/tabs.js';

installDom();

test('hash routes, including the existing settings and futu links', () => {
  assert.equal(parseRoute('#settings').tab, 'settings');
  assert.equal(parseRoute('#portfolio').tab, 'positions');
  assert.equal(parseRoute('#futu').tab, 'positions');
  assert.equal(parseRoute('#market').tab, 'market');
  assert.equal(parseRoute('#news').tab, 'market');
  assert.equal(parseRoute('#trades').tab, 'trades');
  assert.deepEqual(parseRoute('#q=AAPL'), { tab: 'market', query: 'AAPL' });
  assert.deepEqual(parseRoute(''), { tab: null, query: null });
  assert.equal(parseRoute('#nope').tab, null);
  assert.equal(chooseInitialTab('', 'trades'), 'trades');
  assert.equal(chooseInitialTab('#settings', 'trades'), 'settings');
  assert.equal(chooseInitialTab('', 'nope'), 'overview');
  assert.equal(hashForTab('positions'), '#portfolio');
  assert.equal(hashForTab('settings'), '#settings');
});

test('swipe needs a mostly horizontal move and ignores tables', () => {
  assert.equal(swipeIntent({ dx: -80, dy: 10, blocked: false }), 'next');
  assert.equal(swipeIntent({ dx: 80, dy: 8, blocked: false }), 'prev');
  assert.equal(swipeIntent({ dx: -20, dy: 0, blocked: false }), null);
  assert.equal(swipeIntent({ dx: -40, dy: 80, blocked: false }), null);
  assert.equal(swipeIntent({ dx: -80, dy: 4, blocked: true }), null);
  assert.equal(adjacentTab('overview', 'prev'), null);
  assert.equal(adjacentTab('overview', 'next'), 'positions');
  assert.equal(adjacentTab('settings', 'next'), null);
  assert.equal(adjacentTab('market', 'next'), 'settings');

  const table = document.createElement('table');
  table.setAttribute('data-hscroll', 'true');
  const cell = document.createElement('td');
  table.append(cell);
  assert.equal(gestureBlocked(cell), true);
  assert.equal(gestureBlocked(document.createElement('p')), false);
});

test('rendered tabs keep one panel visible and the settings hash target', () => {
  const root = document.createElement('div');
  const seen = [];
  renderApp(root, baseState({ tab: 'positions' }), handlers(seen));
  assert.equal(root.querySelector('#portfolio').getAttribute('hidden'), null);
  assert.equal(root.querySelector('#settings').getAttribute('hidden'), '');
  assert.equal(root.querySelector('#market').getAttribute('hidden'), '');
  assert.equal(root.querySelector('#section-title').textContent, '持倉');
  assert.equal(root.querySelector('.tabbar a[aria-current="page"]').textContent, '持倉');
  assert.equal(root.querySelector('a[href="#settings"]').textContent.includes('設定') || root.querySelector('.tabbar a[href="#settings"]'), true);
  assert.equal(root.querySelector('.tabbar a[href="#settings"]').textContent, '設定');

  const main = root.querySelector('#panels');
  main.listeners.touchstart[0]({ touches: [{ clientX: 200, clientY: 120 }], target: main });
  main.listeners.touchend[0]({ changedTouches: [{ clientX: 40, clientY: 128 }] });
  assert.deepEqual(seen, ['next']);

  const table = document.createElement('table');
  main.append(table);
  main.listeners.touchstart[0]({ touches: [{ clientX: 200, clientY: 120 }], target: table });
  main.listeners.touchend[0]({ changedTouches: [{ clientX: 20, clientY: 120 }] });
  assert.deepEqual(seen, ['next']);
});

test('bindTabSwipe reports direction from touch events', () => {
  const el = document.createElement('div');
  const moves = [];
  bindTabSwipe(el, { onSwipe: (direction) => moves.push(direction) });
  el.listeners.touchstart[0]({ touches: [{ clientX: 20, clientY: 40 }], target: el });
  el.listeners.touchend[0]({ changedTouches: [{ clientX: 120, clientY: 48 }] });
  assert.deepEqual(moves, ['prev']);
});

function baseState(extra) {
  return {
    now: new Date('2026-11-19T12:00:00Z'),
    tab: 'overview',
    marketStatus: 'error',
    market: null,
    symbolsStatus: 'error',
    symbols: null,
    connection: null,
    portfolioStatus: 'unconfigured',
    portfolio: null,
    portfolioFetchedAt: null,
    portfolioError: null,
    query: '',
    results: [],
    selected: null,
    endpointDraft: '',
    tokenDraft: '',
    settingsMessage: '',
    ...extra,
  };
}

function handlers(seen) {
  return {
    reload() {},
    search() {},
    select() {},
    save() {},
    clear() {},
    swipe(direction) { seen.push(direction); },
  };
}
