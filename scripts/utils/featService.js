import { AM } from '../a5e-mancer.js';
import { PackFilter } from './packFilter.js';
import { applyItemIcon } from '../data/a5eIcons.js';

/**
 * Feats, for the "ability score increase OR a feat" choice a5e gives at 4th, 8th,
 * 12th, 16th and 19th level.
 *
 * a5e does not model that choice as a grant: the class carries two `ability`
 * grants of one point each and nothing else, so taking a feat instead is a rules
 * option the system leaves to the player. That is why the level-up only ever
 * offered the two points — there was nothing in the data to read.
 *
 * A feat is an item of type `feature` with `system.featureType === 'feat'`. It is
 * NOT the `feat` document type, which the packs do not use.
 */
export class FeatService {

  static #cache = null;

  /** Every feat in the enabled item compendiums. Cached for the session. */
  static async loadAll({ force = false } = {}) {
    if (this.#cache && !force) return this.#cache;

    const out = [];
    const seen = new Set();
    for (const pack of PackFilter.itemPacks()) {
      try {
        /* Through PackFilter, not pack.getIndex directly. Asking Foundry to
           fold system fields into an index it has already built throws on
           a5e’s packs, and this catch swallowed that and skipped the pack —
           every pack, so the picker offered no feats at all. PackFilter now
           checks that the index it hands back really carries the system data,
           and reads the documents when it does not. Measured against the real
           packs: 0 feats before, 625 after. */
        const index = await PackFilter.indexOf(pack,
          ['name', 'type', 'img', 'system'], { types: ['feature'] });
        for (const entry of index) {
          if (!this.isFeat(entry)) continue;
          const uuid = entry.uuid ?? `Compendium.${pack.collection}.Item.${entry._id}`;
          const key  = entry.name.toLowerCase();
          if (seen.has(key)) continue;              // same feat in two packs
          seen.add(key);
          const prerequisite = entry.system?.prerequisite ?? '';
          out.push({
            uuid,
            name:         entry.name,
            img:          entry.img,
            prerequisite,
            source:       entry.system?.source ?? '',
            packLabel:    pack.metadata?.label ?? '',
            /* The axes the picker sorts on, worked out once here rather than
               on every keystroke. */
            classes:      this.classesInPrerequisite(prerequisite),
            gated:        !!prerequisite.trim()
          });
        }
      } catch (err) {
        AM.log(2, `Could not index feats from ${pack.collection}:`, err);
      }
    }

    out.sort((a, b) => a.name.localeCompare(b.name));
    this.#cache = out;
    AM.log(out.length ? 3 : 2, `Loaded ${out.length} feat(s)`);
    return out;
  }

  /** Drop the cache so a newly installed module's feats show up. */
  static invalidate() { this.#cache = null; }

  /**
   * Which classes a prerequisite names — "3 levels in marshal, 3 levels in
   * rogue" → ['marshal', 'rogue'].
   *
   * a5e records system.featClasses on almost none of its feats; the class gate
   * lives in the prerequisite text, which is why "feats for my class" could
   * never be offered as an ordering. Read out of the text, it can be. The keys
   * are CONFIG.A5E.classes keys, so they line up with what the character has.
   */
  static classesInPrerequisite(prereq) {
    if (!prereq) return [];
    const keys = new Map(
      Object.keys(CONFIG.A5E?.classes ?? {}).map(k => [k.toLowerCase(), k])
    );
    const found = [];
    const re = /\blevels?\s+in\s+([a-z]+(?:\s+[a-z]+)?)/gi;
    let m;
    while ((m = re.exec(prereq))) {
      const two = m[1].toLowerCase().replace(/\s+/g, '');
      const one = m[1].toLowerCase().split(/\s+/)[0];
      const key = keys.get(two) ?? keys.get(one);
      if (key && !found.includes(key)) found.push(key);
    }
    return found;
  }

  /** The class keys a character actually has levels in. */
  static actorClassKeys(actor) {
    const keys = new Map(
      Object.keys(CONFIG.A5E?.classes ?? {}).map(k => [k.toLowerCase(), k])
    );
    const out = [];
    for (const item of (actor?.items ?? [])) {
      if (item.type !== 'class') continue;
      const name = (item.name ?? '').toLowerCase();
      const key = keys.get(name.replace(/\s+/g, '')) ?? keys.get(name);
      if (key && !out.includes(key)) out.push(key);
    }
    return out;
  }

  /**
   * How the picker may be ordered.
   *
   * Alphabetical was the only order there was, and for six hundred entries
   * that is a list you scroll rather than one you use.
   */
  static SORTS = {
    name:   { label: 'am.asi.feat-sort-name',   cmp: (a, b) => a.name.localeCompare(b.name) },
    source: { label: 'am.asi.feat-sort-source',
              cmp: (a, b) => (a.source || '~').localeCompare(b.source || '~')
                          || a.name.localeCompare(b.name) },
    gate:   { label: 'am.asi.feat-sort-gate',
              /* Ungated first: those are the ones anybody may take. */
              cmp: (a, b) => (a.gated ? 1 : 0) - (b.gated ? 1 : 0)
                          || a.name.localeCompare(b.name) },
    fit:    { label: 'am.asi.feat-sort-fit',
              /* Eligible first, then the ones this character’s own classes gate. */
              cmp: (a, b) => (b.met ? 1 : 0) - (a.met ? 1 : 0)
                          || (b.forMyClass ? 1 : 0) - (a.forMyClass ? 1 : 0)
                          || a.name.localeCompare(b.name) }
  };

  /**
   * A feat is `feature` + `featureType: 'feat'`.
   *
   * Checked against the packs: of 732 documents in a5e's feats pack, 625 match
   * and the 107 that do not are class features, knacks and natural weapons —
   * none of which should be offered here. One class feature (Water's Balm) is
   * labelled `feat` in a5e's own data; that is their mislabel, not a filter to
   * work around.
   */
  static isFeat(entryOrItem) {
    return entryOrItem?.type === 'feature'
        && (entryOrItem.system?.featureType ?? '') === 'feat';
  }

  /* ── prerequisites ────────────────────────────────────── */

  /**
   * Check a feat's prerequisite against the character.
   *
   * a5e writes prerequisites as free prose — "3 levels in marshal, 3 levels in
   * rogue", "War Dancer feat", "Strength 13 or higher", "Proficiency with a type
   * of vehicle". Only some of those can be checked mechanically, so this reports
   * three states rather than two:
   *
   *   met: true          — parsed and satisfied, or no prerequisite at all
   *   met: false         — parsed and NOT satisfied, with the reason
   *   unknown: true      — could not be parsed; shown, never hidden
   *
   * Guessing at the unparseable ones and hiding them would quietly remove valid
   * options, which is worse than showing a line of text the player can read.
   */
  static checkPrerequisite(actor, feat) {
    const text = String(feat?.prerequisite ?? '').trim();
    if (!text) return { met: true, unknown: false, text: '' };

    const parts = text.split(/,|;| and /i).map(s => s.trim()).filter(Boolean);
    const failures = [];
    let parsedAny = false;

    for (const part of parts) {
      const check = this.#checkClause(actor, part);
      if (check === null) continue;                 // unparseable clause
      parsedAny = true;
      if (!check.ok) failures.push(check.reason);
    }

    if (!parsedAny) return { met: true, unknown: true, text };
    return { met: failures.length === 0, unknown: false, text, failures };
  }

  /**
   * One clause. Returns null when the shape is not recognised, so the caller can
   * tell "not satisfied" from "cannot tell".
   */
  /** Single words that follow a number in a prerequisite but name no class. */
  static #NOT_A_CLASS = new Set([
    'level', 'levels', 'spell', 'spells', 'feat', 'feats', 'cantrip', 'cantrips',
    'maneuver', 'maneuvers', 'attack', 'attacks', 'point', 'points',
    'die', 'dice', 'round', 'rounds', 'hour', 'hours', 'foot', 'feet'
  ]);

