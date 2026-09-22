import { AM } from '../am.js';
import { IMPORTED } from '../data/imported/index.js';
import { GENERATED } from '../data/imported/generated.js';
import { indexFieldsFor } from './compendiumIndexFix.js';

/**
 * The world compendia of content imported from a5e.tools: heritages, cultures,
 * backgrounds, destinies, archetypes and their features, feats, combat
 * maneuvers, spells, psionic powers, magic items and equipment in one, the
 * monsters in another and the exploration challenges in a third - a compendium
 * holds one kind of document, and a monster is an actor, a challenge a journal
 * entry.
 *
 * Built from inside Foundry, as MagicManeuverPack is, and for the same reason:
 * a module can only ship a pack as a LevelDB built outside Foundry. Two things
 * differ. The documents keep the ids they are written with (keepId), because
 * they point at one another - an archetype's grants name its features by uuid -
 * and a character that took the archetype keeps its links through a rebuild.
 * And a pack is rebuilt when its content changes, by a hash of the data,
 * rather than by a version someone has to remember to bump.
 *
 * Two kinds of content. Written by hand (IMPORTED): the Dread Knight, whose
 * features carry actions and a flag the module reads. And converted from
 * a5e.tools pages by tools/import (GENERATED): some megabytes of JSON in a few
 * files, so only their count and hash are loaded with the module and the files
 * themselves are fetched when a pack is built. Each file says in the manifest
 * whether it holds items or actors, which is the pack it is built into.
 *
 * The three sit together in one compendium folder of their own, "A5e Mancer
 * Import", made when the first pack is built and filled once for worlds whose
 * packs were made before it existed.
 *
 * A thousand entries in one list is not browsable, so each pack has folders:
 * Archetypes, Backgrounds, Feats, Combat Maneuvers, Spells, Magic Items,
 * Equipment and the rest for the items, one per creature kind (Beasts,
 * Dragons, Undead...) for the monsters, and one per kind of challenge (Traps,
 * Terrain, Weather...) for the journals. They are rebuilt with the pack.
 */
export class ImportedPack {

  /** The pack each kind of document goes in. */
  static PACKS = {
    Item: {
      name: 'a5e-mancer-imported', label: 'A5e Mancer: Imported',
      setting: 'importedPackHash', index: ['archetype', 'feature']
    },
    Actor: {
      name: 'a5e-mancer-imported-monsters', label: 'A5e Mancer: Imported Monsters',
      setting: 'importedMonsterPackHash', index: ['npc']
    },
    JournalEntry: {
      name: 'a5e-mancer-imported-challenges', label: 'A5e Mancer: Exploration Challenges',
      setting: 'importedChallengePackHash', index: []
    }
  };

  /** The sidebar folder the three of them are gathered in, so they sit together. */
  static SIDEBAR_FOLDER = 'A5e Mancer Import';
  static KINDS = Object.keys(this.PACKS);

  static PACK_NAME = 'a5e-mancer-imported';
  static SETTING   = 'importedPackHash';

  static collectionOf(kind) { return `world.${this.PACKS[kind].name}`; }
  static packOf(kind) { return game.packs.get(this.collectionOf(kind)) ?? null; }

  static get collection() { return this.collectionOf('Item'); }
  static get pack() { return this.packOf('Item'); }

  /** The converted files that hold documents of this kind (older manifests: items). */
  static filesOf(kind) { return (GENERATED.files ?? []).filter(f => (f.documents ?? 'Item') === kind); }
  /** The hand-written documents of this kind: the Dread Knight and its features. */
  static writtenOf(kind) { return kind === 'Item' ? IMPORTED : []; }

  static countOf(kind) {
    return this.writtenOf(kind).length + this.filesOf(kind).reduce((n, f) => n + f.count, 0);
  }

