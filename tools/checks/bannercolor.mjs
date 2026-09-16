/* What colour is under the banner, and whose is it?
 *
 * Reported as: the banner used to be grey and is red now; grey was better.
 * Then: let it follow the player's colour — not wholly, 10–20% over the grey.
 *
 * Nothing of this module's had changed. Tidy paints the sheet root its red,
 * #741b2b, and always had here; the grey came from Carolingian UI's glass
 * effect, a client setting whose `.window-app` rule outranks Tidy's and paints
 * old-style windows its own near-black. Measured before this change, at the
 * default window: root rgb(116, 27, 43) without the glass, rgba(11, 10, 19,
 * 0.95) with it.
 *
 * This lays the sheet out in headless Edge, sets the custom properties Foundry
 * sets on :root for its users, and reads the root's computed background.
 *
 *   node tools/checks/bannercolor.mjs            the check
 *   node tools/checks/bannercolor.mjs --shots    also a PNG per case
 */
import Handlebars from 'handlebars';
import { existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { buildSheet, R } from './lib/sheetdom.mjs';
import { inBrowser } from './lib/browser.mjs';
import { A5eCharacterSheet } from '../../scripts/app/A5eCharacterSheet.js';

const SHOTS = process.argv.includes('--shots');
const results = [];
const check = (name, ok, detail) => results.push([name, ok, detail]);

/* ── Whose colour: the owner, their character first, else the viewer ────── */
{
  const actor = { id: 'a1', testUserPermission: (u) => u.owns.includes('a1') };
  const gm = { id: 'gm', isGM: true, owns: ['a1'] };
  const p1 = { id: 'p1', isGM: false, owns: ['a1'], character: { id: 'zz' } };
  const p2 = { id: 'p2', isGM: false, owns: ['a1'], character: { id: 'a1' } };
  const p3 = { id: 'p3', isGM: false, owns: [] };
  const users = (list) => ({ filter: (f) => list.filter(f) });
  const saved = globalThis.game;
  globalThis.game = { ...(saved ?? {}), users: users([gm, p1, p2, p3]) };
  const both = A5eCharacterSheet.playerColorVar(actor);
  game.users = users([gm, p1, p3]);
  const one = A5eCharacterSheet.playerColorVar(actor);
  game.users = users([gm, p3]);
  const none = A5eCharacterSheet.playerColorVar(actor);
  globalThis.game = saved;
  check('two owners: the one whose character it is', both === 'var(--user-color-p2, var(--user-color))', both);
  check('one owner, whatever their character', one === 'var(--user-color-p1, var(--user-color))', one);
  check('no player owns it (the GM does not count): the viewer', none === 'var(--user-color)', none);
}

/* ── In the browser ──────────────────────────────────────────────────────── */
const { sheet } = await buildSheet();
const tpl = Handlebars.compile(readFileSync(R + 'templates/sheet/tidy-character-sheet.hbs', 'utf8'));
const markup = tpl(await sheet.getData());
const CRLNGN = R.replace(/a5e-mancer\/$/, '') + 'crlngn-ui/styles/crlngn-ui-v14.css';

function measure(doc, c) {
  const root = doc.querySelector('.tidy5e-sheet');
  for (const [k, v] of Object.entries(c.rootVars ?? {})) doc.documentElement.style.setProperty(k, v);
  if (c.player) root.style.setProperty('--am-player-color', c.player);
  if (c.glass) doc.body.classList.add('crlngn-ui', 'crlngn-glass-effect');
  return { bg: getComputedStyle(root).backgroundColor };
}

/* Chrome reports a color-mix() as color(srgb r g b) in 0..1. */
const rgb = (s) => {
  let m = /color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)(?: \/ ([\d.]+))?\)/.exec(s);
  if (m) return [m[1], m[2], m[3]].map((x) => Math.round(Number(x) * 255)).concat(m[4] === undefined ? 1 : Number(m[4]));
  m = /rgba?\((\d+), (\d+), (\d+)(?:, ([\d.]+))?\)/.exec(s);
  return m ? [m[1], m[2], m[3]].map(Number).concat(m[4] === undefined ? 1 : Number(m[4])) : null;
};
const GREY = [0x1a, 0x1b, 0x20];
const mix = (c) => c.map((v, i) => Math.round(0.15 * v + 0.85 * GREY[i]));
const near = (a, b) => !!a && a.slice(0, 3).every((v, i) => Math.abs(v - b[i]) <= 1) && a[3] === 1;

const cases = [
  { name: 'no player colour', want: GREY },
  { name: 'red player', rootVars: { '--user-color-p1': '#e03030' }, player: 'var(--user-color-p1, var(--user-color))', want: mix([0xe0, 0x30, 0x30]) },
  { name: 'blue player', rootVars: { '--user-color-p1': '#3070e0' }, player: 'var(--user-color-p1, var(--user-color))', want: mix([0x30, 0x70, 0xe0]) },
  { name: 'owner gone, the viewer', rootVars: { '--user-color': '#30c050' }, player: 'var(--user-color-p9, var(--user-color))', want: mix([0x30, 0xc0, 0x50]) },
  { name: 'no colour resolves at all', player: 'var(--user-color-p9, var(--user-color))', want: GREY },
  { name: 'Carolingian glass on, red player', glass: true, rootVars: { '--user-color-p1': '#e03030' }, player: 'var(--user-color-p1, var(--user-color))', want: mix([0xe0, 0x30, 0x30]) }
];

for (const c of cases) {
  if (c.glass && !existsSync(CRLNGN)) { check(c.name, true, 'skipped: Carolingian UI not installed'); continue; }
  const html = (c.glass ? `<link rel="stylesheet" href="file:///${CRLNGN}">` : '') + markup;
  const { out } = inBrowser({
    html, rootClasses: sheet.constructor.defaultOptions.classes,
    screenshot: SHOTS ? join(tmpdir(), `am-banner-${c.name.replace(/\W+/g, '-')}.png`) : undefined,
    probe: new Function('doc', `return (${measure.toString()})(doc, ${JSON.stringify(c)});`)
  });
  const got = rgb(out.bg);
  check(`${c.name}: rgb(${c.want.join(', ')})`, near(got, c.want), out.bg);
}

let bad = 0;
for (const [name, ok, detail] of results) {
  if (!ok) bad++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name.padEnd(62)} ${detail}`);
}
if (SHOTS) console.log(`\n  pictures in ${tmpdir()}\\am-banner-*.png`);
process.exit(bad ? 1 : 0);
