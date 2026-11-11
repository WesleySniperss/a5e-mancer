/* The graphics card drops the scene, the dice box dies, the page loads again: what the Graphics Guard does, in real Foundry.
 *
 * "Every round the page reloaded, or stopped counting, or showed a white
 * screen" (2026-11-10): the GM's weak laptop in a fight with players connected.
 * The console showed every WebGL context of the page lost at once, then Dice So
 * Nice with "Error creating WebGL context". Foundry has no code for a lost
 * context, Dice So Nice holds every roll behind an animation its dead box never
 * runs, and Foundry reloads the page after five seconds without the server
 * without saying why.
 *
 * A browser cannot be made to crash its graphics process on request, so the
 * losses here are made with WebGL's own WEBGL_lose_context, held lost for as
 * long as the case needs. This checks, with the canvas on:
 *   - a context PIXI takes straight back: nothing is redrawn;
 *   - one gone for three seconds: said, and the scene drawn again when it is
 *     back (the screen is read back: the tokens are there);
 *   - one not back after ten: said, with what to do;
 *   - lost again and again: nothing is offered and nothing turned down;
 *   - the dice box rebuilt with no context to be had: the held roll is shown,
 *     later rolls show at once, 3D dice are left off;
 *   - light graphics on: core's four settings, and after a reload no dice
 *     canvas is made and rolls show at once; off: every one as it was, the 3D
 *     dice back, nothing having been written to the user;
 *   - the connection lost for seven seconds: Foundry reloads the page and the
 *     next page says why; a page that ended without closing is told from that;
 *   - a5eMancer.sessionReport() carries all of it across the reloads.
 * It writes this browser's client settings only, and puts them back.
 *
 *   node tools/checks/graphics.mjs --url <a copy's url> --user <a GM's user id>
 */
import { pathToFileURL } from 'url';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { openBrowser } from './lib/cdp.mjs';
import { readPng } from './lib/png.mjs';

const arg = (name, fallback) => {
  const i = process.argv.indexOf('--' + name);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const BASE = arg('url', 'http://localhost:30011');
const USER = arg('user', null);
const Q = JSON.stringify;
const SHOTS = mkdtempSync(path.join(tmpdir(), 'am-graphics-'));

let failures = 0, passes = 0;
const check = (ok, label, detail = '') => {
  ok ? passes++ : failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? ': ' + detail : ''}`);
};

const b = await openBrowser({ port: 9458, width: 1500, height: 900 });
const ev = (expr, ms = 180000) => Promise.race([b.evaluate(expr),
  new Promise((_, rej) => setTimeout(() => rej(new Error('the page did not answer: ' + expr.trim().slice(0, 70))), ms))]);

/* Before any script of a page: which canvases were given a WebGL context, and by whom */
await b.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
  const made = []; window.__gl = made;
  const get = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
    const ctx = get.call(this, type, ...rest);
    if (/webgl/i.test(String(type)) && ctx && !this.__noted) {
      this.__noted = true;
      made.push(/\\/modules\\/([^/]+)\\//.exec(new Error().stack || '')?.[1] ?? 'core');
    }
    return ctx;
  };
})();` });

/* What every page of this check needs: what was said, the scene close up, losing the context for a while */
const KIT = `(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  window.__said = [];
  const was = ui.notifications.notify;
  ui.notifications.notify = function (m, ...r) { window.__said.push(String(m)); return was.call(this, m, ...r); };
  window.__draws = 0;
  Hooks.on('canvasReady', () => window.__draws++);
  if (game.paused) game.togglePause(false, { broadcast: false });
  for (const app of [...(foundry.applications.instances?.values?.() ?? [])]) { if (app.element?.textContent?.includes('Isometric Perspective')) await app.close(); }
  document.querySelectorAll('.application.dialog, dialog.application').forEach(el => el.remove());
  if (canvas.ready && canvas.tokens.placeables.length) {
    const t = canvas.tokens.placeables[0];
    await canvas.animatePan({ x: t.center.x, y: t.center.y, scale: 1.2, duration: 0 });
  }
  /* The context lost, and kept lost for ms: PIXI asks for it back at once, so its asking is held off */
  window.__lose = async (ms) => {
    const ext = canvas.app.renderer.gl.getExtension('WEBGL_lose_context');
    if (ms > 0) ext.restoreContext = () => {};
    ext.loseContext();
    if (ms > 0) { await sleep(ms); delete ext.restoreContext; ext.restoreContext(); }
    await sleep(600);
  };
  window.__sleep = sleep;
  return 'kit';
})()`;

