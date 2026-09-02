import { AM } from '../a5e-mancer.js';
import { PackFilter } from './packFilter.js';
import { iconForItem, applyItemIcon } from '../data/a5eIcons.js';
import { castOnlyEffects } from './effectTiming.js';

/**
 * Spell slot tables and known spells for a5e classes.
 * a5e uses the same spell system as 5e — Prepared or Known casters.
 */

// Spells known at level 1 for "known" casters.
//
// `maxLevel` is the highest spell level a 1st-level character of the class can
// take. The herald is 0: its table gives two cantrips at 1st level and no spell
// slots until 2nd, so offering it a 1st-level spell offered one it cannot cast —
// while `cantrips: 0` did the opposite harm and withheld the two it is owed.
// The artificer is NOT the same case despite also being a half caster: it casts
// from spell inventions rather than slots and its maximum spell level is 1st
// from 1st level, so it keeps maxLevel: 1.
export const CLASS_SPELL_TABLES = {
  bard:      { type: 'known',    spellsKnown: 4,  cantrips: 2, maxLevel: 1 },
  sorcerer:  { type: 'known',    spellsKnown: 2,  cantrips: 4, maxLevel: 1 },
  warlock:   { type: 'known',    spellsKnown: 2,  cantrips: 2, maxLevel: 1 },
  // Prepared casters: spellsKnown: -1 = unlimited (add any spells to their list/spellbook)
  wizard:    { type: 'prepared', spellsKnown: -1, cantrips: 3, maxLevel: 1 },
  cleric:    { type: 'prepared', spellsKnown: -1, cantrips: 3, maxLevel: 1 },
  druid:     { type: 'prepared', spellsKnown: -1, cantrips: 2, maxLevel: 1 },
  herald:    { type: 'prepared', spellsKnown: -1, cantrips: 2, maxLevel: 0 },
  artificer: { type: 'prepared', spellsKnown: -1, cantrips: 2, maxLevel: 1 }
};

/**
 * Secondary school tags that are most relevant per class/caster-type.
 * Classes not listed here rely solely on primary school filtering.
 * Keys are lowercase class names (as they appear in system data).
 */
export const CLASS_RELEVANT_SECONDARY_SCHOOLS = {
  // Elementalist variants — each is scoped to its element(s)
  elementalist:      ['fire', 'water', 'air', 'earth', 'cold', 'lightning', 'thunder', 'acid', 'storm'],
  elementalistfire:  ['fire', 'radiant', 'enhancement'],
  elementalistwater: ['water', 'cold', 'healing'],
  elementalistair:   ['air', 'lightning', 'thunder', 'storm'],
  elementalistearth: ['earth', 'acid', 'nature'],
  // Psion — psionic disciplines
  psion:             ['psionic', 'psychic', 'telepathy', 'compulsion', 'control', 'senses'],
  // Wielder — arcane martial
  wielder:           ['arcane', 'enhancement', 'unarmed', 'weaponry', 'attack'],
  // Witch — nature and shadow
  witch:             ['nature', 'plants', 'beasts', 'poison', 'affliction', 'shadow', 'healing', 'chaos'],
  // Warlock — dark/planar
  warlock:           ['evil', 'shadow', 'planar', 'necrotic', 'undead', 'telepathy'],
  // Cleric / Herald — divine
  cleric:            ['divine', 'healing', 'radiant', 'good', 'evil', 'protection'],
  herald:            ['divine', 'healing', 'radiant', 'good', 'protection'],
  // Druid — nature
  druid:             ['nature', 'plants', 'beasts', 'earth', 'water', 'air', 'weather', 'shapechanging'],
  // Artificer — technological/arcane
  artificer:         ['technological', 'enhancement', 'object', 'arcane', 'utility'],
  // Bard — communication/performance
  bard:              ['communication', 'sound', 'compulsion', 'knowledge', 'enhancement'],
  // Sorcerer — wild/chaos magic
  sorcerer:          ['chaos', 'arcane', 'enhancement', 'prismatic'],
};

/**
 * Returns [{key, label}] for primary spell schools, sourced from CONFIG.A5E at runtime.
 * Falls back to a static list if CONFIG.A5E is unavailable.
 */
