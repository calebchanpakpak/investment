import { h } from './dom.js';
import { fmtMoney, fmtQty, formatHelsinkiTime, helsinkiParts } from './format.js';
import { APPROVAL_DISCLAIMER, mergeResponses, responseStatusLabel } from './responses.js';
import { PLAN_SECTIONS } from './tabs.js';

/** A plan older than this is marked stale. The adapter clock is generatedAt, not fetch time. */
export const TEAM_PLAN_STALE_MS = 3 * 24 * 60 * 60 * 1000;

const ACTION_VERBS = {
  SELL: '賣出',
  BUY: '買入',
  SELL_TO_CLOSE: '平倉賣出',
  ALERT: '留意',
  CHECK: '檢查',
};

const HOLD_ACTIONS = {
  BUY: '買入',
  HOLD: '持有',
  TRIM: '減持',
  SELL: '賣出',
  CLOSE: '平倉',
};

const TERMS = {
  long: '長線',
  short: '短線',
  legacy: '舊倉',
};

const BUCKETS = {
  core: '核心',
  satellite: '衛星',
  sleeve: '專項',
  cash: '現金',
  legacy: '舊倉',
};

const TRADE_STATUS = {
  planned: '計劃中',
  ticketed: '已出票',
  approved: '已批准',
  done: '已完成',
  cancelled: '已取消',
};

const BUCKET_ORDER = ['core', 'satellite', 'sleeve', 'cash', 'legacy'];

const APPROVAL_STATUS = {
  pending: '待回覆',
  approved: '已批准',
  rejected: '已拒絕',
};

export { APPROVAL_DISCLAIMER };

function finite(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function text(value) {
  if (value == null) return '';
  return String(value).trim();
}

function stringList(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => text(item)).filter(Boolean);
}

function asObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value;
}

export function teamPlanBlock(data) {
  const block = data?.teamPlan;
  if (!block || typeof block !== 'object' || Array.isArray(block)) return null;
  return block;
}

export function planStatusView(status) {
  const key = text(status);
  if (key === 'approved') return { key, label: '已批准', tone: 'ok' };
  if (key === 'pending_approval') return { key, label: '待批 · 未批准', tone: 'warn' };
  if (key === 'draft') return { key, label: '草稿 · 未批准', tone: 'warn' };
  if (!key) return { key: '', label: '未有狀態 · 未批准', tone: 'warn' };
  return { key, label: '未批准', tone: 'warn', raw: key };
}

export function compactMoney(value) {
  const n = finite(value);
  if (n == null) return null;
  const digits = Number.isInteger(n) ? 0 : 2;
  const sign = n < 0 ? '−' : '';
  return `${sign}$${fmtMoney(Math.abs(n), digits)}`;
}

export function fmtPctPoints(value) {
  const n = finite(value);
  if (n == null) return '—';
  const rounded = Math.round(n * 100) / 100;
  const abs = Math.abs(rounded);
  const body = Number.isInteger(abs) ? String(abs) : String(abs);
  return `${rounded < 0 ? '−' : ''}${body}%`;
}

/** Wall-clock date + time in an IANA zone, as a UTC instant. Invalid zones return null. */
export function instantFromWall(date, time, timeZone) {
  const day = text(date);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const clock = text(time) || '00:00';
  const match = clock.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const year = Number(day.slice(0, 4));
  const month = Number(day.slice(5, 7));
  const dateNum = Number(day.slice(8, 10));
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  const zone = text(timeZone) || 'Europe/Helsinki';
  try {
    const want = Date.UTC(year, month - 1, dateNum, hour, minute, 0);
    let guess = want;
    for (let pass = 0; pass < 4; pass += 1) {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: zone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
      }).formatToParts(new Date(guess));
      const pick = (type) => parts.find((part) => part.type === type)?.value || '';
      let gotHour = Number(pick('hour'));
      if (gotHour === 24) gotHour = 0;
      const got = Date.UTC(
        Number(pick('year')),
        Number(pick('month')) - 1,
        Number(pick('day')),
        gotHour,
        Number(pick('minute')),
        Number(pick('second')),
      );
      const delta = got - want;
      if (delta === 0) return new Date(guess);
      guess -= delta;
    }
    return new Date(guess);
  } catch {
    return null;
  }
}

export function tradeSentence(row) {
  const action = text(row?.action).toUpperCase();
  const verb = ACTION_VERBS[action] || (action ? action : '行動');
  const ticker = text(row?.ticker);
  let head = ticker ? `${verb} ${ticker}` : verb;
  const qty = finite(row?.qty);
  if (qty != null) head += ` ${fmtQty(qty)} 股`;
  const bits = [head];
  const limit = compactMoney(row?.limitPrice);
  if (limit) bits.push(`限價 ${limit}`);
  else {
    const range = asObject(row?.priceRange);
    const low = compactMoney(range?.low);
    const high = compactMoney(range?.high);
    if (low && high) bits.push(`區間 ${low}–${high}`);
  }
  const amount = compactMoney(row?.amountUsd);
  if (amount) bits.push(`約 ${amount}`);
  return bits.join(' · ');
}

function levelText(value, prefix) {
  if (value == null || value === '') return '';
  if (typeof value === 'number' || typeof value === 'string') {
    const money = compactMoney(value);
    return money ? `${prefix} ${money}` : '';
  }
  const obj = asObject(value);
  if (!obj) return '';
  const money = compactMoney(obj.price);
  const rule = text(obj.rule);
  if (money && rule) return `${prefix} ${money} · ${rule}`;
  if (money) return `${prefix} ${money}`;
  if (rule) return `${prefix} · ${rule}`;
  return '';
}

function moneyPair(current, target) {
  const left = compactMoney(current) || '—';
  const right = compactMoney(target) || '—';
  return `${left} → ${right}`;
}

function normalizeOverview(raw, summary) {
  const overview = asObject(raw);
  const headline = text(overview?.headline);
  const bullets = stringList(overview?.bullets);
  const extra = stringList(summary);
  if (!headline && !bullets.length && !extra.length) return null;
  return {
    headline,
    bullets: bullets.length ? bullets : extra,
    notes: bullets.length ? extra : [],
  };
}

function normalizeActions(raw) {
  if (!Array.isArray(raw)) return [];
  const rows = raw.filter((item) => item && typeof item === 'object' && !Array.isArray(item)).map((item) => {
    const priority = text(item.priority).toLowerCase() === 'urgent' ? 'urgent' : 'normal';
    const status = text(item.status);
    return {
      id: text(item.id),
      due: text(item.due),
      priority,
      text: text(item.text),
      ticketId: text(item.ticketId),
      amountUsd: finite(item.amountUsd),
      price: finite(item.price),
      status,
      needsApproval: status === 'pending_approval',
    };
  });
  rows.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority === 'urgent' ? -1 : 1;
    const aDue = Date.parse(a.due);
    const bDue = Date.parse(b.due);
    const aKey = Number.isFinite(aDue) ? aDue : Number.MAX_SAFE_INTEGER;
    const bKey = Number.isFinite(bDue) ? bDue : Number.MAX_SAFE_INTEGER;
    return aKey - bKey;
  });
  rows.forEach((row, index) => { row.index = index; });
  return rows;
}

function normalizeStrategyHoldings(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.filter((item) => item && typeof item === 'object').map((item) => ({
    ticker: text(item.ticker),
    targetPct: finite(item.targetPct),
    targetUsd: finite(item.targetUsd),
    currentUsd: finite(item.currentUsd),
    note: text(item.note),
  }));
}

function normalizeExpected(raw) {
  const expected = asObject(raw);
  if (!expected) return null;
  const view = {
    bearPct: finite(expected.bearPct),
    basePct: finite(expected.basePct),
    bullPct: finite(expected.bullPct),
    horizon: text(expected.horizon),
    expectedProfitUsd: finite(expected.expectedProfitUsd),
    assumptions: text(expected.assumptions),
  };
  const any = view.bearPct != null || view.basePct != null || view.bullPct != null
    || view.horizon || view.expectedProfitUsd != null || view.assumptions;
  return any ? view : null;
}

function normalizeStrategies(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.filter((item) => item && typeof item === 'object').map((item, index) => ({
    id: text(item.id) || text(item.name) || `s${index}`,
    name: text(item.name) || '未命名策略',
    owner: text(item.owner),
    horizon: text(item.horizon),
    summary: text(item.summary),
    targetPct: finite(item.targetPct),
    targetUsd: finite(item.targetUsd),
    currentPct: finite(item.currentPct),
    currentUsd: finite(item.currentUsd),
    rules: stringList(item.rules),
    holdings: normalizeStrategyHoldings(item.holdings),
    expected: normalizeExpected(item.expected),
  }));
}

