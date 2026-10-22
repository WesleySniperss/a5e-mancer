import { AM } from '../am.js';
import { PackFilter } from './packFilter.js';
import { HiddenSources } from './hiddenSources.js';

/**
 * a5e 1.4's pool grants: a choice with no list of options, only compendium
 * filters - "one maneuver of 1st or 2nd degree from the Biting Zephyr, Razor's
 * Edge or Sanguine Knot tradition", "one knack of the marshal". a5e's own window
 * answers one with a drop area and its compendium browser opened on those
 * filters; getSelectionComponentProps hands back no options at all.
 *
 * a5e 1.4.9 and 1.4.10 brought the first content that leans on them: the
 * Marshal (Revised) learns its lessons of war, followers and first maneuvers
 * from pools, and four of the Arcane Power feats a spell. Read as a grant with
 * no options, the builder either sent the whole item to a5e's window (spell
 * and maneuver pools) or - a feature pool - took it over and granted nothing.
 *
 * So the options are worked out here, from the same filters, the way a5e's
 * browser reads them (constructFilters), over the compendiums the module reads.
 * A filter this table does not know makes the pool one the module cannot
 * judge: such a grant stays a5e's to ask, rather than offering more than a5e
 * would. tools/checks/a5eupdate.mjs compares the table with a5e's after an
 * update.
 */
export class GrantPools {

  /**
   * Per grant type: the item type the pool is drawn from, and the filters a5e's
   * browser applies to it (src/view/dialogs/compendium-browser/utils/
   * constructFilters.ts, a5e 1.4.10). An item grant's pool is objects.
   */
  static FILTERS = {
    feature: { type: 'feature', filters: {
      featureType:    { key: 'system.featureType', type: 'value' },
      asi:            { key: 'system.asi', type: 'array' },
      featClasses:    { key: 'system.featClasses', type: 'array' },
      featType:       { key: 'system.featType', type: 'value' },
      followerType:   { key: 'system.followerType', type: 'value' },
      experienceType: { key: 'system.experienceType', type: 'value' },
      miscellaneous:  { subFilters: { hasPrerequisite: { key: 'system.prerequisite', type: 'boolean' } } },
      synergy:        { key: 'system.synergy', type: 'value' },
      classes:        { key: 'system.classes', type: 'value' },
      source:         { key: 'system.source', type: 'value' }
    } },
    maneuver: { type: 'maneuver', filters: {
      exertion:           { key: 'system.exertionCost', type: 'range' },
      maneuverDegrees:    { key: 'system.degree', type: 'value' },
      maneuverTraditions: { key: 'system.tradition', type: 'value' },
      miscellaneous:      { subFilters: { concentration: { key: 'system.concentration', type: 'boolean' },
                                          stance: { key: 'system.isStance', type: 'boolean' } } },
      source:             { key: 'system.source', type: 'value' }
    } },
    spell: { type: 'spell', filters: {
      spellLists:            { key: 'system.classes', type: 'array' },
      spellLevels:           { key: 'system.level', type: 'value' },
      primarySpellSchools:   { key: 'system.schools.primary', type: 'value' },
      secondarySpellSchools: { key: 'system.schools.secondary', type: 'array' },
      components:            { subFilters: { material: { key: 'system.components.material', type: 'boolean' },
                                             seen: { key: 'system.components.seen', type: 'boolean' },
                                             vocalized: { key: 'system.components.vocalized', type: 'boolean' } } },
      miscellaneous:         { subFilters: { concentration: { key: 'system.concentration', type: 'boolean' },
                                             ritual: { key: 'system.ritual', type: 'boolean' },
                                             rare: { key: 'system.rare', type: 'boolean' } } },
      source:                { key: 'system.source', type: 'value' }
    } },
    item: { type: 'object', filters: {
      objectType:    { key: 'system.objectType', type: 'value' },
      rarity:        { key: 'system.rarity', type: 'value' },
      miscellaneous: { subFilters: { bulky: { key: 'system.bulky', type: 'boolean' },
                                     requiresAttunement: { key: 'system.requiresAttunement', type: 'boolean' } } },
      source:        { key: 'system.source', type: 'value' }
    } }
  };

  /** Does this grant choose from a pool? */
  static isPool(grant) {
    return grant?.config?.selectionType === 'pool';
  }

  static #type(grant) { return grant?.type || grant?.grantType || ''; }

