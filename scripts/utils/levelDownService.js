import { AM } from '../am.js';
import { ManeuverService, isMagicSchool } from './maneuverService.js';
import { SpellService, CLASS_SPELL_TABLES } from './spellService.js';
import { ASI_LEVELS } from './levelUpService.js';

/**
 * Taking a class back down to a lower level - "reset me to the level I really
 * am", asked for 2026-10-02.
 *
 * Most of it is a5e's own. Lowering `system.classLevels` on a class item fires
 * its _preUpdate, which hands the old and new level to the actor's grant
 * manager; on the way down that removes every grant of the class and of its
 * features above the new class level, and every grant above the new character
 * level - features and knacks with their items, ability score increases,
 * proficiencies, expertise, traits. Hit points follow by themselves while
 * class HP automation is on: a5e sums `system.hp.levels` only up to the
 * character level.
 *
 * What it leaves is ours:
 *   - the archetype at exactly its archetype level. a5e deletes it whenever the
 *     class comes down TO that level (`newLevel > archetypeLevel` keeps it),
 *     one level too many: a fighter taken from 5 to 3 lost the archetype it
 *     chose at 3. Its delete is stood down for that one update.
 *   - an archetype's grants in a multiclass. They are removed by character
 *     level only, so a fighter 5 / wizard 3 lowering fighter to 3 kept the
 *     archetype's 4th- and 5th-level features (character level 6 is above
 *     both). Removed here by class level.
 *   - a feature two removed grants both handed out. a5e only deletes one with
 *     a single grant pointing at it, and counts before it removes anything, so
 *     such an item stayed behind with nothing granting it.
 *   - maneuvers, spells and the feat taken in place of an ability score
 *     increase. a5e has no grant for any of them - this module adds them - so
 *     nothing records them against a level. Items added by our level-up carry
 *     `flags.a5e-mancer.levelUp` from now on, and those above the new level
 *     are marked for removal; for older ones the plan marks what the rules no
 *     longer allow (a degree or spell level out of reach) and fills the rest
 *     of the count with the newest, and the player adjusts.
 *   - the hit points of the removed levels: their `hp.levels` entries, which a
 *     multiclass otherwise reads wrongly (keys are character levels), or the
 *     stored maximum when a5e is not computing it.
 */

const LEVEL_FLAG = 'levelUp';

export class LevelDownService {

  /** The flag our level-up writes on what it added: which class, at which level. */
  static levelUpRecord(item) {
    return item?.flags?.[AM.ID]?.[LEVEL_FLAG] ?? null;
  }

  /**
   * Mark items added by a level-up with the level that brought them.
   * @param {Actor} actor
   * @param {Set<string>} before  item ids on the actor before the level-up
   * @param {{classId: string, classLevel: number, charLevel: number}} record
   */
  static async recordLevelUp(actor, before, record) {
    const fresh = actor?.items?.filter?.((i) => !before.has(i.id)) ?? [];
    if (!fresh.length) return;
    try {
      await actor.updateEmbeddedDocuments('Item', fresh.map((i) => ({
        _id: i.id, [`flags.${AM.ID}.${LEVEL_FLAG}`]: record
      })), { render: false });
    } catch (err) {
      AM.log(2, 'Could not record the level on the items it added:', err);
    }
  }

  /* ── Reading the actor ─────────────────────────────────────────────────── */

