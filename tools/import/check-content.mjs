// Step 4b: the converted spells, psionic powers and items, checked against
// a5e's own keys and packs, and built into the Imported pack with its folders.
//   node tools/import/check-content.mjs
import { createRequire } from 'module';
import { pathToFileURL } from 'url';
import path from 'path';
import fs from 'fs';
const require = createRequire(import.meta.url);
const P = require('./lib/paths.cjs');
const M = require('./lib/match.cjs');
const root = path.join(P.MODULE, 'scripts');
const K = JSON.parse(fs.readFileSync(P.KEYS, 'utf8'));
const read = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const spells = read(path.join(P.PACKS, 'spells.json'));
const gear = read(path.join(P.PACKS, 'adventuringGear.json'));
const features = read(path.join(P.PACKS, 'classFeatures.json'));
const maneuvers = read(path.join(P.PACKS, 'maneuvers.json'));
const classes = read(path.join(P.PACKS, 'classes.json'));
const CONTENT = read(path.join(root, 'data', 'imported', 'a5etools-content.json'));
const ARCH = read(path.join(root, 'data', 'imported', 'a5etools-archetypes.json'));

// enough of Foundry for ImportedPack
globalThis.foundry = { utils: { deepClone: (o) => JSON.parse(JSON.stringify(o ?? null)), getRoute: (p) => '/' + p, mergeObject: (a, b) => ({ ...a, ...b }) } };
const settings = new Map([['buildImportedPack', true]]);
globalThis.game = { i18n: { localize: (k) => k, format: (k) => k }, user: { isGM: true }, packs: new Map(),
  settings: { get: (_m, k) => (settings.has(k) ? settings.get(k) : 0), set: async (_m, k, v) => { settings.set(k, v); } } };
globalThis.CONFIG = { A5E: { products: {} } };
globalThis.ui = { notifications: { info() {}, warn() {}, error() {} } };
globalThis.Hooks = { on() {}, once() {} };
const { AM } = await import(pathToFileURL(path.join(root, 'am.js')).href);
AM.log = () => {};

