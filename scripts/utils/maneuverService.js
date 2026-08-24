import { AM } from '../a5e-mancer.js';
import { PackFilter } from './packFilter.js';
import { MM_SCHOOLS, MM_CLASSES, MM_PROGRESSION } from '../data/magicManeuvers.js';
import { iconForItem, applyItemIcon } from '../data/a5eIcons.js';
import { castOnlyEffects } from './effectTiming.js';

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
/**
 * Magic maneuvers are maneuvers. The only thing that sets them apart is who may
 * take them, so they are described the same way everything else here is: a class
 * table whose allowed traditions are the six schools.
 *
 * Everything downstream — the management dialog, the level-up picker, trading one
 * in, the description panel, the chat card — then treats them exactly like a
 * fighter's, because they go through the same code. The previous version built a
 * parallel set of all of that, which is why they looked and behaved differently.
 *
 * Built from MM_PROGRESSION, which states thresholds; the rows between a
 * threshold and the next repeat it.
 */
function magicManeuverTable() {
  const known = new Array(21).fill(0);
  const degree = new Array(21).fill(0);
  let schools = 0;

  for (let lvl = 1; lvl <= 20; lvl++) {
    let row = null;
    for (const entry of MM_PROGRESSION) if (entry.level <= lvl) row = entry;
    known[lvl]  = row?.known ?? 0;
    degree[lvl] = row?.maxDegree ?? 0;
    schools = Math.max(schools, row?.schools ?? 0);
  }
  return {
    traditions: schools,
    allowedTraditions: Object.keys(MM_SCHOOLS),
    maneuversKnown: known,
    maxDegree: degree,
    magic: true
  };
}

export const CLASS_MANEUVER_TABLES = {
  fighter: {
    // Explicit rather than null: once the schools are registered as traditions,
    // "any tradition" would have let a fighter take magic maneuvers.
    traditions: 2, allowedTraditions: [...TRADITION_KEYS],
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
    traditions: 2, allowedTraditions: [...TRADITION_KEYS], // any combat tradition, not the magic schools
    maneuversKnown: [0, 0, 2, 2, 3, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10],
    maxDegree:      [0, 0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3, 4, 4]
  }
};

// The homebrew casters take their maneuvers from the schools, on the schools'
// own progression. Same table shape, same code path, same everything.
for (const cls of MM_CLASSES) CLASS_MANEUVER_TABLES[cls] = magicManeuverTable();

/**
 * Make the six schools first-class traditions.
 *
 * Everything in this module and in ManeuverDialog reads tradition labels from
 * CONFIG.A5E.maneuverTraditions, so registering them there is what makes a magic
 * maneuver render, group, sort and read exactly like a combat one. Called once
 * on setup; the labels are the school names, already localized in the data.
 */
export function registerMagicSchools() {
  CONFIG.A5E ??= {};
  CONFIG.A5E.maneuverTraditions ??= {};
  for (const [key, label] of Object.entries(MM_SCHOOLS)) {
    // The config holds i18n keys elsewhere; a literal label localizes to itself
    CONFIG.A5E.maneuverTraditions[key] ??= label;
  }
}

