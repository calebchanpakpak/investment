import {
  callPortfolio,
  clearConnection,
  loadConnection,
  loadPortfolioCache,
  saveConnection,
} from './portfolio.js';
import { errorText } from './messages.js';
import { renderApp } from './render.js';
import {
  fetchUsdHkd,
  fresherQuote,
  rateStatus,
  readFxCache,
  writeFxCache,
} from './fx.js';
import {
  INTERVAL_MS,
  REQUEST_TIMEOUT_MS,
  createIdbSnapshotStorage,
  createRefresh,
  fetchWithTimeout,
  manualToast,
  planBoot,
} from './refresh.js';
import { attachServiceWorker, requestSkipWaiting } from './sw-client.js';
import { prepareTeamPlan } from './team-plan.js';
import {
  createIdbOutbox,
  flushOutbox,
  newClientId,
  normalizeTeamResponses,
  reconcileOutbox,
} from './responses.js';
import {
  adjacentTab,
  chooseInitialTab,
  hashForTab,
  navFor,
  parseRoute,
  PLAN_SECTION_KEY,
  PLAN_STRATEGY_KEY,
  resolvePlanSection,
  TAB_STORAGE_KEY,
} from './tabs.js';

const root = document.querySelector('#app');
let toastTimer = 0;
let waitingWorker = null;
const snapshotStorage = createIdbSnapshotStorage();
const outboxStore = createIdbOutbox();
const state = {
  now: new Date(),
  tab: 'overview',
  holding: '',
  planSection: 'overview',
  strategyId: '',
  detail: null,
  filters: {},
  outbox: [],
  confirm: null,
  draftNote: '',
  replyText: '',
  replyTo: '',
  viewKey: '',
  connection: null,
  portfolioStatus: 'unconfigured',
  portfolio: null,
  portfolioFetchedAt: null,
  portfolioError: null,
  refreshPhase: 'idle',
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  fxQuote: null,
  fxStatus: 'loading',
  swUpdate: false,
  toast: '',
  endpointDraft: '',
  tokenDraft: '',
  settingsMessage: '',
};

function remember(key, value) {
  try { localStorage.setItem(key, value); } catch { /* private mode */ }
}

