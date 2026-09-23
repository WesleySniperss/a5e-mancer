/* What a feature's prose grants, offers or skips - ProseSpells.parse against
 * sentences a5e and the imported content really write - and what the spell
 * pickers let through from an expanded list (SpellService.collectExpandedLists)
 * against a5e's own list features.
 *
 * Every probe below was a spell lost or wrongly given before it was fixed:
 * "You also know the Thaumaturgy cantrip" (every cleric), artificer tables
 * written as lines, "when you choose this archetype" read as a choice, the
 * chosen Elemental Priest list skipped, rows numbered by spell level read as
 * character levels, "you gain resistance to fire" giving the spell Resistance,
 * "you learn the Sleep spell, or another bard spell" read as a choice, the
 * short-form links of four warlock lists, a herald oath's added schools.
 *
 * Reads a5e's packs from tools/import/.cache: run tools/import/prepare.cjs once.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const R = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PACKS = path.join(R, 'tools', 'import', '.cache', 'packs');
if (!fs.existsSync(path.join(PACKS, 'spells.json'))) {
  console.log('tools/import/.cache/packs is empty - run node tools/import/prepare.cjs first');
  process.exit(1);
}
globalThis.foundry = { utils: { hasProperty: () => false, getRoute: (p) => '/' + p } };
globalThis.game = { i18n: { localize: (k) => k, format: (k) => k }, user: { isGM: true }, packs: new Map(), settings: { get: () => true }, modules: new Map() };
globalThis.CONFIG = { A5E: { products: {} } };
globalThis.ui = { notifications: { warn() {}, error() {}, info() {} } };
globalThis.Hooks = { on() {}, once() {} };
const { AM } = await import(pathToFileURL(path.join(R, 'scripts', 'am.js')).href);
AM.log = () => {};
const { ProseSpells } = await import(pathToFileURL(path.join(R, 'scripts', 'utils', 'proseSpells.js')).href);
const { SpellService } = await import(pathToFileURL(path.join(R, 'scripts', 'utils', 'spellService.js')).href);
const read = (f) => JSON.parse(fs.readFileSync(path.join(PACKS, f), 'utf8'));
const spells = read('spells.json');
const features = read('classFeatures.json');
const lookup = ProseSpells.buildLookup(spells.map(s => ({ id: s._id, uuid: `Compendium.a5e.a5e-spells.Item.${s._id}`, name: s.name })));
const e = (n) => `<em>${n}</em>`;

const results = [];
const check = (n, ok, d = '') => results.push(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`);

/* A. parse: [label, html, { auto: exact set ('Name' any gate, 'Name@N'), noAuto, choice, skipped, ctx }] */
const CASES = [
  ['plain learn', `<p>You learn the ${e('Chill Touch')} cantrip.</p>`, { auto: ['Chill Touch'] }],
  ['always prepared', `<p>You always have the ${e('Find Familiar')} spell prepared.</p>`, { auto: ['Find Familiar'] }],
  ['if you know: nothing', `<p>If you know the ${e('Light')} cantrip, you can cast it as a bonus action.</p>`, { noAuto: true }],
  ['benefits of: nothing', `<p>You gain the benefits of a ${e('Death Ward')} spell.</p>`, { noAuto: true }],
  ['a sorcerer table is a choice by row', `<p>You choose one spell from each row of the table below.</p><table><tr><td>1st</td><td>${e('Shield')}, ${e('Grease')}</td></tr><tr><td>3rd</td><td>${e('Blur')}</td></tr></table>`, { noAuto: true, choice: 'rowChoice', ctx: { classKey: 'sorcerer' } }],
  ['a warlock\'s expanded list is added to, not known', `<p>These spells count as warlock spells for you.</p><table><tr><td>Level 1</td><td>${e('Burning Hands')}, ${e('Fog Cloud')}</td></tr><tr><td>Level 3</td><td>${e('Fireball')}</td></tr></table>`, { noAuto: true, skipped: 'expanded', ctx: { name: 'Warlock Expanded Spell List: Fire' } }],
  ['"choose one of the following": alternatives', `<p>Choose one of the following.</p><p>Flame: You learn the ${e('Fire Bolt')} cantrip.</p><p>Frost: You learn the ${e('Ray of Frost')} cantrip.</p>`, { noAuto: true }],
  ['"gain one of the following": alternatives', `<p>You gain one of the following:</p><p>Genie Magic: You can cast ${e('Detect Magic')} at will.</p><p>Genie's Curse: You can cast ${e('Bestow Curse')} once per long rest.</p>`, { noAuto: true }],
  ['several lists in one feature: skipped', `<p>Your archetype spells are selected from one of several lists, chosen from below.</p><table><tr><td>1</td><td>${e('Burning Hands')}</td></tr></table><table><tr><td>1</td><td>${e('Shield')}</td></tr></table>`, { noAuto: true }],
  ['the one list chosen (Elemental Priest)', `<p>When you choose this archetype at 1st-level, your archetype spells are selected from one of several lists, chosen from below.</p><table><tr><td>1</td><td>${e('Burning Hands')}, ${e('Faerie Fire')}</td></tr><tr><td>3</td><td>${e('Flaming Sphere')}, ${e('Heat Metal')}</td></tr></table>`, { auto: ['Burning Hands@1', 'Faerie Fire@1', 'Flaming Sphere@3', 'Heat Metal@3'], ctx: { name: 'Fire Priest Spells' } }],
  ['"you also learn"', `<p>You also learn the ${e('Chill Touch')} cantrip.</p>`, { auto: ['Chill Touch'] }],
  ['"you also know" (the cleric\'s Thaumaturgy)', `<p>In addition to these, you also know the ${e('Thaumaturgy')} cantrip.</p>`, { auto: ['Thaumaturgy'] }],
  ['"permanently have ... prepared"', `<p>You also permanently have the ${e('Find Familiar')} and ${e('Speak with Animals')} spells prepared.</p>`, { auto: ['Find Familiar', 'Speak with Animals'] }],
  ['"without a spell slot"', `<p>You may cast ${e('Detect Thoughts')} without a spell slot.</p>`, { auto: ['Detect Thoughts'] }],
  ['"add to your spellbook"', `<p>You add the ${e('Find Familiar')} spell to your spellbook.</p>`, { auto: ['Find Familiar'] }],
  ['"add to your list of known spells"', `<p>You add the spell ${e('Shield')} to your list of known wielder spells.</p>`, { auto: ['Shield'] }],
  ['"when you choose this archetype" is no choice', `<p>Starting at 1st level when you choose this archetype, you learn the ${e('Spare the Dying')} cantrip.</p>`, { auto: ['Spare the Dying'] }],
  ['a spell list written a paragraph a row', `<p>You also learn the following spells at the following levels, and they do not count against your spells known:</p><p>1st level: ${e('Faerie Fire')}</p><p>3rd level: ${e('Moonbeam')}</p>`, { auto: ['Faerie Fire@1', 'Moonbeam@3'] }],
  ['a table written as lines (Engineer Spells)', `<p><strong>TABLE: ENGINEER SPELLS</strong></p><p>Artificer Level - Spell<br>3rd - ${e('Grease')} ${e('Fog Cloud')}<br>5th - ${e('Heat Metal')} ${e('Levitate')}</p><p>You can prepare these spells in addition to your normal number of prepared spells.</p>`, { auto: ['Grease@3', 'Fog Cloud@3', 'Heat Metal@5', 'Levitate@5'] }],
  ['a class\'s whole list by level is no table', `<p><strong>1st Level: </strong>${e('Bless, Ceremony, Cure Wounds, Detect Magic, Healing Word, Heroism')}</p><p><strong>2nd Level: </strong>${e('Aid, Calm Emotions, Continual Flame, Find Traps, Gentle Repose')}</p>`, { noAuto: true }],
  ['"at level 15" gates as "at 15th level" does', `<p>At level 15 you learn the ${e('Earthquake')} spell.</p>`, { auto: ['Earthquake@15'] }],
  ['a psionic power', `<p>You gain the ${e('Planeswalking')} power.</p>`, { auto: ['Planeswalking'] }],
  ['"gain resistance to" is not the spell Resistance', `<p>You gain resistance to fire damage, and your fire spells ignore resistance.</p>`, { noAuto: true }],
  ['added to a list others choose from', `<p>You also add ${e('Wish')} to the list of warlock spells available for the ${e('Penultimate Arcanum')} invocation.</p>`, { noAuto: true }],
  ['spells named as examples', `<p>You also gain an expertise die on saves against spells of the illusion and enchantment schools (such as ${e('Command')} or ${e('Dominate Person')}).</p>`, { noAuto: true }],
  ['"you gain the A or B power" is a choice', `<p>You gain the ${e('Telekinesis')} or ${e('Telepathy')} power.</p>`, { noAuto: true, choice: 'pick' }],
  ['"you learn the A, B, or C cantrip" is a choice', `<p>Starting at 1st level when you choose this archetype, you learn the ${e('Dancing Lights')}, ${e('Light')}, or ${e('Produce Flame')} cantrip.</p>`, { noAuto: true, choice: 'pick' }],
  ['"choose either" is a choice', `<p>Choose either the ${e('Thaumaturgy')} or ${e('Spare the Dying')} cantrip.</p>`, { noAuto: true, choice: 'pick' }],
  ['"you know a cantrip from the following list" is a choice', `<p>You know a cantrip from the following list: ${e('Mage Hand')}, ${e('Prestidigitation')}, or ${e('Thaumaturgy')}.</p>`, { noAuto: true, choice: 'pick' }],
  ['"cast either A or B" at each use grants both', `<p>Once per long rest, you can cast either ${e('Etherealness')} or ${e('Wind Walk')} without using a spell slot.</p>`, { auto: ['Etherealness', 'Wind Walk'] }],
  ['"or another bard spell" is a fallback, not a choice', `<p>You learn the ${e('Sleep')} spell, or another bard spell if you already know it.</p>`, { auto: ['Sleep'] }],
  ['"without components or expending a slot" grants', `<p>You learn the ${e('Identify')} spell and can cast it without components or expending a spell slot once per long rest.</p>`, { auto: ['Identify'] }],
  ['casting at will, choosing the spell\'s own option', `<p>You may also cast the ${e('Alter Self')} spell at will without expending a spell slot, but only choosing the Amphibious option, instead of being able to choose a different one.</p>`, { auto: ['Alter Self'] }],
  ['rows by spell level in a spellbook table (Court Magician)', `<p>You add spells to your spellbook for free, as per the table.</p><table><tr><th>Spell Level</th><th>Spells</th></tr><tr><td>1</td><td>${e('Heroism')}</td></tr><tr><td>2</td><td>${e('Calm Emotions')}</td></tr><tr><td>3</td><td>${e('Speak with Dead')}</td></tr></table>`, { auto: ['Heroism@1', 'Calm Emotions@3', 'Speak with Dead@5'], ctx: { classKey: 'wizard' } }],
  ['rows 1-5 are spell levels (Labyrinth Priest)', `<p>You always have these domain spells prepared.</p><table><tr><td>Level 1</td><td>${e('Shield')}</td></tr><tr><td>Level 2</td><td>${e('Blur')}</td></tr><tr><td>Level 3</td><td>${e('Gaseous Form')}</td></tr><tr><td>Level 4</td><td>${e('Stone Shape')}</td></tr><tr><td>Level 5</td><td>${e('Passwall')}</td></tr></table>`, { auto: ['Shield@1', 'Blur@3', 'Gaseous Form@5', 'Stone Shape@7', 'Passwall@9'], ctx: { classKey: 'cleric' } }],
  ['rows 1, 3, 5 stay class levels', `<p>You always have these domain spells prepared.</p><table><tr><td>1st</td><td>${e('Shield')}</td></tr><tr><td>3rd</td><td>${e('Blur')}</td></tr><tr><td>5th</td><td>${e('Gaseous Form')}</td></tr></table>`, { auto: ['Shield@1', 'Blur@3', 'Gaseous Form@5'], ctx: { classKey: 'cleric' } }]
];
for (const [label, html, want] of CASES) {
  const p = ProseSpells.parse(html, lookup, { classKey: 'x', name: 'Probe', ...(want.ctx ?? {}) });
  const got = p.auto.map(a => a.name + (a.atLevel ? '@' + a.atLevel : '')).sort();
  const problems = [];
  if (want.auto) {
    const exp = [...want.auto].sort();
    const ok = exp.length === got.length && exp.every(s => s.includes('@') ? got.includes(s) : got.some(t => t.split('@')[0] === s));
    if (!ok) problems.push(`granted ${JSON.stringify(got)}, not ${JSON.stringify(exp)}`);
  }
  if (want.noAuto && got.length) problems.push(`granted ${JSON.stringify(got)}`);
  if (want.choice && !p.choices.some(c => c.kind === want.choice)) problems.push(`no ${want.choice} (${p.choices.map(c => c.kind).join(',') || 'none'})`);
  if (want.skipped && !p.skipped.some(s => s.includes(want.skipped))) problems.push(`not skipped as ${want.skipped}`);
  check(`parse: ${label}`, !problems.length, problems.join('; '));
}