function normalizeAllocation(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.filter((item) => item && typeof item === 'object').map((item, index) => ({
    index,
    ticker: text(item.ticker) || '—',
    name: text(item.name),
    bucket: text(item.bucket).toLowerCase(),
    bucketLabel: BUCKETS[text(item.bucket).toLowerCase()] || text(item.bucket) || '其他',
    currentUsd: finite(item.currentUsd),
    currentPct: finite(item.currentPct),
    targetUsd: finite(item.targetUsd),
    targetPct: finite(item.targetPct),
  }));
}

function rollupBuckets(rows, nav) {
  const map = new Map();
  for (const row of rows) {
    const key = row.bucket || 'other';
    const current = map.get(key) || {
      bucket: key,
      label: BUCKETS[key] || row.bucketLabel || '其他',
      currentUsd: 0,
      targetUsd: 0,
      currentKnown: false,
      targetKnown: false,
    };
    if (row.currentUsd != null) {
      current.currentUsd += row.currentUsd;
      current.currentKnown = true;
    }
    if (row.targetUsd != null) {
      current.targetUsd += row.targetUsd;
      current.targetKnown = true;
    }
    map.set(key, current);
  }
  const keys = [
    ...BUCKET_ORDER.filter((key) => map.has(key)),
    ...[...map.keys()].filter((key) => !BUCKET_ORDER.includes(key)),
  ];
  return keys.map((key) => {
    const row = map.get(key);
    const currentPct = nav > 0 && row.currentKnown ? (row.currentUsd / nav) * 100 : null;
    const targetPct = nav > 0 && row.targetKnown ? (row.targetUsd / nav) * 100 : null;
    return { ...row, currentPct, targetPct };
  });
}

function normalizeHoldings(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.filter((item) => item && typeof item === 'object').map((item, index) => {
    const action = text(item.action).toUpperCase();
    const term = text(item.term).toLowerCase();
    const currentUsd = finite(item.currentUsd);
    const thesis = asObject(item.thesis);
    const targets = Array.isArray(item.targets)
      ? item.targets.filter((target) => target && typeof target === 'object').map((target) => ({
        label: text(target.label),
        price: finite(target.price),
      }))
      : [];
    return {
      index,
      id: text(item.id),
      ticketId: text(item.ticketId),
      ticker: text(item.ticker) || '—',
      name: text(item.name),
      term,
      termLabel: TERMS[term] || (term ? term : ''),
      bucket: text(item.bucket).toLowerCase(),
      bucketLabel: BUCKETS[text(item.bucket).toLowerCase()] || text(item.bucket),
      action,
      actionLabel: HOLD_ACTIONS[action] || action,
      planned: action === 'BUY' && !(currentUsd > 0),
      timeframe: text(item.timeframe),
      qty: finite(item.qty),
      price: finite(item.price),
      costPrice: finite(item.costPrice),
      currentUsd,
      thesis: {
        whyBuy: text(thesis?.whyBuy),
        whyHold: text(thesis?.whyHold),
        whySell: text(thesis?.whySell),
        risks: stringList(thesis?.risks),
      },
      stopLoss: levelText(item.stopLoss, '止蝕'),
      takeProfit: levelText(item.takeProfit, '止賺'),
      targets,
      expectedReturnPct: {
        bear: finite(asObject(item.expectedReturnPct)?.bear),
        base: finite(asObject(item.expectedReturnPct)?.base),
        bull: finite(asObject(item.expectedReturnPct)?.bull),
      },
      owner: text(item.owner),
      sources: stringList(item.sources),
      updatedAt: text(item.updatedAt),
      updatedLabel: formatHelsinkiTime(text(item.updatedAt)),
    };
  });
}

function normalizeTimetable(raw, now) {
  if (!Array.isArray(raw) || !raw.length) {
    return { groups: [], empty: true };
  }
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(now);
  const items = raw.filter((item) => item && typeof item === 'object').map((item) => {
    const instant = instantFromWall(item.date, item.time, item.tz);
    const status = text(item.status).toLowerCase();
    const closed = status === 'done' || status === 'cancelled';
    const past = closed || (instant != null && Number.isFinite(nowMs) && instant.getTime() < nowMs);
    return {
      id: text(item.id),
      instant,
      sortKey: instant ? instant.getTime() : Number.MAX_SAFE_INTEGER,
      dateKey: instant ? `${helsinkiParts(instant).year}-${helsinkiParts(instant).month}-${helsinkiParts(instant).day}` : (text(item.date) || '日期未定'),
      helsinkiLabel: instant ? formatHelsinkiTime(instant.toISOString()) : [text(item.date), text(item.time), text(item.tz)].filter(Boolean).join(' ') || '—',
      sentence: tradeSentence(item),
      past,
      status,
      statusLabel: TRADE_STATUS[status] || (status ? status : ''),
      condition: text(item.condition),
      stopText: levelText(item.stopLoss, '止蝕'),
      takeText: levelText(item.takeProfit, '止賺'),
      notes: text(item.notes),
      ticketId: text(item.ticketId),
      strategy: text(item.strategy),
      ticker: text(item.ticker),
    };
  });
  items.sort((a, b) => a.sortKey - b.sortKey || a.sentence.localeCompare(b.sentence));
  items.forEach((item, index) => { item.index = index; });
  const next = items.find((item) => !item.past);
  if (next) next.next = true;
  const groups = [];
  for (const item of items) {
    const label = item.instant ? `${item.dateKey}（赫爾辛基）` : item.dateKey;
    let group = groups.find((entry) => entry.key === item.dateKey);
    if (!group) {
      group = { key: item.dateKey, label, items: [] };
      groups.push(group);
    }
    group.items.push(item);
  }
  return { groups, empty: items.length === 0 };
}

function normalizeReports(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.filter((item) => item && typeof item === 'object').map((item, index) => ({
    index,
    member: text(item.member) || '未署名',
    role: text(item.role),
    week: text(item.week),
    title: text(item.title),
    bullets: stringList(item.bullets),
    updatedAt: text(item.updatedAt),
    updatedLabel: formatHelsinkiTime(text(item.updatedAt)),
  }));
}

function normalizeApprovals(raw) {
  if (!Array.isArray(raw)) return [];
  const rows = raw.filter((item) => item && typeof item === 'object' && !Array.isArray(item)).map((item) => {
    const status = text(item.status);
    return {
      id: text(item.id) || text(item.ticketId),
      title: text(item.title) || '未命名項目',
      detail: text(item.detail),
      requestedBy: text(item.requestedBy),
      due: text(item.due),
      ticketId: text(item.ticketId),
      amountUsd: finite(item.amountUsd),
      status,
      statusLabel: APPROVAL_STATUS[status] || (status ? status : '未有狀態'),
      decidedAt: text(item.decidedAt),
      decidedLabel: text(item.decidedAt) ? formatHelsinkiTime(text(item.decidedAt)) : '',
      note: text(item.note),
      blocking: item.blocking === true,
      blocks: Array.isArray(item.blocks) ? item.blocks.map((entry) => text(entry)).filter(Boolean) : [],
    };
  }).filter((item) => item.id || item.title);
  const rank = (row) => (row.status === 'pending' && row.blocking ? 0 : row.status === 'pending' ? 1 : 2);
  rows.sort((a, b) => rank(a) - rank(b) || String(a.due).localeCompare(String(b.due)));
  return rows;
}

export function pendingApprovalCount(plan) {
  return (plan?.approvals || []).filter((item) => item.status === 'pending').length;
}

export function blockingPending(plan) {
  return (plan?.approvals || []).filter((item) => item.status === 'pending' && item.blocking);
}

export function blockingIndex(approvals) {
  const map = new Map();
  for (const item of approvals || []) {
    if (item.status !== 'pending' || item.blocking !== true) continue;
    for (const key of item.blocks || []) {
      if (key && !map.has(key)) map.set(key, item);
    }
  }
  return map;
}

export function blockFor(index, row) {
  if (!index || !row) return null;
  if (row.id && index.has(row.id)) return index.get(row.id);
  if (row.ticketId && index.has(row.ticketId)) return index.get(row.ticketId);
  return null;
}

