/* Does the Settings tab offer what a5e's settings pages offer, to the same kind
 * of actor, ticked the way a5e ticks it for an actor that has never been set?
 *
 * Reported, again, as: the boxes will not come off.
 *
 * settingsflip.mjs had proved every box turns off and on through a redraw —
 * on a character. On a monster, "Show experience" was drawn and forced on, so
 * it could not come off at all; a5e does not offer that box for an NPC. And
 * eight boxes read an unset flag as unticked where a5e reads it as on. The
 * list and its defaults had been written from memory. This reads them out of
 * a5e's own source instead, so the two cannot drift apart unnoticed.
 *
 * What is parsed, from a5e.js.map: every settings sub-page's
 *   checked={flags?.KEY ?? DEFAULT}          (and actorStore.… for exertion)
 * with the {#if …} blocks around it, and which pages ActorSettingsPage shows
 * to which actor type.
 */
import { readFileSync } from 'fs';
import { buildSheet, q, R } from './lib/sheetdom.mjs';
import { buildNPCSheet } from './lib/npcdom.mjs';

const map = JSON.parse(readFileSync('c:/Users/Jonkm/AppData/Local/FoundryVTT/Data/systems/a5e/a5e.js.map', 'utf8'));
const src = (re) => { const i = map.sources.findIndex((s) => re.test(s)); return i < 0 ? null : map.sourcesContent[i]; };

/* Which sub-page each actor type sees. */
const page = src(/ActorSettingsPage\.svelte$/);
const PAGES = [...page.matchAll(/component:\s*(\w+),[\s\S]*?(?:display:\s*actor\.type === "(\w+)")?,?\s*\}/g)]
  .map(([, comp, onlyFor]) => ({ comp, onlyFor: onlyFor ?? null }));

/* Every checkbox on those pages, with the conditions it sits inside. */
const boxes = [];
for (const { comp, onlyFor } of PAGES) {
  const text = src(new RegExp(`${comp}\\.svelte$`));
  if (!text) continue;
  const conds = [];
  for (const line of text.split('<style')[0].split('\n')) {
    const open = line.match(/\{#if (.+)\}/);
    if (open) conds.push(open[1].trim());
    if (/\{\/if\}/.test(line)) conds.pop();
    const flag = line.match(/checked=\{flags\??\.\??(\w+) \?\?\s*(.+?)\}\s*$/)
      ?? line.match(/checked=\{flags\??\.\??(\w+) \?\?\s*$/);
    if (flag) boxes.push({ path: `flags.a5e.${flag[1]}`, dflt: (flag[2] ?? '').trim(), conds: [...conds], onlyFor, comp });
    const sys = line.match(/checked=\{actorStore\.([\w.]+)\}/);
    if (sys) boxes.push({ path: `system.${sys[1]}`, dflt: 'stored', conds: [...conds], onlyFor, comp });
  }
}
/* A default split over two lines: `?? \n globalCurrencyWeightTrackingSelection}` */
for (const b of boxes) if (!b.dflt) {
  const text = src(new RegExp(`${b.comp}\\.svelte$`));
  const m = text.match(new RegExp(`flags\\??\\.\\??${b.path.split('.').pop()} \\?\\?\\s*([\\w"]+)\\}`));
  b.dflt = m ? m[1] : '?';
}

/* What a5e's defaults come to for an actor with no flags, in a world whose
   a5e settings are at their own defaults. */
const evalDefault = (d, type) => {
  if (d === 'true') return true;
  if (d === 'false') return false;
  if (d === 'actor.type === "npc"') return type === 'npc';
  if (/automateTokenSize \?\? true/.test(d)) return true;           // world setting, default on
  if (d === 'globalCurrencyWeightTrackingSelection') return false;  // world setting, default off
  return undefined;
};
const evalCond = (c, type) => {
  if (c === 'actor.type === "character"') return type === 'character';
  if (c === 'actor.type === "npc"') return type === 'npc';
  if (c === 'flags?.trackInventoryWeight ?? true') return true;
  return true;
};

/* This sheet's extra, and why it may be. */
const OURS = { 'flags.a5e.showSpellSlots': 'a flag a5e’s SpellBook reads and no settings page sets' };

const results = [];
const check = (name, ok, detail) => results.push([name, ok, detail]);
check('a5e’s settings pages were found and parsed', PAGES.length >= 5 && boxes.length >= 15,
  `${PAGES.length} pages, ${boxes.length} checkboxes`);

for (const [type, build] of [['character', buildSheet], ['npc', buildNPCSheet]]) {
  const { actor, render } = await build();
  actor.flags.a5e = {};                                  // never set by anyone
  const root = await render();
  const drawn = new Map(q(root, '[data-action="setting-toggle"]')
    .map((b) => [b.dataset.path, 'checked' in (b.attrs ?? {})]));

  const expected = boxes.filter((b) => (!b.onlyFor || b.onlyFor === type)
    && b.conds.every((c) => evalCond(c, type)));
  const missing = expected.filter((b) => !drawn.has(b.path)).map((b) => b.path);
  const extra = [...drawn.keys()].filter((p) => !expected.some((b) => b.path === p) && !OURS[p]);
  check(`${type}: offers every box a5e offers a${type === 'npc' ? 'n NPC' : ' character'}`,
    missing.length === 0, missing.join(', ') || `${expected.length} boxes`);
  check(`${type}: offers no box a5e keeps from a${type === 'npc' ? 'n NPC' : ' character'}`,
    extra.length === 0, extra.join(', ') || 'none');

  const wrong = expected
    .filter((b) => b.dflt !== 'stored' && drawn.has(b.path))
    .map((b) => ({ ...b, want: evalDefault(b.dflt, type), got: drawn.get(b.path) }))
    .filter((b) => b.want !== undefined && b.want !== b.got);
  check(`${type}: with nothing set, each box is ticked as a5e ticks it`, wrong.length === 0,
    wrong.map((b) => `${b.path.replace('flags.a5e.', '')} a5e ${b.want ? 'on' : 'off'}, here ${b.got ? 'on' : 'off'}`).join('; ')
      || 'all agree');
}

let bad = 0;
for (const [name, ok, detail] of results) {
  if (!ok) bad++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name.padEnd(62)} ${detail}`);
}
process.exit(bad ? 1 : 0);
