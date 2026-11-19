import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createReadStream, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const siteRoot = path.join(root, 'site');
const www = '/tmp/investment-futu-www';
const artifact = '/opt/cursor/artifacts/futu-positions-mobile.png';
const sheet = JSON.parse(readFileSync(path.join(root, 'tests/fixtures/portfolio.json'), 'utf8'));
const futu = JSON.parse(readFileSync(path.join(root, 'tests/fixtures/futu.json'), 'utf8'));

function contentType(file) {
  if (file.endsWith('.html')) return 'text/html; charset=utf-8';
  if (file.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (file.endsWith('.css')) return 'text/css; charset=utf-8';
  if (file.endsWith('.json')) return 'application/json; charset=utf-8';
  if (file.endsWith('.png')) return 'image/png';
  if (file.endsWith('.webmanifest')) return 'application/manifest+json';
  return 'application/octet-stream';
}

function startStatic() {
  mkdirSync(path.join(www, 'harness'), { recursive: true });
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const rel = decodeURIComponent(url.pathname);
    if (rel.includes('..')) {
      res.writeHead(400);
      res.end();
      return;
    }
    let file;
    if (rel === '/investment' || rel.startsWith('/investment/')) {
      const inner = rel.replace(/^\/investment\/?/, '') || 'index.html';
      file = path.join(siteRoot, inner);
    } else if (rel.startsWith('/harness/')) {
      file = path.join(www, rel.slice(1));
    } else {
      res.writeHead(404);
      res.end();
      return;
    }
    try {
      if (!statSync(file).isFile()) throw new Error('missing');
      res.writeHead(200, { 'content-type': contentType(file), 'cache-control': 'no-store' });
      createReadStream(file).pipe(res);
    } catch {
      res.writeHead(404);
      res.end('missing');
    }
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

function startMock() {
  const seen = [];
  const body = JSON.stringify({
    ok: true,
    error: null,
    data: { ...sheet, futu },
  });
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/exec') && req.method === 'POST') {
      const chunks = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => {
        seen.push({
          contentType: req.headers['content-type'] || '',
          authorization: req.headers.authorization || null,
          raw: Buffer.concat(chunks).toString('utf8'),
        });
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-store',
        });
        res.end(body);
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port, seen }));
  });
}

async function withChrome(fn) {
  rmSync('/tmp/chrome-investment-futu-profile', { recursive: true, force: true });
  const chrome = spawn('google-chrome', [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--remote-debugging-port=9444',
    '--remote-allow-origins=*',
    '--user-data-dir=/tmp/chrome-investment-futu-profile',
    'about:blank',
  ], { stdio: 'ignore' });
  let ws;
  try {
    let version;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      try {
        const response = await fetch('http://127.0.0.1:9444/json/version');
        version = await response.json();
        break;
      } catch {
        await delay(100);
      }
    }
    if (!version?.webSocketDebuggerUrl) throw new Error('chrome did not start');
    ws = new WebSocket(version.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve);
      ws.addEventListener('error', reject);
    });
    let seq = 0;
    const pending = new Map();
    ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (!message.id || !pending.has(message.id)) return;
      const waiter = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) waiter.reject(new Error(JSON.stringify(message.error)));
      else waiter.resolve(message.result);
    });
    const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params, sessionId }));
    });
    await fn(send);
  } finally {
    ws?.close();
    chrome.kill('SIGKILL');
  }
}

async function openPage(send, url) {
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Page.enable', {}, sessionId);
  await send('Runtime.enable', {}, sessionId);
  await send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 2,
    mobile: true,
  }, sessionId);
  await send('Page.navigate', { url }, sessionId);
  await send('Runtime.evaluate', {
    expression: 'new Promise((resolve) => { if (document.readyState === "complete") resolve(true); else addEventListener("load", () => resolve(true)); })',
    awaitPromise: true,
    returnByValue: true,
  }, sessionId);
  return sessionId;
}

async function evaluate(send, sessionId, expression) {
  const result = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  }, sessionId);
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}

