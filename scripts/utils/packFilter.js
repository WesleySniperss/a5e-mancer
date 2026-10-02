import { AM } from '../am.js';
import { HiddenSources } from './hiddenSources.js';
import { allIndexFields } from './compendiumIndexFix.js';

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
   * A pack's index, carrying the fields asked for.
   *
   * Ask for the system fields the caller reads - 'system.level',
   * 'system.classes' - not for 'system'. Measured 2026-10-02 on the test world,
   * the level-up window's first open took 38 s, and most of it was this method
   * asking for whole system objects:
   *
   *   - a5e indexes every pack at world load with the fields its browser
   *     reads (indexCompendiaFields; descriptions included, about 12 MB held
   *     for the session). For a5e-spells that is already the level, classes
   *     and schools the spell picker filters on. Asking for 'system' fetched
   *     all 895 spells again (6.9 s) and the 1758 entries of the imported pack
   *     (11.4 s), and doubled what those indexes hold.
   *   - Foundry keeps ONE set of indexed fields per pack, the last asked for.
   *     A request for 'system' replaced a5e's set, so a5e's next look at the
   *     pack fetched it whole again.
   *   - The class-features pack holds one maneuver among 4055 entries; the
   *     maneuver picker re-indexed all of it to read that one.
   *   - The single feature documents the level's grants read waited behind
   *     those fetches on the server, a second or more each.
   *
   * So, in order:
   *   1. a pack holding nothing of `types` is skipped on its plain index;
   *   2. an index that already carries every field asked for is used as it is
   *      - a5e's own index usually does - and nothing is fetched;
   *   3. when the wanted entries are a small share of a big pack, only those
   *      documents are read;
   *   4. otherwise the pack is indexed once more with the fields asked for
   *      AND a5e's own, so Foundry's one set of fields still covers a5e's next
   *      request and the next request here: one fetch a pack per session.
   * Whatever is read stays only as long as Foundry keeps its pack indexes and
   * documents - the session - as for every compendium the world uses.
   *
   * getIndex({fields}) once threw on a5e's packs ('Cannot add property price,
   * object is not extensible') and an index could come back without its system
   * data. Either way the documents are read instead, as before.
   *
   * @param {CompendiumCollection} pack
   * @param {string[]} fields   index fields wanted, e.g. ['name', 'type', 'system.level']
   *                            ('system' alone still means all of it - avoid)
   * @param {object}   [opts]
   * @param {string[]} [opts.types]  only these item types matter to the caller
   */
  static async indexOf(pack, fields, { types = null } = {}) {
    // a5e's Hidden Compendium Sources out of the indexes first - see hiddenSources.js
    await HiddenSources.apply();
    let plain;
    try {
      plain = await pack.getIndex();
    } catch (err) {
      AM.log(2, `${pack?.collection}: the plain index failed — ${err.message}`);
      return pack?.index ?? [];
    }

    /* Nothing here for this caller: hand back the cheap index and spend
       nothing. Most packs in an a5e world take this exit. */
    const wanted = types?.length ? [...plain].filter(e => types.includes(e.type)) : [...plain];
    if (types?.length && !wanted.length) return plain;

    // Only system fields and flags can be missing; name, type and img are in every index
    const paths = (fields ?? []).filter(f => f === 'system' || f === 'flags'
      || f.startsWith('system.') || f.startsWith('flags.'));
    if (!paths.length || this.#covers(wanted, paths)) return plain;

    /* A few entries in a big pack: those documents, not the whole pack again.
       A small pack is indexed like any other - one cheap request. */
    if (types?.length && plain.size >= this.BIG && wanted.length <= Math.max(this.FEW, plain.size * this.FEW_SHARE)) {
      return HiddenSources.filter(await this.#documentIndex(pack, plain, types));
    }

    try {
      const ask = new Set([...(fields ?? []), ...allIndexFields()]);
      const rich = await pack.getIndex({ fields: [...ask] });
      // The server hands back the whole pack, hidden sources included: out again
      HiddenSources.drop(pack);
      const richWanted = types?.length ? [...rich].filter(e => types.includes(e.type)) : [...rich];
      if (this.#covers(richWanted, paths)) return rich;
      AM.log(2, `${pack?.collection}: the index came back without its system data; `
             + `reading the documents instead`);
    } catch (err) {
      AM.log(2, `${pack?.collection}: the index would not take the extra fields `
             + `— ${err.message}`);
    }

    return HiddenSources.filter(await this.#documentIndex(pack, plain, types));
  }

  /** In a pack of BIG entries or more, up to FEW wanted entries, or FEW_SHARE of it, are read as documents. */
  static BIG = 300;
  static FEW = 40;
  static FEW_SHARE = 0.15;

  /**
   * Does this index carry what was asked for? Each field is looked for across
   * a sample of the wanted entries rather than on the first one, because a
   * single document may lack a field the rest have. 'system' alone asks for
   * all of it, which a5e's partial index does not count as.
   */
  static #covers(entries, paths) {
    if (!entries.length) return true;
    const sample = entries.slice(0, 16);
    return paths.every((p) => {
      if (p === 'system') return sample.some(e => e?.system && Object.keys(e.system).length > 12);
      const keys = p.split('.');
      return sample.some(e => keys.reduce((o, k) => (o && typeof o === 'object' && k in o ? o[k] : undefined), e) !== undefined);
    });
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

  /**
   * Read these compendium documents in one request a pack, so the fromUuid
   * calls after it find them in Foundry's cache (a pack keeps every document
   * it has read for the session). A read of a5e's class-features pack costs
   * the server about a second however few documents it names - it scans the
   * 4055 entries - so it is the number of requests that is slow, not their
   * size: the level-up read a level's features one at a time, sixty-odd
   * requests on the first open of a session (measured 2026-10-02). World and
   * already cached uuids are left to fromUuid.
   */
  static async prefetch(uuids) {
    const byPack = new Map();
    for (const uuid of uuids ?? []) {
      if (typeof uuid !== 'string' || !uuid.startsWith('Compendium.')) continue;
      const parts = uuid.split('.');
      const pack = game.packs.get(`${parts[1]}.${parts[2]}`);
      const id = parts.at(-1);
      if (!pack || !id || pack.get(id) instanceof foundry.abstract.Document) continue;
      if (!byPack.has(pack)) byPack.set(pack, new Set());
      byPack.get(pack).add(id);
    }
    await Promise.all([...byPack].map(([pack, ids]) =>
      pack.getDocuments({ _id__in: [...ids] }).catch((err) =>
        AM.log(2, `${pack.collection}: batch read failed, read one at a time - ${err.message}`))));
  }

  /** Same, for any document type. */
  static packsOfType(type) {
    const packs = game.packs.filter(p => p.metadata.type === type);
    let include = false;
    try { include = !!game.settings.get(AM.ID, 'includeDnd5ePacks'); } catch { /* pre-init */ }
    return include ? packs : packs.filter(p => !this.isDnd5e(p));
  }
}