  static #classLevel(item) {
    return Number(item?.system?.classLevels ?? item?.system?.levels ?? item?.system?.level ?? 1) || 1;
  }

  static #slug(item) {
    return item?.slug || item?.system?.slug || String(item?.name ?? '').slugify?.({ strict: true }) || '';
  }

  static #conMod(actor) {
    const mod = actor?.system?.abilities?.con?.check?.mod;
    if (Number.isFinite(Number(mod))) return Number(mod);
    return Math.floor(((Number(actor?.system?.abilities?.con?.value) || 10) - 10) / 2);
  }

  static #grants(actor) {
    const g = actor?.grants;
    return g?.values ? [...g.values()] : [];
  }

  /** The item a grant came from, as a5e resolves it. */
  static #source(grant) {
    try { return grant?.itemUuid ? fromUuidSync(grant.itemUuid) : null; } catch { return null; }
  }

  /** A grant's effect in a few words, for the list of what goes. */
  static #describe(actor, g) {
    const join = (a) => (Array.isArray(a) ? a.filter(Boolean).join(', ') : '');
    switch (g.grantType) {
      case 'bonus': {
        const b = actor.system?.bonuses?.[g.type]?.[g.bonusId];
        const abilities = b?.context?.abilities;
        if (g.type === 'abilities' && abilities?.length) {
          const f = String(b.formula ?? '').trim();
          return `${f ? `${/^[+-]/.test(f) ? f : `+${f}`} ` : ''}${abilities.map((a) => String(a).toUpperCase()).join(', ')}`;
        }
        return b?.label || `${g.type} bonus`;
      }
      case 'proficiency': {
        const d = g.proficiencyData ?? {};
        return `${d.proficiencyType || 'proficiency'}: ${join(d.keys)}`;
      }
      case 'trait': {
        const d = g.traitData ?? {};
        return `${d.traitType || 'trait'}: ${join(d.traits)}`;
      }
      case 'expertiseDice': return `expertise: ${join(g.expertiseDiceData?.keys)}`;
      case 'skillSpecialty': return `${g.specialtyData?.skill ?? ''} specialty: ${join(g.specialtyData?.specialties)}`.trim();
      case 'exertion': return 'exertion';
      case 'rollOverride': return `roll: ${join(g.rollOverrideData?.keys)}`;
      default: return g.grantType;
    }
  }

  /**
   * The grants that go when `cls` comes down to `target`, picked as a5e picks
   * them, plus the two cases it misses (see the file header).
   */
  static #droppedGrants(actor, cls, target, charAfter, dropsArchetype) {
    const slug = this.#slug(cls);
    const archetype = cls.archetype ?? null;
    const dropped = new Map();
    for (const g of this.#grants(actor)) {
      const src = this.#source(g);
      const level = Number(g.level) || 1;
      const ofClass = src && ((src.type === 'class' && this.#slug(src) === slug)
                           || (src.type === 'feature' && src.system?.classes === slug));
      const ofArchetype = src && src.type === 'archetype' && src.system?.class === slug;
      const goes = target <= 0
        ? (src?.id === cls.id || ofClass || ofArchetype || level > charAfter)
        : ((ofClass && level > target)                  // removeGrantsByClassLevel
           || level > charAfter                          // removeGrantsByLevel
           || (ofArchetype && level > target)            // what a5e misses in a multiclass
           || (dropsArchetype && archetype && src?.id === archetype.id));
      if (goes) dropped.set(g.grantId, g);
    }

    /* A removed feature takes its own grants with it (a5e removes them when
       the item is deleted), and those may hand out items in turn. */
    const docsOf = (g) => (['feature', 'item'].includes(g.grantType) ? (g.documentIds ?? []) : []);
    let grew = true;
    while (grew) {
      grew = false;
      const goneItems = new Set([...dropped.values()].flatMap(docsOf));
      for (const g of this.#grants(actor)) {
        if (dropped.has(g.grantId)) continue;
        const src = this.#source(g);
        if (src && goneItems.has(src.id)) { dropped.set(g.grantId, g); grew = true; }
      }
    }
    return dropped;
  }

  /* ── The plan ──────────────────────────────────────────────────────────── */

  /**
   * Everything lowering a class to `target` changes, for the dialog to show
   * and for apply() to carry out. Nothing is changed here.
   *
   * @param {Actor} actor
   * @param {string} classId  the class item
   * @param {number} target   its level after; 0 removes the class (only with another one left)
   */
  static async plan(actor, classId, target) {
    const cls = actor.items.get(classId);
    if (!cls || cls.type !== 'class') return null;
    const classes = actor.items.filter((i) => i.type === 'class');
    const current = this.#classLevel(cls);
    const minTarget = classes.length > 1 ? 0 : 1;
    target = Math.max(minTarget, Math.min(current - 1, Math.floor(Number(target) || 0)));
    if (target >= current) return null;

    const charBefore = classes.reduce((n, c) => n + this.#classLevel(c), 0);
    const charAfter = charBefore - (current - target);
    const archetypeLevel = Number(cls.system?.archetypeLevel ?? 0) || 0;
    const archetype = cls.archetype ?? null;
    const dropsArchetype = !!archetype && (target <= 0 || (archetypeLevel > 0 && target < archetypeLevel));
    // The case a5e gets wrong: down to the archetype level exactly
    const guardArchetype = !!archetype && target > 0 && archetypeLevel > 0 && target === archetypeLevel;

    const dropped = this.#droppedGrants(actor, cls, target, charAfter, dropsArchetype);
    const kept = this.#grants(actor).filter((g) => !dropped.has(g.grantId));
    const keptDocs = new Set(kept.flatMap((g) => g.documentIds ?? []));

    /* Items that go with the grants: every one a removed grant handed out
       and no remaining grant still hands out - which also catches the shared
       ones a5e leaves behind. */
    const goneIds = new Set();
    for (const g of dropped.values()) {
      if (!['feature', 'item'].includes(g.grantType)) continue;
      for (const id of g.documentIds ?? []) if (!keptDocs.has(id) && actor.items.get(id)) goneIds.add(id);
    }
    if (dropsArchetype) goneIds.add(archetype.id);
    if (target <= 0) goneIds.add(cls.id);

    const row = (item, extra = {}) => ({
      id: item.id, uuid: item.uuid, name: item.name, img: item.img, type: item.type, ...extra
    });
    const features = [...goneIds].map((id) => actor.items.get(id)).filter(Boolean)
      .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'class' ? -1 : 1))
      .map((i) => row(i));

    const benefits = [...dropped.values()]
      .filter((g) => !['feature', 'item'].includes(g.grantType))
      .map((g) => {
        const src = this.#source(g);
        return { source: src?.name ?? '', level: Number(g.level) || 1, text: this.#describe(actor, g) };
      })
      .sort((a, b) => a.level - b.level || a.source.localeCompare(b.source));

    /* ── Hit points ── the removed levels' entries: the class's highest keys */
    const conMod = this.#conMod(actor);
    const levels = this.#hpEntries(cls, charBefore);
    const removedCount = current - target;
    const removedHp = levels.slice(Math.max(0, target));
    const average = Math.floor((Number(cls.system?.hp?.hitDiceSize) || 8) / 2) + 1;
    const hpLoss = removedHp.reduce((n, [, v]) => n + v, 0)
      + average * Math.max(0, removedCount - removedHp.length)
      + conMod * removedCount;
    const hpMax = Number(actor.system?.attributes?.hp?.max) || 0;
    const hp = { before: hpMax, after: Math.max(1, hpMax - hpLoss), loss: hpLoss };

    /* ── Picks: maneuvers, spells, feats ── */
    const removedByGrants = new Set([...goneIds]);
    const picks = {
      maneuvers: await this.#maneuverGroups(actor, cls, target, removedByGrants),
      spells: this.#spellGroups(actor, cls, target, classes, features),
      feats: this.#featGroup(actor, cls, target, current, removedByGrants)
    };

    return {
      classId: cls.id, className: cls.name, img: cls.img, slug: this.#slug(cls),
      current, target, minTarget, charBefore, charAfter,
      removesClass: target <= 0,
      archetype: archetype ? { id: archetype.id, name: archetype.name, level: archetypeLevel } : null,
      dropsArchetype, guardArchetype,
      grantIds: [...dropped.keys()],
      features, benefits, hp,
      removeIds: [...goneIds],
      picks
    };
  }

  /** Newest first: what was added last is what a level-down most likely undoes. */
  static #newestFirst(a, b) {
    return (Number(b._stats?.createdTime) || 0) - (Number(a._stats?.createdTime) || 0);
  }

  /**
   * How many of a group the removed levels gave: the table's count now less
   * its count at the new level. What the character holds beyond the table now
   * came from somewhere else - a heritage's cantrip, a feat's maneuver - and
   * is not the levels' to take.
   */
  static #levelsGave(have, now, after) {
    if (now === null || now === undefined || after === null || after === undefined) return null;
    return Math.max(0, Math.min(have, now) - after);
  }

  /**
   * From the items of one group: the forced ones, those our level-up recorded
   * at a removed level, then the newest until `count` are marked.
   */
  static #preselect(items, forcedIds, count, cls, target) {
    const chosen = new Set(forcedIds);
    for (const i of items) {
      const rec = this.levelUpRecord(i);
      if (rec && rec.classId === cls.id && Number(rec.classLevel) > target) chosen.add(i.id);
    }
    if (count) {
      const rest = items.filter((i) => !chosen.has(i.id)).sort((a, b) => this.#newestFirst(a, b));
      for (const i of rest) {
        if (chosen.size >= count) break;
        chosen.add(i.id);
      }
    }
    return chosen;
  }

  static async #maneuverGroups(actor, cls, target, removedByGrants) {
    const chosen = actor.items.filter((i) => ManeuverService.isChosenManeuver(i)
      && !ManeuverService.isGrantedManeuver(actor, i.id) && !removedByGrants.has(i.id));
    if (!chosen.length) return [];

    let budget = null, budgetNow = null;
    try {
      budget = await ManeuverService.maneuverBudget(actor, { classId: cls.id, newLevel: Math.max(0, target) });
      budgetNow = await ManeuverService.maneuverBudget(actor, { classId: cls.id, newLevel: this.#classLevel(cls) });
    } catch (err) { AM.log(2, 'Level down: maneuver budget unreadable', err); }

    const at = (t, f, l) => Number(t?.[f]?.[Math.max(0, Math.min(20, l))] ?? 0) || 0;
    const kindOf = (i) => (isMagicSchool(i.system?.tradition ?? i.system?.combatTradition ?? '') ? 'magic' : 'combat');
    const groups = [];
    for (const kind of ['combat', 'magic']) {
      const items = chosen.filter((i) => kindOf(i) === kind);
      if (!items.length) continue;
      const sources = (budget?.sources ?? []).filter((s) => s.kind === kind);
      const allowed = budget ? (budget.kinds?.[kind]?.known ?? 0) : null;
      const maxDegree = budget ? Math.max(0, ...sources.map((s) => at(s.table, 'maxDegree', s.level))) : null;
      const degreeOf = (i) => parseInt(i.system?.degree ?? i.system?.maneuverDegree ?? 1) || 1;
      const forced = maxDegree === null ? [] : items.filter((i) => degreeOf(i) > maxDegree).map((i) => i.id);
      const gave = this.#levelsGave(items.length, budgetNow ? (budgetNow.kinds?.[kind]?.known ?? 0) : null, allowed);
      const selected = this.#preselect(items, forced, gave, cls, target);
      groups.push({
        key: `maneuvers-${kind}`, kind,
        allowed, gave, maxDegree, total: items.length,
        forced, selected: [...selected],
        items: items.sort((a, b) => degreeOf(b) - degreeOf(a) || a.name.localeCompare(b.name)).map((i) => ({
          id: i.id, uuid: i.uuid, name: i.name, img: i.img,
          note: `${degreeOf(i)}°`, forced: forced.includes(i.id)
        }))
      });
    }
    return groups;
  }

  /**
   * Spells: what is out of reach is forced, what is over the count is
   * suggested. The count is only known for a single caster class with a
   * spells-known table - spells sit in one shared book, so in a multiclass
   * nothing says which class a spell came from.
   */
  static #spellGroups(actor, cls, target, classes, removedFeatures) {
    const spells = actor.items.filter((i) => i.type === 'spell');
    if (!spells.length) return [];

    const levelOf = (i) => Number(i.system?.level ?? i.system?.spellLevel ?? 0) || 0;
    const removedNames = new Set(removedFeatures.map((f) => f.name.toLowerCase()));
    const grantedBy = (i) => String(i.flags?.[AM.ID]?.grantedBy ?? '');

    const levelAfter = (c) => (c.id === cls.id ? target : this.#classLevel(c));
    const casters = classes.filter((c) => {
      const t = c.system?.spellcasting?.casterType;
      return (t && t !== 'none') || CLASS_SPELL_TABLES[c.name.toLowerCase()];
    });
    const castersAfter = casters.filter((c) => levelAfter(c) > 0);
    // Out of reach only when every caster's progression is known to us
    const allKnown = casters.every((c) => CLASS_SPELL_TABLES[c.name.toLowerCase()]);
    const maxLevel = casters.length && allKnown
      ? Math.max(0, ...castersAfter.map((c) => SpellService.maxSpellLevelFor(c.name, levelAfter(c))))
      : null;

    // Counts: one caster class, the one being lowered, with a table
    const counts = { cantrips: [null, null], spells: [null, null] };   // [now, after]
    if (casters.length === 1 && casters[0].id === cls.id) {
      const t = SpellService.SPELLS_KNOWN[cls.name.toLowerCase()]
        ?? (() => { const f = SpellService.featureTables?.get?.(SpellService.tableKey(cls.name)); return f ? { cantrips: f.cantrips, known: f.known, prepared: !f.known } : null; })();
      const at = (lvl) => {
        if (lvl <= 0) return { cantrips: 0, spells: 0 };
        const out = { cantrips: null, spells: null };
        if (!t) return out;
        if (Array.isArray(t.cantrips)) out.cantrips = Number(t.cantrips[lvl] ?? 0);
        if (!t.prepared) {
          if (Array.isArray(t.known)) out.spells = Number(t.known[lvl] ?? 0);
          else if (t.perLevel) out.spells = (t.firstLevel ?? 0) + t.perLevel * (lvl - 1);
        }
        return out;
      };
      const now = at(this.#classLevel(cls)), after = at(target);
      counts.cantrips = [now.cantrips, after.cantrips];
      counts.spells = [now.spells, after.spells];
    }

    // A spell a feature gives belongs to that feature, not to any count
    const forcedGranted = spells.filter((i) => grantedBy(i) && removedNames.has(grantedBy(i).toLowerCase()));
    const free = spells.filter((i) => !grantedBy(i));
    const outOfReach = (i) => maxLevel !== null && levelOf(i) > maxLevel;

    const groups = [];
    const make = (key, items, [now, allowed], extraForced = []) => {
      if (!items.length && !extraForced.length) return;
      const forced = [...items.filter(outOfReach).map((i) => i.id), ...extraForced.map((i) => i.id)];
      const all = [...items, ...extraForced];
      const gave = this.#levelsGave(items.length, now, allowed);
      const selected = this.#preselect(items, forced, gave, cls, target);
      for (const i of extraForced) selected.add(i.id);
      groups.push({
        key, allowed, gave, maxLevel, total: items.length,
        forced, selected: [...selected],
        items: all.sort((a, b) => levelOf(b) - levelOf(a) || a.name.localeCompare(b.name)).map((i) => ({
          id: i.id, uuid: i.uuid, name: i.name, img: i.img,
          note: levelOf(i) ? game.i18n.format('am.spells.level-n', { n: levelOf(i) }) : '', forced: forced.includes(i.id),
          granted: !!grantedBy(i)
        }))
      });
    };
    make('cantrips', free.filter((i) => levelOf(i) === 0), counts.cantrips);
    make('spells', free.filter((i) => levelOf(i) > 0), counts.spells, forcedGranted);
    return groups;
  }

  /**
   * Feats taken in place of an ability score increase. Those our level-up
   * recorded at a removed level are marked; with no record, the feats no
   * grant handed out are offered unmarked, and only when an ASI level is
   * among the removed ones.
   */
  static #featGroup(actor, cls, target, current, removedByGrants) {
    const asiLost = ASI_LEVELS.filter((l) => l > target && l <= current).length;
    const granted = new Set(this.#grants(actor).flatMap((g) => g.documentIds ?? []));
    const feats = actor.items.filter((i) => i.type === 'feature'
      && String(i.system?.featureType ?? '').toLowerCase() === 'feat'
      && !granted.has(i.id) && !removedByGrants.has(i.id));
    const recorded = feats.filter((i) => {
      const rec = this.levelUpRecord(i);
      return rec && rec.classId === cls.id && Number(rec.classLevel) > target;
    });
    const offered = asiLost ? feats : recorded;
    if (!offered.length) return null;
    return {
      key: 'feats', asiLost, total: offered.length, allowed: null, gave: null, forced: [],
      selected: recorded.map((i) => i.id),
      items: offered.sort((a, b) => a.name.localeCompare(b.name)).map((i) => ({
        id: i.id, uuid: i.uuid, name: i.name, img: i.img, note: '', forced: false
      }))
    };
  }

  /* ── Carrying it out ───────────────────────────────────────────────────── */

  /**
   * @param {Actor} actor
   * @param {object} plan     from plan(), for the class and level it was made for
   * @param {object} [opts]
   * @param {string[]} [opts.remove]  picked items to delete as well (maneuvers, spells, feats)
   * @param {boolean} [opts.backup]   save a copy of the character first
   */
  static async apply(actor, plan, { remove = [], backup = false } = {}) {
    const cls = actor.items.get(plan.classId);
    if (!cls) return false;
    if (this.#classLevel(cls) !== plan.current) {
      ui.notifications.warn(`${cls.name} is no longer at level ${plan.current}; open the window again.`);
      return false;
    }

    if (backup) {
      try {
        await actor.clone({ name: `${actor.name} (${cls.name} ${plan.current})` }, { save: true, addSource: false });
      } catch (err) {
        AM.log(1, 'Level down: the backup copy failed, nothing was changed', err);
        ui.notifications.error('Could not save a copy of the character; nothing was changed.');
        return false;
      }
    }

    const hpLevelsBefore = this.#hpLevelsByClass(actor);

    // 1. The level itself, through a5e's grant manager
    if (plan.target <= 0) {
      await cls.delete();
      try { await actor.grants?.removeGrantsByLevel?.(plan.charAfter); }
      catch (err) { AM.log(2, 'Level down: character-level grants', err); }
    } else {
      const archetype = plan.guardArchetype ? cls.archetype : null;
      if (archetype) archetype.delete = async function () { return this; };
      let ok = true;
      try {
        const path = cls.system?.classLevels !== undefined ? 'system.classLevels'
          : cls.system?.levels !== undefined ? 'system.levels' : 'system.level';
        const result = await cls.update({ [path]: plan.target });
        ok = !!result;
      } finally {
        if (archetype) delete archetype.delete;
      }
      if (!ok || this.#classLevel(actor.items.get(cls.id)) !== plan.target) {
        ui.notifications.error(`a5e refused to lower ${cls.name}; nothing more was changed.`);
        return false;
      }
    }

    // 2. Grants a5e left: the archetype's in a multiclass, and anything else the plan dropped
    const planned = new Set(plan.grantIds ?? []);
    for (const id of planned) {
      const still = this.#grants(actor).find((g) => g.grantId === id);
      if (!still) continue;
      try { await actor.grants.removeGrant(id); }
      catch (err) { AM.log(2, `Level down: grant ${id}`, err); }
    }

    // 3. Items: the ones the grants left behind, and the picks
    const ids = [...new Set([...(plan.removeIds ?? []), ...remove])]
      .filter((id) => id !== plan.classId && actor.items.get(id));
    const removedSpellNames = ids.map((id) => actor.items.get(id))
      .filter((i) => i?.type === 'spell' && i.flags?.[AM.ID]?.grantedBy).map((i) => i.name);
    await this.#deleteItems(actor, ids);

    // A feature's spells are given once and remembered; forget the ones taken away
    if (removedSpellNames.length) {
      const { ProseSpells } = await import('./proseSpells.js');
      const given = actor.getFlag(AM.ID, ProseSpells.FLAG) ?? [];
      const keep = given.filter((k) => !removedSpellNames.some((n) => String(k).endsWith(`::${n}`)));
      if (keep.length !== given.length) await actor.setFlag(AM.ID, ProseSpells.FLAG, keep);
    }

    // 4. Hit points and hit dice
    await this.#settleHitPoints(actor, plan, hpLevelsBefore);

    // 5. Pools that may now be over their new maximum
    await this.#clampPools(actor);

    ui.notifications.info(plan.target <= 0
      ? `${plan.className} removed. Character level ${plan.charAfter}.`
      : `${plan.className} lowered to level ${plan.target}. Character level ${plan.charAfter}.`);
    return true;
  }

  /**
   * a5e deletes a removed grant's items without waiting for it, so some of
   * these may be on their way out already; a batch naming one that is gone
   * fails whole. Whatever the batch could not take is taken one at a time.
   */
  static async #deleteItems(actor, ids) {
    const live = () => ids.filter((id) => actor.items.get(id));
    if (!live().length) return;
    try {
      await actor.deleteEmbeddedDocuments('Item', live());
      return;
    } catch (err) {
      AM.log(3, 'Level down: batch delete failed, one at a time', err);
    }
    for (const id of live()) {
      try { await actor.deleteEmbeddedDocuments('Item', [id]); }
      catch (err) { if (actor.items.get(id)) AM.log(1, `Level down: could not remove ${actor.items.get(id)?.name}`, err); }
    }
  }

  /**
   * A class's hit points per level, as a5e counts them: entries with a value,
   * keyed by character level, oldest first. Entries above the character level
   * (a5e's own level-down never clears them) and any beyond the class's level
   * are not hit points it has.
   */
  static #hpEntries(cls, charLevel) {
    return Object.entries(cls?.system?.hp?.levels ?? {})
      .map(([k, v]) => [Number(k), Number(v) || 0])
      .filter(([k, v]) => Number.isFinite(k) && v > 0 && k <= charLevel)
      .sort((a, b) => a[0] - b[0])
      .slice(0, this.#classLevel(cls));
  }

  static #hpLevelsByClass(actor) {
    const classes = actor.items.filter((i) => i.type === 'class');
    const charLevel = classes.reduce((n, c) => n + this.#classLevel(c), 0);
    const out = new Map();
    for (const c of classes) {
      out.set(c.id, {
        raw: Object.keys(c.system?.hp?.levels ?? {}),
        // What is written now, zeros aside: a5e keeps all twenty keys, unused at 0
        held: Object.fromEntries(Object.entries(c.system?.hp?.levels ?? {})
          .filter(([, v]) => Number(v) > 0).map(([k, v]) => [String(Number(k)), Number(v)])),
        list: this.#hpEntries(c, charLevel)
      });
    }
    return out;
  }

  /**
   * a5e keys `hp.levels` by character level and sums the keys up to the
   * character level. The lowered class keeps its first `target` entries; then
   * every class's remaining entries are numbered again from 1 in the order they
   * were taken, so a class taken later is not left above the new character
   * level. With a5e not computing hit points, the stored maximum loses the same.
   */
  static async #settleHitPoints(actor, plan, before) {
    const cls = actor.items.get(plan.classId);
    const entries = [];
    for (const [id, { list }] of before) {
      if (!actor.items.get(id)) continue;
      const kept = id === plan.classId ? list.slice(0, Math.max(0, plan.target)) : list;
      for (const [k, v] of kept) entries.push({ id, k, v });
    }
    entries.sort((a, b) => a.k - b.k);
    const next = new Map();
    entries.forEach((e, n) => {
      if (!next.has(e.id)) next.set(e.id, {});
      next.get(e.id)[String(n + 1)] = e.v;
    });

    const Replace = foundry.data?.operators?.ForcedReplacement;
    const updates = [];
    for (const [id, { raw, held }] of before) {
      const item = actor.items.get(id);
      if (!item) continue;
      const levels = next.get(id) ?? {};
      if (JSON.stringify(held) === JSON.stringify(levels)) continue;
      const update = { _id: id };
      if (Replace?.create) update['system.hp.levels'] = Replace.create(levels);
      else {
        for (const k of raw) update[`system.hp.levels.-=${k}`] = null;
        Object.assign(update, Object.fromEntries(Object.entries(levels).map(([k, v]) => [`system.hp.levels.${k}`, v])));
      }
      updates.push(update);
    }
    if (cls) {
      const used = Number(cls.system?.hp?.hitDiceUsed ?? 0) || 0;
      if (used > plan.target) {
        const u = updates.find((x) => x._id === cls.id) ?? (updates.push({ _id: cls.id }), updates.at(-1));
        u['system.hp.hitDiceUsed'] = plan.target;
      }
    }
    if (updates.length) {
      try { await actor.updateEmbeddedDocuments('Item', updates); }
      catch (err) { AM.log(1, 'Level down: hit point levels', err); }
    }

    const automated = actor.classAutomationFlags?.hitPoints ?? actor.items.some((i) => i.type === 'class');
    if (!automated) {
      const base = Number(actor.system?.attributes?.hp?.baseMax ?? actor.system?.attributes?.hp?.max) || 0;
      await actor.update({ 'system.attributes.hp.baseMax': Math.max(1, base - plan.hp.loss) });
    }

    // The starting class removed: the class that now holds the first level starts
    if (plan.target <= 0 && !actor.system?.classes?.startingClass) {
      const first = entries[0] ? actor.items.get(entries[0].id) : null;
      const slugOf = first ? this.#slug(first) : '';
      if (slugOf) {
        try { await actor.update({ 'system.classes.startingClass': slugOf }); }
        catch (err) { AM.log(2, 'Level down: starting class', err); }
      }
    }
  }

  /** Current hit points, exertion and spell slots no higher than their new maximum. */
  static async #clampPools(actor) {
    const sys = actor.system ?? {};
    const update = {};
    const hp = sys.attributes?.hp;
    if (hp && Number(hp.value) > Number(hp.max)) update['system.attributes.hp.value'] = Number(hp.max);
    const ex = sys.attributes?.exertion;
    if (ex && Number.isFinite(Number(ex.max)) && Number(ex.current) > Number(ex.max)) {
      update['system.attributes.exertion.current'] = Number(ex.max);
    }
    for (const [lvl, slot] of Object.entries(sys.spellResources?.slots ?? {})) {
      const max = Number(slot?.max);
      if (Number.isFinite(max) && Number(slot?.current) > max) update[`system.spellResources.slots.${lvl}.current`] = max;
    }
    if (Object.keys(update).length) {
      try { await actor.update(update); }
      catch (err) { AM.log(2, 'Level down: pools', err); }
    }
  }
}
