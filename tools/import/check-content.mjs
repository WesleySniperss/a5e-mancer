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
const man = CONTENT.filter((d) => d.type === 'maneuver');
const feats = CONTENT.filter((d) => d.type === 'feature' && d.system.featureType === 'feat');
const bgs = CONTENT.filter((d) => d.type === 'background');
const dests = CONTENT.filter((d) => d.type === 'destiny');
const byId = new Map(CONTENT.map((d) => [d._id, d]));
const psi = sp.filter((d) => d.system.disciplines.length);
const obj = CONTENT.filter((d) => d.type === 'object');

/* A. the documents */
{
  check('25 spells, 92 psionic powers, 387 objects, 91 maneuvers, 112 feats, 20 backgrounds, 7 destinies',
    sp.length - psi.length === 25 && psi.length === 92 && obj.length === 387 && man.length === 91 && feats.length === 112 && bgs.length === 20 && dests.length === 7,
    `${sp.length - psi.length}/${psi.length}/${obj.length}/${man.length}/${feats.length}/${bgs.length}/${dests.length}`);
  const { DREAD_KNIGHT } = await import(pathToFileURL(path.join(root, 'data', 'imported', 'dreadKnight.js')).href);
  const ids = [...CONTENT, ...ARCH, ...DREAD_KNIGHT].map((d) => d._id);
  check('every id is 16 letters and digits and unique across the whole pack', ids.every((i) => /^[A-Za-z0-9]{16}$/.test(i)) && new Set(ids).size === ids.length);
  const inner = CONTENT.flatMap((d) => [...Object.keys(d.system.actions ?? {}), ...Object.values(d.system.actions ?? {}).flatMap((a) => [...Object.keys(a.prompts ?? {}), ...Object.keys(a.rolls ?? {}), ...Object.keys(a.consumers ?? {}), ...Object.keys(a.ranges ?? {})])]);
  check('action, roll, prompt, consumer and range ids are 16 characters', inner.every((i) => /^[A-Za-z0-9]{16}$/.test(i)));
  const monsterIds = new Set(read(path.join(P.PACKS, 'monsterIndex.json')).map((m) => m._id));
  const known = new Set([...spells, ...gear, ...features, ...maneuvers, ...CONTENT].map((d) => d._id).concat([...monsterIds]));
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
  const idx = (n) => M.index(read(path.join(P.PACKS, `${n}.json`)).map((d) => d.name));
  const manIdx = idx('maneuvers'), featIdx = idx('feats'), bgIdx = idx('backgrounds'), destIdx = idx('destinies');
  const dup = [...bad(sp, (d) => spellIdx.has(d.name)), ...bad(obj, (d) => gearIdx.has(d.name)), ...bad(man, (d) => manIdx.has(d.name)),
    ...bad(feats, (d) => featIdx.has(d.name)), ...bad(bgs, (d) => bgIdx.has(d.name)), ...bad(dests, (d) => destIdx.has(d.name))];
  check('none of them is already in a5e\'s packs', !dup.length, names(dup));
  const within = CONTENT.filter((d) => d.type !== 'feature' || d.system.featureType === 'feat').map((d) => `${d.type}:${d.name}`);
  check('no name twice', new Set(within).size === within.length, within.filter((n, i) => within.indexOf(n) !== i).slice(0, 5).join(', '));
  const links = CONTENT.flatMap((d) => Object.values(d.system.grants ?? {}).flatMap((g) => [...(g.features?.base ?? []), ...(g.features?.options ?? []), ...(g.items?.base ?? [])].map((e) => e.uuid)))
    .concat(dests.flatMap((d) => [d.system.sourceOfInspiration, d.system.inspirationFeature, d.system.fulfillmentFeature]));
  const deadGrant = links.filter((u) => !known.has(String(u).split('.').pop()));
  check('every grant and destiny link names a document that exists', !deadGrant.length && links.length > 50, `${links.length} links; dead ${deadGrant.slice(0, 3).join(', ')}`);
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
  check('the hirelings, mounts and pets a character buys are here too', ['Bodyguard, expert', 'Riding horse', 'Owlbear', 'Stabling'].every((n) => obj.some((d) => d.name === n)));
}

