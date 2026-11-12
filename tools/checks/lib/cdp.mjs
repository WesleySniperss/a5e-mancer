/* Drive a real, running Foundry in headless Edge over the DevTools protocol.
 *
 * lib/livebrowser.mjs serves the module to a browser with Foundry stood in for;
 * this one talks to Foundry itself — a world, its documents, its hooks, the
 * canvas. What it is for is the question those cannot answer: what does the
 * real application do when a real document is written to.
 *
 * Point it at a COPY of the world. Everything here writes.
 */
import { spawn, execFileSync } from 'child_process';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { EDGE } from './browser.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @param {object} [o]
 * @param {number} [o.port]    the debugging port; one per browser at a time
 * @returns {Promise<{ send: Function, evaluate: Function, click: Function,
 *                     shot: Function, close: Function, console: string[], sleep: Function }>}
 */
export async function openBrowser({ port = 9333, width = 1600, height = 1000 } = {}) {
  if (!EDGE) throw new Error('needs Edge');
  const profile = mkdtempSync(join(tmpdir(), 'am-cdp-'));
  /* Edge signed in to Windows brings its extensions into even a fresh
     profile, and they open pages of their own: a DeepL sign-up, a shop's
     welcome. The first run of livepatch.mjs drove the Foundry tab from behind
     them — document.hidden, so every timer in it was throttled to as much as a
     minute, and a check of a few seconds ran for ten. No extensions, no
     background throttling, and the tab this script opens itself. */
  const proc = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--disable-component-extensions-with-background-pages', '--disable-sync',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, `--window-size=${width},${height}`, 'about:blank'],
    { stdio: 'ignore' });

  let up = false;
  for (let i = 0; i < 60 && !up; i++) {
    try { up = (await fetch(`http://127.0.0.1:${port}/json/version`)).ok; } catch {}
    if (!up) await sleep(500);
  }
  if (!up) { proc.kill(); throw new Error('Edge never answered on its debugging port'); }
  const page = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  if (!page?.webSocketDebuggerUrl) { proc.kill(); throw new Error('Edge would not open a tab'); }
  await fetch(`http://127.0.0.1:${port}/json/activate/${page.id}`);

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

  let id = 0;
  const pending = new Map();
  const listeners = [];
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
    } else if (msg.method) for (const l of listeners) l(msg);
  };

  const send = (method, params = {}) => new Promise((res, rej) => {
    const i = ++id;
    pending.set(i, { res, rej });
    ws.send(JSON.stringify({ id: i, method, params }));
  });

  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error('the page threw: ' + (r.exceptionDetails.exception?.description ?? r.exceptionDetails.text));
    return r.result.value;
  };

  const console_ = [];
  listeners.push((m) => {
    if (m.method === 'Runtime.consoleAPICalled') {
      console_.push(`[${m.params.type}] ` + m.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 400));
    }
    if (m.method === 'Runtime.exceptionThrown') {
      console_.push('[exception] ' + String(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text).slice(0, 600));
    }
  });
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.bringToFront');
  await send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {});

  const click = async (x, y) => {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  };

  const shot = async (file, clip) => {
    const r = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip: { ...clip, scale: 1 } } : {}) });
    writeFileSync(file, Buffer.from(r.data, 'base64'));
  };

  /* The whole browser, not just the process this script started. On Windows
     Edge hands itself on to other processes, and killing the first left them
     running - with the page still logged in to whatever world it was in. One
     left logged in as a GM to the user's own server (2026-11-11) kept a5e's
     world migration starting again at each of its reconnects. Everything on
     this check's own profile goes, synchronously, before the script exits. */
  const close = () => {
    try { ws.close(); } catch {}
    try { proc.kill(); } catch {}
    if (process.platform !== 'win32') return;
    try { execFileSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); } catch {}
    const tag = String(profile).split(/[\\/]/).pop();
    try {
      execFileSync('powershell.exe', ['-NoProfile', '-Command',
        `Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" | Where-Object { $_.CommandLine -like '*${tag}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`],
        { stdio: 'ignore' });
    } catch {}
  };
  return { send, evaluate, click, shot, close, console: console_, sleep };
}
