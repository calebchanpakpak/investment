import { h, clear, externalLink } from './dom.js';
import { fmtMoney, fmtSignedMoney, fmtSignedPctFromRatio, formatHelsinkiTime, toneClass, newYorkDate } from './format.js';
import { CADENCE_NOTICE, DELAY_NOTICE, matchHeadlines, newsViewState, scheduleViewState, sourceLabel, symbolsViewState } from './market.js';
import { NEWS_STATE_TEXT, SCHEDULE_STATE_TEXT, errorText } from './messages.js';
import { companyLinks } from './search.js';
import { buildConsiderations } from './scenario.js';

const COLORS = ['#3B82F6', '#A78BFA', '#FBBF24', '#34D399', '#F472B6', '#38BDF8'];

function sectionTitle(id, text) {
  return h('h2', { id, text });
}

function banner(className, text) {
  return h('p', { class: `banner ${className}`, text });
}

function metaLine(label, value) {
  return h('p', { class: 'meta' }, [
    h('span', { class: 'meta-label', text: `${label}：` }),
    value && value.nodeType ? value : document.createTextNode(value || '—'),
  ]);
}

export function renderApp(root, state, handlers) {
  const focusId = document.activeElement?.id || '';
  const selectionStart = document.activeElement?.selectionStart;
  clear(root);
  root.append(
    renderHeader(),
    renderPortfolio(state, handlers),
    renderNews(state),
    renderSchedule(state),
    renderSearch(state, handlers),
    renderConsiderations(state),
    renderSettings(state, handlers),
    renderFooter(),
  );
  if (focusId) {
    const el = document.getElementById(focusId);
    if (el) {
      el.focus();
      if (typeof selectionStart === 'number' && el.setSelectionRange) {
        try { el.setSelectionRange(selectionStart, selectionStart); } catch { /* number inputs */ }
      }
    }
  }
}

function renderHeader() {
  return h('header', { class: 'top' }, [
    h('a', { class: 'skip', href: '#portfolio', text: '跳到內容' }),
    h('p', { class: 'eyebrow', text: '投資紀錄' }),
    h('h1', { text: '投資紀錄' }),
    h('p', { class: 'sub', text: '私人持倉同公開市場資訊分開顯示。升跌跟富途香港：紅色係升，綠色係跌。' }),
    h('nav', { class: 'nav', 'aria-label': '章節' }, [
      ['#portfolio', '持倉'],
      ['#news', '新聞'],
      ['#schedule', '日程'],
      ['#search', '搜尋'],
      ['#settings', '設定'],
    ].map(([href, text]) => h('a', { href, text }))),
  ]);
}

function renderPortfolio(state, handlers) {
  const section = h('section', { id: 'portfolio', 'aria-labelledby': 'portfolio-title' }, [
    sectionTitle('portfolio-title', '持倉'),
  ]);
  if (state.portfolioStatus === 'unconfigured') {
    section.append(
      h('div', { class: 'card' }, [
        h('h3', { text: '未連接投資組合' }),
        h('p', { text: '真實持倉只會喺你儲存自己嘅 Apps Script 網址同權杖之後先顯示。呢度唔會用範例數字充當你嘅資產。' }),
        h('a', { class: 'button', href: '#settings', text: '去設定' }),
      ]),
    );
    return section;
  }
  if (state.portfolioStatus === 'loading' && !state.portfolio) {
    section.append(h('p', { class: 'status', text: '讀取緊你嘅試算表…' }));
    return section;
  }
  if (state.portfolioStatus === 'error' && !state.portfolio) {
    section.append(banner('error', errorText(state.portfolioError)));
    section.append(h('button', { type: 'button', class: 'button', onclick: handlers.reload, text: '再試一次' }));
    return section;
  }
  if (state.portfolioStatus === 'cached') {
    section.append(banner('warn', `今次讀取失敗（${errorText(state.portfolioError)}）。下面係上次成功讀取，時間 ${formatHelsinkiTime(state.portfolioFetchedAt)}。呢個唔係即時數字，亦唔代表試算表已經重算。`));
  }
  if (state.portfolioStatus === 'loading' && state.portfolio) {
    section.append(banner('info', '重新讀取緊。下面暫時仍係上次成功讀取。'));
  }
  if (state.portfolioStatus === 'ready') {
    section.append(h('p', { class: 'meta', text: `上次成功讀取：${formatHelsinkiTime(state.portfolioFetchedAt)}。前端快取唔會加快試算表重算，亦唔係券商即時報價。` }));
  }
  section.append(renderOverview(state.portfolio), renderHoldings(state.portfolio), renderMonthly(state.portfolio), renderTrades(state.portfolio));
  section.append(h('button', { type: 'button', class: 'button', onclick: handlers.reload, text: '重新讀取持倉' }));
  return section;
}

