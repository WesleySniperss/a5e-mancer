import { AM } from '../am.js';
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
 * The eleven traditions the Adventurer's Guide itself describes, verified
 * against the book: "Combat traditions are the basic disciplines of fighting…
 * Adamant Mountain, Biting Zephyr, Mirror's Glint, Mist and Shade, Rapid
 * Current, Razor's Edge, Sanguine Knot, Spirited Steed, Tempered Iron, Tooth
 * and Claw, and Unending Wheel."
 *
 * This matters because `allowedTraditions` below was derived from that book and
 * from nothing else, so these are the only traditions it has any authority over.
 */
export const CORE_TRADITIONS = [
  'adamantMountain', 'bitingZephyr', 'mirrorsGlint', 'mistAndShade',
  'rapidCurrent', 'razorsEdge', 'sanguineKnot', 'spiritedSteed',
  'temperedIron', 'toothAndClaw', 'unendingWheel'
];

/**
 * May a class with this `allowedTraditions` list take from this tradition?
 *
 * The list used to be an absolute whitelist, which silently hid everything the
 * core book never named. The a5e system alone ships 27 traditions while our
 * lists between them permit 15 — so thirteen were unreachable in both the
 * builder and the level-up dialog: arcaneKnight, beastUnity, gallantHeart,
 * cuttingOmen and the rest, all from later sourcebooks that are installed and
 * working. Any homebrew tradition would have been hidden the same way, with no
 * message to say why.
 *
 * So the whitelist now restricts only among the eleven it actually describes.
 * A tradition from a later book, a module, or someone's own homebrew passes:
 * we have no rule about it, and hiding a table's own content is much the worse
 * way to be wrong. Deliberately permissive — a fighter can reach a psionic
 * tradition if the world has one installed.
 */
export function traditionAllowed(key, allowed) {
  /* A magic school only where it is named. Everywhere else the rule below lets
     a key the core book never mentions through - and the six schools are
     exactly such keys, so a fighter, a scout or any class with "any tradition"
     was offered magic maneuvers. */
  if (isMagicSchool(key)) return Array.isArray(allowed) && allowed.includes(key);
  if (!Array.isArray(allowed)) return true;
  if (allowed.includes(key)) return true;
  return !CORE_TRADITIONS.includes(key);
}

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
export const MM_KEYS = new Set();

/** The schools' one progression, shared by every class that learns them. */
export const MAGIC_MANEUVER_TABLE = magicManeuverTable();

/** Does this class learn magic maneuvers? */
export function hasMagicManeuvers(className) {
  return MM_KEYS.has(mmKey(className));
}

/**
 * Decide who gets magic maneuvers, from the world setting when there is one.
 *
 * MM_CLASSES stays the default — the four full casters the homebrew was
 * written for. But it was reachable only by editing this module's source, so a
 * table running its own caster, or one of the casters from a later book
 * (Witch, Wielder, Elementalist, Psion), had no way in. The setting is that
 * way, and takes the same forgiving names: "Psy Knight" and "psyknight" both
 * land on the same key.
 *
 * Called once at module load with the defaults, and again from
 * registerMagicSchools once settings exist.
 */
export function applyMagicManeuverClasses() {
  let names = MM_CLASSES;
  try {
    const raw = game.settings.get(AM.ID, 'magicManeuverClasses');
    if (typeof raw === 'string' && raw.trim()) names = raw.split(',');
  } catch { /* before init there is no setting; the default stands */ }

  /* Only the list. The schools' table used to be installed in
     CLASS_MANEUVER_TABLES under the class name, which made magic and combat
     maneuvers exclusive: a class in this list with combat maneuvers of its own
     (a herald, a homebrew caster with a printed table) was skipped with a
     warning and learned no magic maneuvers at all. Magic maneuvers come on top
     of combat ones, so the two tables are kept apart - CLASS_MANEUVER_TABLES
     holds combat progressions only, and ManeuverService.magicTableFor gives the
     schools to whoever is listed here. */
  MM_KEYS.clear();
  for (const name of names) {
    const key = mmKey(name);
    if (key) MM_KEYS.add(key);
  }
}