/* C2. maneuvers, feats, backgrounds, destinies, bought creatures */
{
  const trad = new Set([...Object.keys(K.maneuverTraditions), 'unerringHawk', 'duelingManeuvers']);
  check('maneuvers: a tradition a5e or the module knows, degree 1-5, exertion spent as a5e spends it',
    man.every((d) => trad.has(d.system.tradition) && d.system.degree >= 1 && d.system.degree <= 5
      && (!d.system.exertionCost || Object.values(Object.values(d.system.actions)[0].consumers).some((c) => c.resource === 'exertion' && c.quantity === d.system.exertionCost))),
    man.filter((d) => !trad.has(d.system.tradition)).map((d) => d.system.tradition).slice(0, 3).join());
  const { IMPORTED_TRADITIONS } = await import(pathToFileURL(path.join(root, 'data', 'imported', 'traditions.js')).href);
  check('the two traditions a5e lacks are registered by the module, with the duels\' note', Object.keys(IMPORTED_TRADITIONS).sort().join() === 'duelingManeuvers,unerringHawk' && /duels/.test(IMPORTED_TRADITIONS.duelingManeuvers.lore));
  const MN = (n) => man.find((d) => d.name === n);
  const hg = MN('Hungry Ghosts'), dm = MN('Deflect Missile');
  check('Hungry Ghosts: Eldritch Blackguard, 4th degree, 3 exertion, a bonus-action stance', hg.system.tradition === 'eldritchBlackguard' && hg.system.degree === 4 && hg.system.exertionCost === 3 && hg.system.isStance
    && Object.values(hg.system.actions)[0].activation.type === 'bonusAction');
  check('the site\'s "Def lect Missile" is Deflect Missile', !!dm && !man.some((d) => /Def lect/.test(d.name)));
  const FT = (n) => feats.find((d) => d.name === n);
  const G = (d, t) => Object.values(d.system.grants).filter((g) => (g.proficiencyType ?? g.traits?.traitType ?? g.grantType) === t);
  check('feats: a5e\'s feat type with the prerequisite the Add Feat window reads', feats.every((d) => d.system.featureType === 'feat') && FT('Audio Engineer').system.prerequisite === '3 levels in artificer , 3 levels in bard');
  check('"Your Intelligence or Wisdom score increases by 1": a choice of the two', JSON.stringify(G(FT('Divine Spark'), 'ability')[0]?.abilities) === '{"base":[],"options":["int","wis"],"total":1}');
  check('"proficiency with the Socialite Stance and To My Side maneuvers": both maneuvers granted', G(FT('Rally Point Warrior'), 'item')[0]?.items.base.length === 2);
  check('Secret Agent: garottes, assassin\'s gauntlets and boot daggers (not every dagger)', JSON.stringify(G(FT('Secret Agent'), 'weapon')[0]?.keys.base) === '["garotte","assassinsGauntlet","bootDagger"]');
  const BG = (n) => bgs.find((d) => d.name === n);
  const ar = BG('Archaeologist');
  check('Archaeologist: +1 Intelligence and one more, History and Arcana or Survival, a tool of two, two languages, gear from a5e, its feature',
    JSON.stringify(G(ar, 'ability')[0].abilities.base) === '["int"]' && G(ar, 'skill')[0].keys.base.join() === 'his' && G(ar, 'skill')[0].keys.options.join() === 'arc,sur'
      && G(ar, 'tool')[0].keys.options.length === 2 && G(ar, 'languages')[0].traits.total === 2 && G(ar, 'item')[0].items.base.length >= 3
      && byId.get(G(ar, 'feature')[0].features.base[0].uuid.split('.').pop())?.system.featureType === 'background');
  check('backgrounds: connections and mementos as lists the builder rolls', bgs.every((d) => /CONNECTIONS<\/h3><ol>(<li>[^<]+<\/li>){6,}/.test(d.system.description) && /MEMENTOS<\/h3><ol>/.test(d.system.description)));
  const dk = dests.find((d) => d.name === 'Darkness');
  check('Darkness: its source of inspiration, inspiration and fulfillment features, and six motivations',
    ['sourceOfInspiration', 'inspirationFeature', 'fulfillmentFeature'].every((k) => byId.get(dk.system[k].split('.').pop())?.system.featureType === 'destiny')
      && /MOTIVATIONS<\/h3><ol>(<li>[^<]+<\/li>){6}<\/ol>/.test(dk.system.description));
  const pets = obj.filter((d) => /<em>(Mount|Pet)<\/em>/.test(d.system.description));
  check('mounts and pets: bought here, their stat blocks linked from a5e\'s monsters', pets.length >= 45 && pets.filter((d) => /a5e-monsters\.Actor\./.test(d.system.description)).length >= pets.length - 2,
    `${pets.filter((d) => /a5e-monsters/.test(d.system.description)).length}/${pets.length} linked`);
  const st = obj.find((d) => d.name === 'Stabling');
  check('Stabling: 5 sp, per day', st.system.price.value === 5 && st.system.price.denomination === 'sp' && st.system.price.special === 'per day');
  check('hirelings: the three tiers each at its price', ['inexperienced', 'seasoned', 'expert'].every((t, i) => obj.find((d) => d.name === `Bodyguard, ${t}`)?.system.price.value === [500, 2000, 5000][i]));
}

