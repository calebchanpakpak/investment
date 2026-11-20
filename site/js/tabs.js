export const TAB_STORAGE_KEY = 'investment-v2-tab';
export const PLAN_SECTION_KEY = 'investment-v2-plan-section';
export const PLAN_STRATEGY_KEY = 'investment-v2-plan-strategy';

export const TABS = [
  { id: 'overview', label: '總覽', title: '總覽' },
  { id: 'plan', label: '計劃', title: '團隊方案' },
  { id: 'approvals', label: '批准', title: '批准' },
  { id: 'crew', label: '團隊', title: '團隊' },
  { id: 'settings', label: '設定', title: '設定' },
];

export const PLAN_SECTIONS = [
  { id: 'overview', label: '總覽' },
  { id: 'strategy', label: '策略' },
  { id: 'allocation', label: '配置' },
  { id: 'timetable', label: '時間表' },
  { id: 'holdings', label: '持股' },
];

const DETAIL_TABS = {
  positions: { id: 'positions', label: '持倉', title: '持倉' },
  trades: { id: 'trades', label: '成交', title: '成交' },
};

const HASH_HEAD = {
  overview: 'overview',
  assets: 'overview',
  portfolio: 'positions',
  futu: 'positions',
  positions: 'positions',
  holdings: 'positions',
  trades: 'trades',
  deals: 'trades',
  'futu-deals': 'trades',
  plan: 'plan',
  team: 'plan',
  approvals: 'approvals',
  approve: 'approvals',
  crew: 'crew',
  group: 'crew',
  settings: 'settings',
};

const CANONICAL_HASH = {
  overview: '#overview',
  plan: '#plan',
  team: '#plan',
  approvals: '#approvals',
  crew: '#crew',
  settings: '#settings',
  positions: '#portfolio',
  trades: '#trades',
};

const SECTION_IDS = new Set(PLAN_SECTIONS.map((section) => section.id));

export const SWIPE_MIN_PX = 48;
export const SWIPE_RATIO = 1.25;

export function tabById(id) {
  return TABS.find((tab) => tab.id === id) || DETAIL_TABS[id] || TABS[0];
}

export function navFor(tab) {
  if (tab === 'positions' || tab === 'trades') return 'overview';
  if (tab === 'team') return 'plan';
  if (TABS.some((item) => item.id === tab)) return tab;
  return 'overview';
}

export function hashForTab(id) {
  return CANONICAL_HASH[id] || CANONICAL_HASH.overview;
}

function emptyRoute() {
  return {
    tab: null,
    nav: null,
    section: null,
    strategyId: null,
    holding: null,
    detail: null,
  };
}

