/**
 * Parse the public CNBC RSS 2.0 feed into a small headline cache.
 * Titles, links, dates, and a short summary only — not full articles.
 */

const ITEM_RE = /<item\b[^>]*>[\s\S]*?<\/item>/gi;
const TAG_RE_CACHE = new Map();

function tagPattern(name) {
  let re = TAG_RE_CACHE.get(name);
  if (!re) {
    re = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`, 'i');
    TAG_RE_CACHE.set(name, re);
  }
  return re;
}

export function decodeXml(value) {
  return String(value || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => {
      const code = Number(n);
      return Number.isFinite(code) ? String.fromCodePoint(code) : '';
    })
    .replace(/\s+/g, ' ')
    .trim();
}

function tagText(block, name) {
  const match = block.match(tagPattern(name));
  if (!match) return '';
  return decodeXml(match[1]);
}

export function isAllowedNewsLink(link) {
  try {
    const url = new URL(link);
    if (url.protocol !== 'https:') return false;
    const host = url.hostname.toLowerCase();
    return host === 'cnbc.com' || host.endsWith('.cnbc.com');
  } catch {
    return false;
  }
}

export function toIsoOrNull(rfc822) {
  if (!rfc822) return null;
  const ms = Date.parse(rfc822);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

/**
 * @param {string} xml
 * @param {{ limit?: number }} [options]
 */
export function parseCnbcRss(xml, options = {}) {
  const limit = options.limit ?? 30;
  const source = String(xml || '');
  if (!/<rss\b/i.test(source) || !/<channel\b/i.test(source)) {
    return {
      ok: false,
      error: 'rss_not_xml',
      channelTitle: null,
      channelLink: null,
      channelLastBuild: null,
      items: [],
    };
  }
  const channelMatch = source.match(/<channel\b[^>]*>([\s\S]*)<\/channel>/i);
  const channel = channelMatch ? channelMatch[1] : source;
  const channelTitle = tagText(channel.slice(0, channel.search(/<item\b/i)), 'title') || null;
  const channelLink = tagText(channel.slice(0, channel.search(/<item\b/i)), 'link') || null;
  const channelLastBuild = toIsoOrNull(tagText(channel.slice(0, channel.search(/<item\b/i)), 'lastBuildDate'));
  const items = [];
  for (const match of channel.matchAll(ITEM_RE)) {
    const block = match[0];
    const title = tagText(block, 'title');
    const link = tagText(block, 'link');
    const summary = tagText(block, 'description').slice(0, 240);
    const publishedRaw = tagText(block, 'pubDate');
    if (!title || !isAllowedNewsLink(link)) continue;
    items.push({
      title,
      link,
      summary,
      publishedAt: toIsoOrNull(publishedRaw),
      publishedRaw: publishedRaw || null,
    });
    if (items.length >= limit) break;
  }
  return {
    ok: true,
    error: null,
    channelTitle,
    channelLink,
    channelLastBuild,
    items,
  };
}