  static #djb2(text) {
    let h = 5381;
    for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }

  /** What a pack holds, as one short string: changes whenever its data does. */
  static hashOf(kind) {
    const written = this.writtenOf(kind);
    const files = this.filesOf(kind);
    const ofFiles = files.map(f => `${f.file}:${f.count}:${f.hash ?? GENERATED.hash}`).join('+');
    return `${written.length}:${this.#djb2(JSON.stringify(written))}+${this.countOf(kind) - written.length}:${this.#djb2(ofFiles)}`;
  }

  static get hash() { return this.hashOf('Item'); }
  static get count() { return IMPORTED.length + GENERATED.count; }

  /* Sources a5e's list of products does not have: the Gate Pass Gazette where
     a5e.tools does not name the issue (a5e knows the issues, not the series),
     and books a5e has no entry for. */
  static SOURCES = {
    a5eMancerGPG:          { abbreviation: 'GPG', title: 'Level Up: Gate Pass Gazette (via a5e.tools)', url: 'https://a5e.tools/rules/gate-pass-gazette', series: 'gatePassGazette' },
    a5eMancerPlanestrider: { abbreviation: 'PJ', title: "Planestrider's Journal (via a5e.tools)", url: 'https://a5e.tools' },
    a5eMancerMythological: { abbreviation: 'MFMM', title: 'Mythological Figures & Maleficent Monsters (via a5e.tools)', url: 'https://a5e.tools' },
    a5eMancerOther:        { abbreviation: 'a5e.tools', title: 'a5e.tools', url: 'https://a5e.tools' }
  };
  static registerSource() {
    const products = CONFIG.A5E?.products;
    if (!products) return;
    for (const [key, p] of Object.entries(this.SOURCES)) {
      if (products[key]) continue;
      products[key] = { affiliate: true, publisher: 'enPublishing', systems: ['a5e'], ...p };
    }
  }

  /** Every document one pack is built from: the written ones, and the converted ones fetched. */
  static async documents(kind = 'Item') {
    const docs = foundry.utils.deepClone(this.writtenOf(kind));
    for (const { file, count } of this.filesOf(kind)) {
      const route = foundry.utils.getRoute?.(`modules/${AM.ID}/${file}`) ?? `modules/${AM.ID}/${file}`;
      const res = await fetch(route);
      if (!res.ok) throw new Error(`${file}: ${res.status} ${res.statusText}`);
      const generated = await res.json();
      if (generated.length !== count) AM.log(2, `${file} holds ${generated.length} documents, the manifest says ${count}`);
      docs.push(...generated);
    }
    return docs;
  }

  /** The folder a document goes in: its own, or by its type. */
  static FOLDER_OF_TYPE = { archetype: 'Archetypes', feature: 'Archetype Features', spell: 'Spells', object: 'Equipment', maneuver: 'Combat Maneuvers', background: 'Backgrounds', destiny: 'Destinies', heritage: 'Heritages', culture: 'Cultures' };
  static FOLDER_ORDER = {
    Item: ['Heritages', 'Heritage Features', 'Paragon Gifts', 'Cultures', 'Culture Features', 'Backgrounds', 'Background Features', 'Destinies', 'Destiny Features', 'Archetypes', 'Archetype Features', 'Feats', 'Combat Maneuvers', 'Spells', 'Psionic Powers', 'Magic Items', 'Equipment'],
    Actor: ['Aberrations', 'Beasts', 'Celestials', 'Constructs', 'Dragons', 'Elementals', 'Fey', 'Fiends', 'Giants', 'Humanoids', 'Monstrosities', 'Oozes', 'Plants', 'Undead'],
    JournalEntry: ['Traps', 'Terrain', 'Weather', 'Supernatural', 'Creatures', 'Circumstance', 'Urban', 'Constructed', 'Technological', 'Other']
  };
  static folderOf(doc) { return doc.flags?.[AM.ID]?.folder ?? this.FOLDER_OF_TYPE[doc.type] ?? null; }

  /** The document class a pack of this kind holds. */
  static #documentClass(kind) {
    return CONFIG?.[kind]?.documentClass ?? globalThis[kind] ?? foundry.documents?.[kind] ?? null;
  }

  /** A pack's folders, made afresh: name -> id. A failure leaves the documents unfoldered, not unbuilt. */
  static async #folders(pack, names, kind) {
    const out = new Map();
    try {
      const FolderClass = foundry.documents?.Folder ?? globalThis.Folder;
      const old = [...(pack.folders ?? [])].map(f => f.id);
      if (old.length) await FolderClass.deleteDocuments(old, { pack: pack.collection });
      const order = [...names].sort((a, b) => (this.FOLDER_ORDER[kind].indexOf(a) + 1 || 99) - (this.FOLDER_ORDER[kind].indexOf(b) + 1 || 99));
      const made = await FolderClass.createDocuments(order.map((name, i) => ({ name, type: kind, sorting: 'a', sort: (i + 1) * 1000 })), { pack: pack.collection });
      for (const f of made ?? []) out.set(f.name, f.id);
    } catch (err) {
      AM.log(2, 'Could not make the imported compendium\'s folders:', err);
    }
    return out;
  }

  /** Every pack, each built only if what it holds has changed, and all in one folder. */
  static async ensure({ force = false } = {}) {
    if (!game.user.isGM) return null;
    if (!game.settings.get(AM.ID, 'buildImportedPack')) return null;
    let first = null;
    for (const kind of this.KINDS) {
      const pack = await this.#ensureOne(kind, force);
      first ??= pack;
    }
    await this.#gatherAll();
    return first;
  }

  static async #ensureOne(kind, force) {
    const spec = this.PACKS[kind];
    const count = this.countOf(kind);
    if (!count) return null;

    let pack = this.packOf(kind);
    if (pack && !force && this.#builtHash(kind) === this.hashOf(kind)) return pack;

    try {
      const created = !pack;
      if (!pack) {
        const CC = foundry.documents?.collections?.CompendiumCollection ?? globalThis.CompendiumCollection;
        if (!CC?.createCompendium) {
          AM.log(1, 'CompendiumCollection.createCompendium is unavailable in this Foundry version');
          return null;
        }
        pack = await CC.createCompendium({ label: spec.label, name: spec.name, type: kind, packageType: 'world' });
        AM.log(3, `Created ${spec.label}`);
      }

      await this.#populate(pack, kind);
      // In the module's own sidebar folder when it is new; afterwards a GM's own placement stands
      if (created) await this.#gather(pack);
      await this.#rememberHash(kind, this.hashOf(kind));
      ui.notifications.info(`${AM.NAME}: ${spec.label} ready (${count} entries).`);
      return pack;
    } catch (err) {
      AM.log(1, `Could not build ${spec.label}:`, err);
      ui.notifications.error(`${AM.NAME}: ${spec.label} could not be built — see the console.`);
      return null;
    }
  }

  static #builtHash(kind = 'Item') {
    try { return game.settings.get(AM.ID, this.PACKS[kind].setting) || null; }
    catch { return null; }
  }

  static async #rememberHash(kind, h) {
    try { await game.settings.set(AM.ID, this.PACKS[kind].setting, h); }
    catch (err) { AM.log(2, 'Could not record the imported compendium version:', err); }
  }

  /** The sidebar folder the packs live in, made if the world has none. */
  static async #sidebarFolder() {
    const FolderClass = foundry.documents?.Folder ?? globalThis.Folder;
    const mine = game.folders?.find(f => f.type === 'Compendium' && f.name === this.SIDEBAR_FOLDER);
    if (mine) return mine;
    const [made] = await FolderClass.createDocuments([{ name: this.SIDEBAR_FOLDER, type: 'Compendium', sorting: 'm' }]) ?? [];
    return made ?? null;
  }

  static async #gather(pack) {
    try {
      const folder = await this.#sidebarFolder();
      if (folder && pack.folder?.id !== folder.id) await pack.setFolder(folder);
    } catch (err) {
      AM.log(2, 'Could not put the imported compendium in its folder:', err);
    }
  }

  /* The packs of worlds built before there was a folder are sitting wherever
     they were made, so they are moved into it - once. After that the GM's own
     placement stands: a pack dragged out stays out. */
  static async #gatherAll() {
    try {
      if (game.settings.get(AM.ID, 'importedPacksGathered')) return;
      for (const kind of this.KINDS) {
        const pack = this.packOf(kind);
        if (pack) await this.#gather(pack);
      }
      await game.settings.set(AM.ID, 'importedPacksGathered', true);
    } catch (err) {
      AM.log(2, 'Could not gather the imported compendia into one folder:', err);
    }
  }

  /** Replace a pack's contents with the current data, ids kept. */
  static async #populate(pack, kind) {
    const Document = this.#documentClass(kind);
    if (!Document?.createDocuments) throw new Error(`no ${kind} document class to build the pack with`);
    const wasLocked = pack.locked;
    if (wasLocked) await pack.configure({ locked: false });
    try {
      const existing = await pack.getDocuments();
      if (existing.length) await Document.deleteDocuments(existing.map(d => d.id), { pack: pack.collection });
      const docs = await this.documents(kind);
      const folders = await this.#folders(pack, new Set(docs.map(d => this.folderOf(d)).filter(Boolean)), kind);
      for (const d of docs) { const id = folders.get(this.folderOf(d)); if (id) d.folder = id; }
      // In batches: a thousand documents in one request is a large message to send and to validate at once
      for (let i = 0; i < docs.length; i += 100) {
        await Document.createDocuments(docs.slice(i, i + 100), { pack: pack.collection, keepId: true });
      }
      // The fields a5e's browser and the module's pickers read, at once
      const fields = this.PACKS[kind].index.flatMap(t => indexFieldsFor(t));
      await pack.getIndex({ fields: [...new Set([...fields, 'system', 'flags'])] });
      AM.log(3, `${this.PACKS[kind].label} filled with ${docs.length} entries`);
    } finally {
      if (wasLocked) await pack.configure({ locked: true });
    }
  }
}
