import { AM } from '../a5e-mancer.js';

/**
 * Which compendiums the module reads content from.
 *
 * The a5e system ships conversions of the 5e SRD alongside its own books —
 * `dnd5e-spells`, `dnd5e-items`, `dnd5e-class-features`, `dnd5e-racial-features`,
 * `dnd5e-monsters`. Scanning every Item pack therefore returned each spell twice,
 * once from `a5e-spells` and once from `dnd5e-spells`, which is what showed up as
 * duplicated spells in the pickers.
 *
 * They are excluded by default. A GM running a mixed table can switch them back
 * on with the "Include the 5e conversion compendiums" setting.
 */
export class PackFilter {

  /** Pack names (and label prefixes) that are 5e conversions, not a5e content. */
  static DND5E = /(^|[.\-])dnd5e[-.]/i;

  /** @returns {boolean} whether this pack is a 5e conversion */
  static isDnd5e(pack) {
    const name  = pack?.metadata?.name ?? '';
    const coll  = pack?.collection ?? '';
    const label = pack?.metadata?.label ?? '';
    return this.DND5E.test(name) || this.DND5E.test(coll) || /^D&D\s*5E\b/i.test(label);
  }

  /** Item compendiums the module should read, honouring the setting. */
  static itemPacks() {
    const packs = game.packs.filter(p => p.metadata.type === 'Item');
    let include = false;
    try { include = !!game.settings.get(AM.ID, 'includeDnd5ePacks'); } catch { /* pre-init */ }
    return include ? packs : packs.filter(p => !this.isDnd5e(p));
  }

  /**
   * The same compendium entry is referred to by two different strings in this
   * world. Foundry's canonical uuid is `Compendium.<pack>.Item.<id>`, and that
   * is what a5e writes when it grants something or a document is dragged in.
   * The dialogs here build the older short form, `Compendium.<pack>.<id>`, and
   * write that as the source of anything they add.
   *
   * Both forms are live on real characters — 42 spells in this world carry the
   * canonical one — so comparing the raw strings says two references to the
   * same spell are different spells. In the management dialogs that reads as
   * 'the player unticked it', and confirming would have offered to delete
   * spells nobody touched. Compare through here instead.
   */
  static normalizeSource(uuid) {
    return String(uuid ?? '').replace(/\.(?:Item|JournalEntry|Actor|Macro)\./, '.');
  }

  /**
   * A pack's index, with the fields asked for where that is possible.
   *
   * getIndex({fields}) asks Foundry to merge the extra fields into an index it
   * has already built, and on a5e's packs that throws — 'Cannot add property
   * price, object is not extensible'. The entries in a loaded index are not
   * open to having a whole system object folded into them. One pack throwing
   * took its whole catalogue out of the manage dialogs, which is why they
   * opened empty.
   *
   * The plain index was the fallback, and the note that used to stand here
   * said it was a good one because the module enriches every pack index at
   * ready. It does not. That enrichment was moved off the world-load path and
   * now runs the first time the a5e compendium browser is opened — so in a
   * session where nobody opens it, the fallback index carries `_id`, `name`,
   * `type` and `img` and no system data whatsoever.
   *
   * The loaders read that index for system.tradition, system.degree,
   * system.classes, system.level. Every one of them came back undefined, and
   * undefined is not an error — it is a maneuver with no tradition and a spell
   * on no class list. So the windows filled up and every filter in them was
   * dead: 343 maneuvers under one blank tradition, 895 spells where the
   * character's class allows 52. That is the manage dialogs "not working" and
   * the window "covered by something" — it was covered by everything.
   *
   * So an index is now checked for what was asked of it, and a pack whose
   * index will not carry its system data has its documents read instead. That
   * is the expensive path, which is why `types` exists: the plain index always
   * carries `type`, so a pack holding nothing the caller wants is skipped
   * before any of this costs anything. The result is cached per pack.
   *
   * @param {CompendiumCollection} pack
   * @param {string[]} fields   index fields wanted, e.g. ['name','type','system']
   * @param {object}   [opts]
   * @param {string[]} [opts.types]  only these item types matter to the caller
   */
  static async indexOf(pack, fields, { types = null } = {}) {
    let plain;
    try {
      plain = await pack.getIndex();
    } catch (err) {
      AM.log(2, `${pack?.collection}: the plain index failed — ${err.message}`);
      return pack?.index ?? [];
    }

    /* Nothing here for this caller: hand back the cheap index and spend
       nothing. Most packs in an a5e world take this exit. */
    if (types?.length) {
      let any = false;
      for (const entry of plain) if (types.includes(entry.type)) { any = true; break; }
      if (!any) return plain;
    }

    try {
      const rich = await pack.getIndex({ fields });
      if (this.#carriesFields(rich, fields)) return rich;
      AM.log(2, `${pack?.collection}: the index came back without its system data; `
             + `reading the documents instead`);
    } catch (err) {
      /* Foundry merges the extra fields into an index it has already built, and
         on a5e's packs that throws — 'Cannot add property price, object is not
         extensible'. */
      AM.log(2, `${pack?.collection}: the index would not take the extra fields `
             + `— ${err.message}`);
    }

    return this.#documentIndex(pack, plain, types);
  }

  /**
   * Does this index actually carry the system data that was asked for?
   *
   * Sampled across several entries rather than read off the first, because a
   * single document may legitimately lack a field the rest of the pack has.
   * Only `system` is checked: `flags` is genuinely absent on most documents,
   * and demanding it would send every pack down the expensive path.
   */
  static #carriesFields(index, fields) {
    if (!fields?.some(f => f === 'system' || f.startsWith('system.'))) return true;
    let seen = 0;
    for (const entry of index) {
      if (entry?.system !== undefined) return true;
      if (++seen >= 8) break;
    }
    return seen === 0;   // an empty pack has nothing to be missing
  }

