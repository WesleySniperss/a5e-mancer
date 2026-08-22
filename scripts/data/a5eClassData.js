/**
 * Authoritative per-class data for Level Up: Advanced 5e (A5e).
 *
 * Source of truth, used by a5e-mancer as override/fallback when a compendium
 * class item omits a field. All values were verified by deterministically
 * parsing each class's level-progression table on the official SRD
 * (https://a5e.tools/rules/<class>) plus the installed a5e system's
 * CONFIG.A5E.knackTypes map — NOT hand-typed from memory.
 *
 * Per-entry fields:
 *   hitDie       — hit die size (the N in dN).
 *   knack.name   — the class's knack-equivalent feature name. In A5e EVERY class
 *                  has one, but it is named differently per class (Soldiering
 *                  Knack, Skill Trick, Developed Talent, Sign of Faith, …); this
 *                  matches CONFIG.A5E.knackTypes so the level-up UI can label it.
 *   knack.levels — CLASS levels at which a new knack/trick/talent/etc. is gained
 *                  (i.e. where the class table's "X Known" count increases).
 *
 * NOTE: Ability Score Increases are intentionally NOT stored here — in A5e they
 * are universal (4/8/12/16/19 for every class) and handled in levelUpService.js.
 *
 * Keys are lowercase base class names (strip any "(Archetype)" parenthetical and
 * trim before lookup). More fields (narrative description, icon, maneuver
 * traditions/availability) are added by later data passes.
 */
export const A5E_CLASS_DATA = {
  adept:     { hitDie: 8,  knack: { name: 'Practiced Technique',  levels: [2, 4, 6, 8, 10, 12, 14, 16, 18, 20] } },
  artificer: { hitDie: 8,  knack: { name: 'Field Discovery',      levels: [2, 4, 7, 10, 13, 16, 19] } },
  bard:      { hitDie: 8,  knack: { name: 'Adventuring Trick',     levels: [2, 6, 9, 13, 16, 20] } },
  berserker: { hitDie: 12, knack: { name: 'Developed Talent',      levels: [1, 3, 6, 8, 10, 13, 15, 18, 20] } },
  cleric:    { hitDie: 8,  knack: { name: 'Sign of Faith',         levels: [3, 7, 11, 15, 20] } },
  druid:     { hitDie: 8,  knack: { name: 'Secret of Nature',      levels: [1, 5, 9, 13, 17] } },
  fighter:   { hitDie: 10, knack: { name: 'Soldiering Knack',      levels: [1, 5, 9, 13, 17] } },
  herald:    { hitDie: 10, knack: { name: 'Divine Lesson',         levels: [3, 5, 7, 9, 11, 14, 19] } },
  marshal:   { hitDie: 10, knack: { name: 'Lesson of War',         levels: [2, 6, 10, 14, 18] } },
  psion:     { hitDie: 6,  knack: { name: 'Cognitive Discoveries', levels: [2, 5, 8, 12, 16, 18] } },
  psyknight: { hitDie: 10, knack: { name: 'Psychic Isometrics',    levels: [1, 4, 7, 10, 13, 16, 19] } },
  ranger:    { hitDie: 10, knack: { name: 'Exploration Knack',     levels: [1, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20] } },
  rogue:     { hitDie: 8,  knack: { name: 'Skill Trick',           levels: [1, 3, 5, 7, 9, 11, 13, 15, 17, 19] } },
  savant:    { hitDie: 8,  knack: { name: 'Clever Scheme',         levels: [1, 3, 5, 7, 9, 11, 13, 15, 17, 19] } },
  scientist: { hitDie: 6,  knack: { name: 'Scientific Praxes',     levels: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20] } },
  scout:     { hitDie: 8,  knack: { name: 'Clever Trick',          levels: [1, 3, 5, 7, 9, 11, 13, 15, 17, 19] } },
  sorcerer:  { hitDie: 6,  knack: { name: 'Arcane Innovation',     levels: [4, 8, 12, 16, 20] } },
  trooper:   { hitDie: 10, knack: { name: 'Drill',                 levels: [1, 3, 5, 7, 9, 11, 13, 15, 17, 19] } },
  warlock:   { hitDie: 8,  knack: { name: 'Secret of Arcana',      levels: [2, 8, 14] } },
  wizard:    { hitDie: 6,  knack: { name: 'Elective Study',        levels: [4, 8, 12, 16, 20] } },
};

