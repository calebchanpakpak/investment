import { h, clear } from './dom.js';
import { fmtMoney, formatHelsinkiTime, toneClass, trendMark } from './format.js';
import { prepareFutu } from './futu.js';
import { convertUsdToHkd, formatHkdApprox, formatRateLine } from './fx.js';
import { errorText } from './messages.js';
import { pillModel } from './refresh.js';
import { assessFutuSync, syncBadgeLabel, syncMessage } from './sync-health.js';
import { bindTabSwipe, gestureBlocked, hashForTab, navFor, tabById, TABS } from './tabs.js';
import {
  pendingApprovalCount,
  prepareTeamPlan,
  renderApprovals,
  renderBlockingBanner,
  renderCrew,
  renderDealSheet,
  renderPlanTabs,
  renderPositionSheet,
  renderTeamPlan,
  renderTeamPlanEmpty,
} from './team-plan.js';
import { normalizeTeamResponses } from './responses.js';

function sectionTitle(id, text) {
  return h('h2', { id, class: 'sr-only', text });
}

function banner(className, text) {
  return h('p', { class: `banner ${className}`, text });
}

function signedText(value, text) {
  const mark = trendMark(value);
  return mark ? `${mark}${text}` : text;
}

function activeTab(state) {
  const tab = state.tab || 'overview';
  if (tab === 'team') return 'plan';
  return tab;
}

function planSectionOf(state) {
  if (state.planSection) return state.planSection;
  if (state.holding || state.detail?.kind === 'holding') return 'holdings';
  return 'overview';
}

