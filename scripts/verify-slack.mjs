import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { connect, evaluate, targets } from '../src/cdp.mjs';

let state;
try { state = JSON.parse(await readFile(join(homedir(), 'Library/Application Support/Slack Quote Reply/state.json'), 'utf8')); }
catch { /* Explicit port can select a development session. */ }
const port = Number(process.env.SLACK_QUOTE_PORT || state?.port);
assert(port, 'Start Slack Quote Reply first, or set SLACK_QUOTE_PORT.');
const pages = await targets(port);
assert(pages.length, 'Open a Slack conversation first.');
// One page and one test editor at a time. No messages are sent.
const client = await connect(pages[0].webSocketDebuggerUrl);
try {
  await evaluate(client, await readFile(new URL('../src/quote-reply.js', import.meta.url), 'utf8'));
  const threadMode = process.argv.includes('--thread');
  const paneSelector = threadMode ? '[data-qa="threads_flexpane"]' : '.p-view_contents--primary [data-qa="message_pane"]';
  const point = await evaluate(client, `(() => {
    const pane = document.querySelector(${JSON.stringify(paneSelector)});
    const bounds = pane?.getBoundingClientRect();
    for (const row of pane?.querySelectorAll('[data-qa="message_container"]') || []) {
      if (!window.__slackQuoteReply.messageLink(row)) continue;
      const r = row.getBoundingClientRect();
      const point = { x: r.x + Math.min(100, r.width / 2), y: Math.max(r.top + 20, bounds.top + 30) };
      if (point.y >= Math.min(r.bottom, bounds.bottom, innerHeight) - 2) continue;
      if (document.elementFromPoint(point.x, point.y)?.closest('[data-qa="message_container"]') === row) return point;
    }
    return null;
  })()`);
  assert(point, 'Open a conversation containing a visible text message.');
  await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
  await new Promise(resolve => setTimeout(resolve, 300));
  const result = await evaluate(client, await readFile(new URL('../test/editor-checks.js', import.meta.url), 'utf8'));
  for (const name of result.passed) console.log(`PASS ${name}`);
  if (threadMode) {
    const routing = await evaluate(client, await readFile(new URL('../test/thread-checks.js', import.meta.url), 'utf8'));
    for (const name of routing.passed) console.log(`PASS ${name}`);
  }
  // Re-evaluation must not duplicate a button or observer.
  await evaluate(client, await readFile(new URL('../src/quote-reply.js', import.meta.url), 'utf8'));
  assert(await evaluate(client, `Array.from(document.querySelectorAll('[data-qa="message-actions"]')).every(bar => bar.querySelectorAll('[data-slack-quote-reply]').length <= 1)`));
  console.log('PASS Repeated injection does not duplicate buttons');
} finally { client.close(); }
