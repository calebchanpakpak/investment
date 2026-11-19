import { searchSymbols } from './search.js';
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
  parseMarketFx,
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
import { adjacentTab, chooseInitialTab, hashForTab, parseRoute, TAB_STORAGE_KEY } from './tabs.js';

const root = document.querySelector('#app');
let searchTimer = 0;
let toastTimer = 0;
let waitingWorker = null;
const snapshotStorage = createIdbSnapshotStorage();
const state = {
  now: new Date(),
  tab: 'overview',
  marketStatus: 'loading',
  market: null,
  symbolsStatus: 'loading',
  symbols: null,
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
  query: '',
  results: [],
  selected: null,
  endpointDraft: '',
  tokenDraft: '',
  settingsMessage: '',
};

function rememberTab(tab) {
  try { localStorage.setItem(TAB_STORAGE_KEY, tab); } catch { /* private mode */ }
}

function recalledTab() {
  try { return localStorage.getItem(TAB_STORAGE_KEY); } catch { return null; }
}

function paint() {
  renderApp(root, state, {
    reload: () => { manualRefresh(); },
    refresh: () => { onPill(); },
    search: (value) => {
      state.query = value;
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        state.results = state.symbols?.rows ? searchSymbols(state.symbols.rows, state.query) : [];
        if (state.selected && !state.results.some((row) => row[0] === state.selected.ticker && row[1] === state.selected.cik)) {
          state.selected = null;
        }
        paint();
      }, 120);
    },
    select: (row) => {
      state.selected = { ticker: row[0], cik: row[1], name: row[2] };
      paint();
    },
    save: () => { saveSettings(); },
    clear: () => { forgetSettings(); },
    swipe: (direction) => {
      const next = adjacentTab(state.tab, direction);
      if (!next) return;
      const hash = hashForTab(next);
      if (location.hash !== hash) location.hash = hash;
    },
    updateApp: () => { requestSkipWaiting(waitingWorker); },
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

function applyRoute() {
  const route = parseRoute(location.hash);
  if (route.tab) {
    state.tab = route.tab;
    rememberTab(route.tab);
  }
  if (route.query) {
    state.query = route.query;
    if (state.symbols?.rows) {
      state.results = searchSymbols(state.symbols.rows, state.query);
      const exact = state.results.find((row) => row[0] === state.query.toUpperCase());
      state.selected = exact ? { ticker: exact[0], cik: exact[1], name: exact[2] } : state.selected;
    }
  }
}

async function loadJson(url) {
  const response = await fetch(url, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`http_${response.status}`);
  return response.json();
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
  adoptFx(fresherQuote(parseMarketFx(state.market?.fx), state.fxQuote));
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

async function bootMarket() {
  try {
    state.market = await loadJson('./data/market-cache.json');
    state.marketStatus = 'ready';
    const marketFx = parseMarketFx(state.market?.fx);
    if (marketFx) {
      const best = fresherQuote(marketFx, state.fxQuote);
      writeFxCache(best);
      adoptFx(best);
    }
  } catch {
    state.marketStatus = 'error';
  }
  paint();
}

async function bootSymbols() {
  try {
    state.symbols = await loadJson('./data/symbols.json');
    state.symbolsStatus = state.symbols?.rows ? 'ready' : 'error';
  } catch {
    state.symbolsStatus = 'error';
  }
  applyRoute();
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
  paint();
}

function bootRoute() {
  state.tab = chooseInitialTab(location.hash, recalledTab());
  applyRoute();
  const route = parseRoute(location.hash);
  if (!route.tab && location.hash !== hashForTab(state.tab)) {
    history.replaceState(null, '', hashForTab(state.tab));
  }
}

window.addEventListener('hashchange', () => {
  applyRoute();
  paint();
});
window.addEventListener('online', () => {
  state.online = true;
  refreshEngine.onOnline().then((result) => {
    applyRefreshResult(result);
    paint();
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
bootMarket();
bootSymbols();
bootFx();
bootPortfolio();

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
