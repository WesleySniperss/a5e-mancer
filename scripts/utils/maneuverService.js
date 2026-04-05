import { AM } from '../a5e-mancer.js';

/**
 * Fallback tradition keys (camelCase, matching system data) used when CONFIG.A5E is unavailable.
 */
export const TRADITION_KEYS = [
  'aceStarfighter', 'adamantMountain', 'arcaneArtillery', 'arcaneKnight',
  'awakenedMind', 'beastUnity', 'bitingZephyr', 'blazingStarglaive',
  'comedicJabs', 'cuttingOmen', 'eldritchBlackguard', 'gallantHeart',
  'grindingCog', 'mindfulBody', 'mirrorsGlint', 'mistAndShade',
  'rapidCurrent', 'razorsEdge', 'sanctifiedSteel', 'sanguineKnot',
  'selflessSentinel', 'spiritedSteed', 'temperedIron', 'toothAndClaw',
  'unendingWheel', 'viciousVein', 'vipersFangs'
];

/**
 * Returns [{key, label}] for all combat traditions, sourced from CONFIG.A5E at runtime.
 */
export function getTraditions() {
  const config = CONFIG?.A5E?.maneuverTraditions;
  if (config) {
    return Object.entries(config).map(([key, i18nKey]) => ({
      key,
      label: game.i18n.localize(i18nKey)
    })).sort((a, b) => a.label.localeCompare(b.label));
  }
  // Fallback: camelCase → title case (imperfect but functional)
  return TRADITION_KEYS.map(key => ({
    key,
    label: key.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase())
  }));
}

// Keep for backwards compat (used by ManeuverDialog allowedTraditions)
export const TRADITIONS = TRADITION_KEYS;

/**
 * Which classes get combat maneuvers and their progression table.
 * Format: { traditions: n, maneuversKnown: [by level], maxDegree: [by level] }
 *
 * Classes confirmed to get maneuvers in a5e:
 *   Fighter, Berserker (Barbarian), Ranger, Herald (Paladin), Rogue (some archetypes)
 *   Warlord, Marshal — full maneuver classes
 */
export const CLASS_MANEUVER_TABLES = {
  // Fighter: 2 traditions at 1st, gains more with Maneuver Specialization
  fighter: {
    traditions: 2,
    maneuversKnown: [0, 2, 3, 4, 4, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13],
    maxDegree:      [0, 1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 4, 5, 5, 5, 5, 5, 5, 5, 5]
  },
  // Berserker (Barbarian equivalent)
  berserker: {
    traditions: 1,
    maneuversKnown: [0, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 6, 7, 7, 7, 8, 8, 8, 9, 9, 9],
    maxDegree:      [0, 1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 4, 5, 5, 5, 5, 5, 5, 5, 5]
  },
  // Ranger
  ranger: {
    traditions: 1,
    maneuversKnown: [0, 0, 0, 2, 2, 3, 3, 4, 4, 5, 5, 5, 6, 6, 6, 7, 7, 7, 8, 8, 8],
    maxDegree:      [0, 0, 0, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 4, 5, 5, 5, 5, 5, 5, 5]
  },
  // Herald (Paladin equivalent)
  herald: {
    traditions: 1,
    maneuversKnown: [0, 0, 0, 2, 2, 3, 3, 4, 4, 5, 5, 5, 6, 6, 6, 7, 7, 7, 8, 8, 8],
    maxDegree:      [0, 0, 0, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 4, 5, 5, 5, 5, 5, 5, 5]
  },
  // Warlord — all maneuvers, full progression
  warlord: {
    traditions: 2,
    maneuversKnown: [0, 2, 3, 4, 4, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13],
    maxDegree:      [0, 1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 4, 5, 5, 5, 5, 5, 5, 5, 5]
  }
};

export class ManeuverService {

  /**
   * Load all maneuver items from compendiums, grouped by tradition and degree.
   * @returns {Promise<Map<string, Map<number, Array>>>}
   *   tradition → degree → maneuver[]
   */
  static async loadAllManeuvers() {
    // Build a label lookup: camelCase key → localized display name
    const tradConfig = CONFIG?.A5E?.maneuverTraditions ?? {};
    const labelOf = (key) => {
      if (!key) return '';
      const i18nKey = tradConfig[key];
      if (i18nKey) return game.i18n.localize(i18nKey);
      // Fallback: camelCase → spaced title case
      return key.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase());
    };

    const byTradition = new Map();
    // Pre-seed known traditions
    for (const key of Object.keys(tradConfig).length ? Object.keys(tradConfig) : TRADITION_KEYS) {
      byTradition.set(key, new Map());
    }

