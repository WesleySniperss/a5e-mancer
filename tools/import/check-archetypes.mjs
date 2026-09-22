// Step 4: the converted archetypes, through the module's real GrantAbsorber,
// ProseSpells and ImportedPack, against a5e's pack data from .cache.
//   node tools/import/check-archetypes.mjs
import { createRequire } from 'module';
import { pathToFileURL } from 'url';
import path from 'path';
import fs from 'fs';
const require = createRequire(import.meta.url);
const P = require('./lib/paths.cjs');
const root = path.join(P.MODULE, 'scripts');

const classes  = JSON.parse(fs.readFileSync(path.join(P.PACKS, 'classes.json'), 'utf8'));
const archs    = JSON.parse(fs.readFileSync(path.join(P.PACKS, 'archetypes.json'), 'utf8'));
const features = JSON.parse(fs.readFileSync(path.join(P.PACKS, 'classFeatures.json'), 'utf8'));
const spells   = JSON.parse(fs.readFileSync(path.join(P.PACKS, 'spells.json'), 'utf8'));
const a5eMans  = JSON.parse(fs.readFileSync(path.join(P.PACKS, 'maneuvers.json'), 'utf8'));
const GEN = JSON.parse(fs.readFileSync(path.join(root, 'data', 'imported', 'a5etools-archetypes.json'), 'utf8'));
const idOf = (u) => String(u ?? '').split('.').pop();

class Collection extends Map {
  get contents() { return [...this.values()]; }
  filter(f) { return this.contents.filter(f); } find(f) { return this.contents.find(f); }
  map(f) { return this.contents.map(f); } some(f) { return this.contents.some(f); }
  [Symbol.iterator]() { return this.values(); }
}
globalThis.Collection = Collection;
String.prototype.slugify = function () { return this.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); };
globalThis.foundry = {
  utils: { mergeObject: (a, b) => ({ ...a, ...b }), deepClone: (o) => JSON.parse(JSON.stringify(o ?? null)),
           getProperty: (o, p) => p.split('.').reduce((x, k) => x?.[k], o), getRoute: (p) => '/' + p,
           setProperty: (o, p, v) => { const k = p.split('.'); let t = o; for (const s of k.slice(0, -1)) t = t[s] ??= {}; t[k.at(-1)] = v; } },
  applications: { ux: { TextEditor: { implementation: { enrichHTML: async (s) => s } } } }
};
globalThis.TextEditor = globalThis.foundry.applications.ux.TextEditor.implementation;
const settings = new Map([['buildImportedPack', true]]);
globalThis.game = { i18n: { localize: (k) => k, format: (k) => k }, user: { isGM: true }, packs: new Map(),
  settings: { get: (m, k) => (settings.has(k) ? settings.get(k) : 0), set: async (m, k, v) => { settings.set(k, v); } } };
globalThis.CONFIG = { A5E: { products: {} } };
globalThis.ui = { notifications: { warn() {}, error() {}, info() {} } };
globalThis.Hooks = { on() {}, once() {} };

