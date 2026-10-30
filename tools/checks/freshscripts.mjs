/* A browser that kept older copies of the module's scripts, in real Foundry.
 *
 * "Nothing works, no sheet, no numbers on the statuses" (2026-10-30): on the
 * Forge a browser keeps a module's scripts under the same URL from version to
 * version, and a new a5e-mancer.js over last version's livePatch.js stops the
 * whole module at link time. scripts/fresh-scripts.js is what answers that.
 *
 * A small proxy stands in for the Forge in front of a copy of the world. It
 * sends the module's scripts with a day's max-age, so the browser really does
 * hold them, and the first time each is asked for it can answer with an older
 * version's file, out of git. `cache: 'reload'` reaches it marked no-cache and
 * gets the file as it is now - what any host would do. Each case is a new
 * browser profile, so what it holds is what the case put there.
 *
 *   node tools/checks/freshscripts.mjs --url <a copy's url> --user <a GM's user id> [--only <case text>]
 *
 * Checks the copy's module as it stands: sync the working tree to it first.
 * First, without any browser: the walk fresh-scripts.js does reaches every
 * script of the module and asks for none that is not there - one it asked for
 * in vain would have it read them all again on every load.
 */
import http from 'http';
import net from 'net';
import { execFileSync } from 'child_process';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { openBrowser } from './lib/cdp.mjs';

const arg = (name, fallback) => {
  const i = process.argv.indexOf('--' + name);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const TARGET = new URL(arg('url', 'http://localhost:30011'));
const USER = arg('user', null);
const ONLY = arg('only', null);
const PORT = 30019;
const SCRIPTS = '/modules/a5e-mancer/scripts/';
const R = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const git = (...a) => execFileSync('git', a, { cwd: R, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

/** One file of an older version, as the browser's cache would hold it. */
const old = (tag, file) => [SCRIPTS + file, git('show', `${tag}:scripts/${file}`)];
/** Every script of an older version. */
const allOf = (tag) => git('ls-tree', '-r', '--name-only', tag, 'scripts')
  .split('\n').filter((f) => f.endsWith('.js'))
  .map((f) => old(tag, f.slice('scripts/'.length)));

/* ── The walk, against the files ──────────────────────────────────────── */
{
  const source = readFileSync(path.join(R, 'scripts/fresh-scripts.js'), 'utf8');
  const manifest = JSON.parse(readFileSync(path.join(R, 'module.json'), 'utf8'));
  const IMPORT = new Function(`return ${source.match(/const IMPORT = (\/.*\/g);/)[1]}`)();
  const seen = new Set(manifest.esmodules.map((e) => path.join(R, e)));
  const queue = [...seen], vain = [];
  while (queue.length) {
    const file = queue.pop();
    if (!existsSync(file)) { vain.push(path.relative(R, file)); continue; }
    for (const [, spec] of readFileSync(file, 'utf8').matchAll(IMPORT)) {
      const target = path.resolve(path.dirname(file), spec);
      if (!seen.has(target)) { seen.add(target); queue.push(target); }
    }
  }
  const all = [];
  const list = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) list(p); else if (/\.m?js$/.test(e.name)) all.push(p);
    }
  };
  list(path.join(R, 'scripts'));
  const unreached = all.filter((p) => !seen.has(p)).map((p) => path.relative(R, p));
  const first = manifest.esmodules[0] === 'scripts/fresh-scripts.js';
  const alone = ![...source.matchAll(/^\s*import\b/gm)].length;
  console.log('the walk');
  console.log(`  ${first ? 'ok  ' : 'FAIL'}  fresh-scripts.js is listed first`);
  console.log(`  ${alone ? 'ok  ' : 'FAIL'}  it imports nothing, so it runs whatever state the others are in`);
  console.log(`  ${vain.length ? 'FAIL' : 'ok  '}  it asks for nothing that is not there   (${vain.join(', ') || `${seen.size} files`})`);
  console.log(`  ${unreached.length ? 'FAIL' : 'ok  '}  it reaches every script   (${unreached.join(', ') || `${all.length} of ${all.length}`})`);
  if (!first || !alone || vain.length || unreached.length) process.exitCode = 1;
}

