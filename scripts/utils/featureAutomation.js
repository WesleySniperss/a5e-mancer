import { AM } from '../am.js';

/**
 * a5e features whose text gives a fixed bonus that a5e records nowhere.
 *
 * Reported 2026-10-07: "Loot Runner is not automated - no passive bonuses,
 * only the description". a5e's Trick: Loot Runner carries no grant and no
 * effect; its text gives an expertise die on Athletics checks and 5 feet of
 * speed. Such a feature is given the grants a5e would have written for it, so
 * they apply, show and come off with the feature like any other grant.
 *
 * Only what the text gives outright and a5e has a grant for. "You can carry 2
 * extra bulky items" has none, so it stays the text's.
 *
 * Grants are written in both of a5e's shapes (see grantFormat.js).
 */
const MOVE = (types, bonus, name) => ({
  type: 'movement', grantType: 'movement', name, label: name,
  config: { movementTypes: { base: types, options: [], total: 0 }, bonus, unit: 'feet', context: { isHover: false } },
  movementTypes: { base: types, options: [], total: 0 }, bonus, unit: 'feet', context: { isHover: false }
});
const EXPERTISE = (skills, name) => ({
  type: 'expertiseDice', grantType: 'expertiseDice', name, label: name,
  config: { keys: { base: skills, options: [], total: 0 }, expertiseCount: 1, expertiseType: 'skill' },
  keys: { base: skills, options: [], total: 0 }, expertiseCount: 1, expertiseType: 'skill'
});

const TABLE = {
  'trick: loot runner': [EXPERTISE(['ath'], 'Loot Runner: Athletics'), MOVE(['walk'], '5', 'Loot Runner: Speed')]
};

/**
 * Effects a5e ships empty. Martial Caster Stance's (a stance: on while it is
 * used) has no change at all and does not apply to its user, so entering the
 * stance did nothing (reported 2026-10-07). Its text: an expertise die on
 * concentration checks; casting a reaction spell on the turn of a bonus-action
 * spell is a rule to read, not a number.
 */
const EFFECTS = {
  'martial caster stance': { applyToSelf: true,
    changes: [{ key: 'system.attributes.concentration.expertiseDice', type: 'add', value: '1' }] }
};

/**
 * Actions a5e leaves off. Sneak Attack is a damage bonus to tick in the attack
 * window and nothing else, so it could not be rolled on its own - "separately
 * it does not roll either" (2026-10-08). Its own damage roll, the same dice.
 */
const ACTIONS = {
  'sneak attack': {
    name: 'Sneak Attack Damage',
    activation: {},
    consumers: {},
    prompts: {},
    rolls: { amSneakAttackRol: { type: 'damage', default: true, formula: '(@classResources.sneak-attack)d6', canCrit: true } },
    uses: { value: 0, max: '', per: '', recharge: { formula: '1d6', rechargeType: 'custom', rechargeAmount: '1', threshold: 6 } },
    effects: []
  }
};

export class FeatureAutomation {

  static actionFor(item) {
    if (item?.type !== 'feature') return null;
    return ACTIONS[String(item?.name ?? '').trim().toLowerCase()] ?? null;
  }

  /** A feature with no action given the one its text implies - once. Ids of
      16 letters and digits: Foundry drops any other key from these fields. */
  static async completeAction(item) {
    const action = this.actionFor(item);
    if (!action) return false;
    const actions = item.system?.actions;
    const count = actions instanceof Map ? actions.size : Object.keys(actions ?? {}).length;
    if (count) return false;
    await item.update({ 'system.actions.amSneakAttack001': foundry.utils.deepClone(action) });
    AM.log(3, `${item.name}: given a roll of its own`);
    return true;
  }

  static effectFor(item) {
    if (item?.type !== 'maneuver' && item?.type !== 'feature') return null;
    return EFFECTS[String(item?.name ?? '').trim().toLowerCase()] ?? null;
  }

  /** An empty a5e effect given what its text says - once, and only while it is empty. */
  static async completeEffect(item) {
    const fix = this.effectFor(item);
    if (!fix) return false;
    let done = false;
    for (const effect of item.effects ?? []) {
      if ((effect.system?.changes ?? effect.changes ?? []).length) continue;
      await effect.update({ 'system.applyToSelf': fix.applyToSelf, 'system.changes': fix.changes });
      done = true;
    }
    if (done) AM.log(3, `${item.name}: its effect given what its text says`);
    return done;
  }

  static grantsFor(name) {
    return TABLE[String(name ?? '').trim().toLowerCase()] ?? null;
  }

  /** Item data about to be created: its missing grants added, in place. */
  static apply(data) {
    if (data?.type !== 'feature') return data;
    const list = this.grantsFor(data.name);
    if (!list) return data;
    data.system ??= {};
    data.system.grants ??= {};
    if (Object.keys(data.system.grants).length) return data;   // a5e has grants of its own now
    data.system.grants = this.#records(list);
    return data;
  }

  static #records(list) {
    const out = {};
    for (const g of list) {
      const id = foundry.utils.randomID();
      out[id] = { ...foundry.utils.deepClone(g), id, _id: id, img: '', level: 1, levelType: 'character', optional: false };
    }
    return out;
  }

  /**
   * A feature already on a character, taken before this existed, or dropped
   * on the sheet: its grants are added and applied once. Idempotent - a
   * feature with grants is left alone.
   */
  static async complete(actor, item) {
    if (!actor || item?.type !== 'feature' || !this.grantsFor(item.name)) return false;
    if (Object.keys(item.system?.grants ?? {}).length) return false;
    const records = this.#records(this.grantsFor(item.name));
    await item.update({ 'system.grants': records });
    const fresh = actor.items.get(item.id) ?? item;
    const { GrantAbsorber } = await import('./grantAbsorber.js');
    await GrantAbsorber.apply(actor, fresh, {}, { charLevel: 20, clsLevel: 20 });
    AM.log(3, `${actor.name}: ${item.name} given its bonuses`);
    return true;
  }

  /** At ready (GM) and for each feature made later (its maker's client). */
  static install() {
    Hooks.on('createItem', (item, _options, userId) => {
      if (userId !== game.user?.id || !item?.parent) return;
      if (this.effectFor(item)) this.completeEffect(item).catch(err => AM.log(2, `${item.name} could not be automated:`, err));
      if (this.actionFor(item)) this.completeAction(item).catch(err => AM.log(2, `${item.name} could not be automated:`, err));
      if (item.type !== 'feature' || !this.grantsFor(item.name)) return;
      this.complete(item.parent, item).catch(err => AM.log(2, `${item.name} could not be automated:`, err));
    });
    if (!game.user?.isGM) return;
    for (const actor of game.actors ?? []) {
      this.completeActor(actor).catch(err => AM.log(2, `${actor.name} could not be automated:`, err));
    }
  }

  /**
   * Everything in these tables, on one character's items - at load for the
   * world, and from the sheet's Fill In for one character. Each step leaves
   * alone what is done already.
   * @returns {Promise<string[]>} what was added, to report
   */
  static async completeActor(actor) {
    const done = [];
    for (const item of [...(actor?.items ?? [])]) {
      try {
        if (this.effectFor(item) && await this.completeEffect(item)) done.push(`${item.name}: its effect`);
        if (this.actionFor(item) && await this.completeAction(item)) done.push(`${item.name}: its own roll`);
        if (item.type === 'feature' && this.grantsFor(item.name) && await this.complete(actor, item)) done.push(`${item.name}: its bonuses`);
      } catch (err) {
        AM.log(2, `${item.name} could not be automated:`, err);
      }
    }
    return done;
  }
}
