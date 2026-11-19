import { formatHelsinkiTime } from './format.js';
import { futuBlock, parseSyncedAt } from './futu.js';

/**
 * The owner's Mac runs futu-sync on weekdays at these Europe/Helsinki wall times.
 * Offset and DST come from Intl, not a fixed number of hours.
 */
export const SYNC_SCHEDULE = {
  timeZone: 'Europe/Helsinki',
  days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
  runs: [
    { hour: 16, minute: 0 },
    { hour: 23, minute: 15 },
  ],
  earlyMs: 5 * 60 * 1000,
  graceMs: 30 * 60 * 1000,
  staleMs: 24 * 60 * 60 * 1000,
};

const WEEKDAYS = new Set(SYNC_SCHEDULE.days);

export function helsinkiWall(date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: SYNC_SCHEDULE.timeZone,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const pick = (type) => parts.find((part) => part.type === type)?.value || '';
  let hour = Number(pick('hour'));
  let day = Number(pick('day'));
  let month = Number(pick('month'));
  let year = Number(pick('year'));
  if (hour === 24) hour = 0;
  return {
    weekday: pick('weekday'),
    year,
    month,
    day,
    hour,
    minute: Number(pick('minute')),
    second: Number(pick('second')),
  };
}

/** UTC instant whose Europe/Helsinki wall clock is the given civil time. */
export function utcFromHelsinkiWall(year, month, day, hour, minute) {
  const want = Date.UTC(year, month - 1, day, hour, minute, 0);
  let guess = want;
  for (let pass = 0; pass < 4; pass += 1) {
    const wall = helsinkiWall(new Date(guess));
    const got = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
    const delta = got - want;
    if (delta === 0) return new Date(guess);
    guess -= delta;
  }
  return new Date(guess);
}

function shiftHelsinkiDate(wall, days) {
  return helsinkiWall(new Date(Date.UTC(wall.year, wall.month - 1, wall.day + days)));
}

export function lastScheduledRun(now = new Date(), schedule = SYNC_SCHEDULE) {
  const start = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(start.getTime())) return null;
  let wall = helsinkiWall(start);
  const runs = [...schedule.runs].sort((a, b) => (b.hour - a.hour) || (b.minute - a.minute));
  for (let back = 0; back < 10; back += 1) {
    if (WEEKDAYS.has(wall.weekday) || schedule.days.includes(wall.weekday)) {
      for (const run of runs) {
        const instant = utcFromHelsinkiWall(wall.year, wall.month, wall.day, run.hour, run.minute);
        if (instant.getTime() <= start.getTime()) return instant;
      }
    }
    wall = shiftHelsinkiDate(wall, -1);
  }
  return null;
}

export function assessFutuSync(portfolio, now = new Date(), schedule = SYNC_SCHEDULE) {
  const futu = futuBlock(portfolio);
  if (!futu) return { level: 'absent', scheduled: null, syncedAt: '', staleReason: null };
  const raw = typeof futu.syncedAt === 'string' ? futu.syncedAt.trim() : '';
  const parsed = parseSyncedAt(raw);
  const scheduled = lastScheduledRun(now, schedule);
  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
  const syncedMs = parsed ? parsed.getTime() : null;
  const scheduledMs = scheduled ? scheduled.getTime() : null;
  let staleReason = null;
  if (!parsed) staleReason = 'missing';
  else if (nowMs - syncedMs > schedule.staleMs) staleReason = 'age';
  const missed = scheduledMs != null
    && (syncedMs == null || syncedMs < scheduledMs - schedule.earlyMs)
    && nowMs > scheduledMs + schedule.graceMs;
  let level = 'ok';
  if (staleReason === 'missing') level = 'missing';
  else if (staleReason === 'age') level = 'stale';
  else if (missed) level = 'missed';
  return {
    level,
    scheduled,
    syncedAt: parsed ? parsed.toISOString() : '',
    staleReason,
    missed,
  };
}

export function syncMessage(health) {
  if (!health || health.level === 'ok') return '';
  if (health.level === 'absent') {
    return '富途未同步過。真實持倉唔會用估計數字代替。請喺部 Mac 開住 Futu OpenD 同登入，交易日 16:00 同 23:15（赫爾辛基）會自動同步。';
  }
  const syncedLabel = health.syncedAt ? formatHelsinkiTime(health.syncedAt) : '—';
  const when = health.scheduled ? formatHelsinkiTime(health.scheduled.toISOString()) : '—';
  if (health.level === 'stale') {
    return `⚠️ 富途實盤同步已超過 24 小時（最後成功同步：${syncedLabel}）。請喺 Mac 再同步一次，並檢查 Futu OpenD 有冇開同登入，部 Mac 係咁係開著。`;
  }
  if (health.level === 'missing') {
    return '⚠️ 未能確認實盤同步時間。請檢查你部 Mac 上面 Futu OpenD 有冇開同登入，部 Mac 係咁係開著。以下持倉同成交可能已經過時。';
  }
  return `⚠️ 上次自動同步（${when}）未成功。請檢查你部 Mac 上面 Futu OpenD 有冇開同登入，部 Mac 係咁係開著。最後成功同步：${syncedLabel}。`;
}

export function syncBadgeLabel(health) {
  if (!health) return '';
  if (health.level === 'missed') return '同步未成功';
  if (health.level === 'stale' || health.level === 'missing') return '同步過時';
  return '';
}
