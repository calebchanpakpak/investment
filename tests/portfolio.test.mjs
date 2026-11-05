import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPortfolioRequest, callPortfolio, readPortfolioResponse } from '../site/js/portfolio.js';

const settings = {
  endpoint: 'https://script.google.com/macros/s/EXAMPLEDEPLOYMENT/exec',
  token: 'synthetic-token',
};

test('portfolio request is a simple POST without an Authorization header', () => {
  const request = buildPortfolioRequest(settings);
  assert.equal(request.init.method, 'POST');
  assert.equal(request.init.redirect, 'follow');
  assert.equal(request.init.cache, 'no-store');
  assert.equal(request.init.headers['Content-Type'], 'text/plain;charset=utf-8');
  assert.equal(request.init.headers.Authorization, undefined);
  assert.equal(request.init.mode, undefined);
  const body = JSON.parse(request.init.body);
  assert.deepEqual(body, { action: 'getPortfolio', payload: {}, token: 'synthetic-token' });
});

test('endpoint allowlist fails closed', () => {
  assert.throws(() => buildPortfolioRequest({ endpoint: 'https://evil.example/exec', token: 'x' }), /invalid_endpoint/);
  assert.throws(() => buildPortfolioRequest({ endpoint: 'https://script.google.com/macros/s/ABC/exec?token=1', token: 'x' }), /invalid_endpoint/);
  assert.throws(() => buildPortfolioRequest({ endpoint: 'http://script.google.com/macros/s/ABC/exec', token: 'x' }), /invalid_endpoint/);
  assert.throws(() => buildPortfolioRequest({ token: 'x' }), /not_configured/);
  assert.throws(() => buildPortfolioRequest(settings, 'sendEmail'), /action_not_allowed/);
});

test('opaque and failed responses are not treated as portfolio data', async () => {
  await assert.rejects(readPortfolioResponse({ type: 'opaque', json: async () => ({ ok: true, data: { overview: {} } }) }), /opaque_response/);
  await assert.rejects(readPortfolioResponse({ type: 'basic', json: async () => ({ ok: false, error: 'unauthorized', data: null }) }), /unauthorized/);
  const data = await callPortfolio(settings, async (url, init) => {
    assert.equal(init.headers.Authorization, undefined);
    assert.equal(new URL(url).hostname, 'script.google.com');
    return { type: 'basic', json: async () => ({ ok: true, error: null, data: { overview: { totalHkd: 1 } } }) };
  });
  assert.equal(data.overview.totalHkd, 1);
});