function renderOverview(data) {
  const overview = data?.overview || {};
  return h('div', { class: 'cards' }, [
    h('article', { class: 'card wide' }, [
      h('div', { class: 'label', text: '總資產（港元）' }),
      h('div', { class: 'value', text: `HK$ ${fmtMoney(overview.totalHkd)}` }),
    ]),
    h('article', { class: 'card' }, [
      h('div', { class: 'label', text: '總資產（美元）' }),
      h('div', { class: 'value sm', text: `US$ ${fmtMoney(overview.totalUsd)}` }),
    ]),
    h('article', { class: 'card' }, [
      h('div', { class: 'label', text: '淨投入（港元）' }),
      h('div', { class: 'value sm', text: `HK$ ${fmtMoney(overview.netDeposit, 0)}` }),
    ]),
    h('article', { class: 'card wide' }, [
      h('div', { class: 'label', text: '總回報' }),
      h('div', { class: `value sm ${toneClass(overview.pnlPct)}`, text: fmtSignedPctFromRatio(overview.pnlPct) }),
      h('div', { class: toneClass(overview.pnlHkd), text: `${fmtSignedMoney(overview.pnlHkd)} HKD` }),
    ]),
    h('article', { class: 'card' }, [
      h('div', { class: 'label', text: '匯率（USD→HKD）' }),
      h('div', { class: 'value sm', text: fmtMoney(overview.rate, 4) }),
    ]),
    h('article', { class: 'card' }, [
      h('div', { class: 'label', text: '試算表更新時間（赫爾辛基）' }),
      h('div', { class: 'value sm', text: overview.lastUpdated || '—' }),
    ]),
  ]);
}

function renderHoldings(data) {
  const holdings = Array.isArray(data?.holdings) ? data.holdings : [];
  const wrap = h('div', { class: 'block' }, [h('h3', { text: '持倉分佈（港元）' })]);
  if (!holdings.length) {
    wrap.append(h('p', { class: 'status', text: '未有持倉資料。' }));
    return wrap;
  }
  const total = holdings.reduce((sum, holding) => sum + (Number(holding.mvHkd) || 0), 0);
  wrap.append(donutChart(holdings, total));
  const rows = h('div', { class: 'bars' });
  holdings.forEach((holding, index) => {
    const pct = total > 0 ? Math.max(0, (Number(holding.mvHkd) || 0) / total * 100) : 0;
    rows.append(h('div', { class: 'bar-row' }, [
      h('div', { class: 'name', text: holding.name || '—' }),
      h('div', { class: 'bar-track', title: `${pct.toFixed(1)}%` }, [
        h('div', { class: 'bar-fill', style: `width:${pct.toFixed(1)}%;background:${COLORS[index % COLORS.length]}` }),
      ]),
      h('div', { class: 'amt', text: `HK$ ${fmtMoney(holding.mvHkd, 0)}` }),
    ]));
  });
  wrap.append(rows);
  const table = h('table', { class: 'data' }, [
    h('caption', { text: '持倉明細' }),
    h('thead', {}, [h('tr', {}, ['名稱', '種類', '數量', '價格', '市值（港元）'].map((text) => h('th', { text, scope: 'col' })))]),
    h('tbody', {}, holdings.map((holding) => h('tr', {}, [
      h('td', { text: holding.name || '—' }),
      h('td', { text: holding.kind || '—' }),
      h('td', { text: holding.qty == null ? '—' : fmtMoney(holding.qty, 4) }),
      h('td', { text: holding.price == null ? '—' : fmtMoney(holding.price) }),
      h('td', { text: fmtMoney(holding.mvHkd) }),
    ]))),
  ]);
  wrap.append(table);
  return wrap;
}