const CASES = [
  { name: 'what reached the user: 2.96.0\'s entry over 2.95.1\'s livePatch', reloads: true,
    stale: () => [old('v2.96.0', 'a5e-mancer.js'), old('v2.95.1', 'utils/livePatch.js')] },
  { name: 'the same behind a redirect to another host, as a CDN serves them', reloads: true, redirect: true,
    stale: () => [old('v2.96.0', 'a5e-mancer.js'), old('v2.95.1', 'utils/livePatch.js')] },
  { name: 'an older file that breaks nothing at link time: 2.95.1\'s conditionAutomation', reloads: true,
    stale: () => [old('v2.95.1', 'utils/conditionAutomation.js')] },
  { name: 'every script a whole version behind, one of them gone from the server', reloads: true,
    stale: () => allOf('v2.95.0') },
  { name: 'nothing old: no reload', reloads: false, stale: () => [] }
];

/* ── The stand-in for the Forge ───────────────────────────────────────── */
function startProxy(stale, { redirect = false } = {}) {
  const held = new Map(stale);
  const asked = { reloads: 0, plain: 0 };
  const assets = `http://127.0.0.1:${PORT + 1}`;
  const serve = (cors) => (req, res) => {
    const pathname = new URL(req.url, TARGET).pathname;
    const ours = pathname.startsWith(SCRIPTS) && pathname.endsWith('.js');
    const noCache = /no-cache/i.test(`${req.headers['cache-control'] ?? ''} ${req.headers.pragma ?? ''}`);
    /* The module's files live on the other host, and every request for them
       here is sent on: the shape a CDN in front of a game's server has. */
    if (redirect && !cors && pathname.startsWith('/modules/a5e-mancer/')) {
      res.writeHead(302, { Location: assets + req.url, 'Cache-Control': 'no-store' });
      return res.end();
    }
    const allow = cors ? { 'Access-Control-Allow-Origin': '*' } : {};
    if (ours) {
      asked[noCache ? 'reloads' : 'plain']++;
      if (noCache) held.delete(pathname);
      if (held.has(pathname)) {
        res.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'public, max-age=86400', ...allow });
        return res.end(held.get(pathname));
      }
    }
    const headers = { ...req.headers, host: TARGET.host };
    const up = http.request({ host: TARGET.hostname, port: TARGET.port, path: req.url, method: req.method, headers }, (r) => {
      const out = { ...r.headers };
      if (ours && r.statusCode === 200) {
        delete out.etag; delete out['last-modified'];
        out['cache-control'] = 'public, max-age=86400';
      }
      res.writeHead(r.statusCode, { ...out, ...allow });
      r.pipe(res);
    });
    up.on('error', () => { res.writeHead(502); res.end(); });
    req.pipe(up);
  };
  const server = http.createServer(serve(false));
  const assetServer = redirect ? http.createServer(serve(true)) : null;
  server.on('upgrade', (req, socket, head) => {
    const up = net.connect(Number(TARGET.port), TARGET.hostname, () => {
      up.write(`${req.method} ${req.url} HTTP/1.1\r\n` + Object.entries({ ...req.headers, host: TARGET.host })
        .map(([k, v]) => `${k}: ${v}`).join('\r\n') + '\r\n\r\n');
      up.write(head);
      socket.pipe(up); up.pipe(socket);
    });
    up.on('error', () => socket.destroy());
    socket.on('error', () => up.destroy());
  });
  assetServer?.listen(PORT + 1);
  return new Promise((resolve) => server.listen(PORT, () => resolve({ server, assetServer, asked, held })));
}

