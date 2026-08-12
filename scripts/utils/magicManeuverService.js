import { AM } from '../a5e-mancer.js';
import { MagicManeuvers, MM_SCHOOLS } from '../data/magicManeuvers.js';

/**
 * Actor-side half of magic maneuvers: what a character knows, which schools they
 * have opened, and what a given level still owes them.
 *
 * The rules live in data/magicManeuvers.js and stay free of Foundry; this is the
 * layer that reads and writes an actor.
 *
 * State is kept in a module flag rather than the system schema, since a5e has no
 * field for any of it:
 *   flags.a5e-mancer.magicManeuvers = { openSchools: string[], knownIds: string[] }
 */
export class MagicManeuverService {

  static FLAG = 'magicManeuvers';

  /* ── reading ──────────────────────────────────────────── */

  static stateOf(actor) {
    const raw = actor?.getFlag?.(AM.ID, this.FLAG) ?? {};
    return {
      openSchools: Array.isArray(raw.openSchools) ? [...raw.openSchools] : [],
      knownIds:    Array.isArray(raw.knownIds)    ? [...raw.knownIds]    : []
    };
  }

  /** Character level across all classes — the table is keyed on that, not class level. */
  static characterLevel(actor) {
    return (actor?.items ?? [])
      .filter(i => i.type === 'class')
      .reduce((n, i) => n + (i.system?.classLevels ?? i.system?.levels ?? i.system?.level ?? 1), 0);
  }

  /** Does this actor have any of the four classes that get maneuvers? */
  static isEligible(actor) {
    return (actor?.items ?? []).some(i =>
      i.type === 'class' && MagicManeuvers.isEligibleClass(i.name));
  }

  /**
   * What the character is owed at a level, given what they already have.
   *
   * Computed as "entitlement minus held" rather than "difference between two
   * levels", so a character who missed a threshold — imported, or levelled
   * before this feature existed — is offered the backlog instead of losing it.
   */
  static pendingAt(actor, level = null) {
    const lvl   = level ?? this.characterLevel(actor);
    const row   = MagicManeuvers.progressionAt(lvl);
    const state = this.stateOf(actor);

    return {
      level: lvl,
      row,
      openSchools: state.openSchools,
      knownIds:    state.knownIds,
      schoolsOwed:   Math.max(0, row.schools - state.openSchools.length),
      maneuversOwed: Math.max(0, row.known   - state.knownIds.length),
      maxDegree:     row.maxDegree
    };
  }

  /** Schools that may still be opened, as a UI model. */
  static schoolOptions(actor, level = null) {
    const state = this.stateOf(actor);
    const lvl   = level ?? this.characterLevel(actor);
    return Object.entries(MM_SCHOOLS).map(([key, label]) => {
      const check = MagicManeuvers.canOpenSchool(key, { level: lvl, openSchools: state.openSchools });
      return {
        key, label,
        open:      state.openSchools.includes(key),
        available: check.ok,
        reason:    check.reason ?? null,
        count:     MagicManeuvers.bySchool(key).length
      };
    });
  }

  /**
   * Maneuvers to show in a picker, grouped by school. Ones that fail a gate are
   * still returned, flagged with the reason, so the list explains itself instead
   * of quietly hiding options.
   */
  static maneuverOptions(actor, level = null, extraChosen = []) {
    const state = this.stateOf(actor);
    const lvl   = level ?? this.characterLevel(actor);
    const known = [...state.knownIds, ...extraChosen];

    const grouped = {};
    for (const m of MagicManeuvers.learnable({ level: lvl, openSchools: state.openSchools, knownIds: known })) {
      (grouped[m.school] ??= {
        key: m.school,
        label: MM_SCHOOLS[m.school],
        open: state.openSchools.includes(m.school),
        maneuvers: []
      }).maneuvers.push({
        ...m,
        chosen: extraChosen.includes(m.id),
        owned:  state.knownIds.includes(m.id)
      });
    }
    return Object.values(grouped);
  }

  /* ── resources ────────────────────────────────────────── */

  /** Shared with combat maneuvers, so this reports the pool the rules define. */
  static exertionPool(actor) {
    const prof = actor?.system?.attributes?.prof ?? 2;
    return MagicManeuvers.exertionPool(prof);
  }

  static saveDC(actor) {
    const prof = actor?.system?.attributes?.prof ?? 2;
    const key  = actor?.system?.attributes?.spellcasting ?? '';
    const score = actor?.system?.abilities?.[key]?.value ?? 10;
    return MagicManeuvers.saveDC(prof, Math.floor((score - 10) / 2));
  }

  /* ── writing ──────────────────────────────────────────── */

  /**
   * Commit a level's picks. Both lists are validated again here rather than
   * trusted from the dialog, so a stale form cannot exceed the entitlement.
   */
  static async apply(actor, { schools = [], maneuvers = [] } = {}, level = null) {
    if (!actor) return false;
    const lvl   = level ?? this.characterLevel(actor);
    const state = this.stateOf(actor);

    const openSchools = [...state.openSchools];
    for (const school of schools) {
      const check = MagicManeuvers.canOpenSchool(school, { level: lvl, openSchools });
      if (!check.ok) { AM.log(2, `School ${school} refused: ${check.reason}`); continue; }
      openSchools.push(school);
    }

    const knownIds = [...state.knownIds];
    for (const id of maneuvers) {
      const maneuver = MagicManeuvers.byId(id);
      const check = MagicManeuvers.canLearn(maneuver, { level: lvl, openSchools, knownIds });
      if (!check.ok) { AM.log(2, `Maneuver ${id} refused: ${check.reason}`); continue; }
      knownIds.push(id);
    }

    if (openSchools.length === state.openSchools.length
        && knownIds.length === state.knownIds.length) return false;

    await actor.setFlag(AM.ID, this.FLAG, { openSchools, knownIds });
    AM.log(3, `Magic maneuvers: ${knownIds.length} known, schools [${openSchools.join(', ')}]`);
    return true;
  }

  /** Known maneuvers as full records, for the sheet. */
  static known(actor) {
    return this.stateOf(actor).knownIds
      .map(id => MagicManeuvers.byId(id))
      .filter(Boolean)
      .sort((a, b) => a.school.localeCompare(b.school) || a.degree - b.degree || a.name.localeCompare(b.name))
      .map(m => ({ ...m, schoolLabel: MM_SCHOOLS[m.school] }));
  }
}