function normalizeTeam(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.filter((item) => item && typeof item === 'object').map((item) => ({
    name: text(item.name) || '—',
    role: text(item.role),
    latest: text(item.latest),
    updatedAt: text(item.updatedAt),
    updatedLabel: formatHelsinkiTime(text(item.updatedAt)),
  }));
}

export function prepareTeamPlan(data, now = new Date()) {
  const raw = teamPlanBlock(data);
  if (!raw) return null;
  const generatedAt = text(raw.generatedAt);
  const generatedMs = Date.parse(generatedAt);
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(now);
  const stale = Number.isFinite(generatedMs) && Number.isFinite(nowMs)
    ? nowMs - generatedMs > TEAM_PLAN_STALE_MS
    : false;
  const nav = finite(raw.nav);
  const allocation = normalizeAllocation(raw.allocation);
  const status = planStatusView(raw.status);
  return {
    generatedAt,
    generatedLabel: generatedAt ? formatHelsinkiTime(generatedAt) : '',
    generatedKnown: Number.isFinite(generatedMs),
    stale,
    planVersion: text(raw.planVersion),
    status,
    nav,
    currency: text(raw.currency) || 'USD',
    overview: normalizeOverview(raw.overview, raw.summary),
    actions: normalizeActions(raw.actionsForYou),
    approvals: normalizeApprovals(raw.approvals),
    strategies: normalizeStrategies(raw.strategies),
    allocation,
    buckets: rollupBuckets(allocation, nav),
    timetable: normalizeTimetable(raw.timetable, now),
    holdings: normalizeHoldings(raw.holdings),
    weeklyReports: normalizeReports(raw.weeklyReports),
    team: normalizeTeam(raw.team),
    risks: stringList(raw.risks),
    openQuestions: stringList(raw.openQuestions),
  };
}

function barWidth(value) {
  const n = finite(value);
  if (n == null || n <= 0) return 0;
  return Math.min(100, n);
}

function compareBars(currentPct, targetPct, currentLabel, targetLabel) {
  return h('div', { class: 'cmp' }, [
    h('div', { class: 'cmp-line' }, [
      h('span', { class: 'k', text: '而家' }),
      h('div', { class: 'bar-track' }, [
        h('div', { class: 'bar-fill current', style: `width:${barWidth(currentPct).toFixed(1)}%` }),
      ]),
      h('span', { class: 'amt', text: currentLabel }),
    ]),
    h('div', { class: 'cmp-line' }, [
      h('span', { class: 'k', text: '目標' }),
      h('div', { class: 'bar-track' }, [
        h('div', { class: 'bar-fill target', style: `width:${barWidth(targetPct).toFixed(1)}%` }),
      ]),
      h('span', { class: 'amt', text: targetLabel }),
    ]),
  ]);
}

function filtersOf(state, key) {
  return state?.filters?.[key] || {};
}

function queryMatch(q, parts) {
  const needle = text(q).toLowerCase();
  if (!needle) return true;
  return parts.filter((part) => part != null && part !== false).join('\n').toLowerCase().includes(needle);
}

function chipBar(chips, current, onPick) {
  return h('div', { class: 'chip-row', 'data-hscroll': 'true' }, chips.map((chip) => h('button', {
    type: 'button',
    class: chip.value === current ? 'chip active' : 'chip',
    'aria-pressed': chip.value === current ? 'true' : 'false',
    onclick: () => onPick(chip.value),
    text: chip.label,
  })));
}

function searchField(id, value, label, onInput) {
  return h('input', {
    id,
    type: 'search',
    class: 'list-search',
    placeholder: label,
    'aria-label': label,
    value: value || '',
    oninput: (event) => onInput(event.target.value),
  });
}

function blockedMark(approval) {
  if (!approval?.id) return null;
  return h('a', {
    class: 'badge warn',
    href: `#approvals/${encodeURIComponent(approval.id)}`,
    'data-blocked-by': approval.id,
    text: '等你回覆',
  });
}

export function renderBlockingBanner(plan) {
  const count = blockingPending(plan).length;
  if (!count) return null;
  return h('a', {
    class: 'banner warn',
    href: '#approvals',
    'data-blocking-banner': String(count),
    text: `有 ${count} 項要你回覆團隊先可以繼續`,
  });
}

export function renderPlanTabs(section) {
  return h('nav', { class: 'plan-tabs', 'aria-label': '方案章節', 'data-hscroll': 'true' }, PLAN_SECTIONS.map((info) => {
    const on = section === info.id;
    const href = info.id === 'overview' ? '#plan/overview' : `#plan/${info.id}`;
    return h('a', {
      href,
      class: on ? 'chip active' : 'chip',
      'aria-current': on ? 'page' : null,
      text: info.label,
    });
  }));
}

function sheetFrame({ id, title, closeHref, index, total, prevHref, nextHref, className }, children) {
  return h('div', { class: 'sheet-back', 'data-sheet': id }, [
    h('a', { class: 'sheet-dismiss', href: closeHref, 'aria-label': '關閉' }),
    h('div', {
      class: `sheet${className ? ` ${className}` : ''}`,
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': `${id}-title`,
    }, [
      h('div', { class: 'sheet-nav' }, [
        prevHref
          ? h('a', { class: 'button ghost', href: prevHref, text: '上一項' })
          : h('span', { class: 'button ghost is-disabled', text: '上一項' }),
        h('span', { class: 'meta', text: total ? `${index + 1} / ${total}` : '' }),
        nextHref
          ? h('a', { class: 'button ghost', href: nextHref, text: '下一項' })
          : h('span', { class: 'button ghost is-disabled', text: '下一項' }),
      ]),
      h('h3', { id: `${id}-title`, text: title }),
      ...children,
      h('a', { class: 'button ghost', href: closeHref, text: '關閉' }),
    ]),
  ]);
}

function locate(list, id, idOf) {
  const key = String(id);
  const index = list.findIndex((item) => String(idOf(item)) === key);
  if (index < 0) return { item: null, index: -1, prev: null, next: null };
  return {
    item: list[index],
    index,
    prev: index > 0 ? list[index - 1] : null,
    next: index < list.length - 1 ? list[index + 1] : null,
  };
}

function metric(label, value) {
  return h('div', { class: 'metric' }, [
    h('span', { class: 'k', text: label }),
    h('span', { class: 'v', text: value }),
  ]);
}

function mergedFor(state, plan) {
  const server = state?.serverResponses || [];
  return mergeResponses(state?.outbox || [], server);
}

function responseLine(item) {
  if (!item) return null;
  const label = responseStatusLabel(item);
  return h('p', {
    class: 'meta',
    'data-response-status': item.localStatus || 'sent',
    text: label,
  });
}

function renderHeader(plan) {
  const nav = plan.nav == null ? '—' : `${compactMoney(plan.nav) || '—'}${plan.currency && plan.currency !== 'USD' ? ` ${plan.currency}` : ''}`;
  const header = h('section', { class: 'plan-meta', 'data-plan-status': plan.status.key || 'unknown' }, [
    h('div', { class: 'futu-head' }, [
      h('span', { class: 'meta', text: plan.planVersion ? `版本 ${plan.planVersion}` : '未有版本' }),
      h('span', { class: `badge ${plan.status.tone}`, 'data-status-badge': plan.status.key || 'unknown', text: plan.status.label }),
    ]),
    h('p', { class: 'meta', text: plan.generatedKnown ? `產生：${plan.generatedLabel}` : '未有產生時間，所以未能判斷係咪過期。' }),
    h('p', { class: 'meta', text: `參考資產 ${nav}` }),
  ]);
  if (plan.status.raw) header.append(h('p', { class: 'meta', text: `狀態碼：${plan.status.raw}` }));
  if (plan.stale) {
    header.append(h('p', {
      class: 'banner warn',
      'data-plan-stale': 'true',
      text: '呢份方案已超過 3 日未更新。數字同時間表可能已經過時。',
    }));
  }
  if (plan.status.key !== 'approved') {
    header.append(h('p', { class: 'meta', text: '未寫明已批准之前，呢份方案只係草稿，唔好當已經拍板。' }));
  }
  return header;
}

function actionHref(action) {
  return `#plan/overview/a/${action.index}`;
}

function visibleActions(plan, state) {
  const filter = filtersOf(state, 'actions');
  return plan.actions.filter((action) => {
    if (filter.priority && action.priority !== filter.priority) return false;
    return queryMatch(filter.q, [action.text, action.ticketId, action.due]);
  });
}

