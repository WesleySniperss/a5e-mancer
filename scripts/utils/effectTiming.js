/**
 * A spell or maneuver must not do anything until it is used.
 *
 * a5e decides that with `system.effectType` on each of an item's effects:
 * `onUse` fires when the action is taken and takes its duration from the spell,
 * `passive` applies for as long as the item is merely owned. The field is a
 * StringField with `initial: "passive"`, and a5e's own applicability rule is
 *
 *   (effect.transfer || effect.system.effectType === "passive") && yield effect
 *
 * so an effect that never states its type is applied the moment the item lands
 * in the spellbook, with no duration and no way to switch it off from the token
 * HUD — it belongs to the item, not the actor. Knowing Invisibility makes you
 * permanently invisible.
 *
 * The a5e compendium types its spell effects correctly. This is a guard against
 * everything that does not: a Scene Packer'd adventure, a hand-built item, an
 * importer, a homebrew spell whose author never opened the Effects tab. Copying
 * such an item faithfully is what the builder does everywhere else, and is
 * exactly wrong here — the copy is going into a spellbook, where "applies while
 * owned" has no meaning a player could want.
 *
 * `condition` effects are left alone: those define a condition rather than
 * describe when one lands.
 */

/** Effect types that already say when they apply, so they are not rewritten. */
const TIMED = new Set(['onUse', 'condition']);

/**
 * Force an item's effects to fire on use rather than on ownership.
 * Mutates the data in place, before it is created on the actor.
 *
 * @param {object} data  an item's `toObject()` data
 * @returns {string[]}   names of the effects that were retimed, for the log
 */
export function castOnlyEffects(data) {
  const changed = [];
  for (const effect of data?.effects ?? []) {
    if (!effect) continue;
    const type = effect.system?.effectType;
    // Missing counts as passive: that is what a5e's schema default makes it.
    if (TIMED.has(type)) continue;

    effect.system ??= {};
    effect.system.effectType = 'onUse';
    changed.push(effect.name ?? '(unnamed effect)');
  }
  return changed;
}