applyMagicManeuverClasses();

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
  /* In among the combat traditions by name, as a5e lists its own. Added at the
     end, the schools came after Viper's Fangs in every list read from here -
     the compendium browser's tradition filter, the sheet's tradition picker. */
  sortByLabel(CONFIG.A5E.maneuverTraditions, (label) => label);
  /* The character sheet's maneuver filter is copied from the traditions when
     a5e loads, long before this runs, so the schools were never in it. */
  const sheetFilter = CONFIG.A5E.filters?.maneuvers?.traditions?.filters;
  if (sheetFilter) {
    for (const [key, label] of Object.entries(MM_SCHOOLS)) {
      sheetFilter[key] ??= { label, key: 'system.tradition', type: 'value', truthValue: 'or' };
    }
    sortByLabel(sheetFilter, (entry) => entry?.label);
  }
  /* Now that settings exist, redo the class list — at module load it could only
     see the built-in default. */
  applyMagicManeuverClasses();
}

/**
 * Put an object's keys in the order of their localized labels, in place - so
 * anything already holding the object sees the new order.
 */
function sortByLabel(obj, labelOf) {
  const text = (v) => String(game.i18n?.localize?.(String(labelOf(v) ?? '')) ?? labelOf(v) ?? '');
  const entries = Object.entries(obj).sort(([, a], [, b]) => text(a).localeCompare(text(b)));
  for (const [key] of entries) delete obj[key];
  for (const [key, value] of entries) obj[key] = value;
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

    /* A record of what happened, so an empty window can say why it is empty
       rather than leaving it to be guessed at from outside. */
    const report = { packs: 0, read: 0, failed: [], maneuvers: 0, untraditioned: 0 };
    this.lastLoadReport = report;

    const packs = PackFilter.itemPacks();
    report.packs = packs.length;
    for (const pack of packs) {
      try {
        // flags is needed for the magic-maneuver check below — the index omits
        // it unless asked, so without it every one of them would slip through.
        const index = await PackFilter.indexOf(pack,
          ['name', 'type', 'img', 'system', 'flags'], { types: ['maneuver'] });
        for (const entry of index) {
          if (entry.type !== 'maneuver') continue;
          // Magic maneuvers are not filtered out: their school IS their tradition,
          // so they load, group and display through this same path. Which class
          // may take them is decided by allowedTraditions, as for every other
          // maneuver — that is the only difference the rules actually state.

          // tradition is a camelCase key in the data
          const tradition = entry.system?.tradition ?? entry.system?.combatTradition ?? '';
          /* A maneuver with no tradition is all but always an index that came
             back without its system data, not a maneuver the book left blank.
             Counting them is what turns a silently useless window into one that
             can say why every filter in it does nothing. */
          if (!tradition) report.untraditioned++;
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
        report.failed.push(`${pack.collection}: ${err.message}`);
        AM.log(2, `Error loading maneuvers from ${pack.collection}:`, err);
      }
    }

    // Sort within each bucket
    for (const tradMap of byTradition.values()) {
      for (const [deg, maneuvers] of tradMap) {
        tradMap.set(deg, maneuvers.sort((a, b) => a.name.localeCompare(b.name)));
      }
    }

    for (const degrees of byTradition.values())
      for (const list of degrees.values()) report.maneuvers += list.length;
    report.read = report.packs - report.failed.length;
    AM.log(report.untraditioned ? 2 : 3,
           `Maneuvers: ${report.maneuvers} from ${report.read} of ${report.packs} packs`
            + (report.untraditioned ? `; ${report.untraditioned} arrived with no tradition` : '')
            + (report.failed.length ? `; failed: ${report.failed.join(' | ')}` : ''));

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
        index = await PackFilter.indexOf(pack, ['name', 'type', 'system.description'],
                                         { types: ['class'] });
      } catch (err) {
        AM.log(2, `Could not index ${pack.collection} for class tables:`, err);
        continue;
      }
      for (const entry of index) {
        if (entry.type !== 'class') continue;
        const key = entry.name.toLowerCase();
        // A printed table is a combat progression. The schools are kept apart
        // (magicTableFor), so a caster's combat table can no longer replace them.

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

    if (classItem) {
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
    // A class with combat maneuvers answers with those; a caster with only the
    // schools answers with theirs. Both at once is maneuverBudget's to count.
    table ??= this.magicTableFor(key);
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

  /* ── Where a character's maneuvers come from ─────────────────────────── */

  /**
   * A class's combat maneuver table: its own printed one when the class on the
   * actor has it, else the module's copy. Combat only - the magic schools are
   * magicTableFor's, and a class can have both.
   */
  static tableFor(className, classItem = null) {
    const key = String(className ?? '').toLowerCase();
    let table = CLASS_MANEUVER_TABLES[key] ?? null;
    if (classItem) {
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
    return table;
  }

  /** The magic schools' table for a class that learns them, else null. */
  static magicTableFor(className) {
    return hasMagicManeuvers(className) ? MAGIC_MANEUVER_TABLE : null;
  }

  /** archetype uuid -> its maneuver table, or null */
  static archetypeManeuverCache = new Map();

  /**
   * Combat maneuvers an archetype brings to its class - with a table of its
   * own, the way a maneuver class has one.
   *
   * Six archetypes in a5e's packs give maneuvers to classes that have none:
   * the Spellguard wizard from 2nd level, the Steel Blooded sorcerer and the
   * Martialist warlock from 1st, the Field Engineer and Combat Engineer
   * artificer and the Myrmidon elementalist from 3rd. Each does it through a
   * feature granted by the archetype - once, through a feature granted by that
   * feature - which carries a Maneuvers Known and Maneuver Degree table, and a
   * grant naming its combat traditions.
   *
   * @returns {Promise<object|null>} { maneuversKnown, maxDegree, fromLevel,
   *   feature, archetype, allowedTraditions, traditions }
   */
  static async archetypeManeuvers(archetypeDoc) {
    if (!archetypeDoc) return null;
    const key = archetypeDoc.uuid ?? archetypeDoc._id ?? archetypeDoc.name;
    if (this.archetypeManeuverCache.has(key)) return this.archetypeManeuverCache.get(key);

    const grantsOf = (doc) => {
      const g = doc?._source?.system?.grants ?? doc?.system?.grants ?? {};
      return g instanceof Map ? [...g.values()] : Object.values(g);
    };
    const featureUuids = (doc) => grantsOf(doc)
      .filter(g => g?.grantType === 'feature')
      .sort((a, b) => (Number(a.level) || 1) - (Number(b.level) || 1))
      .flatMap(g => (g.features?.base ?? []).map(e => ({ uuid: e?.uuid ?? e, level: Number(g.level) || 1 })))
      .filter(e => typeof e.uuid === 'string');

    const read = async (uuid) => { try { return await fromUuid(uuid); } catch { return null; } };
    let found = null;
    const visit = async (entries, depth) => {
      for (const { uuid, level } of entries) {
        if (found) return;
        const doc = await read(uuid);
        if (!doc) continue;
        const table = this.parseClassProgression(doc.system?.description?.value ?? doc.system?.description);
        if (table) {
          const trad = grantsOf(doc).find(g => g?.traits?.traitType === 'maneuverTraditions' || g?.proficiencyType === 'tradition');
          const spec = trad?.traits ?? trad?.keys ?? null;
          const base = spec?.base ?? [], options = spec?.options ?? [], total = Number(spec?.total) || 0;
          found = {
            ...table,
            fromLevel: level,
            feature: doc.name,
            archetype: archetypeDoc.name,
            allowedTraditions: spec ? [...new Set([...base, ...options])] : null,
            /* How many traditions the feature gives. Its grant is not written
               one way: the Spellguard's says total 2 for "Cutting Omen and one
               more", counting the fixed one in. A total above the fixed count is
               read as including it; otherwise it is on top. */
            traditions: spec ? (total > base.length ? total : base.length + (options.length ? Math.max(1, total) : 0)) : 0
          };
          return;
        }
        if (depth < 1) await visit(featureUuids(doc).map(e => ({ ...e, level: Math.max(level, e.level) })), depth + 1);
      }
    };
    await visit(featureUuids(archetypeDoc), 0);
    this.archetypeManeuverCache.set(key, found);
    return found;
  }

  /** How many magic schools may be open at a level of the schools' progression. */
  static magicSchoolsAt(level) {
    let schools = 0;
    for (const row of MM_PROGRESSION) if (row.level <= level) schools = row.schools ?? schools;
    return schools;
  }

  /**
   * Everything a character learns maneuvers from, and what a level brings -
   * combat and magic apart.
   *
   *   sources  every class table, magic-school table and archetype table the
   *            character has, each at its class's level after this level-up
   *   kinds    per kind ('combat', 'magic'):
   *     gained            maneuvers this level adds - from the class being levelled only
   *     known             maneuvers known in total at the new levels
   *     maxDegree         highest degree, by the multiclassing rule
   *     prevMaxDegree     the same before the level, to say a degree opened
   *     allowedTraditions keys, or null for any combat tradition
   *     traditionLimit    traditions (or schools) that may be open
   *
   * The degree rule is the Adventurer's Guide's (Multiclassing, Combat
   * Maneuvers): "You use your class levels in every class that grants combat
   * maneuvers to determine the highest degree of combat maneuvers you can
   * learn, determined by the class with the greatest access" - 3 fighter and 10
   * herald learn as a 13th-level fighter. Maneuvers known and traditions add up
   * across the features.
   *
   * Magic maneuvers are on top of all that, never part of it. Only the classes
   * that learn them count, their levels summed on the schools' one progression -
   * how many, the degree and the schools alike - and those levels never count
   * toward combat maneuvers, nor a fighter's toward magic ones. A class with
   * both has two sources.
   *
   * @param {Actor} actor
   * @param {object} [opts]
   * @param {string} [opts.classId]        the class gaining a level
   * @param {number} [opts.newLevel]       its level after
   * @param {string} [opts.archetypeUuid]  an archetype picked for that class in this dialog
   * @param {{name: string}} [opts.newClass]  a class being taken at 1st level
   */
  static async maneuverBudget(actor, { classId = null, newLevel = null, archetypeUuid = null, newClass = null } = {}) {
    const classes = [];
    for (const item of actor?.items ?? []) {
      if (item?.type !== 'class') continue;
      const cur = Number(item.system?.classLevels) || 1;
      const levelling = !newClass && item.id === classId;
      classes.push({ id: item.id, name: item.name, item, level: levelling ? newLevel : cur, prev: levelling ? newLevel - 1 : cur });
    }
    const levellingId = newClass ? '__new' : classId;
    if (newClass) classes.push({ id: '__new', name: newClass.name, item: null, level: 1, prev: 0 });

    const sources = [];
    for (const c of classes) {
      const table = this.tableFor(c.name, c.item);
      if (table) {
        sources.push({ kind: 'combat', label: c.name, classId: c.id, level: c.level, prev: c.prev,
                       table, allowedTraditions: table.allowedTraditions ?? null, traditions: table.traditions ?? 0 });
      }
      const magic = this.magicTableFor(c.name);
      if (magic) {
        sources.push({ kind: 'magic', label: c.name, classId: c.id, level: c.level, prev: c.prev,
                       table: magic, allowedTraditions: magic.allowedTraditions, traditions: magic.traditions });
      }
      const slug = c.item ? (c.item.slug || c.item.system?.slug || String(c.name).slugify?.({ strict: true }) || '') : '';
      let arch = slug ? (actor.items.find?.(i => i?.type === 'archetype' && i.system?.class === slug) ?? null) : null;
      if (!arch && c.id === levellingId && archetypeUuid) {
        try { arch = await fromUuid(archetypeUuid); } catch { arch = null; }
      }
      const am = arch ? await this.archetypeManeuvers(arch) : null;
      if (am && c.level >= am.fromLevel) {
        sources.push({ kind: 'combat', label: `${am.archetype} (${c.name})`, classId: c.id, level: c.level, prev: c.prev,
                       table: am, allowedTraditions: am.allowedTraditions, traditions: am.traditions, archetype: true });
      }
    }

    const at = (table, field, lvl) => Number(table?.[field]?.[Math.max(0, Math.min(20, lvl))] ?? 0) || 0;
    const kinds = {};
    for (const kind of ['combat', 'magic']) {
      const ks = sources.filter(s => s.kind === kind);
      if (!ks.length) continue;
      const summed = (field) => {
        const byClass = new Map();
        for (const s of ks) byClass.set(s.classId, Math.max(byClass.get(s.classId) ?? 0, s[field]));
        return Math.min(20, [...byClass.values()].reduce((a, b) => a + b, 0));
      };
      const now = summed('level'), before = summed('prev');
      const allowed = ks.some(s => !s.allowedTraditions) ? null
        : [...new Set(ks.flatMap(s => s.allowedTraditions))];
      /* Combat maneuvers known add up feature by feature, as the book says. The
         magic schools are one progression - ten by 20th level - so a wizard 10
         and cleric 10 know what a 20th-level caster knows, not two 10th-level
         casters' worth (12). Read at the summed levels, like the degree. */
      const levelling = ks.some(s => s.classId === levellingId);
      const magicTable = kind === 'magic' ? MAGIC_MANEUVER_TABLE : null;
      kinds[kind] = {
        gained: magicTable
          ? (levelling ? Math.max(0, at(magicTable, 'maneuversKnown', now) - at(magicTable, 'maneuversKnown', before)) : 0)
          : ks.filter(s => s.classId === levellingId)
              .reduce((n, s) => n + Math.max(0, at(s.table, 'maneuversKnown', s.level) - at(s.table, 'maneuversKnown', s.prev)), 0),
        known: magicTable
          ? at(magicTable, 'maneuversKnown', now)
          : ks.reduce((n, s) => n + at(s.table, 'maneuversKnown', s.level), 0),
        maxDegree: Math.max(0, ...ks.map(s => at(s.table, 'maxDegree', now))),
        prevMaxDegree: Math.max(0, ...ks.map(s => at(s.table, 'maxDegree', before))),
        allowedTraditions: kind === 'magic' ? Object.keys(MM_SCHOOLS) : allowed,
        traditionLimit: kind === 'magic' ? this.magicSchoolsAt(now) : ks.reduce((n, s) => n + (s.traditions || 0), 0),
        sources: ks.map(s => s.label),
        levelling: ks.some(s => s.classId === levellingId)
      };
    }
    return { sources, kinds };
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

    /* Combat and magic apart, the way maneuverBudget counts them. Added into one
       pool, a wizard 5 / fighter 5 had the wizard's magic maneuvers covering
       for missing combat ones and the other way round, and two casters' tables
       added up past the ten the schools allow. */
    const at = (t, f, l) => Number(t?.[f]?.[Math.max(0, Math.min(20, l))] ?? 0) || 0;
    const combat = { known: 0, traditions: 0, levels: 0, tables: [], allowed: [], any: false };
    let magicLevels = 0;

    for (const item of actor.items) {
      if (item.type !== 'class') continue;
      const level = Math.max(1, Math.min(20,
        Number(item.system?.classLevels ?? item.system?.levels ?? item.system?.level ?? 1) || 1));
      const table = this.tableFor(item.name, item);
      if (table && at(table, 'maneuversKnown', level) > 0) {
        combat.known      += at(table, 'maneuversKnown', level);
        combat.traditions += table.traditions ?? 0;
        combat.levels     += level;
        combat.tables.push(table);
        if (!Array.isArray(table.allowedTraditions)) combat.any = true;
        else combat.allowed.push(...table.allowedTraditions);
      }
      if (this.magicTableFor(item.name)) magicLevels += level;
    }
    magicLevels = Math.min(20, magicLevels);

    const magicKnown = at(MAGIC_MANEUVER_TABLE, 'maneuversKnown', magicLevels);
    if (!combat.tables.length && !magicKnown) return null;

    const kindOf = (i) => (isMagicSchool(i.system?.tradition ?? i.system?.combatTradition ?? '') ? 'magic' : 'combat');
    const chosen = actor.items.filter(i => this.isChosenManeuver(i));
    const traditionsKnown = this.getActorTraditions(actor);
    const kinds = {
      combat: {
        maneuversKnown: combat.known,
        traditions: combat.traditions,
        maxDegree: Math.max(0, ...combat.tables.map(t => at(t, 'maxDegree', Math.min(20, combat.levels)))),
        knownCount: chosen.filter(i => kindOf(i) === 'combat').length,
        knownTraditions: traditionsKnown.filter(t => !isMagicSchool(t)).length
      },
      magic: {
        maneuversKnown: magicKnown,
        traditions: magicKnown ? this.magicSchoolsAt(magicLevels) : 0,
        maxDegree: magicKnown ? at(MAGIC_MANEUVER_TABLE, 'maxDegree', magicLevels) : 0,
        knownCount: chosen.filter(i => kindOf(i) === 'magic').length,
        knownTraditions: traditionsKnown.filter(t => isMagicSchool(t)).length
      }
    };
    const both = Object.values(kinds);
    const sum = (f) => both.reduce((n, k) => n + k[f], 0);
    const allowed = combat.any ? null : [...new Set(combat.allowed)];

    return {
      kinds,
      maneuversKnown: sum('maneuversKnown'),
      traditions: sum('traditions'),
      maxDegree: Math.max(...both.map(k => k.maxDegree)),
      // null means any combat tradition; the schools are added by name
      allowedTraditions: allowed && magicKnown ? [...allowed, ...MAGIC_MANEUVER_TABLE.allowedTraditions] : allowed,
      knownCount: chosen.length,
      knownTraditions: traditionsKnown.length,
      remainingManeuvers:  both.reduce((n, k) => n + Math.max(0, k.maneuversKnown - k.knownCount), 0),
      remainingTraditions: both.reduce((n, k) => n + Math.max(0, k.traditions - k.knownTraditions), 0)
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
