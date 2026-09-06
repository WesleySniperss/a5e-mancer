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
   * The index already loaded is the fallback, and it is not a poor one: this
   * module enriches every pack index at ready (see compendiumIndexFix) with
   * exactly the system fields these loaders read — tradition, degree,
   * exertionCost, level, classes, schools, description. So a pack that cannot
   * be re-indexed still yields its items.
   */
  static async indexOf(pack, fields) {
    try {
      return await pack.getIndex({ fields });
    } catch (err) {
      AM.log(2, `${pack?.collection}: the index would not take the extra fields, `
             + `using the one already loaded — ${err.message}`);
      return pack?.index ?? [];
    }
  }

  /** Same, for any document type. */
  static packsOfType(type) {
    const packs = game.packs.filter(p => p.metadata.type === type);
    let include = false;
    try { include = !!game.settings.get(AM.ID, 'includeDnd5ePacks'); } catch { /* pre-init */ }
    return include ? packs : packs.filter(p => !this.isDnd5e(p));
  }
}
