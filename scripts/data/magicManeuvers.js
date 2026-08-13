/**
 * Magic Maneuvers — the rules layer.
 *
 * The catalogue and the level table live in magicManeuversData.js; this file is
 * the logic over them. No Foundry calls, so it can be verified on its own.
 *
 * The iron rule from the specification: a maneuver never activates without the
 * owner casting a spell of their own — including the informational Provydinnia
 * ones, which read the target at the moment of touching the weave.
 *
 * Coverage comes from three facts about a grant of this kind: it either asks
 * nothing and applies, or asks something enumerable. requiresConfig has no
 * equivalent here, so the gates are explicit — see canLearn and canOpenSchool.
 */
import {
  MM_SCHOOLS, MM_SCHOOL_LORE, MM_CLASSES, MM_PROGRESSION, MAGIC_MANEUVERS
} from './magicManeuversData.js';

export { MM_SCHOOLS, MM_SCHOOL_LORE, MM_CLASSES, MM_PROGRESSION, MAGIC_MANEUVERS };

export class MagicManeuvers {

  static byId(id) {
    return MAGIC_MANEUVERS.find(m => m.id === id) ?? null;
  }

  static bySchool(school) {
    return MAGIC_MANEUVERS.filter(m => m.school === school);
  }

  /** Does this class get magic maneuvers at all? */
  static isEligibleClass(className) {
    const key = String(className ?? '').toLowerCase().replace(/[^a-z]/g, '');
    return MM_CLASSES.includes(key);
  }

  /**
   * The progression row in force at a character level — the highest threshold
   * at or below it. Below 3rd there is nothing.
   */
  static progressionAt(level) {
    const lvl = Number(level) || 0;
    let row = null;
    for (const entry of MM_PROGRESSION) {
      if (entry.level <= lvl) row = entry;
    }
    return row ? { ...row } : { level: 0, known: 0, schools: 0, maxDegree: 0 };
  }

  /** Exertion pool shared with combat maneuvers. */
  static exertionPool(proficiencyBonus) {
    return 2 * (Number(proficiencyBonus) || 0);
  }

  /** Save DC for the maneuvers that call for one. */
  static saveDC(proficiencyBonus, spellcastingAbilityMod) {
    return 8 + (Number(proficiencyBonus) || 0) + (Number(spellcastingAbilityMod) || 0);
  }

  /**
   * May this maneuver be LEARNED right now?
   *
   * All three gates are checked here, at learning time. Activation only checks
   * exertion, trigger compatibility and the one-per-cast rule.
   *
   * @param {object} maneuver
   * @param {object} state  { level, openSchools: string[], knownIds: string[] }
   * @returns {{ok: boolean, reason?: string}}
   */
  static canLearn(maneuver, { level = 0, openSchools = [], knownIds = [] } = {}) {
    if (!maneuver) return { ok: false, reason: 'unknown-maneuver' };

    const row = this.progressionAt(level);
    if (row.known <= 0) return { ok: false, reason: 'level-too-low' };

    if (knownIds.includes(maneuver.id)) return { ok: false, reason: 'already-known' };
    if (!openSchools.includes(maneuver.school)) return { ok: false, reason: 'school-not-open' };
    if (maneuver.degree > row.maxDegree)  return { ok: false, reason: 'degree-too-high' };
    if (knownIds.length >= row.known)     return { ok: false, reason: 'no-slots-left' };

    return { ok: true };
  }

  /** May another school be opened at this level? Open schools are permanent. */
  static canOpenSchool(school, { level = 0, openSchools = [] } = {}) {
    if (!MM_SCHOOLS[school])          return { ok: false, reason: 'unknown-school' };
    if (openSchools.includes(school)) return { ok: false, reason: 'already-open' };

    const row = this.progressionAt(level);
    if (openSchools.length >= row.schools) return { ok: false, reason: 'no-school-slots' };
    return { ok: true };
  }

  /**
   * Everything the character could learn right now, for a picker.
   * Maneuvers that fail only on slots are still returned, flagged, so the UI can
   * show why rather than silently hiding them.
   */
  static learnable(state) {
    return MAGIC_MANEUVERS.map(m => {
      const check = this.canLearn(m, state);
      return { ...m, canLearn: check.ok, reason: check.reason ?? null };
    });
  }

  /**
   * Is this maneuver offered for the spell being cast?
   *
   * Note the deliberate rule: a damageType trigger ignores spell level entirely,
   * so a cantrip qualifies exactly like a high-level spell. That is the point —
   * it gives empty slots something to do.
   *
   * @param {object} maneuver
   * @param {object} spell  { damageTypes: string[], heals, isAttack, range,
   *                          shape, school, level, dealsDamage }
   */
  static matchesSpell(maneuver, spell = {}) {
    if (!maneuver) return false;
    const dmg = (spell.damageTypes ?? []).map(d => String(d).toLowerCase());

    switch (maneuver.trigger) {
      case 'damageType':
        if (maneuver.maxSpellLevel && Number(spell.level ?? 0) > maneuver.maxSpellLevel) return false;
        return maneuver.damageType === 'any' ? dmg.length > 0 : dmg.includes(maneuver.damageType);

      case 'healing':       return !!spell.heals;
      case 'spellAttack':   return !!spell.isAttack;
      case 'damagingSpell': return !!spell.dealsDamage || dmg.length > 0;
      case 'touchRange':    return String(spell.range ?? '').toLowerCase() === 'touch';
      case 'lineOrRay':     return ['line', 'ray'].includes(String(spell.shape ?? '').toLowerCase());
      case 'enchantment':   return String(spell.school ?? '').toLowerCase() === 'enchantment';
      case 'any':           return true;

      // Not driven by the caster's own spell shape — these fire on their event
      case 'enemyCast':
      case 'onKill':
      case 'shield':
      case 'concentration':
      case 'readiedSpell':
        return false;

      default: return false;
    }
  }

  /** The ones a given cast can offer, cheapest first. */
  static offeredFor(spell, knownIds = []) {
    return knownIds
      .map(id => this.byId(id))
      .filter(m => m && this.matchesSpell(m, spell))
      .sort((a, b) => a.cost - b.cost || a.name.localeCompare(b.name));
  }
}
