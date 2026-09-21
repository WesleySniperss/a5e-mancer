import { AM } from '../am.js';
import { IMPORTED } from '../data/imported/index.js';
import { indexFieldsFor } from './compendiumIndexFix.js';

/**
 * The world compendium of content imported from a5e.tools - archetypes and
 * their features first, and later maneuvers, feats and items.
 *
 * Built from inside Foundry, as MagicManeuverPack is, and for the same reason:
 * a module can only ship a pack as a LevelDB built outside Foundry. Two things
 * differ. The documents keep the ids they are written with (keepId), because
 * they point at one another - an archetype's grants name its features by uuid -
 * and a character that took the archetype keeps its links through a rebuild.
 * And the pack is rebuilt when its content changes, by a hash of the data,
 * rather than by a version someone has to remember to bump.
 */
export class ImportedPack {

  static PACK_NAME = 'a5e-mancer-imported';
  static SETTING   = 'importedPackHash';

  static get collection() { return `world.${this.PACK_NAME}`; }
  static get pack() { return game.packs.get(this.collection) ?? null; }

  /** What the pack holds, as one short string: changes whenever the data does. */
  static get hash() {
    const text = JSON.stringify(IMPORTED);
    let h = 5381;
    for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
    return `${IMPORTED.length}:${(h >>> 0).toString(36)}`;
  }

  static async ensure({ force = false } = {}) {
    if (!game.user.isGM) return null;
    if (!game.settings.get(AM.ID, 'buildImportedPack')) return null;
    if (!IMPORTED.length) return null;

    let pack = this.pack;
    const built = this.#builtHash();
    if (pack && !force && built === this.hash) return pack;

    try {
      const created = !pack;
      if (!pack) {
        const CC = foundry.documents?.collections?.CompendiumCollection ?? globalThis.CompendiumCollection;
        if (!CC?.createCompendium) {
          AM.log(1, 'CompendiumCollection.createCompendium is unavailable in this Foundry version');
          return null;
        }
        pack = await CC.createCompendium({
          label: 'A5e Mancer: Imported', name: this.PACK_NAME, type: 'Item', packageType: 'world'
        });
        AM.log(3, 'Created the imported content compendium');
      }

      await this.#populate(pack);
      // Beside a5e's archetypes in the sidebar, once; a GM's own placement stands
      if (created) await this.#placeBesideSystem(pack);
      await this.#rememberHash(this.hash);
      ui.notifications.info(`${AM.NAME}: imported content compendium ready (${IMPORTED.length} entries).`);
      return pack;
    } catch (err) {
      AM.log(1, 'Could not build the imported content compendium:', err);
      ui.notifications.error(`${AM.NAME}: the imported content compendium could not be built — see the console.`);
      return null;
    }
  }

  static #builtHash() {
    try { return game.settings.get(AM.ID, this.SETTING) || null; }
    catch { return null; }
  }

  static async #rememberHash(h) {
    try { await game.settings.set(AM.ID, this.SETTING, h); }
    catch (err) { AM.log(2, 'Could not record the imported compendium version:', err); }
  }

  static async #placeBesideSystem(pack) {
    try {
      if (pack.folder) return;
      const folder = game.packs.get('a5e.a5e-archetypes')?.folder ?? null;
      if (folder) await pack.setFolder(folder);
    } catch (err) {
      AM.log(2, 'Could not put the imported compendium beside a5e\'s:', err);
    }
  }

  /** Replace the pack's contents with the current data, ids kept. */
  static async #populate(pack) {
    const wasLocked = pack.locked;
    if (wasLocked) await pack.configure({ locked: false });
    try {
      const existing = await pack.getDocuments();
      if (existing.length) await Item.deleteDocuments(existing.map(d => d.id), { pack: pack.collection });
      await Item.createDocuments(foundry.utils.deepClone(IMPORTED), { pack: pack.collection, keepId: true });
      // The fields a5e's browser and the module's pickers read, at once
      await pack.getIndex({ fields: [...new Set([...indexFieldsFor('archetype'), ...indexFieldsFor('feature'), 'system', 'flags'])] });
      AM.log(3, `Imported content compendium filled with ${IMPORTED.length} entries`);
    } finally {
      if (wasLocked) await pack.configure({ locked: true });
    }
  }
}
