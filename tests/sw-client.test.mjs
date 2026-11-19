import assert from 'node:assert/strict';
import test from 'node:test';
import { attachServiceWorker, requestSkipWaiting } from '../site/js/sw-client.js';

test('a waiting worker prompts only when a controller exists, and activation reloads', () => {
  const prompts = [];
  let reloaded = 0;
  const events = {};
  const waiting = { postMessage(data) { prompts.push(data); } };
  const reg = {
    waiting,
    installing: null,
    update() { return Promise.resolve(); },
    addEventListener(type, fn) { events[type] = fn; },
  };
  const sw = {
    controller: {},
    addEventListener(type, fn) { events[type] = fn; },
  };
  attachServiceWorker(reg, sw, {
    onPrompt(worker) { prompts.push(worker); },
    reload() { reloaded += 1; },
    listenVisibility() {},
  });
  assert.equal(prompts[0], waiting);
  requestSkipWaiting(waiting);
  assert.deepEqual(prompts[1], { type: 'SKIP_WAITING' });
  events.controllerchange();
  assert.equal(reloaded, 1);
  events.controllerchange();
  assert.equal(reloaded, 1);
});

test('the first install does not prompt or reload', () => {
  const prompts = [];
  let reloaded = 0;
  const events = {};
  const reg = {
    waiting: { postMessage() {} },
    addEventListener() {},
  };
  const sw = {
    controller: null,
    addEventListener(type, fn) { events[type] = fn; },
  };
  attachServiceWorker(reg, sw, {
    onPrompt(worker) { prompts.push(worker); },
    reload() { reloaded += 1; },
    listenVisibility() {},
  });
  assert.equal(prompts.length, 0);
  events.controllerchange();
  assert.equal(reloaded, 0);
});

test('updatefound offers the banner once the new worker is installed', () => {
  const prompts = [];
  const workerEvents = {};
  const installing = {
    state: 'installing',
    addEventListener(type, fn) { workerEvents[type] = fn; },
  };
  let found;
  const reg = {
    waiting: null,
    installing,
    addEventListener(type, fn) { if (type === 'updatefound') found = fn; },
  };
  const sw = { controller: {}, addEventListener() {} };
  attachServiceWorker(reg, sw, {
    onPrompt(worker) { prompts.push(worker); },
    listenVisibility() {},
  });
  found();
  installing.state = 'installed';
  workerEvents.statechange();
  assert.equal(prompts[0], installing);
});