/* B. the whole of a5e's class features: its cleric domains and artificer archetypes get their tables */
{
  const byName = (n) => features.filter(d => d.name === n);
  const auto = (d) => ProseSpells.parse(d.system.description, lookup, { classKey: ProseSpells.classKeyOf(d), name: d.name }).auto;
  const cleric = byName('Spellcasting (Cleric)')[0];
  check('every a5e cleric knows Thaumaturgy', auto(cleric).some(a => a.name === 'Thaumaturgy'));
  const lines = ['Engineer Spells', 'Bombadier spells', 'Stitcher Spells', 'Firework Engineer Spells', 'Combat Engineer Spells', 'Experimental Chirurgeon Spells']
    .flatMap(byName).map(d => [d.name, auto(d).length]);
  check('the six artificer archetypes whose tables are written as lines get their ten spells', lines.length >= 6 && lines.every(([, n]) => n >= 10), lines.map(([n, c]) => `${n} ${c}`).join(', '));
  const priests = ['Fire Priest Spells', 'Stone Priest Spells', 'Storm Priest Spells', 'Water Priest Spells', 'Plant Priest Spells'].flatMap(byName).map(d => [d.name, auto(d).length]);
  check('the Elemental Priest\'s chosen list gives its spells', priests.length >= 5 && priests.every(([, n]) => n >= 8), priests.map(([n, c]) => `${n} ${c}`).join(', '));
}

