import { formatHelsinkiTime, helsinkiParts } from './format.js';
import { errorText } from './messages.js';

/** Own names. Vault uses vault-v3 / vault-v3-sync. Calendar uses calendar-v3 / calendar-v3-sync. */
export const SNAPSHOT_DB = 'investment-v2-snapshot';
export const SNAPSHOT_VERSION = 1;
export const SNAPSHOT_STORE = 'snapshots';
export const SNAPSHOT_KEY = 'portfolio';
export const META_KEY = 'meta';
export const LOCK_NAME = 'investment-v2-refresh';

export const PULL_GAP_MS = 15_000;
export const BACKOFF_BASE_MS = 5_000;
export const BACKOFF_MAX_MS = 5 * 60_000;
export const INTERVAL_MS = 5 * 60_000;
export const REQUEST_TIMEOUT_MS = 30_000;

const EMPTY_META = { lastOkAt: 0, failCount: 0, nextAttemptAt: 0, lastError: '' };

export function nextBackoff(failCount) {
  const n = Math.max(1, Number(failCount) || 1);
  return Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * (2 ** (n - 1)));
}

export function shouldSkipPull({ now, lastOkAt, manual }) {
  if (manual) return false;
  const at = Number(lastOkAt) || 0;
  if (!at) return false;
  return now - at < PULL_GAP_MS;
}

export function classifyRefreshFailure(error, online = true) {
  if (online === false) return 'offline';
  const code = error?.code || '';
  if (code === 'unauthorized') return 'auth';
  if (code === 'network' || code === 'cors' || error?.name === 'AbortError') return 'network';
  return 'server';
}

export function formatRefreshClock(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const parts = helsinkiParts(date);
  return `${parts.hour}:${parts.minute}`;
}

export function pillModel({ phase = 'idle', fetchedAt = null, errorCode = '', online = true } = {}) {
  const full = fetchedAt ? formatHelsinkiTime(fetchedAt) : '未有';
  const clock = formatRefreshClock(fetchedAt);
  let text = '未更新';
  let action = 'refresh';
  let shown = phase;
  if (!online && phase !== 'loading' && phase !== 'auth') shown = fetchedAt ? 'offline' : phase;
  if (shown === 'loading') text = '更新中…';
  else if (shown === 'auth') {
    text = '權杖被拒';
    action = 'settings';
  } else if (shown === 'offline') text = '離線，顯示上次資料';
  else if (shown === 'network') text = '網絡錯誤，顯示上次資料';
  else if (shown === 'server') text = '伺服器錯誤';
  else if (shown === 'fresh' || shown === 'cached') text = clock ? `已更新 ${clock}` : '已更新';
  else if (shown === 'unconfigured') {
    text = '未連接';
    action = 'settings';
  }
  const title = [`上次更新：${full}`];
  if (errorCode) title.push(`錯誤：${errorText(errorCode)}`);
  return { phase: shown, text, title: title.join(' · '), action };
}

export function manualToast(result) {
  if (!result) return '';
  if (result.ok || result.skipped === 'recent') return '已經係最新';
  if (result.kind === 'network' || result.kind === 'offline') return '連唔到伺服器，顯示緊上次資料';
  if (result.kind === 'server') return '伺服器出錯，顯示緊上次資料';
  return '';
}

export function planBoot({ connection, snapshot }) {
  if (!connection?.endpoint || !connection?.token) return { mode: 'unconfigured' };
  if (snapshot?.data && typeof snapshot.data === 'object' && snapshot.data.overview) {
    return { mode: 'cached', data: snapshot.data, fetchedAt: snapshot.fetchedAt || null };
  }
  return { mode: 'loading' };
}

export function fetchWithTimeout(fetchImpl, timeoutMs = REQUEST_TIMEOUT_MS, setTimer = setTimeout, clearTimer = clearTimeout) {
  return (url, init = {}) => {
    const ctrl = new AbortController();
    const timer = setTimer(() => ctrl.abort(), timeoutMs);
    return Promise.resolve(fetchImpl(url, { ...init, signal: ctrl.signal })).finally(() => clearTimer(timer));
  };
}

export function withRefreshLock(fn, locks) {
  const request = locks && typeof locks.request === 'function' ? locks.request.bind(locks) : null;
  if (request) return request(LOCK_NAME, () => fn());
  return fn();
}

export function createMemoryStorage(initial = {}) {
  const box = {
    snapshot: initial.snapshot || null,
    meta: { ...EMPTY_META, ...(initial.meta || {}) },
  };
  return {
    async loadSnapshot() { return box.snapshot; },
    async saveSnapshot(record) { box.snapshot = record; return record; },
    async loadMeta() { return { ...box.meta }; },
    async saveMeta(meta) { box.meta = { ...box.meta, ...meta }; return { ...box.meta }; },
    async clear() { box.snapshot = null; box.meta = { ...EMPTY_META }; },
  };
}

function openSnapshotDb(indexedDB) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(SNAPSHOT_DB, SNAPSHOT_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SNAPSHOT_STORE)) db.createObjectStore(SNAPSHOT_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function withSnapshotStore(indexedDB, mode, fn) {
  return openSnapshotDb(indexedDB).then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(SNAPSHOT_STORE, mode);
    const store = tx.objectStore(SNAPSHOT_STORE);
    let request;
    try {
      request = fn(store);
    } catch (error) {
      db.close();
      reject(error);
      return;
    }
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  }));
}

