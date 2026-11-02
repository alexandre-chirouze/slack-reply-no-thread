import assert from 'node:assert/strict';
import test from 'node:test';
import { targets, connect } from '../src/cdp.mjs';

test('only Slack HTTPS page targets are eligible for injection', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => [
    { id: 'workspace', type: 'page', url: 'https://app.slack.com/client/T/C' },
    { id: 'subdomain', type: 'page', url: 'https://work.slack.com/messages/C' },
    { id: 'lookalike', type: 'page', url: 'https://evilslack.com/client/T/C' },
    { id: 'suffix', type: 'page', url: 'https://slack.com.attacker.test/' },
    { id: 'worker', type: 'service_worker', url: 'https://app.slack.com/worker.js' },
    { id: 'local', type: 'page', url: 'file:///tmp/test.html' },
    { id: 'http', type: 'page', url: 'http://app.slack.com/client/T/C' },
    { id: 'invalid', type: 'page', url: 'not a URL' },
  ] });
  try { assert.deepEqual((await targets(19247)).map(target => target.id), ['workspace', 'subdomain']); }
  finally { globalThis.fetch = original; }
});

test('debugger WebSockets reject remote destinations before connecting', async () => {
  await assert.rejects(connect('ws://192.168.1.2:9222/devtools/page/test'), /loopback/);
  await assert.rejects(connect('wss://127.0.0.1:9222/devtools/page/test'), /loopback/);
});