/* C. what the spell pickers admit from a feature */
{
  const one = (pred) => features.find(pred);
  const air = one(d => d.name === 'Warlock Expanded Spell List: Air');
  await SpellService.collectExpandedLists([air]);
  check('the Air list\'s short-form links are admitted, in the long form the loader uses',
    SpellService.extraAllowed.size === 10 && [...SpellService.extraAllowed].every(u => /^Compendium\.a5e\.a5e-spells\.Item\.[A-Za-z0-9]{16}$/.test(u)), `${SpellService.extraAllowed.size} spells`);
  const myth = one(d => d.name === 'Mythfire Expanded Spells');
  await SpellService.collectExpandedLists([myth]);
  check('"Mythfire Expanded Spells" is an expanded list, though it is not called one', SpellService.extraAllowed.size === 10, `${SpellService.extraAllowed.size} spells`);
  const school = one(d => d.name === 'Archetype School' && /good\s*<\/em>\s*and/.test(d.system.description));
  await SpellService.collectExpandedLists([school]);
  const gb = spells.find(s => s.name === 'Guiding Bolt');
  check('a herald oath\'s added schools let a radiant spell onto the herald\'s list',
    [...SpellService.extraSchools].join() === 'good,radiant' && SpellService.spellAllowsClass(gb.system, 'Herald', `Compendium.a5e.a5e-spells.Item.${gb._id}`),
    [...SpellService.extraSchools].join(', '));
  const rare = spells.find(s => s.system.rare && [s.system.schools?.primary, ...(s.system.schools?.secondary ?? [])].includes('radiant'));
  check('...but never a rare spell', !rare || !SpellService.spellAllowsClass(rare.system, 'Herald', `Compendium.a5e.a5e-spells.Item.${rare._id}`), rare?.name ?? 'no rare radiant spell');
  await SpellService.collectExpandedLists(null);
  check('with nothing to read, nothing is admitted', !SpellService.extraAllowed.size && !SpellService.extraSchools.size);
}

console.log(results.join('\n'));
const fails = results.filter(x => x.startsWith('FAIL')).length;
console.log(`\n${results.length - fails}/${results.length} passed`);
process.exit(fails ? 1 : 0);