  static #key(grant) {
    return `${this.#type(grant)}|${JSON.stringify(grant?.config?.pool?.filters ?? {})}`;
  }

  /** Candidate lists by type and filters: a promise while read, then [{uuid, name, img}] or null. */
  static #lists = new Map();
  static #settled = new Map();

  /**
   * The pool's options as read: [{uuid, name, img}]; null when its filters are
   * not ones this module can judge (or its type has no pool here - a skill
   * specialty's); undefined when it has not been read yet - see prime.
   */
  static cached(grant) {
    if (!this.isPool(grant)) return null;
    const key = this.#key(grant);
    if (this.#settled.has(key)) return this.#settled.get(key);
    AM.log(3, `Pool of "${grant?.name ?? this.#type(grant)}" asked for before it was read`);
    return undefined;
  }

  /** How many a pool hands out: its count, less what it grants outright. */
  static countOf(grant, baseCount = 0) {
    const n = Number(grant?.config?.pool?.count);
    return Math.max(0, (Number.isFinite(n) && n > 0 ? n : 1) - baseCount);
  }

  /** Read the options of every pool among these grants. Each list once a session. */
  static async prime(grants) {
    const work = [];
    for (const grant of grants ?? []) {
      if (!this.isPool(grant)) continue;
      const key = this.#key(grant);
      if (!this.#lists.has(key)) {
        const filters = grant?.config?.pool?.filters ?? {};
        this.#lists.set(key, this.#read(this.#type(grant), filters)
          .catch((err) => { AM.log(1, `Pool of "${grant?.name}" could not be read:`, err); return null; })
          .then((list) => { this.#settled.set(key, list); return list; }));
      }
      work.push(this.#lists.get(key));
    }
    await Promise.all(work);
  }

  /** Index fields a type's filters read, besides name, type and img. */
  static #fields(spec) {
    const out = [];
    for (const f of Object.values(spec.filters)) {
      if (f.key) out.push(f.key);
      for (const s of Object.values(f.subFilters ?? {})) out.push(s.key);
    }
    return out;
  }

  static async #read(grantType, selections) {
    const spec = this.FILTERS[grantType];
    if (!spec) return null;                     // a skill specialty's pool, or a type to come
    const tests = this.#tests(spec, selections);
    if (!tests) return null;
    const fields = ['name', 'type', 'img', ...this.#fields(spec)];
    const out = [];
    const seen = new Set();
    for (const pack of PackFilter.itemPacks()) {
      let index;
      try { index = await PackFilter.indexOf(pack, fields, { types: [spec.type] }); }
      catch (err) { AM.log(2, `${pack.collection}: not read for a pool -`, err); continue; }
      for (const entry of HiddenSources.filter([...index])) {
        if (entry?.type !== spec.type || !tests.every(t => t(entry))) continue;
        // The same entry in a second pack (an import of a5e's own) is offered once
        const name = String(entry.name ?? '').toLowerCase();
        if (!name || seen.has(name)) continue;
        seen.add(name);
        out.push({ uuid: entry.uuid ?? `Compendium.${pack.collection}.Item.${entry._id}`, name: entry.name, img: entry.img ?? '' });
      }
    }
    out.sort((a, b) => a.name.localeCompare(b.name));
    AM.log(3, `Pool (${grantType}) ${JSON.stringify(selections)}: ${out.length} option(s)`);
    return out;
  }

  /**
   * a5e's constructFilters, as tests on an index entry: within one filter the
   * values held to "all" are each a test, the ones held to "any" one test
   * together; across filters every test must pass. null when a filter or a
   * value is one the table above does not know.
   */
  static #tests(spec, selections) {
    const get = (doc, key) => foundry.utils.getProperty(doc, key);
    const tests = [];
    for (const [name, data] of Object.entries(selections ?? {})) {
      if (data == null) continue;
      const conf = spec.filters[name];
      const values = [...(data.inclusive ?? []), ...(data.exclusive ?? [])];
      if (!conf) {
        if (values.length || data.min !== undefined || data.max !== undefined) {
          AM.log(2, `Pool filter "${name}" is not one this module knows; the grant is left to a5e`);
          return null;
        }
        continue;
      }
      if (conf.type === 'range') {
        const min = Number.parseInt(data.min, 10), max = Number.parseInt(data.max, 10);
        tests.push((d) => get(d, conf.key) >= min && get(d, conf.key) <= max);
        continue;
      }
      let unknown = false;
      const make = (value, keep) => {
        const sub = conf.subFilters?.[value];
        if (conf.type === 'array') return (d) => (get(d, conf.key)?.includes?.(value) ? keep : !keep);
        if (sub?.type === 'boolean') return (d) => (get(d, sub.key) ? keep : !keep);
        if (conf.type === 'boolean') return (d) => (get(d, conf.key) ? keep : !keep);
        // Loose on purpose, as a5e's: a degree is 1 in one entry and "1" in another
        // eslint-disable-next-line eqeqeq
        if (conf.type === 'value') return (d) => ((get(d, conf.key) == value) ? keep : !keep);
        unknown = true;
        return null;
      };
      const and = [], or = [];
      for (const v of data.inclusive ?? []) { const f = make(v, true); if (f) (data.inclusiveMode ? and : or).push(f); }
      for (const v of data.exclusive ?? []) { const f = make(v, false); if (f) (data.exclusiveMode ? and : or).push(f); }
      if (unknown) {
        AM.log(2, `Pool filter "${name}" holds a value this module does not know; the grant is left to a5e`);
        return null;
      }
      tests.push(...and);
      if (or.length) tests.push((d) => or.some(f => f(d)));
    }
    return tests;
  }
}
