import { AM } from '../am.js';
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
// take.
//
// The herald used to be 0 here, on a note of mine saying its table gave no
// spell slots until 2nd level. That was misread: the Herald Spells table reads
//
//     LEVEL  CANTRIPS KNOWN  1ST  2ND 3RD 4TH 5TH
//     1st    2               2    --  --  --  --
//
// and the dashes are the 2nd-to-5th columns, not the 1st. A 1st-level herald
// has two 1st-level slots and prepares Charisma modifier + half its level
// (minimum one). Confirmed against both the Adventurer's Guide and a5e.tools.
//
// `spellsKnown` is -1 for a caster that prepares from its whole list, and a
// count for one that does not. The wizard is the awkward case: it prepares,
// but only from a spellbook, and the book is finite — "At 1st level, your
// spellbook contains six 1st-level wizard spells of your choice." So it takes
// a real number while cleric, druid and herald stay open-ended.
//
// The artificer is not the herald's case despite also being a half caster: it
// casts from spell inventions rather than slots and its maximum spell level is
// 1st from 1st level, so it keeps maxLevel: 1.
export const CLASS_SPELL_TABLES = {
  bard:      { type: 'known',    spellsKnown: 4,  cantrips: 2, maxLevel: 1 },
  sorcerer:  { type: 'known',    spellsKnown: 2,  cantrips: 4, maxLevel: 1 },
  warlock:   { type: 'known',    spellsKnown: 2,  cantrips: 2, maxLevel: 1 },
  // Prepared casters. -1 means the whole class list is available to prepare
  // from; the wizard is the exception, capped by what its spellbook holds.
  wizard:    { type: 'prepared', spellsKnown: 6,  cantrips: 3, maxLevel: 1 },
  cleric:    { type: 'prepared', spellsKnown: -1, cantrips: 3, maxLevel: 1 },
  druid:     { type: 'prepared', spellsKnown: -1, cantrips: 2, maxLevel: 1 },
  herald:    { type: 'prepared', spellsKnown: -1, cantrips: 2, maxLevel: 1 },
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
   * Half casters (herald, artificer) cast from 1st and climb half as fast.
   * Returns 0 for a class that casts nothing, so callers can tell "no spells" from
   * "cantrips only".
   */
  static maxSpellLevelFor(className, classLevel) {
    const key  = String(className ?? '').toLowerCase();
    const info = CLASS_SPELL_TABLES[key];
    if (!info) return 0;

    const lvl = Math.max(1, Math.min(20, Number(classLevel) || 1));

    // The two half casters climb identically: one spell level from 1st, then
    // 5th, 9th, 13th and 17th, capped at 5th. ceil(level / 4) is that curve.
    //
    // The herald used to be held back to 2nd level here, matching the maxLevel: 0
    // it had in the table above, and both came from the same misreading of the
    // Herald Spells table — its 1st-level row is "2 cantrips, 2 first-level
    // slots", not two cantrips and nothing. Checked against the book and
    // a5e.tools; the dashes on that row are the 2nd-to-5th columns.
    if (key === 'herald' || key === 'artificer') {
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
    // 2 to 4th, 3 from 5th, 4 from 9th. This read 2 until 9th, so a herald
    // gaining 5th was never offered its third cantrip. The book's Herald Spells
    // table and a5e's own Spellcasting (Herald) feature agree, row by row.
    herald:   { cantrips: [0,2,2,2,2,3,3,3,3,4,4,4,4,4,4,4,4,4,4,4,4], prepared: true },
    // Absent until now, and absent is not neutral: `newAtLevel` returns null for
    // a class it does not list, so the level-up dialog offered a levelling
    // artificer nothing at all — no new cantrip at 4th, none at 10th. It was in
    // CLASS_SPELL_TABLES, so character creation worked and only levelling was
    // silent. Counts from its own progression table: 2 / 3 from 4th / 4 from 10th.
    artificer: { cantrips: [0,2,2,2,3,3,3,3,3,3,4,4,4,4,4,4,4,4,4,4,4], prepared: true }
  };

  /**
   * Spell tables and the replacement rule, read from a class's own
   * Spellcasting feature - for the classes SPELLS_KNOWN does not list.
   *
   * a5e's class items carry no spells-known table, but its "Spellcasting
   * (Witch)", "Spellcasting (Elementalist)", "Pact Magic" and the rest do: the
   * table is in the description, and so is the sentence that says whether a
   * spell may be swapped on a level-up. For the classes checked against the
   * book the two agree row for row, so for the others this is the data rather
   * than a guess. Without it a witch was given two cantrips at creation where
   * her table says three, and offered a swap her rules do not have.
   *
   * SPELLS_KNOWN stays first: it is the book-checked copy, and a table read
   * from some third-party pack should not quietly overrule it.
   *
   * key: the class name reduced to lowercase letters, which is also the shape
   * of `system.classes` on these features ("fireLord" -> "firelord").
   * value: { cantrips: number[]|null, known: number[]|null, replaceable: boolean }
   */
  static featureTables = new Map();

  static tableKey(name) {
    return String(name ?? '').toLowerCase().replace(/[^a-z]/g, '');
  }

  /**
   * Read one Spellcasting feature. Returns null when it has neither a table nor
   * a replacement rule, so a feature that says nothing is not mistaken for one
   * that says "none".
   */
  static parseSpellcastingFeature(doc) {
    const html = String(doc?.system?.description?.value ?? doc?.system?.description ?? '');
    const text = html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
    const replaceable = /when you gain a[^.]*?level[^.]*?\b(?:replace|swap)\b[^.]*?spells?\b/i.test(text);

    const cell = (c) => c.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
    let cantrips = null, known = null, slotMax = null;
    for (const table of html.match(/<table[\s\S]*?<\/table>/gi) ?? []) {
      const rows = table.match(/<tr[\s\S]*?<\/tr>/gi) ?? [];
      const head = [...(rows[0] ?? '').matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(m => cell(m[1]));
      const iL = head.findIndex(h => /^level$/i.test(h));
      const iC = head.findIndex(h => /cantrips?\s*known/i.test(h));
      const iK = head.findIndex(h => /spells\s*known/i.test(h));
      if (iL === -1 || (iC === -1 && iK === -1)) continue;
      /* The slot columns, "1st" to "9th", say the highest spell level each
         class level can take - which an archetype's table is the only record
         of, since its class has no caster type to work it out from. */
      const slotCols = head.map((h, i) => [i, /^([1-9])(?:st|nd|rd|th)$/i.exec(h)?.[1]])
        .filter(([, lv]) => lv).map(([i, lv]) => [i, Number(lv)]);
      const C = new Array(21).fill(0), K = new Array(21).fill(0), S = new Array(21).fill(0);
      for (const row of rows.slice(1)) {
        const c = [...row.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(m => cell(m[1]));
        const lvl = parseInt(c[iL], 10);
        if (!(lvl >= 1 && lvl <= 20)) continue;
        if (iC !== -1) C[lvl] = parseInt(c[iC], 10) || 0;
        if (iK !== -1) K[lvl] = parseInt(c[iK], 10) || 0;
        for (const [i, lv] of slotCols) if ((parseInt(c[i], 10) || 0) > 0) S[lvl] = Math.max(S[lvl], lv);
      }
      if (iC !== -1) cantrips = C;
      if (iK !== -1) known = K;
      if (slotCols.length) slotMax = S;
      break;
    }
    if (!cantrips && !known && !replaceable) return null;
    return { cantrips, known, replaceable, slotMax };
  }

  /**
   * Collect the Spellcasting features once per session.
   *
   * Names first, from the plain index, then only the matching documents are
   * read - about two dozen, not the four thousand features in a5e's pack. A
   * class with more than one feature that could be its own ("Spellcasting"
   * beside an archetype's) is left out rather than guessed at, unless one of
   * them names the class in brackets.
   */
  static async loadSpellcastingFeatures() {
    const byClass = new Map();   // key -> [{ named, parsed }]
    const packs = PackFilter.itemPacks()
      .sort((a, b) => (a.metadata?.packageType === 'system' ? 0 : 1) - (b.metadata?.packageType === 'system' ? 0 : 1));

    for (const pack of packs) {
      let index;
      try { index = await pack.getIndex(); } catch { continue; }
      for (const entry of index) {
        if (entry.type && entry.type !== 'feature') continue;
        const m = /^(?:Spellcasting|Pact Magic)(?:\s*\((.+)\))?$/.exec(entry.name ?? '');
        if (!m) continue;
        let doc;
        try { doc = await pack.getDocument(entry._id); } catch { continue; }
        const classes = doc?.system?.classes;
        const key = this.tableKey(typeof classes === 'string' ? classes : '');
        if (!key) continue;
        const parsed = this.parseSpellcastingFeature(doc);
        if (!parsed) continue;
        const list = byClass.get(key) ?? [];
        list.push({ named: m[1] ? this.tableKey(m[1]) === key : false, bare: !m[1], parsed });
        byClass.set(key, list);
      }
    }

    /* A class that casts nothing has no Spellcasting feature of its own, so a
       bare "Spellcasting" naming it belongs to one of its archetypes. a5e's
       Arcane Sniper, Curseweaver, Forbidden Fist, Hedge Mage, Wrathburner and
       Arcane Showoff are all written that way, and each was taken as its whole
       class's table: every ranger had the Arcane Sniper's cantrip counts and
       its spell swap, every fighter the Arcane Showoff's. Those tables are read
       per archetype instead - see archetypeCasting. */
    const nonCasters = new Set(), casters = new Set();
    for (const pack of packs) {
      let index;
      try { index = await PackFilter.indexOf(pack, ['name', 'type', 'system'], { types: ['class'] }); } catch { continue; }
      for (const entry of index) {
        if (entry.type !== 'class') continue;
        const type = entry.system?.spellcasting?.casterType;
        if (type === undefined) continue;                  // not read: decide nothing
        (type && type !== 'none' ? casters : nonCasters).add(this.tableKey(entry.name));
      }
    }

    this.featureTables = new Map();
    for (const [key, list] of byClass) {
      const named = list.find(x => x.named);
      const bare  = (nonCasters.has(key) && !casters.has(key)) ? [] : list.filter(x => x.bare);
      const pick  = named ?? (bare.length === 1 ? bare[0] : null);
      if (pick) this.featureTables.set(key, pick.parsed);
    }
    AM.log(3, `Spellcasting features read for ${this.featureTables.size} class(es)`);
    return this.featureTables;
  }

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
    let t = this.SPELLS_KNOWN[key];
    if (!t) {
      const f = this.featureTables.get(this.tableKey(className));
      if (!f?.cantrips && !f?.known) return null;
      t = { cantrips: f.cantrips ?? [], known: f.known ?? undefined, prepared: !f.known };
    }

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
  /* The witch prepares by the ability she chose, which is a5e's
     `@spellcasting.mod + @classes.witch.level`. */
  static PREPARED_RULES = {
    cleric: { ability: 'wis', per: 1 },
    druid:  { ability: 'wis', per: 1 },
    wizard: { ability: 'int', per: 1 },
    herald: { ability: 'cha', per: 0.5 },
    witch:  { ability: 'spellcasting', per: 1 }
  };

  static preparedCount(actor, className, classLevel) {
    const key = String(className ?? '').toLowerCase();
    return this.preparedCountFor(className, classLevel, (ability) => {
      if (ability === 'spellcasting') {
        const cls = actor?.items?.find?.(i => i.type === 'class' && i.name?.toLowerCase() === key);
        ability = cls?.system?.spellcasting?.ability?.value || cls?.system?.spellcasting?.ability?.base;
        if (!ability || ability === 'none') return null;
      }
      return actor?.system?.abilities?.[ability]?.value ?? 10;
    });
  }

  /**
   * The same count, from whatever knows the ability score. The builder has no
   * actor yet, so it passes a function reading its own form.
   *
   * @param {(ability: string) => number|null} scoreOf  null when unknown
   * @returns {number|null}
   */
  static preparedCountFor(className, classLevel, scoreOf) {
    const rule = this.PREPARED_RULES[String(className ?? '').toLowerCase()];
    if (!rule) return null;
    const score = scoreOf(rule.ability);
    if (score === null || score === undefined) return null;
    const mod = Math.floor((Number(score) - 10) / 2);
    const lvl = Math.max(1, Math.min(20, Number(classLevel) || 1));
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

  /* ── Archetype spellcasting ───────────────────────────────────────────── */

  /** archetype uuid -> parsed casting, or null when it brings none */
  static archetypeCastingCache = new Map();

  /**
   * The spellcasting an archetype brings to a class that has none of its own -
   * a5e's "tertiary casters": the Dark Eye and Sacred Agent rogue, the
   * Wildborn and Arcane Sniper ranger, the Ecclesiarch and Curseweaver
   * marshal, and the rest.
   *
   * Nothing on the archetype item says how many spells it gives or from where.
   * It is all in one of the features it grants, as a table and three sentences,
   * and every one found follows the same shape: cantrips "of your choice" from a
   * list or from schools, spells of 1st level and up the same way, the table's
   * Cantrips Known and Spells Known columns for the counts and its slot columns
   * for the highest level, and a sentence allowing one swap a level.
   *
   * @param {Item} archetypeDoc
   * @returns {Promise<object|null>} { cantrips, known, slotMax, replaceable,
   *          cantripRule, spellRule, fromLevel, feature, archetype }
   */
  static async archetypeCasting(archetypeDoc) {
    if (!archetypeDoc) return null;
    const key = archetypeDoc.uuid ?? archetypeDoc._id ?? archetypeDoc.name;
    if (this.archetypeCastingCache.has(key)) return this.archetypeCastingCache.get(key);

    let found = null;
    // The source record: a plain object keyed by grant id, on a pack document and an owned one alike
    const grants = archetypeDoc._source?.system?.grants ?? archetypeDoc.system?.grants ?? {};
    const list = grants instanceof Map ? [...grants.values()] : Object.values(grants);
    const ordered = list.filter(g => g?.grantType === 'feature')
      .sort((a, b) => (Number(a.level) || 1) - (Number(b.level) || 1));
    outer:
    for (const grant of ordered) {
      for (const entry of grant.features?.base ?? []) {
        const uuid = entry?.uuid ?? entry;
        if (typeof uuid !== 'string') continue;
        let doc = null;
        try { doc = await fromUuid(uuid); } catch { doc = null; }
        const parsed = doc ? this.parseArchetypeCasting(doc) : null;
        if (!parsed) continue;
        found = { ...parsed, fromLevel: Number(grant.level) || 1, feature: doc.name, archetype: archetypeDoc.name };
        break outer;
      }
    }
    this.archetypeCastingCache.set(key, found);
    return found;
  }

  /**
   * Read one archetype spellcasting feature. Null unless it has a count to
   * give and a rule saying where the spells come from - offering spells with no
   * rule behind them would be inventing one.
   */
  static parseArchetypeCasting(doc) {
    const table = this.parseSpellcastingFeature(doc);
    if (!table?.cantrips && !table?.known) return null;

    const html = String(doc?.system?.description?.value ?? doc?.system?.description ?? '');
    /* Blocks end a sentence too. Without that a heading ran into the sentence
       after it - "Table: Arcane Sniper Spellcasting ... You know one 1st-level
       spell" - and "Arcane" was read as the arcane school. */
    const text = html.replace(/<table[\s\S]*?<\/table>/gi, '\n')
      .replace(/<\/(?:p|h[1-6]|li|div|tr)>|<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&rsquo;|&lsquo;|&ldquo;|&rdquo;/g, ' ')
      .replace(/[ \t]+/g, ' ');
    const sentences = text.split(/\n+|(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean);

    const choice = /\bof your choice\b|\byour choice of\b/i;
    const cantripSentence = sentences.find(s => /\bcantrips?\b/i.test(s) && choice.test(s));
    const spellSentence = sentences.find(s => !/\bcantrips?\b/i.test(s) && choice.test(s)
      && /\b(?:[1-9](?:st|nd|rd|th)|first)-level spells?\b|\bspells?\b/i.test(s));

    const cantripRule = this.#spellRuleFrom(cantripSentence);
    const spellRule = this.#spellRuleFrom(spellSentence);
    if (!cantripRule && !spellRule) return null;

    /* Where the table and its own text disagree, the text. Every one of these
       says "You learn an additional cantrip at 10th level"; the Hedge Mage's
       table still reads 2 there. */
    let cantrips = table.cantrips;
    const extra = /\badditional cantrip at (\d+)(?:st|nd|rd|th) level\b/i.exec(text);
    if (cantrips && extra) {
      const at = Number(extra[1]);
      if (at >= 2 && at <= 20 && cantrips[at] <= cantrips[at - 1]) {
        cantrips = cantrips.map((c, lv) => (lv >= at ? c + 1 : c));
      }
    }

    /* A table with no Spells Known column - the Hedge Mage's - still has the
       sentence giving the first ones. That number, and nothing invented after
       it: `known` stays null, and the level-up leaves later counts open. */
    const NUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
    const first = /\b(one|two|three|four|five|six)\s+(?:1st|first)-level spells?\b/i.exec(spellSentence ?? '');

    return {
      cantrips,
      known: table.known,
      firstSpells: first ? NUM[first[1].toLowerCase()] : null,
      slotMax: table.slotMax,
      replaceable: table.replaceable,
      // A feature that states one rule means it for both
      cantripRule: cantripRule ?? spellRule,
      spellRule: spellRule ?? cantripRule
    };
  }

  /**
   * "from the wizard spell list", "from the warlock list or the unarmed school",
   * "from the following schools: obscurement, scrying, senses, and shadow".
   * Lists are matched against a5e's own list keys, schools against its own
   * school keys, so a word that is neither is not mistaken for one.
   */
  static #spellRuleFrom(sentence) {
    if (!sentence) return null;
    const lists = new Set();
    for (const m of sentence.matchAll(/\b([A-Za-z]+)\s+(?:spell\s+)?list\b/gi)) {
      const k = this.classSpellListKey(m[1]);
      if (k) lists.add(k);
    }
    const schools = new Set();
    if (/\bschools?\b/i.test(sentence)) {
      const known = [
        ...Object.keys(CONFIG?.A5E?.spellSchools?.secondary ?? {}),
        ...Object.keys(CONFIG?.A5E?.spellSchools?.primary ?? {})
      ];
      for (const s of known) {
        if (new RegExp(`\\b${s.replace(/[^a-z]/gi, '')}\\b`, 'i').test(sentence)) schools.add(s.toLowerCase());
      }
    }
    if (!lists.size && !schools.size) return null;
    return { lists: [...lists], schools: [...schools] };
  }

  /**
   * Whether a spell can be chosen under an archetype's rule: on one of its
   * lists, or in one of its schools. A rare spell is never offered through a
   * school - a5e's rare spells are found or granted, not chosen - which is the
   * same line the class lists already draw.
   */
  static spellFitsRule(sys, rule, uuid = '') {
    if (!rule) return false;
    if (uuid && this.extraAllowed.has(uuid)) return true;
    if (rule.lists.some(k => this.spellAllowsClass(sys, k, uuid))) return true;
    if (!rule.schools.length || sys?.rare) return false;
    const raw = sys?.schools?.secondary ?? [];
    const mine = [
      SpellService.normalizeSchool(sys?.schools?.primary ?? sys?.school ?? ''),
      ...(Array.isArray(raw) ? raw : Object.keys(raw))
    ].map(s => String(s ?? '').toLowerCase());
    return rule.schools.some(s => mine.includes(s));
  }

  /** The loadSpells predicate for an archetype: its cantrip rule for cantrips, its spell rule above. */
  static archetypeSpellFilter(casting) {
    const fn = (sys, uuid) => this.spellFitsRule(sys,
      Number(sys?.level ?? sys?.spellLevel ?? 0) === 0 ? casting.cantripRule : casting.spellRule, uuid);
    fn.label = `${casting.archetype} (${casting.feature})`;
    return fn;
  }

  static replaceableOnLevelUp(className) {
    /* By what the class's rules say, not by caster type. "Known" was right for
       the bard, sorcerer and warlock, but it was read through
       getClassSpellInfo, whose fallback is whichever class was last looked up
       - so a witch, who prepares and has no swap, was offered one, and an
       elementalist, who has one, got it only by luck. The rule is written in
       each class's Spellcasting feature; see featureTables. */
    const core = CLASS_SPELL_TABLES[String(className ?? '').toLowerCase()];
    if (core) return core.type === 'known' ? 1 : 0;
    return this.featureTables.get(this.tableKey(className))?.replaceable ? 1 : 0;
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
        || casterType === 'wielder'
        /* The artificer casts from 1st through spell inventions, and its own
           table reads "Maximum Spell Level: 1st" at 1st level —
           CLASS_SPELL_TABLES.artificer says maxLevel 1 for exactly that
           reason. Leaving artificerA5e out of this list made the two
           disagree, and the class that fell between them was Artificer
           (Revised): its name misses the static table, so it took the dynamic
           path, which then refused it. Checked across all 30 classes in a5e’s
           pack — it was the only caster of the fifteen getting an empty spell
           tab. */
        || casterType === 'artificerA5e';

      // Half-casters (ranger, herald archetype variants) get spells at level 2+ — no level-1 picker
      if (requireSpellsAtFirst && !hasSpellsAtOne) return null;

      // The gate above is a CREATION rule: a half caster has no slots at 1st, so
      // the builder must not show it a spell tab. At level-up it is wrong — a
      // half caster at 5th certainly casts — so the caller can turn it off.
      const isPrepared = ['halfCaster', 'halfCasterWithFirstLevel'].includes(casterType) && !isFullCaster;
      /* The class's own table when its Spellcasting feature has one. The
         numbers below were a guess - two cantrips and two spells for any full
         caster - and the witch's table says three cantrips and no spells known,
         because she prepares. */
      const table = this.featureTables.get(this.tableKey(item.name));
      const info = (table?.cantrips || table?.known)
        ? {
            type: table.known ? 'known' : 'prepared',
            cantrips: table.cantrips?.[1] ?? 0,
            spellsKnown: table.known ? (table.known[1] ?? 0) : -1,
            maxLevel: 1
          }
        : {
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

    /* Three cases, and the middle one used to be folded into the last.

         no name at all      nothing to go on, so hide nothing
         a name a5e knows    filter to that class's list
         a name with no list this class does not cast; show nothing

       a5e keeps seventeen spell lists and the Berserker is on none of them,
       along with the Fighter, the Rogue and the rest. The old rule read
       'no list' as 'no restriction', so opening the spell window on a
       Berserker offered every spell in every compendium — 895 of them, none
       of which that character can ever learn. The comment where this was
       decided called it costing nothing. It cost the whole window.

       A blank name still hides nothing, because that is a genuine unknown
       rather than an answer. */
    if (!String(className ?? '').trim()) return true;
    const key = this.classSpellListKey(className);
    if (!key) return false;                     // named, and a5e gives it no spell list

    /* A spell that names no class is on no class's list, so it is not offered
       to one. Both shapes count: the field absent, and the field present but
       empty. Both used to read as "unrestricted" and put the spell in front of
       everybody — 478 of them in the reporter's world, 56 of those reachable by
       a 1st-level cleric.

       Measured before changing, because hiding real spells would be the worse
       error. Of the 103 in a5e's own pack with an empty list, 99 are marked
       `rare` — and a5e's rare spells belong to no class list by design; they
       are found or granted, never learned from one. The other four (Message,
       Witch's Broom, Sufferer's Pact, Calatyr's Explosive Conflagration) are
       genuine gaps in the data, and they are counted in the log below rather
       than quietly dropped. The remaining 375 sit in the 5e conversion pack and
       a third-party one. */
    const raw = sys?.classes ?? sys?.spellClasses ?? null;
    if (raw === null || raw === undefined) return false;

    // Array, Set, or any other iterable — the same spread a5e uses
    let list = [];
    if (typeof raw === 'string')            list = raw.split(/[,;/|]/);
    else if (typeof raw?.[Symbol.iterator] === 'function') list = [...raw];
    else if (typeof raw === 'object')       list = Object.keys(raw);

    const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z]/g, '');
    const wanted = norm(key);
    const normalized = list.map(norm).filter(Boolean);
    if (!normalized.length) return false;       // names no class — see above

    return normalized.includes(wanted);
  }

  /**
   * Load all spells from compendiums, grouped by level then class.
   * Returns: Map<level (0–9), spell[]>
   */
  /** The eight primary schools, as a5e spells them. */
  static #PRIMARY_SCHOOLS = ['abjuration', 'conjuration', 'divination', 'enchantment',
                             'evocation', 'illusion', 'necromancy', 'transmutation'];

  /**
   * One school key, however the pack chose to write it.
   *
   * The filter row builds its pills from the spells themselves, so a pack that
   * abbreviates put a second pill beside the real one: "Con" next to
   * "Conjuration", "Trs" next to "Transmutation", and so on for five more. In
   * the reporter's world 46 spells across seven abbreviations did this, all
   * from one third-party pack.
   *
   * Most abbreviations are prefixes and resolve by matching; "trs" is not one,
   * so it is named. Anything still unrecognised is handed back untouched — a
   * genuinely new school should appear rather than be silently folded into a
   * neighbour.
   */
  static normalizeSchool(raw) {
    const key = String(raw ?? '').trim().toLowerCase();
    if (!key || this.#PRIMARY_SCHOOLS.includes(key)) return key;
    if (key === 'trs') return 'transmutation';
    const hit = this.#PRIMARY_SCHOOLS.filter(s => s.startsWith(key));
    return hit.length === 1 ? hit[0] : key;   // ambiguous prefixes stay as they are
  }

  /**
   * @param {string|Function|null} filterClass  a class name to filter to its
   *        list; or a predicate (system, uuid) => boolean for a list that is
   *        not a class's - an archetype's, which may be a school; or null
   */
  static async loadSpells(filterClass = null, maxLevel = 9) {
    const byLevel = new Map();
    for (let i = 0; i <= 9; i++) byLevel.set(i, []);

    /* Same note the maneuver loader keeps: an empty window should be able to
       say what it read rather than leaving it to be worked out from outside. */
    const report = { packs: 0, read: 0, failed: [], spells: 0, filteredBy: '', unclassed: 0 };
    this.lastLoadReport = report;

    const packs = PackFilter.itemPacks();
    report.packs = packs.length;
    report.filteredBy = typeof filterClass === 'function' ? (filterClass.label ?? 'a custom list') : (filterClass || '');
    const allows = typeof filterClass === 'function'
      ? filterClass
      : (sys, uuid) => this.spellAllowsClass(sys, filterClass, uuid);

    for (const pack of packs) {
      try {
        const index = await PackFilter.indexOf(pack,
          ['name', 'type', 'img', 'system'], { types: ['spell'] });
        for (const entry of index) {
          if (entry.type !== 'spell') continue;
          /* No class list at all means the index arrived without its system
             data, and with it the class filter that makes this window usable.
             Counted so an unfiltered window can say so. */
          if (entry.system?.classes === undefined) report.unclassed++;

          const level  = parseInt(entry.system?.level ?? entry.system?.spellLevel ?? 0);
          if (level > maxLevel) continue;

          // Filter by class if specified. The uuid is passed so a spell named by
          // an expanded list is admitted even though it is not a class spell —
          // which is exactly what an expanded list is for.
          const uuid = entry.uuid ?? `Compendium.${pack.collection}.Item.${entry._id}`;
          if (filterClass && !allows(entry.system, uuid)) continue;

          const school = SpellService.normalizeSchool(
            entry.system?.schools?.primary ?? entry.system?.school ?? '');
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
        report.failed.push(`${pack.collection}: ${err.message}`);
        AM.log(2, `Error loading spells from ${pack.collection}:`, err);
      }
    }

    // Sort each level alphabetically
    for (const [level, spells] of byLevel) {
      byLevel.set(level, spells.sort((a, b) => a.name.localeCompare(b.name)));
    }

    for (const list of byLevel.values()) report.spells += list.length;
    report.read = report.packs - report.failed.length;
    AM.log(report.unclassed ? 2 : 3,
           `Spells: ${report.spells} from ${report.read} of ${report.packs} packs`
            + (report.unclassed ? `; ${report.unclassed} arrived with no class list` : '')
            + (report.filteredBy ? `, filtered to ${report.filteredBy}` : ', unfiltered')
            + (report.failed.length ? `; failed: ${report.failed.join(' | ')}` : ''));

    return byLevel;
  }

  /**
   * Add selected spells to actor.
   */
  /**
   * @param {object} [opts]
   * @param {number} [opts.prepared]  a5e's prepared state to write (2 = always prepared)
   * @param {(uuid: string) => object} [opts.flags]  module flags for each created spell
   * @param {number} [opts.prepareRoom]  how many of the new levelled spells to
   *        mark prepared, in the order given - see preparedRoom. a5e's packs
   *        ship spells unprepared, so a cleric made here held nothing prepared
   *        and a wizard's sheet showed none. Given, it decides the state of
   *        every new spell but an always-prepared one: twelve pack entries
   *        arrive at 1 by accident, seven of them cantrips (Trick Shot, Arcing
   *        Blow...), and a5e counts those against the total like any other.
   * @param {string} [opts.spellBookId]  the book to file them in - the one the
   *        sheet is showing. Without it, the actor's first book.
   */
  static async applySpellsToActor(actor, spellUuids, { prepared = null, flags = null, prepareRoom = null, spellBookId: bookId = null } = {}) {
    if (!spellUuids.length) return;

    // A5e requires spells to reference a spellbook on the actor.
    // The spellbook is created by class grants when the class item is added.
    const books = Object.keys(actor.system?.spellBooks ?? {});
    const spellBookId = (bookId && books.includes(bookId) ? bookId : null)
      ?? actor.spellBooks?.first()?._id
      ?? books[0]
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
        if (prepared !== null) {
          data.system = data.system || {};
          data.system.prepared = prepared;
        } else if (prepareRoom !== null && Number(data.system?.prepared ?? 0) !== 2) {
          // Cantrips are left unprepared: a5e counts anything at state 1
          // against the prepared total, cantrips included.
          data.system = data.system || {};
          const levelled = Number(data.system.level ?? 0) > 0;
          data.system.prepared = levelled && prepareRoom > 0 ? 1 : 0;
          if (data.system.prepared) prepareRoom--;
        }
        if (flags) {
          data.flags = data.flags || {};
          data.flags[AM.ID] = { ...(data.flags[AM.ID] ?? {}), ...flags(uuid) };
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
   * How many spells the character may hold prepared.
   *
   * The number on the actor when one was entered - a5e's footer field - and
   * otherwise each preparing class's rule, summed for a multiclass. a5e's own
   * fallback to the class formulas never runs (its filter asks for an item that
   * is a class and an archetype at once), so the rules are read here instead.
   *
   * @returns {number|null} null when nothing the character has prepares by count
   */
  static preparedCap(actor) {
    const entered = Number(actor?.system?.spellResources?.maxPrepared ?? 0);
    if (entered > 0) return entered;
    let total = null;
    for (const cls of actor?.items?.filter?.(i => i.type === 'class') ?? []) {
      const n = this.preparedCount(actor, cls.name, cls.system?.classLevels ?? 1);
      if (n !== null) total = (total ?? 0) + n;
    }
    return total;
  }

  /** Spells held prepared as a5e counts them: state 1. Always prepared (2) is free. */
  static preparedHeld(actor) {
    return actor?.items?.filter?.(i => i.type === 'spell'
      && Number(i.system?.prepared ?? 0) === 1).length ?? 0;
  }

  /** Prepared places still free - what new spells may be marked prepared into. */
  static preparedRoom(actor) {
    const cap = this.preparedCap(actor);
    return cap === null ? 0 : Math.max(0, cap - this.preparedHeld(actor));
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
