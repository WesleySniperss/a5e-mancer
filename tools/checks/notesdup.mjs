/* Does the Notes tab say anything twice?
 *
 * Reported as: Notes and Backstory show the same information twice.
 *
 * The builder writes what it asked for into a5e's fields (composed into
 * notes, bonds and goals) and again, piece by piece, onto this module's flag.
 * The sheet drew both. This renders every character in the world, locked, and
 * compares the text of every block on the Details, Backstory and Notes pages:
 * a block whose text is contained in another block is shown twice.
 */
import { readFileSync } from 'fs';
import { buildSheet, q, R } from './lib/sheetdom.mjs';

const results = [];
const check = (name, ok, detail) => results.push([name, ok, detail]);
const flat = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

const chars = JSON.parse(readFileSync(R + 'world-chars.json', 'utf8'));
let looked = 0;
const doubled = [];
for (const c of chars) {
  const { actor, render } = await buildSheet({ choose: (all) => all.find((x) => x.actor._id === c.actor._id) });
  actor.flags.a5e = { ...(actor.flags.a5e ?? {}), sheetIsLocked: true };
  const root = await render();
  const blocks = [];
  for (const pane of q(root, 'div[data-notes-tab]')) {
    for (const b of [...q(pane, '.am-origin-desc'), ...q(pane, '.list-content'), ...q(pane, '.trait-pill')]) {
      /* A block inside another counts once: .list-content also carries
         .am-origin-desc. */
      if (blocks.some((x) => x.el === b)) continue;
      const t = flat(b.textContent);
      if (t.length >= 4) blocks.push({ el: b, pane: pane.dataset.notesTab, t });
    }
  }
  if (blocks.length) looked++;
  for (let i = 0; i < blocks.length; i++) {
    for (let j = 0; j < blocks.length; j++) {
      if (i === j) continue;
      const a = blocks[i], b = blocks[j];
      if (a.el.parent && q(b.el, '*').includes(a.el)) continue;   // nested
      if (b.t.includes(a.t) && (a.t.length < b.t.length || i < j)) {
        doubled.push(`${c.actor.name}: "${a.t.slice(0, 40)}" (${a.pane}) also in ${b.pane}`);
        break;
      }
    }
  }
}

check('characters with written notes were read', looked >= 10, `${looked} of ${chars.length}`);
check('no text on the Details, Backstory or Notes pages is shown twice', doubled.length === 0,
  doubled.length ? `${doubled.length}: ${doubled.slice(0, 4).join('; ')}` : 'none');

let bad = 0;
for (const [name, ok, detail] of results) {
  if (!ok) bad++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name.padEnd(66)} ${detail}`);
}
process.exit(bad ? 1 : 0);
