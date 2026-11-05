import { addDays, newYorkDate } from './format.js';

export const NEWS_STALE_MS = 12 * 60 * 60 * 1000;
export const SCHEDULE_STALE_MS = 8 * 24 * 60 * 60 * 1000;
export const SYMBOLS_STALE_MS = 14 * 24 * 60 * 60 * 1000;

export const DELAY_NOTICE = '公開快取有延遲，唔係即時報價或即時新聞。時間以歐洲赫爾辛基顯示（EET 或 EEST）。';
export const CADENCE_NOTICE = '預定約每 6 小時更新，GitHub 可能再延遲。來源中斷時會保留上次成功擷取，並標明今次失敗，唔會把舊標題當成剛剛更新。';

function ageMs(iso, now) {
  const ms = Date.parse(iso || '');
  if (!Number.isFinite(ms)) return Number.POSITIVE_INFINITY;
  return now.getTime() - ms;
}

function sectionState(section, now, staleMs) {
  if (!section) return { state: 'error', reason: 'missing' };
  const items = section.items || section.meetings || section.rows || [];
  const hasRows = items.length > 0;
  if (!section.ok && !hasRows) return { state: 'error', reason: section.error || 'fetch_failed' };
  if (!hasRows) return { state: 'empty', reason: 'empty' };
  if (!section.ok || section.error) return { state: 'stale', reason: section.error || 'refresh_failed' };
  if (ageMs(section.fetchedAt, now) > staleMs) return { state: 'stale', reason: 'age' };
  return { state: 'ok', reason: null };
}

export function newsViewState(news, now = new Date()) {
  return sectionState(news, now, NEWS_STALE_MS);
}

export function scheduleViewState(schedule, now = new Date()) {
  return sectionState(schedule, now, SCHEDULE_STALE_MS);
}

export function symbolsViewState(symbols, now = new Date()) {
  return sectionState(symbols, now, SYMBOLS_STALE_MS);
}

export function sourceLabel(section) {
  const name = section?.source?.name || '未知來源';
  const fetched = section?.fetchedAt || null;
  return { name, fetchedAt: fetched, url: section?.source?.feedUrl || section?.source?.url || null };
}

const LEGAL_SUFFIX = /\b(INC|INCORPORATED|CORP|CORPORATION|CO|COMPANY|LTD|LIMITED|PLC|LLC|LP|SA|AG|NV|HOLDINGS|GROUP)\b\.?/gi;

export function searchableName(name) {
  return String(name || '')
    .toUpperCase()
    .replace(/[.,']/g, ' ')
    .replace(LEGAL_SUFFIX, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function matchHeadlines(items, { ticker, name } = {}) {
  const list = Array.isArray(items) ? items : [];
  const symbol = String(ticker || '').trim().toUpperCase();
  const company = searchableName(name);
  const symbolRe = symbol.length >= 2 ? new RegExp(`(^|[^A-Z0-9])${symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^A-Z0-9]|$)`, 'i') : null;
  return list.filter((item) => {
    const hay = `${item?.title || ''} ${item?.summary || ''}`;
    if (symbolRe && symbolRe.test(hay)) return true;
    if (company.length >= 5 && hay.toUpperCase().includes(company)) return true;
    return false;
  });
}

export function upcomingMeetings(meetings, now = new Date(), withinDays = 14) {
  const today = newYorkDate(now);
  const horizon = addDays(today, withinDays);
  return (meetings || [])
    .filter((meeting) => meeting && meeting.kind !== 'notation' && meeting.start >= today && meeting.start <= horizon)
    .sort((a, b) => a.start.localeCompare(b.start));
}

export function nextMeeting(meetings, now = new Date()) {
  const today = newYorkDate(now);
  return (meetings || [])
    .filter((meeting) => meeting && meeting.end >= today)
    .sort((a, b) => a.start.localeCompare(b.start))[0] || null;
}