function renderActions(plan, state, handlers) {
  const blocks = blockingIndex(plan.approvals);
  const filter = filtersOf(state, 'actions');
  const rows = visibleActions(plan, state);
  const card = h('section', { class: 'card actions-for-you', 'aria-label': '你要做嘅嘢' }, [
    h('h3', { text: '你要做嘅嘢' }),
    searchField('search-actions', filter.q, '搜尋要做嘅嘢', (q) => handlers.setFilter?.('actions', { q })),
    chipBar([
      { value: '', label: '全部' },
      { value: 'urgent', label: '急' },
      { value: 'normal', label: '一般' },
    ], filter.priority || '', (priority) => handlers.setFilter?.('actions', { priority })),
  ]);
  if (!plan.actions.length) {
    card.append(h('p', { class: 'status', text: '暫時未有要你做嘅嘢。' }));
    return card;
  }
  if (!rows.length) {
    card.append(h('p', { class: 'status', text: '冇符合篩選嘅項目。' }));
    return card;
  }
  const list = h('div', { class: 'action-list' });
  for (const action of rows) {
    const blocked = blockFor(blocks, action);
    list.append(h('a', {
      class: action.priority === 'urgent' ? 'card row-link action-item urgent' : 'card row-link action-item',
      href: actionHref(action),
      'data-priority': action.priority,
      'data-action-status': action.status || '',
    }, [
      h('div', { class: 'futu-head' }, [
        h('span', { class: action.priority === 'urgent' ? 'badge urgent' : 'badge', text: action.priority === 'urgent' ? '急' : '一般' }),
        action.needsApproval ? h('span', { class: 'badge warn', 'data-needs-approval': 'true', text: '等你批准' }) : null,
        blockedMark(blocked),
      ]),
      h('p', { class: 'action-text', text: action.text || '（未有說明）' }),
    ]));
  }
  card.append(list);
  return card;
}

function renderActionSheet(plan, state, rows) {
  const found = locate(rows, state.detail.id, (item) => item.index);
  const blocks = blockingIndex(plan.approvals);
  if (!found.item) {
    return sheetFrame({
      id: 'action-sheet',
      title: '要做嘅嘢',
      closeHref: '#plan/overview',
      index: 0,
      total: 0,
    }, [h('p', { class: 'status', text: '搵唔到呢項。' })]);
  }
  const action = found.item;
  const blocked = blockFor(blocks, action);
  const bits = [];
  if (action.due) bits.push(action.due);
  if (action.price != null) bits.push(`價 ${compactMoney(action.price)}`);
  if (action.amountUsd != null) bits.push(`約 ${compactMoney(action.amountUsd)}`);
  if (action.ticketId) bits.push(action.ticketId);
  return sheetFrame({
    id: 'action-sheet',
    title: action.text || '要做嘅嘢',
    closeHref: '#plan/overview',
    index: found.index,
    total: rows.length,
    prevHref: found.prev ? actionHref(found.prev) : '',
    nextHref: found.next ? actionHref(found.next) : '',
  }, [
    h('p', { class: 'meta', text: bits.join(' · ') || '未有補充' }),
    blockedMark(blocked),
  ]);
}

function renderOverviewBlock(overview) {
  if (!overview) return null;
  const section = h('section', { class: 'block', id: 'plan-overview' }, [
    h('h3', { text: '策略總覽' }),
  ]);
  if (overview.headline) section.append(h('p', { class: 'plan-headline', text: overview.headline }));
  if (overview.bullets.length) {
    const list = h('ul', { class: 'checks' });
    for (const bullet of overview.bullets) list.append(h('li', { text: bullet }));
    section.append(list);
  }
  if (overview.notes.length) {
    section.append(h('p', { class: 'meta', text: '重點' }));
    const list = h('ul', { class: 'checks' });
    for (const note of overview.notes) list.append(h('li', { text: note }));
    section.append(list);
  }
  return section;
}

function renderStringList(title, items, id) {
  if (!items.length) return null;
  const list = h('ul', { class: 'checks' });
  for (const item of items) list.append(h('li', { text: item }));
  return h('section', { class: 'block', id }, [
    h('h3', { text: title }),
    list,
  ]);
}

function strategyMatches(item, strategy) {
  const key = text(item?.strategy).toLowerCase();
  if (!key) return false;
  return key === text(strategy.id).toLowerCase() || key === text(strategy.name).toLowerCase();
}

function holdingsForStrategy(plan, strategy) {
  const tickers = new Set(strategy.holdings.map((holding) => holding.ticker).filter(Boolean));
  return plan.holdings.filter((holding) => (strategy.id && holding.bucket === strategy.id) || tickers.has(holding.ticker));
}

function renderStrategyCard(plan, strategy, blocks) {
  const card = h('article', {
    class: 'card strategy-card',
    'data-strategy': strategy.id || strategy.name,
    'data-strategy-panel': strategy.id || strategy.name,
  }, [
    h('h3', { text: strategy.name }),
    h('p', { class: 'meta', text: [strategy.owner ? `負責人 ${strategy.owner}` : '', strategy.horizon ? `期限 ${strategy.horizon}` : ''].filter(Boolean).join(' · ') || '未有負責人或期限' }),
  ]);
  if (strategy.summary) card.append(h('p', { text: strategy.summary }));
  card.append(h('p', { class: 'meta', text: `而家 ${fmtPctPoints(strategy.currentPct)}（${compactMoney(strategy.currentUsd) || '—'}）→ 目標 ${fmtPctPoints(strategy.targetPct)}（${compactMoney(strategy.targetUsd) || '—'}）` }));
  card.append(compareBars(strategy.currentPct, strategy.targetPct, fmtPctPoints(strategy.currentPct), fmtPctPoints(strategy.targetPct)));
  if (strategy.expected) {
    const expected = strategy.expected;
    const profit = compactMoney(expected.expectedProfitUsd);
    card.append(h('p', { class: 'expect', text: `預期利潤 ${profit || '—'} · 熊 ${fmtPctPoints(expected.bearPct)} · 基本 ${fmtPctPoints(expected.basePct)} · 牛 ${fmtPctPoints(expected.bullPct)}${expected.horizon ? ` · ${expected.horizon}` : ''}` }));
    if (expected.assumptions) card.append(h('p', { class: 'meta', text: `假設：${expected.assumptions}` }));
  }
  if (strategy.rules.length) {
    const rules = h('ul', { class: 'checks' });
    for (const rule of strategy.rules) rules.append(h('li', { text: rule }));
    card.append(h('p', { class: 'meta', text: '規則' }), rules);
  }
  const alloc = plan.allocation.filter((row) => row.bucket === strategy.id);
  if (alloc.length) {
    card.append(h('p', { class: 'meta', text: '配置' }));
    for (const row of alloc) {
      card.append(h('p', { 'data-alloc': row.ticker, text: `${row.ticker} · ${row.name || row.bucketLabel} · ${moneyPair(row.currentUsd, row.targetUsd)}` }));
    }
  }
  if (strategy.holdings.length) {
    const holdings = h('ul', { class: 'mini-holdings' });
    for (const holding of strategy.holdings) {
      holdings.append(h('li', { text: `${holding.ticker || '—'} · 目標 ${fmtPctPoints(holding.targetPct)}（${compactMoney(holding.targetUsd) || '—'}）· 而家 ${compactMoney(holding.currentUsd) || '—'}${holding.note ? ` · ${holding.note}` : ''}` }));
    }
    card.append(holdings);
  }
  const timetable = [];
  for (const group of plan.timetable.groups) {
    for (const item of group.items) {
      if (strategyMatches(item, strategy)) timetable.push(item);
    }
  }
  if (timetable.length) {
    card.append(h('p', { class: 'meta', text: '時間表' }));
    for (const item of timetable) {
      const blocked = blockFor(blocks, item);
      card.append(h('a', {
        class: `tt-item${item.past ? ' past' : ''}${item.next ? ' next' : ''}`,
        href: `#plan/timetable/${item.index}`,
        'data-past': item.past ? 'true' : 'false',
        'data-next': item.next ? 'true' : 'false',
        'data-ticker': item.ticker,
      }, [
        h('p', { class: 'meta', text: item.helsinkiLabel }),
        h('p', { class: 'trade-line', text: item.sentence }),
        blockedMark(blocked),
      ]));
    }
  }
  const linked = holdingsForStrategy(plan, strategy);
  if (linked.length) {
    card.append(h('p', { class: 'meta', text: '相關持股' }));
    for (const holding of linked) {
      card.append(holdingRow(holding, blockFor(blocks, holding)));
    }
  }
  return card;
}

