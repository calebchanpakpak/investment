import { buildPortfolioRequest } from './portfolio.js';

export const RESPONSE_DB = 'investment-v2-outbox';
export const RESPONSE_STORE = 'kv';
export const RESPONSE_KEY = 'items';
const RESPONSE_VERSION = 1;

export const APPROVAL_DISCLAIMER = '批准唔會自動落單，仍然要你自己喺富途輸入';

const UNSUPPORTED = new Set([
  'unknown_action',
  'unknownaction',
  'unsupported_action',
  'not_supported',
  'action_not_supported',
]);

export function newClientId() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') return globalThis.crypto.randomUUID();
  return `cid-${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
}

export function isUnsupported(error) {
  const code = String(error?.code || error?.message || '').toLowerCase().replace(/\s+/g, '_');
  if (UNSUPPORTED.has(code)) return true;
  return code.includes('unknown_action') || code === 'unknown';
}

export function responseStatusLabel(item) {
  if (!item) return '';
  if (item.localStatus === 'pending') return '等候送出';
  if (item.localStatus === 'failed') return '送出失敗，會再試';
  if (item.localStatus === 'unsupported') return '後台未支援';
  const status = item.serverStatus || item.status || '';
  if (status === 'received') return '已收到';
  if (status === 'seen') return '團隊已睇';
  if (status === 'actioned') return '已處理';
  if (item.localStatus === 'sent') return '已送出';
  return status;
}

function clean(value) {
  if (value == null) return '';
  return String(value).trim();
}

export function normalizeTeamResponses(data) {
  const raw = data?.teamResponses;
  if (!Array.isArray(raw)) return [];
  return raw.filter((item) => item && typeof item === 'object' && !Array.isArray(item)).map((item) => ({
    id: clean(item.id),
    clientId: clean(item.clientId),
    kind: clean(item.kind),
    itemId: clean(item.itemId),
    decision: clean(item.decision),
    to: clean(item.to),
    text: clean(item.text),
    createdAt: clean(item.createdAt),
    status: clean(item.status),
    reply: clean(item.reply),
  }));
}

export function responseBody(item) {
  const response = {
    clientId: item.clientId,
    kind: item.kind,
    createdAt: item.createdAt,
  };
  if (item.itemId) response.itemId = item.itemId;
  if (item.decision) response.decision = item.decision;
  if (item.to) response.to = item.to;
  if (item.text) response.text = item.text;
  return response;
}

export async function readSubmitResponse(response) {
  if (!response || response.type === 'opaque' || response.type === 'opaqueredirect') {
    throw Object.assign(new Error('opaque_response'), { code: 'cors' });
  }
  let json = null;
  try { json = await response.json(); } catch { json = null; }
  if (!json || json.ok !== true || !json.response || typeof json.response !== 'object') {
    const code = json && json.ok === false && json.error ? String(json.error) : 'bad_response';
    throw Object.assign(new Error(code), { code });
  }
  return {
    id: clean(json.response.id),
    clientId: clean(json.response.clientId),
    status: clean(json.response.status) || 'received',
  };
}

export async function submitResponse(settings, item, fetchImpl = globalThis.fetch) {
  const request = buildPortfolioRequest(settings, 'submitResponse', responseBody(item));
  if (request.init.headers.Authorization || request.init.headers.authorization) {
    throw Object.assign(new Error('auth_header'), { code: 'auth_header' });
  }
  let response;
  try {
    response = await fetchImpl(request.url, request.init);
  } catch {
    throw Object.assign(new Error('network'), { code: 'network' });
  }
  return readSubmitResponse(response);
}

export async function flushOutbox({ items, settings, online, fetchImpl }) {
  const next = [];
  for (const item of items || []) {
    if (!item || item.localStatus === 'sent' || item.localStatus === 'unsupported') {
      if (item) next.push(item);
      continue;
    }
    if (!online || !settings?.endpoint || !settings?.token) {
      next.push({ ...item, localStatus: item.localStatus === 'failed' ? 'failed' : 'pending' });
      continue;
    }
    try {
      const result = await submitResponse(settings, item, fetchImpl);
      next.push({
        ...item,
        localStatus: 'sent',
        serverId: result.id,
        serverStatus: result.status || 'received',
        error: '',
      });
    } catch (error) {
      next.push({
        ...item,
        localStatus: isUnsupported(error) ? 'unsupported' : 'failed',
        error: error.code || 'network',
      });
    }
  }
  return next;
}

export function reconcileOutbox(localItems, serverItems) {
  const byClient = new Map();
  for (const item of serverItems || []) {
    if (item?.clientId) byClient.set(item.clientId, item);
  }
  return (localItems || []).map((item) => {
    const server = byClient.get(item.clientId);
    if (!server) return item;
    return {
      ...item,
      localStatus: 'sent',
      serverId: server.id || item.serverId || '',
      serverStatus: server.status || item.serverStatus || 'received',
      reply: server.reply || item.reply || '',
      error: '',
    };
  });
}

export function mergeResponses(localItems, serverItems) {
  const map = new Map();
  for (const item of localItems || []) {
    if (!item?.clientId) continue;
    map.set(item.clientId, { ...item });
  }
  for (const item of serverItems || []) {
    const key = item.clientId || (item.id ? `server:${item.id}` : '');
    if (!key) continue;
    const prev = map.get(key) || {};
    map.set(key, {
      ...prev,
      ...item,
      clientId: item.clientId || prev.clientId || '',
      localStatus: 'sent',
      serverStatus: item.status || prev.serverStatus || '',
      serverId: item.id || prev.serverId || '',
      reply: item.reply || prev.reply || '',
    });
  }
  return [...map.values()].sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
}

function openDb(indexedDB) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(RESPONSE_DB, RESPONSE_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(RESPONSE_STORE)) db.createObjectStore(RESPONSE_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function withStore(indexedDB, mode, fn) {
  return openDb(indexedDB).then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(RESPONSE_STORE, mode);
    const store = tx.objectStore(RESPONSE_STORE);
    let request;
    try { request = fn(store); } catch (error) {
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

export function createMemoryOutbox(initial = []) {
  let items = Array.isArray(initial) ? initial.slice() : [];
  return {
    async list() { return items.slice(); },
    async saveAll(next) { items = Array.isArray(next) ? next.slice() : []; return items.slice(); },
    async clear() { items = []; },
  };
}

export function createIdbOutbox(indexedDB = globalThis.indexedDB) {
  if (!indexedDB) return createMemoryOutbox();
  return {
    list: () => withStore(indexedDB, 'readonly', (store) => store.get(RESPONSE_KEY)).then((value) => (Array.isArray(value) ? value : [])).catch(() => []),
    saveAll: (items) => withStore(indexedDB, 'readwrite', (store) => store.put(Array.isArray(items) ? items : [], RESPONSE_KEY)).then(() => items),
    clear: () => withStore(indexedDB, 'readwrite', (store) => store.delete(RESPONSE_KEY)).then(() => undefined).catch(() => undefined),
  };
}
