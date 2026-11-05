export function h(tag, attrs = {}, children = []) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'text') el.textContent = String(value);
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value);
    else el.setAttribute(key, String(value));
  }
  const list = Array.isArray(children) ? children : [children];
  for (const child of list) {
    if (child == null || child === false) continue;
    el.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return el;
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

const ALLOWED = ['cnbc.com', 'federalreserve.gov', 'sec.gov', 'news.google.com'];

export function safeHttpsUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return null;
    const host = url.hostname.toLowerCase();
    const ok = ALLOWED.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
    return ok ? url.toString() : null;
  } catch {
    return null;
  }
}

export function externalLink(href, label, className = 'text-link') {
  const safe = safeHttpsUrl(href);
  if (!safe) return h('span', { class: 'muted', text: label });
  return h('a', {
    class: className,
    href: safe,
    target: '_blank',
    rel: 'noopener noreferrer',
    text: label,
  });
}
