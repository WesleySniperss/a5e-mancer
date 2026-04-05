import { AM } from '../a5e-mancer.js';

/**
 * A5e item types we need for character creation and how to find them in compendiums.
 */
const A5E_TYPES = ['heritage', 'culture', 'background', 'destiny', 'class'];

export class DocumentService {

  /* --------------------------------------------------------
     Public API
     -------------------------------------------------------- */

  /** Load all compendium documents and store them in AM.documents */
  static async loadAndInitializeDocuments() {
    try {
      AM.log(3, 'Loading a5e documents…');
      const start = performance.now();

      if (!AM.documents) AM.documents = {};

      const results = await Promise.allSettled(
        A5E_TYPES.map(type => this.#fetchByType(type))
      );

      results.forEach((res, i) => {
        const type = A5E_TYPES[i];
        if (res.status === 'fulfilled') {
          AM.documents[type] = this.#organiseByPack(res.value, type);
          const total = AM.documents[type].reduce((n, g) => n + g.docs.length, 0);
          AM.log(3, `Loaded ${total} ${type} docs in ${AM.documents[type].length} groups`);
        } else {
          AM.log(1, `Failed to load ${type} docs:`, res.reason);
          AM.documents[type] = [];
        }
      });

      AM.log(3, `Document load completed in ${Math.round(performance.now() - start)}ms`);
    } catch (err) {
      AM.log(1, 'Critical document load error:', err);
      ui.notifications.error('am.errors.document-loading-failed', { localize: true });
    }
  }

  /* --------------------------------------------------------
     Private helpers
     -------------------------------------------------------- */

  /**
   * Fetch all documents of a given a5e item type from compendiums.
   * Respects the per-type pack whitelist in settings; falls back to everything.
   */
  static async #fetchByType(type) {
    const selectedPacks = game.settings.get(AM.ID, `${type}Packs`) || [];
    const itemPacks = game.packs.filter(p => p.metadata.type === 'Item');

    let packs;
    if (selectedPacks.length) {
      packs = itemPacks.filter(p => selectedPacks.includes(p.collection));
      if (!packs.length) packs = itemPacks; // fallback
    } else {
      packs = itemPacks;
    }

    const docs = [];
    for (const pack of packs) {
      try {
        const index = await pack.getIndex({ fields: ['name', 'type', 'img', 'system'] });
        for (const entry of index) {
          if (entry.type !== type) continue;
          docs.push({
            id:          entry._id,
            name:        entry.name,
            img:         entry.img,
            uuid:        `Compendium.${pack.collection}.${entry._id}`,
            packId:      pack.collection,
            packName:    pack.metadata.label,
            // Lazy-load description when item is actually selected
            description: '',
            enrichedDescription: ''
          });
        }
      } catch (err) {
        AM.log(2, `Error indexing pack ${pack.collection}:`, err);
      }
    }

    return docs;
  }

  /**
   * Group documents by their compendium pack name for organised dropdowns.
   * If all docs come from a single pack, returns them ungrouped (one group, no label).
   */
  static #organiseByPack(docs, _type) {
    if (!docs.length) return [];
    docs.sort((a, b) => a.name.localeCompare(b.name));

    const byPack = new Map();
    for (const doc of docs) {
      if (!byPack.has(doc.packName)) byPack.set(doc.packName, []);
      byPack.get(doc.packName).push(doc);
    }

    if (byPack.size === 1) {
      // Single source — show flat list with no folder label
      return [{ folderName: '', docs }];
    }

    return [...byPack.entries()].map(([packName, packDocs]) => ({
      folderName: packName,
      docs: packDocs
    }));
  }

  /* --------------------------------------------------------
     Description loader (called on dropdown change)
     -------------------------------------------------------- */

  /**
   * Fetch and enrich the description of a single compendium item by UUID.
   * @param {string} uuid
   * @returns {Promise<string>} Enriched HTML string
   */
  static async getEnrichedDescription(uuid) {
    try {
      const doc = await fromUuid(uuid);
      if (!doc) return '';
      const raw = doc.system?.description?.value ?? doc.system?.description ?? '';
      return await TextEditor.enrichHTML(raw, { async: true, relativeTo: doc });
    } catch (err) {
      AM.log(2, `Error loading description for ${uuid}:`, err);
      return '';
    }
  }

  /**
   * Fetch the full Item document by UUID.
   * @param {string} uuid
   * @returns {Promise<Item|null>}
   */
  static async getItemByUuid(uuid) {
    try {
      return await fromUuid(uuid);
    } catch {
      return null;
    }
  }
}
