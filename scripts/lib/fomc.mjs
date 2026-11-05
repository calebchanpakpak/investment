/**
 * Parse announced FOMC dates from the Federal Reserve calendar HTML.
 * https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm
 * Dates are taken only from that page. Nothing is inferred or forecast.
 */

const MONTHS = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

function monthNumber(token) {
  const key = String(token || '').toLowerCase().replace(/\./g, '').slice(0, 3);
  return MONTHS[key] || null;
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function iso(year, month, day) {
  if (!year || !month || !day) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${pad(month)}-${pad(day)}`;
}

/**
 * @param {number} year
 * @param {string} monthLabel e.g. "April" or "Apr/May"
 * @param {string} dateLabel e.g. "28-29", "30-1", "22 (notation vote)"
 */
export function parseMeetingToken(year, monthLabel, dateLabel) {
  const rawDate = String(dateLabel || '').trim();
  const sep = rawDate.includes('*');
  const notation = /notation vote/i.test(rawDate);
  const monthParts = String(monthLabel || '').split('/').map((part) => part.trim()).filter(Boolean);
  const startMonth = monthNumber(monthParts[0]);
  const explicitEndMonth = monthParts[1] ? monthNumber(monthParts[1]) : null;
  const dayMatch = rawDate.match(/(\d{1,2})(?:\s*-\s*(\d{1,2}))?/);
  if (!startMonth || !dayMatch) return null;
  const startDay = Number(dayMatch[1]);
  const endDay = dayMatch[2] ? Number(dayMatch[2]) : startDay;
  let endMonth = explicitEndMonth || startMonth;
  let endYear = year;
  let startYear = year;
  if (!explicitEndMonth && endDay < startDay) {
    endMonth = startMonth === 12 ? 1 : startMonth + 1;
    if (startMonth === 12) endYear = year + 1;
  }
  if (explicitEndMonth && explicitEndMonth < startMonth) {
    endYear = year + 1;
  }
  const start = iso(startYear, startMonth, startDay);
  const end = iso(endYear, endMonth, endDay);
  if (!start || !end) return null;
  return {
    year,
    monthLabel: String(monthLabel || '').trim(),
    rawDate,
    start,
    end,
    sep,
    kind: notation ? 'notation' : 'meeting',
  };
}

export function parseFomcCalendar(html) {
  const source = String(html || '');
  if (!/fomc-meeting__date/i.test(source) || !/FOMC Meetings/i.test(source)) {
    return {
      ok: false,
      error: 'fomc_page_unrecognized',
      meetings: [],
      pageNote: null,
      pageLastUpdate: null,
    };
  }
  const meetings = [];
  const panels = source.split(/<div class="panel panel-default">/i).slice(1);
  for (const panel of panels) {
    const yearMatch = panel.match(/(\d{4})\s+FOMC Meetings/i);
    if (!yearMatch) continue;
    const year = Number(yearMatch[1]);
    const rowRe = /fomc-meeting__month[\s\S]*?<strong>([^<]+)<\/strong>[\s\S]*?fomc-meeting__date[^>]*>\s*([^<]+)/gi;
    for (const row of panel.matchAll(rowRe)) {
      const meeting = parseMeetingToken(year, row[1], row[2]);
      if (meeting) meetings.push(meeting);
    }
  }
  meetings.sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end));
  const noteMatch = source.match(/<p>\s*(Note:[\s\S]*?)<\/p>/i);
  const pageNote = noteMatch
    ? noteMatch[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    : null;
  const updatedMatch = source.match(/id="lastUpdate"[\s\S]*?([A-Z][a-z]+ \d{1,2}, \d{4})/);
  if (!meetings.length) {
    return {
      ok: false,
      error: 'fomc_no_dates',
      meetings: [],
      pageNote,
      pageLastUpdate: updatedMatch ? updatedMatch[1] : null,
    };
  }
  return {
    ok: true,
    error: null,
    meetings,
    pageNote,
    pageLastUpdate: updatedMatch ? updatedMatch[1] : null,
  };
}
