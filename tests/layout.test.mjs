import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const css = readFileSync(new URL('../site/css/app.css', import.meta.url), 'utf8');
const html = readFileSync(new URL('../site/index.html', import.meta.url), 'utf8');
const sw = readFileSync(new URL('../site/sw.js', import.meta.url), 'utf8');
const app = readFileSync(new URL('../site/js/app.js', import.meta.url), 'utf8');
const manifest = readFileSync(new URL('../site/manifest.webmanifest', import.meta.url), 'utf8');

test('layout keeps a dark single column, safe areas, tap targets, and no horizontal page scroll', () => {
  assert.match(css, /--up:\s*#E54545/);
  assert.match(css, /--down:\s*#16A34A/);
  assert.match(css, /env\(safe-area-inset-top\)/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
  assert.match(css, /overflow-x:\s*hidden/);
  assert.match(css, /--tap:\s*44px/);
  assert.match(css, /min-height:\s*var\(--tap\)/);
  assert.match(css, /width:\s*min\(480px,\s*100%\)/);
  assert.match(html, /viewport-fit=cover/);
  assert.match(html, /lang="zh-Hant-HK"/);
  assert.doesNotMatch(html, /user-scalable=no/);
  assert.match(sw, /investment-v2-shell-1/);
  assert.match(app, /serviceWorker\.register\('\.\/sw\.js', \{ scope: '\.\/' \}\)/);
  assert.match(sw, /request\.method !== 'GET'/);
  assert.match(manifest, /"scope": "\.\/"/);
});