export function createIdbSnapshotStorage(indexedDB = globalThis.indexedDB) {
  if (!indexedDB) return createMemoryStorage();
  return {
    loadSnapshot: () => withSnapshotStore(indexedDB, 'readonly', (store) => store.get(SNAPSHOT_KEY)).then((value) => value || null).catch(() => null),
    saveSnapshot: (record) => withSnapshotStore(indexedDB, 'readwrite', (store) => store.put(record, SNAPSHOT_KEY)).then(() => record),
    loadMeta: () => withSnapshotStore(indexedDB, 'readonly', (store) => store.get(META_KEY)).then((value) => ({ ...EMPTY_META, ...(value || {}) })).catch(() => ({ ...EMPTY_META })),
    saveMeta: (meta) => withSnapshotStore(indexedDB, 'readwrite', (store) => store.put(meta, META_KEY)).then(() => meta),
    clear: () => openSnapshotDb(indexedDB).then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction(SNAPSHOT_STORE, 'readwrite');
      tx.objectStore(SNAPSHOT_STORE).delete(SNAPSHOT_KEY);
      tx.objectStore(SNAPSHOT_STORE).delete(META_KEY);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    })),
  };
}

export function createRefresh({
  call,
  storage,
  locks = null,
  now = () => Date.now(),
  timers = globalThis,
  isOnline = () => true,
  isVisible = () => true,
  intervalMs = INTERVAL_MS,
  onChange = () => {},
} = {}) {
  let running = null;
  let intervalId = null;
  let retryId = null;
  let phase = 'idle';
  let lastError = null;

  function emit() {
    onChange({ phase, lastError, running: !!running });
  }

  function hiddenSkip(manual, trigger) {
    if (manual) return false;
    if (trigger === 'open' || trigger === 'online') return false;
    return !isVisible();
  }

  async function runPull(manual) {
    return withRefreshLock(async () => {
      const meta = await storage.loadMeta();
      if (!manual && shouldSkipPull({ now: now(), lastOkAt: meta.lastOkAt, manual: false })) {
        phase = 'fresh';
        lastError = null;
        emit();
        return { ok: true, skipped: 'recent', lastOkAt: meta.lastOkAt };
      }
      if (!manual && meta.nextAttemptAt && now() < meta.nextAttemptAt) {
        return { skipped: 'backoff', nextAttemptAt: meta.nextAttemptAt };
      }
      phase = 'loading';
      lastError = null;
      emit();
      try {
        const data = await call();
        const fetchedAt = new Date(now()).toISOString();
        await storage.saveSnapshot({ data, fetchedAt });
        await storage.saveMeta({ lastOkAt: now(), failCount: 0, nextAttemptAt: 0, lastError: '' });
        phase = 'fresh';
        lastError = null;
        emit();
        return { ok: true, data, fetchedAt, fresh: true };
      } catch (error) {
        const prev = await storage.loadMeta();
        const failCount = (Number(prev.failCount) || 0) + 1;
        const wait = nextBackoff(failCount);
        const nextAttemptAt = now() + wait;
        const kind = classifyRefreshFailure(error, isOnline());
        phase = kind;
        lastError = error;
        await storage.saveMeta({
          lastOkAt: prev.lastOkAt || 0,
          failCount,
          nextAttemptAt,
          lastError: error?.code || kind,
        });
        scheduleRetry(nextAttemptAt);
        emit();
        return { ok: false, error, kind, failCount, nextAttemptAt };
      }
    }, locks);
  }

  function scheduleRetry(nextAttemptAt) {
    if (!timers || typeof timers.setTimeout !== 'function') return;
    if (retryId) timers.clearTimeout(retryId);
    const delay = Math.max(0, nextAttemptAt - now());
    retryId = timers.setTimeout(() => {
      retryId = null;
      if (isVisible()) pull({ trigger: 'retry' });
    }, delay);
  }

  function pull(opts = {}) {
    const manual = !!opts.manual;
    const trigger = opts.trigger || (manual ? 'manual' : 'open');
    if (running) return running;
    if (hiddenSkip(manual, trigger)) return Promise.resolve({ skipped: 'hidden' });
    const job = runPull(manual);
    running = job;
    return job.finally(() => {
      running = null;
    });
  }

  function startInterval() {
    if (!timers || typeof timers.setInterval !== 'function' || intervalId) return;
    intervalId = timers.setInterval(() => {
      if (isVisible()) pull({ trigger: 'timer' });
    }, intervalMs);
  }

  function stopInterval() {
    if (intervalId && timers?.clearInterval) timers.clearInterval(intervalId);
    intervalId = null;
  }

  return {
    pull,
    start() {
      if (isVisible()) startInterval();
      return pull({ trigger: 'open' });
    },
    arm() {
      if (isVisible()) startInterval();
    },
    stop() {
      stopInterval();
      if (retryId && timers?.clearTimeout) timers.clearTimeout(retryId);
      retryId = null;
    },
    onVisibility() {
      if (isVisible()) {
        startInterval();
        return pull({ trigger: 'visible' });
      }
      stopInterval();
      return Promise.resolve({ skipped: 'hidden' });
    },
    async onOnline() {
      const meta = await storage.loadMeta();
      await storage.saveMeta({ ...meta, failCount: 0, nextAttemptAt: 0 });
      if (retryId && timers?.clearTimeout) timers.clearTimeout(retryId);
      retryId = null;
      return pull({ trigger: 'online' });
    },
    status: () => ({ phase, lastError, running: !!running }),
  };
}