export function parseRoute(hash) {
  const raw = String(hash || '').replace(/^#/, '').trim();
  if (!raw) return emptyRoute();
  const path = raw.split(/[?&]/)[0] || '';
  let decoded = path;
  try { decoded = decodeURIComponent(path); } catch { decoded = path; }
  const parts = decoded.split('/').filter(Boolean);
  const head = (parts[0] || '').trim().toLowerCase();
  const tab = HASH_HEAD[head] || null;
  if (!tab) return emptyRoute();
  const route = {
    tab,
    nav: navFor(tab),
    section: null,
    strategyId: null,
    holding: null,
    detail: null,
  };
  if (tab === 'plan') return parsePlan(route, parts);
  if (tab === 'approvals' && parts[1]) route.detail = { kind: 'approval', id: parts[1] };
  if (tab === 'crew' && parts[1] === 'r' && parts[2]) route.detail = { kind: 'report', id: parts[2] };
  if (tab === 'positions' && parts[1]) route.detail = { kind: 'position', id: parts[1] };
  if (tab === 'trades' && parts[1]) route.detail = { kind: 'deal', id: parts[1] };
  return route;
}

function parsePlan(route, parts) {
  if (parts[1] === 'h' && parts[2]) {
    route.section = 'holdings';
    route.holding = parts[2];
    route.detail = { kind: 'holding', id: parts[2] };
    return route;
  }
  const section = SECTION_IDS.has(parts[1]) ? parts[1] : null;
  route.section = section;
  if (section === 'strategy' && parts[2]) route.strategyId = parts[2];
  if (section === 'holdings' && parts[2]) {
    route.holding = parts[2];
    route.detail = { kind: 'holding', id: parts[2] };
  }
  if (section === 'timetable' && parts[2]) route.detail = { kind: 'timetable', id: parts[2] };
  if (section === 'allocation' && parts[2]) route.detail = { kind: 'allocation', id: parts[2] };
  if (section === 'overview' && parts[2] === 'a' && parts[3]) route.detail = { kind: 'action', id: parts[3] };
  return route;
}

export function chooseInitialTab(hash, stored) {
  const route = parseRoute(hash);
  if (route.tab) return route.tab;
  const legacy = stored === 'team' ? 'plan' : stored === 'market' ? '' : stored;
  if (legacy && (TABS.some((tab) => tab.id === legacy) || legacy === 'positions' || legacy === 'trades')) return legacy;
  return 'overview';
}

export function resolvePlanSection(route, storedSection, storedStrategy, strategyIds = []) {
  const ids = Array.isArray(strategyIds) ? strategyIds.filter(Boolean) : [];
  let section = route?.section && SECTION_IDS.has(route.section) ? route.section : '';
  if (!section) section = SECTION_IDS.has(storedSection) ? storedSection : 'overview';
  let strategyId = section === 'strategy' ? (route?.strategyId || '') : '';
  if (section === 'strategy' && !strategyId) {
    strategyId = ids.includes(storedStrategy) ? storedStrategy : (ids[0] || '');
  }
  return { section, strategyId };
}

export function adjacentTab(tabId, direction) {
  const id = navFor(tabId);
  const index = TABS.findIndex((tab) => tab.id === id);
  if (index < 0) return null;
  const next = index + (direction === 'next' ? 1 : -1);
  if (next < 0 || next >= TABS.length) return null;
  return TABS[next].id;
}

export function swipeIntent({ dx, dy, blocked }) {
  if (blocked) return null;
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return null;
  if (Math.abs(dx) < SWIPE_MIN_PX) return null;
  if (Math.abs(dx) < Math.abs(dy) * SWIPE_RATIO) return null;
  return dx < 0 ? 'next' : 'prev';
}

export function gestureBlocked(target) {
  let node = target;
  while (node && node.nodeType === 1) {
    const tag = node.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'TABLE' || tag === 'SVG') return true;
    if (typeof node.getAttribute === 'function' && node.getAttribute('data-hscroll') != null) return true;
    const cls = typeof node.className === 'string' ? node.className : '';
    if (cls.split(/\s+/).includes('h-scroll')) return true;
    node = node.parentNode;
  }
  return false;
}

export function bindTabSwipe(el, { onSwipe, blocked = gestureBlocked } = {}) {
  if (!el || typeof el.addEventListener !== 'function') return () => {};
  let startX = 0;
  let startY = 0;
  let tracking = false;
  let blockedGesture = false;
  const start = (event) => {
    const point = event.touches && event.touches[0];
    if (!point || (event.touches && event.touches.length !== 1)) {
      tracking = false;
      return;
    }
    startX = point.clientX;
    startY = point.clientY;
    tracking = true;
    blockedGesture = blocked(event.target);
  };
  const end = (event) => {
    if (!tracking) return;
    tracking = false;
    const point = event.changedTouches && event.changedTouches[0];
    if (!point) return;
    const direction = swipeIntent({
      dx: point.clientX - startX,
      dy: point.clientY - startY,
      blocked: blockedGesture,
    });
    if (direction) onSwipe?.(direction);
  };
  const cancel = () => { tracking = false; };
  el.addEventListener('touchstart', start, { passive: true });
  el.addEventListener('touchend', end, { passive: true });
  el.addEventListener('touchcancel', cancel, { passive: true });
  return () => {
    el.removeEventListener?.('touchstart', start);
    el.removeEventListener?.('touchend', end);
    el.removeEventListener?.('touchcancel', cancel);
  };
}
