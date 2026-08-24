/**
 * Where a condition on an actor actually comes from.
 *
 * a5e applies an item's effect to its owner under a rule of its own:
 *
 *   *allApplicableEffects() {
 *     for (let e of this.effects) yield e;
 *     for (let e of this.items) for (let t of e.effects)
 *       (t.transfer || t.system.effectType === "passive") && (yield t);
 *   }
 *
 * — so `transfer: false` does not keep an item's effect off the actor. And
 * `system.effectType` is a StringField with `initial: "passive"`, which means an
 * effect that never states its type is applied the moment the item is owned.
 * Several compendium spells are like this: knowing Invisibility makes you
 * invisible, with no casting involved.
 *
 * Those effects reach `actor.statuses`, so the sheet correctly paints the
 * condition as on — but they are NOT in `actor.effects`, which holds only the
 * actor's own embedded effects. Code that looked for the active condition there
 * found nothing, concluded it was off, and created a second one. Clicking to
 * turn a condition off therefore turned another one on, and the pile could not
 * be cleared: deleting the actor-level copy left the item still applying its
 * own. Every path that asks "is this condition on, and what do I do about it"
 * has to go through here.
 */
export class ConditionSource {

  /**
   * Conditions another module runs the whole life cycle of, which this one must
   * not sweep up.
   *
   * TSL: Social Conflict owns its social states (⚔ Rattled, Smitten, …) and its
   * wounds (❤): it applies them from social maneuvers and clears them by its own
   * rules — Hold the Line, the card pips, the end of a scene. A blanket "clear
   * every condition" that took those with it would leave that module's state
   * machine out of step with the token, and nothing here would put it back.
   * It marks its own effects both ways, so both are checked.
   */
  static FOREIGN_FLAG_SCOPES = ['tsl-social-conflict'];
  static FOREIGN_ID_PREFIXES = ['tsl-'];

  /** Is this condition another module's to remove? */
  static isForeign(effect, id = '') {
    if (this.FOREIGN_ID_PREFIXES.some(p => String(id).startsWith(p))) return true;
    const flags = effect?.flags ?? {};
    return this.FOREIGN_FLAG_SCOPES.some(scope => !!flags[scope]);
  }

  /**
   * @param {Actor}  actor
   * @param {string} id     status/condition id, e.g. 'invisible'
   * @returns {{effect: ActiveEffect, owned: boolean, item: Item|null}|null}
   *          `owned` true when the actor holds the effect itself, so it can be
   *          deleted; false when an item applies it and only that item's copy
   *          can be switched off.
   */
  static find(actor, id) {
    if (!actor || !id) return null;

    // The actor's own effects first: those are the ones a toggle may delete.
    const owned = actor.effects?.find(e => this.#matches(e, id));
    if (owned) return { effect: owned, owned: true, item: null };

    for (const item of actor.items ?? []) {
      for (const effect of item.effects ?? []) {
        if (effect.disabled) continue;
        if (!this.#appliesFromItem(effect)) continue;
        if (this.#matches(effect, id)) return { effect, owned: false, item };
      }
    }
    return null;
  }

  /** Every source of one condition, an actor's own and its items' alike. */
  static findAll(actor, id) {
    const out = [];
    if (!actor || !id) return out;

    for (const effect of actor.effects ?? []) {
      if (this.#matches(effect, id)) {
        out.push({ effect, owned: true, item: null, foreign: this.isForeign(effect, id) });
      }
    }
    for (const item of actor.items ?? []) {
      for (const effect of item.effects ?? []) {
        if (!this.#appliesFromItem(effect)) continue;
        if (this.#matches(effect, id)) {
          out.push({ effect, owned: false, item, foreign: this.isForeign(effect, id) });
        }
      }
    }
    return out;
  }

  /**
   * Turn one condition off, whichever kind of source holds it.
   *
   * An item's effect is disabled rather than deleted: it belongs to the item,
   * not the actor, and deleting it would edit the spell itself.
   *
   * @param {object}  [opts]
   * @param {boolean} [opts.skipForeign=false]  leave conditions another module
   *        owns alone. Off by default, so a deliberate click on one particular
   *        condition still removes it; on for the sweeping paths, where the
   *        player is clearing everything and did not single that one out.
   * @returns {Promise<{removed: number, disabled: Item[], skipped: string[]}>}
   */
  static async clear(actor, id, { skipForeign = false } = {}) {
    const result = { removed: 0, disabled: [], skipped: [] };
    for (const src of this.findAll(actor, id)) {
      if (skipForeign && src.foreign) { result.skipped.push(src.effect.name ?? id); continue; }
      if (src.owned) { await src.effect.delete(); result.removed++; }
      else if (!src.effect.disabled) {
        await src.effect.update({ disabled: true });
        result.disabled.push(src.item);
      }
    }
    return result;
  }

  /** Does a5e apply this item effect to the owner? */
  static #appliesFromItem(effect) {
    return !!effect?.transfer || effect?.system?.effectType === 'passive';
  }

  /** a5e files conditions under conditionId; Foundry uses statuses / core.statusId. */
  static #matches(effect, id) {
    if (!effect || effect.disabled) return false;
    return effect.conditionId === id
        || effect.statuses?.has?.(id)
        || effect.getFlag?.('core', 'statusId') === id;
  }
}
