import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(new URL('..', import.meta.url).pathname);

const banned = [
  { re: /docs\.google\.com\/spreadsheets\/d\/[a-zA-Z0-9-_]+/, label: 'spreadsheet id' },
  { re: /script\.google\.com\/macros\/s\/[A-Za-z0-9_-]{30,}/, label: 'apps script deployment id' },
  { re: /AIza[0-9A-Za-z_-]{20,}/, label: 'google api key' },
  { re: /BEGIN (?:RSA |OPENSSH )?PRIVATE KEY/, label: 'private key' },
  { re: /\b(?:ghp_|github_pat_|xox[baprs]-|sk-)[A-Za-z0-9_-]{10,}/, label: 'token' },
  { re: /\u9ad8\u9a30|\u83ef\u590f\u6e2f\u5143/, label: 'private fund label' },
  { re: /\|\|\s*100000\b/, label: 'hardcoded deposit fallback' },
  { re: /FINNHUB_[A-Z0-9_]*KEY\s*[:=]\s*['"][^'"]+['"]/, label: 'finnhub key' },
];

function files(dir, found = []) {
  for (const name of readdirSync(dir)) {
    if (name === '.git' || name === 'node_modules') continue;
    if (/\.(png|jpg|jpeg|webp|gif|ico)$/i.test(name)) continue;
    const full = path.join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) files(full, found);
    else if (stat.size < 5_000_000) found.push(full);
  }
  return found;
}

test('repo source and cache do not contain private portfolio secrets', () => {
  const hits = [];
  for (const file of files(root)) {
    const text = readFileSync(file, 'utf8');
    for (const rule of banned) {
      if (rule.re.test(text)) hits.push(`${path.relative(root, file)}: ${rule.label}`);
    }
  }
  assert.deepEqual(hits, []);
});

test('site code has no hardcoded portfolio totals', () => {
  const siteFiles = files(path.join(root, 'site')).filter((file) => /\.(js|html|css|webmanifest)$/.test(file));
  const blob = siteFiles.map((file) => readFileSync(file, 'utf8')).join('\n');
  assert.doesNotMatch(blob, /totalHkd\s*[:=]\s*\d/);
  assert.doesNotMatch(blob, /HK\$\s*\d/);
  assert.doesNotMatch(blob, /範例數字充當你嘅資產[\s\S]{0,80}HK\$/);
});

test('git diff against main does not add secret patterns', () => {
  let diff = '';
  try {
    diff = execSync('git diff main -- .', { cwd: root, encoding: 'utf8', maxBuffer: 20_000_000 });
  } catch (error) {
    diff = error.stdout || '';
  }
  for (const rule of banned) {
    assert.equal(rule.re.test(diff), false, rule.label);
  }
  assert.doesNotMatch(diff, /^diff --git a\/Code\.gs/m);
  assert.doesNotMatch(diff, /site\/data\/portfolio/i);
});