function renderStrategies(plan, state) {
  const section = h('section', { class: 'block', id: 'plan-strategies' }, [
    h('h3', { text: '策略' }),
  ]);
  if (!plan.strategies.length) {
    section.append(h('p', { class: 'status', text: '未有策略。' }));
    return section;
  }
  const chips = h('div', { class: 'chip-row', 'data-hscroll': 'true' });
  for (const strategy of plan.strategies) {
    const on = strategy.id === (state.strategyId || plan.strategies[0].id);
    chips.append(h('a', {
      class: on ? 'chip active' : 'chip',
      href: `#plan/strategy/${encodeURIComponent(strategy.id)}`,
      'aria-current': on ? 'page' : null,
      text: strategy.name,
    }));
  }
  section.append(chips);
  const wanted = state.strategyId;
  const strategy = plan.strategies.find((item) => item.id === wanted) || (wanted ? null : plan.strategies[0]);
  if (!strategy) {
    section.append(h('p', { class: 'status', text: '搵唔到呢個策略。' }));
    return section;
  }
  section.append(renderStrategyCard(plan, strategy, blockingIndex(plan.approvals)));
  return section;
}

function visibleAllocation(plan, state) {
  const filter = filtersOf(state, 'allocation');
  return plan.allocation.filter((row) => {
    if (filter.bucket && row.bucket !== filter.bucket) return false;
    return queryMatch(filter.q, [row.ticker, row.name, row.bucketLabel]);
  });
}

function renderAllocation(plan, state) {
  const filter = filtersOf(state, 'allocation');
  const section = h('section', { class: 'block', id: 'plan-allocation' }, [
    h('h3', { text: '配置' }),
    h('p', { class: 'meta', text: '條條係佔資產百分比。上面係而家，下面係目標。' }),
    searchField('search-allocation', filter.q, '搜尋代號', (q) => stateHandlers(state).setFilter?.('allocation', { q })),
  ]);
  const buckets = [{ value: '', label: '全部' }, ...plan.buckets.map((bucket) => ({ value: bucket.bucket, label: bucket.label }))];
  section.append(chipBar(buckets, filter.bucket || '', (bucket) => stateHandlers(state).setFilter?.('allocation', { bucket })));
  if (!plan.allocation.length) {
    section.append(h('p', { class: 'status', text: '未有配置。' }));
    return section;
  }
  if (plan.buckets.length && !filter.bucket && !filter.q) {
    section.append(h('h3', { class: 'subhead', text: '按桶' }));
    const rollup = h('div', { class: 'bars' });
    for (const bucket of plan.buckets) {
      rollup.append(h('div', { class: 'card bucket-card', 'data-bucket': bucket.bucket }, [
        h('div', { class: 'futu-name', text: bucket.label }),
        h('p', { class: 'meta', text: moneyPair(bucket.currentKnown ? bucket.currentUsd : null, bucket.targetKnown ? bucket.targetUsd : null) }),
        compareBars(bucket.currentPct, bucket.targetPct, fmtPctPoints(bucket.currentPct), fmtPctPoints(bucket.targetPct)),
      ]));
    }
    section.append(rollup);
  }
  section.append(h('h3', { class: 'subhead', text: '按持倉' }));
  const rows = visibleAllocation(plan, state);
  if (!rows.length) {
    section.append(h('p', { class: 'status', text: '冇符合篩選嘅配置。' }));
    return section;
  }
  const list = h('div', { class: 'bars' });
  for (const row of rows) {
    list.append(h('a', {
      class: 'card row-link',
      href: `#plan/allocation/${row.index}`,
      'data-alloc': row.ticker,
    }, [
      h('div', { class: 'futu-head' }, [
        h('span', { class: 'ticker', text: row.ticker }),
        h('span', { class: 'kind', text: row.bucketLabel }),
      ]),
      row.name ? h('div', { class: 'futu-name', text: row.name }) : null,
      h('p', { class: 'meta', text: moneyPair(row.currentUsd, row.targetUsd) }),
    ]));
  }
  section.append(list);
  return section;
}

function stateHandlers(state) {
  return state?.handlers || {};
}

function renderAllocationSheet(plan, rows, detail) {
  const found = locate(rows, detail.id, (item) => item.index);
  if (!found.item) {
    return sheetFrame({ id: 'alloc-sheet', title: '配置', closeHref: '#plan/allocation', index: 0, total: 0 }, [
      h('p', { class: 'status', text: '搵唔到呢項配置。' }),
    ]);
  }
  const row = found.item;
  const href = (item) => `#plan/allocation/${item.index}`;
  return sheetFrame({
    id: 'alloc-sheet',
    title: row.ticker,
    closeHref: '#plan/allocation',
    index: found.index,
    total: rows.length,
    prevHref: found.prev ? href(found.prev) : '',
    nextHref: found.next ? href(found.next) : '',
  }, [
    row.name ? h('p', { text: row.name }) : null,
    h('p', { class: 'meta', text: row.bucketLabel }),
    h('p', { class: 'meta', text: moneyPair(row.currentUsd, row.targetUsd) }),
    compareBars(row.currentPct, row.targetPct, fmtPctPoints(row.currentPct), fmtPctPoints(row.targetPct)),
  ]);
}

function holdingHref(holding) {
  return `#plan/holdings/${holding.index}`;
}

function holdingRow(holding, blocked) {
  const bits = [];
  if (holding.price != null) bits.push(`現價 ${compactMoney(holding.price)}`);
  if (holding.currentUsd != null) bits.push(`市值 ${compactMoney(holding.currentUsd)}`);
  if (holding.qty != null) bits.push(`${fmtQty(holding.qty)} 股`);
  const levels = [holding.stopLoss, holding.takeProfit].filter(Boolean).join(' · ');
  return h('a', {
    class: 'card row-link holding-link',
    href: holdingHref(holding),
    'data-holding': holding.ticker,
    'data-planned': holding.planned ? 'true' : 'false',
  }, [
    h('div', { class: 'futu-head' }, [
      h('span', { class: 'ticker', text: holding.ticker }),
      holding.termLabel ? h('span', { class: `kind term-${holding.term || 'other'}`, text: holding.termLabel }) : null,
      holding.actionLabel ? h('span', { class: 'kind', text: holding.planned ? '計劃買入' : holding.actionLabel }) : null,
      blockedMark(blocked),
    ]),
    holding.name ? h('div', { class: 'futu-name', text: holding.name }) : null,
    bits.length ? h('p', { class: 'meta', text: bits.join(' · ') }) : null,
    levels ? h('p', { class: 'meta', text: levels }) : null,
    holding.timeframe ? h('p', { class: 'meta', text: holding.timeframe }) : null,
  ]);
}

function visibleHoldings(plan, state) {
  const filter = filtersOf(state, 'holdings');
  return plan.holdings.filter((holding) => {
    if (filter.bucket && holding.bucket !== filter.bucket) return false;
    if (filter.term && holding.term !== filter.term) return false;
    if (filter.action && holding.action !== filter.action) return false;
    return queryMatch(filter.q, [holding.ticker, holding.name, holding.owner, holding.timeframe]);
  });
}

function renderHoldings(plan, state) {
  const filter = filtersOf(state, 'holdings');
  const handlers = stateHandlers(state);
  const blocks = blockingIndex(plan.approvals);
  const section = h('section', { class: 'block', id: 'plan-holdings' }, [
    h('h3', { text: '團隊持股' }),
    h('p', { class: 'meta', text: '撳一行睇團隊點解買、點解持、點解賣，同止蝕止賺。計劃買入嘅代號都會列出。' }),
    searchField('search-holdings', filter.q, '搜尋持股', (q) => handlers.setFilter?.('holdings', { q })),
  ]);
  const buckets = [...new Set(plan.holdings.map((holding) => holding.bucket).filter(Boolean))];
  const terms = [...new Set(plan.holdings.map((holding) => holding.term).filter(Boolean))];
  const actions = [...new Set(plan.holdings.map((holding) => holding.action).filter(Boolean))];
  section.append(chipBar([{ value: '', label: '全部桶' }, ...buckets.map((bucket) => ({ value: bucket, label: BUCKETS[bucket] || bucket }))], filter.bucket || '', (bucket) => handlers.setFilter?.('holdings', { bucket })));
  section.append(chipBar([{ value: '', label: '全部期限' }, ...terms.map((term) => ({ value: term, label: TERMS[term] || term }))], filter.term || '', (term) => handlers.setFilter?.('holdings', { term })));
  section.append(chipBar([{ value: '', label: '全部行動' }, ...actions.map((action) => ({ value: action, label: HOLD_ACTIONS[action] || action }))], filter.action || '', (action) => handlers.setFilter?.('holdings', { action })));
  if (!plan.holdings.length) {
    section.append(h('p', { class: 'status', text: '未有團隊持倉。' }));
    return section;
  }
  const rows = visibleHoldings(plan, state);
  if (!rows.length) {
    section.append(h('p', { class: 'status', text: '冇符合篩選嘅持股。' }));
    return section;
  }
  const list = h('div', { class: 'holding-list' });
  for (const holding of rows) list.append(holdingRow(holding, blockFor(blocks, holding)));
  section.append(list);
  return section;
}