function donutChart(holdings, total) {
  if (!(total > 0)) return h('p', { class: 'status', text: '未有持倉市值，所以唔畫分佈圖。' });
  const radius = 42;
  const circ = 2 * Math.PI * radius;
  let offset = 0;
  const svgNs = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNs, 'svg');
  svg.setAttribute('viewBox', '0 0 120 120');
  svg.setAttribute('class', 'donut');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', '持倉市值分佈');
  holdings.forEach((holding, index) => {
    const value = Math.max(0, Number(holding.mvHkd) || 0);
    const length = total > 0 ? (value / total) * circ : 0;
    const circle = document.createElementNS(svgNs, 'circle');
    circle.setAttribute('cx', '60');
    circle.setAttribute('cy', '60');
    circle.setAttribute('r', String(radius));
    circle.setAttribute('fill', 'none');
    circle.setAttribute('stroke', COLORS[index % COLORS.length]);
    circle.setAttribute('stroke-width', '14');
    circle.setAttribute('stroke-dasharray', `${length} ${circ - length}`);
    circle.setAttribute('stroke-dashoffset', String(-offset));
    circle.setAttribute('transform', 'rotate(-90 60 60)');
    svg.append(circle);
    offset += length;
  });
  return h('div', { class: 'chart-wrap' }, [svg]);
}

function renderMonthly(data) {
  const monthly = Array.isArray(data?.monthly) ? data.monthly : [];
  const wrap = h('div', { class: 'block' }, [h('h3', { text: '每月表現' })]);
  if (monthly.length < 2) {
    wrap.append(h('p', { class: 'status', text: '每月數據少過兩期，所以只列出數字，唔畫走勢線。' }));
  } else {
    wrap.append(lineChart(monthly));
    wrap.append(h('p', { class: 'legend' }, [
      h('span', { class: 'swatch nav', text: '期末 NAV' }),
      h('span', { class: 'swatch dep', text: '累計存入' }),
    ]));
  }
  if (!monthly.length) return wrap;
  wrap.append(h('table', { class: 'data' }, [
    h('caption', { text: '每月數字' }),
    h('thead', {}, [h('tr', {}, ['月份', '期末 NAV', '累計存入', '變動'].map((text) => h('th', { text, scope: 'col' })))]),
    h('tbody', {}, monthly.map((row) => h('tr', {}, [
      h('td', { text: row.month || '—' }),
      h('td', { text: fmtMoney(row.nav, 0) }),
      h('td', { text: fmtMoney(row.deposits, 0) }),
      h('td', { class: toneClass(row.change), text: fmtSignedMoney(row.change, 0) }),
    ]))),
  ]));
  return wrap;
}

function lineChart(monthly) {
  const width = 320;
  const height = 160;
  const pad = 12;
  const values = monthly.flatMap((row) => [Number(row.nav) || 0, Number(row.deposits) || 0]);
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const x = (index) => pad + (index * (width - pad * 2)) / (monthly.length - 1);
  const y = (value) => height - pad - ((value - min) / span) * (height - pad * 2);
  const path = (key) => monthly.map((row, index) => `${index === 0 ? 'M' : 'L'} ${x(index).toFixed(1)} ${y(Number(row[key]) || 0).toFixed(1)}`).join(' ');
  const svgNs = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNs, 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('class', 'line');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', '期末 NAV 同累計存入');
  for (const [key, color, dash] of [['nav', '#60A5FA', ''], ['deposits', '#FBBF24', '4 4']]) {
    const el = document.createElementNS(svgNs, 'path');
    el.setAttribute('d', path(key));
    el.setAttribute('fill', 'none');
    el.setAttribute('stroke', color);
    el.setAttribute('stroke-width', '2');
    if (dash) el.setAttribute('stroke-dasharray', dash);
    svg.append(el);
  }
  return h('div', { class: 'chart-wrap' }, [svg]);
}

