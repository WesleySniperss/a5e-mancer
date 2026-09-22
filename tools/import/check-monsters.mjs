// Step 4d: the converted monsters, against a5e's own keys, packs and shapes.
//   node tools/import/check-monsters.mjs
import { createRequire } from 'module';
import path from 'path';
import fs from 'fs';
const require = createRequire(import.meta.url);
const P = require('./lib/paths.cjs');
const M = require('./lib/match.cjs');
const K = JSON.parse(fs.readFileSync(P.KEYS, 'utf8'));
const read = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const OUT = path.join(P.MODULE, 'scripts', 'data', 'imported');
const MONSTERS = read(path.join(OUT, 'a5etools-monsters.json'));
const OTHER = ['a5etools-archetypes.json', 'a5etools-content.json', 'a5etools-origins.json'].flatMap((f) => read(path.join(OUT, f)));

const results = [];
const check = (n, ok, d = '') => results.push(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`);
const bad = (l, f) => l.filter(f);
const names = (l) => l.slice(0, 5).map((d) => d.name).join(', ');
const monster = (n) => MONSTERS.find((m) => m.name === n);
const entries = MONSTERS.flatMap((m) => m.items);
const actions = entries.flatMap((i) => Object.values(i.system.actions));
const rollsOf = (type) => actions.flatMap((a) => Object.values(a.rolls).filter((r) => r.type === type));
/** The only monster whose page gives no hit points: it says they vary. */
const VARIES = 'Swarm of Tiny and Small Animated Objects';

/* A. the documents */
{
  check('313 monsters, every one an actor a5e can make', MONSTERS.length === 313 && MONSTERS.every((m) => m.type === 'npc' && m.name), `${MONSTERS.length}`);
  const ids = [...MONSTERS, ...OTHER].map((d) => d._id);
  check('every id is 16 letters and digits and unique across the pack',
    MONSTERS.every((m) => /^[A-Za-z0-9]{16}$/.test(m._id)) && new Set(ids).size === ids.length);
  const itemIds = entries.map((i) => i._id);
  check('every trait and action has an id of its own, even where a monster names two the same',
    itemIds.every((i) => /^[A-Za-z0-9]{16}$/.test(i)) && new Set(itemIds).size === itemIds.length, `${itemIds.length} entries`);
  const missing = [...new Set(MONSTERS.map((m) => m.img))].filter((i) => !fs.existsSync(P.PUBLIC + i));
  check('every icon is one of Foundry\'s, and the token carries it', !missing.length
    && MONSTERS.every((m) => m.prototypeToken.texture.src === m.img), missing.slice(0, 3).join(', '));
  const leaks = bad(MONSTERS, (m) => /<(span|font|div|img)\b|style=|class=|&nbsp;|⟦L/.test(m.system.details.bio + m.items.map((i) => i.system.description).join('')));
  check('no page markup left in the text', !leaks.length, names(leaks));
  const short = bad(entries, (i) => i.system.description.replace(/<[^>]+>/g, '').trim().length < 10);
  check('every monster has its traits and actions, and every one its text', MONSTERS.every((m) => m.items.length) && !short.length, names(short));
  const idx = M.index(read(path.join(P.PACKS, 'monsterIndex.json')).map((m) => m.name));
  const dup = bad(MONSTERS, (m) => idx.has(m.name));
  check('none of them is already in a5e\'s monsters pack', !dup.length, names(dup));
  const srcOk = /^(adventurersGuide|voidrunnersCodex|adventuresInZeitgeist|dungeonDelversGuide|toSaveAKingdom|trialsAndTreasures|monstrousMenagerie|gpg\d+|a5eMancer\w+)$/;
  check('sources are product keys a5e or the module knows', MONSTERS.every((m) => srcOk.test(m.system.source)),
    [...new Set(MONSTERS.map((m) => m.system.source))].filter((s) => !srcOk.test(s)).join(', '));
  const folders = new Set(MONSTERS.map((m) => m.flags['a5e-mancer'].folder));
  check('each monster is filed under its kind', [...folders].every((f) => /^[A-Z]/.test(f))
    && MONSTERS.every((m) => m.flags['a5e-mancer'].folder.toLowerCase().startsWith(m.system.details.creatureTypes[0].slice(0, 3))), [...folders].sort().join(', '));
}

/* B. the stat block */
{
  const noAC = bad(MONSTERS, (m) => !/^\d+$/.test(m.system.attributes.ac.baseFormula));
  const noHP = bad(MONSTERS, (m) => !m.system.attributes.hp.value);
  check('an armour class and hit points for every monster but the one whose page says they vary',
    !noAC.length && noHP.length === 1 && noHP[0].name === VARIES, `${names(noAC)} / ${names(noHP)}`);
  check('hit points are the maximum as well as the current, with the page\'s hit dice',
    MONSTERS.every((m) => m.system.attributes.hp.value === m.system.attributes.hp.baseMax)
    && MONSTERS.filter((m) => m.system.attributes.hitDice).every((m) => Object.entries(m.system.attributes.hitDice).every(([d, v]) => /^d\d+$/.test(d) && v.current === v.total && v.total > 0)),
    `${MONSTERS.filter((m) => m.system.attributes.hitDice).length} with hit dice`);
  const sizes = new Set(['tiny', 'sm', 'med', 'lg', 'huge', 'grg']);
  check('sizes, creature types, languages, terrains and damage types are a5e\'s own keys',
    MONSTERS.every((m) => sizes.has(m.system.traits.size))
    && MONSTERS.every((m) => m.system.details.creatureTypes.every((c) => Object.hasOwn(K.creatureTypes, c)))
    && MONSTERS.every((m) => m.system.proficiencies.languages.every((l) => Object.hasOwn(K.languages, l)))
    && MONSTERS.every((m) => m.system.details.terrain.every((t) => Object.hasOwn(K.terrainTypes, t)))
    && MONSTERS.every((m) => ['damageResistances', 'damageImmunities', 'damageVulnerabilities'].every((k) => m.system.traits[k].every((d) => Object.hasOwn(K.damageTypes, d)))));
  check('six ability scores read off every page', MONSTERS.every((m) => ['str', 'dex', 'con', 'int', 'wis', 'cha'].every((a) => Number.isInteger(m.system.abilities[a].value))));
  check('a save is proficient or not, a skill is proficient with an expertise die of a5e\'s size',
    MONSTERS.every((m) => Object.values(m.system.abilities).every((a) => typeof a.save.proficient === 'boolean'))
    && MONSTERS.every((m) => Object.entries(m.system.skills).every(([k, s]) => Object.hasOwn(K.skills, k) && s.proficient === 1 && s.expertiseDice >= 0 && s.expertiseDice <= 6)));
  check('speeds and senses are a distance in feet, and a flyer may hover',
    MONSTERS.every((m) => Object.entries(m.system.attributes.movement).every(([k, v]) => k === 'traits' || (Number.isInteger(v.distance) && v.unit === 'feet')))
    && MONSTERS.every((m) => typeof m.system.attributes.movement.traits.hover === 'boolean')
    && MONSTERS.every((m) => Object.values(m.system.attributes.senses).every((v) => Number.isInteger(v.distance) && v.unit === 'feet')),
    `${MONSTERS.filter((m) => m.system.attributes.movement.traits.hover).length} hover, ${MONSTERS.filter((m) => Object.keys(m.system.attributes.senses).length).length} with senses`);
  const TOKEN = { tiny: 0.5, sm: 1, med: 1, lg: 2, huge: 3, grg: 4 };
  check('a token is the size of the creature, hostile, and not linked to the actor',
    MONSTERS.every((m) => m.prototypeToken.width === TOKEN[m.system.traits.size] && m.prototypeToken.disposition === -1 && !m.prototypeToken.actorLink));
  check('a swarm is marked as one, and an elite as elite',
    MONSTERS.filter((m) => m.system.details.isSwarm).length === 4 && MONSTERS.filter((m) => m.system.details.elite).length >= 5
    && MONSTERS.every((m) => !/\bswarm\b/i.test(m.name) || m.system.details.isSwarm),
    `${MONSTERS.filter((m) => m.system.details.isSwarm).length} swarms, ${MONSTERS.filter((m) => m.system.details.elite).length} elite`);
}

/* C. the traits and actions */
{
  const types = new Set(['', 'naturalWeapon', 'legendaryAction', 'other']);
  check('every entry is a feature of a kind a5e has, an attack a natural weapon',
    entries.every((i) => i.type === 'feature' && types.has(i.system.featureType))
    && entries.filter((i) => Object.values(i.system.actions).some((a) => Object.values(a.rolls).some((r) => r.type === 'attack'))).every((i) => i.system.featureType === 'naturalWeapon'),
    [...new Set(entries.map((i) => i.system.featureType || '(trait)'))].join(', '));
  check('every action is activated the way a5e names it',
    actions.every((a) => Object.hasOwn(K.abilityActivationTypes, a.activation.type) && Number.isInteger(a.activation.cost)),
    [...new Set(actions.map((a) => a.activation.type))].sort().join(', '));
  const attacks = rollsOf('attack');
  check('an attack has a5e\'s attack type and the page\'s bonus, rolled as written rather than from an ability',
    attacks.length > 400 && attacks.every((r) => Object.hasOwn(K.attackTypes, r.attackType) && /^[+-]\d+$/.test(r.bonus) && r.ability === 'none'), `${attacks.length} attacks`);
  const damage = rollsOf('damage');
  check('damage is a dice formula and a damage type a5e knows',
    damage.length > 400 && damage.every((r) => /^[\dd+\-* ]+$/.test(r.formula) && Object.hasOwn(K.damageTypes, r.damageType)),
    [...new Set(damage.filter((r) => !/^[\dd+\-* ]+$/.test(r.formula)).map((r) => r.formula))].slice(0, 3).join(' | '));
  const saves = actions.flatMap((a) => Object.values(a.prompts));
  check('a saving throw is an ability of a5e\'s and the page\'s DC',
    saves.length > 200 && saves.every((p) => p.type === 'savingThrow' && ['str', 'dex', 'con', 'int', 'wis', 'cha'].includes(p.ability) && /^\d+$/.test(p.saveDC.bonus)), `${saves.length} saves`);
  const uses = entries.filter((i) => i.system.uses.per || i.system.uses.recharge.threshold);
  check('"(3/Day)", "(Recharge 5–6)" and "(1/short rest)" are uses the sheet can spend',
    uses.length > 150 && uses.every((i) => (!i.system.uses.per || ['day', 'shortRest', 'longRest', 'turn', 'round', 'minute', 'hour'].includes(i.system.uses.per))
      && (!i.system.uses.recharge.threshold || (i.system.uses.recharge.formula === '1d6' && i.system.uses.recharge.threshold >= 2 && i.system.uses.recharge.threshold <= 6))),
    `${uses.length} with uses`);
  check('reach and range are read off the attack', rollsOf('attack').length
    && actions.filter((a) => Object.keys(a.ranges).length).length > 300, `${actions.filter((a) => Object.keys(a.ranges).length).length} with a range`);
}

/* D. close reads */
{
  const d = monster('Dracula');
  const leg = d.items.filter((i) => i.system.featureType === 'legendaryAction');
  check('Dracula: CR 21, 437 hit points, undead, and his three legendary actions read out of one bulleted paragraph',
    d.system.details.cr === 21 && d.system.attributes.hp.value === 437 && d.system.details.creatureTypes.join() === 'undead'
    && leg.map((i) => i.name).join(' | ') === 'Move | Unarmed Strike | Bite (Costs 2 Actions)'
    && Object.values(leg[2].system.actions)[0].activation.cost === 2,
    `${d.items.length} entries, ${leg.length} legendary`);
  check('Dracula: the text that names nothing is kept under the heading it was written under, not called something else',
    /<h2>Regional Effects<\/h2>/.test(d.system.details.bio) && /<h2>Legendary Actions<\/h2>/.test(d.system.details.bio)
    && !/<p>Description<\/p>/.test(d.system.details.bio),
    [...d.system.details.bio.matchAll(/<h2>([^<]*)<\/h2>/g)].map((m) => m[1]).join(' | '));
  const b = monster('Dreaming Badger');
  const bite = Object.values(b.items[0].system.actions)[0];
  check('Dreaming Badger: a newer block, where every save is listed - none of them proficient - and the skills sit in the initiative line',
    Object.values(b.system.abilities).every((a) => !a.save.proficient) && Object.keys(b.system.skills).sort().join() === 'ins,prc'
    && Object.values(bite.rolls).map((r) => r.bonus ?? r.formula).join(' ') === '+3 1d6 + 1',
    JSON.stringify(Object.keys(b.system.skills)));
  const a = monster('Atalanta');
  check('Atalanta: an older block, "Armor Class 14" and "Hit Points 65", only her proficient saves listed',
    a.system.attributes.ac.baseFormula === '14' && a.system.attributes.hp.value === 65
    && ['str', 'dex'].every((k) => a.system.abilities[k].save.proficient) && ['con', 'int', 'wis', 'cha'].every((k) => !a.system.abilities[k].save.proficient));
  check('Bonnie Blastfire: "H P 170" is 170 hit points', monster('Bonnie Blastfire').system.attributes.hp.value === 170);
  check('Astral Whale: titanic, which a5e has no size for, is Gargantuan', monster('Astral Whale').system.traits.size === 'grg');
  check(`${VARIES}: the page says the hit points vary, and none are invented`, monster(VARIES).system.attributes.hp.value === 0);
  const ab = monster('Abtazri the Brutal');
  check('Abtazri the Brutal: read whole - huge beast, CR 6, speed 60, four skills, two languages, seven terrains, 15 entries',
    ab.system.traits.size === 'huge' && ab.system.details.cr === 6 && ab.system.attributes.movement.walk.distance === 60
    && Object.keys(ab.system.skills).length === 4 && ab.system.proficiencies.languages.join() === 'common,sylvan'
    && ab.system.details.terrain.length === 7 && ab.items.length === 15,
    `${ab.items.length} entries, ${ab.system.details.terrain.join(',')}`);
}

console.log(results.join('\n'));
const fails = results.filter((x) => x.startsWith('FAIL')).length;
console.log(`\n${results.length - fails}/${results.length} passed`);
process.exit(fails ? 1 : 0);
