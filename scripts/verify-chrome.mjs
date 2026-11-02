import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect, evaluate } from '../src/cdp.mjs';

// Load the real extension into a disposable Chrome profile. All page requests
// are intercepted and served locally; no Slack account or messages are touched.
const root = fileURLToPath(new URL('../', import.meta.url));
const chrome = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const profile = await mkdtemp(join(tmpdir(), 'slack-reply-extension-'));
const browser = spawn(chrome, ['--headless=new', '--no-first-run', '--no-default-browser-check',
  '--disable-background-networking', '--disable-gpu', '--renderer-process-limit=1',
  '--js-flags=--single-threaded', '--enable-unsafe-extension-debugging',
  '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0',
  `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore',
  env: { ...process.env, UV_THREADPOOL_SIZE: '1', OMP_NUM_THREADS: '1' } });
let launchError;
browser.on('error', error => { launchError = error; });
const closed = new Promise(resolve => browser.once('close', resolve));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let client;
let browserClient;
let interceptionError;
// A page-owned editor double verifies MAIN-world access and click routing. Real
// Slack Quill behavior is covered separately by the live editor checks.
const setup = `
  window.setupComposer = (scope, thread = false) => {
    const container = document.createElement('div');
    container.dataset.qa = thread ? 'reply_container' : 'message_input_container';
    container.innerHTML = '<div data-qa="message_input"><div data-qa="texty_input" contenteditable="true">Existing draft</div></div>';
    scope.append(container);
    const root = container.querySelector('[contenteditable]');
    const calls = [];
    const editor = { root, calls, isEnabled: () => true,
      getContents: () => ({ ops: [{ insert: 'Existing draft\\n' }] }),
      getLength: () => 15, updateContents: (delta, source) => calls.push({ delta, source }),
      history: { cutoff() {} }, setSelection: (...args) => { editor.selection = args; },
      focus: () => root.focus() };
    container.firstElementChild.__quill = editor;
    return editor;
  };
  window.setupRow = row => {
    const timestamp = document.createElement('a');
    timestamp.className = 'c-timestamp';
    timestamp.href = 'https://example.slack.com/archives/C123/p1793636860000001?thread_ts=1793636465.149379&cid=C123';
    row.append(timestamp);
    const toolbar = document.createElement('div');
    toolbar.dataset.qa = 'message-actions';
    row.append(toolbar);
  };
  setupRow(document.querySelector('[data-qa="message_container"]'));
  window.mainEditor = setupComposer(document.querySelector('main'));
`;
try {
  const fixture = await readFile(new URL('../test/fixtures/compact-preview.html', import.meta.url), 'utf8');
  const html = fixture.replace('</html>', `<script>${setup}</script></html>`);
  let port;
  for (let i = 0; i < 100; i++) {
    if (launchError) throw launchError;
    try { port = Number((await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); } catch { /* Starting. */ }
    if (port) break;
    await delay(100);
  }
  assert(port, 'Chrome did not start. Set CHROME_PATH to a recent Chrome executable.');
  const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  browserClient = await connect(version.webSocketDebuggerUrl);
  const { id } = await browserClient.send('Extensions.loadUnpacked', { path: root });
  assert(id, 'Chrome must load the actual unpacked extension');
  const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  client = await connect(pages.find(page => page.type === 'page').webSocketDebuggerUrl, {
    onEvent(event) {
      if (event.method !== 'Fetch.requestPaused') return;
      const { requestId, resourceType } = event.params;
      client.send('Fetch.fulfillRequest', { requestId, responseCode: 200,
        responseHeaders: [{ name: 'Content-Type', value: 'text/html; charset=utf-8' }],
        body: Buffer.from(resourceType === 'Document' ? html : '').toString('base64'),
      }).catch(error => { interceptionError = error; });
    },
  });
  await client.send('Page.enable');
  await client.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
  async function waitFor(expression) {
    for (let i = 0; i < 100; i++) {
      if (interceptionError) throw interceptionError;
      if (await evaluate(client, expression)) return;
      await delay(50);
    }
    throw new Error(`Timed out: ${expression}`);
  }
  async function navigate(url) {
    await client.send('Page.navigate', { url });
    await waitFor(`location.href === ${JSON.stringify(url)} && document.readyState === 'complete' && !!window.mainEditor`);
    // document_idle injection may run just after the load event.
    await delay(150);
  }
  async function check(name, expression) {
    assert(await evaluate(client, expression), name);
    console.log(`PASS ${name}`);
  }
  await navigate('https://app.slack.com/client/T123/C123');
  await waitFor('!!document.querySelector("[data-slack-quote-reply]")');
  await check('Extension automatically injects in the page world and resolves the page-owned editor',
    'window.__slackQuoteReply.resolveEditor(document.querySelector("[data-qa=message_container]")) === mainEditor');
  await evaluate(client, 'document.querySelector("[data-slack-quote-reply]").click()');
  await check('Click preserves the draft and appends the complete message permalink', `
    mainEditor.calls.length === 1 && mainEditor.calls[0].source === 'user' &&
    JSON.stringify(mainEditor.calls[0].delta.ops) === JSON.stringify([
      { retain: 15 }, { insert: '↗', attributes: { link: document.querySelector('a.c-timestamp').href } }, { insert: '\\n' }
    ]) && mainEditor.selection[0] === 14 && mainEditor.root.textContent === 'Existing draft'`);
  await check('Compact preview mounts through the extension',
    'document.querySelector("[data-slack-reply-preview-toggle]")?.getAttribute("aria-expanded") === "false"');
  await evaluate(client, `(() => {
    const frame = document.createElement('iframe');
    frame.src = '/client/T123/C456';
    document.body.append(frame);
  })()`);
  await waitFor('!!document.querySelector("iframe").contentWindow.mainEditor');
  await delay(150);
  await check('Matching embedded frames are excluded', '!document.querySelector("iframe").contentWindow.__slackQuoteReply');
  await evaluate(client, 'document.querySelector("iframe").remove()');
  await evaluate(client, `(() => {
    const pane = document.createElement('aside');
    pane.dataset.qa = 'threads_flexpane';
    const row = document.createElement('article');
    Object.assign(row.dataset, { qa: 'message_container', msgChannelId: 'C123', msgTs: '1793636860.000001' });
    setupRow(row);
    pane.append(row);
    window.threadEditor = setupComposer(pane, true);
    document.querySelector('main').append(pane);
  })()`);
  await waitFor('!!document.querySelector("[data-qa=threads_flexpane] [data-slack-quote-reply]")');
  await evaluate(client, 'document.querySelector("[data-qa=threads_flexpane] [data-slack-quote-reply]").click()');
  await check('Late-rendered thread routes to its own composer', 'threadEditor.calls.length === 1 && mainEditor.calls.length === 1');
  await client.send('Page.reload');
  await waitFor('!!window.__slackQuoteReply && !!window.mainEditor && mainEditor.calls.length === 0');
  await check('Reload reinjects once without duplicate buttons', 'document.querySelectorAll("[data-slack-quote-reply]").length === 1');
  await navigate('https://example.slack.com/messages/C123');
  await check('Workspace subdomains are supported', '!!window.__slackQuoteReply');
  // Slack is HSTS-preloaded, so Chrome upgrades HTTP before content-script
  // matching. Check non-Slack and lookalike HTTPS origins here instead.
  for (const url of ['https://example.com/', 'https://slack.com/',
    'https://slack.com.attacker.test/']) {
    await navigate(url);
    await check(`No injection on ${url}`, '!window.__slackQuoteReply && !document.querySelector("[data-slack-quote-reply]")');
  }
  await browserClient.send('Extensions.uninstall', { id });
  await navigate('https://app.slack.com/client/T123/C123');
  await check('Uninstall followed by page reload restores the native display',
    '!window.__slackQuoteReply && !document.querySelector("[data-slack-reply-preview-toggle]")');
  console.log(`Verified unpacked extension in ${version.Browser} using local fixtures.`);
} finally {
  client?.close();
  browserClient?.close();
  browser.kill('SIGTERM');
  await Promise.race([closed, delay(3000)]);
  if (browser.exitCode === null && browser.signalCode === null && !launchError) {
    browser.kill('SIGKILL');
    await closed;
  }
  await rm(profile, { recursive: true, force: true });
}
