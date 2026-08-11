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

  /** Same, for any document type. */
  static packsOfType(type) {
    const packs = game.packs.filter(p => p.metadata.type === type);
    let include = false;
    try { include = !!game.settings.get(AM.ID, 'includeDnd5ePacks'); } catch { /* pre-init */ }
    return include ? packs : packs.filter(p => !this.isDnd5e(p));
  }
}