export function getSpellSchools() {
  const primary = CONFIG?.A5E?.spellSchools?.primary;
  if (primary) {
    return Object.entries(primary).map(([key, i18nKey]) => ({
      key,
      label: game.i18n.localize(i18nKey)
    })).sort((a, b) => a.label.localeCompare(b.label));
  }
  // Fallback
  return [
    'abjuration','conjuration','divination','enchantment',
    'evocation','illusion','necromancy','transmutation'
  ].map(key => ({ key, label: key.charAt(0).toUpperCase() + key.slice(1) }));
}

/**
 * Returns [{key, label}] for the secondary school tags relevant to a given class.
 * Returns empty array for classes with no relevant secondaries defined.
 */
export function getSecondarySchoolsForClass(className) {
  if (!className) return [];
  const key = className.toLowerCase().replace(/\s+/g, '');
  const relevantKeys = CLASS_RELEVANT_SECONDARY_SCHOOLS[key];
  if (!relevantKeys?.length) return [];

  const secondary = CONFIG?.A5E?.spellSchools?.secondary ?? {};
  return relevantKeys.map(k => ({
    key: k,
    label: secondary[k] ? game.i18n.localize(secondary[k]) : k.charAt(0).toUpperCase() + k.slice(1)
  }));
}

export class SpellService {

  static _dynamicSpellInfo = null;
  static _dynamicIsSpellcaster = false;

  /**
   * Check if a class is a spellcaster (checks hardcoded table + cached dynamic lookups).
   */
  static isSpellcaster(className) {
    return !!CLASS_SPELL_TABLES[className?.toLowerCase()] || this._dynamicIsSpellcaster;
  }

  /**
   * Get spell info for a class at level 1.
   * First checks the hardcoded table, then falls back to cached dynamic info
   * populated by loadClassSpellInfo().
   * Returns null for classes that don't get spells until a higher level.
   */
  static getClassSpellInfo(className) {
    return CLASS_SPELL_TABLES[className?.toLowerCase()] ?? this._dynamicSpellInfo ?? null;
  }

  /**
   * How many known spells may be swapped when a level in this class is gained.
   *
   * A5e gives this to *known* casters — "whenever you gain a level in this class
   * you can replace one spell you know with another from the class's list".
   * Prepared casters (wizard, cleric, druid, herald, artificer) rearrange their
   * prepared list freely instead, so they get none.
   */
  /**
   * Highest spell level a caster of this class level can take.
   *
   * Full casters gain a level of spells every other class level; a5e keeps the
   * standard 5e progression, so this is the familiar ceil(level / 2) capped at 9.
   * Half casters (herald, artificer) come online at 2nd and climb half as fast.
   * Returns 0 for a class that casts nothing, so callers can tell "no spells" from
   * "cantrips only".
   */
  static maxSpellLevelFor(className, classLevel) {
    const key  = String(className ?? '').toLowerCase();
    const info = CLASS_SPELL_TABLES[key];
    if (!info) return 0;

    const lvl = Math.max(1, Math.min(20, Number(classLevel) || 1));

    // The two half casters climb identically — one spell level at 1st/2nd, then
    // 5th, 9th, 13th, 17th, capped at 5th — but they do not START together, and
    // treating them as one case was wrong at exactly one level. The herald has
    // no slots until 2nd; the artificer casts from 1st through spell inventions,
    // and its own table reads "Maximum Spell Level: 1st" at 1st level. Lumping
    // them together told a 1st-level artificer it could cast nothing, while
    // CLASS_SPELL_TABLES said otherwise — the two disagreed in the same file.
    if (key === 'herald' || key === 'artificer') {
      if (key === 'herald' && lvl < 2) return 0;
      return Math.min(5, Math.ceil(lvl / 4));
    }

    return Math.max(0, Math.min(9, Math.ceil(lvl / 2)));
  }

