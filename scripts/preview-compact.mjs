import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { connect, evaluate } from '../src/cdp.mjs';

// Uses a separate disposable browser profile and a local fixture. Never connects
// to Slack, replaces the installed script, or sends messages.
const output = resolve(process.argv[2] || 'preview-output');
const chrome = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const profile = await mkdtemp(join(tmpdir(), 'slack-reply-preview-'));
const browser = spawn(chrome, ['--headless=new', '--no-first-run', '--no-default-browser-check',
  '--disable-extensions', '--disable-background-networking', '--disable-gpu',
  '--renderer-process-limit=1', '--remote-debugging-address=127.0.0.1',
  '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
let launchError;
browser.on('error', error => { launchError = error; });
const closed = new Promise(resolve => browser.once('close', resolve));
let client;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
try {
  let port;
  for (let i = 0; i < 100; i++) {
    if (launchError) throw launchError;
    try { port = Number((await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); } catch { /* Starting. */ }
    if (port) break;
    await delay(100);
  }
  assert(port, 'The isolated Chrome preview did not start. Set CHROME_PATH if needed.');
  const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  client = await connect(pages.find(page => page.type === 'page').webSocketDebuggerUrl);
  await client.send('Page.enable');
  await client.send('Emulation.setDeviceMetricsOverride', { width: 1040, height: 900, deviceScaleFactor: 2, mobile: false });
  await client.send('Page.navigate', { url: pathToFileURL(resolve('test/fixtures/compact-preview.html')).href });
  for (let i = 0; i < 100; i++) {
    if (await evaluate(client, 'document.readyState === "complete" && !!document.querySelector("main")')) break;
    await delay(50);
  }
  const source = await readFile(new URL('../src/quote-reply.js', import.meta.url), 'utf8');
  await evaluate(client, source);
  await evaluate(client, `(() => {
    window.nativeClicks = 0;
    document.querySelector('[data-qa="forwarded_message_card"]').addEventListener('click', () => window.nativeClicks++);
  })()`);
  const check = async (name, expression) => {
    assert(await evaluate(client, expression), name);
    console.log(`PASS ${name}`);
  };
  const toggle = `document.querySelector('[data-slack-reply-preview-toggle]')`;
  const card = `document.querySelector('[data-qa="forwarded_message_card"]')`;
  await check('Native card is collapsed and summary is one line above the author', `getComputedStyle(${card}).display === 'none' && document.querySelector('.sqr-preview-text').getBoundingClientRect().height <= 20`);
  await check('Summary retains author, source, and alert text', `${toggle}.textContent.includes('Bridge Monitor') && ${toggle}.title.includes('bridge-alerts') && ${toggle}.textContent.includes('12 previously priced lanes')`);
  await check('Context sits above the replying author and redundant arrow is hidden', `${toggle}.getBoundingClientRect().bottom <= document.querySelector('.sender').getBoundingClientRect().top && getComputedStyle(document.querySelector('.reference-line')).display === 'none'`);
  await check('A main conversation with dialog semantics still gets reply context', `!!${toggle} && ${toggle}.closest('[role="dialog"]') === document.querySelector('main')`);
  await evaluate(client, `(() => {
    const dialog = document.createElement('div');
    dialog.id = 'nested-dialog-fixture';
    dialog.setAttribute('role', 'dialog');
    const clone = document.querySelector('[data-qa="message_container"]').cloneNode(true);
    clone.querySelector('[data-slack-reply-context]').remove();
    clone.querySelectorAll('[data-slack-reply-preview-collapsed]').forEach(e => e.removeAttribute('data-slack-reply-preview-collapsed'));
    dialog.append(clone);
    document.querySelector('main').append(dialog);
  })()`);
  await delay(80);
  await check('An actual nested dialog remains excluded', `!document.querySelector('#nested-dialog-fixture [data-slack-reply-preview-toggle]')`);
  await evaluate(client, `document.querySelector('#nested-dialog-fixture').remove()`);
  await mkdir(output, { recursive: true });
  async function screenshot(name, label) {
    await evaluate(client, `document.getElementById('state-label').textContent = ${JSON.stringify(label)}`);
    await delay(80);
    const height = await evaluate(client, 'Math.ceil(document.querySelector("main").getBoundingClientRect().bottom + 32)');
    const { data } = await client.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true,
      clip: { x: 0, y: 0, width: 1040, height, scale: 1 } });
    await writeFile(join(output, name), Buffer.from(data, 'base64'));
  }
  await screenshot('collapsed.png', 'Collapsed · one-line context');
  await evaluate(client, `${toggle}.click()`);
  await check('Click expands the original card without opening the source', `${toggle}.getAttribute('aria-expanded') === 'true' && getComputedStyle(${card}).display !== 'none' && window.nativeClicks === 0`);
  await screenshot('expanded.png', 'Expanded · full message preview');
  await evaluate(client, `${card}.click()`);
  await check('Expanded card retains its native click handler', 'window.nativeClicks === 1');
  await evaluate(client, `${toggle}.focus()`);
  await client.send('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
  await client.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
  await check('Keyboard Space collapses the preview', `${toggle}.getAttribute('aria-expanded') === 'false'`);
  await evaluate(client, source);
  await check('Repeated injection does not duplicate preview controls', 'document.querySelectorAll("[data-slack-reply-preview-toggle]").length === 1');
  await evaluate(client, `document.querySelector('[data-qa="message_attachment_slack_msg_text"] strong').textContent = 'UPDATED alert'`);
  await delay(80);
  await check('Edited message refreshes the collapsed summary', `document.querySelector('.sqr-preview-text').textContent.startsWith('UPDATED alert')`);
  await evaluate(client, `${toggle}.click()`);
  await delay(80);
  await check('Expanding does not change summary text or lose expanded state', `${toggle}.getAttribute('aria-expanded') === 'true' && document.querySelector('.sqr-preview-text').textContent.startsWith('UPDATED alert')`);
  await client.send('Emulation.setDeviceMetricsOverride', { width: 440, height: 900, deviceScaleFactor: 1, mobile: false });
  await evaluate(client, `${toggle}.click()`);
  await check('Compact preview fits a narrow pane and still fits one line', `${toggle}.getBoundingClientRect().right <= innerWidth && document.querySelector('.sqr-preview-text').getBoundingClientRect().height <= 20`);
  await evaluate(client, `(() => {
    const line = document.querySelector('.reference-line');
    const fresh = line.cloneNode(true);
    fresh.removeAttribute('data-slack-reply-reference-hidden');
    line.replaceWith(fresh);
  })()`);
  await delay(80);
  await check('Replacing a native message body keeps the redundant arrow hidden', `getComputedStyle(document.querySelector('.reference-line')).display === 'none'`);
  await evaluate(client, `document.querySelector('[data-slack-reply-context]').remove()`);
  await delay(80);
  await check('A native rerender restores the reply context without duplicates', `document.querySelectorAll('[data-slack-reply-preview-toggle]').length === 1`);
  await evaluate(client, `window.__slackQuoteReply.dispose()`);
  await check('Disposal restores the native card and removes added controls', `!document.querySelector('[data-slack-reply-preview-toggle]') && !${card}.hasAttribute('data-slack-reply-preview-collapsed') && getComputedStyle(${card}).display !== 'none' && getComputedStyle(document.querySelector('.reference-line')).display !== 'none' && !document.querySelector('[data-slack-reply-context-row]')`);
  console.log(`Screenshots: ${output}`);
} finally {
  client?.close();
  browser.kill('SIGTERM');
  await Promise.race([closed, delay(3000)]);
  if (browser.exitCode === null && browser.signalCode === null && !launchError) {
    browser.kill('SIGKILL');
    await closed;
  }
  await rm(profile, { recursive: true, force: true });
}
