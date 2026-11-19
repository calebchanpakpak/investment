import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BACKOFF_BASE_MS,
  BACKOFF_MAX_MS,
  INTERVAL_MS,
  LOCK_NAME,
  PULL_GAP_MS,
  REQUEST_TIMEOUT_MS,
  SNAPSHOT_DB,
  classifyRefreshFailure,
  createMemoryStorage,
  createRefresh,
  fetchWithTimeout,
  manualToast,
  nextBackoff,
  pillModel,
  planBoot,
  shouldSkipPull,
  withRefreshLock,
} from '../site/js/refresh.js';

function fakeTimers() {
  let clock = 0;
  const timeouts = [];
  const intervals = [];
  return {
    now: () => clock,
    advance(ms) { clock += ms; },
    set clock(value) { clock = value; },
    get clock() { return clock; },
    timeouts,
    intervals,
    setTimeout(fn, ms) {
      const item = { fn, at: clock + ms, cleared: false };
      timeouts.push(item);
      return item;
    },
    clearTimeout(item) { if (item) item.cleared = true; },
    setInterval(fn, ms) {
      const item = { fn, ms, cleared: false };
      intervals.push(item);
      return item;
    },
    clearInterval(item) { if (item) item.cleared = true; },
    fireDue() {
      const due = timeouts.filter((item) => !item.cleared && item.at <= clock);
      for (const item of due) {
        item.cleared = true;
        item.fn();
      }
    },
  };
}

function mutex() {
  let tail = Promise.resolve();
  return {
    request(_name, fn) {
      const run = tail.then(() => fn());
      tail = run.then(() => {}, () => {});
      return run;
    },
  };
}

test('names stay distinct from the connection DB, Vault, and Calendar', () => {
  assert.equal(SNAPSHOT_DB, 'investment-v2-snapshot');
  assert.equal(LOCK_NAME, 'investment-v2-refresh');
  assert.equal(REQUEST_TIMEOUT_MS, 30_000);
  assert.equal(PULL_GAP_MS, 15_000);
  assert.equal(INTERVAL_MS, 5 * 60_000);
  assert.ok(INTERVAL_MS >= 5 * 60_000 && INTERVAL_MS <= 10 * 60_000);
  for (const name of [SNAPSHOT_DB, LOCK_NAME]) {
    assert.equal(name.includes('vault'), false);
    assert.equal(name.includes('calendar'), false);
    assert.notEqual(name, 'investment-tracker-v2');
  }
});

test('backoff doubles from 5s to 5min and a recent pull is skipped unless manual', () => {
  assert.equal(nextBackoff(1), 5_000);
  assert.equal(nextBackoff(2), 10_000);
  assert.equal(nextBackoff(3), 20_000);
  assert.equal(nextBackoff(7), BACKOFF_MAX_MS);
  assert.equal(BACKOFF_BASE_MS, 5_000);
  assert.equal(shouldSkipPull({ now: 20_000, lastOkAt: 10_000, manual: false }), true);
  assert.equal(shouldSkipPull({ now: 25_000, lastOkAt: 10_000, manual: false }), false);
  assert.equal(shouldSkipPull({ now: 12_000, lastOkAt: 10_000, manual: true }), false);
});

test('single-flight shares one request, including across a lock', async () => {
  let calls = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const storage = createMemoryStorage();
  const engine = createRefresh({
    storage,
    locks: mutex(),
    now: () => 1_000_000,
    timers: fakeTimers(),
    call: async () => {
      calls += 1;
      await gate;
      return { overview: { totalUsd: 1 } };
    },
  });
  const first = engine.pull({ trigger: 'open' });
  const second = engine.pull({ manual: true, trigger: 'manual' });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(calls, 1);
  release();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.equal(calls, 1);
  const saved = await storage.loadSnapshot();
  assert.equal(saved.data.overview.totalUsd, 1);
});

test('a second engine waits on the lock and skips when the first pull is still fresh', async () => {
  const storage = createMemoryStorage();
  const locks = mutex();
  const timers = fakeTimers();
  let calls = 0;
  const call = async () => {
    calls += 1;
    return { overview: { totalUsd: calls } };
  };
  const first = createRefresh({ storage, locks, now: () => 100_000, timers, call });
  await first.pull({ manual: true });
  assert.equal(calls, 1);
  const second = createRefresh({ storage, locks, now: () => 105_000, timers, call });
  const skipped = await second.pull({ trigger: 'visible' });
  assert.equal(skipped.skipped, 'recent');
  assert.equal(calls, 1);
  const manual = await second.pull({ manual: true });
  assert.equal(manual.ok, true);
  assert.equal(calls, 2);
});