const results = [];
const check = (n, ok, d = '') => results.push(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`);
const bad = (list, f) => list.filter(f);
const names = (list) => list.slice(0, 6).map((d) => d.name).join(', ');

const sp = CONTENT.filter((d) => d.type === 'spell');
const psi = sp.filter((d) => d.system.disciplines.length);
const obj = CONTENT.filter((d) => d.type === 'object');

/* A. the documents */
{
  check('419 documents: 25 spells, 92 psionic powers, 302 objects', CONTENT.length === 419 && sp.length - psi.length === 25 && psi.length === 92 && obj.length === 302,
    `${CONTENT.length}: ${sp.length - psi.length}/${psi.length}/${obj.length}`);
  const { DREAD_KNIGHT } = await import(pathToFileURL(path.join(root, 'data', 'imported', 'dreadKnight.js')).href);
  const ids = [...CONTENT, ...ARCH, ...DREAD_KNIGHT].map((d) => d._id);
  check('every id is 16 letters and digits and unique across the whole pack', ids.every((i) => /^[A-Za-z0-9]{16}$/.test(i)) && new Set(ids).size === ids.length);
  const inner = CONTENT.flatMap((d) => [...Object.keys(d.system.actions ?? {}), ...Object.values(d.system.actions ?? {}).flatMap((a) => [...Object.keys(a.prompts ?? {}), ...Object.keys(a.rolls ?? {}), ...Object.keys(a.consumers ?? {}), ...Object.keys(a.ranges ?? {})])]);
  check('action, roll, prompt, consumer and range ids are 16 characters', inner.every((i) => /^[A-Za-z0-9]{16}$/.test(i)));
  const known = new Set([...spells, ...gear, ...features, ...maneuvers].map((d) => d._id));
  const dead = CONTENT.flatMap((d) => [...d.system.description.matchAll(/@UUID\[([^\]]+)\]/g)].map((m) => m[1]).filter((u) => !known.has(u.split('.').pop())).map((u) => `${d.name}: ${u}`));
  check('every @UUID link resolves to a5e\'s packs', !dead.length, dead.slice(0, 3).join(' | '));
  const missing = [...new Set(CONTENT.map((d) => d.img))].filter((i) => !fs.existsSync(P.PUBLIC + i));
  check('every icon is one of Foundry\'s', !missing.length, missing.slice(0, 3).join(', '));
  check('every document has its text', !bad(CONTENT, (d) => d.system.description.replace(/<[^>]+>/g, '').trim().length < 10).length, names(bad(CONTENT, (d) => d.system.description.replace(/<[^>]+>/g, '').trim().length < 10)));
  const leaks = bad(CONTENT, (d) => /<(span|font|div|img|a)\b|style=|class=|&nbsp;|&quot;|⟦L/.test(d.system.description));
  check('no page markup left in the text', !leaks.length, names(leaks));
  const srcOk = /^(adventurersGuide|voidrunnersCodex|trialsAndTreasures|adventuresInZeitgeist|dungeonDelversGuide|toSaveAKingdom|a5eMancer\w+|)$/;
  check('sources are a5e\'s product keys or the ones the module registers', !bad(CONTENT, (d) => !srcOk.test(d.system.source)).length, names(bad(CONTENT, (d) => !srcOk.test(d.system.source))));
  const spellIdx = M.index(spells.map((s) => s.name));
  const gearIdx = M.index(gear.map((g) => g.name), { subset: true });
  const dup = [...bad(sp, (d) => spellIdx.has(d.name)), ...bad(obj, (d) => gearIdx.has(d.name))];
  check('none of them is already in a5e\'s packs', !dup.length, names(dup));
  const within = CONTENT.map((d) => `${d.type}:${d.name}`);
  check('no name twice', new Set(within).size === within.length, within.filter((n, i) => within.indexOf(n) !== i).slice(0, 5).join(', '));
}

/* B. spells and psionic powers, in a5e's keys */
{
  const classKeys = new Set(classes.map((c) => c.system?.slug || c.name.toLowerCase()));
  const act = new Set(Object.keys(K.abilityActivationTypes)), dur = new Set(Object.keys(K.timePeriods));
  check('levels 0-9, schools and classes a5e knows',
    !bad(sp, (d) => !(d.system.level >= 0 && d.system.level <= 9) || (d.system.schools.primary && !Object.hasOwn(K.spellSchools.primary, d.system.schools.primary))
      || d.system.schools.secondary.some((x) => !Object.hasOwn(K.spellSchools.secondary, x)) || d.system.classes.some((c) => !classKeys.has(c)) || !d.system.classes.length).length,
    names(bad(sp, (d) => !d.system.classes.length || d.system.schools.secondary.some((x) => !Object.hasOwn(K.spellSchools.secondary, x)))));
  const actions = sp.map((d) => [d, Object.values(d.system.actions)[0]]);
  check('each has one action: a casting time, a duration and a range a5e can read',
    actions.every(([, a]) => a && act.has(a.activation.type) && dur.has(a.duration.unit) && Object.values(a.ranges).every((r) => r.range !== undefined)),
    actions.filter(([, a]) => !a || !act.has(a.activation.type) || !dur.has(a.duration.unit)).map(([d]) => d.name).slice(0, 5).join(', '));
  check('a levelled spell or power costs spell points by its level (a5e\'s table), a cantrip or reflex nothing',
    actions.every(([d, a]) => { const c = Object.values(a.consumers)[0]; return d.system.level ? c?.type === 'spell' && c.points === [0, 2, 3, 5, 6, 7, 9, 10, 11, 13][d.system.level] : !c; }));
  check('psionic powers: a discipline a5e knows, the psion\'s list, no components, the psionic school',
    psi.every((d) => d.system.disciplines.every((x) => Object.hasOwn(K.psionicDisciplines, x)) && d.system.classes.join() === 'psion'
      && !d.system.components.vocalized && !d.system.components.seen && !d.system.components.material && d.system.schools.secondary.includes('psionic')));
  const levels = {}; for (const d of psi) levels[d.system.level] = (levels[d.system.level] || 0) + 1;
  check('psionic power levels: reflex powers at 0, I-V at 1-5', Object.keys(levels).every((l) => l >= 0 && l <= 5) && levels[0] > 0, JSON.stringify(levels));
  const S = (n) => sp.find((d) => d.name === n);
  const cc = S('Charm Crowd'), ma = sp.find((d) => d.name === 'Manifest Antimatter');
  const cca = Object.values(cc.system.actions)[0], maa = Object.values(ma.system.actions)[0];
  check('Charm Crowd: 7th-level enchantment, V S, an action, medium range, 1 hour, a Wisdom save that negates',
    cc.system.level === 7 && cc.system.schools.primary === 'enchantment' && cc.system.components.vocalized && cc.system.components.seen && !cc.system.components.material
      && cca.activation.type === 'action' && Object.values(cca.ranges)[0].range === 'medium' && cca.duration.unit === 'hour' && Object.values(cca.prompts)[0].ability === 'wis' && Object.values(cca.prompts)[0].onSave === 'Negates');
  check('Manifest Antimatter: power IV, dynakinetic, a Dexterity save and 10d8 force', ma.system.level === 4 && ma.system.disciplines[0] === 'dynakinetic'
    && Object.values(maa.prompts)[0]?.ability === 'dex' && Object.values(maa.rolls)[0]?.formula === '10d8' && Object.values(maa.rolls)[0].damageType === 'force');
  const conc = sp.filter((d) => d.system.concentration).length, rit = sp.filter((d) => d.system.ritual).map((d) => d.name).sort();
  check('concentration and rituals as the pages mark them', conc > 20 && rit.join() === 'Embody Fiendish Spirit,Skeleton Crew,Sleeplessness', `${conc} concentration; rituals ${rit.join(', ')}`);
  const nr = Object.values(S('Nervous Recoil').system.actions)[0];
  check('Nervous Recoil: a reaction, 2d6 psychic, +1d6 a slot level', nr.activation.type === 'reaction' && Object.values(nr.rolls)[0]?.formula === '2d6' && Object.values(nr.rolls)[0].scaling?.formula === '1d6');
}

/* C. objects, in a5e's keys */
{
  const wp = new Set(Object.keys(K.weaponProperties));
  check('object types, rarities, currencies and weapon properties a5e knows',
    !bad(obj, (d) => !Object.hasOwn(K.objectTypes, d.system.objectType) || !Object.hasOwn(K.itemRarity, d.system.rarity) || !Object.hasOwn(K.currencyDenominations, d.system.price.denomination)
      || typeof d.system.weight !== 'number' || d.system.weaponProperties.some((p) => !wp.has(p))).length);
  const mi = obj.filter((d) => d.flags['a5e-mancer'].folder === 'Magic Items');
  check('magic items: none mundane, attunement where the page says', mi.length === 142 && !mi.some((d) => d.system.rarity === 'mundane') && mi.filter((d) => d.system.requiresAttunement).length > 50,
    `${mi.filter((d) => d.system.requiresAttunement).length} need attunement`);
  const O = (n) => obj.find((d) => d.name === n);
  const tw = O('Transforming Wand');
  check('Transforming Wand: 13 charges regained daily, an action that spends one', tw.system.uses.max === '13' && tw.system.uses.per === 'day'
    && Object.values(Object.values(tw.system.actions)[0].consumers).some((c) => c.type === 'itemUses'));
  const mj = O('Mjölnir');
  check('Mjölnir: a legendary weapon needing attunement', mj.system.objectType === 'weapon' && mj.system.rarity === 'legendary' && mj.system.requiresAttunement);
  const tome = O('Tome of the Spellblade'), piece = O('Diamond-Encrusted Piece +1');
  check('the kind comes from the category before the name: a tome is not a blade, a Weapon-category "piece" is a weapon', tome.system.objectType === 'miscellaneous' && piece.system.objectType === 'weapon');
  const bal = O('Ballista'), ba = Object.values(bal.system.actions)[0];
  check('Ballista: 500 gp, a ranged attack at 140/480 ft., 3d10 piercing', bal.system.price.value === 500 && Object.values(ba.rolls).some((r) => r.attackType === 'rangedWeaponAttack')
    && Object.values(ba.rolls).some((r) => r.formula === '3d10' && r.damageType === 'piercing') && Object.values(ba.ranges).map((r) => r.range).join() === '140,480');
  const apc = O('APC, "Streetfighter"');
  check('a vehicle: credits, tons as pounds, its statistics in the text', apc.system.price.denomination === 'cr' && apc.system.price.value === 20000 && apc.system.weight === 32000 && /Hit Points/.test(apc.system.description));
  const cd = O('Crossdagger'), cda = Object.values(cd.system.actions)[0];
  check('Crossdagger: a finesse, thrown, parrying weapon with its attack and 1d4', cd.system.weaponProperties.includes('finesse') && cd.system.weaponProperties.includes('thrown')
    && Object.values(cda.rolls).some((r) => r.formula === '1d4 + @finesse.mod'));
  check('drones listed twice on a5e.tools come once, with their price', obj.filter((d) => d.name === 'Mortar Drone').length === 1 && O('Mortar Drone').system.price.value === 250);
  check('no hirelings, pets, mounts or services', !obj.some((d) => /^(Bodyguard|Healer|Sage|Porter), |^(Riding horse|Mastiff|Owlbear|Camel)$/.test(d.name)));
}

/* D. the pack, with both files and its folders */
{
  const { ImportedPack } = await import(pathToFileURL(path.join(root, 'utils', 'importedPack.js')).href).catch(async (e) => {
    // the module's globals first
    throw e;
  });
  const { GENERATED } = await import(pathToFileURL(path.join(root, 'data', 'imported', 'generated.js')).href);
  check('the manifest lists both files and every document', GENERATED.files.length === 2 && GENERATED.count === ARCH.length + CONTENT.length);
  const served = Object.fromEntries(GENERATED.files.map((f) => [`/modules/a5e-mancer/${f.file}`, read(path.join(P.MODULE, f.file))]));
  let fetched = 0;
  globalThis.fetch = async (url) => { fetched++; return { ok: !!served[url], status: served[url] ? 200 : 404, json: async () => JSON.parse(JSON.stringify(served[url])) }; };
  const created = [], folders = [];
  const pack = { collection: 'world.a5e-mancer-imported', locked: false, folder: null, folders: [], metadata: {},
    async getDocuments() { return []; }, async getIndex() { return []; }, async configure() {}, async setFolder() {} };
  globalThis.Item = { createDocuments: async (docs) => { created.push(...docs); return docs; }, deleteDocuments: async () => [] };
  globalThis.foundry.documents = {
    Folder: { createDocuments: async (datas) => datas.map((d, i) => { const f = { ...d, id: `folder${String(i).padStart(10, '0')}` }; folders.push(f); return f; }), deleteDocuments: async () => [] },
    collections: { CompendiumCollection: { createCompendium: async () => { game.packs.set(pack.collection, pack); return pack; } } }
  };
  ImportedPack.registerSource();
  check('the sources the module adds are named for a5e', ['a5eMancerGPG', 'a5eMancerPlanestrider', 'a5eMancerMythological', 'a5eMancerOther'].every((k) => CONFIG.A5E.products[k]?.title));
  await ImportedPack.ensure();
  check('the pack holds everything, fetched from both files', created.length === 10 + GENERATED.count && fetched === 2, `${created.length} documents, ${fetched} fetches`);
  const order = folders.map((f) => f.name).join(' / ');
  check('six folders in order, every document in one', order === 'Archetypes / Archetype Features / Spells / Psionic Powers / Magic Items / Equipment' && created.every((d) => d.folder), order);
  const inFolder = (n) => created.filter((d) => d.folder === folders.find((f) => f.name === n)?.id).length;
  check('the counts per folder', inFolder('Archetypes') === 89 && inFolder('Spells') === 25 && inFolder('Psionic Powers') === 92 && inFolder('Magic Items') === 142 && inFolder('Equipment') === 160,
    folders.map((f) => `${f.name} ${inFolder(f.name)}`).join(', '));
}

console.log(results.join('\n'));
const fails = results.filter((x) => x.startsWith('FAIL')).length;
console.log(`\n${results.length - fails}/${results.length} passed`);
process.exit(fails ? 1 : 0);
