import { readFile } from 'node:fs/promises';
import { connect, evaluate, targets } from '../src/cdp.mjs';
const expression = await readFile(process.argv[2], 'utf8');
const pages = await targets(Number(process.env.SLACK_QUOTE_PORT || 19247));
for (const page of pages) {
  const client = await connect(page.webSocketDebuggerUrl);
  try { console.log(JSON.stringify(await evaluate(client, expression), null, 2)); }
  finally { client.close(); }
}