export function renderApp(root, state, handlers) {
  const focusId = document.activeElement?.id || '';
  const selectionStart = document.activeElement?.selectionStart;
  const tab = activeTab(state);
  const health = state.portfolio ? assessFutuSync(state.portfolio, state.now || new Date()) : null;
  const plan = state.portfolio ? prepareTeamPlan(state.portfolio, state.now || new Date()) : null;
  clear(root);
  root.setAttribute('data-tab', tab);
  const panels = h('main', { id: 'panels' });
  panels.append(
    renderOverview(state, handlers, health, plan),
    renderPlan(state, handlers, plan),
    renderPositions(state, handlers, health),
    renderTrades(state, handlers, health),
    renderApprovalsPanel(state, handlers, plan),
    renderCrewPanel(state, handlers, plan),
    renderSettings(state, handlers),
  );
  for (const panel of panels.querySelectorAll('[data-tab]')) {
    if (panel.getAttribute('data-tab') !== tab) panel.setAttribute('hidden', '');
  }
  const updateBanner = renderUpdateBanner(state, handlers);
  const sticky = h('div', { class: 'sticky-head' }, [
    renderHeader(state, handlers, health, tab),
    tab === 'plan' ? renderPlanTabs(planSectionOf(state)) : null,
  ]);
  if (updateBanner) root.append(updateBanner);
  root.append(
    sticky,
    renderTabbar(navFor(tab), pendingApprovalCount(plan)),
    panels,
    renderFooter(),
  );
  const confirm = renderConfirm(state, handlers);
  if (confirm) root.append(confirm);
  if (state.toast) root.append(h('p', { class: 'toast', role: 'status', text: state.toast }));
  bindTabSwipe(panels, {
    onSwipe: (direction) => handlers.swipe?.(direction),
    blocked: gestureBlocked,
  });
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

function renderUpdateBanner(state, handlers) {
  if (!state.swUpdate) return null;
  return h('button', {
    type: 'button',
    class: 'update-banner',
    onclick: () => handlers.updateApp?.(),
    text: '有新版本，按此更新',
  });
}

function renderHeader(state, handlers, health, tab) {
  const info = tabById(tab);
  return h('header', { class: 'top' }, [
    h('p', { class: 'eyebrow', text: '投資紀錄' }),
    h('h1', { id: 'section-title', text: info.title }),
    h('div', { class: 'status-row' }, [
      renderPill(state, handlers),
      renderSyncBadge(health),
    ]),
    tab === 'overview' ? h('p', { class: 'sub', text: '升跌跟美國市場：綠色係升，紅色係跌。正數有 + 同 ▲，負數有 − 同 ▼。' }) : null,
  ]);
}

function renderPill(state, handlers) {
  const model = pillModel({
    phase: state.refreshPhase || (state.portfolioStatus === 'unconfigured' ? 'unconfigured' : 'idle'),
    fetchedAt: state.portfolioFetchedAt,
    errorCode: state.portfolioError || '',
    online: state.online !== false,
  });
  return h('button', {
    type: 'button',
    class: `pill ${model.phase}`,
    title: model.title,
    'aria-label': model.title,
    'data-refresh-phase': model.phase,
    onclick: () => (handlers.refresh || handlers.reload)?.(),
    text: model.text,
  });
}

function renderSyncBadge(health) {
  const label = syncBadgeLabel(health);
  if (!label) return null;
  return h('a', {
    class: 'badge warn',
    href: '#overview',
    'data-sync-badge': health.level,
    text: label,
  });
}

function renderTabbar(nav, pending) {
  return h('nav', { class: 'tabbar', 'aria-label': '章節' }, TABS.map((info) => {
    const current = nav === info.id;
    const children = [info.label];
    if (info.id === 'approvals' && pending > 0) {
      children.push(h('span', { class: 'tab-count', 'data-pending-count': String(pending), text: String(pending) }));
    }
    return h('a', {
      href: hashForTab(info.id),
      class: current ? 'tab active' : 'tab',
      'aria-current': current ? 'page' : null,
    }, children);
  }));
}

function renderConfirm(state, handlers) {
  const confirm = state.confirm;
  if (!confirm) return null;
  return h('div', { class: 'sheet-back confirm-back' }, [
    h('div', { class: 'sheet confirm-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'confirm-title' }, [
      h('h3', { id: 'confirm-title', text: confirm.title || '確定？' }),
      confirm.body ? h('p', { text: confirm.body }) : null,
      h('button', { type: 'button', class: 'button', onclick: () => handlers.confirmYes?.(), text: confirm.confirmLabel || '確定' }),
      h('button', { type: 'button', class: 'button ghost', onclick: () => handlers.confirmNo?.(), text: '取消' }),
    ]),
  ]);
}

function renderFooter() {
  return h('footer', {}, [
    h('p', { text: '無下單、無電郵。Finnhub 等需要金鑰嘅報價介面未接通；金鑰不可放喺呢個公開頁面。' }),
    h('p', { text: '持倉同帳戶數字嚟自你自己嘅富途同步。團隊方案只顯示後端傳嚟嘅 data.teamPlan。美元兌港元匯率嚟自公開、免金鑰來源。' }),
  ]);
}

function notConnected() {
  return h('div', { class: 'card' }, [
    h('h3', { text: '未連接投資組合' }),
    h('p', { text: '真實持倉只會喺你儲存自己嘅 Apps Script 網址同權杖之後先顯示。呢度唔會用範例數字充當你嘅資產。' }),
    h('a', { class: 'button', href: '#settings', text: '去設定' }),
  ]);
}

function portfolioGate(state, handlers) {
  if (state.portfolioStatus === 'unconfigured') return notConnected();
  if (state.portfolioStatus === 'loading' && !state.portfolio) return h('p', { class: 'status', text: '讀取緊你嘅試算表…' });
  if (state.portfolioStatus === 'error' && !state.portfolio) {
    return h('div', {}, [
      banner('error', errorText(state.portfolioError)),
      h('button', { type: 'button', class: 'button', onclick: handlers.reload, text: '再試一次' }),
    ]);
  }
  return null;
}

function portfolioNote(state, futu) {
  if (!state.portfolio) return null;
  if (state.portfolioStatus === 'cached') {
    return banner('warn', `今次讀取失敗（${errorText(state.portfolioError)}）。下面係上次成功讀取，時間 ${formatHelsinkiTime(state.portfolioFetchedAt)}。呢個唔係即時數字，亦唔代表試算表已經重算。`);
  }
  if (state.portfolioStatus === 'loading') return banner('info', '重新讀取緊。下面暫時仍係上次成功讀取。');
  if (state.portfolioStatus === 'ready') {
    const fetched = formatHelsinkiTime(state.portfolioFetchedAt);
    const note = futu
      ? `上次成功讀取後端：${fetched}。富途同步時間見下面，呢個唔係券商報價時間。`
      : `上次成功讀取：${fetched}。前端快取唔會加快試算表重算，亦唔係券商即時報價。`;
    return h('p', { class: 'meta', text: note });
  }
  return null;
}

function syncBanner(health) {
  if (!health || health.level === 'ok' || health.level === 'absent') return null;
  const attrs = {
    class: 'banner warn',
    role: 'status',
    'data-sync-health': health.level,
    text: syncMessage(health),
  };
  if (health.staleReason) attrs['data-futu-stale'] = health.staleReason;
  return h('p', attrs);
}

function panel(id, tab, titleId, title, children) {
  return h('section', {
    id,
    'data-tab': tab,
    'aria-labelledby': titleId,
    role: 'tabpanel',
  }, [sectionTitle(titleId, title), ...children]);
}

function renderPlanPeek(portfolio, now) {
  const plan = prepareTeamPlan(portfolio, now);
  if (!plan) {
    return h('a', { class: 'card plan-peek', href: '#plan' }, [
      h('div', { class: 'label', text: '團隊方案' }),
      h('p', { class: 'meta', text: '團隊方案未同步' }),
    ]);
  }
  return h('a', { class: 'card plan-peek', href: '#plan' }, [
    h('div', { class: 'futu-head' }, [
      h('div', { class: 'label', text: '團隊方案' }),
      h('span', { class: `badge ${plan.status.tone}`, text: plan.status.label }),
    ]),
    plan.overview?.headline ? h('p', { text: plan.overview.headline }) : null,
    plan.stale ? h('p', { class: 'meta warn-text', text: '方案已超過 3 日未更新。' }) : null,
  ]);
}

function renderJumpCards(futu, plan) {
  const pending = pendingApprovalCount(plan);
  return h('div', { class: 'link-cards' }, [
    h('a', { class: 'card plan-peek', href: '#portfolio' }, [
      h('div', { class: 'label', text: '持倉' }),
      h('p', { class: 'meta', text: futu ? `${futu.positions.length} 項實盤` : '富途未同步' }),
    ]),
    h('a', { class: 'card plan-peek', href: '#trades' }, [
      h('div', { class: 'label', text: '成交' }),
      h('p', { class: 'meta', text: futu ? `${futu.deals.length} 項成交` : '富途未同步' }),
    ]),
    h('a', { class: 'card plan-peek', href: '#approvals' }, [
      h('div', { class: 'label', text: '批准' }),
      h('p', { class: 'meta', text: pending ? `${pending} 項待回覆` : '未有待批' }),
    ]),
  ]);
}

function renderFutuMissing() {
  return h('div', { class: 'card', 'data-futu': 'missing' }, [
    h('h3', { text: '富途未同步' }),
    h('p', { text: '未有實盤持倉、帳戶總資產或成交。真實數字唔會用試算表紀錄代替。' }),
  ]);
}

function renderOverview(state, handlers, health, plan) {
  const gate = portfolioGate(state, handlers);
  const futu = state.portfolio ? prepareFutu(state.portfolio, state.now) : null;
  const body = [];
  if (gate) body.push(gate);
  else {
    body.push(portfolioNote(state, futu));
    body.push(renderBlockingBanner(plan));
    body.push(renderPlanPeek(state.portfolio, state.now));
    if (health?.level === 'absent') {
      body.push(h('p', { class: 'banner info', 'data-sync-health': 'absent', text: syncMessage(health) }));
    }
    body.push(syncBanner(health));
    if (!futu) body.push(renderFutuMissing());
    else body.push(...futuAccountBody(futu, state));
    body.push(renderJumpCards(futu, plan));
  }
  return panel('overview', 'overview', 'overview-title', '總覽', body);
}

function futuAccountBody(futu, state) {
  const nodes = [];
  if (futu.account) nodes.push(renderAccountTotal(futu.account, state));
  else {
    nodes.push(h('p', {
      class: 'banner info',
      'data-total-source': 'missing',
      text: '富途未有傳帳戶總資產（股票、基金、現金）。下面只顯示持倉市值。',
    }));
  }
  nodes.push(h('p', { class: 'meta', text: `最後同步：${futu.syncedLabel}` }));
  if (futu.kindSummary) nodes.push(h('p', { class: 'meta', text: futu.kindSummary }));
  if (futu.positions.length) nodes.push(renderFutuTotals(futu.totals, state));
  else nodes.push(h('p', { class: 'status', text: '未有實盤持倉。' }));
  return nodes;
}

function renderPositions(state, handlers, health) {
  const gate = portfolioGate(state, handlers);
  const futu = state.portfolio ? prepareFutu(state.portfolio, state.now) : null;
  const body = [
    h('a', { class: 'button ghost', href: '#overview', text: '返回總覽' }),
  ];
  if (gate) body.push(gate);
  else {
    body.push(portfolioNote(state, futu));
    body.push(syncBanner(health));
    if (!futu) body.push(renderFutuMissing());
    else {
      body.push(
        h('h3', { id: 'futu-title', text: 'Futu 實盤持倉' }),
        h('p', { class: 'meta', text: `最後同步：${futu.syncedLabel}` }),
        h('p', { class: 'sub', text: '綠升紅跌。期權市值已經係合約總值（乘數 100），唔會再乘。' }),
      );
      if (!futu.positions.length) body.push(h('p', { class: 'status', text: '未有實盤持倉。' }));
      else {
        if (futu.kindSummary) body.push(h('p', { class: 'meta', text: futu.kindSummary }));
        body.push(renderFutuTotals(futu.totals, state));
        const filter = state.filters?.positions || {};
        const kinds = [...new Set(futu.positions.map((position) => position.kind).filter(Boolean))];
        body.push(h('input', {
          id: 'search-positions',
          type: 'search',
          class: 'list-search',
          placeholder: '搜尋持倉',
          'aria-label': '搜尋持倉',
          value: filter.q || '',
          oninput: (event) => handlers.setFilter?.('positions', { q: event.target.value }),
        }));
        body.push(h('div', { class: 'chip-row', 'data-hscroll': 'true' }, [
          h('button', { type: 'button', class: filter.kind ? 'chip' : 'chip active', onclick: () => handlers.setFilter?.('positions', { kind: '' }), text: '全部' }),
          ...kinds.map((kind) => h('button', {
            type: 'button',
            class: filter.kind === kind ? 'chip active' : 'chip',
            onclick: () => handlers.setFilter?.('positions', { kind }),
            text: kind === 'stock' ? '股票' : kind === 'etf' ? 'ETF' : kind === 'option' ? '期權' : kind,
          })),
        ]));
        const needle = String(filter.q || '').trim().toLowerCase();
        const positions = futu.positions.map((position, index) => ({ ...position, index })).filter((position) => {
          if (filter.kind && position.kind !== filter.kind) return false;
          if (!needle) return true;
          return `${position.symbol} ${position.name} ${position.code}`.toLowerCase().includes(needle);
        });
        body.push(renderFutuPositionBlock({ ...futu, positions }));
        if (state.detail?.kind === 'position') body.push(renderPositionSheet(positions, state.detail));
      }
    }
  }
  return panel('portfolio', 'positions', 'portfolio-title', '持倉', body);
}

function renderTrades(state, handlers, health) {
  const gate = portfolioGate(state, handlers);
  const futu = state.portfolio ? prepareFutu(state.portfolio, state.now) : null;
  const body = [
    h('a', { class: 'button ghost', href: '#overview', text: '返回總覽' }),
  ];
  if (gate) body.push(gate);
  else {
    body.push(syncBanner(health));
    if (!futu) body.push(renderFutuMissing());
    else {
      const filter = state.filters?.deals || {};
      const needle = String(filter.q || '').trim().toLowerCase();
      const deals = futu.deals.map((deal, index) => ({ ...deal, index })).filter((deal) => {
        if (!needle) return true;
        return `${deal.symbol} ${deal.name} ${deal.code} ${deal.detailLabel}`.toLowerCase().includes(needle);
      });
      body.push(h('input', {
        id: 'search-deals',
        type: 'search',
        class: 'list-search',
        placeholder: '搜尋成交',
        'aria-label': '搜尋成交',
        value: filter.q || '',
        oninput: (event) => handlers.setFilter?.('deals', { q: event.target.value }),
      }));
      body.push(renderFutuDeals({ ...futu, deals }));
      if (state.detail?.kind === 'deal') body.push(renderDealSheet(deals, state.detail));
    }
  }
  return panel('trades', 'trades', 'trades-title', '成交', body);
}

function usdTotalBlock(label, usdText, usdAmount, state, sizeClass) {
  const nodes = [
    h('div', { class: 'label', text: label }),
    h('div', { class: `value ${sizeClass || 'sm'}`, text: usdText }),
  ];
  const status = state.fxStatus || 'missing';
  const quote = state.fxQuote;
  if ((status === 'fresh' || status === 'stale') && quote && Number(quote.rate) > 0) {
    const hkd = convertUsdToHkd(usdAmount, quote.rate);
    if (hkd != null) {
      nodes.push(h('div', { class: 'hkd-approx', text: formatHkdApprox(hkd) }));
      nodes.push(h('p', {
        class: 'meta rate-line',
        'data-fx-status': status,
        text: formatRateLine(quote, { stale: status === 'stale' }),
      }));
    }
  } else if (status === 'loading') {
    nodes.push(h('p', { class: 'meta', 'data-fx-status': 'loading', text: '載入緊港元匯率…' }));
  } else {
    nodes.push(h('p', { class: 'meta', 'data-fx-status': 'missing', text: '港元匯率未能載入，暫時只顯示美元。' }));
  }
  return h('div', { class: 'money-stack' }, nodes);
}

function moneyTotalBlock(label, amount, amountText, currency, state) {
  if (currency === 'USD') return usdTotalBlock(label, amountText, amount, state, 'lg');
  return h('div', { class: 'money-stack' }, [
    h('div', { class: 'label', text: label }),
    h('div', { class: 'value lg', text: amountText }),
  ]);
}

/** Headline 總資產 from Futu (accinfo_query via futu-sync): stocks/options + funds + cash. */
function renderAccountTotal(account, state) {
  const label = account.currency === 'USD' ? '總資產（美元）' : `總資產（${account.currency}）`;
  const rows = h('div', { class: 'asset-breakdown', 'data-account-breakdown': 'true' }, account.parts.map((part) => (
    h('div', { class: 'asset-row', 'data-part': part.key }, [
      h('span', { class: 'k', text: part.label }),
      h('span', { class: 'v', text: part.valueLabel }),
    ])
  )));
  const nodes = [
    moneyTotalBlock(label, account.totalAssets, account.totalLabel, account.currency, state),
    h('p', { class: 'meta source-line', 'data-total-source': 'futu', text: `來源：富途帳戶（總資產）· 同步：${account.syncedLabel}` }),
    rows,
  ];
  if (account.cashByCurrency.length) {
    nodes.push(h('p', { class: 'meta', text: `現金（原幣）：${account.cashByCurrency.map((c) => c.label).join(' · ')}` }));
  }
  if (account.accountsLabel) nodes.push(h('p', { class: 'meta', text: `帳戶：${account.accountsLabel}` }));
  if (!account.sameSync) {
    nodes.push(h('p', { class: 'meta warn-text', 'data-account-older': 'true', text: '今次同步讀唔到帳戶資金，總資產係上次成功讀取嘅數字。' }));
  }
  return h('div', { class: 'cards account-total' }, [h('article', { class: 'card wide', id: 'account-total' }, nodes)]);
}

function renderFutuTotals(totals, state) {
  const cards = h('div', { class: 'cards futu-totals' });
  for (const total of totals) {
    const currency = total.currency || '—';
    if (currency === 'USD') {
      cards.append(h('article', { class: 'card wide' }, [
        usdTotalBlock(`實盤市值（${currency}）`, total.marketValueLabel, total.marketValue, state, 'lg'),
      ]));
    } else {
      cards.append(h('article', { class: 'card wide' }, [
        h('div', { class: 'label', text: `實盤市值（${currency}）` }),
        h('div', { class: 'value sm', text: total.marketValueLabel }),
      ]));
    }
    cards.append(h('article', { class: 'card' }, [
      h('div', { class: 'label', text: `未實現盈虧（${currency}）` }),
      h('div', { class: `value sm ${toneClass(total.pl)}`, text: signedText(total.pl, total.plLabel) }),
    ]));
  }
  return cards;
}

function metric(label, value) {
  return h('div', { class: 'metric' }, [
    h('span', { class: 'k', text: label }),
    h('span', { class: 'v', text: value }),
  ]);
}

function renderFutuPositionBlock(view) {
  const block = h('div', { id: 'futu' });
  const list = h('div', { class: 'futu-list phone-cards' });
  for (const position of view.positions) list.append(renderFutuPosition(position));
  block.append(list, renderFutuTable(view.positions));
  return block;
}

function renderFutuPosition(position) {
  return h('article', { class: 'futu-pos', 'data-kind': position.kind, 'data-code': position.code }, [
    h('div', { class: 'futu-head' }, [
      h('span', { class: 'ticker', text: position.symbol }),
      h('span', { class: `kind ${position.kind}`, text: position.kindLabel }),
      position.sideLabel ? h('span', { class: 'kind', text: position.sideLabel }) : null,
    ]),
    h('div', { class: 'futu-name', text: position.name || '—' }),
    h('p', { class: 'meta', text: position.code || '—' }),
    h('div', { class: 'futu-metrics' }, [
      metric('數量', position.qtyLabel),
      metric('成本價', position.costLabel),
      metric('現價', position.priceLabel),
      metric('市值', position.marketValueLabel),
    ]),
    position.kind === 'option' ? h('p', { class: 'meta option-note', text: '合約乘數 100，市值已係合約總值。' }) : null,
    h('div', { class: `futu-pl ${toneClass(position.plVal)}`, text: signedText(position.plVal, position.plLabel) }),
    position.index != null ? h('a', { href: `#portfolio/${position.index}`, text: '詳情' }) : null,
  ]);
}

function renderFutuTable(positions) {
  return h('table', { class: 'data desk-only', 'data-hscroll': 'true' }, [
    h('caption', { text: '實盤持倉' }),
    h('thead', {}, [h('tr', {}, ['代號', '名稱', '種類', '數量', '成本', '現價', '市值', '盈虧'].map((text) => h('th', { text, scope: 'col' })))]),
    h('tbody', {}, positions.map((position) => h('tr', {}, [
      h('td', { text: position.symbol }),
      h('td', { text: position.name || '—' }),
      h('td', { text: position.kindLabel }),
      h('td', { text: position.qtyLabel }),
      h('td', { text: position.costLabel }),
      h('td', { text: position.priceLabel }),
      h('td', { text: position.marketValueLabel }),
      h('td', { class: toneClass(position.plVal), text: signedText(position.plVal, position.plLabel) }),
    ]))),
  ]);
}

function renderFutuDeals(view) {
  const wrap = h('div', { class: 'block', id: 'futu-deals' }, [
    h('h3', { text: 'Futu 成交（最新先）' }),
    h('p', { class: 'meta', text: '成交時間沿用券商紀錄，呢度唔會估時區。' }),
  ]);
  if (!view.deals.length) {
    wrap.append(h('p', { class: 'status', text: '未有富途成交。' }));
    return wrap;
  }
  const list = h('div', { class: 'futu-list' });
  for (const deal of view.deals) {
    list.append(h('article', { class: 'futu-deal', 'data-deal-id': deal.dealId }, [
      h('div', { class: 'futu-head' }, [
        h('span', { class: 'ticker', text: deal.symbol }),
        h('span', { class: deal.sideTone, text: deal.sideLabel }),
        h('span', { class: `kind ${deal.kind}`, text: deal.kindLabel }),
      ]),
      h('div', { class: 'futu-name', text: deal.name || '—' }),
      h('p', { class: 'meta', text: deal.detailLabel }),
      h('p', { class: 'meta', text: deal.code || '—' }),
      deal.idLabel ? h('p', { class: 'meta', text: deal.idLabel }) : null,
      deal.index != null ? h('a', { href: `#trades/${deal.index}`, text: '詳情' }) : null,
    ]));
  }
  wrap.append(list);
  return wrap;
}

function responseState(state) {
  return {
    ...state,
    serverResponses: normalizeTeamResponses(state.portfolio),
    planSection: planSectionOf(state),
  };
}

function renderPlan(state, handlers, plan) {
  const gate = portfolioGate(state, handlers);
  const body = [];
  if (gate) body.push(gate);
  else {
    const futu = state.portfolio ? prepareFutu(state.portfolio, state.now) : null;
    body.push(portfolioNote(state, futu));
    if (!plan) body.push(renderTeamPlanEmpty());
    else body.push(renderTeamPlan(plan, { state: responseState(state), handlers }));
  }
  return panel('team', 'plan', 'team-title', '團隊方案', body);
}

function renderApprovalsPanel(state, handlers, plan) {
  const gate = portfolioGate(state, handlers);
  const body = [];
  if (gate) body.push(gate);
  else body.push(renderApprovals(plan, responseState(state), handlers));
  return panel('approvals', 'approvals', 'approvals-title', '批准', body);
}

function renderCrewPanel(state, handlers, plan) {
  const gate = portfolioGate(state, handlers);
  const body = [];
  if (gate) body.push(gate);
  else if (!plan) {
    body.push(renderTeamPlanEmpty());
    body.push(renderCrew(null, responseState(state), handlers));
  } else body.push(renderCrew(plan, responseState(state), handlers));
  return panel('crew', 'crew', 'crew-title', '團隊', body);
}


function renderSettings(state, handlers) {
  const fetched = state.portfolioFetchedAt ? formatHelsinkiTime(state.portfolioFetchedAt) : '未有';
  const section = h('section', { id: 'settings', 'data-tab': 'settings', role: 'tabpanel', 'aria-labelledby': 'settings-title' }, [
    sectionTitle('settings-title', '設定'),
    h('h3', { text: '更新' }),
    h('p', { id: 'last-refresh', text: `上次更新：${fetched}` }),
    state.portfolioError ? h('p', { class: 'meta', text: errorText(state.portfolioError) }) : null,
    h('button', { type: 'button', id: 'refresh-now', class: 'button', onclick: () => (handlers.refresh || handlers.reload)?.(), text: '立即更新' }),
    h('p', { text: '網址同權杖只會喺撳儲存之後寫入呢部裝置嘅 IndexedDB（資料庫名 investment-tracker-v2）。權杖係單人共用密鑰，唔係多用戶登入。' }),
    h('p', { text: '持倉快照另外放喺 investment-v2-snapshot，唔會寫入服務工作線程快取，亦唔會同 Vault 或 Calendar 共用。' }),
    h('p', { text: '批准同回覆如果送唔出，會暫存在呢部裝置嘅 investment-v2-outbox，有網再試。' }),
    h('p', { text: '同一個 github.io 網域上面嘅其他頁面，理論上可以讀到同源儲存。路徑唔係安全邊界。只可喺你信任嘅裝置使用。' }),
    h('p', { text: '舊版 Apps Script 網頁（doGet）冇喺呢次改動關閉。未可以話所有路線都已經上鎖。' }),
  ]);
  if (state.connection) section.append(banner('info', '已儲存 script.google.com 網址。路徑同權杖唔再顯示。'));
  else section.append(banner('info', '未儲存連接。'));
  section.append(h('form', { class: 'settings-form', onsubmit: (event) => { event.preventDefault(); handlers.save(); } }, [
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
  ]));
  if (state.settingsMessage) section.append(h('p', { class: 'status', role: 'status', text: state.settingsMessage }));
  return section;
}