/** Lowercase + strip any "(Archetype)" parenthetical, for keying into A5E_CLASS_DATA. */
export function classKey(name) {
  return (name ?? '').toLowerCase().replace(/\s*\(.*\)\s*/, '').trim();
}

/**
 * What an ADDITIONAL class hands out when you multiclass into it.
 *
 * A class taken after your first gives you only a slice of its 1st-level
 * proficiencies, listed per class in the Multiclassing Proficiencies table
 * (https://a5e.tools/rules/multiclassing) — a fighter picked up second still
 * brings armour and weapons, a cleric picked up second brings two skills and
 * nothing else. Three rules are universal, so they are not repeated per entry;
 * MulticlassRules applies them to every class, including ones missing below:
 *   – no saving throw proficiencies,
 *   – no starting equipment,
 *   – features, the class knack and combat maneuvers arrive as normal.
 *
 * Each entry names what SURVIVES of the class's own 1st-level grants; anything
 * unnamed is dropped.
 *   armor    — armor keys to keep ('light' | 'medium' | 'heavy' | 'shield');
 *              [] drops the class's armor grant outright.
 *   weapons  — 'all' keeps the weapon grant untouched (the class's multiclass
 *              list equals its full one); [] drops it; an array keeps only those
 *              keys.
 *   tools    — 'all' keeps the tool grant as it stands (a fixed kit, e.g. the
 *              rogue's thieves' tools); { total } narrows a choice to that many;
 *              null drops it.
 *   skills   — { total } narrows the class's skill choice to that many, `only`
 *              restricts which of them may be picked, `base` names skills given
 *              outright (with total 0, nothing further is asked); null drops it.
 *
 * Classes absent here — third-party ones such as artificer and savant — keep
 * their own grants apart from the three universal rules. Inventing a slice for
 * a class whose multiclassing entry we cannot read would take proficiencies
 * away on a guess, which is the one error the player would never spot.
 */
export const A5E_MULTICLASS = {
  adept:     { armor: [],                            weapons: 'all',      tools: null,         skills: null },
  bard:      { armor: ['light'],                     weapons: [],         tools: { total: 1 }, skills: { total: 1 } },
  berserker: { armor: ['light', 'medium', 'shield'], weapons: 'all',      tools: null,         skills: null },
  cleric:    { armor: [],                            weapons: [],         tools: null,         skills: { total: 2, only: ['culture', 'history', 'medicine', 'religion'] } },
  druid:     { armor: ['light', 'medium', 'shield'], weapons: [],         tools: null,         skills: null },
  fighter:   { armor: ['light', 'medium', 'shield'], weapons: 'all',      tools: null,         skills: null },
  herald:    { armor: ['light', 'medium', 'shield'], weapons: 'all',      tools: null,         skills: null },
  marshal:   { armor: ['light', 'medium', 'shield'], weapons: 'all',      tools: null,         skills: null },
  psion:     { armor: [],                            weapons: [],         tools: null,         skills: { total: 0, base: ['arcana'] } },
  psyknight: { armor: ['light', 'medium'],           weapons: 'all',      tools: null,         skills: { total: 1 } },
  ranger:    { armor: ['light', 'medium', 'shield'], weapons: 'all',      tools: null,         skills: { total: 1 } },
  rogue:     { armor: ['light'],                     weapons: [],         tools: 'all',        skills: { total: 1 } },
  scientist: { armor: ['light'],                     weapons: [],         tools: { total: 1 }, skills: { total: 1, base: ['science'] } },
  scout:     { armor: ['light'],                     weapons: ['simple'], tools: { total: 1 }, skills: { total: 1 } },
  sorcerer:  { armor: [],                            weapons: [],         tools: null,         skills: { total: 0, base: ['arcana'] } },
  trooper:   { armor: ['light', 'medium', 'shield'], weapons: 'all',      tools: null,         skills: null },
  warlock:   { armor: ['light'],                     weapons: ['simple'], tools: null,         skills: null },
  wizard:    { armor: [],                            weapons: [],         tools: null,         skills: { total: 0, base: ['arcana'] } },
};

// The three 5e names A5e replaces, kept for the same reason HIT_DICE keeps them:
// so an imported or homebrew character built on them still gets the right slice.
// Each one's 5e multiclassing entry is identical to its A5e replacement's, so
// this is an alias rather than a guess.
A5E_MULTICLASS.barbarian = A5E_MULTICLASS.berserker;   // Berserker
A5E_MULTICLASS.monk      = A5E_MULTICLASS.adept;       // Adept
A5E_MULTICLASS.paladin   = A5E_MULTICLASS.herald;      // Herald
