import { h } from './dom.js';
import { fmtMoney, fmtQty, formatHelsinkiTime, helsinkiParts } from './format.js';

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
  return raw.filter((item) => item && typeof item === 'object').map((item) => ({
    id: text(item.id),
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
  return raw.filter((item) => item && typeof item === 'object').map((item) => ({
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
  return raw.filter((item) => item && typeof item === 'object').map((item) => ({
    member: text(item.member) || '未署名',
    role: text(item.role),
    week: text(item.week),
    title: text(item.title),
    bullets: stringList(item.bullets),
    updatedAt: text(item.updatedAt),
    updatedLabel: formatHelsinkiTime(text(item.updatedAt)),
  }));
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

function renderActions(actions) {
  const card = h('section', { class: 'card actions-for-you', 'aria-label': '你要做嘅嘢' }, [
    h('h3', { text: '你要做嘅嘢' }),
  ]);
  if (!actions.length) {
    card.append(h('p', { class: 'status', text: '暫時未有要你做嘅嘢。' }));
    return card;
  }
  const list = h('div', { class: 'action-list' });
  for (const action of actions) {
    const row = h('article', {
      class: action.priority === 'urgent' ? 'action-item urgent' : 'action-item',
      'data-priority': action.priority,
      'data-action-status': action.status || '',
    }, [
      h('div', { class: 'futu-head' }, [
        h('span', { class: action.priority === 'urgent' ? 'badge urgent' : 'badge', text: action.priority === 'urgent' ? '急' : '一般' }),
        action.needsApproval ? h('span', { class: 'badge warn', 'data-needs-approval': 'true', text: '等你批准' }) : null,
      ]),
      h('p', { class: 'action-text', text: action.text || '（未有說明）' }),
    ]);
    const meta = [];
    if (action.due) meta.push(action.due);
    if (action.price != null) meta.push(`價 ${compactMoney(action.price)}`);
    if (action.amountUsd != null) meta.push(`約 ${compactMoney(action.amountUsd)}`);
    if (action.ticketId) meta.push(action.ticketId);
    if (meta.length) row.append(h('p', { class: 'meta', text: meta.join(' · ') }));
    list.append(row);
  }
  card.append(list);
  return card;
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
    const list = h('ul', { class: 'checks' });
    for (const note of overview.notes) list.append(h('li', { text: note }));
    section.append(h('p', { class: 'meta', text: '重點' }));
    section.append(list);
  }
  return section;
}

function renderStrategies(strategies) {
  const section = h('section', { class: 'block', id: 'plan-strategies' }, [
    h('h3', { text: '策略' }),
  ]);
  if (!strategies.length) {
    section.append(h('p', { class: 'status', text: '未有策略。' }));
    return section;
  }
  const list = h('div', { class: 'strategy-list' });
  for (const strategy of strategies) {
    const card = h('article', { class: 'card strategy-card', 'data-strategy': strategy.id || strategy.name }, [
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
    if (strategy.holdings.length) {
      const holdings = h('ul', { class: 'mini-holdings' });
      for (const holding of strategy.holdings) {
        holdings.append(h('li', { text: `${holding.ticker || '—'} · 目標 ${fmtPctPoints(holding.targetPct)}（${compactMoney(holding.targetUsd) || '—'}）· 而家 ${compactMoney(holding.currentUsd) || '—'}${holding.note ? ` · ${holding.note}` : ''}` }));
      }
      card.append(holdings);
    }
    list.append(card);
  }
  section.append(list);
  return section;
}

function renderAllocation(plan) {
  const section = h('section', { class: 'block', id: 'plan-allocation' }, [
    h('h3', { text: '配置' }),
    h('p', { class: 'meta', text: '條條係佔資產百分比。上面係而家，下面係目標。' }),
  ]);
  if (!plan.allocation.length) {
    section.append(h('p', { class: 'status', text: '未有配置。' }));
    return section;
  }
  if (plan.buckets.length) {
    section.append(h('h3', { class: 'subhead', text: '按桶' }));
    const buckets = h('div', { class: 'bars' });
    for (const bucket of plan.buckets) {
      buckets.append(h('div', { class: 'card bucket-card', 'data-bucket': bucket.bucket }, [
        h('div', { class: 'futu-name', text: bucket.label }),
        h('p', { class: 'meta', text: `${moneyPair(bucket.currentKnown ? bucket.currentUsd : null, bucket.targetKnown ? bucket.targetUsd : null)}` }),
        compareBars(bucket.currentPct, bucket.targetPct, fmtPctPoints(bucket.currentPct), fmtPctPoints(bucket.targetPct)),
      ]));
    }
    section.append(buckets);
  }
  section.append(h('h3', { class: 'subhead', text: '按持倉' }));
  const rows = h('div', { class: 'bars' });
  for (const row of plan.allocation) {
    rows.append(h('div', { class: 'card', 'data-alloc': row.ticker }, [
      h('div', { class: 'futu-head' }, [
        h('span', { class: 'ticker', text: row.ticker }),
        h('span', { class: 'kind', text: row.bucketLabel }),
      ]),
      row.name ? h('div', { class: 'futu-name', text: row.name }) : null,
      h('p', { class: 'meta', text: moneyPair(row.currentUsd, row.targetUsd) }),
      compareBars(row.currentPct, row.targetPct, fmtPctPoints(row.currentPct), fmtPctPoints(row.targetPct)),
    ]));
  }
  section.append(rows);
  return section;
}

function renderHoldings(holdings) {
  const section = h('section', { class: 'block', id: 'plan-holdings' }, [
    h('h3', { text: '團隊持倉' }),
    h('p', { class: 'meta', text: '撳一行睇團隊點解買、點解持、點解賣，同止蝕止賺。計劃買入嘅代號都會列出。' }),
  ]);
  if (!holdings.length) {
    section.append(h('p', { class: 'status', text: '未有團隊持倉。' }));
    return section;
  }
  const list = h('div', { class: 'holding-list' });
  for (const holding of holdings) {
    const link = h('a', {
      class: 'card holding-link',
      href: `#team/h/${holding.index}`,
      'data-holding': holding.ticker,
      'data-planned': holding.planned ? 'true' : 'false',
    }, [
      h('div', { class: 'futu-head' }, [
        h('span', { class: 'ticker', text: holding.ticker }),
        holding.termLabel ? h('span', { class: `kind term-${holding.term || 'other'}`, text: holding.termLabel }) : null,
        holding.actionLabel ? h('span', { class: 'kind', text: holding.planned ? '計劃買入' : holding.actionLabel }) : null,
      ]),
      holding.name ? h('div', { class: 'futu-name', text: holding.name }) : null,
    ]);
    const bits = [];
    if (holding.price != null) bits.push(`現價 ${compactMoney(holding.price)}`);
    if (holding.currentUsd != null) bits.push(`市值 ${compactMoney(holding.currentUsd)}`);
    if (holding.qty != null) bits.push(`${fmtQty(holding.qty)} 股`);
    if (bits.length) link.append(h('p', { class: 'meta', text: bits.join(' · ') }));
    const levels = [holding.stopLoss, holding.takeProfit].filter(Boolean).join(' · ');
    if (levels) link.append(h('p', { class: 'meta', text: levels }));
    if (holding.timeframe) link.append(h('p', { class: 'meta', text: holding.timeframe }));
    list.append(link);
  }
  section.append(list);
  return section;
}

export function renderHoldingDetail(plan, holdingKey) {
  const index = Number(holdingKey);
  const holding = plan.holdings.find((item) => String(item.index) === String(holdingKey))
    || (Number.isInteger(index) ? plan.holdings[index] : null);
  const wrap = h('div', { class: 'holding-detail' }, [
    h('a', { class: 'button ghost', href: '#team', text: '返回方案' }),
  ]);
  if (!holding) {
    wrap.append(h('p', { class: 'status', text: '搵唔到呢個持倉。' }));
    return wrap;
  }
  wrap.append(h('article', { class: 'card', 'data-holding-detail': holding.ticker }, [
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
  ]));
  const thesis = holding.thesis;
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
    for (const target of holding.targets) {
      targets.append(h('li', { text: `${target.label || '目標'} ${compactMoney(target.price) || '—'}` }));
    }
    analysis.append(h('h3', { class: 'subhead', text: '目標價' }), targets);
  }
  if (holding.sources.length) {
    const sources = h('ul', { class: 'checks' });
    for (const source of holding.sources) sources.append(h('li', { text: source }));
    analysis.append(h('h3', { class: 'subhead', text: '來源' }), sources);
  }
  if (holding.updatedAt) analysis.append(h('p', { class: 'meta', text: `更新：${holding.updatedLabel}` }));
  wrap.append(analysis);
  return wrap;
}

function metric(label, value) {
  return h('div', { class: 'metric' }, [
    h('span', { class: 'k', text: label }),
    h('span', { class: 'v', text: value }),
  ]);
}

function renderTimetable(timetable) {
  const section = h('section', { class: 'block', id: 'plan-timetable' }, [
    h('h3', { text: '時間表' }),
    h('p', { class: 'meta', text: '時間以歐洲赫爾辛基顯示（EET 或 EEST）。下一項會突出，已過嘅會變淡。' }),
  ]);
  if (timetable.empty) {
    section.append(h('p', { class: 'status', 'data-empty-timetable': 'true', text: '未有時間表。' }));
    return section;
  }
  for (const group of timetable.groups) {
    const block = h('div', { class: 'tt-day' }, [
      h('h3', { class: 'subhead', text: group.label }),
    ]);
    for (const item of group.items) {
      const row = h('article', {
        class: `tt-item${item.past ? ' past' : ''}${item.next ? ' next' : ''}`,
        'data-past': item.past ? 'true' : 'false',
        'data-next': item.next ? 'true' : 'false',
        'data-ticker': item.ticker,
      }, [
        h('p', { class: 'meta', text: item.helsinkiLabel }),
        h('p', { class: 'trade-line', text: item.sentence }),
      ]);
      if (item.statusLabel) row.append(h('p', { class: 'meta', text: `狀態：${item.statusLabel}` }));
      if (item.condition) row.append(h('p', { class: 'meta', text: `條件：${item.condition}` }));
      if (item.stopText) row.append(h('p', { text: item.stopText }));
      if (item.takeText) row.append(h('p', { text: item.takeText }));
      const foot = [item.strategy ? `策略 ${item.strategy}` : '', item.ticketId].filter(Boolean).join(' · ');
      if (foot) row.append(h('p', { class: 'meta', text: foot }));
      if (item.notes) row.append(h('p', { class: 'meta', text: item.notes }));
      block.append(row);
    }
    section.append(block);
  }
  return section;
}

function renderReports(reports) {
  const section = h('section', { class: 'block', id: 'plan-weekly' }, [
    h('h3', { text: '團隊週報' }),
  ]);
  if (!reports.length) {
    section.append(h('p', { class: 'status', text: '未有週報。' }));
    return section;
  }
  for (const report of reports) {
    const title = [report.member, report.role, report.week, report.title].filter(Boolean).join(' · ');
    const body = h('div', {});
    if (report.bullets.length) {
      const list = h('ul', { class: 'checks' });
      for (const bullet of report.bullets) list.append(h('li', { text: bullet }));
      body.append(list);
    } else body.append(h('p', { class: 'status', text: '呢篇未有要點。' }));
    if (report.updatedAt) body.append(h('p', { class: 'meta', text: `更新：${report.updatedLabel}` }));
    section.append(h('details', { class: 'weekly' }, [
      h('summary', { text: title }),
      body,
    ]));
  }
  return section;
}

function renderTeam(team) {
  const section = h('section', { class: 'block', id: 'plan-team' }, [
    h('h3', { text: '團隊' }),
  ]);
  if (!team.length) {
    section.append(h('p', { class: 'status', text: '未有團隊成員。' }));
    return section;
  }
  const list = h('div', { class: 'futu-list' });
  for (const member of team) {
    list.append(h('article', { class: 'card', 'data-member': member.name }, [
      h('div', { class: 'futu-name', text: member.name }),
      member.role ? h('p', { class: 'meta', text: member.role }) : null,
      h('p', { text: member.latest || '未有最新輸出。' }),
      member.updatedAt ? h('p', { class: 'meta', text: member.updatedLabel }) : null,
    ]));
  }
  section.append(list);
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

export function renderTeamPlan(plan, { holding = '' } = {}) {
  if (holding) return renderHoldingDetail(plan, holding);
  return h('div', { class: 'team-plan', 'data-team-plan': 'ready' }, [
    renderHeader(plan),
    renderActions(plan.actions),
    renderOverviewBlock(plan.overview),
    renderStrategies(plan.strategies),
    renderAllocation(plan),
    renderHoldings(plan.holdings),
    renderTimetable(plan.timetable),
    renderReports(plan.weeklyReports),
    renderTeam(plan.team),
    renderStringList('風險', plan.risks, 'plan-risks'),
    renderStringList('未決問題', plan.openQuestions, 'plan-questions'),
  ]);
}

export function renderTeamPlanEmpty() {
  return h('div', { class: 'card', 'data-team-plan': 'missing' }, [
    h('h3', { text: '團隊方案未同步' }),
    h('p', { text: '後端未有傳 data.teamPlan。其他頁面照舊，唔會用估計數字填方案。' }),
  ]);
}
