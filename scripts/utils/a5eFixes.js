import { AM } from '../am.js';

/**
 * Repairs to a5e itself, each applied only while a5e still has the fault.
 *
 * Every one is checked against a5e's own code before it is applied, so an a5e
 * that has fixed the fault is left alone: the repair turns itself off.
 */
export class A5eFixes {

  static #done = new Set();

  /** At ready, and for the first character made after it. */
  static install() {
    const first = game.actors?.find?.((a) => a?.grants);
    if (first) this.grantedTraits(first);
    Hooks.on('createActor', (actor) => this.grantedTraits(actor));
    this.skillExpertise();
    this.damageBonusFormulas();
  }

  /**
   * A dice term wrapped whole in parentheses - "((@classResources.sneak-attack)d6)",
   * the form a5e's packs give Sneak Attack, Backstab, Improved Backstab,
   * Ideologue and Legbreaker - with the outer pair taken off. Anything else is
   * returned as it is.
   */
  static simplifyDiceFormula(formula) {
    const text = String(formula ?? '').trim();
    if (!text.startsWith('(') || !text.endsWith(')')) return formula;
    let depth = 0;
    for (let i = 0; i < text.length; i++) {
      if (text[i] === '(') depth++;
      else if (text[i] === ')') {
        depth--;
        if (depth === 0 && i < text.length - 1) return formula;    // the first pair closes early
      }
    }
    const inner = text.slice(1, -1).trim();
    return /^\(.*\)\s*d\s*\d+[a-z0-9]*$/i.test(inner) ? inner : formula;
  }

  /**
   * a5e 1.4 (1.4.1 - 1.4.4 at least): a damage bonus whose formula is a dice
   * term wrapped whole in parentheses stops the attack it is added to. a5e
   * builds every damage roll's critical twin at once, cloning the bonus term
   * after its inner roll has been evaluated, and Foundry refuses to evaluate it
   * again ("The Roll has already been evaluated and is now immutable") - so the
   * attack never reaches the chat. Reported 2026-10-08: "with Sneak Attack
   * ticked the attack does not roll". Without the outer pair the same dice are
   * a plain dice term, and the roll and its critical work: "(1)d6[Sneak Attack]".
   *
   * Taken off where a5e or this module writes such a bonus, and once for the
   * bonuses already on the world's characters.
   */
  static damageBonusFormulas() {
    if (this.#done.has('damageBonusFormulas')) return;
    this.#done.add('damageBonusFormulas');
    const fix = (bonus) => {
      if (!bonus || typeof bonus !== 'object' || typeof bonus.formula !== 'string') return;
      const simple = this.simplifyDiceFormula(bonus.formula);
      if (simple !== bonus.formula) bonus.formula = simple;
    };
    const DAMAGE = /^system\.bonuses\.damage\.[^.]+$/;
    const FORMULA = /^system\.bonuses\.damage\.[^.]+\.formula$/;
    Hooks.on('preUpdateActor', (_actor, changes) => {
      for (const [key, value] of Object.entries(changes ?? {})) {
        if (DAMAGE.test(key)) fix(value);
        else if (FORMULA.test(key) && typeof value === 'string') changes[key] = this.simplifyDiceFormula(value);
      }
      for (const bonus of Object.values(changes?.system?.bonuses?.damage ?? {})) fix(bonus);
    });
    if (!game.user?.isGM) return;
    for (const actor of game.actors ?? []) {
      const update = {};
      for (const [id, bonus] of Object.entries(actor.system?.bonuses?.damage ?? {})) {
        const simple = this.simplifyDiceFormula(bonus?.formula);
        if (simple !== bonus?.formula) update[`system.bonuses.damage.${id}.formula`] = simple;
      }
      if (Object.keys(update).length) {
        actor.update(update).catch((err) => AM.log(2, `Damage bonus formulas of ${actor.name}:`, err));
      }
    }
  }

  /**
   * a5e 1.4.0 - 1.4.1: a skill's expertise dice from grants are read off
   * `grant.expertiseDiceData` (1.3's record) in prepareSkills, so no expertise
   * die grant counted at all - Loot Runner's Athletics, Famous, Hawkeye,
   * Widely Learned (found 2026-10-07). a5e 1.4.2 reads the 1.4 record
   * (`applied`); this adds the same, only where prepareSkills still has the
   * old read, and redraws the characters prepared before it.
   */
  static skillExpertise() {
    if (this.#done.has('skillExpertise')) return;
    this.#done.add('skillExpertise');
    const proto = CONFIG.Actor?.documentClass?.prototype;
    const original = proto?.prepareSkills;
    if (typeof original !== 'function' || !String(original).includes('expertiseDiceData')) return;
    proto.prepareSkills = function prepareSkills(...args) {
      const result = original.apply(this, args);
      try {
        const grants = this.grants?.byType?.('expertiseDice')
          ?.filter((g) => g?.applied?.isApplied && g.applied.expertiseType === 'skill') ?? [];
        if (grants.length) {
          for (const [key, skill] of Object.entries(this.system?.skills ?? {})) {
            const add = grants.reduce((n, g) => n + ((g.applied.selected ?? []).includes(key) ? (Number(g.applied.expertiseCount) || 1) : 0), 0);
            if (add) skill.expertiseDice = Math.min(5, Math.max(0, (Number(skill.expertiseDice) || 0) + add));
          }
        }
      } catch { /* leave a5e's figure */ }
      return result;
    };
    for (const actor of game.actors ?? []) {
      if (actor.type === 'character') { try { actor.reset(); } catch { /* next prepare */ } }
    }
    AM.log(3, 'a5e fix applied: skill expertise dice from 1.4 grant records');
  }

  /**
   * a5e 1.4.0 - 1.4.4 (at least): ActorGrantsManager#getGrantedTraits reads
   * `grant.traitData`, a field of 1.3's actor grant records that 1.4's item
   * grants do not have (its own source marks the method "TODO - Needs
   * fixing"). It runs when the languages, resistances, immunities or
   * vulnerabilities window draws its "Granted by" tooltips, and throws as soon
   * as the character has any applied trait grant - a culture's languages are
   * one - so the window never opens. Reported 2026-10-06: "the languages cog
   * does not work", on this module's sheet and a5e's alike.
   *
   * The replacement reads what 1.4 records instead: the applied trait type and
   * the traits selected, on the grant's own item.
   */
  static grantedTraits(actor) {
    if (this.#done.has('grantedTraits')) return;
    const manager = actor?.grants;
    const proto = manager && Object.getPrototypeOf(manager);
    const original = proto?.getGrantedTraits;
    if (typeof original !== 'function') return;
    this.#done.add('grantedTraits');
    if (!String(original).includes('traitData')) return;      // a5e's own works

    proto.getGrantedTraits = function getGrantedTraits(type) {
      const out = {};
      const grants = typeof this.byAppliedType === 'function'
        ? this.byAppliedType('trait')
        : [...this.values()].filter((g) => g?.applied?.grantType === 'trait');
      for (const grant of grants) {
        const applied = grant?.applied ?? {};
        const traitType = applied.traitType || grant?.config?.traits?.traitType || '';
        if (traitType !== type) continue;
        out[grant.fullId ?? grant.id] = {
          itemId: grant.item?.uuid ?? '',
          traits: [...(applied.selected ?? [])]
        };
      }
      return out;
    };
    AM.log(3, 'a5e fix applied: ActorGrantsManager#getGrantedTraits reads 1.4 grant records');
  }
}
