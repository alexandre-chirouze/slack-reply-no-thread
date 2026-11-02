import { spawn, execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdir, open, unlink, copyFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect, evaluate, targets } from './cdp.mjs';

const sourceDir = dirname(fileURLToPath(import.meta.url));
const dataDir = join(homedir(), 'Library', 'Application Support', 'Slack Quote Reply');
const appDir = join(homedir(), 'Applications', 'Slack Quote Reply.app');
const statePath = join(dataDir, 'state.json');
const lockPath = join(dataDir, 'watcher.lock');
const slackApp = '/Applications/Slack.app';
const slackExecutable = `${slackApp}/Contents/MacOS/Slack`;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function command(file, args) { return execFileSync(file, args, { encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
function alive(pid) { try { process.kill(pid, 0); return true; } catch { return false; } }
async function readState() { try { return JSON.parse(await readFile(statePath, 'utf8')); } catch { return null; } }
function slackPid() {
  let pids;
  try { pids = command('/usr/bin/pgrep', ['-x', 'Slack']).split('\n').map(Number); } catch { return null; }
  const matches = pids.filter(pid => command('/bin/ps', ['-p', String(pid), '-o', 'comm=']) === slackExecutable);
  if (matches.length > 1) throw new Error('Multiple Slack instances found. Quit the extra instance first.');
  return matches[0] || null;
}
function isWatcher(state) {
  if (!state?.pid || !alive(state.pid)) return false;
  try { return command('/bin/ps', ['-p', String(state.pid), '-o', 'command=']).includes(`${state.script} watch`); }
  catch { return false; }
}
async function quitSlack() {
  if (!slackPid()) return;
  command('/usr/bin/osascript', ['-e', 'tell application "Slack" to quit']);
  for (let i = 0; i < 100; i++) { if (!slackPid()) return; await delay(200); }
  throw new Error('Slack did not quit. Close any Slack confirmation dialog and try again.');
}
async function openSlack(args = []) {
  // LaunchServices can still report -600 briefly after Slack's process exits.
  let lastError;
  for (let attempt = 0; attempt < 10; attempt++) {
    try { command('/usr/bin/open', ['-a', slackApp, ...args]); return; }
    catch (error) { lastError = error; await delay(500); }
  }
  throw lastError;
}
async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
async function verifyDebugger(port, pid) {
  const response = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1500) });
  const version = await response.json();
  if (!/Slack\//.test(version['User-Agent'] || '')) throw new Error('The debugger does not belong to Slack.');
  const listeners = command('/usr/sbin/lsof', ['-nP', '-a', '-p', String(pid), '-iTCP', '-sTCP:LISTEN', '-Fn'])
    .split('\n').filter(line => line.startsWith('n') && line.endsWith(`:${port}`));
  if (listeners.length !== 1 || listeners[0] !== `n127.0.0.1:${port}`) throw new Error('Slack debugger is not exclusively bound to IPv4 loopback.');
}
async function getRuntime() {
  let pid = slackPid();
  const args = pid ? command('/bin/ps', ['-p', String(pid), '-o', 'command=']) : '';
  let port = Number(args.match(/--remote-debugging-port=(\d+)/)?.[1]);
  if (port > 0) {
    await verifyDebugger(port, pid);
    return { port, slackPid: pid };
  }
  if (pid) await quitSlack();
  port = await freePort();
  await openSlack(['--args', '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${port}`]);
  let lastError;
  for (let i = 0; i < 100; i++) {
    await delay(300);
    try {
      pid = slackPid();
      if (!pid) continue;
      await verifyDebugger(port, pid);
      return { port, slackPid: pid };
    } catch (error) { lastError = error; }
  }
  throw new Error(`Slack's local debugger did not become available: ${lastError?.message || 'startup timeout'}`);
}

async function watch() {
  let lock;
  try { lock = await open(lockPath, 'wx', 0o600); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const pid = Number(await readFile(lockPath, 'utf8'));
    if (alive(pid)) return;
    await unlink(lockPath);
    lock = await open(lockPath, 'wx', 0o600);
  }
  await lock.writeFile(String(process.pid));
  await lock.close();
  const clients = new Map();
  let stopping = false;
  process.on('SIGTERM', () => { stopping = true; });
  process.on('SIGINT', () => { stopping = true; });
  try {
    const runtime = await getRuntime();
    const source = await readFile(join(sourceDir, 'quote-reply.js'), 'utf8');
    const state = { pid: process.pid, script: fileURLToPath(import.meta.url), ...runtime, phase: 'ready', pages: 0 };
    await writeFile(statePath, JSON.stringify(state), { mode: 0o600 });
    console.log('Slack Quote Reply is ready.');
    while (!stopping && alive(runtime.slackPid)) {
      try {
        const pages = await targets(runtime.port);
        const active = new Set(pages.map(page => page.id));
        for (const [id, entry] of clients) {
          if (!active.has(id)) { entry.client.close(); clients.delete(id); }
        }
        for (const page of pages) {
          if (stopping) break;
          let entry = clients.get(page.id);
          try {
            if (!entry) {
              const client = await connect(page.webSocketDebuggerUrl);
              entry = { client };
              clients.set(page.id, entry);
              await client.send('Page.enable');
              // The script itself waits for the body on full reloads.
              const script = await client.send('Page.addScriptToEvaluateOnNewDocument', { source: bootstrap(source) });
              entry.scriptId = script.identifier;
            }
            await evaluate(entry.client, bootstrap(source));
          } catch {
            if (entry?.scriptId) await entry.client.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: entry.scriptId }).catch(() => {});
            entry?.client.close();
            clients.delete(page.id);
          }
        }
        state.pages = clients.size;
        await writeFile(statePath, JSON.stringify(state), { mode: 0o600 });
      } catch { /* Slack may briefly recreate pages while changing workspaces. */ }
      await delay(2000);
    }
  } finally {
    for (const { client, scriptId } of clients.values()) {
      try {
        if (scriptId) await client.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: scriptId });
        await evaluate(client, 'window.__slackQuoteReply?.dispose()');
      } catch { /* App or page may already be closed. */ }
      client.close();
    }
    if ((await readState())?.pid === process.pid) await unlink(statePath).catch(() => {});
    await unlink(lockPath).catch(() => {});
  }
}
function bootstrap(source) {
  return `(() => {
    if (location.protocol !== 'https:' || !(location.hostname === 'app.slack.com' || location.hostname.endsWith('.slack.com'))) return;
    if (window.top !== window) return;
    if (document.body && document.head) { ${source}\n }
    else if (!window.__slackQuoteReplyWaiting) {
      window.__slackQuoteReplyWaiting = true;
      document.addEventListener('DOMContentLoaded', () => { delete window.__slackQuoteReplyWaiting; ${source}\n }, { once: true });
    }
  })()`;
}
async function start() {
  if (isWatcher(await readState())) {
    await openSlack();
    console.log('Slack Quote Reply is already running.');
    return;
  }
  const log = await open(join(dataDir, 'launcher.log'), 'a', 0o600);
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), 'watch'], {
    detached: true, stdio: ['ignore', log.fd, log.fd],
    env: { ...process.env, UV_THREADPOOL_SIZE: '1', OMP_NUM_THREADS: '1' },
  });
  child.unref();
  await log.close();
  for (let i = 0; i < 120; i++) {
    await delay(300);
    const state = await readState();
    if (isWatcher(state) && state.phase === 'ready') { console.log('Slack Quote Reply started. Hover over a message to use ❝ Reply.'); return; }
    if (!alive(child.pid)) break;
  }
  throw new Error(`Could not start injection. See ${join(dataDir, 'launcher.log')}`);
}
async function stop() {
  const state = await readState();
  if (isWatcher(state)) {
    process.kill(state.pid, 'SIGTERM');
    for (let i = 0; i < 100 && isWatcher(state); i++) await delay(200);
    if (isWatcher(state)) throw new Error('The injector is still stopping. Try again shortly.');
  }
  // Restart without debugging so stopping also closes the local debug port.
  const pid = slackPid();
  if (pid && /--remote-debugging-port=\d+/.test(command('/bin/ps', ['-p', String(pid), '-o', 'command=']))) {
    await quitSlack();
    await openSlack();
  }
  console.log('Quote Reply stopped. Slack is running normally.');
}
const shellQuote = text => `'${text.replaceAll("'", "'\\''")}'`;
async function install() {
  if (isWatcher(await readState())) throw new Error('Run stop before updating an active installation.');
  const installedSrc = join(dataDir, 'src');
  await mkdir(installedSrc, { recursive: true, mode: 0o700 });
  for (const file of ['launcher.mjs', 'cdp.mjs', 'quote-reply.js']) {
    if (join(sourceDir, file) !== join(installedSrc, file)) await copyFile(join(sourceDir, file), join(installedSrc, file));
  }
  const macOS = join(appDir, 'Contents', 'MacOS');
  const resources = join(appDir, 'Contents', 'Resources');
  await mkdir(macOS, { recursive: true });
  await mkdir(resources, { recursive: true });
  await copyFile(`${slackApp}/Contents/Resources/electron.icns`, join(resources, 'slack.icns')).catch(() => {});
  await writeFile(join(appDir, 'Contents', 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleName</key><string>Slack Quote Reply</string>
<key>CFBundleDisplayName</key><string>Slack Quote Reply</string>
<key>CFBundleIdentifier</key><string>local.slack-quote-reply.launcher</string>
<key>CFBundleVersion</key><string>1.3.1</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleExecutable</key><string>launch</string>
<key>CFBundleIconFile</key><string>slack.icns</string>
<key>LSUIElement</key><true/>
</dict></plist>`);
  const installedRunner = join(installedSrc, 'launcher.mjs');
  await writeFile(join(macOS, 'launch'), `#!/bin/sh\nexport UV_THREADPOOL_SIZE=1\nexport OMP_NUM_THREADS=1\nif ! ${shellQuote(process.execPath)} ${shellQuote(installedRunner)} start >> ${shellQuote(join(dataDir, 'launcher.log'))} 2>&1; then\n/usr/bin/osascript -e 'display alert "Slack Quote Reply could not start" message "See launcher.log in ~/Library/Application Support/Slack Quote Reply."'\nexit 1\nfi\n`, { mode: 0o755 });
  console.log(`Installed ${appDir}`);
}

try {
  if (process.platform !== 'darwin') throw new Error('This launcher currently supports macOS only.');
  if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Node.js 22 or newer is required.');
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  const action = process.argv[2] || 'start';
  if (action === 'install') await install();
  else if (action === 'start') await start();
  else if (action === 'watch') await watch();
  else if (action === 'stop') await stop();
  else if (action === 'status') {
    const state = await readState();
    console.log(isWatcher(state) ? `Running; ${state.pages} Slack page(s) connected; debugger on 127.0.0.1:${state.port}` : 'Not running.');
  } else if (action === 'uninstall') {
    await stop();
    await rm(appDir, { recursive: true, force: true });
    await rm(dataDir, { recursive: true, force: true });
    console.log('Slack Quote Reply uninstalled.');
  } else throw new Error('Use start, install, stop, status, or uninstall.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
