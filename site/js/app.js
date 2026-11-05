import { searchSymbols } from './search.js';
import {
  callPortfolio,
  clearConnection,
  loadConnection,
  loadPortfolioCache,
  saveConnection,
  savePortfolioCache,
} from './portfolio.js';
import { errorText } from './messages.js';
import { renderApp } from './render.js';

const root = document.querySelector('#app');
let searchTimer = 0;
const state = {
  now: new Date(),
  marketStatus: 'loading',
  market: null,
  symbolsStatus: 'loading',
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
};

function paint() {
  renderApp(root, state, {
    reload: () => { refreshPortfolio(); },
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
  });
}

async function loadJson(url) {
  const response = await fetch(url, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`http_${response.status}`);
  return response.json();
}

async function bootMarket() {
  try {
    state.market = await loadJson('./data/market-cache.json');
    state.marketStatus = 'ready';
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
  const params = new URLSearchParams(location.hash.replace(/^#/, ''));
  const query = params.get('q');
  if (query && state.symbols?.rows) {
    state.query = query;
    state.results = searchSymbols(state.symbols.rows, query);
    if (state.results[0] && state.results[0][0] === query.toUpperCase()) {
      state.selected = { ticker: state.results[0][0], cik: state.results[0][1], name: state.results[0][2] };
    }
  }
  paint();
}

async function bootConnection() {
  try {
    const connection = await loadConnection();
    state.connection = connection ? { endpointHost: 'script.google.com', savedAt: connection.savedAt } : null;
    if (!connection) {
      state.portfolioStatus = 'unconfigured';
      paint();
      return;
    }
    const cached = await loadPortfolioCache();
    if (cached?.data) {
      state.portfolio = cached.data;
      state.portfolioFetchedAt = cached.fetchedAt;
    }
    state.portfolioStatus = 'loading';
    paint();
    await refreshPortfolio(connection);
  } catch (error) {
    state.portfolioStatus = 'error';
    state.portfolioError = error.code || 'no_indexeddb';
    paint();
  }
}

async function refreshPortfolio(connection) {
  const current = connection || await loadConnection();
  if (!current?.endpoint || !current?.token) {
    state.connection = null;
    state.portfolio = null;
    state.portfolioStatus = 'unconfigured';
    paint();
    return;
  }
  state.portfolioStatus = state.portfolio ? 'loading' : 'loading';
  if (!state.portfolio) state.portfolioStatus = 'loading';
  paint();
  try {
    const data = await callPortfolio(current);
    const saved = await savePortfolioCache(data);
    state.portfolio = saved.data;
    state.portfolioFetchedAt = saved.fetchedAt;
    state.portfolioStatus = 'ready';
    state.portfolioError = null;
  } catch (error) {
    state.portfolioError = error.code || 'network';
    state.portfolioStatus = state.portfolio ? 'cached' : 'error';
  }
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
    paint();
    await refreshPortfolio();
  } catch (error) {
    state.settingsMessage = errorText(error.code || 'invalid_endpoint');
    paint();
  }
}

async function forgetSettings() {
  await clearConnection();
  state.connection = null;
  state.portfolio = null;
  state.portfolioFetchedAt = null;
  state.portfolioStatus = 'unconfigured';
  state.portfolioError = null;
  state.settingsMessage = '已清除本機連接同持倉快取。';
  paint();
}

paint();
bootMarket();
bootSymbols();
bootConnection();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => {});
}
