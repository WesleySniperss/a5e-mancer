/* The Add Feat filter's verdicts on feat prerequisites - FeatService.checkPrerequisite -
 * for the shapes a5e and the imported feats write, and over every feat there is.
 *
 * Three verdicts, and the difference between the last two is the point: met,
 * not met (hidden under "only ones I qualify for"), and unknown (always shown -
 * hiding a feat the character may qualify for is worse than showing a line of
 * text). A shape newly read must never turn a feat the character qualifies for
 * into "not met"; the "any of these" lists below are that case.
 *
 * Reads a5e's feats from tools/import/.cache: run tools/import/prepare.cjs once.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const R = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PACKS = path.join(R, 'tools', 'import', '.cache', 'packs');
if (!fs.existsSync(path.join(PACKS, 'feats.json'))) {
  console.log('tools/import/.cache/packs is empty - run node tools/import/prepare.cjs first');
  process.exit(1);
}
const read = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const a5eFeats = read(path.join(PACKS, 'feats.json'));
const imported = read(path.join(R, 'scripts', 'data', 'imported', 'a5etools-content.json')).filter(d => d.type === 'feature' && d.system.featureType === 'feat');
const feats = [...a5eFeats, ...imported];

class Collection extends Map {
  [Symbol.iterator]() { return this.values(); }
  get contents() { return [...this.values()]; }
  filter(f) { return this.contents.filter(f); }
}
const index = new Collection(feats.map(d => [d._id, { _id: d._id, name: d.name, type: d.type, img: d.img, system: d.system }]));
const pack = { collection: 'check.feats', metadata: { type: 'Item', label: 'Feats' }, index, async getIndex() { return index; } };
globalThis.foundry = { utils: { hasProperty: () => false } };
globalThis.game = { i18n: { localize: (k) => k, format: (k) => k }, user: { isGM: true }, modules: new Map(),
  packs: new Collection([['check.feats', pack]]), settings: { get: () => false, storage: new Map() } };
globalThis.CONFIG = { A5E: { products: {},
  classes: { artificer: 'Artificer', bard: 'Bard', cleric: 'Cleric', fighter: 'Fighter', herald: 'Herald', savant: 'Savant', scholar: 'Scholar', warlock: 'Warlock', wielder: 'Wielder', witch: 'Witch', wizard: 'Wizard' },
  weapons: { simple: { club: 'Club', dagger: 'Dagger' }, martial: { longsword: 'Longsword', rapier: 'Rapier' } },
  maneuverTraditions: { aceStarfighter: 'Ace Starfighter', adamantMountain: 'Adamant Mountain' } } };
globalThis.ui = { notifications: { warn() {}, error() {}, info() {} } };
globalThis.Hooks = { on() {}, once() {} };
const { AM } = await import(pathToFileURL(path.join(R, 'scripts', 'am.js')).href);
AM.log = () => {};
const { FeatService } = await import(pathToFileURL(path.join(R, 'scripts', 'utils', 'featService.js')).href);
await FeatService.loadAll();

const results = [];
const check = (n, ok, d = '') => results.push(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`);
const actor = ({ cls = 'Fighter', level = 1, more = [], caster = 'none', archetype = null, score = 10, scores = {}, skills = {}, traditions = [],
  feats: owned = [], spells = [], background = null, heritage = null, culture = null, destiny = null, armor = [], weapons = [], prof = 2 } = {}) => ({
  items: [
    { type: 'class', name: cls, system: { classLevels: level, spellcasting: { casterType: caster } } },
    ...more.map(([name, lv]) => ({ type: 'class', name, system: { classLevels: lv, spellcasting: { casterType: 'none' } } })),
    ...(archetype ? [{ type: 'archetype', name: archetype, system: {} }] : []),
    ...owned.map(n => ({ type: 'feature', name: n, system: { featureType: 'feat' } })),
    ...spells.map(l => ({ type: 'spell', name: `Spell ${l}`, system: { level: l } })),
    ...(background ? [{ type: 'background', name: background, system: {} }] : []),
    ...(heritage ? [{ type: 'heritage', name: heritage, system: {} }] : []),
    ...(culture ? [{ type: 'culture', name: culture, system: {} }] : []),
    ...(destiny ? [{ type: 'destiny', name: destiny, system: {} }] : [])
  ],
  system: {
    abilities: Object.fromEntries(['str', 'dex', 'con', 'int', 'wis', 'cha'].map(a => [a, { value: scores[a] ?? score }])),
    skills: Object.fromEntries(skills.map ? skills.map(k => [k, { proficient: 1 }]) : []),
    proficiencies: { traditions, armor, weapons },
    attributes: { prof, exertion: { max: 0 } }
  }
});
const verdict = (a, prerequisite) => {
  const r = FeatService.checkPrerequisite(a, { prerequisite });
  return r.unknown ? 'unknown' : r.met ? 'met' : 'not met';
};
const CASES = [
  // [label, prerequisite, actor, expected]
  ['a5e\'s "3 herald"', '3 herald', actor({ cls: 'Herald', level: 3 }), 'met'],
  ['a5e\'s "War Dancer feat", not had', 'War Dancer feat', actor(), 'not met'],
  ['"Strength 13 or higher" is still judged, not unknown', 'Strength 13 or higher', actor(), 'not met'],
  ['"8th level or higher", at 8th', '8th level or higher', actor({ level: 8 }), 'met'],
  ['"8th level or higher", at 1st', '8th level or higher', actor(), 'not met'],
  ['a feat named without the word, had', 'Steel Protector', actor({ feats: ['Steel Protector'] }), 'met'],
  ['a feat named without the word, not had', 'Steel Protector', actor(), 'not met'],
  ['"A, B, C, or D": any one of them is enough', 'Alpha Wereboar, Eye of the Tiger, Moonhowler, Rodent Embraced, or Werebear Emerged', actor({ feats: ['Moonhowler'] }), 'met'],
  ['"A, B, C, or D": none of them', 'Alpha Wereboar, Eye of the Tiger, Moonhowler, Rodent Embraced, or Werebear Emerged', actor(), 'not met'],
  // "Pack Initiative" is how a5e writes the Pack Initiate feat there: read as it
  ['"A, B, or D" with a near miss of a feat name: judged, none had', 'Hibernating Affliction, Pack Initiative, Rat Within, Striped Soul, or Swineheart', actor(), 'not met'],
  ['...and met by the feat the near miss names', 'Hibernating Affliction, Pack Initiative, Rat Within, Striped Soul, or Swineheart', actor({ feats: ['Pack Initiate'] }), 'met'],
  ['...and met by the feat that is one', 'Hibernating Affliction, Pack Initiative, Rat Within, Striped Soul, or Swineheart', actor({ feats: ['Striped Soul'] }), 'met'],
  ['"A, B, and C feats" needs all three', 'Holy Warrior, Fighting Idealist, and Sworn Chaplain feats', actor({ feats: ['Holy Warrior', 'Fighting Idealist'] }), 'not met'],
  ['"Intelligence or Wisdom 13 or higher": the score is both\'s', 'Intelligence or Wisdom 13 or higher', actor({ scores: { wis: 14 } }), 'met'],
  ['...and neither at 10', 'Intelligence or Wisdom 13 or higher', actor(), 'not met'],
  ['"Proficiency with Stealth", proficient', 'Proficiency with Stealth', actor({ skills: ['ste'] }), 'met'],
  ['"Proficiency in Investigation or Perception", one of them', 'Proficiency in Investigation or Perception', actor({ skills: ['prc'] }), 'met'],
  ['"Proficiency with land vehicles" is not judged', 'Proficiency with land vehicles', actor(), 'unknown'],
  ['"Ace Starfighter combat tradition", known', 'Ace Starfighter combat tradition', actor({ traditions: ['aceStarfighter'] }), 'met'],
  ['"Ace Starfighter combat tradition", not known', 'Ace Starfighter combat tradition', actor(), 'not met'],
  ['"the ability to cast at least one spell of 1st-level or higher", a cantrip only', 'The ability to cast at least one spell of 1st-level or higher', actor({ spells: [0] }), 'not met'],
  ['...with a 1st-level spell', 'The ability to cast at least one spell of 1st-level or higher', actor({ spells: [0, 1] }), 'met'],
  ['"Noble background or the favor of a noble", noble', 'Noble background or the favor of a noble', actor({ background: 'Noble' }), 'met'],
  ['...not noble: the favor cannot be judged, so shown', 'Noble background or the favor of a noble', actor(), 'unknown'],
  ['"Power Caster, proficiency in Arcana", neither', 'Power Caster , proficiency in Arcana', actor(), 'not met'],
  // the shapes that used to go unjudged, and so passed every filter
  ['"3 levels of cleric, 3 levels of wielder", both', '3 levels of cleric, 3 levels of wielder', actor({ cls: 'Cleric', level: 3, more: [['Wielder', 3]] }), 'met'],
  ['...a cleric alone', '3 levels of cleric, 3 levels of wielder', actor({ cls: 'Cleric', level: 5 }), 'not met'],
  ['"Artificer level 3, Savant level 3", both', 'Artificer level 3, Savant level 3', actor({ cls: 'Artificer', level: 3, more: [['Savant', 3]] }), 'met'],
  ['...a fighter', 'Artificer level 3, Savant level 3', actor(), 'not met'],
  ['"warlock (diabolist archetype) and witch", both', 'warlock (diabolist archetype) and witch', actor({ cls: 'Warlock', level: 3, archetype: 'Diabolist', more: [['Witch', 1]] }), 'met'],
  ['...the wrong archetype', 'warlock (diabolist archetype) and witch', actor({ cls: 'Warlock', level: 3, archetype: 'Fiend', more: [['Witch', 1]] }), 'not met'],
  ['"Seal skin feature from the selkie heritage", a selkie', 'Seal skin feature from the selkie heritage', actor({ heritage: 'Selkie' }), 'met'],
  ['...a dwarf', 'Seal skin feature from the selkie heritage', actor({ heritage: 'Dwarf' }), 'not met'],
  ['"X culture", "X destiny": the character\'s own', 'Stoic Orc culture, Saint destiny', actor({ culture: 'Stoic Orc', destiny: 'Saint' }), 'met'],
  ['...another culture', 'Stoic Orc culture', actor({ culture: 'Deep Gnome' }), 'not met'],
  ['"Proficiency with medium armor"', 'Proficiency with medium armor', actor({ armor: ['light', 'medium'] }), 'met'],
  ['...light only', 'Proficiency with medium armor', actor({ armor: ['light'] }), 'not met'],
  ['"Proficiency with shields"', 'Proficiency with shields', actor({ armor: ['shield'] }), 'met'],
  ['"Proficiency with at least one martial weapon"', 'Proficiency with at least one martial weapon', actor({ weapons: ['dagger', 'rapier'] }), 'met'],
  ['...simple weapons only', 'Proficiency with at least one martial weapon', actor({ weapons: ['dagger'] }), 'not met'],
  ['"Proficiency with the Arcana or Religion skill"', 'Proficiency with the Arcana or Religion skill', actor({ skills: ['rel'] }), 'met'],
  ['"You must have the spellcasting feature", a caster', 'You must have the spellcasting feature', actor({ cls: 'Cleric', caster: 'full' }), 'met'],
  ['...a fighter', 'You must have the spellcasting feature', actor(), 'not met'],
  ['"Exertion pool of at least 4 and either the Spellcasting feature, ... or the Pact Magic feature", a caster', 'Exertion pool of at least 4 and either the Spellcasting feature, the Magic Wielding feature, or the Pact Magic feature', actor({ cls: 'Cleric', caster: 'full' }), 'met'],
  ['...a fighter', 'Exertion pool of at least 4 and either the Spellcasting feature, the Magic Wielding feature, or the Pact Magic feature', actor(), 'not met'],
  ['"4 levels in wielder, no levels in non-wielder classes", a multiclass', '4 levels in wielder, no levels in non-wielder classes', actor({ cls: 'Wielder', level: 4, more: [['Fighter', 1]] }), 'not met']
];
for (const [label, prereq, a, want] of CASES) {
  const got = verdict(a, prereq);
  check(label, got === want, got === want ? '' : `"${prereq}" -> ${got}, not ${want}`);
}
/* A sub-feat's parent is its prerequisite, and a description's "Prerequisite:" is one. */
const loaded = await FeatService.loadAll({ force: true });
const byName = (name) => loaded.find(x => x.name === name);
check('"Bear Grab (Hibernating Affliction)" is gated on its parent feat', byName('Bear Grab (Hibernating Affliction)')?.prerequisite === 'Hibernating Affliction feat', byName('Bear Grab (Hibernating Affliction)')?.prerequisite);
check('...and so kept by no "no prerequisite" filter', byName('Bear Grab (Hibernating Affliction)')?.gated === true);
check('Eldritch Rager takes its prerequisite from its description', byName('Eldritch Rager')?.prerequisite === 'Wrathful Bargainer feat', byName('Eldritch Rager')?.prerequisite);
const eligibleFighter = await FeatService.optionsFor(actor(), { onlyEligible: true });
check('"only ones I qualify for" keeps no unjudged feat', eligibleFighter.every(x => x.met && !x.unknown), `${eligibleFighter.length} kept, ${eligibleFighter.unchecked} unjudged hidden`);
const unknown = (list) => list.filter(d => FeatService.checkPrerequisite(actor(), { prerequisite: d.system.prerequisite ?? '' }).unknown);
check('of a5e\'s feats no more than 40 go unjudged (61 before)', unknown(a5eFeats).length <= 40, `${unknown(a5eFeats).length} of ${a5eFeats.length}`);
check('of the imported feats no more than 15 go unjudged (26 before)', unknown(imported).length <= 15, `${unknown(imported).length} of ${imported.length}`);

console.log(results.join('\n'));
const fails = results.filter(x => x.startsWith('FAIL')).length;
console.log(`\n${results.length - fails}/${results.length} passed`);
process.exit(fails ? 1 : 0);