function renderTrades(data) {
  const trades = Array.isArray(data?.trades) ? data.trades : [];
  const wrap = h('div', { class: 'block' }, [h('h3', { text: '交易列表（最新先）' })]);
  if (!trades.length) {
    wrap.append(h('p', { class: 'status', text: '未有交易紀錄。' }));
    return wrap;
  }
  const list = h('div', { class: 'trade-list' });
  for (const trade of trades) {
    const sideClass = trade.side === '買' ? 'up' : trade.side === '賣' ? 'down' : 'flat';
    list.append(h('article', { class: 'trade' }, [
      h('div', {}, [
        h('span', { class: 'ticker', text: trade.ticker || '—' }),
        ' ',
        h('span', { class: sideClass, text: trade.side || '—' }),
      ]),
      h('div', { class: 'amt', text: `$ ${fmtMoney(trade.amount)}` }),
      h('div', { class: 'meta', text: `${trade.date || '—'} · ${fmtMoney(trade.qty, 4)} × $${fmtMoney(trade.price)}` }),
      h('div', { class: 'meta right', text: 'USD' }),
    ]));
  }
  wrap.append(list);
  return wrap;
}

function renderNews(state) {
  const section = h('section', { id: 'news', 'aria-labelledby': 'news-title' }, [
    sectionTitle('news-title', '美國市場新聞'),
    h('p', { class: 'sub', text: '呢度係較闊嘅公開市場標題，唔限於你嘅持倉。同私人投資組合分開儲存。' }),
    h('p', { class: 'sub', text: DELAY_NOTICE }),
    h('p', { class: 'sub', text: CADENCE_NOTICE }),
  ]);
  if (state.marketStatus === 'loading') {
    section.append(h('p', { class: 'status', text: NEWS_STATE_TEXT.loading }));
    return section;
  }
  if (state.marketStatus === 'error' || !state.market?.news) {
    section.append(banner('error', NEWS_STATE_TEXT.error));
    section.append(externalLink('https://www.cnbc.com/id/10000664/device/rss/rss.html', '打開 CNBC RSS 來源'));
    return section;
  }
  const news = state.market.news;
  const view = newsViewState(news, state.now);
  const source = sourceLabel(news);
  section.append(banner(view.state === 'ok' ? 'info' : view.state === 'empty' ? 'info' : 'warn', NEWS_STATE_TEXT[view.state] || NEWS_STATE_TEXT.error));
  section.append(
    metaLine('來源', source.name),
    metaLine('發布渠道', news.channelTitle || '—'),
    metaLine('快取擷取', formatHelsinkiTime(news.fetchedAt)),
    metaLine('來源連結', externalLink(source.url || 'https://www.cnbc.com/id/10000664/device/rss/rss.html', 'CNBC RSS')),
  );
  if (news.channelLastBuild) section.append(metaLine('RSS lastBuildDate', formatHelsinkiTime(news.channelLastBuild)));
  if (!news.items?.length) return section;
  const list = h('div', { class: 'story-list' });
  for (const item of news.items) {
    list.append(h('article', { class: 'story' }, [
      externalLink(item.link, item.title, 'story-title'),
      item.summary ? h('p', { text: item.summary }) : null,
      h('p', { class: 'meta', text: `來源：${source.name} · 發布：${item.publishedAt ? formatHelsinkiTime(item.publishedAt) : '時間未能解析'} · 快取擷取：${formatHelsinkiTime(news.fetchedAt)}` }),
    ]));
  }
  section.append(list);
  return section;
}

