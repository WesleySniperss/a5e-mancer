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
        const index = await pack.getIndex({
          fields: ['name', 'type', 'img', 'system.featureType', 'system.prerequisite',
                   'system.classes', 'system.source']
        });
        for (const entry of index) {
          if (!this.isFeat(entry)) continue;
          const uuid = entry.uuid ?? `Compendium.${pack.collection}.Item.${entry._id}`;
          const key  = entry.name.toLowerCase();
          if (seen.has(key)) continue;              // same feat in two packs
          seen.add(key);
          out.push({
            uuid,
            name:         entry.name,
            img:          entry.img,
            prerequisite: entry.system?.prerequisite ?? '',
            source:       entry.system?.source ?? '',
            packLabel:    pack.metadata?.label ?? ''
          });
        }
      } catch (err) {
        AM.log(2, `Could not index feats from ${pack.collection}:`, err);
      }
    }

    out.sort((a, b) => a.name.localeCompare(b.name));
    this.#cache = out;
    AM.log(3, `Loaded ${out.length} feat(s)`);
    return out;
  }

  /** Drop the cache so a newly installed module's feats show up. */
  static invalidate() { this.#cache = null; }

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
  static async optionsFor(actor, { search = '', onlyEligible = false } = {}) {
    const all = await this.loadAll();
    const q = search.trim().toLowerCase();

    const rows = all
      .filter(f => !q || f.name.toLowerCase().includes(q)
                      || f.prerequisite.toLowerCase().includes(q))
      .map(f => {
        const pre = this.checkPrerequisite(actor, f);
        return {
          ...f,
          met:     pre.met,
          unknown: pre.unknown,
          preText: pre.text,
          why:     (pre.failures ?? []).join(', ')
        };
      });

    // "Only ones I qualify for" keeps the unknown ones: they are unjudged, not
    // failed, and dropping them would hide perfectly legal picks.
    return onlyEligible ? rows.filter(f => f.met) : rows;
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