  /** Documents read once per pack and set of types, shaped like index entries. */
  static #docIndexCache = new Map();

  /**
   * The wanted documents, and only those.
   *
   * Reading a whole pack would be the simple thing and the wrong one: a5e keeps
   * exactly one maneuver among the 4010 documents of its class-features pack,
   * and fetching all 4010 to find it is the kind of cost a player feels every
   * time the window opens. The plain index already knows which entries are of
   * the type the caller wants, so only those ids are asked for.
   */
  static async #documentIndex(pack, plain, types) {
    const key = (pack?.collection ?? '') + '|' + (types?.length ? [...types].sort().join(',') : '*');
    if (this.#docIndexCache.has(key)) return this.#docIndexCache.get(key);

    const entries = types?.length
      ? [...plain].filter(e => types.includes(e.type))
      : [...plain];
    const ids = entries.map(e => e._id);

    const shape = (d) => ({
      _id:    d.id ?? d._id,
      name:   d.name,
      type:   d.type,
      img:    d.img,
      system: d.system ?? {},
      flags:  d.flags ?? {},
      uuid:   d.uuid ?? `Compendium.${pack?.collection}.Item.${d.id ?? d._id}`
    });

    let built;
    try {
      const docs = ids.length
        ? await pack.getDocuments({ _id__in: ids })
        : await pack.getDocuments();
      built = docs.map(shape);
      AM.log(3, `${pack?.collection}: read ${built.length} documents for their system data`);
    } catch (err) {
      /* An older Foundry, or a pack that will not take the query — ask for all
         of them rather than give up and hand back data with no system in it. */
      AM.log(2, `${pack?.collection}: narrowed document read failed (${err.message}); `
             + `reading the whole pack`);
      try {
        const docs = await pack.getDocuments();
        built = docs.map(shape).filter(e => !types?.length || types.includes(e.type));
      } catch (err2) {
        AM.log(2, `${pack?.collection}: could not read its documents — ${err2.message}`);
        built = [...plain];
      }
    }
    this.#docIndexCache.set(key, built);
    return built;
  }

  /** Same, for any document type. */
  static packsOfType(type) {
    const packs = game.packs.filter(p => p.metadata.type === type);
    let include = false;
    try { include = !!game.settings.get(AM.ID, 'includeDnd5ePacks'); } catch { /* pre-init */ }
    return include ? packs : packs.filter(p => !this.isDnd5e(p));
  }
}