/** Is this tradition key one of the magic schools? */
export function isMagicSchool(key) {
  return Object.hasOwn(MM_SCHOOLS, key);
}

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

    const packs = PackFilter.itemPacks();
    for (const pack of packs) {
      try {
        // flags is needed for the magic-maneuver check below — the index omits
        // it unless asked, so without it every one of them would slip through.
        const index = await pack.getIndex({
          fields: ['name', 'type', 'img', 'system', 'flags']
        });
        for (const entry of index) {
          if (entry.type !== 'maneuver') continue;
          // Magic maneuvers are not filtered out: their school IS their tradition,
          // so they load, group and display through this same path. Which class
          // may take them is decided by allowedTraditions, as for every other
          // maneuver — that is the only difference the rules actually state.

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
            img:             iconForItem(entry.name, 'maneuver', entry.img ?? '') ?? entry.img,
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
   * How many known maneuvers may be swapped out when a level in this class is
   * gained. A5e's Combat Maneuvers feature reads "whenever you gain a level in
   * this class, you can replace one maneuver you know with another", so it is one
   * per level for every class that has maneuvers at all.
   */
  static MANEUVER_REPLACEMENTS_PER_LEVEL = 1;

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
      maxDegree:   table.maxDegree[lvl] ?? 0,
      // Only when a level is actually being gained — not at character creation
      replaceable: lvl > 1 ? this.MANEUVER_REPLACEMENTS_PER_LEVEL : 0
    };
  }

  /**
   * Every maneuver item on the actor, magic and combat alike.
   *
   * These used to be told apart so magic ones would not eat the combat budget.
   * They no longer need to be: a caster's budget comes from their own class
   * table, and a maneuver counts against whichever class allows its tradition.
   * Keeping them separate was what made them look and behave like a second,
   * unrelated system.
   */
  static isManeuver(item) {
    return item?.type === 'maneuver';
  }

  /** A maneuver that came from a class's allowance, so it counts against it. */
  static isChosenManeuver(item) {
    return this.isManeuver(item) && !this.isBasicManeuver(item);
  }

  /**
   * Was this maneuver handed out by a grant rather than chosen?
   *
   * a5e records the items a feature grant produced in `documentIds` on the grant
   * itself, so anything listed there arrived as part of a class feature. Those
   * must not be offered as level-up trade-ins: swapping one away deletes a class
   * ability and leaves its grant pointing at an item that no longer exists.
   */
  /**
   * A basic maneuver — Overrun, Grapple, Disarm, Grab On, Shove, Knockdown.
   *
   * a5e marks them degree 0 with no tradition, and every character has them at
   * all times. They are not picks, so they must not appear as level-up trade-ins
   * and must not count against a class's maneuvers known.
   */
  static isBasicManeuver(item) {
    if (item?.type !== 'maneuver') return false;
    const degree = Number(item.system?.degree ?? item.system?.maneuverDegree ?? NaN);
    const tradition = item.system?.tradition ?? item.system?.combatTradition ?? '';
    return degree === 0 && !tradition;
  }

  static isGrantedManeuver(actor, itemId) {
    if (!actor || !itemId) return false;
    const grants = actor.system?.grants ?? {};
    const all = grants instanceof Map ? [...grants.values()] : Object.values(grants);
    return all.some(g => {
      const ids = g?.documentIds ?? [];
      return Array.isArray(ids) ? ids.includes(itemId) : false;
    });
  }

  /**
   * Get currently known maneuvers on an actor (items of type maneuver).
   */
  static getActorManeuvers(actor) {
    const tradConfig = CONFIG?.A5E?.maneuverTraditions ?? {};
    return actor.items
      .filter(i => this.isManeuver(i))
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
          basic: this.isBasicManeuver(i),
          degree: parseInt(i.system?.degree ?? i.system?.maneuverDegree ?? 1) || 1
        };
      });
  }

  /**
   * Identifiers for every maneuver the actor already has, so no picker can offer
   * one twice. Foundry v12 replaced flags.core.sourceId with _stats.compendiumSource;
   * reading only the old path silently returned an empty set and every known
   * maneuver stayed selectable. The lowercased name is a fallback for items that
   * were imported or hand-made and carry no source at all.
   * @returns {Set<string>} compendium UUIDs and lowercased names
   */
  static getActorManeuverKeys(actor) {
    const keys = new Set();
    if (!actor) return keys;
    for (const item of actor.items) {
      if (!this.isManeuver(item)) continue;
      const src = item._stats?.compendiumSource ?? item.flags?.core?.sourceId ?? '';
      if (src) keys.add(src);
      keys.add(item.name.toLowerCase());
    }
    return keys;
  }

  /** True when this maneuver is already on the actor (by source UUID or name). */
  static isKnown(knownKeys, maneuver) {
    if (!knownKeys?.size || !maneuver) return false;
    return knownKeys.has(maneuver.uuid) || knownKeys.has((maneuver.name ?? '').toLowerCase());
  }

  /**
   * What the actor is entitled to across all their maneuver classes, at their
   * current levels — the totals the class tables promise, not an open bar.
   * @returns {{maneuversKnown:number, traditions:number, maxDegree:number,
   *            allowedTraditions:string[]|null, knownCount:number,
   *            remainingManeuvers:number, remainingTraditions:number}|null}
   */
  static getActorEntitlement(actor) {
    if (!actor) return null;

    let maneuversKnown = 0, traditions = 0, maxDegree = 0;
    let allowedTraditions = [];
    let anyClassAllowsAll = false;
    let found = false;

    for (const item of actor.items) {
      if (item.type !== 'class') continue;
      const level = item.system?.classLevels ?? item.system?.levels ?? item.system?.level ?? 1;
      const info  = this.getClassManeuverInfo(item.name, level);
      if (!info) continue;
      found = true;
      maneuversKnown += info.maneuversKnown;
      traditions     += info.traditions;
      maxDegree       = Math.max(maxDegree, info.maxDegree);
      if (info.allowedTraditions === null) anyClassAllowsAll = true;
      else allowedTraditions.push(...info.allowedTraditions);
    }
    if (!found) return null;

    const knownCount      = actor.items.filter(i => this.isChosenManeuver(i)).length;
    const knownTraditions = this.getActorTraditions(actor).length;

    return {
      maneuversKnown,
      traditions,
      maxDegree,
      allowedTraditions: anyClassAllowsAll ? null : [...new Set(allowedTraditions)],
      knownCount,
      knownTraditions,
      remainingManeuvers:  Math.max(0, maneuversKnown - knownCount),
      remainingTraditions: Math.max(0, traditions - knownTraditions)
    };
  }

  /**
   * Get combat traditions the actor is proficient in.
   * Tries several possible data paths.
   */
  static getActorTraditions(actor) {
    const sys = actor.system;
    // A5e stores known combat traditions at system.proficiencies.traditions
    // (an ArrayField of camelCase tradition keys). The others are version fallbacks.
    const raw = sys?.proficiencies?.traditions
      ?? sys?.proficiencies?.combatTraditions
      ?? sys?.combatTraditions
      ?? sys?.maneuvers?.traditions
      ?? [];
    return Array.isArray(raw) ? raw : [...(raw ?? [])];
  }

  /**
   * Add selected maneuvers to actor and update tradition proficiencies.
   *
   * Skips anything the actor already has. Without this, a maneuver picked in one
   * window and then offered again by a later one (level-up → a5e's own grant
   * dialog → sheet management) landed on the sheet twice.
   */
  static async applyManeuversToActor(actor, maneuverUuids, newTraditions = []) {
    if (!maneuverUuids.length && !newTraditions.length) return;

    const known = this.getActorManeuverKeys(actor);

    const itemDatas = [];
    for (const uuid of maneuverUuids) {
      if (known.has(uuid)) continue;                 // exact source match
      try {
        const item = await fromUuid(uuid);
        if (!item) continue;
        if (known.has(item.name.toLowerCase())) continue; // name fallback
        const data = item.toObject();
        data._stats = data._stats || {};
        data._stats.compendiumSource = uuid;
        applyItemIcon(data);
        // A known maneuver costs exertion to use; until then it does nothing.
        // Same guard as spells — see effectTiming.
        const retimed = castOnlyEffects(data);
        if (retimed.length) {
          AM.log(2, `${item.name}: effect(s) ${retimed.join(', ')} would have applied on ownership `
                  + `— retimed to fire on use`);
        }
        itemDatas.push(data);
        known.add(uuid);
        known.add(item.name.toLowerCase());          // also blocks within-batch dupes
      } catch (err) {
        AM.log(2, `Error fetching maneuver ${uuid}:`, err);
      }
    }

    if (itemDatas.length) {
      await actor.createEmbeddedDocuments('Item', itemDatas);
      AM.log(3, `Added ${itemDatas.length} maneuvers`);
    }

    // Update tradition proficiencies. A5e reads them from
    // system.proficiencies.traditions (ArrayField of tradition keys); writing
    // anywhere else leaves the sheet showing no traditions.
    if (newTraditions.length) {
      const existing = this.getActorTraditions(actor);
      const merged   = [...new Set([...existing, ...newTraditions])];
      try {
        await actor.update({ 'system.proficiencies.traditions': merged });
        AM.log(3, 'Updated combat traditions');
      } catch (err) {
        AM.log(2, 'Could not update combat traditions:', err);
      }
    }
  }

}
