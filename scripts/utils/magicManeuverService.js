import { AM } from '../a5e-mancer.js';
import { MagicManeuvers, MM_SCHOOLS, MM_SCHOOL_LORE } from '../data/magicManeuvers.js';
import { MagicManeuverPack } from './magicManeuverPack.js';

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

  /**
   * The level the progression table is read at: the sum of levels in classes
   * that grant magic maneuvers — not the character level.
   *
   * So a wizard 5 / fighter 3 reads the table at 5, because the fighter levels
   * bring no maneuvers. A wizard 5 / cleric 3 reads it at 8: both qualify, and
   * the pool advances evenly across them rather than each class tracking its own.
   *
   * @param {string} [incomingClass]  a class about to be taken, counted as one
   *   level, since its item is not on the actor yet
   */
  static maneuverLevel(actor, incomingClass = '') {
    let level = (actor?.items ?? [])
      .filter(i => i.type === 'class' && MagicManeuvers.isEligibleClass(i.name))
      .reduce((n, i) => n + (i.system?.classLevels ?? i.system?.levels ?? i.system?.level ?? 1), 0);

    if (incomingClass && MagicManeuvers.isEligibleClass(incomingClass)) level += 1;
    return level;
  }

  /**
   * Does this actor have any of the four classes that get maneuvers?
   *
   * @param {string} [incomingClass]  a class about to be added, for the
   *   multiclass case — its item does not exist on the actor yet, so without
   *   this a character multiclassing into wizard would be told they qualify only
   *   on the level after.
   */
  static isEligible(actor, incomingClass = '') {
    if (incomingClass && MagicManeuvers.isEligibleClass(incomingClass)) return true;
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
    const lvl   = level ?? this.maneuverLevel(actor);
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
    const lvl   = level ?? this.maneuverLevel(actor);
    return Object.entries(MM_SCHOOLS).map(([key, label]) => {
      const check = MagicManeuvers.canOpenSchool(key, { level: lvl, openSchools: state.openSchools });
      return {
        key, label,
        lore:      MM_SCHOOL_LORE[key] ?? '',
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
    const lvl   = level ?? this.maneuverLevel(actor);
    const known = [...state.knownIds, ...extraChosen];

    const grouped = {};
    for (const m of MagicManeuvers.learnable({ level: lvl, openSchools: state.openSchools, knownIds: known })) {
      (grouped[m.school] ??= {
        key: m.school,
        label: MM_SCHOOLS[m.school],
        lore:  MM_SCHOOL_LORE[m.school] ?? '',
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

  /**
   * How many known maneuvers may be traded in when a level is gained — one,
   * matching the system's rule for combat maneuvers. Nothing to trade below the
   * level the first ones are learned at.
   */
  static replacementsPerLevel(level) {
    return MagicManeuvers.progressionAt(level).known > 0 ? 1 : 0;
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
  static async apply(actor, { schools = [], maneuvers = [], replaced = [] } = {}, level = null) {
    if (!actor) return false;
    const lvl   = level ?? this.maneuverLevel(actor);
    const state = this.stateOf(actor);

    const openSchools = [...state.openSchools];
    for (const school of schools) {
      const check = MagicManeuvers.canOpenSchool(school, { level: lvl, openSchools });
      if (!check.ok) { AM.log(2, `School ${school} refused: ${check.reason}`); continue; }
      openSchools.push(school);
    }

    // Traded-in maneuvers go first, so the replacement is not rejected for
    // filling the slot the one it replaces is still occupying.
    const dropped = replaced.filter(id => state.knownIds.includes(id))
                            .slice(0, this.replacementsPerLevel(lvl));
    const knownIds = state.knownIds.filter(id => !dropped.includes(id));

    for (const id of maneuvers) {
      const maneuver = MagicManeuvers.byId(id);
      const check = MagicManeuvers.canLearn(maneuver, { level: lvl, openSchools, knownIds });
      if (!check.ok) { AM.log(2, `Maneuver ${id} refused: ${check.reason}`); continue; }
      knownIds.push(id);
    }

    const unchanged = openSchools.length === state.openSchools.length
      && knownIds.length === state.knownIds.length
      && knownIds.every((id, i) => id === state.knownIds[i]);
    if (unchanged) return false;

    await actor.setFlag(AM.ID, this.FLAG, { openSchools, knownIds });
    await this.syncItems(actor, knownIds);
    AM.log(3, `Magic maneuvers: ${knownIds.length} known, schools [${openSchools.join(', ')}]`);
    return true;
  }

  /* ── items ────────────────────────────────────────────── */

  /**
   * Give every known maneuver a real item on the actor, and take away the ones
   * traded in at level-up.
   *
   * This is what makes them behave like maneuvers rather than a list on a tab:
   * the item sits in a5e's own maneuver section, rolls its own chat card, and
   * spends exertion through the system when used. No hook of ours is involved —
   * which is deliberate, because the effects are meant to be applied by hand.
   *
   * The flag stays the source of truth for what is known; the items are derived
   * from it and rewritten whenever the picks change.
   */
  static async syncItems(actor, knownIds = null) {
    if (!actor) return;
    const wanted = knownIds ?? this.stateOf(actor).knownIds;

    const seen    = new Map();
    const toDelete = [];
    for (const item of actor.items) {
      if (item.type !== 'maneuver' || !item.getFlag?.(AM.ID, 'magicManeuver')) continue;
      const id = item.getFlag(AM.ID, 'maneuverId');
      // Unknown, no longer known, or a second copy — all go
      if (!id || !wanted.includes(id) || seen.has(id)) toDelete.push(item.id);
      else seen.set(id, item);
    }

    const toCreate = wanted
      .filter(id => !seen.has(id))
      .map(id => MagicManeuvers.byId(id))
      .filter(Boolean)
      .map(m => MagicManeuverPack.itemData(m));

    try {
      if (toDelete.length) await actor.deleteEmbeddedDocuments('Item', toDelete);
      if (toCreate.length) await actor.createEmbeddedDocuments('Item', toCreate, { noGrant: true });
      if (toDelete.length || toCreate.length) {
        AM.log(3, `Magic maneuver items: +${toCreate.length} / -${toDelete.length}`);
      }
    } catch (err) {
      // The flag is already written, so the character keeps the maneuvers even
      // if the items fail — the sheet tab still lists them.
      AM.log(2, 'Could not sync magic maneuver items:', err);
    }
  }

  /**
   * Characters who learned maneuvers before the items existed have the flag and
   * nothing on the sheet. Give them the items once.
   *
   * The trigger is deliberately "knows some, has none": a character missing a
   * single item deleted it on purpose, and recreating it would be us arguing
   * with the player. Only the all-or-nothing case is an upgrade artefact.
   */
  static async backfillItems(actor) {
    if (!actor?.isOwner) return false;
    const known = this.stateOf(actor).knownIds;
    if (!known.length) return false;

    const hasAny = actor.items.some(i =>
      i.type === 'maneuver' && i.getFlag?.(AM.ID, 'magicManeuver'));
    if (hasAny) return false;

    AM.log(3, `Backfilling ${known.length} magic maneuver item(s) on ${actor.name}`);
    await this.syncItems(actor, known);
    return true;
  }

  /**
   * Known maneuvers as full records, for the sheet.
   *
   * `itemId` is what makes the row usable: it points at the actor's own item, so
   * the sheet's existing use button spends the exertion through a5e rather than
   * the module inventing a second way to do it.
   */
  static known(actor) {
    const items = new Map();
    for (const item of (actor?.items ?? [])) {
      if (item.type !== 'maneuver' || !item.getFlag?.(AM.ID, 'magicManeuver')) continue;
      const id = item.getFlag(AM.ID, 'maneuverId');
      if (id && !items.has(id)) items.set(id, item.id);
    }

    return this.stateOf(actor).knownIds
      .map(id => MagicManeuvers.byId(id))
      .filter(Boolean)
      .sort((a, b) => a.school.localeCompare(b.school) || a.degree - b.degree || a.name.localeCompare(b.name))
      .map(m => ({
        ...m,
        itemId:     items.get(m.id) ?? null,
        schoolLabel: MM_SCHOOLS[m.school],
        schoolLore:  MM_SCHOOL_LORE[m.school] ?? ''
      }));
  }

  /** Is this actor item one of ours? Keeps them out of combat-maneuver counts. */
  static isMagicManeuverItem(item) {
    return item?.type === 'maneuver' && !!item?.getFlag?.(AM.ID, 'magicManeuver');
  }
}
