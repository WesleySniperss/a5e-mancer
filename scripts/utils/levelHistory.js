import { AM } from '../am.js';
import { LevelDownService } from './levelDownService.js';
import { GrantAbsorber } from './grantAbsorber.js';
import { LevelUpService } from './levelUpService.js';
import { SpellService } from './spellService.js';
import { ManeuverService } from './maneuverService.js';

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

    /* Heritage, culture, background and destiny arrive with the first level,
       and their size, movement and languages are not the class's progression -
       which is what this page is read for. Their features are shown apart and
       their small print not at all: the sheet already shows it. A grant counts
       as an origin's when the chain of items that handed it out starts at one. */
    const ORIGINS = new Set(['heritage', 'culture', 'background', 'destiny']);
    const isOrigin = (g, depth = 0) => {
      const src = source(g);
      if (!src) return false;
      if (ORIGINS.has(src.type)) return true;
      const parent = parentOf.get(src.id);
      if (parent && parent !== g && depth < 8) return isOrigin(parent, depth + 1);
      return ORIGINS.has(String(src.system?.featureType ?? ''));
    };
    const classGrants = mine.filter((g) => !isOrigin(g));
    const originGrants = mine.filter((g) => isOrigin(g));
    const idsOf = (list) => {
      const ids = new Set();
      for (const g of list) for (const id of docs(g)) if (actor.items.get(id)) ids.add(id);
      return ids;
    };
    const itemIds = idsOf(mine);
    const originIds = idsOf(originGrants);
    const gained = [...idsOf(classGrants)].filter((id) => !originIds.has(id)).map((id) => actor.items.get(id));
    const origins = [...originIds].map((id) => actor.items.get(id));

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
      origins: origins.sort(sort).map(row),
      picks: picks.sort(sort).map(row),
      benefits: classGrants.filter((g) => !['feature', 'item'].includes(g.grantType))
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

  /**
   * The levels still ahead for one class, with what each will bring: the
   * features its grants hand out, the choices they ask (a fighting style, a
   * knack, the ability points), the archetype to pick, and what the level
   * adds to spells and maneuvers. Read from the class and the archetype the
   * character has, the same tree the level-up reads for its own level
   * (GrantAbsorber.describeTreeForLevel). For looking over the build and
   * planning it, as D&D Beyond shows its levels ahead; nothing is applied.
   * Asked for 2026-10-03.
   *
   * The documents are read once for every level ahead, a tier at a time, and
   * what an option holds is left unread until it is picked. Foundry keeps
   * them for the session, like any compendium document read.
   *
   * @param {Actor} actor
   * @param {string} classId  the class the levels ahead go to
   * @param {object} [opts]
   * @param {number} [opts.to]  the last class level to show (20)
   */
  static async future(actor, classId, { to = 20 } = {}) {
    const cls = actor?.items?.get(classId);
    if (!cls || cls.type !== 'class') return [];
    const total = this.levels(actor).length;
    const cur = this.#classLevel(cls);
    // The character stops at 20, whatever the class could still take
    const last = Math.min(20, to, cur + (20 - total));
    if (last <= cur) return [];
    const archetypeLevel = Number(cls.system?.archetypeLevel ?? 0) || 0;
    const archetype = cls.archetype ?? null;

    await GrantAbsorber.prefetchTree([cls, archetype],
      { clsLevel: last, charLevel: total + (last - cur) }, { deepOptions: false });

    const T = (k, data) => (data ? game.i18n.format(`am.build.${k}`, data) : game.i18n.localize(`am.build.${k}`));
    const out = [];
    for (let n = cur + 1; n <= last; n++) {
      const lv = { clsLevel: n, charLevel: total + (n - cur) };
      const trees = [await GrantAbsorber.describeTreeForLevel(cls, lv, {})];
      if (archetype) trees.push(await GrantAbsorber.describeTreeForLevel(archetype, lv, {}));

      const features = [], choices = [], benefits = [];
      const shown = new Set();
      for (const tree of trees) {
        // Only what fires at this level; the trees also carry every earlier grant
        for (const f of tree.features ?? []) {
          if (!f.firesNow) continue;
          for (const e of f.baseEntries ?? []) {
            if (shown.has(e.key)) continue;
            shown.add(e.key);
            features.push({ uuid: e.key, name: e.label, img: e.img });
          }
          if (f.options?.length) {
            choices.push({ label: f.label, count: f.total || 1,
              options: f.options.map(o => ({ uuid: o.key, name: o.label, img: o.img })) });
          }
        }
        for (const g of tree.grants ?? []) {
          if (!g.firesNow || !g.options?.length) continue;
          /* a5e writes an ability score improvement as one grant a point -
             "8th Level ASI (1st Point)", "(2nd Point)" - which read as two
             questions. It is one: points to spend, or a feat instead. */
          if (g.type === 'ability') {
            const asi = choices.find(c => c.asi);
            if (asi) {
              asi.count += g.total || 1;
              for (const o of g.options) if (!asi.options.some(x => x.name === o.label)) asi.options.push({ name: o.label });
              continue;
            }
            choices.push({ label: T('asi'), count: g.total || 1, asi: true, options: g.options.map(o => ({ name: o.label })) });
            continue;
          }
          choices.push({ label: g.label, count: g.total || 1, options: g.options.map(o => ({ name: o.label })) });
        }
        for (const a of tree.fixedAbilities ?? []) {
          if (!a.firesNow) continue;
          const bonus = String(a.grant?.bonus ?? '').trim();
          const sign = bonus ? `${/^[+-]/.test(bonus) ? bonus : `+${bonus}`} ` : '';
          benefits.push(`${a.label}: ${sign}${(a.base ?? []).map(k => String(k).toUpperCase()).join(', ')}`);
        }
      }
      // An archetype still to choose: the list to choose from, not its features
      if (archetypeLevel === n && !archetype) {
        const list = await LevelUpService.getArchetypesForClass(cls);
        if (list.length) {
          choices.push({ label: T('archetype'), count: 1,
            options: list.map(x => ({ uuid: x.uuid, name: x.name, img: x.img })) });
        }
      }

      out.push({
        charLevel: lv.charLevel, classLevel: n, classId: cls.id, className: cls.name, img: cls.img,
        title: `${this.ordinal(n)} Level ${cls.name}`,
        future: true,
        features, choices, benefits,
        notes: await this.#progressNotes(actor, cls, n)
      });
    }
    return out;
  }

  /** What a class level adds to spells and maneuvers, as a line each. */
  static async #progressNotes(actor, cls, n) {
    const T = (k, data) => game.i18n.format(`am.build.${k}`, data ?? {});
    const notes = [];
    const owed = SpellService.newAtLevel(cls.name, n);
    const max = SpellService.maxSpellLevelFor(cls.name, n);
    const before = SpellService.maxSpellLevelFor(cls.name, n - 1);
    const spells = [];
    if (owed?.cantrips) spells.push(T('cantrips', { n: owed.cantrips }));
    if (owed?.spells) spells.push(T('spells', { n: owed.spells }));
    if (max > before) spells.push(T('spell-level', { n: max }));
    if (spells.length) notes.push(`${T('spells-title')}: ${spells.join(' · ')}`);
    try {
      const budget = await ManeuverService.maneuverBudget(actor, { classId: cls.id, newLevel: n });
      for (const [kind, k] of Object.entries(budget?.kinds ?? {})) {
        if (!k.levelling) continue;
        const bits = [];
        if (k.gained > 0) bits.push(T('maneuvers', { n: k.gained }));
        if (k.maxDegree > k.prevMaxDegree) bits.push(T('degree', { n: k.maxDegree }));
        if (bits.length) notes.push(`${game.i18n.localize(`am.maneuvers.kind-${kind}`)}: ${bits.join(' · ')}`);
      }
    } catch (err) {
      AM.log(3, `Build: no maneuver progression for ${cls.name} ${n}`, err);
    }
    return notes;
  }
}