function holdingBody(holding) {
  const thesis = holding.thesis;
  const nodes = [
    h('article', { class: 'card', 'data-holding-detail': holding.ticker }, [
      h('div', { class: 'futu-head' }, [
        h('span', { class: 'ticker', text: holding.ticker }),
        holding.termLabel ? h('span', { class: `kind term-${holding.term || 'other'}`, text: holding.termLabel }) : null,
        holding.planned ? h('span', { class: 'kind', text: '計劃買入' }) : (holding.actionLabel ? h('span', { class: 'kind', text: holding.actionLabel }) : null),
      ]),
      holding.name ? h('h3', { text: holding.name }) : null,
      h('p', { class: 'meta', text: [
        holding.bucketLabel ? `桶 ${holding.bucketLabel}` : '',
        holding.owner ? `負責人 ${holding.owner}` : '',
        holding.timeframe || '',
      ].filter(Boolean).join(' · ') || '未有分類' }),
      h('div', { class: 'futu-metrics' }, [
        metric('數量', holding.qty == null ? '—' : fmtQty(holding.qty)),
        metric('現價', compactMoney(holding.price) || '—'),
        metric('成本', compactMoney(holding.costPrice) || '—'),
        metric('市值', compactMoney(holding.currentUsd) || '—'),
      ]),
      holding.stopLoss ? h('p', { text: holding.stopLoss }) : h('p', { class: 'meta', text: '未有止蝕' }),
      holding.takeProfit ? h('p', { text: holding.takeProfit }) : h('p', { class: 'meta', text: '未有止賺' }),
      h('p', { class: 'expect', text: `預期回報 熊 ${fmtPctPoints(holding.expectedReturnPct.bear)} · 基本 ${fmtPctPoints(holding.expectedReturnPct.base)} · 牛 ${fmtPctPoints(holding.expectedReturnPct.bull)}` }),
    ]),
  ];
  const analysis = h('section', { class: 'block', id: 'holding-thesis' }, [
    h('h3', { text: '團隊分析' }),
    h('h3', { class: 'subhead', text: '點解買' }),
    h('p', { text: thesis.whyBuy || '未有寫。' }),
    h('h3', { class: 'subhead', text: '點解持' }),
    h('p', { text: thesis.whyHold || '未有寫。' }),
    h('h3', { class: 'subhead', text: '點解賣' }),
    h('p', { text: thesis.whySell || '未有寫。' }),
  ]);
  if (thesis.risks.length) {
    const risks = h('ul', { class: 'checks' });
    for (const risk of thesis.risks) risks.append(h('li', { class: 'warn', text: risk }));
    analysis.append(h('h3', { class: 'subhead', text: '風險' }), risks);
  }
  if (holding.targets.length) {
    const targets = h('ul', { class: 'checks' });
    for (const target of holding.targets) targets.append(h('li', { text: `${target.label || '目標'} ${compactMoney(target.price) || '—'}` }));
    analysis.append(h('h3', { class: 'subhead', text: '目標價' }), targets);
  }
  if (holding.sources.length) {
    const sources = h('ul', { class: 'checks' });
    for (const source of holding.sources) sources.append(h('li', { text: source }));
    analysis.append(h('h3', { class: 'subhead', text: '來源' }), sources);
  }
  if (holding.updatedAt) analysis.append(h('p', { class: 'meta', text: `更新：${holding.updatedLabel}` }));
  nodes.push(analysis);
  return nodes;
}

export function renderHoldingDetail(plan, holdingKey, list = plan.holdings) {
  const found = locate(list, holdingKey, (item) => item.index);
  const holding = found.item || plan.holdings.find((item) => String(item.index) === String(holdingKey)) || null;
  if (!holding) {
    return sheetFrame({
      id: 'holding-sheet',
      title: '持股',
      closeHref: '#plan/holdings',
      index: 0,
      total: list.length,
      className: 'holding-detail',
    }, [
      h('p', { class: 'status', text: '搵唔到呢個持倉。' }),
      h('a', { href: '#plan/holdings', text: '返回持股' }),
    ]);
  }
  const href = (item) => holdingHref(item);
  return sheetFrame({
    id: 'holding-sheet',
    title: holding.ticker,
    closeHref: '#plan/holdings',
    index: Math.max(found.index, 0),
    total: list.length,
    prevHref: found.prev ? href(found.prev) : '',
    nextHref: found.next ? href(found.next) : '',
    className: 'holding-detail',
  }, [
    ...holdingBody(holding),
    h('a', { href: '#plan/holdings', text: '返回持股' }),
  ]);
}

function flatTimetable(plan) {
  const items = [];
  for (const group of plan.timetable.groups) items.push(...group.items);
  return items;
}

function visibleTimetable(plan, state) {
  const filter = filtersOf(state, 'timetable');
  return flatTimetable(plan).filter((item) => {
    if (filter.strategy && text(item.strategy).toLowerCase() !== text(filter.strategy).toLowerCase()) return false;
    if (filter.status && item.status !== filter.status) return false;
    return queryMatch(filter.q, [item.ticker, item.sentence, item.notes, item.strategy, item.ticketId]);
  });
}

function renderTimetable(plan, state) {
  const filter = filtersOf(state, 'timetable');
  const handlers = stateHandlers(state);
  const blocks = blockingIndex(plan.approvals);
  const section = h('section', { class: 'block', id: 'plan-timetable' }, [
    h('h3', { text: '時間表' }),
    h('p', { class: 'meta', text: '時間以歐洲赫爾辛基顯示（EET 或 EEST）。下一項會突出，已過嘅會變淡。' }),
    searchField('search-timetable', filter.q, '搜尋時間表', (q) => handlers.setFilter?.('timetable', { q })),
  ]);
  const strategies = [...new Set(flatTimetable(plan).map((item) => item.strategy).filter(Boolean))];
  const statuses = [...new Set(flatTimetable(plan).map((item) => item.status).filter(Boolean))];
  section.append(chipBar([{ value: '', label: '全部策略' }, ...strategies.map((strategy) => ({ value: strategy, label: strategy }))], filter.strategy || '', (strategy) => handlers.setFilter?.('timetable', { strategy })));
  section.append(chipBar([{ value: '', label: '全部狀態' }, ...statuses.map((status) => ({ value: status, label: TRADE_STATUS[status] || status }))], filter.status || '', (status) => handlers.setFilter?.('timetable', { status })));
  if (plan.timetable.empty) {
    section.append(h('p', { class: 'status', 'data-empty-timetable': 'true', text: '未有時間表。' }));
    return section;
  }
  const rows = visibleTimetable(plan, state);
  if (!rows.length) {
    section.append(h('p', { class: 'status', text: '冇符合篩選嘅時間。' }));
    return section;
  }
  for (const item of rows) {
    const blocked = blockFor(blocks, item);
    section.append(h('a', {
      class: `tt-item${item.past ? ' past' : ''}${item.next ? ' next' : ''}`,
      href: `#plan/timetable/${item.index}`,
      'data-past': item.past ? 'true' : 'false',
      'data-next': item.next ? 'true' : 'false',
      'data-ticker': item.ticker,
    }, [
      h('p', { class: 'meta', text: item.helsinkiLabel }),
      h('p', { class: 'trade-line', text: item.sentence }),
      item.statusLabel ? h('p', { class: 'meta', text: `狀態：${item.statusLabel}` }) : null,
      blockedMark(blocked),
    ]));
  }
  return section;
}

