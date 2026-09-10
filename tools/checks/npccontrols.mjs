/* The NPC sheet's own controls, pressed on a real monster.
 *
 * Reported twice, and twice not reproduced from reading the code: "the padlock
 * does not work on the NPC". The template draws it, the class inherits the
 * handler that binds it, and the character sheet's own round-trip check says
 * the lock flips. All of that was true and none of it settled the question,
 * because none of it rendered the NPC sheet.
 *
 * So this does: a5e's own monster out of its pack, the generated NPC template,
 * the inherited activateListeners, and then the button is clicked and the flag
 * is read back — and clicked again, since a lock that only opens is half a
 * lock.
 */
import { buildNPCSheet, listeners, takeEffects, q } from './lib/npcdom.mjs';

const { sheet, root, actor, render, monster, population } = await buildNPCSheet();

const results = [];
const check = (name, ok, detail) => results.push([name, ok, detail]);

async function fireType(el, type) {
  const fns = listeners.filter(l => l.el === el && l.type === type);
  for (const f of fns) await f.fn({ preventDefault(){}, stopPropagation(){},
    currentTarget: el, target: el, clientX: 0, clientY: 0, shiftKey: false, button: 0 });
  return fns.length;
}

/* ── the padlock ────────────────────────────────────────────────────────── */
{
  const btn = root.querySelector('[data-action="toggle-lock"]');
  const before = actor.getFlag('a5e', 'sheetIsLocked') ?? true;
  const bound = btn ? await fireType(btn, 'click') : 0;
  const after = actor.getFlag('a5e', 'sheetIsLocked') ?? true;

  check('the padlock is drawn on the NPC sheet', !!btn,
    btn ? 'one button, data-action="toggle-lock"' : 'the template renders no padlock');
  check('a click on it is bound to a handler', bound > 0,
    `${bound} listener(s) on that element`);
  check('the lock flips a5e’s own flag', before !== after,
    `sheetIsLocked ${before} -> ${after}`);

  /* And back, on a freshly rendered sheet — the second click is drawn by a
     different branch of the template. */
  const root2 = await render();
  const btn2 = root2.querySelector('[data-action="toggle-lock"]');
  const mid = actor.getFlag('a5e', 'sheetIsLocked') ?? true;
  if (btn2) await fireType(btn2, 'click');
  const end = actor.getFlag('a5e', 'sheetIsLocked') ?? true;
  check('and locks again from the unlocked state', !!btn2 && mid !== end,
    btn2 ? `sheetIsLocked ${mid} -> ${end}` : 'no padlock on the unlocked sheet');

  /* Unlocking has to actually change what is drawn, or the button is honest
     and useless. */
  const editable = (r) => q(r, '[data-action="trait-config"]').length
                        + q(r, '[data-action="item-delete"]').length;
  check('unlocking reveals the controls it is for', editable(root2) !== editable(root),
    `${editable(root)} editing controls locked, ${editable(root2)} unlocked`);

  /* And the case that was actually broken.

     The padlock used to be bound below activateListeners' `if (!this.isEditable)
     return`, so a sheet that is not editable drew the button and bound nothing
     to it. isEditable is options.editable AND isOwner, and Foundry clears it
     for a locked compendium too — all far more common on a monster than on the
     character you own, which is why it was reported for the NPC sheet and
     never for the other one. */
  Object.defineProperty(sheet, 'isEditable', { get: () => false, configurable: true });
  listeners.length = 0;
  const root3 = await render();
  const btn3 = root3.querySelector('[data-action="toggle-lock"]');
  const boundWhenNotEditable = btn3
    ? listeners.filter(l => l.el === btn3 && l.type === 'click').length : 0;
  check('the padlock still works on a sheet that is not editable',
    boundWhenNotEditable > 0,
    btn3 ? `${boundWhenNotEditable} listener(s) with isEditable false`
         : 'no padlock drawn at all');
}

console.log(`driving ${monster}, one of ${population} monsters in a5e's pack\n`);
let bad = 0;
for (const [name, ok, detail] of results) {
  if (!ok) bad++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}`);
  console.log(`        ${detail}`);
}
console.log(bad ? `\n${bad} NPC control(s) do not do what they are for`
                : `\nevery NPC control checked here does what it is for`);
process.exit(bad ? 1 : 0);
