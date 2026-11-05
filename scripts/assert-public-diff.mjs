import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const allowed = new Set(['site/data/market-cache.json', 'site/data/symbols.json']);
const status = execSync('git status --porcelain', { encoding: 'utf8' });
for (const line of status.split('\n').filter(Boolean)) {
  const file = line.slice(3).trim().replace(/^"|"$/g, '');
  if (!allowed.has(file)) {
    console.error(`Refusing to keep unexpected change: ${file}`);
    process.exit(1);
  }
}

const banned = [
  /script\.google\.com/i,
  /docs\.google\.com\/spreadsheets/i,
  /AIza[0-9A-Za-z_-]{10,}/,
  /BEGIN (?:RSA |OPENSSH )?PRIVATE KEY/,
  /\u9ad8\u9a30/,
  /\u83ef\u590f\u6e2f\u5143/,
];

for (const file of allowed) {
  let text = '';
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  for (const pattern of banned) {
    if (pattern.test(text)) {
      console.error(`${file} matched ${pattern}`);
      process.exit(1);
    }
  }
}

console.log('public cache diff is limited to sanitized market files');