async function enter() {
  await b.send('Page.navigate', { url: `${BASE}/join` });
  await b.sleep(3000);
  await b.evaluate(`fetch('/join', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'join', userid: ${Q(USER)}, userId: ${Q(USER)}, password: '' }) }).then(r => r.status)`);
  await b.evaluate("localStorage.setItem('core.noCanvas', 'false')");
  await b.send('Page.navigate', { url: `${BASE}/game` });
  return arrive();
}
/* A page that has come up, however it was asked for: by this script, or by Foundry reloading it */
async function arrive() {
  let ready = false;
  for (let i = 0; i < 400 && !ready; i++) { await b.sleep(1000); try { ready = await b.evaluate('!!(window.game && game.ready && globalThis.a5eMancer && canvas?.ready && !window.__said)'); } catch {} }
  if (!ready) throw new Error('the world never came up');
  await b.sleep(7000);
  await ev(KIT);
}
/* The middle of the board as the screen shows it: how many different colours */
async function colours(name) {
  const file = path.join(SHOTS, name + '.png');
  await b.shot(pathToFileURL(file), { x: 260, y: 140, width: 860, height: 560 });
  const png = readPng(file);
  const seen = new Set();
  for (let y = 4; y < png.height; y += 6) for (let x = 4; x < png.width; x += 6) { const [r, g, bl] = png.pixel(x, y); seen.add((r >> 3) + ',' + (g >> 3) + ',' + (bl >> 3)); }
  return seen.size;
}
const said = () => ev('window.__said.splice(0)');
const report = () => ev('a5eMancer.sessionReport()');