function renderSchedule(state) {
  const section = h('section', { id: 'schedule', 'aria-labelledby': 'schedule-title' }, [
    sectionTitle('schedule-title', '已公布日程'),
    h('p', { class: 'sub', text: '只顯示從聯儲局頁面解析到嘅 FOMC 日期。呢部分唔係新聞，亦唔係分析。' }),
  ]);
  if (state.marketStatus === 'loading') {
    section.append(h('p', { class: 'status', text: SCHEDULE_STATE_TEXT.loading }));
    return section;
  }
  if (state.marketStatus === 'error' || !state.market?.schedule) {
    section.append(banner('error', SCHEDULE_STATE_TEXT.error));
    section.append(externalLink('https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm', '打開聯儲局 FOMC 日曆'));
    return section;
  }
  const schedule = state.market.schedule;
  const view = scheduleViewState(schedule, state.now);
  const source = sourceLabel(schedule);
  section.append(banner(view.state === 'ok' ? 'info' : 'warn', SCHEDULE_STATE_TEXT[view.state] || SCHEDULE_STATE_TEXT.error));
  section.append(
    metaLine('來源', source.name),
    metaLine('快取擷取', formatHelsinkiTime(schedule.fetchedAt)),
    metaLine('官方頁面最後更新', schedule.pageLastUpdate || '—'),
    metaLine('來源連結', externalLink(source.url, 'federalreserve.gov FOMC calendar')),
  );
  if (schedule.pageNote) {
    section.append(h('blockquote', { text: schedule.pageNote }));
  }
  const meetings = Array.isArray(schedule.meetings) ? schedule.meetings : [];
  if (!meetings.length) return section;
  const today = newYorkDate(state.now);
  const upcoming = meetings.filter((meeting) => meeting.end >= today);
  const past = meetings.filter((meeting) => meeting.end < today);
  section.append(h('h3', { text: '即將或進行中' }));
  section.append(meetingList(upcoming.length ? upcoming : [], '日曆內未有未結束嘅已公布會議。'));
  const recentPast = past.slice(-4).reverse();
  section.append(h('h3', { text: '最近已結束' }));
  section.append(meetingList(recentPast, '未有已結束會議。'));
  const details = h('details', {}, [
    h('summary', { text: `全部已解析會議（${meetings.length}）` }),
    meetingList(meetings, ''),
  ]);
  section.append(details);
  section.append(h('p', { class: 'meta', text: '帶 * 嘅日期係聯儲局標明附有經濟預測摘要（Summary of Economic Projections）。notation 係頁面上嘅 notation vote，唔係議息會議。' }));
  return section;
}

function meetingList(meetings, emptyText) {
  if (!meetings.length) return h('p', { class: 'status', text: emptyText });
  const list = h('ul', { class: 'meetings' });
  for (const meeting of meetings) {
    const when = meeting.start === meeting.end ? meeting.start : `${meeting.start} 至 ${meeting.end}`;
    const flags = [
      meeting.sep ? '附經濟預測摘要' : null,
      meeting.kind === 'notation' ? 'notation vote' : 'FOMC',
    ].filter(Boolean).join(' · ');
    list.append(h('li', {}, [
      h('strong', { text: when }),
      h('span', { class: 'meta', text: ` ${meeting.year} · ${flags}` }),
    ]));
  }
  return list;
}

