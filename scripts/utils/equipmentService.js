import { AM } from '../a5e-mancer.js';

/**
 * Handles starting equipment and wealth for a5e character creation.
 *
 * In a5e, starting equipment is stored via the grant system:
 *  - Class/Background items have `system.grants` (an object keyed by grant ID)
 *  - Equipment grants have `grantType: "item"` with:
 *    - `items.base[]`    — mandatory items (each has { uuid, quantityOverride })
 *    - `items.options[]` — choosable items (same shape)
 *    - `items.total`     — how many to pick from options
 *  - Starting wealth is `system.wealth` (a dice formula string like "5d4*10")
 */
export class EquipmentService {

  /* --------------------------------------------------------
     Heritage Gift loading
     -------------------------------------------------------- */

  /**
   * Given a heritage item UUID, find all available Heritage Gifts for it.
   * In a5e, heritage grants are stored in `system.grants` as an object
   * keyed by grant ID. We look for feature grants (optional ones are gifts).
   *
   * @param {string} heritageUuid
   * @returns {Promise<Array<{uuid, name, description}>>}
   */
  static async loadHeritageGifts(heritageUuid) {
    if (!heritageUuid) return [];
    try {
      const heritage = await fromUuid(heritageUuid);
      if (!heritage) return [];

      const grants = heritage.system?.grants;
      if (!grants) return [];

      // grants is an object keyed by grant ID
      const grantEntries = (grants instanceof Map)
        ? [...grants.values()]
        : Object.values(grants);

      const results = [];
      for (const grant of grantEntries) {
        if (grant.grantType !== 'feature') continue;

        // Collect features from base and options arrays
        const featureUuids = [
          ...(grant.features?.base ?? []),
          ...(grant.features?.options ?? [])
        ];

        for (const entry of featureUuids) {
          const uuid = entry?.uuid ?? entry;
          if (!uuid) continue;
          try {
            const doc = await fromUuid(uuid);
            if (doc) results.push({
              id: doc.id,
              uuid,
              name: doc.name,
              description: doc.system?.description?.value ?? doc.system?.description ?? ''
            });
          } catch {}
        }
      }

      if (results.length) return results;

      // Fallback: scan compendiums for feature items that match the heritage
      return await this.#scanForHeritageGifts(heritage);

    } catch (err) {
      AM.log(2, 'Error loading heritage gifts:', err);
      return [];
    }
  }

  /**
   * Scan item compendiums for feature-type items whose name or system data
   * references the given heritage.
   */
  static async #scanForHeritageGifts(heritage) {
    const heritageName = heritage.name.toLowerCase();
    const packId = heritage.pack; // e.g. "a5e.a5e-heritages"
    const results = [];

    // Prefer the same pack first, then all item packs
    const packs = [
      ...(packId ? [game.packs.get(packId)].filter(Boolean) : []),
      ...game.packs.filter(p => p.metadata.type === 'Item' && p.collection !== packId)
    ];

    for (const pack of packs) {
      try {
        const index = await pack.getIndex({ fields: ['name', 'type', 'system'] });
        for (const entry of index) {
          if (entry.type !== 'feature') continue;
          const entryName = entry.name.toLowerCase();

          const isGift = entryName.includes('heritage gift') ||
                         entryName.includes('gift:') ||
                         (entryName.includes(heritageName) &&
                           (entryName.includes('gift') || entryName.includes('trait')));

          const sysHeritage = entry.system?.prerequisites?.heritage ?? entry.system?.heritage ?? '';
          const matchesHeritage = sysHeritage &&
            (sysHeritage.toLowerCase().includes(heritageName) ||
             heritageName.includes(sysHeritage.toLowerCase()));

          if (isGift || matchesHeritage) {
            results.push({
              id:   entry._id,
              uuid: `Compendium.${pack.collection}.${entry._id}`,
              name: entry.name,
              description: entry.system?.description?.value ?? ''
            });
          }
        }
        if (results.length >= 3) break;
      } catch (err) {
        AM.log(2, `Error scanning pack ${pack.collection} for gifts:`, err);
      }
    }

