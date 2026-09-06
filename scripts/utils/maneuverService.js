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
//
// Who they are is MM_CLASSES in magicManeuversData.js and nowhere else, so
// editing that list is all it takes to change who gets them. Names are put
// through the same normaliser MagicManeuvers.isEligibleClass uses, so an entry
// written 'Psion' or 'Psy Knight' works as well as a bare lowercase one —
// a list meant to be edited should not fail over a capital letter.
export const mmKey = (name) => String(name ?? '').toLowerCase().replace(/[^a-z]/g, '');
export const MM_KEYS = new Set(MM_CLASSES.map(mmKey));

for (const cls of MM_KEYS) CLASS_MANEUVER_TABLES[cls] = magicManeuverTable();

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
        const index = await PackFilter.indexOf(pack,
          ['name', 'type', 'img', 'system', 'flags']);
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
  /* ── The book's own progression tables ─────────────────────────────────

     Every a5e class ships its progression table inside its description, as
     real HTML: Level | Prof. Bonus | Features | … | Maneuvers Known |
     Maneuver Degree. That is the same table the hardcoded CLASS_MANEUVER_
     TABLES above were copied out of by hand — so the copy could only ever
     cover the classes someone had got around to typing in, and could be
     wrong where they mistyped. It was nine classes; the books installed here
     describe fourteen with maneuvers, and any third-party class laying its
     table out the same way comes along for free.

     Read at ready and folded into CLASS_MANEUVER_TABLES under the class name,
     so every caller that already asks by name gets the book's numbers without
     knowing this exists. */

  /** Text of an HTML cell, entities and tags gone. */
  static #cellText(html) {
    return String(html ?? '')
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&[a-z]+;/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  static #rowCells(rowHtml) {
    return [...rowHtml.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)]
      .map(m => this.#cellText(m[1]));
  }

  /**
   * Pull the maneuver columns out of a class description.
   *
   * The header row uses <td>, not <th> — looking for <th> finds nothing on
   * every class but one. Levels read as '1ˢᵗ', '2ⁿᵈ' and so on in superscript,
   * so only the digits are taken; an em dash means none.
   *
   * @returns {{maneuversKnown: object, maxDegree: object}|null}
   */
  static parseClassProgression(html) {
    const tables = [...String(html ?? '').matchAll(/<table[\s\S]*?<\/table>/gi)].map(m => m[0]);
    for (const table of tables) {
      const rows = [...table.matchAll(/<tr[\s\S]*?<\/tr>/gi)].map(m => m[0]);
      if (rows.length < 2) continue;

      const head    = this.#rowCells(rows[0]).map(h => h.toLowerCase());
      const iLevel  = head.findIndex(h => /^level$/.test(h));
      if (iLevel === -1) continue;
      const iKnown  = head.findIndex(h => /maneuvers?\s*known/.test(h));
      const iDegree = head.findIndex(h => /maneuver\s*degree/.test(h));
      if (iKnown === -1 && iDegree === -1) continue;   // not a maneuver class

      const maneuversKnown = {}, maxDegree = {};
      for (const row of rows.slice(1)) {
        const cells = this.#rowCells(row);
        if (cells.length <= iLevel) continue;
        const lvl = parseInt(String(cells[iLevel]).replace(/[^\d]/g, ''), 10);
        if (!lvl || lvl < 1 || lvl > 20) continue;

        const num = (i) => {
          if (i === -1 || cells[i] === undefined) return null;
          const t = String(cells[i]).replace(/[\u2014\u2013]/g, '-').trim();
          if (!t || t === '-') return 0;
          const n = parseInt(t.replace(/[^\d]/g, ''), 10);
          return Number.isFinite(n) ? n : null;
        };
        const k = num(iKnown), d = num(iDegree);
        if (k !== null) maneuversKnown[lvl] = k;
        if (d !== null) maxDegree[lvl] = d;
      }

      if (Object.keys(maneuversKnown).length || Object.keys(maxDegree).length) {
        return { maneuversKnown, maxDegree };
      }
    }
    return null;
  }

  /**
   * Read every installed class and let the book overrule the copy.
   *
   * The book wins where both exist — checked against the nine hand-typed
   * classes, 169 of 180 level entries already agreed, and the eleven that did
   * not were all one class whose numbers had been typed too generously.
   *
   * Traditions are left alone. The table has no column for them: a class's
   * tradition allowance is granted by a5e itself, through the tradition
   * proficiency grant on its Combat Maneuvers feature. For a class we are
   * meeting here for the first time we say 0, which this code reads as
   * uncapped — better than inventing a limit a5e will grant around.
   */
  /**
   * The progression printed on one class item, parsed once.
   *
   * Cached by item id because getClassManeuverInfo is called repeatedly while a
   * level-up dialog is open — twice per redraw for the before-and-after — and a
   * class description runs to tens of thousands of characters.
   */
  static #ownProgression = new Map();

  static #progressionOf(classItem) {
    const id = classItem?.id ?? classItem?.uuid;
    if (!id) return null;
    if (this.#ownProgression.has(id)) return this.#ownProgression.get(id);
    const parsed = this.parseClassProgression(classItem.system?.description);
    this.#ownProgression.set(id, parsed);
    return parsed;
  }

  static async loadClassProgressions() {
    let learned = 0, overruled = 0;
    for (const pack of PackFilter.packsOfType('Item')) {
      let index;
      try {
        index = await PackFilter.indexOf(pack, ['name', 'type', 'system.description']);
      } catch (err) {
        AM.log(2, `Could not index ${pack.collection} for class tables:`, err);
        continue;
      }
      for (const entry of index) {
        if (entry.type !== 'class') continue;
        const key = entry.name.toLowerCase();
        /* The four magic-maneuver classes run on this module's own progression,
           not the book's. None of them prints a maneuver column today, so this
           changes nothing now — it is here so a later printing that gave one to,
           say, the wizard could not quietly replace the magic school layer. */
        if (MM_KEYS.has(mmKey(key))) continue;

        const parsed = this.parseClassProgression(entry.system?.description);
        if (!parsed) continue;

        const prior = CLASS_MANEUVER_TABLES[key];
        if (prior) overruled++; else learned++;

        CLASS_MANEUVER_TABLES[key] = {
          maneuversKnown:    parsed.maneuversKnown,
          maxDegree:         parsed.maxDegree,
          traditions:        prior?.traditions ?? 0,
          allowedTraditions: prior?.allowedTraditions ?? null
        };
      }
    }
    AM.log(3, `Class tables: ${learned} learned from the books, ${overruled} refreshed`);
    return { learned, overruled };
  }

  /**
   * @param {string} className
   * @param {number} level
   * @param {Item}  [classItem]  the class ON the actor, when there is one.
   *   Read in preference to the name lookup: it is the actual class the
   *   character has, table and all, so a homebrew or imported class nobody
   *   published to a compendium still gets its progression. Illrigger, the most
   *   common class in this world, turns out to name no maneuvers, no exertion
   *   and no traditions anywhere in its text — so it correctly gets nothing,
   *   which is not the same as being unsupported.
   */
  static getClassManeuverInfo(className, level, classItem = null) {
    const key = className.toLowerCase();
    let table = CLASS_MANEUVER_TABLES[key];

    if (classItem && !MM_KEYS.has(mmKey(key))) {
      const own = this.#progressionOf(classItem);
      if (own) {
        table = {
          maneuversKnown:    own.maneuversKnown,
          maxDegree:         own.maxDegree,
          traditions:        table?.traditions ?? 0,
          allowedTraditions: table?.allowedTraditions ?? null
        };
      }
    }
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

  /**
   * A maneuver from a COMBAT tradition, as opposed to one of the magic schools.
   *
   * Magic maneuvers are maneuver items too — that is the whole point of the
   * design, they ride the same code path — so a plain `isManeuver` filter picks
   * up both and the sheet listed every magic maneuver twice, once here and once
   * in its own section.
   *
   * This existed only as a call site: the sheet asked for it, nothing defined
   * it, and `getData` threw before it could render. The sheet did not open at
   * all — the failure looked like a missing sheet rather than a missing method,
   * which is why it was chased through registration, imports and CSS first.
   */
  static isCombatManeuver(item) {
    if (!this.isManeuver(item)) return false;
    const tradition = item.system?.tradition ?? item.system?.combatTradition ?? '';
    return !isMagicSchool(tradition);
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
      if (src) keys.add(PackFilter.normalizeSource(src));
      keys.add(item.name.toLowerCase());
    }
    return keys;
  }

  /** True when this maneuver is already on the actor (by source UUID or name). */
  static isKnown(knownKeys, maneuver) {
    if (!knownKeys?.size || !maneuver) return false;
    return knownKeys.has(PackFilter.normalizeSource(maneuver.uuid))
        || knownKeys.has((maneuver.name ?? '').toLowerCase());
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
      const info  = this.getClassManeuverInfo(item.name, level, item);
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
