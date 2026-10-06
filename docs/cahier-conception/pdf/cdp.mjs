// Minimal Chrome DevTools Protocol driver for the notebook build (Node >= 22, no dependencies).
//   node cdp.mjs pdf  <page-url> <out.pdf>
//   node cdp.mjs eval <page-url> <expression-file> <out.json>
// Both commands wait for window.__AEGIS_READY === true before acting.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = process.env.CHROME_BIN
  || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const READY_TIMEOUT_MS = 120_000;

class Session {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(`${msg.error.message} (${msg.error.code})`));
        else resolve(msg.result);
      } else if (msg.method === 'Runtime.consoleAPICalled') {
        const text = msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ');
        if (msg.params.type === 'error' || msg.params.type === 'warning') {
          process.stderr.write(`[page ${msg.params.type}] ${text}\n`);
        }
      } else if (msg.method === 'Runtime.exceptionThrown') {
        process.stderr.write(`[page exception] ${msg.params.exceptionDetails.text}\n`);
      }
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }

  async evaluate(expression) {
    const { result, exceptionDetails } = await this.send('Runtime.evaluate', {
      expression, returnByValue: true, awaitPromise: true,
    });
    if (exceptionDetails) throw new Error(`evaluation failed: ${exceptionDetails.text}`);
    return result.value;
  }
}

async function launch() {
  const profile = mkdtempSync(join(tmpdir(), 'aegis-cdp-'));
  const port = 9400 + Math.floor(Math.random() * 400);
  const proc = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--hide-scrollbars',
    '--allow-file-access-from-files', 'about:blank',
  ], { stdio: 'ignore' });
  let target;
  for (let attempt = 0; attempt < 150 && !target; attempt++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
    } catch { /* Chrome not listening yet */ }
    if (!target) await sleep(100);
  }
  if (!target) throw new Error('Chrome DevTools endpoint did not start');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });
  const close = () => {
    try { ws.close(); } catch { /* already closed */ }
    proc.kill('SIGTERM');
    try { rmSync(profile, { recursive: true, force: true }); } catch { /* best effort */ }
  };
  return { session: new Session(ws), close };
}

async function openAndWait(session, url) {
  await session.send('Runtime.enable');
  await session.send('Page.enable');
  await session.send('Page.navigate', { url });
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const ready = await session.evaluate('window.__AEGIS_READY === true').catch(() => false);
    if (ready) return;
    const failure = await session.evaluate('window.__AEGIS_ERROR || null').catch(() => null);
    if (failure) throw new Error(`page reported: ${failure}`);
    await sleep(250);
  }
  throw new Error(`timed out waiting for window.__AEGIS_READY on ${url}`);
}

async function main() {
  const [command, url, ...rest] = process.argv.slice(2);
  if (!command || !url) throw new Error('usage: cdp.mjs pdf|eval <url> ...');
  const { session, close } = await launch();
  try {
    await openAndWait(session, url);
    if (command === 'pdf') {
      const [out] = rest;
      const { data } = await session.send('Page.printToPDF', {
        printBackground: true,
        preferCSSPageSize: true,
        displayHeaderFooter: false,
        generateDocumentOutline: false,
        transferMode: 'ReturnAsBase64',
      });
      writeFileSync(out, Buffer.from(data, 'base64'));
    } else if (command === 'eval') {
      const [expressionFile, out] = rest;
      const value = await session.evaluate(readFileSync(expressionFile, 'utf8'));
      writeFileSync(out, typeof value === 'string' ? value : JSON.stringify(value));
    } else {
      throw new Error(`unknown command ${command}`);
    }
  } finally {
    close();
  }
}

main().catch((error) => {
  process.stderr.write(`cdp.mjs: ${error.message}\n`);
  process.exit(1);
});