/* D. the pack, with both files and its folders */
{
  const { ImportedPack } = await import(pathToFileURL(path.join(root, 'utils', 'importedPack.js')).href).catch(async (e) => {
    // the module's globals first
    throw e;
  });
  const { GENERATED } = await import(pathToFileURL(path.join(root, 'data', 'imported', 'generated.js')).href);
  const ORIGINS = read(path.join(root, 'data', 'imported', 'a5etools-origins.json'));
  const MONSTERS = read(path.join(root, 'data', 'imported', 'a5etools-monsters.json'));
  check('the manifest lists every converted file and every document, and which hold actors',
    GENERATED.files.length === 4 && GENERATED.count === ARCH.length + CONTENT.length + ORIGINS.length + MONSTERS.length
    && GENERATED.files.filter((f) => f.documents === 'Actor').map((f) => f.count).join() === String(MONSTERS.length));
  const served = Object.fromEntries(GENERATED.files.map((f) => [`/modules/a5e-mancer/${f.file}`, read(path.join(P.MODULE, f.file))]));
  let fetched = 0;
  globalThis.fetch = async (url) => { fetched++; return { ok: !!served[url], status: served[url] ? 200 : 404, json: async () => JSON.parse(JSON.stringify(served[url])) }; };
  const created = [], folders = [], monsterFolders = [];
  const makePack = ({ name, type }) => {
    const pack = { collection: `world.${name}`, locked: false, folder: null, folders: [], metadata: { type },
      async getDocuments() { return []; }, async getIndex() { return []; }, async configure() {}, async setFolder() {} };
    game.packs.set(pack.collection, pack);
    return pack;
  };
  globalThis.Item = { createDocuments: async (docs) => { created.push(...docs); return docs; }, deleteDocuments: async () => [] };
  globalThis.Actor = { createDocuments: async (docs) => docs, deleteDocuments: async () => [] };
  globalThis.foundry.documents = {
    Folder: { createDocuments: async (datas) => datas.map((d, i) => { const f = { ...d, id: `folder${d.type}${String(i).padStart(10, '0')}` }; (d.type === 'Actor' ? monsterFolders : folders).push(f); return f; }), deleteDocuments: async () => [] },
    collections: { CompendiumCollection: { createCompendium: async (data) => makePack(data) } }
  };
  ImportedPack.registerSource();
  check('the sources the module adds are named for a5e', ['a5eMancerGPG', 'a5eMancerPlanestrider', 'a5eMancerMythological', 'a5eMancerOther'].every((k) => CONFIG.A5E.products[k]?.title));
  await ImportedPack.ensure();
  check('the item pack holds everything but the monsters, fetched from each file once',
    created.length === 10 + GENERATED.count - MONSTERS.length && fetched === GENERATED.files.length, `${created.length} documents, ${fetched} fetches`);
  const order = folders.map((f) => f.name).join(' / ');
  check('a folder per kind, in order, every document in one',
    order === 'Heritages / Heritage Features / Paragon Gifts / Cultures / Culture Features / Backgrounds / Background Features / Destinies / Destiny Features / Archetypes / Archetype Features / Feats / Combat Maneuvers / Spells / Psionic Powers / Magic Items / Equipment'
    && created.every((d) => d.folder), order);
  const inFolder = (n) => created.filter((d) => d.folder === folders.find((f) => f.name === n)?.id).length;
  check('the counts per folder', inFolder('Archetypes') === 89 && inFolder('Spells') === 25 && inFolder('Psionic Powers') === 92 && inFolder('Magic Items') === 142 && inFolder('Equipment') === 245
      && inFolder('Combat Maneuvers') === 91 && inFolder('Feats') === 112 && inFolder('Backgrounds') === 20 && inFolder('Background Features') === 20 && inFolder('Destinies') === 7 && inFolder('Destiny Features') === 21
      && inFolder('Heritages') === 20 && inFolder('Cultures') === 33 && inFolder('Heritage Features') + inFolder('Paragon Gifts') + inFolder('Culture Features') === ORIGINS.length - 53,
    folders.map((f) => `${f.name} ${inFolder(f.name)}`).join(', '));
}

console.log(results.join('\n'));
const fails = results.filter((x) => x.startsWith('FAIL')).length;
console.log(`\n${results.length - fails}/${results.length} passed`);
process.exit(fails ? 1 : 0);