test('mobile dashboard renders the fixture from a mocked adapter', async () => {
  mkdirSync('/opt/cursor/artifacts', { recursive: true });
  const web = await startStatic();
  const mock = await startMock();
  const endpoint = `http://127.0.0.1:${mock.port}/exec`;
  writeFileSync(path.join(www, 'harness', 'seed.html'), `<!DOCTYPE html>
<meta charset="utf-8">
<p id="status">seeding</p>
<script>
const req = indexedDB.open('investment-tracker-v2', 1);
req.onupgradeneeded = () => {
  if (!req.result.objectStoreNames.contains('kv')) req.result.createObjectStore('kv');
};
req.onerror = () => { document.querySelector('#status').textContent = 'idb-error'; };
req.onsuccess = () => {
  const db = req.result;
  const tx = db.transaction('kv', 'readwrite');
  tx.objectStore('kv').put({
    endpoint: ${JSON.stringify(endpoint)},
    token: 'synthetic-token',
    savedAt: '2026-11-19T01:00:00.000Z'
  }, 'connection');
  tx.oncomplete = () => { document.querySelector('#status').textContent = 'seeded'; };
};
</script>`);
  try {
    await withChrome(async (send) => {
      const sessionId = await openPage(send, `http://127.0.0.1:${web.port}/harness/seed.html`);
      const seeded = await evaluate(send, sessionId, `new Promise((resolve) => {
        const start = Date.now();
        const tick = () => {
          const text = document.querySelector('#status')?.textContent || '';
          if (text === 'seeded' || text === 'idb-error' || Date.now() - start > 5000) resolve(text);
          else setTimeout(tick, 50);
        };
        tick();
      })`);
      assert.equal(seeded, 'seeded');
      await send('Page.navigate', { url: `http://127.0.0.1:${web.port}/investment/` }, sessionId);
      await evaluate(send, sessionId, `new Promise((resolve) => { if (document.readyState === "complete") resolve(true); else addEventListener("load", () => resolve(true)); })`);
      const ready = await evaluate(send, sessionId, `new Promise((resolve) => {
        const start = Date.now();
        const tick = () => {
          const text = document.body ? document.body.innerText : '';
          if (text.includes('Futu 實盤持倉') && text.includes('NVIDIA') && text.includes('試算表手動持倉')) {
            resolve({ ok: true, href: location.href });
          } else if (Date.now() - start > 12000) {
            resolve({ ok: false, href: location.href, text: text.slice(0, 800) });
          } else {
            setTimeout(tick, 100);
          }
        };
        tick();
      })`);
      assert.equal(ready.ok, true, JSON.stringify(ready));
      const measure = await evaluate(send, sessionId, `(() => {
        const end = document.querySelector('#sheet-overview');
        const bottom = Math.ceil(end.getBoundingClientRect().bottom + window.scrollY + 20);
        return {
          bottom,
          client: document.documentElement.clientWidth,
          scroll: document.documentElement.scrollWidth,
          stale: document.body.innerText.includes('超過 24 小時'),
          put: document.body.innerText.includes('162.50P'),
          call: document.body.innerText.includes('162.50C'),
          tesla: document.body.innerText.includes('Tesla'),
          legacyTrades: document.body.innerText.includes('試算表交易紀錄'),
          scripts: document.querySelectorAll('#futu script, #futu img').length,
        };
      })()`);
      assert.equal(measure.put, true);
      assert.equal(measure.call, true);
      assert.equal(measure.tesla, true);
      assert.equal(measure.legacyTrades, true);
      assert.equal(measure.scripts, 0);
      assert.ok(measure.scroll <= measure.client + 1, `overflow ${measure.scroll} > ${measure.client}`);
      await send('Emulation.setDeviceMetricsOverride', {
        width: 390,
        height: Math.max(844, measure.bottom),
        deviceScaleFactor: 2,
        mobile: true,
      }, sessionId);
      await evaluate(send, sessionId, 'window.scrollTo(0, 0); true');
      const shot = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
      writeFileSync(artifact, Buffer.from(shot.data, 'base64'));
    });
    assert.equal(mock.seen.length >= 1, true);
    assert.equal(mock.seen[0].authorization, null);
    assert.match(mock.seen[0].contentType, /^text\/plain;charset=utf-8/i);
    const payload = JSON.parse(mock.seen[0].raw);
    assert.equal(payload.action, 'getPortfolio');
    assert.equal(payload.token, 'synthetic-token');
    assert.equal(statSync(artifact).size > 1000, true);
  } finally {
    web.server.close();
    mock.server.close();
  }
});
