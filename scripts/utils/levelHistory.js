import { LevelDownService } from './levelDownService.js';

/**
 * A character's levels one by one, as Level Up Gateway's builder lists them -
 * "1st Level Rogue", "2nd Level Rogue", ... - and what each of them gave.
 * Asked for 2026-10-02: the level-up window lists the levels, a click on one
 * shows what was taken there, and the build can be redone from it.
 *
 * Which class each character level went to is read from a5e's own record:
 * every class keeps `system.hp.levels` keyed by the character level it was
 * taken at (unused keys hold 0). Characters whose record has gaps - imported,
 * or made before a5e kept it - get the missing levels filled in class order,
 * the starting class first.
 *
 * What a level gave is read from the grant records (`system.grants`). A
 * class's grants carry the class level, an origin's the character level; a
 * grant that came from an item another grant handed out (a feature's own
 * proficiency, a feat's ability point) belongs to the level that item came
 * at. Maneuvers, spells and the feat taken for an ASI have no grant - they are
 * matched by the record our level-up writes on them (flags.a5e-mancer.levelUp).
 */
export class LevelHistory {

  static #classLevel(item) {
    return Number(item?.system?.classLevels ?? item?.system?.levels ?? item?.system?.level ?? 1) || 1;
  }

  static #slug(item) {
    return item?.slug || item?.system?.slug || String(item?.name ?? '').slugify?.({ strict: true }) || '';
  }

  /** "1st", "2nd", "3rd", "4th", "11th", "21st" */
  static ordinal(n) {
    const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
    return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
  }

  /**
   * Every character level, oldest first.
   * @returns {Array<{charLevel, classId, className, classLevel, img, classUuid, hp}>}
   */
  static levels(actor) {
    const classes = actor?.items?.filter?.((i) => i.type === 'class') ?? [];
    const total = classes.reduce((n, c) => n + this.#classLevel(c), 0);
    const byChar = new Map();
    const hpAt = new Map();
    const counted = new Map();
    for (const c of classes) {
      const entries = Object.entries(c.system?.hp?.levels ?? {})
        .map(([k, v]) => [Number(k), Number(v) || 0])
        .filter(([k, v]) => Number.isFinite(k) && v > 0 && k >= 1 && k <= total)
        .sort((a, b) => a[0] - b[0])
        .slice(0, this.#classLevel(c));
      for (const [k, v] of entries) {
        if (byChar.has(k)) continue;
        byChar.set(k, c);
        hpAt.set(k, v);
        counted.set(c.id, (counted.get(c.id) ?? 0) + 1);
      }
    }

    // Gaps in the record: the levels each class is still owed, starting class first
    const starting = actor.system?.classes?.startingClass ?? '';
    const ordered = [...classes].sort((a, b) =>
      (this.#slug(a) === starting ? -1 : 0) - (this.#slug(b) === starting ? -1 : 0));
    const owed = [];
    for (const c of ordered) for (let n = counted.get(c.id) ?? 0; n < this.#classLevel(c); n++) owed.push(c);
    for (let L = 1; L <= total; L++) if (!byChar.has(L) && owed.length) byChar.set(L, owed.shift());

    const seen = new Map();
    const out = [];
    for (let L = 1; L <= total; L++) {
      const c = byChar.get(L);
      if (!c) continue;
      const n = (seen.get(c.id) ?? 0) + 1;
      seen.set(c.id, n);
      out.push({
        charLevel: L, classId: c.id, className: c.name, classLevel: n, img: c.img,
        classUuid: c._stats?.compendiumSource ?? c.flags?.core?.sourceId ?? null,
        hp: hpAt.get(L) ?? null
      });
    }
    return out;
  }

  /**
   * What one level gave: the items it brought, the benefits with no item, the
   * picks our level-up recorded, and its hit points.
   * @param {Actor} actor
   * @param {number} charLevel
   */
  static summary(actor, charLevel) {
    const levels = this.levels(actor);
    const entry = levels.find((l) => l.charLevel === charLevel);
    if (!entry) return null;
    const charOf = (classId, classLevel) =>
      levels.find((l) => l.classId === classId && l.classLevel === classLevel)?.charLevel ?? null;

    const grants = actor.grants?.values ? [...actor.grants.values()] : [];
    const source = (g) => { try { return g?.itemUuid ? fromUuidSync(g.itemUuid) : null; } catch { return null; } };
    const docs = (g) => (['feature', 'item'].includes(g.grantType) ? (g.documentIds ?? []) : []);
    const parentOf = new Map();
    for (const g of grants) for (const id of docs(g)) if (!parentOf.has(id)) parentOf.set(id, g);
    const classes = actor.items.filter((i) => i.type === 'class');
    const classBySlug = new Map(classes.map((c) => [this.#slug(c), c]));

    // The character level a grant belongs to
    const memo = new Map();
    const levelOf = (g, depth = 0) => {
      if (memo.has(g.grantId)) return memo.get(g.grantId);
      let at = null;
      const src = source(g);
      const parent = src ? parentOf.get(src.id) : null;
      const rec = src ? LevelDownService.levelUpRecord(src) : null;
      if (parent && parent !== g && depth < 8) at = levelOf(parent, depth + 1);
      else if (rec?.charLevel) at = Number(rec.charLevel);
      else if (src) {
        const cls = src.type === 'class' ? src
          : src.type === 'archetype' ? classBySlug.get(src.system?.class)
          : (src.type === 'feature' && src.system?.classes) ? classBySlug.get(src.system.classes) : null;
        at = cls ? charOf(cls.id, Number(g.level) || 1) : (Number(g.level) || 1);
      }
      memo.set(g.grantId, at);
      return at;
    };

    const mine = grants.filter((g) => levelOf(g) === charLevel);
    const itemIds = new Set();
    for (const g of mine) for (const id of docs(g)) if (actor.items.get(id)) itemIds.add(id);
    const gained = [...itemIds].map((id) => actor.items.get(id));

    // Picks our level-up recorded at this level that no grant accounts for
    const picks = actor.items.filter((i) => {
      if (itemIds.has(i.id) || parentOf.has(i.id)) return false;
      const rec = LevelDownService.levelUpRecord(i);
      return rec && Number(rec.charLevel) === charLevel && i.type !== 'class';
    });

    const row = (i) => ({ id: i.id, uuid: i.uuid, name: i.name, img: i.img, type: i.type });
    const order = { archetype: 0, feature: 1, maneuver: 2, spell: 3 };
    const sort = (a, b) => (order[a.type] ?? 9) - (order[b.type] ?? 9) || a.name.localeCompare(b.name);
    return {
      ...entry,
      title: `${this.ordinal(entry.classLevel)} Level ${entry.className}`,
      gained: gained.sort(sort).map(row),
      picks: picks.sort(sort).map(row),
      benefits: mine.filter((g) => !['feature', 'item'].includes(g.grantType))
        .map((g) => ({ source: source(g)?.name ?? '', text: LevelDownService.describeGrant(actor, g) }))
        .filter((b) => b.text),
      isFirst: charLevel === 1,
      isLast: charLevel === levels.length,
      total: levels.length
    };
  }

  /**
   * Each class's level once the character is down to `charLevel`: the
   * character levels at or below it that went to the class.
   * @returns {Map<string, number>} classId -> level (0: the class goes)
   */
  static classLevelsAt(actor, charLevel) {
    const out = new Map(actor.items.filter((i) => i.type === 'class').map((c) => [c.id, 0]));
    for (const l of this.levels(actor)) if (l.charLevel <= charLevel) out.set(l.classId, l.classLevel);
    return out;
  }
}
