import { AM } from '../am.js';

/**
 * a5e's "Hidden Compendium Sources" (a5e's settings): the products whose
 * content a GM wants out of every compendium - the space setting of
 * Voidrunner's Codex, typically.
 *
 * a5e applies it in indexCompendiaFields at `setup`, when Foundry v13+ has not
 * loaded a single pack index yet, so it hides nothing; and nothing in this
 * module read it. So a GM who hid Voidrunner's Codex was still offered its
 * classes, heritages, gear and maneuvers in the builder, the level-up and
 * every picker, and saw them in the sidebar.
 *
 * This applies it the way a5e's updateIndex does - the entries go from the
 * packs' indexes - once a session, in the background after the world loads,
 * and awaited by everything here that offers content. The sources are read
 * straight from the database (an index request, not merged into the loaded
 * index), so a5e packs whose index entries will not take extra fields cannot
 * make it fail. Anything that later asks a pack for its index with fields -
 * a picker, the browser's filter enrichment, a rebuilt Imported pack - gets
 * back the whole pack from the server, so it calls `drop` again.
 *
 * The Imported pack of exploration challenges holds journal entries, which
 * have no source field; their product is in the module's flags and is read
 * there.
 *
 * A change of the setting applies at the next load, as a5e's own does.
 */
export class HiddenSources {

  /**
   * The product keys hidden now: what a GM saved, and nothing until one does.
   *
   * a5e registers the setting with Voidrunner's Codex ticked, but its own code
   * reads the value saved in the world ("…getItem('a5e.disabledCompendiaSources')
   * ?? []") and not that default - so until the setting is saved, a5e means to
   * hide nothing. Read the same way here: a world with Psions and Psyknights in
   * it keeps them until a GM decides otherwise.
   */
  static get keys() {
    try {
      const raw = game.settings.storage.get('world')?.getItem('a5e.disabledCompendiaSources');
      if (raw === null || raw === undefined) return new Set();
      const value = typeof raw === 'string' ? JSON.parse(raw) : raw;
      return new Set(Array.isArray(value) ? value : []);
    } catch { return new Set(); }
  }

  static #sourceOf(entry) {
    const s = entry?.system?.source ?? entry?.flags?.[AM.ID]?.challenge?.source ?? '';
    return typeof s === 'string' ? s : String(s?.name ?? s?.key ?? '');
  }

  static isHidden(entry, keys = this.keys) {
    if (!keys.size) return false;
    const s = this.#sourceOf(entry);
    return !!s && keys.has(s);
  }

  /** The entries of a list that are not hidden. The list itself when nothing is. */
  static filter(entries, keys = this.keys) {
    if (!keys.size) return entries;
    return [...entries].filter(e => !this.isHidden(e, keys));
  }

  /** Take a pack's hidden entries out of its index. @returns {number} how many */
  static drop(pack, keys = this.keys) {
    if (!keys.size || !pack?.index?.size) return 0;
    let n = 0;
    for (const entry of [...pack.index.values()]) {
      if (!this.isHidden(entry, keys)) continue;
      pack.index.delete(entry._id);
      n++;
    }
    if (n) {
      try { pack.initializeTree?.(); } catch { /* the sidebar tree catches up on its next render */ }
    }
    return n;
  }

  static #promise = null;

  /** Once a session: every pack's hidden entries out of its index. */
  static apply() {
    this.#promise ??= this.#run().catch(err => {
      AM.log(1, 'Hidden compendium sources could not be applied:', err);
      return 0;
    });
    return this.#promise;
  }

  static async #run() {
    const keys = this.keys;
    if (!keys.size) return 0;
    let dropped = 0;
    const packs = game.packs.filter(p => ['Item', 'Actor'].includes(p.metadata?.type)
      || p.collection === 'world.a5e-mancer-imported-challenges');
    await Promise.allSettled(packs.map(async (pack) => {
      try {
        await pack.getIndex();                    // the plain one, loaded at world load already
        const field = pack.metadata.type === 'JournalEntry' ? `flags.${AM.ID}.challenge.source` : 'system.source';
        const cls = pack.documentClass;
        const sources = await cls.database.get(cls, { query: {}, index: true, indexFields: [field], pack: pack.collection }, game.user);
        const hidden = new Set(sources.filter(e => this.isHidden(e, keys)).map(e => e._id));
        for (const id of hidden) pack.index.delete(id);
        if (hidden.size) {
          dropped += hidden.size;
          try { pack.initializeTree?.(); } catch { /* as above */ }
        }
      } catch (err) {
        AM.log(2, `${pack.collection}: its sources could not be read, so nothing is hidden there -`, err);
      }
    }));
    AM.log(3, `Hidden compendium sources (${[...keys].join(', ')}): ${dropped} entries taken out of the compendia`);
    return dropped;
  }
}