    return results;
  }

  /* --------------------------------------------------------
     Starting Equipment loading (a5e grant system)
     -------------------------------------------------------- */

  /**
   * Load starting equipment options from a class or background item.
   * In a5e, these are stored as grants with grantType "item".
   *
   * @param {string} uuid  – UUID of class or background item
   * @param {'class'|'background'} sourceType
   * @returns {Promise<EquipmentPackage>}
   */
  static async loadStartingEquipment(uuid, sourceType) {
    if (!uuid) return { fixed: [], choices: [], raw: '' };
    try {
      const item = await fromUuid(uuid);
      if (!item) return { fixed: [], choices: [], raw: '' };

      const grants = item.system?.grants;
      if (grants) {
        const result = await this.#parseGrantEquipment(grants, item.name);
        if (result.fixed.length || result.choices.length) return result;
      }

      // Fallback: extract from description text
      const desc = item.system?.description?.value ?? item.system?.description ?? '';
      if (desc) {
        return this.#parseEquipmentFromDescription(desc, sourceType, item.name);
      }

      return { fixed: [], choices: [], raw: '', sourceName: item.name };
    } catch (err) {
      AM.log(2, `Error loading ${sourceType} equipment from ${uuid}:`, err);
      return { fixed: [], choices: [], raw: '' };
    }
  }

  /**
   * Parse equipment from a5e's grant system.
   * Grants is an object keyed by ID; we look for grantType === "item".
   */
  static async #parseGrantEquipment(grants, sourceName) {
    const fixed = [];
    const choices = [];

    const grantEntries = (grants instanceof Map)
      ? [...grants.values()]
      : Object.values(grants);

    for (const grant of grantEntries) {
      if (grant.grantType !== 'item') continue;

      // Fixed/mandatory items (items.base)
      for (const entry of (grant.items?.base ?? [])) {
        const entryUuid = entry?.uuid ?? entry;
        if (!entryUuid) continue;
        const qty = entry?.quantityOverride || 1;
        try {
          const doc = await fromUuid(entryUuid);
          const isContainer = doc?.system?.objectType === 'container';
          fixed.push({
            name:      doc?.name ?? 'Unknown Item',
            uuid:      entryUuid,
            qty,
            isContainer,
            contents:  isContainer ? await this.#getContainerContents(doc) : null
          });
        } catch {
          fixed.push({ name: 'Unknown Item', uuid: entryUuid, qty });
        }
      }

      // Choice items (items.options) — player picks items.total from these
      const options = grant.items?.options ?? [];
      if (options.length) {
        const total = grant.items?.total ?? 1;
        const opts = [];
        for (const entry of options) {
          const entryUuid = entry?.uuid ?? entry;
          if (!entryUuid) continue;
          const qty = entry?.quantityOverride || 1;
          try {
            const doc = await fromUuid(entryUuid);
            const isContainer = doc?.system?.objectType === 'container';
            opts.push({
              name:      doc?.name ?? 'Unknown Item',
              uuid:      entryUuid,
              qty,
              isContainer,
              contents:  isContainer ? await this.#getContainerContents(doc) : null
            });
          } catch {
            opts.push({ name: 'Unknown Item', uuid: entryUuid, qty });
          }
        }
        if (opts.length) {
          choices.push({ options: opts, selected: 0, total });
        }
      }
    }

    return { fixed, choices, raw: '', sourceName };
  }

  /**
   * Extract container contents from a container item.
   * A5e stores pack contents either as sub-items or in the description.
   * Returns an array of { name, qty } or null.
   */
  static async #getContainerContents(containerDoc) {
    if (!containerDoc) return null;
    // Try system.items (some versions store contents here)
    const sysItems = containerDoc.system?.items;
    if (sysItems && typeof sysItems === 'object') {
      const entries = Object.values(sysItems);
      if (entries.length) {
        return entries.map(e => ({
          name: e.name ?? 'Unknown',
          qty:  e.quantity ?? e.quantityOverride ?? 1
        }));
      }
    }
    // Fall back to parsing the description
    const desc = containerDoc.system?.description?.value ?? '';
    if (!desc) return null;
    const text = desc.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    // Look for bullet-list style contents: "• Item name" or "- Item name" or "* Item"
    const lines = text.split(/[•\-\*\n]/).map(l => l.trim()).filter(l => l.length > 2 && l.length < 60);
    if (lines.length >= 2) return lines.slice(0, 12).map(l => ({ name: l, qty: 1 }));
    return null;
  }

  static #parseEquipmentFromDescription(desc, sourceType, sourceName) {
    const text = desc.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

    const equipIdx = text.search(/\bequipment\b|\bstarting gear\b|\bstarting equipment\b/i);
    if (equipIdx === -1) return { fixed: [], choices: [], raw: '', sourceName };

    const raw = text.slice(equipIdx, equipIdx + 800).split(/\b(proficien|skill|tool|feature|background)\b/i)[0];

    return { fixed: [], choices: [], raw: raw.trim(), sourceName };
  }

  /* --------------------------------------------------------
     Starting Wealth
     -------------------------------------------------------- */

  /**
   * Get the starting wealth formula from a class item.
   * In a5e, wealth is stored directly as `system.wealth` (a string formula).
   *
   * @param {string} classUuid
   * @returns {Promise<string|null>} dice formula like "5d4*10" or null
   */
  static async getStartingWealthFormula(classUuid) {
    if (!classUuid) return null;
    try {
      const item = await fromUuid(classUuid);
      if (!item) return null;

      const sys = item.system;
      // a5e stores wealth as a plain string on system.wealth
      if (typeof sys?.wealth === 'string' && sys.wealth.trim()) {
        return sys.wealth.trim();
      }
      // Fallbacks for other possible locations
      return sys?.startingWealth?.formula
          ?? sys?.wealth?.formula
          ?? sys?.startingWealth
          ?? this.#extractWealthFromDescription(sys?.description?.value ?? '');
    } catch {
      return null;
    }
  }

  static #extractWealthFromDescription(desc) {
    if (!desc) return null;
    const text = desc.replace(/<[^>]+>/g, ' ');
    const m = text.match(/(\d+d\d+[\s×x*]\s*\d+)\s*(?:gp|gold|coins?)/i)
           ?? text.match(/(\d+d\d+)\s*(?:gp|gold)/i);
    return m ? m[1].replace(/\s/g, '') : null;
  }

  /**
   * Roll a starting wealth formula and return gold amount.
   * @param {string} formula
   * @returns {Promise<number>}
   */
  static async rollWealth(formula) {
    try {
      const normalized = formula.replace(/[×x]/g, '*').replace(/\s/g, '');
      const roll = new Roll(normalized);
      await roll.evaluate();
      return Math.floor(roll.total);
    } catch (err) {
      AM.log(2, 'Error rolling wealth:', err);
      return 0;
    }
  }

  /**
   * Apply gold to an actor's currency.
   * @param {Actor} actor
   * @param {number} gold
   */
  static async applyWealthToActor(actor, gold) {
    if (!gold || gold <= 0) return;
    try {
      await actor.update({ 'system.currency.gp': gold });
    } catch {
      try {
        await actor.update({ 'system.wealth.gp': gold });
      } catch (err) {
        AM.log(2, 'Could not set actor wealth:', err);
      }
    }
  }
}