  static #checkClause(actor, clause) {
    // "3 levels in marshal" / "3 Levels in Sorcerer"
    let m = clause.match(/^(\d+)\s+levels?\s+in\s+(.+)$/i);
    if (m) {
      const need = Number(m[1]);
      const name = m[2].trim().toLowerCase();
      const cls  = (actor?.items ?? []).find(i =>
        i.type === 'class' && i.name.toLowerCase() === name);
      const have = cls?.system?.classLevels ?? cls?.system?.levels ?? 0;
      return { ok: have >= need, reason: `${m[2].trim()} ${have}/${need}` };
    }

    // "3 herald" / "3 witch" / "3 berserker (rugged defense)"
    //
    // This is how a5e actually writes class prerequisites — the "N levels in X"
    // shape above is the rarer one. Missing it was why the filter barely
    // filtered: an unrecognised clause counts as unjudged, and unjudged feats
    // are kept, so a cleric was offered every herald and deathwalker feat in
    // the book.
    //
    // The class name must be ONE word. A5e's are (herald, berserker, witch,
    // deathwalker), and the restriction is what keeps this from swallowing
    // clauses like "3 spells known" and judging them as a class nobody has.
    m = clause.match(/^(\d+)\s+([a-z][a-z'-]+)(?:\s*\(([^)]*)\))?$/i);
    if (m && !this.#NOT_A_CLASS.has(m[2].toLowerCase())) {
      const need = Number(m[1]);
      const name = m[2].toLowerCase();
      const arch = m[3]?.trim().toLowerCase() ?? '';
      const cls  = (actor?.items ?? []).find(i =>
        i.type === 'class' && i.name.toLowerCase() === name);
      const have = cls?.system?.classLevels ?? cls?.system?.levels ?? 0;

      if (have < need) return { ok: false, reason: `${m[2]} ${have}/${need}` };

      // A parenthetical names the archetype the levels have to be in.
      if (arch) {
        const hasArch = (actor?.items ?? []).some(i =>
          i.type === 'archetype' && i.name.toLowerCase() === arch);
        if (!hasArch) return { ok: false, reason: `${m[2]} (${m[3].trim()})` };
      }
      return { ok: true, reason: `${m[2]} ${have}/${need}` };
    }

    // "Strength 13 or higher" / "Dexterity 13"
    m = clause.match(/^(strength|dexterity|constitution|intelligence|wisdom|charisma)\s+(\d+)/i);
    if (m) {
      const key = { strength: 'str', dexterity: 'dex', constitution: 'con',
                    intelligence: 'int', wisdom: 'wis', charisma: 'cha' }[m[1].toLowerCase()];
      const have = actor?.system?.abilities?.[key]?.value ?? 0;
      const need = Number(m[2]);
      return { ok: have >= need, reason: `${m[1]} ${have}/${need}` };
    }

    // "War Dancer feat" — a named feat the character must already have
    m = clause.match(/^(.+?)\s+feat$/i);
    if (m) {
      const name = m[1].trim().toLowerCase();
      const has  = (actor?.items ?? []).some(i =>
        this.isFeat(i) && i.name.toLowerCase() === name);
      return { ok: has, reason: `${m[1].trim()} feat` };
    }

    // "Level 4" / "4th level"
    m = clause.match(/^(?:character\s+)?level\s+(\d+)/i) || clause.match(/^(\d+)(?:st|nd|rd|th)\s+level$/i);
    if (m) {
      const have = (actor?.items ?? [])
        .filter(i => i.type === 'class')
        .reduce((n, i) => n + (i.system?.classLevels ?? i.system?.levels ?? 0), 0);
      const need = Number(m[1]);
      return { ok: have >= need, reason: `level ${have}/${need}` };
    }

    return null;                                    // not a shape we can judge
  }

  /** Feats as a UI model, each carrying its prerequisite verdict. */
  static async optionsFor(actor, {
    search = '', onlyEligible = false, sort = 'name', dir = 'asc',
    onlyMyClass = false, onlyUngated = false
  } = {}) {
    const all = await this.loadAll();
    const q = search.trim().toLowerCase();
    const mine = this.actorClassKeys(actor);

    let rows = all
      .filter(f => !q || f.name.toLowerCase().includes(q)
                      || f.prerequisite.toLowerCase().includes(q))
      .map(f => {
        const pre = this.checkPrerequisite(actor, f);
        return {
          ...f,
          met:        pre.met,
          unknown:    pre.unknown,
          preText:    pre.text,
          why:        (pre.failures ?? []).join(', '),
          /* Gated on a class this character has — the difference between a
             feat that is merely restricted and one restricted TO them. */
          forMyClass: f.classes.length > 0 && f.classes.some(c => mine.includes(c))
        };
      });

    // "Only ones I qualify for" keeps the unknown ones: they are unjudged, not
    // failed, and dropping them would hide perfectly legal picks.
    if (onlyEligible) rows = rows.filter(f => f.met);
    /* A feat nobody gates is open to this character too, so it stays. */
    if (onlyMyClass)  rows = rows.filter(f => f.forMyClass || !f.classes.length);
    if (onlyUngated)  rows = rows.filter(f => !f.gated);

    const cmp = (this.SORTS[sort] ?? this.SORTS.name).cmp;
    rows.sort(cmp);
    if (dir === 'desc') rows.reverse();
    return rows;
  }

  /**
   * Add a feat to the actor, with its own grants taken over by the builder when
   * they can be, so a5e's window stays shut here too.
   */
  static async addToActor(actor, uuid, choices = {}, lv = {}) {
    const { GrantAbsorber } = await import('./grantAbsorber.js');
    return GrantAbsorber.addFeatureItem(actor, uuid, choices, lv, 'feat');
  }
}
