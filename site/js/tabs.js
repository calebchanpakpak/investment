export const TAB_STORAGE_KEY = 'investment-v2-tab';

export const TABS = [
  { id: 'team', label: '方案', title: '團隊方案' },
  { id: 'overview', label: '總覽', title: '總覽' },
  { id: 'positions', label: '持倉', title: '持倉' },
  { id: 'trades', label: '成交', title: '成交' },
  { id: 'settings', label: '設定', title: '設定' },
];

const HASH_TO_TAB = {
  team: 'team',
  plan: 'team',
  overview: 'overview',
  portfolio: 'positions',
  futu: 'positions',
  positions: 'positions',
  holdings: 'positions',
  trades: 'trades',
  deals: 'trades',
  'futu-deals': 'trades',
  settings: 'settings',
};

const CANONICAL_HASH = {
  team: '#team',
  overview: '#overview',
  positions: '#portfolio',
  trades: '#trades',
  settings: '#settings',
};

export const SWIPE_MIN_PX = 48;
export const SWIPE_RATIO = 1.25;

export function tabById(id) {
  return TABS.find((tab) => tab.id === id) || TABS[0];
}

export function hashForTab(id) {
  return CANONICAL_HASH[id] || CANONICAL_HASH.overview;
}

export function parseRoute(hash) {
  const raw = String(hash || '').replace(/^#/, '').trim();
  if (!raw) return { tab: null, holding: null };
  const path = raw.split(/[?&]/)[0] || '';
  let decoded = path;
  try { decoded = decodeURIComponent(path); } catch { decoded = path; }
  const parts = decoded.split('/').filter(Boolean);
  const head = (parts[0] || '').trim().toLowerCase();
  const tab = HASH_TO_TAB[head] || null;
  let holding = null;
  if (tab === 'team' && parts[1] === 'h' && parts[2] != null && parts[2] !== '') holding = parts[2];
  return { tab, holding };
}

export function chooseInitialTab(hash, stored) {
  const route = parseRoute(hash);
  if (route.tab) return route.tab;
  if (stored && TABS.some((tab) => tab.id === stored)) return stored;
  return 'team';
}

export function adjacentTab(tabId, direction) {
  const index = TABS.findIndex((tab) => tab.id === tabId);
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