function recall(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function paint() {
  renderApp(root, state, {
    reload: () => { manualRefresh(); },
    refresh: () => { onPill(); },
    save: () => { saveSettings(); },
    clear: () => { forgetSettings(); },
    swipe: (direction) => {
      const next = adjacentTab(navFor(state.tab), direction);
      if (!next) return;
      const hash = hashForTab(next);
      if (location.hash !== hash) location.hash = hash;
    },
    updateApp: () => { requestSkipWaiting(waitingWorker); },
    setFilter: (list, patch) => {
      state.filters = { ...state.filters, [list]: { ...(state.filters?.[list] || {}), ...patch } };
      paint();
    },
    requestConfirm: (spec) => { state.confirm = spec; paint(); },
    confirmNo: () => { state.confirm = null; paint(); },
    confirmYes: () => { const draft = state.confirm?.draft; state.confirm = null; enqueue(draft); },
    retry: () => { flushNow(); },
    setDraftNote: (value) => { state.draftNote = value; },
    setReplyText: (value) => { state.replyText = value; },
    setReplyTo: (value) => { state.replyTo = value; paint(); },
  });
}

function showToast(text) {
  state.toast = text || '';
  clearTimeout(toastTimer);
  if (state.toast) toastTimer = setTimeout(() => { state.toast = ''; paint(); }, 2400);
}

function applyPortfolio(data, fetchedAt, status) {
  state.portfolio = data;
  state.portfolioFetchedAt = fetchedAt;
  state.portfolioStatus = status;
  if (status === 'ready') state.portfolioError = null;
}

function applyRefreshResult(result) {
  if (result?.data) applyPortfolio(result.data, result.fetchedAt, 'ready');
  else if (result && result.ok === false) {
    state.portfolioError = result.error?.code || result.kind || 'network';
    state.portfolioStatus = state.portfolio ? 'cached' : 'error';
  }
  if (result?.kind) state.refreshPhase = result.kind;
  else if (result?.ok) state.refreshPhase = 'fresh';
}

const refreshEngine = createRefresh({
  storage: snapshotStorage,
  locks: typeof navigator !== 'undefined' ? navigator.locks : null,
  isOnline: () => navigator.onLine,
  isVisible: () => !document.hidden,
  intervalMs: INTERVAL_MS,
  call: async () => {
    const connection = await loadConnection();
    if (!connection?.endpoint || !connection?.token) {
      throw Object.assign(new Error('not_configured'), { code: 'not_configured' });
    }
    return callPortfolio(connection, fetchWithTimeout(globalThis.fetch, REQUEST_TIMEOUT_MS));
  },
  onChange: (status) => {
    if (status.phase === 'loading') state.refreshPhase = 'loading';
    else if (status.phase && status.phase !== 'idle') state.refreshPhase = status.phase;
    if (status.lastError?.code) state.portfolioError = status.lastError.code;
    paint();
  },
});

async function manualRefresh() {
  const result = await refreshEngine.pull({ manual: true, trigger: 'manual' });
  applyRefreshResult(result);
  if (result?.kind === 'auth') {
    if (location.hash !== '#settings') location.hash = '#settings';
  }
  showToast(manualToast(result));
  paint();
}

function onPill() {
  if (state.refreshPhase === 'auth' || state.portfolioStatus === 'unconfigured') {
    if (location.hash !== '#settings') location.hash = '#settings';
    return;
  }
  manualRefresh();
}

function strategyIds() {
  const plan = state.portfolio ? prepareTeamPlan(state.portfolio, state.now) : null;
  return plan?.strategies?.map((item) => item.id) || [];
}

function applyRoute() {
  const route = parseRoute(location.hash);
  const prev = state.viewKey || '';
  if (route.tab) {
    state.tab = route.tab;
    remember(TAB_STORAGE_KEY, route.tab);
  }
  if (state.tab === 'plan' || route.tab === 'plan') {
    const view = resolvePlanSection(
      route.tab === 'plan' ? route : { section: state.planSection, strategyId: state.strategyId },
      recall(PLAN_SECTION_KEY),
      recall(PLAN_STRATEGY_KEY),
      strategyIds(),
    );
    if (route.tab === 'plan') {
      state.planSection = view.section;
      state.strategyId = view.strategyId || '';
      if (route.section) remember(PLAN_SECTION_KEY, view.section);
      if (view.section === 'strategy' && view.strategyId) remember(PLAN_STRATEGY_KEY, view.strategyId);
      if (view.section === 'strategy' && view.strategyId && !route.strategyId) {
        const next = `#plan/strategy/${encodeURIComponent(view.strategyId)}`;
        if (location.hash !== next) history.replaceState(null, '', next);
      }
    }
  }
  state.holding = route.holding || '';
  state.detail = route.detail;
  const nextKey = `${state.tab}|${state.planSection}|${state.strategyId}`;
  const scrolled = Boolean(prev) && prev !== nextKey;
  state.viewKey = nextKey;
  return scrolled;
}

async function syncOutbox() {
  let items = [];
  try { items = await outboxStore.list(); } catch { items = state.outbox || []; }
  items = reconcileOutbox(items, normalizeTeamResponses(state.portfolio));
  state.outbox = items;
  try { await outboxStore.saveAll(items); } catch { /* private mode */ }
}

async function flushNow() {
  await syncOutbox();
  let settings = null;
  try { settings = await loadConnection(); } catch { settings = null; }
  const online = typeof navigator === 'undefined' ? true : navigator.onLine !== false;
  const next = await flushOutbox({
    items: state.outbox,
    settings,
    online,
    fetchImpl: globalThis.fetch,
  });
  state.outbox = next;
  try { await outboxStore.saveAll(next); } catch { /* private mode */ }
  paint();
}

function enqueue(draft) {
  if (!draft?.kind) return;
  if (draft.kind === 'message' && !String(draft.text || '').trim()) return;
  const item = {
    clientId: newClientId(),
    kind: draft.kind,
    itemId: draft.itemId || '',
    decision: draft.decision || '',
    to: draft.to || '',
    text: draft.text || '',
    createdAt: new Date().toISOString(),
    localStatus: 'pending',
    serverId: '',
    serverStatus: '',
    reply: '',
    error: '',
  };
  state.outbox = [...(state.outbox || []), item];
  state.confirm = null;
  if (draft.kind === 'message') {
    state.replyText = '';
    state.replyTo = '';
  }
  state.draftNote = '';
  paint();
  outboxStore.saveAll(state.outbox).catch(() => {}).then(() => flushNow());
}

function adoptFx(quote) {
  if (!quote) {
    state.fxQuote = null;
    state.fxStatus = 'missing';
    return;
  }
  state.fxQuote = quote;
  state.fxStatus = rateStatus(quote, state.now);
}

async function bootFx() {
  adoptFx(readFxCache());
  if (state.fxQuote) paint();
  try {
    const live = await fetchUsdHkd();
    const best = fresherQuote(live, state.fxQuote);
    writeFxCache(best);
    adoptFx(best);
  } catch {
    if (!state.fxQuote) state.fxStatus = 'missing';
    else state.fxStatus = rateStatus(state.fxQuote, state.now);
  }
  paint();
}

async function bootPortfolio() {
  let connection = null;
  let snapshot = null;
  try {
    connection = await loadConnection();
    snapshot = await snapshotStorage.loadSnapshot();
    if (!snapshot?.data) {
      const legacy = await loadPortfolioCache();
      if (legacy?.data?.overview) {
        snapshot = { data: legacy.data, fetchedAt: legacy.fetchedAt };
        await snapshotStorage.saveSnapshot(snapshot);
      }
    }
  } catch (error) {
    state.portfolioStatus = 'error';
    state.portfolioError = error.code || 'no_indexeddb';
    state.refreshPhase = 'server';
    paint();
    return;
  }
  state.connection = connection ? { endpointHost: 'script.google.com', savedAt: connection.savedAt } : null;
  const plan = planBoot({ connection, snapshot });
  if (plan.mode === 'unconfigured') {
    state.portfolioStatus = 'unconfigured';
    state.portfolio = null;
    state.refreshPhase = 'unconfigured';
    paint();
    return;
  }
  if (plan.mode === 'cached') {
    applyPortfolio(plan.data, plan.fetchedAt, 'cached');
    state.refreshPhase = 'loading';
    paint();
  } else {
    state.portfolioStatus = 'loading';
    state.refreshPhase = 'loading';
    paint();
  }
  const result = await refreshEngine.start();
  applyRefreshResult(result);
  paint();
}

async function saveSettings() {
  const endpoint = (state.endpointDraft || '').trim();
  const token = (state.tokenDraft || '').trim();
  try {
    await saveConnection(endpoint, token);
    state.endpointDraft = '';
    state.tokenDraft = '';
    state.connection = { endpointHost: 'script.google.com' };
    state.settingsMessage = '已儲存喺呢部裝置。權杖唔再顯示。';
    refreshEngine.arm();
    paint();
    await manualRefresh();
  } catch (error) {
    state.settingsMessage = errorText(error.code || 'invalid_endpoint');
    paint();
  }
}

async function forgetSettings() {
  refreshEngine.stop();
  await clearConnection();
  try { await snapshotStorage.clear(); } catch { /* snapshot is optional */ }
  state.connection = null;
  state.portfolio = null;
  state.portfolioFetchedAt = null;
  state.portfolioStatus = 'unconfigured';
  state.portfolioError = null;
  state.refreshPhase = 'unconfigured';
  state.settingsMessage = '已清除本機連接同持倉快取。';
  state.outbox = [];
  try { await outboxStore.clear(); } catch { /* outbox is optional */ }
  paint();
}

function bootRoute() {
  state.tab = chooseInitialTab(location.hash, recall(TAB_STORAGE_KEY));
  applyRoute();
  const route = parseRoute(location.hash);
  if (!route.tab && location.hash !== hashForTab(navFor(state.tab))) {
    history.replaceState(null, '', hashForTab(navFor(state.tab)));
  }
}

window.addEventListener('hashchange', () => {
  const scrolled = applyRoute();
  paint();
  if (scrolled) window.scrollTo(0, 0);
});
window.addEventListener('online', () => {
  state.online = true;
  refreshEngine.onOnline().then((result) => {
    applyRefreshResult(result);
    paint();
    flushNow();
  });
});
window.addEventListener('offline', () => {
  state.online = false;
  if (state.portfolio) state.refreshPhase = 'offline';
  paint();
});
document.addEventListener('visibilitychange', () => {
  if (state.portfolioStatus === 'unconfigured') return;
  refreshEngine.onVisibility().then((result) => {
    applyRefreshResult(result);
    paint();
  });
});

bootRoute();
paint();
bootFx();
bootPortfolio();
syncOutbox().then(() => { paint(); flushNow(); });

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js', { scope: './' }).then((reg) => {
    attachServiceWorker(reg, navigator.serviceWorker, {
      onPrompt(worker) {
        waitingWorker = worker;
        state.swUpdate = true;
        paint();
      },
      reload() { location.reload(); },
    });
  }).catch(() => {});
}