const results = [];
const check = (n, ok, d = '') => results.push(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`);

const { AM } = await import(pathToFileURL(path.join(root, 'am.js')).href);
AM.log = () => {};
const { DREAD_KNIGHT } = await import(pathToFileURL(path.join(root, 'data', 'imported', 'dreadKnight.js')).href);
const byId = new Map([...classes, ...archs, ...features, ...spells, ...a5eMans, ...DREAD_KNIGHT, ...GEN].map(d => [d._id, d]));

function prep(raw, key) {
  const g = { ...raw };
  const bucket = Object.values(raw).find(v => v && typeof v === 'object' && Array.isArray(v.options));
  g.requiresConfig = () => !!(bucket && bucket.options.length);
  g.getApplyData = (_actor, sel) => ({ [`applied.${key}`]: sel });
  return g;
}
function wrap(raw) {
  return { ...raw, id: raw._id, uuid: `Compendium.x.Item.${raw._id}`,
    grants: new Map(Object.entries(raw.system?.grants ?? {}).map(([k, v]) => [k, prep(v, k)])),
    _stats: raw._stats ?? {}, toObject() { return JSON.parse(JSON.stringify(raw)); } };
}
globalThis.fromUuid = async (uuid) => { const r = byId.get(idOf(uuid)); return r ? wrap(r) : null; };
function makeActor() {
  const items = new Collection();
  const actor = { created: [], updates: [], items,
    async createEmbeddedDocuments(_t, datas) { return datas.map(d => { const it = wrap(d); it._stats = d._stats ?? {}; items.set(d._id ?? d.name, it); actor.created.push(d.name); return it; }); },
    async update(u) { actor.updates.push(u); },
    give(raw, uuid) { const it = wrap(raw); it._stats = { compendiumSource: uuid ?? `Compendium.x.Item.${raw._id}` }; items.set(raw._id, it); return it; } };
  return actor;
}
const { GrantAbsorber } = await import(pathToFileURL(path.join(root, 'utils', 'grantAbsorber.js')).href);
const { ProseSpells } = await import(pathToFileURL(path.join(root, 'utils', 'proseSpells.js')).href);
const MS = await import(pathToFileURL(path.join(root, 'utils', 'maneuverService.js')).href);
const PACK = 'Compendium.world.a5e-mancer-imported.Item.';
const arches = GEN.filter(d => d.type === 'archetype');
const genFeat = GEN.filter(d => d.type === 'feature');

/* A. the documents */
{
  const ids = [...GEN, ...DREAD_KNIGHT].map(d => d._id);
  check('622 converted documents: 88 archetypes and their features', GEN.length === 622 && arches.length === 88 && genFeat.length === 534, `${GEN.length}/${arches.length}/${genFeat.length}`);
  check('every id is 16 letters and digits and unique, the Dread Knight\'s included', ids.every(i => /^[A-Za-z0-9]{16}$/.test(i)) && new Set(ids).size === ids.length);
  const inner = GEN.flatMap(d => [...Object.keys(d.system.grants ?? {}), ...Object.keys(d.system.actions ?? {}),
    ...Object.values(d.system.actions ?? {}).flatMap(a => [...Object.keys(a.prompts), ...Object.keys(a.rolls), ...Object.keys(a.consumers)])]);
  check('grant, action, roll, prompt and consumer ids are 16 characters', inner.every(i => /^[A-Za-z0-9]{16}$/.test(i)), inner.filter(i => !/^[A-Za-z0-9]{16}$/.test(i)).slice(0, 5).join(','));
  const links = [], dead = [];
  for (const d of GEN) {
    for (const g of Object.values(d.system.grants ?? {})) for (const e of [...(g.features?.base ?? []), ...(g.features?.options ?? [])]) links.push([d.name, e.uuid]);
    for (const m of d.system.description.matchAll(/@UUID\[([^\]]+)\]/g)) links.push([d.name, m[1]]);
  }
  for (const [n, u] of links) if (!byId.has(idOf(u))) dead.push(`${n}: ${u}`);
  check('every grant and @UUID link resolves - to the pack or to a5e\'s', !dead.length, `${links.length} links; dead: ${dead.slice(0, 5).join(' | ') || 'none'}`);
  const classKeys = new Set(classes.map(c => c.system.slug || c.name.toLowerCase()));
  const badClass = arches.filter(a => !classKeys.has(a.system.class));
  check('every archetype names a class the packs have', !badClass.length, badClass.map(a => a.name + '/' + a.system.class).join(', '));
  const imgs = GEN.map(d => d.img);
  const FOUNDRY = P.PUBLIC;
  const missing = [...new Set(imgs)].filter(i => !fs.existsSync(FOUNDRY + i));
  check('every icon is one of Foundry\'s', !missing.length, missing.slice(0, 5).join(', '));
  const noDesc = GEN.filter(d => !d.system.description || d.system.description.replace(/<[^>]+>/g, '').trim().length < 20);
  check('every document has its text', !noDesc.length, noDesc.map(d => d.name).join(', '));
  const leaks = GEN.filter(d => /<(span|font|div|img|a) |style=|class=|&nbsp;|⟦L/.test(d.system.description));
  check('no page markup is left in the text (spans, styles, links to a5e.tools rules, level images)', leaks.every(d => !/<(span|font|div|img) |style=|class=|&nbsp;|⟦L/.test(d.system.description)), leaks.slice(0, 3).map(d => d.name).join(', '));
  const srcBad = arches.filter(a => !/^(gpg\d+|a5eMancerGPG|adventuresInZeitgeist|voidrunnersCodex|adventurersGuide)$/.test(a.system.source));
  check('sources: a Gate Pass Gazette issue, the series, ZEITGEIST, Voidrunner\'s Codex or the Adventurer\'s Guide', !srcBad.length, srcBad.map(a => a.system.source).join(','));
}

/* B/C. every archetype: its first level through the builder's path, then each later level */
const probs = [];
let levelsRun = 0, choicesAsked = 0, grantsApplied = 0;
for (const arch of arches) {
  const cls = classes.find(c => (c.system.slug || c.name.toLowerCase()) === arch.system.class);
  const levels = Object.values(arch.system.grants).filter(g => g.grantType === 'feature').map(g => g.level).sort((a, b) => a - b);
  const first = levels[0];
  for (const lvl of levels) {
    const actor = makeActor();
    const c = actor.give(cls); c.system = { ...c.system, classLevels: lvl };
    const archItem = actor.give(arch, PACK + arch._id);
    const ctx = { charLevel: lvl, clsLevel: lvl };
    let tree;
    try { tree = lvl === first ? await GrantAbsorber.describeTree(archItem, ctx) : await GrantAbsorber.describeTreeForLevel(archItem, ctx, {}); }
    catch (err) { probs.push(`${arch.name} L${lvl}: describe threw ${err.message}`); continue; }
    // pick the first option of every choice, twice, so nested choices open
    const choices = {};
    for (let pass = 0; pass < 3; pass++) {
      const t = pass ? await (lvl === first ? GrantAbsorber.describeTree(archItem, ctx, { choices }) : GrantAbsorber.describeTreeForLevel(archItem, ctx, choices)) : tree;
      for (const g of [...t.grants, ...t.features]) if (!choices[g.id] && g.options?.length) { choices[g.id] = g.options.slice(0, g.total || 1).map(o => o.key); choicesAsked++; }
    }
    try {
      if (lvl === first) await GrantAbsorber.apply(actor, archItem, choices, ctx);
      else await GrantAbsorber.applyArchetypeGrants(actor, c, ctx, choices);
    } catch (err) { probs.push(`${arch.name} L${lvl}: apply threw ${err.message}`); continue; }
    levelsRun++;
    const want = Object.values(arch.system.grants).find(g => g.grantType === 'feature' && g.level === lvl).features.base.map(e => e.name);
    const missing = want.filter(n => !actor.created.includes(n));
    if (missing.length) probs.push(`${arch.name} L${lvl}: not created ${missing.join(', ')} (created ${actor.created.join(', ')})`);
    grantsApplied += JSON.stringify(actor.updates).split('applied.').length - 1;
  }
}
check('every level of every archetype: the builder or the level-up describes it and creates its features', !probs.length && levelsRun === 377,
  `${levelsRun} levels, ${choicesAsked} choices answered, ${grantsApplied} grants written${probs.length ? '; ' + probs.slice(0, 4).join(' | ') : ''}`);

/* D. particular archetypes, read closely */
const A = (n) => arches.find(a => a.name === n);
const F = (arch, n) => genFeat.find(f => f.name === n && f.flags['a5e-mancer'].imported === arch.flags['a5e-mancer'].imported);
const G = (f, type) => Object.values(f?.system.grants ?? {}).filter(g => (g.proficiencyType ?? g.traits?.traitType ?? g.grantType) === type);
{
  const tk = A('Tinker'), bp = F(tk, 'Bonus Proficiencies');
  const tools = G(bp, 'tool');
  check('Tinker: tinker\'s tools, and three artisan\'s tools of choice', tools.some(g => g.keys.base.includes('tinkersTools')) && tools.some(g => g.keys.total === 3 && g.keys.options.length === 16), JSON.stringify(tools.map(g => g.keys.total)));
  const ak = A('Anomalous Knight'), ae = F(ak, 'Alien Emissary');
  check('Anomalous Knight: Deep Speech, Arcana, the aberrations specialty',
    G(ae, 'languages')[0]?.traits.base.includes('deep') && G(ae, 'skill')[0]?.keys.base.includes('arc') && G(ae, 'skillSpecialty')[0]?.specialties.base.includes('aberrations'));
  const lr = F(A('Last Raven'), 'Ravencraft');
  check('Last Raven: thieves\' tools, and two of four skills', G(lr, 'tool')[0]?.keys.base.includes('thievesTools') && G(lr, 'skill').some(g => g.keys.total === 2 && g.keys.options.length === 4));
  const sd = F(A('Seadog'), 'Adaptive Traditions');
  check('Seadog: one of three combat traditions', G(sd, 'tradition')[0]?.keys.total === 1 && G(sd, 'tradition')[0].keys.options.join() === 'mirrorsGlint,toothAndClaw,rapidCurrent');
  const hm = A('Houndmaster');
  check('Houndmaster: the companion\'s Tooth and Claw is not the character\'s', !genFeat.filter(f => f.flags['a5e-mancer'].imported === hm.flags['a5e-mancer'].imported).some(f => G(f, 'tradition').length));
  const pa = F(A('Preserver'), 'Protective Arsenal');
  check('Preserver: Medicine, heavy armor and shields', G(pa, 'armor')[0]?.keys.base.join() === 'heavy,shield' && G(pa, 'skill')[0]?.keys.base.join() === 'med');
  const ti = A('Titanist'), bl = F(ti, 'Bond with the Land');
  check('Titanist: a resistance that depends on the titan chosen is not granted', !G(bl, 'damageResistances').length);
  const et = F(A('Elastic Thinker'), 'Incredible Intelligence');
  check('Elastic Thinker: Intelligence +2 at 15th', G(et, 'ability')[0]?.bonus === '2' && G(et, 'ability')[0].abilities.base[0] === 'int' && G(et, 'ability')[0].level === 15);
  const pp = F(A('Pied Piper'), 'Bonus Proficiencies and Specialties');
  check('Pied Piper: one wind instrument of choice', G(pp, 'tool').some(g => g.keys.total === 1 && g.keys.options.includes('flute') && !g.keys.options.includes('lute')));
  const ss = F(A('Security Specialist'), 'Bonus Proficiencies');
  check('Security Specialist: light and medium armor; "shields or 4 weapons" left to the text', G(ss, 'armor')[0]?.keys.base.join() === 'light,medium' && !G(ss, 'weapon').length);
  // choices
  const bb = F(A('Bear-Bonded'), 'Ursine Defense');
  const bbOpt = Object.values(bb.system.grants).find(g => g.grantType === 'feature');
  check('Bear-Bonded: Ursine Defense is a choice of Armored or Rugged', bbOpt?.features.total === 1 && bbOpt.features.options.map(o => o.name).join() === 'Armored,Rugged');
  const cv = F(A('Machinist'), 'Custom Vehicle');
  check('Machinist: the vehicle\'s modifications are a list to pick from at each rest, not a choice made once', !Object.values(cv.system.grants).some(g => g.grantType === 'feature') && /Armor Plating/.test(cv.system.description));
  const nk = F(A('Blinkwitch'), 'Faerie Noble Knacks');
  const nkg = Object.values(nk.system.grants).filter(g => g.grantType === 'feature');
  check('Blinkwitch: at 14th a noble knack, and one more knack of the earlier lists', nkg.length === 2 && nkg.some(g => g.features.options.length === 6));
  const adv = F(A('Naturalist'), 'Adaptive Survival');
  check('Naturalist: Adaptive Survival offers its two options and Hazardous Study\'s two', Object.values(adv.system.grants).find(g => g.grantType === 'feature')?.features.options.length === 4);
  // warlocks and their spell lists
  const eg = A('Eldritch Gunslinger'), gg = A('Gyre Gazer');
  const hasExp = (a) => Object.values(a.system.grants).some(g => g.features?.base.some(e => e.uuid.endsWith('9z7flr4asm95pk3c')));
  check('warlocks: a5e\'s Expanded Spell List choice for the Gunslinger, their own list for the Gyre Gazer', hasExp(eg) && !hasExp(gg) && !!F(gg, 'Gyre Gazer Expanded Spell List'));
  // levels from the text over a mislabelled image
  const tm = F(A('Titanist'), 'Terrain Manifestation');
  check('Titanist: Terrain Manifestation at 7th, as its text says (the page\'s image says 3rd)', Object.values(A('Titanist').system.grants).find(g => g.level === 7)?.features.base.some(e => e.name === 'Terrain Manifestation'));
  const ap = A('Eldritch Gunslinger');
  check('Eldritch Gunslinger: Alternative Pact at 1st - "Pact of the Blade at 3rd level" later in its text is not its level', Object.values(ap.system.grants).find(g => g.level === 1)?.features.base.some(e => e.name === 'Alternative Pact'));
  // uses and actions
  const ta = F(A('Throwing Ace'), 'Charged Throw');
  const lf = F(A('Stormwalker'), "Lightning's Embrace");
  const lfa = Object.values(lf.system.actions)[0];
  check('Stormwalker: Lightning\'s Embrace - Wisdom-modifier uses a long rest, a reaction, a Dexterity save, 3d10 lightning',
    lf.system.uses.max === 'max(1, @wis.mod)' && lf.system.uses.per === 'longRest' && lfa.activation.type === 'reaction'
    && Object.values(lfa.prompts)[0]?.ability === 'dex' && Object.values(lfa.rolls)[0]?.formula === '3d10' && Object.values(lfa.consumers).some(c => c.type === 'itemUses'));
  const su = F(A('Bodyguard'), 'Suspicious Eye');
  check('Bodyguard: Suspicious Eye spends 2 exertion as an action', Object.values(su.system.actions)[0]?.activation.type === 'action' && Object.values(Object.values(su.system.actions)[0].consumers).some(c => c.resource === 'exertion' && c.quantity === 2));
  const be = F(A('Bodyguard'), 'Bonus Expertise');
  check('Bodyguard: Bonus Expertise is passive (no action from "when they’d normally take an action")', !Object.keys(be.system.actions).length);
}

/* E. spells: tables and sentences, as ProseSpells reads them */
{
  const lookup = ProseSpells.buildLookup(spells.map(s => ({ id: s._id, uuid: `Compendium.a5e.a5e-spells.Item.${s._id}`, name: s.name, level: s.system.level })));
  const auto = (f) => ProseSpells.parse(f.system.description, lookup, { classKey: f.system.classes, name: f.name });
  const art = genFeat.filter(f => f.system.classes === 'artificer' && /Spells$/.test(f.name));
  const counts = art.map(f => [f.name, auto(f).auto.length]);
  check('the artificer archetype spell tables are read by ProseSpells, ten spells each (the Botanotechnitian chooses from the artificer list instead)', art.length === 8 && counts.filter(([n]) => !/Botanotechnitian/.test(n)).every(([, n]) => n >= 9), counts.map(([n, c]) => `${n.replace(/ Spells$/, '')} ${c}`).join(', '));
  const wl = genFeat.filter(f => /Expanded Spell List$/.test(f.name));
  check('a warlock\'s own expanded list is read as a list to choose from, not spells known', wl.length === 3 && wl.every(f => !auto(f).auto.length && auto(f).skipped.includes('expanded list')), wl.map(f => `${f.name}: ${auto(f).auto.length}/${auto(f).skipped.join('+')}`).join(' | '));
  const fb = F(A('Living Flame'), 'Flameborn');
  const fbs = auto(fb).auto.map(s => s.name).sort().join(', ');
  check('Living Flame: Flameborn gives fire bolt and produce flame', fbs === 'Fire Bolt, Produce Flame', fbs);
  const tmag = F(A('Titanist'), 'Titan Magic');
  check('Titanist: the spells of all five titans are not all granted - each titan gives its own', auto(tmag).auto.length === 0);
  const links = genFeat.reduce((n, f) => n + (f.system.description.match(/@UUID\[Compendium\.a5e\.a5e-spells/g)?.length ?? 0), 0);
  check('spell names are linked to a5e\'s spells', links > 200, `${links} links`);
}

/* F. the Imported pack: built from the written and the converted content */
{
  const { ImportedPack } = await import(pathToFileURL(path.join(root, 'utils', 'importedPack.js')).href);
  const { GENERATED } = await import(pathToFileURL(path.join(root, 'data', 'imported', 'generated.js')).href);
  let fetched = 0;
  // every converted file the manifest lists, served as the module would
  const served = Object.fromEntries(GENERATED.files.map((f) => ['/modules/a5e-mancer/' + f.file, JSON.parse(fs.readFileSync(path.join(P.MODULE, f.file), 'utf8'))]));
  globalThis.fetch = async (url) => { fetched++; return { ok: !!served[url], status: served[url] ? 200 : 404, json: async () => JSON.parse(JSON.stringify(served[url])) }; };
  const batches = [];
  const packDocs = [];
  const pack = { collection: 'world.a5e-mancer-imported', locked: false, folder: null, metadata: {},
    async getDocuments() { return packDocs.splice(0); }, async getIndex() { return []; }, async configure() {}, async setFolder() {} };
  globalThis.Item = { createDocuments: async (docs) => { batches.push(docs.length); packDocs.push(...docs); return docs; }, deleteDocuments: async () => [] };
  globalThis.foundry.documents = { Folder: { createDocuments: async (d) => d.map((x, i) => ({ ...x, id: 'f' + String(i).padStart(15, '0') })), deleteDocuments: async () => [] },
    collections: { CompendiumCollection: { createCompendium: async () => { game.packs.set(pack.collection, pack); return pack; } } } };
  ImportedPack.registerSource();
  check('the Gate Pass Gazette series is a source a5e can name', CONFIG.A5E.products.a5eMancerGPG?.abbreviation === 'GPG');
  await ImportedPack.ensure();
  check('the pack holds the Dread Knight\'s 10 and every converted document, created in batches of at most 100',
    packDocs.length === 10 + GENERATED.count && batches.every(n => n <= 100) && fetched === GENERATED.files.length, `${packDocs.length} in ${batches.join('+')}, fetched ${fetched}`);
  const before = batches.length;
  await ImportedPack.ensure();
  check('with nothing changed it is not rebuilt, and the JSON not fetched again', batches.length === before && fetched === GENERATED.files.length);
  check('the hash covers both kinds of content', ImportedPack.hash.includes(`+${GENERATED.count}:${GENERATED.hash}`), ImportedPack.hash);
}

console.log(results.join('\n'));
const fails = results.filter(x => x.startsWith('FAIL')).length;
console.log(`\n${results.length - fails}/${results.length} passed`);
process.exit(fails ? 1 : 0);