    const packs = game.packs.filter(p => p.metadata.type === 'Item');
    for (const pack of packs) {
      try {
        const index = await pack.getIndex({
          fields: ['name', 'type', 'img', 'system']
        });
        for (const entry of index) {
          if (entry.type !== 'maneuver') continue;

          // tradition is a camelCase key in the data
          const tradition = entry.system?.tradition ?? entry.system?.combatTradition ?? '';
          const degree = parseInt(
            entry.system?.degree ?? entry.system?.maneuverDegree ?? 1
          ) || 1;
          const exertion = entry.system?.exertionCost
            ?? entry.system?.cost
            ?? entry.system?.activation?.cost
            ?? 0;

          const maneuver = {
            id:              entry._id,
            name:            entry.name,
            img:             entry.img,
            uuid:            `Compendium.${pack.collection}.${entry._id}`,
            tradition,                 // camelCase key for filtering
            traditionLabel:  labelOf(tradition), // localized for display
            degree,
            exertion,
            description: entry.system?.description?.value ?? entry.system?.description ?? ''
          };

          if (!byTradition.has(tradition)) {
            byTradition.set(tradition, new Map());
          }
          const tradMap = byTradition.get(tradition);
          if (!tradMap.has(degree)) tradMap.set(degree, []);
          tradMap.get(degree).push(maneuver);
        }
      } catch (err) {
        AM.log(2, `Error loading maneuvers from ${pack.collection}:`, err);
      }
    }

    // Sort within each bucket
    for (const tradMap of byTradition.values()) {
      for (const [deg, maneuvers] of tradMap) {
        tradMap.set(deg, maneuvers.sort((a, b) => a.name.localeCompare(b.name)));
      }
    }

    return byTradition;
  }

  /**
   * Get maneuver table info for a class at a given level.
   */
  static getClassManeuverInfo(className, level) {
    const key = className.toLowerCase();
    const table = CLASS_MANEUVER_TABLES[key];
    if (!table) return null;

    const lvl          = Math.max(1, Math.min(20, level));
    const maneuversKnown = table.maneuversKnown[lvl] ?? 0;
    // Return null when the class has no maneuvers at this level (e.g. Ranger/Herald at level 1)
    if (maneuversKnown === 0) return null;
    return {
      traditions:  table.traditions,
      maneuversKnown,
      maxDegree:   table.maxDegree[lvl] ?? 0
    };
  }

  /**
   * Get currently known maneuvers on an actor (items of type maneuver).
   */
  static getActorManeuvers(actor) {
    const tradConfig = CONFIG?.A5E?.maneuverTraditions ?? {};
    return actor.items
      .filter(i => i.type === 'maneuver')
      .map(i => {
        const tradition = i.system?.tradition ?? i.system?.combatTradition ?? '';
        const i18nKey   = tradConfig[tradition];
        const traditionLabel = i18nKey
          ? game.i18n.localize(i18nKey)
          : tradition.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase());
        return {
          id:   i.id,
          name: i.name,
          img:  i.img,
          tradition,
          traditionLabel,
          degree: parseInt(i.system?.degree ?? i.system?.maneuverDegree ?? 1) || 1
        };
      });
  }

  /**
   * Get combat traditions the actor is proficient in.
   * Tries several possible data paths.
   */
  static getActorTraditions(actor) {
    const sys = actor.system;
    // Possible paths in different a5e versions
    const raw = sys?.proficiencies?.combatTraditions
      ?? sys?.combatTraditions
      ?? sys?.maneuvers?.traditions
      ?? [];
    return Array.isArray(raw) ? raw : [];
  }

  /**
   * Add selected maneuvers to actor and update tradition proficiencies.
   */
  static async applyManeuversToActor(actor, maneuverUuids, newTraditions = []) {
    if (!maneuverUuids.length && !newTraditions.length) return;

    const itemDatas = [];
    for (const uuid of maneuverUuids) {
      try {
        const item = await fromUuid(uuid);
        if (!item) continue;
        const data = item.toObject();
        data._stats = data._stats || {};
        data._stats.compendiumSource = uuid;
        itemDatas.push(data);
      } catch (err) {
        AM.log(2, `Error fetching maneuver ${uuid}:`, err);
      }
    }

    if (itemDatas.length) {
      await actor.createEmbeddedDocuments('Item', itemDatas);
      AM.log(3, `Added ${itemDatas.length} maneuvers`);
    }

    // Update tradition proficiencies if actor has that field
    if (newTraditions.length) {
      const existing = this.getActorTraditions(actor);
      const merged   = [...new Set([...existing, ...newTraditions])];
      const paths = [
        'system.proficiencies.combatTraditions',
        'system.combatTraditions',
        'system.maneuvers.traditions'
      ];
      for (const path of paths) {
        try {
          await actor.update({ [path]: merged });
          AM.log(3, `Updated traditions at ${path}`);
          break;
        } catch {}
      }
    }
  }

}