function renderTimetableSheet(plan, rows, detail) {
  const found = locate(rows, detail.id, (item) => item.index);
  if (!found.item) {
    return sheetFrame({ id: 'tt-sheet', title: '時間表', closeHref: '#plan/timetable', index: 0, total: 0 }, [
      h('p', { class: 'status', text: '搵唔到呢項時間。' }),
    ]);
  }
  const item = found.item;
  const href = (row) => `#plan/timetable/${row.index}`;
  const blocked = blockFor(blockingIndex(plan.approvals), item);
  return sheetFrame({
    id: 'tt-sheet',
    title: item.sentence,
    closeHref: '#plan/timetable',
    index: found.index,
    total: rows.length,
    prevHref: found.prev ? href(found.prev) : '',
    nextHref: found.next ? href(found.next) : '',
  }, [
    h('p', { class: 'meta', text: item.helsinkiLabel }),
    item.statusLabel ? h('p', { class: 'meta', text: `狀態：${item.statusLabel}` }) : null,
    item.condition ? h('p', { class: 'meta', text: `條件：${item.condition}` }) : null,
    item.stopText ? h('p', { text: item.stopText }) : null,
    item.takeText ? h('p', { text: item.takeText }) : null,
    [item.strategy ? `策略 ${item.strategy}` : '', item.ticketId].filter(Boolean).length
      ? h('p', { class: 'meta', text: [item.strategy ? `策略 ${item.strategy}` : '', item.ticketId].filter(Boolean).join(' · ') })
      : null,
    item.notes ? h('p', { class: 'meta', text: item.notes }) : null,
    blockedMark(blocked),
  ]);
}

function planDetail(plan, state) {
  const detail = state?.detail || (state?.holding ? { kind: 'holding', id: String(state.holding) } : null);
  if (!detail?.kind) return null;
  if (detail.kind === 'action') return renderActionSheet(plan, { ...state, detail }, visibleActions(plan, state));
  if (detail.kind === 'holding') return renderHoldingDetail(plan, detail.id, visibleHoldings(plan, state));
  if (detail.kind === 'timetable') return renderTimetableSheet(plan, visibleTimetable(plan, state), detail);
  if (detail.kind === 'allocation') return renderAllocationSheet(plan, visibleAllocation(plan, state), detail);
  return null;
}

export function renderTeamPlan(plan, options = {}) {
  const state = options.state || options;
  const section = state.planSection || state.section || (state.holding || state.detail?.kind === 'holding' ? 'holdings' : 'overview');
  const withHandlers = { ...state, handlers: options.handlers || state.handlers || {} };
  const root = h('div', { class: 'team-plan', 'data-team-plan': 'ready', 'data-plan-section': section }, [
    renderBlockingBanner(plan),
    renderHeader(plan),
  ]);
  if (section === 'overview') {
    root.append(
      renderActions(plan, withHandlers, withHandlers.handlers),
      renderOverviewBlock(plan.overview),
      renderStringList('風險', plan.risks, 'plan-risks'),
      renderStringList('未決問題', plan.openQuestions, 'plan-questions'),
    );
  } else if (section === 'strategy') {
    root.append(renderStrategies(plan, withHandlers));
  } else if (section === 'allocation') {
    root.append(renderAllocation(plan, withHandlers));
  } else if (section === 'timetable') {
    root.append(renderTimetable(plan, withHandlers));
  } else if (section === 'holdings') {
    root.append(renderHoldings(plan, withHandlers));
  }
  const detail = planDetail(plan, withHandlers);
  if (detail) root.append(detail);
  return root;
}

function visibleApprovals(plan, state) {
  const filter = filtersOf(state, 'approvals');
  return (plan?.approvals || []).filter((item) => {
    if (filter.status && item.status !== filter.status) return false;
    return queryMatch(filter.q, [item.title, item.detail, item.requestedBy, item.ticketId, item.note]);
  });
}

function latestResponse(responses, item) {
  return responses.find((entry) => entry.kind === 'approval' && entry.itemId === item.id) || null;
}

export function renderApprovals(plan, state = {}, handlers = {}) {
  const filter = filtersOf(state, 'approvals');
  const rows = visibleApprovals(plan, state);
  const responses = mergedFor(state, plan);
  const root = h('div', { class: 'approvals', 'data-approvals': 'ready' }, [
    renderBlockingBanner(plan),
    h('p', { class: 'disclaimer', text: APPROVAL_DISCLAIMER }),
    searchField('search-approvals', filter.q, '搜尋批准', (q) => handlers.setFilter?.('approvals', { q })),
    chipBar([
      { value: '', label: '全部' },
      { value: 'pending', label: '待回覆' },
      { value: 'approved', label: '已批准' },
      { value: 'rejected', label: '已拒絕' },
    ], filter.status || '', (status) => handlers.setFilter?.('approvals', { status })),
  ]);
  if (!plan?.approvals?.length) {
    root.append(h('p', { class: 'status', text: '未有待批項目。' }));
  } else if (!rows.length) {
    root.append(h('p', { class: 'status', text: '冇符合篩選嘅批准。' }));
  } else {
    const list = h('div', { class: 'action-list' });
    for (const item of rows) {
      const response = latestResponse(responses, item);
      list.append(h('a', {
        class: 'card row-link',
        href: `#approvals/${encodeURIComponent(item.id)}`,
        'data-approval': item.id,
        'data-approval-status': item.status || '',
        'data-blocking': item.blocking && item.status === 'pending' ? 'true' : 'false',
      }, [
        h('div', { class: 'futu-head' }, [
          h('span', { class: 'badge', text: item.statusLabel }),
          item.blocking && item.status === 'pending' ? h('span', { class: 'badge urgent', text: '必須回覆' }) : null,
        ]),
        h('p', { class: 'action-text', text: item.title }),
        h('p', { class: 'meta', text: [item.requestedBy ? `由 ${item.requestedBy}` : '', item.due].filter(Boolean).join(' · ') }),
        responseLine(response),
      ]));
    }
    root.append(list);
  }
  if (state.detail?.kind === 'approval') root.append(renderApprovalSheet(plan, rows, state, handlers, responses));
  return root;
}

function renderApprovalSheet(plan, rows, state, handlers, responses) {
  const found = locate(rows, state.detail.id, (item) => item.id);
  const item = found.item || (plan?.approvals || []).find((entry) => entry.id === state.detail.id) || null;
  if (!item) {
    return sheetFrame({ id: 'approval-sheet', title: '批准', closeHref: '#approvals', index: 0, total: rows.length }, [
      h('p', { class: 'status', text: '搵唔到呢項批准。' }),
    ]);
  }
  const href = (row) => `#approvals/${encodeURIComponent(row.id)}`;
  const response = latestResponse(responses, item);
  const open = item.status === 'pending' && (!response || response.localStatus === 'failed');
  const children = [
    item.detail ? h('p', { text: item.detail }) : null,
    h('p', { class: 'meta', text: [
      item.requestedBy ? `由 ${item.requestedBy}` : '',
      item.due ? `到期 ${item.due}` : '',
      item.ticketId,
      item.amountUsd != null ? `約 ${compactMoney(item.amountUsd)}` : '',
    ].filter(Boolean).join(' · ') || '未有補充' }),
    item.note ? h('p', { class: 'meta', text: `備註：${item.note}` }) : null,
    item.decidedLabel ? h('p', { class: 'meta', text: `決定：${item.decidedLabel}` }) : null,
    h('p', { class: 'disclaimer', text: APPROVAL_DISCLAIMER }),
    responseLine(response),
    response?.reply ? h('p', { text: response.reply }) : null,
  ];
  if (response?.localStatus === 'failed') {
    children.push(h('button', { type: 'button', class: 'button', onclick: () => handlers.retry?.(), text: '再試' }));
  }
  if (response?.localStatus === 'unsupported') {
    children.push(h('p', { class: 'banner warn', text: '後台未支援' }));
  }
  if (open) {
    children.push(
      h('label', { for: 'approval-note', text: '備註（可留空）' }),
      h('textarea', {
        id: 'approval-note',
        oninput: (event) => handlers.setDraftNote?.(event.target.value),
      }, [state.draftNote || '']),
      h('button', {
        type: 'button',
        class: 'button',
        onclick: () => handlers.requestConfirm?.({
          title: '確定批准？',
          body: APPROVAL_DISCLAIMER,
          confirmLabel: '確定批准',
          draft: { kind: 'approval', itemId: item.id, decision: 'approve', text: state.draftNote || '' },
        }),
        text: '批准',
      }),
      h('button', {
        type: 'button',
        class: 'button ghost',
        onclick: () => handlers.requestConfirm?.({
          title: '確定拒絕？',
          body: APPROVAL_DISCLAIMER,
          confirmLabel: '確定拒絕',
          draft: { kind: 'approval', itemId: item.id, decision: 'reject', text: state.draftNote || '' },
        }),
        text: '拒絕',
      }),
    );
  }
  return sheetFrame({
    id: 'approval-sheet',
    title: item.title,
    closeHref: '#approvals',
    index: Math.max(found.index, 0),
    total: rows.length || 1,
    prevHref: found.prev ? href(found.prev) : '',
    nextHref: found.next ? href(found.next) : '',
  }, children);
}