  /**
   * Spells known per class level, and cantrips known per class level.
   *
   * a5e's class documents carry `casterType` and, for the wizard, a prepared
   * formula — but no spells-known table, so this cannot be read from the data.
   * Without it the level-up had to leave the count open, which is why a caster
   * could learn any number of spells at once.
   *
   *   known    — cumulative spells known at that class level (known casters)
   *   cantrips — cumulative cantrips known
   *   perLevel — for casters who add a fixed number to a book each level
   *              instead of following a known table (the wizard)
   *
   * Prepared casters with the whole list available (cleric, druid) learn nothing
   * at level-up: they prepare from their list, so they are absent here.
   */
  static SPELLS_KNOWN = {
    // a5e's bard is not 5e's: spells known climb by exactly one a level, 4 → 23
    bard:     { cantrips: [0,2,2,2,3,3,3,3,3,3,4,4,4,4,4,4,4,4,4,4,4],
                known:    [0,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23] },
    sorcerer: { cantrips: [0,4,4,4,5,5,5,5,5,5,6,6,6,6,6,6,6,6,6,6,6],
                known:    [0,2,3,4,5,6,7,8,9,10,11,12,12,13,13,14,14,15,15,16,16] },
    warlock:  { cantrips: [0,2,2,2,3,3,3,3,3,3,4,4,4,4,4,4,4,4,4,4,4],
                known:    [0,2,3,4,5,6,7,8,9,10,11,11,12,12,13,13,14,14,15,15,16] },
    // Six 1st-level spells in the book to start, two added per level after
    wizard:   { cantrips: [0,3,3,3,4,4,4,4,4,4,5,5,5,5,5,5,5,5,5,5,5],
                perLevel: 2, firstLevel: 6 },
    // Prepared casters: no spells known, but the cantrip column is still real
    cleric:   { cantrips: [0,3,3,3,4,4,4,4,4,4,5,5,5,5,5,5,5,5,5,5,5], prepared: true },
    druid:    { cantrips: [0,2,2,2,3,3,3,3,3,3,4,4,4,4,4,4,4,4,4,4,4], prepared: true },
    herald:   { cantrips: [0,2,2,2,2,2,2,2,2,4,4,4,4,4,4,4,4,4,4,4,4], prepared: true },
    // Absent until now, and absent is not neutral: `newAtLevel` returns null for
    // a class it does not list, so the level-up dialog offered a levelling
    // artificer nothing at all — no new cantrip at 4th, none at 10th. It was in
    // CLASS_SPELL_TABLES, so character creation worked and only levelling was
    // silent. Counts from its own progression table: 2 / 3 from 4th / 4 from 10th.
    artificer: { cantrips: [0,2,2,2,3,3,3,3,3,3,4,4,4,4,4,4,4,4,4,4,4], prepared: true }
  };

  /**
   * How many spells and cantrips this level brings.
   *
   * `spells: null` means the class does not learn spells at all — a cleric,
   * druid or herald prepares from its whole list each day, so a quota there
   * would be an invented rule. Its cantrips are still a real number, which is
   * why those classes are listed rather than omitted: leaving them out meant a
   * cleric was never offered the cantrip it gains at 4th.
   *
   * @returns {{cantrips: number, spells: number|null}|null} null for a non-caster
   */
  static newAtLevel(className, classLevel) {
    const key = String(className ?? '').toLowerCase();
    const t = this.SPELLS_KNOWN[key];
    if (!t) return null;

    const lvl  = Math.max(1, Math.min(20, Number(classLevel) || 1));
    const prev = lvl - 1;

    const cantrips = Math.max(0, (t.cantrips?.[lvl] ?? 0) - (t.cantrips?.[prev] ?? 0));
    if (t.prepared) return { cantrips, spells: null };

    const spells = t.known
      ? Math.max(0, t.known[lvl] - (t.known[prev] ?? 0))
      : (lvl <= 1 ? (t.firstLevel ?? 0) : (t.perLevel ?? 0));

    return { cantrips, spells };
  }

  /**
   * How many spells a prepared caster can have prepared at a class level.
   *
   * Quoted from the class rules on a5e.tools: cleric and druid prepare a number
   * equal to their Wisdom modifier + class level; the herald, Charisma modifier
   * + half its level rounded down; the wizard, Intelligence modifier + level —
   * which is also what a5e's own `maxPreparedFormula` on the class item says.
   * Minimum one in every case.
   *
   * This is what "how many spells do I get" means for these classes: they do not
   * learn a fixed number, they prepare this many from their list.
   *
   * @returns {number|null} null when the class does not prepare this way
   */
  static preparedCount(actor, className, classLevel) {
    const key = String(className ?? '').toLowerCase();
    const rule = {
      cleric: { ability: 'wis', per: 1 },
      druid:  { ability: 'wis', per: 1 },
      wizard: { ability: 'int', per: 1 },
      herald: { ability: 'cha', per: 0.5 }
    }[key];
    if (!rule) return null;

    const score = actor?.system?.abilities?.[rule.ability]?.value ?? 10;
    const mod   = Math.floor((score - 10) / 2);
    const lvl   = Math.max(1, Math.min(20, Number(classLevel) || 1));
    return Math.max(1, mod + Math.floor(lvl * rule.per));
  }