let settingsBefore = null;
try {
  await enter();
  console.log(await ev(`'a5e-mancer ' + game.modules.get('a5e-mancer').version + ', ' + game.modules.filter(m => m.active).length + ' modules, 3D dice ' + (game.dice3d?.box?.initialized ? 'on' : 'off')`));
  settingsBefore = await ev(`({ light: game.settings.get('a5e-mancer', 'lightGraphics'), before: game.settings.get('a5e-mancer', 'lightGraphicsBefore'),
    core: Object.fromEntries(['performanceMode', 'maxFPS', 'pixelRatioResolutionScaling', 'lightAnimation'].map(k => [k, game.settings.get('core', k)])),
    dsn: game.modules.get('dice-so-nice')?.active ? (game.settings.get('dice-so-nice', 'settings') ?? {}) : null })`);
  if (settingsBefore.light) throw new Error('light graphics is already on in this browser profile: nothing to compare with');

  console.log('the record');
  let text = await report();
  check(/graphics: .+; context alive/.test(text) && /record, oldest first/.test(text) && /page: opened/.test(text), 'a5eMancer.sessionReport() names the graphics card and keeps a record', text.split('\n').find(l => l.startsWith('graphics:'))?.slice(0, 110));

  console.log('the scene\'s graphics lost');
  const alive = await colours('before');
  await ev('window.__lose(0)');
  await b.sleep(2500);
  let draws = await ev('window.__draws');
  check(draws === 0 && (await colours('instant')) >= alive * 0.8, 'taken straight back (PIXI\'s own doing): nothing is drawn again, the scene is there', `${draws} redraws`);
  await said();
  await ev('window.__lose(3000)');
  await b.sleep(6000);
  let heard = await said();
  draws = await ev('window.__draws');
  text = await report();
  const after = await colours('after-3s');
  check(heard.some(s => /dropped the scene/.test(s)) && heard.some(s => /graphics are back/.test(s)), 'gone for three seconds: said when lost and when back', heard.filter(s => /A5e Mancer/.test(s)).map(s => s.slice(11, 60)).join(' / '));
  check(draws === 1 && /came back after 3\.\d s/.test(text) && /the scene was drawn again/.test(text), 'and the scene is drawn again, once', `${draws} redraw(s)`);
  check(after >= alive * 0.8, 'the screen shows the tokens again', `${alive} colours before, ${after} after`);

  await ev(`(async () => { window.__gone = window.__lose(12500); return 1; })()`);
  await b.sleep(11500);
  heard = await said();
  check(heard.some(s => /has not given the scene's graphics back/.test(s)), 'not back after ten seconds: said, with what to do', heard.filter(s => /not given/.test(s)).map(s => s.slice(11, 90)).join(''));
  await ev('window.__gone');
  await b.sleep(5000);

  /* That was the third loss in a few minutes. Nothing is offered or turned
     down for anyone: "don't switch it all off to save" (2026-11-11). */
  const offer = await ev(`(async () => {
    await window.__sleep(4000);
    const dialog = [...document.querySelectorAll('.application.dialog, dialog.application')].find(el => /Light Graphics/i.test(el.textContent));
    return { offered: !!dialog, light: game.settings.get('a5e-mancer', 'lightGraphics'), mode: game.settings.get('core', 'performanceMode') };
  })()`);
  check(!offer.offered && offer.light === false && offer.mode === settingsBefore.core.performanceMode, 'lost again and again: nothing is offered or turned down', JSON.stringify(offer));

  console.log('Dice So Nice with no graphics to be had');
  const dice = await ev(`(async () => {
    const sleep = window.__sleep;
    const d = game.dice3d;
    if (!d?.box?.initialized) return { skipped: true };
    const rollShown = async (label, wait) => {
      const before = game.messages.contents.at(-1)?.id;
      const t0 = performance.now();
      new Roll('1d20').toMessage({ flavor: 'AM graphics ' + label });
      let m = null; for (let i = 0; i < 40 && !m; i++) { await sleep(100); const l = game.messages.contents.at(-1); if (l && l.id !== before) m = l; }
      if (!m) return -1;
      for (let i = 0; i < wait / 100; i++) {
        const el = document.querySelector('.chat-message[data-message-id="' + m.id + '"]');
        if (el && !el.classList.contains('dsn-hide') && !m._dice3danimating) return Math.round(performance.now() - t0);
        await sleep(100);
      }
      return null;
    };
    const get = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...rest) { return /webgl/i.test(String(type)) ? null : get.call(this, type, ...rest); };
    try { d.resizeAndRebuild(); } catch { /* "Error creating WebGL context", as in the user's console */ }
    await sleep(1200);
    HTMLCanvasElement.prototype.getContext = get;
    const first = await rollShown('held', 20000);
    const second = await rollShown('after', 6000);
    return { box: !!d.box?.initialized, first, second, off: d.messageHookDisabled === true };
  })()`, 120000);
  heard = await said();
  if (dice.skipped) console.log('  (3D dice are not on in this copy: skipped)');
  else {
    check(dice.box === false && dice.first !== null && dice.first > 0, 'the roll held behind a dead dice box is shown', `after ${dice.first} ms`);
    check(dice.off && dice.second !== null && dice.second < 3000 && heard.some(s => /could not start its 3D dice/.test(s)), 'later rolls show at once, and it is said that 3D dice are off', `after ${dice.second} ms`);
  }

  console.log('light graphics');
  await ev(`(async () => { await game.settings.set('a5e-mancer', 'lightGraphics', true); await window.__sleep(2500); return 1; })()`);
  const lit = await ev(`({ core: Object.fromEntries(['performanceMode', 'maxFPS', 'pixelRatioResolutionScaling', 'lightAnimation'].map(k => [k, game.settings.get('core', k)])),
    kept: game.settings.get('a5e-mancer', 'lightGraphicsBefore') })`);
  check(lit.core.performanceMode === 0 && lit.core.maxFPS === 30 && lit.core.pixelRatioResolutionScaling === false && lit.core.lightAnimation === false,
    'on: low performance mode, 30 fps, no resolution scaling, no animated lights', Q(lit.core));
  check(lit.kept['core.performanceMode'] === settingsBefore.core.performanceMode && lit.kept['core.maxFPS'] === settingsBefore.core.maxFPS, 'what they were is kept', Q(lit.kept));
  await enter();
  const light = await ev(`(async () => {
    const before = game.messages.contents.at(-1)?.id; const t0 = performance.now();
    new Roll('1d20').toMessage({ flavor: 'AM graphics light' });
    let shown = null;
    for (let i = 0; i < 60 && shown === null; i++) {
      await window.__sleep(100);
      const m = game.messages.contents.at(-1);
      const el = m && m.id !== before ? document.querySelector('.chat-message[data-message-id="' + m.id + '"]') : null;
      if (el && !el.classList.contains('dsn-hide') && !m._dice3danimating) shown = Math.round(performance.now() - t0);
    }
    return { gl: window.__gl.slice(), mode: canvas.performance.mode, fps: canvas.performance.fps, dice: !!game.dice3d?.box?.initialized, shown };
  })()`);
  text = await report();
  check(!light.gl.includes('dice-so-nice') && !light.dice && light.shown !== null && light.shown < 3000, 'after a reload: no dice canvas is made, and a roll shows at once', `contexts: ${light.gl.join(', ')}; roll shown after ${light.shown} ms`);
  check(light.mode === 0 && light.fps === 30, 'the scene runs in low mode at 30 fps', `mode ${light.mode}, ${light.fps} fps`);
  check(/light graphics turned on/.test(text) && /light graphics ON/.test(text), 'the record came across the reload', text.split('\n').find(l => /Foundry's settings here/.test(l))?.slice(0, 120));
  await ev(`(async () => { await game.settings.set('a5e-mancer', 'lightGraphics', false); await window.__sleep(2500); return 1; })()`);
  const unlit = await ev(`({ core: Object.fromEntries(['performanceMode', 'maxFPS', 'pixelRatioResolutionScaling', 'lightAnimation'].map(k => [k, game.settings.get('core', k)])),
    dsn: game.modules.get('dice-so-nice')?.active ? (game.settings.get('dice-so-nice', 'settings') ?? {}) : null, kept: game.settings.get('a5e-mancer', 'lightGraphicsBefore') })`);
  check(Q(unlit.core) === Q(settingsBefore.core) && Q(unlit.dsn) === Q(settingsBefore.dsn) && !Object.keys(unlit.kept).length, 'off: every one of them as it was', Q(unlit.core));
  await enter();
  const back = await ev(`({ gl: window.__gl.slice(), dice: !!game.dice3d?.box?.initialized, flag: game.user.getFlag('dice-so-nice', 'settings')?.visibility ?? null })`);
  if (settingsBefore.dsn !== null) check(back.gl.includes('dice-so-nice') && back.dice && back.flag !== 'none', 'and after a reload the 3D dice are there again: nothing was written to the user', `contexts: ${back.gl.join(', ')}; the user's own choice: ${back.flag ?? 'never set'}`);

  console.log('a page that loads again');
  /* The server gone for seven seconds: Foundry reloads the page after five or more */
  await ev(`(() => { const io = game.socket.io; io.reconnectionDelay(7000); io.reconnectionDelayMax(7000); io.randomizationFactor(0); setTimeout(() => io.engine.close(), 50); return 1; })()`);
  await b.sleep(9000);
  await arrive();
  await b.sleep(1500);
  heard = await said();
  text = await report();
  const why = text.split('\n').find(l => /Foundry loaded the page again/.test(l)) ?? '';
  check(/connection to the server was lost for \d+ seconds/.test(why) && /connection: lost/.test(text), 'the connection lost for seven seconds: the next page\'s record says why Foundry reloaded', why.trim().slice(0, 130));
  /* A page that ends without its goodbye: what a crashed tab leaves */
  await ev(`(() => { window.addEventListener('pagehide', () => { const k = 'a5e-mancer.session'; const s = JSON.parse(localStorage.getItem(k)); s.clean = false; s.why = ''; localStorage.setItem(k, JSON.stringify(s)); }); return 1; })()`);
  await enter();
  text = await report();
  check(/ended without closing/.test(text), 'a page that ended without closing is told apart', (text.split('\n').find(l => /ended without closing/.test(l)) ?? '').trim().slice(0, 110));
} catch (err) {
  failures++;
  console.log('FAILED', err.message);
}

/* This browser's settings as they were */
try {
  if (settingsBefore) await b.evaluate(`(async () => {
    if (game.settings.get('a5e-mancer', 'lightGraphics')) { await game.settings.set('a5e-mancer', 'lightGraphics', false); await new Promise(r => setTimeout(r, 2500)); }
    for (const m of game.messages.filter(x => String(x.flavor).startsWith('AM graphics '))) await m.delete();
    return 'ok';
  })()`);
} catch {}
const bad = b.console.filter(l => /^\[(error|exception)\]/.test(l) && /a5e-mancer|graphicsGuard/i.test(l)
  /* a5e's own canvasReady handler throws whenever a scene is drawn a second time; the redraw here is one */
  && !/effectsPanelInstance.unmount/.test(l));
if (bad.length) console.log(`console: ${bad.length} errors of ours`);
for (const l of bad.slice(0, 6)) console.log('  ' + l.slice(0, 300).replace(/\n/g, ' | '));
await b.close();
console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
