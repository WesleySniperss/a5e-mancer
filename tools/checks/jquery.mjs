/* activateListeners, called with what Foundry actually hands it.
 *
 * A v1 ActorSheet is given a **jQuery object**, not an element. A jQuery object
 * is array-like and has .find(); it has no querySelector and no
 * querySelectorAll. Call one on it and you get a TypeError.
 *
 * The NPC sheet did exactly that, on every render, for as long as it has
 * existed. `super.activateListeners(html)` ran first and bound everything, so
 * the sheet LOOKED right — and then the throw took out the rest of Foundry's
 * _render, the window's own size and position with it. The sheet opened at the
 * wrong size and jumped when it was redrawn, and the console said TypeError
 * about a statblock nobody was looking at.
 *
 * Every other check here builds a plain element and hands that over, which is
 * why none of them saw it. This one hands over the wrong thing on purpose.
 */
import { buildSheet } from './lib/sheetdom.mjs';
import { buildNPCSheet } from './lib/npcdom.mjs';

/* jQuery, as far as this matters: array-like, .jquery set, .find() present,
   and pointedly no querySelector or querySelectorAll. */
const asJQuery = (el) => ({
  jquery: '3.7.1', length: 1, 0: el,
  find: () => asJQuery(el),
  on: () => {}, off: () => {}, each: () => {}, get: (i) => (i === 0 ? el : undefined)
});

const results = [];
const check = (name, ok, detail) => results.push([name, ok, detail]);

for (const [what, build] of [['the character sheet', buildSheet],
                             ['the NPC sheet', buildNPCSheet]]) {
  const { sheet, root } = await build();
  let error = null;
  try {
    sheet.activateListeners(asJQuery(root));
  } catch (e) {
    error = `${e.constructor.name}: ${e.message}`;
  }
  check(`${what} survives the jQuery object Foundry hands it`, !error,
    error ?? 'no error');
}

let bad = 0;
for (const [name, ok, detail] of results) {
  if (!ok) bad++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}`);
  console.log(`        ${detail}`);
}
console.log(bad ? `\n${bad} sheet(s) throw when rendered the way Foundry renders them`
                : `\nboth sheets take jQuery without throwing`);
process.exit(bad ? 1 : 0);