function renderSearch(state, handlers) {
  const section = h('section', { id: 'search', 'aria-labelledby': 'search-title' }, [
    sectionTitle('search-title', '搜尋公司'),
    h('p', { class: 'sub', text: '名單嚟自 SEC company_tickers 公開檔。好多基金代號唔喺入面。搜尋之後先顯示 SEC／CNBC 連結；快取入面搵到嘅標題會另外列出。' }),
  ]);
  const symbolsView = state.symbolsStatus === 'loading'
    ? { state: 'loading' }
    : symbolsViewState(state.symbols, state.now);
  if (state.symbolsStatus === 'error' || symbolsView.state === 'error') {
    section.append(banner('error', '代號名單未能載入。你可以仍然打開 SEC 公司搜尋。'));
    section.append(externalLink('https://www.sec.gov/edgar/search/', '打開 SEC EDGAR 搜尋'));
  } else if (symbolsView.state === 'stale') {
    section.append(banner('warn', `代號名單已過期或今次更新失敗。名單擷取時間：${formatHelsinkiTime(state.symbols?.fetchedAt)}。`));
  } else if (symbolsView.state === 'ok') {
    section.append(h('p', { class: 'meta', text: `來源：${state.symbols.source?.name || 'SEC'} · ${state.symbols.count || state.symbols.rows?.length || 0} 個代號 · 擷取：${formatHelsinkiTime(state.symbols.fetchedAt)}。SEC 唔保證準確或齊全。` }));
  } else if (state.symbolsStatus === 'loading') {
    section.append(h('p', { class: 'status', text: '載入緊 SEC 代號名單…' }));
  }
  const form = h('form', { class: 'search-form', role: 'search', onsubmit: (event) => event.preventDefault() }, [
    h('label', { for: 'symbol-query', text: '代號或公司名稱' }),
    h('input', {
      id: 'symbol-query',
      type: 'search',
      enterkeyhint: 'search',
      autocomplete: 'off',
      value: state.query || '',
      placeholder: '例如 AAPL 或 APPLE',
      oninput: (event) => handlers.search(event.target.value),
    }),
  ]);
  section.append(form);
  if (state.selected) section.append(renderSelected(state));
  if ((state.query || '').trim() && symbolsView.state !== 'error' && state.symbolsStatus !== 'loading') {
    const results = state.results || [];
    if (!results.length) {
      section.append(h('p', { class: 'status', text: `「${state.query.trim()}」喺已載入嘅 SEC 名單入面未有相符。呢個唔代表公司不存在。` }));
    } else {
      const list = h('div', { class: 'results' });
      for (const row of results) {
        const selected = state.selected?.ticker === row[0] && state.selected?.cik === row[1];
        list.append(h('button', {
          type: 'button',
          class: selected ? 'result selected' : 'result',
          onclick: () => handlers.select(row),
          text: `${row[0]} · ${row[2]}`,
        }));
      }
      section.append(list);
    }
  }
  return section;
}

function renderSelected(state) {
  const selected = state.selected;
  const wrap = h('div', { class: 'card' }, [
    h('h3', { text: `${selected.ticker} · ${selected.name}` }),
    h('p', { class: 'meta', text: `CIK ${selected.cik} · 來源：SEC company_tickers` }),
  ]);
  const links = h('div', { class: 'link-list' });
  for (const link of companyLinks([selected.ticker, selected.cik, selected.name])) {
    links.append(externalLink(link.url, link.label, 'button ghost'));
  }
  wrap.append(links);
  const matched = matchHeadlines(state.market?.news?.items || [], selected);
  wrap.append(h('h3', { text: '快取入面嘅相關標題' }));
  if (state.marketStatus !== 'ready') {
    wrap.append(h('p', { class: 'status', text: '新聞快取未就緒，所以未有標題可以核對。' }));
  } else if (!matched.length) {
    wrap.append(h('p', { class: 'status', text: '公開新聞快取入面未見呢個代號或公司名。上面嘅搜尋連結先係出去搵標題，唔係已經擷取嘅新聞。' }));
  } else {
    const list = h('div', { class: 'story-list' });
    for (const item of matched) {
      list.append(h('article', { class: 'story' }, [
        externalLink(item.link, item.title, 'story-title'),
        h('p', { class: 'meta', text: `來源：CNBC · 發布：${item.publishedAt ? formatHelsinkiTime(item.publishedAt) : '時間未能解析'} · 快取擷取：${formatHelsinkiTime(state.market.news.fetchedAt)}` }),
      ]));
    }
    wrap.append(list);
  }
  return wrap;
}