/* ── One browser, one case ────────────────────────────────────────────── */
async function run(c) {
  const out = [];
  const check = (name, ok, detail = '') => out.push([name, !!ok, detail]);
  const proxy = await startProxy(c.stale(), { redirect: c.redirect });
  const base = `http://localhost:${PORT}`;
  const b = await openBrowser({ port: 9439 });
  try {
    await b.send('Page.navigate', { url: `${base}/join` });
    await b.sleep(2500);
    const user = USER ?? await b.evaluate(`document.querySelector('select[name="userid"] option[value]:not([value=""])')?.value ?? null`);
    await b.evaluate(`fetch('/join', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'join', userId: ${JSON.stringify(user)}, password: '' }) }).then(r => r.status)`);
    await b.evaluate("localStorage.setItem('core.noCanvas', 'true')");
    await b.send('Page.navigate', { url: `${base}/game` });

    /* The page may go away under a question while it loads again. */
    const ask = async (expr) => { try { return await b.evaluate(expr); } catch { return undefined; } };
    let up = false;
    for (let i = 0; i < 400 && !up; i++) {
      await b.sleep(1000);
      up = await ask('!!(window.game && game.ready && globalThis.a5eMancer)');
    }
    await b.sleep(3000);
    const state = await ask(`(async () => {
      const key = 'a5e-mancer.freshScripts';
      const actor = game.actors.find(a => a.type === 'character');
      const cls = CONFIG.Actor.sheetClasses.character['a5e.A5eCharacterSheet']?.cls;
      let tiles = null, sheetError = null;
      try {
        const sheet = new cls(actor);
        await sheet.render(true);
        for (let i = 0; i < 60 && !sheet.rendered; i++) await new Promise(r => setTimeout(r, 250));
        tiles = sheet.element?.[0]?.querySelectorAll('.conditions-list .condition').length ?? 0;
        await sheet.close();
      } catch (e) { sheetError = String(e?.message ?? e); }
      const live = await import('/modules/a5e-mancer/scripts/utils/livePatch.js');
      const cond = await import('/modules/a5e-mancer/scripts/utils/conditionAutomation.js');
      return {
        up: !!globalThis.a5eMancer,
        sheet: !!cls, tiles, sheetError,
        newLivePatch: typeof live.redrawConditionRounds === 'function',
        newRounds: typeof cond.ConditionAutomation.roundsOf === 'function',
        seen: localStorage.getItem(key), version: game.modules.get('a5e-mancer').version,
        reloaded: sessionStorage.getItem(key + '.reloaded'),
        navigation: performance.getEntriesByType('navigation')[0]?.type
      };
    })()`);
    if (!state) { check('the world came up', false, 'it did not answer'); return out; }
    check('the module came up', state.up);
    check('our sheet is registered and draws', state.sheet && state.tiles > 0, state.sheetError ?? `${state.tiles} condition tiles`);
    check('the scripts running are this version\'s', state.newLivePatch && state.newRounds);
    check('the version is remembered', state.seen === state.version, `${state.seen} / ${state.version}`);
    check(c.reloads ? 'the page loaded again, once' : 'the page did not load again',
      c.reloads ? (state.reloaded === state.version && state.navigation === 'reload') : (!state.reloaded && state.navigation !== 'reload'),
      `reloaded ${state.reloaded}, navigation ${state.navigation}`);
    const after = proxy.asked.reloads;
    /* The next load of the same version asks for nothing again. */
    await b.send('Page.navigate', { url: `${base}/game` });
    up = false;
    for (let i = 0; i < 400 && !up; i++) { await b.sleep(1000); up = await ask('!!(window.game && game.ready && globalThis.a5eMancer)'); }
    check('a later load comes up', up);
    check('a later load does not read the scripts again', proxy.asked.reloads === after, `${proxy.asked.reloads - after} scripts reloaded`);
  } finally {
    b.close();
    for (const s of [proxy.server, proxy.assetServer]) {
      if (!s) continue;
      s.closeAllConnections?.();
      await new Promise((r) => s.close(r));
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  return out;
}

let failed = 0, total = 0;
for (const c of CASES) {
  if (ONLY && !c.name.includes(ONLY)) continue;
  console.log(c.name);
  for (const [name, ok, detail] of await run(c)) {
    total++; if (!ok) failed++;
    console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? `   (${detail})` : ''}`);
  }
}
console.log(`\n${total - failed}/${total} checks passed`);
process.exit(failed || process.exitCode ? 1 : 0);
