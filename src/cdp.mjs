export async function targets(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(2000) });
  if (!response.ok) throw new Error(`Debugger returned ${response.status}`);
  return (await response.json()).filter(target => {
    try {
      const url = new URL(target.url);
      return target.type === 'page' && url.protocol === 'https:' &&
        (url.hostname === 'app.slack.com' || url.hostname.endsWith('.slack.com'));
    } catch { return false; }
  });
}

export async function connect(url) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'ws:' || parsed.hostname !== '127.0.0.1') throw new Error('Debugger must be on loopback');
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.close(); reject(new Error('Debugger connection timed out')); }, 3000);
    socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
    socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('Debugger connection failed')); }, { once: true });
  });
  let nextId = 0;
  const pending = new Map();
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    const call = pending.get(message.id);
    if (!call) return;
    pending.delete(message.id);
    clearTimeout(call.timer);
    message.error ? call.reject(new Error(message.error.message)) : call.resolve(message.result);
  });
  socket.addEventListener('close', () => {
    for (const call of pending.values()) { clearTimeout(call.timer); call.reject(new Error('Debugger disconnected')); }
    pending.clear();
  });
  return {
    send(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = ++nextId;
        const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)); }, 5000);
        pending.set(id, { resolve, reject, timer });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    close() { socket.close(); },
  };
}

export async function evaluate(client, expression) {
  const response = await client.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text || 'Injection failed');
  return response.result?.value;
}
