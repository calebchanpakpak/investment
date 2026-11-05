import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createReadStream, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const siteRoot = path.join(root, 'site');
const www = '/tmp/investment-www';
const artifactDir = '/opt/cursor/artifacts';

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
    let rel = decodeURIComponent(url.pathname);
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
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/exec') && req.method === 'POST') {
      const chunks = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => {
        seen.push({
          method: req.method,
          contentType: req.headers['content-type'] || '',
          authorization: req.headers.authorization || null,
          body: Buffer.concat(chunks).toString('utf8'),
        });
        res.writeHead(302, {
          Location: `http://127.0.0.1:${server.address().port}/echo`,
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-store',
        });
        res.end();
      });
      return;
    }
    if (req.url.startsWith('/echo')) {
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store',
      });
      res.end(JSON.stringify({
        ok: true,
        error: null,
        data: {
          overview: { totalHkd: 1, totalUsd: 1, netDeposit: 1, pnlHkd: 0, pnlPct: 0, rate: 1, lastUpdated: '2026-01-01' },
          holdings: [],
          monthly: [],
          trades: [],
        },
      }));
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
  rmSync('/tmp/chrome-investment-profile', { recursive: true, force: true });
  const chrome = spawn('google-chrome', [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--remote-debugging-port=9333',
    '--remote-allow-origins=*',
    '--user-data-dir=/tmp/chrome-investment-profile',
    'about:blank',
  ], { stdio: 'ignore' });
  let ws;
  try {
    let version;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      try {
        const response = await fetch('http://127.0.0.1:9333/json/version');
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

async function openPage(send, url, width, height) {
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Page.enable', {}, sessionId);
  await send('Runtime.enable', {}, sessionId);
  await send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: width < 500,
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
  if (result.exceptionDetails) {
    throw new Error(JSON.stringify(result.exceptionDetails));
  }
  return result.result.value;
}

async function screenshot(send, sessionId, file, fullPage) {
  const options = { format: 'png' };
  if (fullPage) {
    const metrics = await send('Page.getLayoutMetrics', {}, sessionId);
    const width = Math.ceil(metrics.cssContentSize?.width || metrics.contentSize.width);
    const height = Math.ceil(metrics.cssContentSize?.height || metrics.contentSize.height);
    options.captureBeyondViewport = true;
    options.clip = { x: 0, y: 0, width, height, scale: 1 };
  }
  const shot = await send('Page.captureScreenshot', options, sessionId);
  writeFileSync(file, Buffer.from(shot.data, 'base64'));
}

test('phone and desktop layouts do not overflow, and CORS POST is readable', async () => {
  mkdirSync(artifactDir, { recursive: true });
  const web = await startStatic();
  const mock = await startMock();
  writeFileSync(path.join(www, 'harness', 'cors.html'), `<!DOCTYPE html>
<meta charset="utf-8">
<div id="out">waiting</div>
<script type="module">
import { callPortfolio } from '/investment/js/portfolio.js';
const out = document.querySelector('#out');
try {
  const data = await callPortfolio({
    endpoint: ${JSON.stringify(`http://127.0.0.1:${mock.port}/exec`)},
    token: 'synthetic-token'
  });
  out.textContent = JSON.stringify({ ok: true, totalHkd: data.overview.totalHkd });
} catch (error) {
  out.textContent = 'error:' + (error && error.code);
}
</script>`);
  try {
    await withChrome(async (send) => {
      const phone = await openPage(send, `http://127.0.0.1:${web.port}/investment/#q=AAPL`, 390, 844);
      const phoneMeasure = await evaluate(send, phone, `new Promise((resolve) => {
        const start = Date.now();
        const tick = () => {
          const text = document.body.innerText;
          const ready = text.includes('CNBC') || text.includes('新聞快取讀取失敗');
          if (ready || Date.now() - start > 8000) {
            const link = document.querySelector('#news a, #news .text-link, a[href*="cnbc.com"]');
            const button = document.querySelector('.button, .nav a');
            const box = button.getBoundingClientRect();
            resolve({
              scroll: document.documentElement.scrollWidth,
              client: document.documentElement.clientWidth,
              tap: box.height,
              text,
              href: link ? link.href : '',
              unconfigured: text.includes('未連接投資組合'),
              rules: text.includes('一般規則考慮') && text.includes('唔係人工智能'),
              delayed: text.includes('唔係即時'),
            });
          } else {
            setTimeout(tick, 100);
          }
        };
        tick();
      })`);
      assert.equal(phoneMeasure.unconfigured, true);
      assert.equal(phoneMeasure.rules, true);
      assert.equal(phoneMeasure.delayed, true);
      assert.ok(phoneMeasure.scroll <= phoneMeasure.client + 1, `overflow ${phoneMeasure.scroll} > ${phoneMeasure.client}`);
      assert.ok(phoneMeasure.tap >= 44, `tap ${phoneMeasure.tap}`);
      assert.match(phoneMeasure.text, /未連接投資組合/);
      assert.doesNotMatch(phoneMeasure.text, /HK\$\s*\d/);
      assert.ok(phoneMeasure.href.includes('cnbc.com') || phoneMeasure.text.includes('新聞快取讀取失敗'));
      await screenshot(send, phone, path.join(artifactDir, 'investment-390.png'), false);
      await screenshot(send, phone, path.join(artifactDir, 'investment-390-full.png'), true);
      await evaluate(send, phone, `new Promise((resolve) => {
        const start = Date.now();
        const tick = () => {
          const text = document.body.innerText;
          if (text.includes('AAPL') || text.includes('代號名單未能載入') || Date.now() - start > 8000) {
            document.querySelector('#search').scrollIntoView({block:'start'});
            resolve(true);
          } else setTimeout(tick, 100);
        };
        tick();
      })`);
      await screenshot(send, phone, path.join(artifactDir, 'investment-390-search.png'), false);

      const desktop = await openPage(send, `http://127.0.0.1:${web.port}/investment/#q=AAPL`, 1280, 900);
      const desktopMeasure = await evaluate(send, desktop, `new Promise((resolve) => {
        const start = Date.now();
        const tick = () => {
          const text = document.body.innerText;
          const ready = text.includes('SEC') || text.includes('代號名單未能載入');
          if (ready || Date.now() - start > 8000) {
            resolve({
              scroll: document.documentElement.scrollWidth,
              client: document.documentElement.clientWidth,
              text,
            });
          } else setTimeout(tick, 100);
        };
        tick();
      })`);
      assert.ok(desktopMeasure.scroll <= desktopMeasure.client + 1);
      assert.match(desktopMeasure.text, /未連接投資組合/);
      assert.doesNotMatch(desktopMeasure.text, /HK\$\s*\d/);
      await screenshot(send, desktop, path.join(artifactDir, 'investment-desktop.png'), false);
      await screenshot(send, desktop, path.join(artifactDir, 'investment-desktop-full.png'), true);
      await evaluate(send, desktop, "document.querySelector('#search').scrollIntoView({block:'start'})");
      await screenshot(send, desktop, path.join(artifactDir, 'investment-desktop-search.png'), false);

      const harness = await openPage(send, `http://127.0.0.1:${web.port}/harness/cors.html`, 800, 600);
      const cors = await evaluate(send, harness, `new Promise((resolve) => {
        const tick = () => {
          const text = document.querySelector('#out').textContent;
          if (text !== 'waiting') resolve(text);
          else setTimeout(tick, 50);
        };
        setTimeout(() => resolve(document.querySelector('#out').textContent), 5000);
        tick();
      })`);
      assert.equal(cors, '{"ok":true,"totalHkd":1}');
    });
    assert.equal(mock.seen.length, 1);
    assert.equal(mock.seen[0].method, 'POST');
    assert.equal(mock.seen[0].authorization, null);
    assert.match(mock.seen[0].contentType, /^text\/plain;charset=utf-8/i);
    const body = JSON.parse(mock.seen[0].body);
    assert.equal(body.action, 'getPortfolio');
    assert.equal(body.token, 'synthetic-token');
    assert.equal(Object.hasOwn(body, 'Authorization'), false);
  } finally {
    web.server.close();
    mock.server.close();
  }
});
