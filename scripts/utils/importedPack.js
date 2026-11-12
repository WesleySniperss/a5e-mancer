import { AM } from '../am.js';
import { IMPORTED } from '../data/imported/index.js';
import { GENERATED } from '../data/imported/generated.js';
import { indexFieldsFor } from './compendiumIndexFix.js';
import { HiddenSources } from './hiddenSources.js';
import { documentToV14, GRANT_FORMAT } from './grantFormat.js';

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
    /* The grant format too, for the Items pack only: its documents are the ones
       with grants. The monsters and challenges hold none, and rebuilding them
       for it cost a GM's first load 600-odd documents for nothing. */
    const format = kind === 'Item' ? `+${GRANT_FORMAT}` : '';
    return `${written.length}:${this.#djb2(JSON.stringify(written))}+${this.countOf(kind) - written.length}:${this.#djb2(ofFiles)}${format}`;
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
    /* Written in a5e 1.3's grant shape; a5e 1.4 reads another (grantFormat.js).
       Both, so the packs read on either. */
    return docs.map(d => documentToV14(d));
  }

  /** The folder a document goes in: its own, or by its type. */
  static FOLDER_OF_TYPE = { archetype: 'Archetypes', feature: 'Archetype Features', spell: 'Spells', object: 'Equipment', maneuver: 'Combat Maneuvers', background: 'Backgrounds', destiny: 'Destinies', heritage: 'Heritages', culture: 'Cultures' };
  static FOLDER_ORDER = {
    Item: ['Heritages', 'Heritage Features', 'Paragon Gifts', 'Cultures', 'Culture Features', 'Backgrounds', 'Background Features', 'Destinies', 'Destiny Features', 'Archetypes', 'Archetype Features', 'Feats', 'Combat Maneuvers', 'Spells', 'Psionic Powers', 'Magic Items', 'Equipment'],
    Actor: ['Aberrations', 'Beasts', 'Celestials', 'Constructs', 'Dragons', 'Elementals', 'Fey', 'Fiends', 'Giants', 'Humanoids', 'Monstrosities', 'Oozes', 'Plants', 'Undead'],
    JournalEntry: ['Traps', 'Terrain', 'Weather', 'Supernatural', 'Creatures', 'Circumstance', 'Urban', 'Constructed', 'Technological', 'Other']
  };
  static folderOf(doc) { return doc.flags?.[AM.ID]?.folder ?? this.FOLDER_OF_TYPE[doc.type] ?? null; }

  /**
   * A monster's spells are named in the data, not copied - a5e's spell pack
   * stays the one copy of them. Each is taken from its compendium as the actor
   * is made and given the book, preparation and uses its stat block says.
   * A spell that cannot be found is left off, and the log says how many.
   */
  static async #castSpells(actors) {
    const refs = actors.flatMap(a => a.flags?.[AM.ID]?.spells ?? []);
    if (!refs.length) return;
    const wanted = new Map();                         // pack collection -> ids
    for (const { uuid } of refs) {
      const [, scope, name, , id] = String(uuid).split('.');   // Compendium.<scope>.<name>.Item.<id>
      const collection = `${scope}.${name}`;
      if (!wanted.has(collection)) wanted.set(collection, new Set());
      wanted.get(collection).add(id);
    }
    const found = new Map();
    for (const [collection, ids] of wanted) {
      const pack = game.packs.get(collection);
      if (!pack) { AM.log(2, `${collection} is not in this world; the monsters' spells from it are left off`); continue; }
      let docs = await pack.getDocuments({ _id__in: [...ids] });
      if (!docs?.length) docs = (await pack.getDocuments()).filter(d => ids.has(d.id));
      for (const d of docs) found.set(`Compendium.${collection}.Item.${d.id}`, d);
    }
    let missing = 0;
    for (const actor of actors) {
      for (const ref of actor.flags?.[AM.ID]?.spells ?? []) {
        const source = found.get(ref.uuid);
        if (!source) { missing++; continue; }
        const data = source.toObject();
        data._id = ref.id;
        data.folder = null;
        data.system.spellBook = ref.book;
        data.system.prepared = ref.prepared;
        if (ref.uses) data.system.uses = { ...data.system.uses, ...ref.uses };
        data._stats = { ...(data._stats ?? {}), compendiumSource: ref.uuid };
        actor.items.push(data);
      }
    }
    if (missing) AM.log(2, `${missing} of the monsters' ${refs.length} spells were not found in their compendia`);
  }

  /** The document class a pack of this kind holds. */
  static #documentClass(kind) {
    return CONFIG?.[kind]?.documentClass ?? globalThis[kind] ?? foundry.documents?.[kind] ?? null;
  }

  /**
   * The ids a pack holds, as the server has them. Not the index in memory: a5e's hidden sources are taken out of
   * that (HiddenSources), and getIndex() asked for no new field hands it back as it is. Counted and cleared by
   * it, a pack in a world that hides Voidrunner's Codex looked short of 254 items, 49 monsters and 14
   * challenges, so every later look built it again, and the entries left behind kept the folders they were in.
   */
  static async #storedIds(pack, cls = pack.documentClass) {
    const rows = await cls.database.get(cls, { query: {}, index: true, indexFields: ['_id'], pack: pack.collection }, game.user);
    return (rows ?? []).map(r => r._id).filter(Boolean);
  }

  /** A pack's folders, made afresh: name -> id. A failure leaves the documents unfoldered, not unbuilt. */
  static async #folders(pack, names, kind) {
    const out = new Map();
    const FolderClass = foundry.documents?.Folder ?? globalThis.Folder;
    /* The old ones as the server has them, apart from the making of the new: a folder list the client still held
       after the server had let go of one made the delete throw, and the throw took the new folders with it. */
    try {
      const old = (await FolderClass.database.get(FolderClass, { query: {}, pack: pack.collection }, game.user) ?? []).map(f => f._id);
      if (old.length) await FolderClass.deleteDocuments(old, { pack: pack.collection });
    } catch (err) {
      AM.log(2, 'Could not clear the imported compendium\'s old folders:', err);
    }
    try {
      const order = [...names].sort((a, b) => (this.FOLDER_ORDER[kind].indexOf(a) + 1 || 99) - (this.FOLDER_ORDER[kind].indexOf(b) + 1 || 99));
      const made = await FolderClass.createDocuments(order.map((name, i) => ({ name, type: kind, sorting: 'a', sort: (i + 1) * 1000 })), { pack: pack.collection });
      for (const f of made ?? []) out.set(f.name, f.id);
    } catch (err) {
      AM.log(2, 'Could not make the imported compendium\'s folders:', err);
    }
    return out;
  }

  /**
   * Every pack, each built only if what it holds has changed, and all in one folder.
   *
   * One build at a time, by one GM. Two builds of the same pack at once each deleted what the other had just
   * made (2026-11-12, on a copy of the user's world: "Folder ... does not exist!", every pack built twice over).
   * That is what a second GM in the world does at load, or a Rebuild pressed while the load's build runs. So at
   * load only the GM Foundry names as the active one builds, and a call that comes while a build runs waits for
   * it and then looks again - by then there is usually nothing left to do.
   */
  static #queue = Promise.resolve();
  static ensure({ force = false } = {}) {
    if (!game.user?.isGM) return Promise.resolve(null);
    if (!game.settings.get(AM.ID, 'buildImportedPack')) return Promise.resolve(null);
    const active = game.users?.activeGM;
    if (!force && active && !active.isSelf) return Promise.resolve(null);
    const run = this.#queue.then(() => this.#ensureAll(force));
    this.#queue = run.catch(() => null);
    return run;
  }

  static async #ensureAll(force) {
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
    /* Built for this data, and still holding it. A pack that lost its documents - emptied on the user's server
       (2026-11-12), half filled by a build that was stopped - is built again although its hash matches. Counted
       on the server, hidden sources and all (#storedIds). */
    if (pack && !force && this.#builtHash(kind) === this.hashOf(kind)) {
      let held = count;
      try { held = (await this.#storedIds(pack)).length; } catch { /* as built */ }
      if (held >= count) return pack;
      AM.log(2, `${spec.label} holds ${held} of its ${count} entries: built again`);
    }

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
      /* Every document, as the server holds them: getDocuments leaves out those the system cannot make any
         more - the monsters a5e 1.4 wrote are not valid in 1.5 - and the index in memory those of hidden
         sources (#storedIds). */
      const ids = await this.#storedIds(pack, Document);
      if (ids.length) await Document.deleteDocuments(ids, { pack: pack.collection });
      const docs = await this.documents(kind);
      if (kind === 'Actor') await this.#castSpells(docs);
      const folders = await this.#folders(pack, new Set(docs.map(d => this.folderOf(d)).filter(Boolean)), kind);
      for (const d of docs) { const id = folders.get(this.folderOf(d)); if (id) d.folder = id; }
      /* As a5e's own packs hold them. a5e's createActor hook gives every new creature its six basic maneuvers
         and 47 interactions unless it comes from a compendium; made in one, each of the 313 monsters got
         them, 53 items apiece, each made with a request of its own (2026-11-12: the build took hours and
         the monsters carried them out into the world). And a5e's item _onCreate writes every effect's
         origin back with a request per item; in a compendium the origin means nothing, and a5e writes it
         again when the item is taken onto an actor. Both are let be while this pack is built. */
      const ItemProto = CONFIG.Item?.documentClass?.prototype;
      const writeEmbedded = ItemProto?.updateEmbeddedDocuments;
      const building = pack.collection;
      if (typeof writeEmbedded === 'function') {
        ItemProto.updateEmbeddedDocuments = function (name, updates, operation) {
          const originsOnly = name === 'ActiveEffect' && Array.isArray(updates)
            && updates.every(u => Object.keys(u ?? {}).every(k => k === '_id' || k === 'origin'));
          if (this.pack === building && originsOnly) return Promise.resolve([]);
          return writeEmbedded.call(this, name, updates, operation);
        };
      }
      try {
        // In batches: a thousand documents in one request is a large message to send and to validate at once
        for (let i = 0; i < docs.length; i += 100) {
          await Document.createDocuments(docs.slice(i, i + 100), { pack: pack.collection, keepId: true, fromCompendium: true });
        }
      } finally {
        if (typeof writeEmbedded === 'function') ItemProto.updateEmbeddedDocuments = writeEmbedded;
      }
      // The fields a5e's browser and the module's pickers read, at once
      const fields = this.PACKS[kind].index.flatMap(t => indexFieldsFor(t));
      await pack.getIndex({ fields: [...new Set([...fields, 'system', 'flags'])] });
      // a5e's hidden sources (Voidrunner's Codex by default) out of the rebuilt index
      HiddenSources.drop(pack);
      AM.log(3, `${this.PACKS[kind].label} filled with ${docs.length} entries`);
    } finally {
      if (wasLocked) await pack.configure({ locked: true });
    }
  }
}
