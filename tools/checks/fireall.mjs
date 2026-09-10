/* Fire every action handler the sheet binds, and see what each one does.
 *
 * Static checks have twice told me a control was dead when it was not, and once
 * the other way. So this clicks them: build a DOM from the sheet's own HTML,
 * bind the listeners, then for each element carrying a data-action, call its
 * handlers and record whether anything happened — a document write, an a5e API
 * call, a re-render — or nothing at all.
 *
 * "Nothing at all" is not proof of a bug: a handler can legitimately decline
 * (an already-known maneuver, a value unchanged). It is a list of places to
 * look, which is all a check ever is.
 *
 * The DOM and the actor live in lib/sheetdom.mjs, shared with controls.mjs.
 */
import { buildSheet, listeners, takeEffects, eventOn } from './lib/sheetdom.mjs';

const { root } = await buildSheet();

/* Every element carrying a data-action, one of each action. */
const seen = new Map();
(function walk(n) {
  const a = n.attrs?.['data-action'];
  if (a && !seen.has(a)) seen.set(a, n);
  for (const c of n.children) walk(c);
})(root);

const silent = [], threw = [], worked = [];
for (const [action, el] of [...seen].sort()) {
  const fns = listeners.filter(l => l.el === el && (l.type === 'click' || l.type === 'change'));
  if (!fns.length) { silent.push([action, 'no listener on this element']); continue; }
  takeEffects();
  let error = null;
  for (const l of fns) {
    try { await l.fn(eventOn(el)); } catch (e) { error = e.message; }
  }
  const effects = takeEffects();
  if (error) threw.push([action, error]);
  else if (!effects.length) silent.push([action, 'ran, changed nothing']);
  else worked.push([action, effects.join(', ')]);
}

console.log(`${seen.size} distinct actions drawn on this character\n`);
console.log(`did something : ${worked.length}`);
console.log(`threw         : ${threw.length}`);
console.log(`silent        : ${silent.length}\n`);
for (const [a, e] of threw)  console.log(`  THREW   ${a.padEnd(24)} ${e}`);
for (const [a, w] of silent) console.log(`  silent  ${a.padEnd(24)} ${w}`);