  /**
   * Spells an origin hands out in its text rather than through a grant.
   *
   * a5e has no grant type for spells at all, so a heritage or culture that gives
   * one writes it in prose and nothing records it — the Orc heritage, and the
   * Dragonbound, High Elf and Stoic Orc cultures all do. Those spells were
   * simply never gained: no grant to absorb, no picker to offer them.
   *
   * Only the two mechanical shapes are read, both of which name a count and a
   * spell level explicitly:
   *   "You know one cantrip of your choice …"
   *   "You know two 1st-level spells of your choice …"
   * Anything vaguer is left to the prose marker, because a wrong reading here
   * would hand out a spell the character should not have. Being wrong the other
   * way costs an allowance the player can simply not spend.
   *
   * @returns {Array<{level: number, count: number}>}
   */
  static spellsFromProse(html) {
    const text = String(html ?? '')
      .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
    if (!text) return [];

    const NUM = { one: 1, two: 2, three: 3, four: 4, a: 1, an: 1 };
    const out = [];

    const cantrip = text.match(/\byou (?:know|learn) (one|two|three|a|an)\s+cantrips?\b[^.]*?of your choice/i);
    if (cantrip) out.push({ level: 0, count: NUM[cantrip[1].toLowerCase()] ?? 1 });

    const spell = text.match(/\byou (?:know|learn) (one|two|three)\s+(\d)(?:st|nd|rd|th)-level spells?\b[^.]*?of your choice/i);
    if (spell) out.push({ level: Number(spell[2]) || 1, count: NUM[spell[1].toLowerCase()] ?? 1 });

    return out;
  }

  static replaceableOnLevelUp(className) {
    const info = this.getClassSpellInfo(className);
    return info?.type === 'known' ? 1 : 0;
  }

  /**
   * Dynamically load spellcasting info from a class compendium item.
   * Sets _dynamicIsSpellcaster=true for any spellcasting class, even half-casters
   * that don't get spells at level 1. _dynamicSpellInfo is only set for classes
   * that get spells at level 1.
   *
   * @param {string} classUuid
   * @returns {Promise<object|null>} spell info or null if not a level-1 caster
   */
  static async loadClassSpellInfo(classUuid, { requireSpellsAtFirst = true } = {}) {
    this._dynamicSpellInfo = null;
    this._dynamicIsSpellcaster = false;
    if (!classUuid) return null;

    try {
      const item = await fromUuid(classUuid);
      if (!item) return null;

      const casting = item.system?.spellcasting;
      if (!casting?.casterType || casting.casterType === 'none') return null;

      // Mark as a spellcaster regardless of when spells start
      this._dynamicIsSpellcaster = true;

      const casterType = casting.casterType;
      const isFullCaster = ['fullCaster', 'warlockA5e', 'warlock5e', 'elementalist'].includes(casterType);
      const hasSpellsAtOne = isFullCaster
        || casterType === 'halfCasterWithFirstLevel'
        || casterType === 'psion'
        || casterType === 'wielder';

      // Half-casters (ranger, herald archetype variants) get spells at level 2+ — no level-1 picker
      if (requireSpellsAtFirst && !hasSpellsAtOne) return null;

      // The gate above is a CREATION rule: a half caster has no slots at 1st, so
      // the builder must not show it a spell tab. At level-up it is wrong — a
      // half caster at 5th certainly casts — so the caller can turn it off.
      const isPrepared = ['halfCaster', 'halfCasterWithFirstLevel'].includes(casterType) && !isFullCaster;
      const info = {
        type: isPrepared ? 'prepared' : 'known',
        cantrips: isFullCaster ? 2 : 0,
        spellsKnown: isPrepared ? -1 : (isFullCaster ? 2 : 1),
        maxLevel: 1
      };

      this._dynamicSpellInfo = info;
      return info;
    } catch (err) {
      AM.log(2, 'Error loading class spell info:', err);
      return null;
    }
  }

