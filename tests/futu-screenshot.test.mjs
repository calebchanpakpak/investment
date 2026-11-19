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
const artifactDir = '/opt/cursor/artifacts';
const sheet = JSON.parse(readFileSync(path.join(root, 'tests/fixtures/portfolio.json'), 'utf8'));
const futu = JSON.parse(readFileSync(path.join(root, 'tests/fixtures/futu.json'), 'utf8'));
let portfolioMode = 'fresh';

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
        const block = portfolioMode === 'warning'
          ? { ...futu, syncedAt: '2026-11-18T10:00:00+02:00' }
          : futu;
        res.end(JSON.stringify({ ok: true, error: null, data: { ...sheet, futu: block } }));
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
    const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params, sessionId }));
    });
    ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.method === 'Fetch.requestPaused') {
        const { requestId, request } = message.params;
        const url = request.url || '';
        if (url.includes('open.er-api.com') || url.includes('api.frankfurter.app')) {
          const body = JSON.stringify({
            result: 'success',
            base_code: 'USD',
            time_last_update_unix: Math.floor(Date.parse('2026-11-19T00:00:02Z') / 1000),
            rates: { HKD: 7.78 },
          });
          send('Fetch.fulfillRequest', {
            requestId,
            responseCode: 200,
            responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
            body: Buffer.from(body).toString('base64'),
          }, message.sessionId).catch(() => {});
          return;
        }
        send('Fetch.continueRequest', { requestId }, message.sessionId).catch(() => {});
        return;
      }
      if (!message.id || !pending.has(message.id)) return;
      const waiter = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) waiter.reject(new Error(JSON.stringify(message.error)));
      else waiter.resolve(message.result);
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
  await send('Emulation.setTouchEmulationEnabled', { enabled: true }, sessionId);
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `(() => {
      const original = window.fetch.bind(window);
      window.fetch = (input, init) => {
        const href = String(input && input.url ? input.url : input);
        if (href.includes('open.er-api.com') || href.includes('api.frankfurter.app')) {
          const body = JSON.stringify({
            result: 'success',
            base_code: 'USD',
            time_last_update_unix: ${Math.floor(Date.parse('2026-11-19T00:00:02Z') / 1000)},
            rates: { HKD: 7.78 }
          });
          return Promise.resolve(new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } }));
        }
        return original(input, init);
      };
    })();`,
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
      await send('Page.navigate', { url: `http://127.0.0.1:${web.port}/investment/#overview` }, sessionId);
      await evaluate(send, sessionId, `new Promise((resolve) => { if (document.readyState === "complete") resolve(true); else addEventListener("load", () => resolve(true)); })`);
      const captureTab = async (hash, marker, file) => {
        const shown = await evaluate(send, sessionId, `new Promise((resolve) => {
          if (location.hash !== ${JSON.stringify(hash)}) location.hash = ${JSON.stringify(hash)};
          const start = Date.now();
          const tick = () => {
            const text = document.body ? document.body.innerText : '';
            const title = document.querySelector('#section-title')?.textContent || '';
            if (text.includes(${JSON.stringify(marker)}) || Date.now() - start > 12000) {
              resolve({
                ok: text.includes(${JSON.stringify(marker)}),
                title,
                hash: location.hash,
                text,
                scroll: document.documentElement.scrollWidth,
                client: document.documentElement.clientWidth,
                height: Math.ceil(document.documentElement.scrollHeight),
              });
            } else setTimeout(tick, 100);
          };
          tick();
        })`);
        assert.equal(shown.ok, true, JSON.stringify(shown));
        assert.ok(shown.scroll <= shown.client + 1, `overflow ${shown.scroll} > ${shown.client}`);
        await send('Emulation.setDeviceMetricsOverride', {
          width: 390,
          height: Math.max(844, shown.height),
          deviceScaleFactor: 2,
          mobile: true,
        }, sessionId);
        await evaluate(send, sessionId, 'window.scrollTo(0, 0); true');
        const shot = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
        writeFileSync(path.join(artifactDir, file), Buffer.from(shot.data, 'base64'));
        return shown;
      };
      const overview = await captureTab('#overview', '≈ HK$ 81,558.98', 'tab-overview-mobile.png');
      assert.match(overview.text, /US\$ 10,483\.16/);
      assert.match(overview.text, /1 USD = 7\.78 HKD/);
      assert.equal(overview.title, '總覽');
      const positions = await captureTab('#portfolio', 'Futu 實盤持倉', 'tab-positions-mobile.png');
      assert.match(positions.text, /NVIDIA/);
      assert.match(positions.text, /162\.50P/);
      assert.match(positions.text, /≈ HK\$ 81,558\.98/);
      writeFileSync(path.join(artifactDir, 'futu-positions-mobile.png'), readFileSync(path.join(artifactDir, 'tab-positions-mobile.png')));
      await captureTab('#trades', 'Futu 成交', 'tab-trades-mobile.png');
      await captureTab('#market', '代號或公司名稱', 'tab-market-mobile.png');
      const settings = await captureTab('#settings', '立即更新', 'tab-settings-mobile.png');
      assert.match(settings.text, /上次更新/);
      await send('Emulation.setDeviceMetricsOverride', {
        width: 390,
        height: 844,
        deviceScaleFactor: 2,
        mobile: true,
      }, sessionId);
      await evaluate(send, sessionId, `new Promise((resolve) => {
        location.hash = '#overview';
        const tick = () => {
          if (document.querySelector('#section-title')?.textContent === '總覽') resolve(true);
          else setTimeout(tick, 50);
        };
        tick();
      })`);
      await send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ x: 320, y: 400, id: 1 }],
      }, sessionId);
      await send('Input.dispatchTouchEvent', {
        type: 'touchEnd',
        touchPoints: [{ x: 40, y: 410, id: 1 }],
      }, sessionId);
      const swiped = await evaluate(send, sessionId, `new Promise((resolve) => {
        const start = Date.now();
        const tick = () => {
          const title = document.querySelector('#section-title')?.textContent || '';
          if (title === '持倉' || Date.now() - start > 2000) resolve({ title, hash: location.hash });
          else setTimeout(tick, 50);
        };
        tick();
      })`);
      assert.equal(swiped.title, '持倉', JSON.stringify(swiped));
      await evaluate(send, sessionId, `location.hash = '#settings'`);
      const settingsRoute = await evaluate(send, sessionId, `new Promise((resolve) => {
        const start = Date.now();
        const tick = () => {
          const text = document.body.innerText;
          if (text.includes('立即更新') || Date.now() - start > 4000) resolve({ hash: location.hash, ok: text.includes('儲存設定') });
          else setTimeout(tick, 50);
        };
        tick();
      })`);
      assert.equal(settingsRoute.hash, '#settings');
      assert.equal(settingsRoute.ok, true);
      await evaluate(send, sessionId, `history.back()`);
      const back = await evaluate(send, sessionId, `new Promise((resolve) => {
        const start = Date.now();
        const tick = () => {
          const title = document.querySelector('#section-title')?.textContent || '';
          if (title === '持倉' || Date.now() - start > 4000) resolve({ title, hash: location.hash });
          else setTimeout(tick, 50);
        };
        tick();
      })`);
      assert.equal(back.title, '持倉');

      portfolioMode = 'warning';
      await evaluate(send, sessionId, `new Promise((resolve) => {
        const done = () => resolve(true);
        const req = indexedDB.deleteDatabase('investment-v2-snapshot');
        req.onsuccess = done;
        req.onerror = done;
        req.onblocked = done;
        setTimeout(done, 1000);
      })`);
      await send('Page.reload', { ignoreCache: true }, sessionId);
      await evaluate(send, sessionId, `new Promise((resolve) => { if (document.readyState === "complete") resolve(true); else addEventListener("load", () => resolve(true)); })`);
      const warning = await captureTab('#overview', '上次自動同步', 'tab-sync-warning-mobile.png');
      assert.match(warning.text, /Futu OpenD/);
      assert.match(warning.text, /同步未成功/);

      await send('Emulation.setDeviceMetricsOverride', {
        width: 1280,
        height: 800,
        deviceScaleFactor: 1,
        mobile: false,
      }, sessionId);
      portfolioMode = 'fresh';
      await evaluate(send, sessionId, `location.hash = '#overview'`);
      const desktop = await evaluate(send, sessionId, `new Promise((resolve) => {
        const start = Date.now();
        const tick = () => {
          const text = document.body.innerText;
          if (text.includes('US$') || Date.now() - start > 8000) {
            const bar = document.querySelector('.tabbar');
            resolve({
              scroll: document.documentElement.scrollWidth,
              client: document.documentElement.clientWidth,
              position: getComputedStyle(bar).position,
              text: text.slice(0, 200),
            });
          } else setTimeout(tick, 100);
        };
        tick();
      })`);
      assert.ok(desktop.scroll <= desktop.client + 1, `desktop overflow ${desktop.scroll}`);
      assert.equal(desktop.position, 'sticky');
      const desktopShot = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
      writeFileSync(path.join(artifactDir, 'tab-overview-desktop.png'), Buffer.from(desktopShot.data, 'base64'));
    });
    assert.equal(mock.seen.length >= 1, true);
    assert.equal(mock.seen[0].authorization, null);
    assert.match(mock.seen[0].contentType, /^text\/plain;charset=utf-8/i);
    const payload = JSON.parse(mock.seen[0].raw);
    assert.equal(payload.action, 'getPortfolio');
    assert.equal(payload.token, 'synthetic-token');
    assert.equal(Object.hasOwn(payload, 'portfolio'), false);
    assert.equal(statSync(path.join(artifactDir, 'tab-overview-mobile.png')).size > 1000, true);
    assert.equal(statSync(path.join(artifactDir, 'tab-sync-warning-mobile.png')).size > 1000, true);
  } finally {
    web.server.close();
    mock.server.close();
  }
});
