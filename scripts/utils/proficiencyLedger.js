import { AM } from '../a5e-mancer.js';

/**
 * What a character already has, so the same proficiency is never offered twice.
 *
 * Picking Acrobatics from a heritage and again from a background does not make
 * you better at it — it spends a choice on nothing, and the option you could
 * have taken instead is gone. a5e's own features acknowledge the case ("if you
 * are already proficient, you instead gain an expertise die") but state it per
 * feature, so the builder's job is simply not to let the pick happen.
 *
 * Two sources are consulted, because both matter at different moments:
 *   – the actor, once one exists (a level-up, or the sheet's own pickers)
 *   – the other origins in an unfinished build, where nothing is written yet
 *
 * Keys are compared per grant kind. A skill proficiency and a tool proficiency
 * never collide even if their keys happened to match, so the ledger is keyed by
 * a kind string that the callers derive the same way.
 */
export class ProficiencyLedger {

  /**
   * The kind two grants must share before their keys can collide.
   * `proficiency` grants carry a proficiencyType (skill, tool, weapon, …);
   * everything else is distinguished by its grant type alone.
   */
  static kindOf(grantOrModel) {
    const type = grantOrModel?.type ?? grantOrModel?.grantType ?? '';
    if (type === 'proficiency') return `proficiency:${grantOrModel?.proficiencyType ?? ''}`;
    if (type === 'trait')       return `trait:${grantOrModel?.traits?.traitType ?? grantOrModel?.traitType ?? ''}`;
    return type;
  }

  /** Everything of one kind the actor already has written to their sheet. */
  static onActor(actor, kind) {
    const have = new Set();
    const sys = actor?.system;
    if (!sys) return have;

    // a5e keeps skills as their own schema and the rest as arrays of keys
    if (kind === 'skill' || kind === 'proficiency:skill') {
      for (const [key, skill] of Object.entries(sys.skills ?? {})) {
        if ((skill?.proficient ?? 0) > 0) have.add(key);
      }
      return have;
    }

    const path = {
      'proficiency:tool':     'tools',
      'proficiency:language': 'languages',
      'proficiency:armor':    'armor',
      'proficiency:weapon':   'weapons',
      'trait:maneuverTraditions': 'traditions'
    }[kind];
    if (path) for (const k of (sys.proficiencies?.[path] ?? [])) have.add(k);

    // Saving throws live on the abilities, not in the proficiency arrays
    if (kind === 'proficiency:savingThrow') {
      for (const [key, abl] of Object.entries(sys.abilities ?? {})) {
        if (abl?.save?.proficient) have.add(key);
      }
    }
    return have;
  }

  /**
   * Everything of one kind the unfinished build is already granting, from every
   * origin the builder has taken over — the always-granted half included.
   *
   * @param {object} [skip]  the grant asking, so it is not compared to itself
   */
  static inBuild(kind, { type: skipType = '', id: skipId = '' } = {}) {
    const have = new Set();
    for (const t of ['heritage', 'culture', 'background', 'destiny', 'class']) {
      const store = AM.itemGrants?.[t];
      if (!store?.absorb) continue;
      for (const g of [...(store.grants ?? []), ...(store.features ?? [])]) {
        if (this.kindOf(g) !== kind) continue;
        for (const k of (g.base ?? [])) have.add(k);
        if (t === skipType && g.id === skipId) continue;
        for (const k of (store.choices?.[g.id] ?? [])) have.add(k);
      }
    }
    return have;
  }

  /**
   * The full picture for one grant: everything already held, from the actor and
   * from the rest of the build.
   */
  static held(actor, model, { type = '', id = '' } = {}) {
    const kind = this.kindOf(model);
    if (!kind) return new Set();
    const have = this.inBuild(kind, { type, id });
    for (const k of this.onActor(actor, kind)) have.add(k);
    return have;
  }

  /** Mark each option that the character would gain nothing by taking. */
  static markOptions(options, held) {
    return (options ?? []).map(o => ({ ...o, alreadyHave: held.has(o.key) }));
  }

  /**
   * Should this pick be refused? Only when the key is genuinely already held —
   * deselecting is never blocked, and a key the player has just chosen in this
   * same grant is theirs to toggle.
   */
  static blocks(actor, model, key, ctx = {}) {
    if (!key || !model) return false;
    return this.held(actor, model, ctx).has(key);
  }
}
