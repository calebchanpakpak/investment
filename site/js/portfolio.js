export const DB_NAME = 'investment-tracker-v2';
export const DB_VERSION = 1;
export const STORE = 'kv';
export const CONNECTION_KEY = 'connection';
export const PORTFOLIO_CACHE_KEY = 'portfolio-cache';
export const PORTFOLIO_ACTION = 'getPortfolio';

const HOSTS = new Set(['script.google.com']);

export function buildPortfolioRequest(settings, action = PORTFOLIO_ACTION, payload = {}) {
  if (!settings?.endpoint || !settings?.token) {
    throw Object.assign(new Error('not_configured'), { code: 'not_configured' });
  }
  if (action !== PORTFOLIO_ACTION) {
    throw Object.assign(new Error('action_not_allowed'), { code: 'action_not_allowed' });
  }
  let url;
  try {
    url = new URL(settings.endpoint);
  } catch {
    throw Object.assign(new Error('invalid_endpoint'), { code: 'invalid_endpoint' });
  }
  const local = (url.protocol === 'http:' && (url.hostname === '127.0.0.1' || url.hostname === 'localhost') && url.pathname.endsWith('/exec'));
  const cloud = url.protocol === 'https:' && HOSTS.has(url.hostname) && url.pathname.includes('/macros/s/') && url.pathname.endsWith('/exec');
  if (!local && !cloud) {
    throw Object.assign(new Error('invalid_endpoint'), { code: 'invalid_endpoint' });
  }
  if (url.username || url.password || url.search || url.hash) {
    throw Object.assign(new Error('invalid_endpoint'), { code: 'invalid_endpoint' });
  }
  return {
    url: url.toString(),
    init: {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, payload: payload ?? {}, token: settings.token }),
      redirect: 'follow',
      cache: 'no-store',
    },
  };
}

export async function readPortfolioResponse(response) {
  if (!response || response.type === 'opaque' || response.type === 'opaqueredirect') {
    throw Object.assign(new Error('opaque_response'), { code: 'cors' });
  }
  let json = null;
  try {
    json = await response.json();
  } catch {
    json = null;
  }
  if (!json || typeof json !== 'object' || json.ok !== true || !json.data || typeof json.data !== 'object' || !json.data.overview) {
    const code = json && json.ok === false && json.error ? String(json.error) : 'bad_response';
    throw Object.assign(new Error(code), { code });
  }
  return json.data;
}

export async function callPortfolio(settings, fetchImpl = globalThis.fetch) {
  const request = buildPortfolioRequest(settings);
  if (request.init.headers.Authorization || request.init.headers.authorization) {
    throw Object.assign(new Error('auth_header'), { code: 'auth_header' });
  }
  let response;
  try {
    response = await fetchImpl(request.url, request.init);
  } catch {
    throw Object.assign(new Error('network'), { code: 'network' });
  }
  return readPortfolioResponse(response);
}

function openDb() {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(Object.assign(new Error('no_indexeddb'), { code: 'no_indexeddb' }));
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function withStore(mode, fn) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const store = tx.objectStore(STORE);
    const result = fn(store);
    result.onsuccess = () => resolve(result.result);
    result.onerror = () => reject(result.error);
    tx.oncomplete = () => db.close();
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  }));
}

export function loadConnection() {
  return withStore('readonly', (store) => store.get(CONNECTION_KEY)).then((value) => value || null);
}

export function saveConnection(endpoint, token) {
  const record = { endpoint, token, savedAt: new Date().toISOString() };
  buildPortfolioRequest(record);
  return withStore('readwrite', (store) => store.put(record, CONNECTION_KEY)).then(() => ({
    endpoint,
    savedAt: record.savedAt,
  }));
}

export function clearConnection() {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(CONNECTION_KEY);
    tx.objectStore(STORE).delete(PORTFOLIO_CACHE_KEY);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  }));
}

export function loadPortfolioCache() {
  return withStore('readonly', (store) => store.get(PORTFOLIO_CACHE_KEY)).then((value) => value || null);
}

export function savePortfolioCache(data) {
  const record = { data, fetchedAt: new Date().toISOString() };
  return withStore('readwrite', (store) => store.put(record, PORTFOLIO_CACHE_KEY)).then(() => record);
}