function renderConsiderations(state) {
  const symbol = state.selected
    ? { ticker: state.selected.ticker, cik: state.selected.cik, name: state.selected.name }
    : (state.query && state.symbolsStatus === 'ready' && !(state.results || []).length
      ? { ticker: state.query.trim().toUpperCase(), unlisted: true }
      : null);
  const model = buildConsiderations({
    now: state.now,
    portfolio: state.portfolio,
    portfolioLoaded: state.portfolioStatus === 'ready' || state.portfolioStatus === 'cached',
    symbol,
    schedule: state.market?.schedule,
    newsState: state.market?.news ? newsViewState(state.market.news, state.now) : { state: state.marketStatus },
  });
  const section = h('section', { id: 'considerations', 'aria-labelledby': 'consider-title' }, [
    sectionTitle('consider-title', model.title),
    h('p', { class: 'sub', text: '同新聞、已公布日程分開。未設定人工智能後端，所以呢度只係一般規則，唔係為你做嘅研究。' }),
  ]);
  const list = h('ul', { class: 'checks' });
  for (const item of model.items) {
    list.append(h('li', { class: item.tone, 'data-rule': item.id, text: item.text }));
  }
  section.append(list);
  return section;
}

function renderSettings(state, handlers) {
  const section = h('section', { id: 'settings', 'aria-labelledby': 'settings-title' }, [
    sectionTitle('settings-title', '設定'),
    h('p', { text: '網址同權杖只會喺撳儲存之後寫入呢部裝置嘅 IndexedDB（資料庫名 investment-tracker-v2）。權杖係單人共用密鑰，唔係多用戶登入。' }),
    h('p', { text: '同一個 github.io 網域上面嘅其他頁面，理論上可以讀到同源儲存。路徑唔係安全邊界。只可喺你信任嘅裝置使用。' }),
    h('p', { text: '舊版 Apps Script 網頁（doGet）冇喺呢次改動關閉。未可以話所有路線都已經上鎖。' }),
  ]);
  if (state.connection) {
    section.append(banner('info', '已儲存 script.google.com 網址。路徑同權杖唔再顯示。'));
  } else {
    section.append(banner('info', '未儲存連接。'));
  }
  const form = h('form', { class: 'settings-form', onsubmit: (event) => { event.preventDefault(); handlers.save(); } }, [
    h('label', { for: 'endpoint', text: 'Apps Script 網址' }),
    h('input', {
      id: 'endpoint',
      type: 'url',
      inputmode: 'url',
      autocomplete: 'off',
      placeholder: 'https://script.google.com/macros/s/…/exec',
      spellcheck: 'false',
      value: state.endpointDraft || '',
      oninput: (event) => { state.endpointDraft = event.target.value; },
    }),
    h('label', { for: 'token', text: '權杖' }),
    h('input', {
      id: 'token',
      type: 'password',
      autocomplete: 'off',
      spellcheck: 'false',
      value: state.tokenDraft || '',
      oninput: (event) => { state.tokenDraft = event.target.value; },
    }),
    h('div', { class: 'actions' }, [
      h('button', { type: 'submit', class: 'button', text: '儲存設定' }),
      h('button', { type: 'button', class: 'button ghost', onclick: handlers.clear, text: '清除本機連接' }),
    ]),
  ]);
  section.append(form);
  if (state.settingsMessage) section.append(h('p', { class: 'status', role: 'status', text: state.settingsMessage }));
  return section;
}

function renderFooter() {
  return h('footer', {}, [
    h('p', { text: '無下單、無電郵。Finnhub 等需要金鑰嘅報價介面未接通；金鑰不可放喺呢個公開頁面。' }),
    h('p', { text: '新聞版權屬 CNBC。日程屬美國聯邦儲備局公開頁面。代號名單屬 SEC 公開資料。' }),
  ]);
}
