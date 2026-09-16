/* Exertion: can it be set, where a5e allows it — and on a monster at all?
 *
 * Reported as: let exertion points be edited; an NPC given some has none.
 *
 * a5e (ActorManueverFooter.svelte) shows a character's pool as two fields,
 * the total disabled while automationAvailable — while the character has a
 * class to work it out from. A monster it shows nothing for, and could not:
 * NPCDataModel.ts has no attributes.exertion, so Foundry drops a write there.
 * A monster's exertion is kept on this module's flag instead.
 *
 * Then: unlocked, it still could not be corrected. It can now, and where a5e
 * works the pool out the correction is an exertion bonus a5e adds itself.
 */
import { buildSheet, listeners, q } from './lib/sheetdom.mjs';
import { buildNPCSheet } from './lib/npcdom.mjs';

const results = [];
const check = (name, ok, detail) => results.push([name, ok, detail]);
const fire = async (el, type) => {
  for (const l of listeners.filter((x) => x.el === el && x.type === type))
    await l.fn({ preventDefault(){}, stopPropagation(){}, currentTarget: el, target: el });
};
const byId = (root, id) => q(root, `#${id}`)[0] ?? null;

/* A character whose classes give the pool: a5e's figure, not a field. */
{
  const { actor, render, writes } = await buildSheet();
  actor.automationAvailable = true;
  actor.flags.a5e = { ...(actor.flags.a5e ?? {}), sheetIsLocked: true };
  actor.system.attributes.exertion = { current: 2, max: 4, recoverOnRest: true };
  const root = await render();
  check('locked, a character with classes: the pool size is a5e’s figure, not a field',
    !byId(root, 'am-exertion-max') && byId(root, 'am-exertion-current')?.dataset.path === 'system.attributes.exertion.current',
    byId(root, 'am-exertion-max') ? 'a field was drawn' : 'figure shown, current editable');
}

/* The same character, unlocked. Reported as: with the padlock open exertion
   still cannot be corrected. a5e overwrites a stored max on every prepare when
   a class grant sets the pool (character.ts prepareMaxExertion), so a typed
   size goes in as an exertion bonus of this sheet's, which a5e adds itself. */
{
  const { actor, render, writes } = await buildSheet();
  actor.automationAvailable = true;
  actor.flags.a5e = { ...(actor.flags.a5e ?? {}), sheetIsLocked: false };
  actor.system.attributes.exertion = { current: 2, max: 4, recoverOnRest: true };
  actor.system.bonuses = { ...(actor.system.bonuses ?? {}), exertion: {} };
  let root = await render();
  let max = byId(root, 'am-exertion-max');
  check('unlocked, a character with classes: the pool size is a field',
    max?.dataset.derived === 'true', max ? `data-derived=${max.dataset.derived}` : 'no field');

  writes.length = 0;
  if (max) { max.value = '6'; await fire(max, 'change'); }
  const bonusKey = 'system.bonuses.exertion.amSheetExertion1';
  check('typing 6 over a5e’s 4 adds an exertion bonus of 2, not a stored max',
    writes.some((w) => w[bonusKey]?.formula === '2') && !writes.some((w) => 'system.attributes.exertion.max' in w),
    JSON.stringify(writes));

  /* As a5e would prepare it with that bonus in place. */
  actor.system.bonuses.exertion.amSheetExertion1 = { formula: '2', label: 'Sheet correction', img: '' };
  actor.system.attributes.exertion.max = 6;
  root = await render();
  max = byId(root, 'am-exertion-max');
  writes.length = 0;
  if (max) { max.value = '5'; await fire(max, 'change'); }
  check('and 5 afterwards makes it 1, counted from a5e’s own 4',
    writes.some((w) => w[bonusKey]?.formula === '1'), JSON.stringify(writes));

  writes.length = 0;
  if (max) { max.value = '4'; await fire(max, 'change'); }
  const removed = writes.some((w) => `system.bonuses.exertion.-=amSheetExertion1` in w
    || (w[bonusKey] && typeof w[bonusKey] === 'object' && !('formula' in w[bonusKey])));
  check('back to a5e’s own figure, the bonus is removed rather than left at 0', removed, JSON.stringify(writes));

  /* Foundry 14's way of removing a key, where it exists. */
  const saved = foundry.data;
  class ForcedDeletion {}
  foundry.data = { operators: { ForcedDeletion } };
  writes.length = 0;
  if (max) { max.value = '4'; await fire(max, 'change'); }
  foundry.data = saved;
  check('with Foundry’s ForcedDeletion, that is what removes it',
    writes.some((w) => w[bonusKey] instanceof ForcedDeletion), JSON.stringify(writes));
}

/* A character with nothing to work it out from: both fields, in system. */
{
  const { actor, render, writes } = await buildSheet();
  actor.automationAvailable = false;
  actor.system.attributes.exertion = { current: 1, max: 2, recoverOnRest: true };
  const root = await render();
  const max = byId(root, 'am-exertion-max');
  check('a character with no class: the pool size is a field, as a5e leaves it',
    max?.dataset.path === 'system.attributes.exertion.max', max ? max.dataset.path : 'no field');
  writes.length = 0;
  if (max) { max.value = '6'; await fire(max, 'change'); }
  check('typing a size writes system.attributes.exertion.max',
    writes.some((w) => w['system.attributes.exertion.max'] === 6), JSON.stringify(writes.at(-1) ?? null));
}

/* A monster: kept on the module's flag, both fields, and the steps. */
{
  const { actor, render, writes, flags } = await buildNPCSheet();
  flags['a5e-mancer'] = { ...(flags['a5e-mancer'] ?? {}), exertion: { current: 1, max: 3 } };
  const root = await render();
  const cur = byId(root, 'am-exertion-current');
  const max = byId(root, 'am-exertion-max');
  check('a monster: both fields, on this module’s flag',
    cur?.dataset.path === 'flags.a5e-mancer.exertion.current' && max?.dataset.path === 'flags.a5e-mancer.exertion.max',
    `${cur?.dataset.path} / ${max?.dataset.path}`);
  check('a monster: the fields show what the flag holds',
    cur?.attrs?.value === '1' && max?.attrs?.value === '3', `${cur?.attrs?.value} / ${max?.attrs?.value}`);

  writes.length = 0;
  if (max) { max.value = '5'; await fire(max, 'change'); }
  check('typing a monster’s pool size writes the flag, not system',
    writes.some((w) => w['flags.a5e-mancer.exertion.max'] === 5) && !writes.some((w) => Object.keys(w).some((k) => k.startsWith('system.attributes.exertion'))),
    JSON.stringify(writes));

  writes.length = 0;
  const plus = q(root, '[data-action="exertion-step"]').find((b) => b.dataset.delta === '1');
  if (plus) await fire(plus, 'click');
  check('the plus regains one on the flag', writes.some((w) => w['flags.a5e-mancer.exertion.current'] === 2),
    JSON.stringify(writes));
}

let bad = 0;
for (const [name, ok, detail] of results) {
  if (!ok) bad++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name.padEnd(70)} ${detail}`);
}
process.exit(bad ? 1 : 0);
