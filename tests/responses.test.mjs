import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPortfolioRequest } from '../site/js/portfolio.js';
import {
  flushOutbox,
  isUnsupported,
  mergeResponses,
  newClientId,
  normalizeTeamResponses,
  readSubmitResponse,
  reconcileOutbox,
  responseStatusLabel,
} from '../site/js/responses.js';

const settings = {
  endpoint: 'https://script.google.com/macros/s/EXAMPLEDEPLOYMENT/exec',
  token: 'synthetic-token',
};

test('submitResponse uses the same token body and no Authorization header', () => {
  const request = buildPortfolioRequest(settings, 'submitResponse', {
    clientId: 'cid-1',
    kind: 'approval',
    itemId: 'ap-block',
    decision: 'approve',
    text: '假備註',
    createdAt: '2026-11-20T00:00:00.000Z',
  });
  assert.equal(request.init.headers.Authorization, undefined);
  assert.equal(request.init.headers['Content-Type'], 'text/plain;charset=utf-8');
  assert.deepEqual(JSON.parse(request.init.body), {
    action: 'submitResponse',
    response: {
      clientId: 'cid-1',
      kind: 'approval',
      itemId: 'ap-block',
      decision: 'approve',
      text: '假備註',
      createdAt: '2026-11-20T00:00:00.000Z',
    },
    token: 'synthetic-token',
  });
  assert.throws(() => buildPortfolioRequest(settings, 'sendEmail'), /action_not_allowed/);
});

test('server responses dedupe by clientId and surface status labels', async () => {
  const server = normalizeTeamResponses({
    teamResponses: [
      { id: 'srv-1', clientId: 'cid-1', kind: 'message', text: '假回覆', to: 'Iris-bot', createdAt: '2026-11-20T01:00:00Z', status: 'seen', reply: '收到' },
      { id: 'srv-2', clientId: 'cid-1', kind: 'message', text: '後寫嘅同一張', createdAt: '2026-11-20T02:00:00Z', status: 'actioned' },
    ],
  });
  const merged = mergeResponses([
    { clientId: 'cid-1', kind: 'message', text: '假回覆', localStatus: 'pending', createdAt: '2026-11-20T01:00:00Z' },
    { clientId: 'cid-2', kind: 'approval', itemId: 'ap-block', decision: 'approve', localStatus: 'failed', createdAt: '2026-11-20T03:00:00Z' },
  ], server);
  assert.equal(merged.filter((item) => item.clientId === 'cid-1').length, 1);
  const kept = merged.find((item) => item.clientId === 'cid-1');
  assert.equal(kept.localStatus, 'sent');
  assert.equal(kept.serverStatus, 'actioned');
  assert.equal(responseStatusLabel(kept), '已處理');
  assert.equal(responseStatusLabel({ localStatus: 'pending' }), '等候送出');
  assert.equal(responseStatusLabel({ localStatus: 'unsupported' }), '後台未支援');
  assert.equal(responseStatusLabel({ localStatus: 'failed' }), '送出失敗，會再試');
  const reconciled = reconcileOutbox([
    { clientId: 'cid-1', localStatus: 'pending' },
    { clientId: 'cid-2', localStatus: 'failed' },
  ], server);
  assert.equal(reconciled[0].localStatus, 'sent');
  assert.equal(reconciled[1].localStatus, 'failed');
  assert.equal(isUnsupported({ code: 'unknown_action' }), true);
  assert.match(newClientId(), /.+/) ;
  await assert.rejects(readSubmitResponse({
    type: 'basic',
    json: async () => ({ ok: false, error: 'unknown_action' }),
  }), /unknown_action/);
});

test('offline stays pending, a network failure retries, and an unknown action stops', async () => {
  const pending = [{ clientId: 'cid-3', kind: 'message', text: '離線', createdAt: '2026-11-20T00:00:00Z', localStatus: 'pending' }];
  const offline = await flushOutbox({ items: pending, settings, online: false, fetchImpl: async () => { throw new Error('should not send'); } });
  assert.equal(offline[0].localStatus, 'pending');

  let calls = 0;
  const flaky = await flushOutbox({
    items: offline,
    settings,
    online: true,
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) throw new Error('down');
      return { type: 'basic', json: async () => ({ ok: true, response: { id: 'srv-3', clientId: 'cid-3', status: 'received' } }) };
    },
  });
  assert.equal(flaky[0].localStatus, 'failed');
  const sent = await flushOutbox({
    items: flaky,
    settings,
    online: true,
    fetchImpl: async () => ({ type: 'basic', json: async () => ({ ok: true, response: { id: 'srv-3', clientId: 'cid-3', status: 'received' } }) }),
  });
  assert.equal(sent[0].localStatus, 'sent');
  assert.equal(sent[0].serverStatus, 'received');
  assert.equal(responseStatusLabel(sent[0]), '已收到');

  const blocked = await flushOutbox({
    items: [{ clientId: 'cid-4', kind: 'approval', decision: 'reject', localStatus: 'pending', createdAt: '2026-11-20T00:00:00Z' }],
    settings,
    online: true,
    fetchImpl: async () => ({ type: 'basic', json: async () => ({ ok: false, error: 'unknown_action' }) }),
  });
  assert.equal(blocked[0].localStatus, 'unsupported');
  const stayed = await flushOutbox({
    items: blocked,
    settings,
    online: true,
    fetchImpl: async () => { throw new Error('should not retry'); },
  });
  assert.equal(stayed[0].localStatus, 'unsupported');
});
