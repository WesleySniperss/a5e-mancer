import { AM } from '../a5e-mancer.js';
import { iconForItem, applyItemIcon } from '../data/a5eIcons.js';

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
 * Combat-maneuver progression per class. Verified by parsing each class's table on
 * a5e.tools (the "Maneuvers Known" + "Maneuver Degree" columns) and the "Combat
 * Maneuvers" feature text for the tradition list. In A5e every maneuver class gains
 * proficiency in TWO combat traditions; `allowedTraditions` lists which traditions
 * the class may choose (camelCase keys matching CONFIG.A5E.maneuverTraditions), or
 * null when the class may pick ANY tradition.
 *
 * Arrays are indexed by CLASS level (index 0 unused / padding):
 *   maneuversKnown[lvl] — cumulative maneuvers known at that level
 *   maxDegree[lvl]      — highest maneuver degree the class can select
 */
export const CLASS_MANEUVER_TABLES = {
  fighter: {
    traditions: 2, allowedTraditions: null, // any tradition of your choice
    maneuversKnown: [0, 3, 4, 4, 5, 6, 7, 7, 8, 9, 10, 10, 11, 12, 13, 13, 14, 15, 16, 16, 17],
    maxDegree:      [0, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 5]
  },
  berserker: {
    traditions: 2, allowedTraditions: ['adamantMountain', 'mirrorsGlint', 'rapidCurrent', 'temperedIron', 'toothAndClaw'],
    maneuversKnown: [0, 0, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11],
    maxDegree:      [0, 0, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 4, 4, 4, 4, 4, 5, 5, 5, 5]
  },
  ranger: {
    traditions: 2, allowedTraditions: ['bitingZephyr', 'mirrorsGlint', 'rapidCurrent', 'razorsEdge', 'spiritedSteed', 'unendingWheel'],
    maneuversKnown: [0, 0, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11],
    maxDegree:      [0, 0, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5]
  },
  herald: {
    traditions: 2, allowedTraditions: ['sanguineKnot', 'spiritedSteed', 'temperedIron'],
    maneuversKnown: [0, 0, 2, 2, 3, 3, 3, 4, 4, 4, 5, 5, 5, 6, 6, 6, 7, 7, 7, 8, 8],
    maxDegree:      [0, 0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3, 4, 4]
  },
  marshal: {
    traditions: 2, allowedTraditions: ['bitingZephyr', 'mirrorsGlint', 'mistAndShade', 'rapidCurrent', 'razorsEdge', 'sanguineKnot', 'spiritedSteed', 'unendingWheel'],
    maneuversKnown: [0, 0, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11],
    maxDegree:      [0, 0, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 5]
  },
  adept: {
    traditions: 2, allowedTraditions: ['mirrorsGlint', 'rapidCurrent', 'razorsEdge', 'unendingWheel'],
    maneuversKnown: [0, 0, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10],
    maxDegree:      [0, 0, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5]
  },
  rogue: {
    traditions: 2, allowedTraditions: ['bitingZephyr', 'mistAndShade', 'rapidCurrent'],
    maneuversKnown: [0, 0, 2, 2, 3, 3, 3, 4, 4, 4, 5, 5, 5, 6, 6, 6, 7, 7, 7, 8, 8],
    maxDegree:      [0, 0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3, 4, 4]
  },
  psyknight: {
    traditions: 2, allowedTraditions: ['aceStarfighter', 'blazingStarglaive', 'mindfulBody', 'mirrorsGlint', 'rapidCurrent', 'razorsEdge', 'toothAndClaw'],
    maneuversKnown: [0, 0, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11],
    maxDegree:      [0, 0, 1, 1, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 4, 4, 5]
  },
  trooper: {
    traditions: 2, allowedTraditions: null, // any tradition of your choice
    maneuversKnown: [0, 0, 2, 2, 3, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10],
    maxDegree:      [0, 0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3, 4, 4]
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
            img:             iconForItem(entry.name, 'maneuver') ?? entry.img,
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
      allowedTraditions: table.allowedTraditions ?? null, // null = any tradition
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
        applyItemIcon(data);
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