test('failures back off, online resets, and hidden pauses the interval', async () => {
  const timers = fakeTimers();
  const storage = createMemoryStorage();
  let online = true;
  let visible = true;
  let calls = 0;
  const engine = createRefresh({
    storage,
    now: () => timers.clock,
    timers,
    isOnline: () => online,
    isVisible: () => visible,
    intervalMs: 1_000,
    call: async () => {
      calls += 1;
      throw Object.assign(new Error('network'), { code: 'network' });
    },
  });
  const first = await engine.pull({ trigger: 'open' });
  assert.equal(first.kind, 'network');
  assert.equal(first.nextAttemptAt, 5_000);
  const held = await engine.pull({ trigger: 'timer' });
  assert.equal(held.skipped, 'backoff');
  assert.equal(calls, 1);
  timers.advance(5_000);
  online = false;
  const second = await engine.pull({ trigger: 'retry' });
  assert.equal(second.kind, 'offline');
  assert.equal((await storage.loadMeta()).nextAttemptAt, 5_000 + 10_000);

  timers.advance(1);
  online = true;
  const afterOnline = await engine.onOnline();
  assert.equal(afterOnline.kind, 'network');
  assert.equal(calls, 3);

  visible = false;
  engine.onVisibility();
  assert.equal(timers.intervals.filter((item) => !item.cleared).length, 0);
  const hidden = await engine.pull({ trigger: 'timer' });
  assert.equal(hidden.skipped, 'hidden');
  visible = true;
  engine.start();
  assert.equal(timers.intervals.filter((item) => !item.cleared).length, 1);
});

test('cached-first plan never treats a snapshot as a connected portfolio', () => {
  const snapshot = { data: { overview: { totalUsd: 12 } }, fetchedAt: '2026-11-19T01:00:00Z' };
  assert.equal(planBoot({ connection: null, snapshot }).mode, 'unconfigured');
  assert.equal(planBoot({ connection: { endpoint: 'http://127.0.0.1/exec', token: 't' }, snapshot }).mode, 'cached');
  assert.equal(planBoot({ connection: { endpoint: 'http://127.0.0.1/exec', token: 't' }, snapshot: null }).mode, 'loading');
});

test('status pill and manual toast copy', () => {
  const fresh = pillModel({ phase: 'fresh', fetchedAt: '2026-11-19T01:16:00Z' });
  assert.equal(fresh.text, '已更新 03:16');
  assert.match(fresh.title, /上次更新：2026-11-19 03:16 EET（赫爾辛基）/);
  assert.equal(pillModel({ phase: 'loading' }).text, '更新中…');
  assert.equal(pillModel({ phase: 'fresh', fetchedAt: '2026-11-19T01:16:00Z', online: false }).text, '離線，顯示上次資料');
  assert.equal(pillModel({ phase: 'network', errorCode: 'network' }).text, '網絡錯誤，顯示上次資料');
  assert.match(pillModel({ phase: 'network', errorCode: 'network' }).title, /錯誤：網絡連線失敗/);
  const auth = pillModel({ phase: 'auth', errorCode: 'unauthorized' });
  assert.equal(auth.text, '權杖被拒');
  assert.equal(auth.action, 'settings');
  assert.equal(pillModel({ phase: 'server', errorCode: 'read_failed' }).text, '伺服器錯誤');
  assert.equal(manualToast({ ok: true }), '已經係最新');
  assert.equal(manualToast({ skipped: 'recent', ok: true }), '已經係最新');
  assert.equal(manualToast({ ok: false, kind: 'network' }), '連唔到伺服器，顯示緊上次資料');
  assert.equal(manualToast({ ok: false, kind: 'offline' }), '連唔到伺服器，顯示緊上次資料');
  assert.equal(manualToast({ ok: false, kind: 'auth' }), '');
  assert.equal(classifyRefreshFailure({ code: 'unauthorized' }, true), 'auth');
  assert.equal(classifyRefreshFailure({ code: 'read_failed' }, true), 'server');
  assert.equal(classifyRefreshFailure({ code: 'network' }, false), 'offline');
});

test('fetch wrapper aborts at the timeout and the fallback lock still runs', async () => {
  let signal;
  const wrapped = fetchWithTimeout((url, init) => {
    signal = init.signal;
    return new Promise((resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    });
  }, 20);
  const pending = wrapped('https://example.test/exec', { method: 'POST', body: '{"action":"getPortfolio"}' });
  const settled = pending.then(() => null, (error) => error);
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(signal.aborted, true);
  const error = await settled;
  assert.equal(error.name, 'AbortError');

  let ran = 0;
  await withRefreshLock(async () => { ran += 1; }, null);
  assert.equal(ran, 1);
});