function visibleReports(plan, state) {
  const filter = filtersOf(state, 'reports');
  return (plan?.weeklyReports || []).filter((report) => {
    if (filter.member && report.member !== filter.member) return false;
    return queryMatch(filter.q, [report.member, report.role, report.week, report.title, ...(report.bullets || [])]);
  });
}

export function renderCrew(plan, state = {}, handlers = {}) {
  const filter = filtersOf(state, 'reports');
  const reports = visibleReports(plan, state);
  const members = plan?.team || [];
  const responses = mergedFor(state).filter((item) => item.kind === 'message');
  const root = h('div', { class: 'crew', 'data-crew': 'ready' }, [
    h('h3', { text: '回覆團隊' }),
    h('form', {
      class: 'settings-form',
      onsubmit: (event) => {
        event.preventDefault();
        const textValue = state.replyText || '';
        if (!textValue.trim()) return;
        handlers.requestConfirm?.({
          title: '送出回覆？',
          body: textValue,
          confirmLabel: '送出',
          draft: { kind: 'message', to: state.replyTo || '', text: textValue },
        });
      },
    }, [
      h('label', { for: 'reply-to', text: '給' }),
      h('select', {
        id: 'reply-to',
        onchange: (event) => handlers.setReplyTo?.(event.target.value),
      }, [
        h('option', { value: '', selected: state.replyTo ? null : 'selected', text: '全隊' }),
        ...members.map((member) => h('option', {
          value: member.name,
          selected: state.replyTo === member.name ? 'selected' : null,
          text: member.role ? `${member.name} · ${member.role}` : member.name,
        })),
      ]),
      h('label', { for: 'reply-text', text: '內容' }),
      h('textarea', {
        id: 'reply-text',
        oninput: (event) => handlers.setReplyText?.(event.target.value),
      }, [state.replyText || '']),
      h('button', { type: 'submit', class: 'button', text: '送出回覆' }),
    ]),
  ]);
  const history = h('section', { class: 'block', id: 'reply-history' }, [
    h('h3', { text: '已送出嘅回覆' }),
  ]);
  if (!responses.length) history.append(h('p', { class: 'status', text: '未有回覆。' }));
  else {
    for (const item of responses) {
      history.append(h('article', { class: 'card', 'data-reply': item.clientId || item.id }, [
        h('p', { class: 'meta', text: item.to ? `給 ${item.to}` : '給全隊' }),
        h('p', { text: item.text || '（空白）' }),
        responseLine(item),
        item.reply ? h('p', { class: 'meta', text: `團隊：${item.reply}` }) : null,
      ]));
    }
  }
  root.append(history);
  const weekly = h('section', { class: 'block', id: 'plan-weekly' }, [
    h('h3', { text: '團隊週報' }),
    searchField('search-reports', filter.q, '搜尋週報', (q) => handlers.setFilter?.('reports', { q })),
  ]);
  const names = [...new Set((plan?.weeklyReports || []).map((report) => report.member).filter(Boolean))];
  weekly.append(chipBar([{ value: '', label: '全部成員' }, ...names.map((name) => ({ value: name, label: name }))], filter.member || '', (member) => handlers.setFilter?.('reports', { member })));
  if (!plan?.weeklyReports?.length) weekly.append(h('p', { class: 'status', text: '未有週報。' }));
  else if (!reports.length) weekly.append(h('p', { class: 'status', text: '冇符合篩選嘅週報。' }));
  else {
    for (const report of reports) {
      const title = [report.member, report.role, report.week, report.title].filter(Boolean).join(' · ');
      weekly.append(h('a', {
        class: 'card row-link weekly',
        href: `#crew/r/${report.index}`,
        'data-report': String(report.index),
      }, [
        h('p', { class: 'action-text', text: title }),
      ]));
    }
  }
  root.append(weekly);
  const people = h('section', { class: 'block', id: 'plan-team' }, [
    h('h3', { text: '團隊' }),
  ]);
  if (!members.length) people.append(h('p', { class: 'status', text: '未有團隊成員。' }));
  else {
    const list = h('div', { class: 'futu-list' });
    for (const member of members) {
      list.append(h('article', { class: 'card', 'data-member': member.name }, [
        h('div', { class: 'futu-name', text: member.name }),
        member.role ? h('p', { class: 'meta', text: member.role }) : null,
        h('p', { text: member.latest || '未有最新輸出。' }),
        member.updatedAt ? h('p', { class: 'meta', text: member.updatedLabel }) : null,
      ]));
    }
    people.append(list);
  }
  root.append(people);
  if (state.detail?.kind === 'report') root.append(renderReportSheet(plan, reports, state.detail));
  return root;
}

function renderReportSheet(plan, rows, detail) {
  const found = locate(rows, detail.id, (item) => item.index);
  const report = found.item || null;
  if (!report) {
    return sheetFrame({ id: 'report-sheet', title: '週報', closeHref: '#crew', index: 0, total: 0 }, [
      h('p', { class: 'status', text: '搵唔到呢篇週報。' }),
    ]);
  }
  const href = (item) => `#crew/r/${item.index}`;
  const title = [report.member, report.title].filter(Boolean).join(' · ') || '週報';
  const body = [];
  if (report.bullets.length) {
    const list = h('ul', { class: 'checks' });
    for (const bullet of report.bullets) list.append(h('li', { text: bullet }));
    body.push(list);
  } else body.push(h('p', { class: 'status', text: '呢篇未有要點。' }));
  if (report.updatedAt) body.push(h('p', { class: 'meta', text: `更新：${report.updatedLabel}` }));
  return sheetFrame({
    id: 'report-sheet',
    title,
    closeHref: '#crew',
    index: found.index,
    total: rows.length,
    prevHref: found.prev ? href(found.prev) : '',
    nextHref: found.next ? href(found.next) : '',
  }, body);
}

export function renderTeamPlanEmpty() {
  return h('div', { class: 'card', 'data-team-plan': 'missing' }, [
    h('h3', { text: '團隊方案未同步' }),
    h('p', { text: '後端未有傳 data.teamPlan。其他頁面照舊，唔會用估計數字填方案。' }),
  ]);
}

export function renderPositionSheet(positions, detail) {
  const rows = positions || [];
  const found = locate(rows, detail?.id, (item) => item.index);
  if (!found.item) return null;
  const position = found.item;
  const href = (item) => `#portfolio/${item.index}`;
  return sheetFrame({
    id: 'position-sheet',
    title: position.symbol,
    closeHref: '#portfolio',
    index: found.index,
    total: rows.length,
    prevHref: found.prev ? href(found.prev) : '',
    nextHref: found.next ? href(found.next) : '',
  }, [
    h('p', { text: position.name || '—' }),
    h('p', { class: 'meta', text: [position.kindLabel, position.sideLabel, position.code].filter(Boolean).join(' · ') }),
    h('div', { class: 'futu-metrics' }, [
      metric('數量', position.qtyLabel),
      metric('成本價', position.costLabel),
      metric('現價', position.priceLabel),
      metric('市值', position.marketValueLabel),
    ]),
    h('p', { class: position.plClass || '', text: position.plLabel }),
  ]);
}

export function renderDealSheet(deals, detail) {
  const rows = deals || [];
  const found = locate(rows, detail?.id, (item) => item.index);
  if (!found.item) return null;
  const deal = found.item;
  const href = (item) => `#trades/${item.index}`;
  return sheetFrame({
    id: 'deal-sheet',
    title: deal.symbol,
    closeHref: '#trades',
    index: found.index,
    total: rows.length,
    prevHref: found.prev ? href(found.prev) : '',
    nextHref: found.next ? href(found.next) : '',
  }, [
    h('p', { text: deal.name || '—' }),
    h('p', { class: 'meta', text: [deal.sideLabel, deal.kindLabel, deal.detailLabel].filter(Boolean).join(' · ') }),
    deal.code ? h('p', { class: 'meta', text: deal.code }) : null,
    deal.idLabel ? h('p', { class: 'meta', text: deal.idLabel }) : null,
  ]);
}