  /**
   * Spell-list key for a character class name, e.g. "Wizard" → "wizard".
   *
   * The authoritative keys are CONFIG.A5E.classSpellLists (artificer, bard,
   * cleric, druid, elementalistAir/Earth/Fire/Water, esper, psion, psyknight,
   * herald, sorcerer, warlock, wielder, witch, wizard). Matching against them
   * exactly is what keeps foreign lists out; the old fuzzy substring compare is
   * what let extra schools through.
   */
  static classSpellListKey(className) {
    const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z]/g, '');
    const want = norm(className);
    if (!want) return '';

    const keys = Object.keys(CONFIG?.A5E?.classSpellLists ?? {});
    if (!keys.length) return want;

    const exact = keys.find(k => norm(k) === want);
    if (exact) return exact;

    // "Elementalist (Fire)" and friends carry their element in the name
    if (want.startsWith('elementalist')) {
      const el = keys.find(k => k.startsWith('elementalist') && want.includes(norm(k).replace('elementalist', '')));
      if (el) return el;
    }
    return '';
  }

  /**
   * Is this spell on the given class's list?
   *
   * `system.classes` on a spell is a set of those keys — a5e itself reads it with
   * `[...item.system.classes]`. Object.keys() over a Set returns an empty array,
   * which the old code read as "no restriction", so every spell in every
   * compendium passed the filter.
   *
   * A spell that genuinely names no class is still treated as available:
   * homebrew and imported spells routinely leave the field empty.
   */
  /**
   * Spells a feature adds to a character's list by naming them outright.
   *
   * The 35 "Warlock Expanded Spell List" features and their kin carry no grant —
   * a5e has no grant type for spells — but they do name each spell as a @UUID
   * link, which is exact rather than prose. Those spells belong on the
   * character's list and the class filter would otherwise hide every one of
   * them, because they are not warlock spells to begin with. That is the whole
   * point of an expanded list.
   *
   * @returns {string[]} compendium uuids, spells only
   */
  static spellUuidsFromLinks(html) {
    const out = new Set();
    const re = /@UUID\[(Compendium\.[^\]]*?\.Item\.[A-Za-z0-9]+)\]/g;
    let m;
    while ((m = re.exec(String(html ?? '')))) {
      // Only the spell packs: these features link features and items too
      if (/spells/i.test(m[1])) out.add(m[1]);
    }
    return [...out];
  }

  /** Uuids admitted past the class filter, gathered from expanded-list features. */
  static extraAllowed = new Set();

  /**
   * Collect the expanded lists an actor's features name, so the picker offers
   * them. Safe to call repeatedly; it replaces what it found last time.
   */
  static collectExpandedLists(actor) {
    this.extraAllowed = new Set();
    for (const item of (actor?.items ?? [])) {
      if (item.type !== 'feature') continue;
      const raw = typeof item.system?.description === 'string'
        ? item.system.description
        : (item.system?.description?.value ?? '');
      if (!/expanded spell list/i.test(item.name ?? '') && !/expanded spell list/i.test(raw)) continue;
      for (const uuid of this.spellUuidsFromLinks(raw)) this.extraAllowed.add(uuid);
    }
    if (this.extraAllowed.size) {
      AM.log(3, `${this.extraAllowed.size} spell(s) admitted from expanded lists`);
    }
    return this.extraAllowed;
  }

  static spellAllowsClass(sys, className, uuid = '') {
    // An expanded list names its spells outright; they are on the character's
    // list whatever the spell's own class field says.
    if (uuid && this.extraAllowed.has(uuid)) return true;

    const key = this.classSpellListKey(className);
    if (!key) return true;                      // unknown class — don't hide anything

    const raw = sys?.classes ?? sys?.spellClasses ?? null;
    if (raw === null || raw === undefined) return true;

    // Array, Set, or any other iterable — the same spread a5e uses
    let list = [];
    if (typeof raw === 'string')            list = raw.split(/[,;/|]/);
    else if (typeof raw?.[Symbol.iterator] === 'function') list = [...raw];
    else if (typeof raw === 'object')       list = Object.keys(raw);

    const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z]/g, '');
    const wanted = norm(key);
    const normalized = list.map(norm).filter(Boolean);
    if (!normalized.length) return true;        // unrestricted / unknown

    return normalized.includes(wanted);
  }

  /**
   * Load all spells from compendiums, grouped by level then class.
   * Returns: Map<level (0–9), spell[]>
   */
  static async loadSpells(filterClass = null, maxLevel = 9) {
    const byLevel = new Map();
    for (let i = 0; i <= 9; i++) byLevel.set(i, []);

    const packs = PackFilter.itemPacks();

    for (const pack of packs) {
      try {
        const index = await pack.getIndex({
          fields: ['name', 'type', 'img', 'system']
        });
        for (const entry of index) {
          if (entry.type !== 'spell') continue;

          const level  = parseInt(entry.system?.level ?? entry.system?.spellLevel ?? 0);
          if (level > maxLevel) continue;

          // Filter by class if specified. The uuid is passed so a spell named by
          // an expanded list is admitted even though it is not a class spell —
          // which is exactly what an expanded list is for.
          const uuid = entry.uuid ?? `Compendium.${pack.collection}.Item.${entry._id}`;
          if (filterClass && !this.spellAllowsClass(entry.system, filterClass, uuid)) continue;

          const school = entry.system?.schools?.primary ?? entry.system?.school ?? '';
          const schoolI18nKey = CONFIG?.A5E?.spellSchools?.primary?.[school];
          const schoolLabel = schoolI18nKey
            ? game.i18n.localize(schoolI18nKey)
            : (school ? school.charAt(0).toUpperCase() + school.slice(1) : '');

          // Secondary schools — stored as array for multi-tag filtering
          const rawSecondary = entry.system?.schools?.secondary ?? [];
          const secondarySchools = Array.isArray(rawSecondary)
            ? rawSecondary
            : Object.keys(rawSecondary);

          byLevel.get(level)?.push({
            id:              entry._id,
            name:            entry.name,
            // Site icon when the site has this exact spell (or art is a placeholder)
            img:             iconForItem(entry.name, 'spell', entry.img ?? '') ?? entry.img,
            uuid:            `Compendium.${pack.collection}.${entry._id}`,
            level,
            school,           // primary school key
            schoolLabel,      // localized primary school
            secondarySchools, // array of secondary tag keys
            castingTime: entry.system?.activation?.type ?? '',
            ritual:      entry.system?.ritual ?? false,
            concentration: entry.system?.concentration ?? false,
            description: entry.system?.description?.value ?? entry.system?.description ?? ''
          });
        }
      } catch (err) {
        AM.log(2, `Error loading spells from ${pack.collection}:`, err);
      }
    }

    // Sort each level alphabetically
    for (const [level, spells] of byLevel) {
      byLevel.set(level, spells.sort((a, b) => a.name.localeCompare(b.name)));
    }

    return byLevel;
  }

  /**
   * Add selected spells to actor.
   */
  static async applySpellsToActor(actor, spellUuids) {
    if (!spellUuids.length) return;

    // A5e requires spells to reference a spellbook on the actor.
    // The spellbook is created by class grants when the class item is added.
    const spellBookId = actor.spellBooks?.first()?._id
      ?? Object.keys(actor.system?.spellBooks ?? {})[0]
      ?? null;

    // Collect existing spell names + source UUIDs to prevent duplicates
    const existingNames = new Set(
      actor.items.filter(i => i.type === 'spell').map(i => i.name.toLowerCase())
    );
    const existingSources = new Set(
      actor.items.filter(i => i.type === 'spell')
        .map(i => i._stats?.compendiumSource ?? i.flags?.core?.sourceId ?? '')
        .filter(Boolean)
    );

    const itemDatas = [];
    for (const uuid of spellUuids) {
      if (existingSources.has(uuid)) continue; // exact UUID match
      try {
        const item = await fromUuid(uuid);
        if (!item) continue;
        if (existingNames.has(item.name.toLowerCase())) continue; // name match fallback
        const data = item.toObject();
        data._stats = data._stats || {};
        data._stats.compendiumSource = uuid;
        applyItemIcon(data); // exact site match or placeholder fill; keyword guesses never touch spells
        // A spell in a spellbook casts nothing until it is cast. See effectTiming.
        const retimed = castOnlyEffects(data);
        if (retimed.length) {
          AM.log(2, `${item.name}: effect(s) ${retimed.join(', ')} would have applied on ownership `
                  + `— retimed to fire on casting`);
        }
        // Assign to the actor's spellbook
        if (spellBookId) {
          data.system = data.system || {};
          data.system.spellBook = spellBookId;
        }
        itemDatas.push(data);
        existingNames.add(item.name.toLowerCase()); // prevent within-batch dupes
      } catch (err) {
        AM.log(2, `Error fetching spell ${uuid}:`, err);
      }
    }
    if (itemDatas.length) {
      await actor.createEmbeddedDocuments('Item', itemDatas);
      AM.log(3, `Added ${itemDatas.length} spells to spellbook ${spellBookId}`);
    }
  }

  /**
   * Get spells already on the actor.
   */
  static getActorSpells(actor) {
    return actor.items
      .filter(i => i.type === 'spell')
      .map(i => ({
        id:    i.id,
        name:  i.name,
        img:   i.img,
        level: parseInt(i.system?.level ?? i.system?.spellLevel ?? 0)
      }));
  }
}
