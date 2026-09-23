/* a5e's Hidden Compendium Sources, applied: what is taken out of the packs'
 * indexes, what the pickers are handed, and that a later index request - which
 * gets the whole pack back from the server - does not bring the hidden ones
 * back. Real a5e pack data (heritages, classes, feats) behind stub packs that
 * behave as Foundry v14's do: getIndex({fields}) merges the server's answer into
 * the loaded index, database.get({index: true}) answers without merging.
 *
 * Reads a5e's packs from tools/import/.cache: run tools/import/prepare.cjs once.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const R = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PACKS = path.join(R, 'tools', 'import', '.cache', 'packs');
if (!fs.existsSync(path.join(PACKS, 'heritages.json'))) {
  console.log('tools/import/.cache/packs is empty - run node tools/import/prepare.cjs first');
  process.exit(1);
}
const read = (f) => JSON.parse(fs.readFileSync(path.join(PACKS, f), 'utf8'));

/* What the world has saved - a JSON string - or null when no GM ever saved the
   setting; a5e's own code reads only this, not the registered default. */
let saved = JSON.stringify(['voidrunnersCodex']);
class Collection extends Map {
  [Symbol.iterator]() { return this.values(); }   // as Foundry's Collection: values, not pairs
  get contents() { return [...this.values()]; }
  filter(f) { return this.contents.filter(f); }
  map(f) { return this.contents.map(f); }
  find(f) { return this.contents.find(f); }
}
globalThis.foundry = { utils: { hasProperty: () => false, mergeObject: (a, b) => Object.assign(a, b) } };
globalThis.game = {
  i18n: { localize: (k) => k, format: (k) => k }, user: { isGM: true }, modules: new Map(),
  settings: {
    // the registered default, which is NOT what decides - see HiddenSources.keys
    get: (ns, key) => (ns === 'a5e' && key === 'disabledCompendiaSources' ? ['voidrunnersCodex'] : false),
    storage: new Map([['world', { getItem: (key) => (key === 'a5e.disabledCompendiaSources' ? saved : null) }]])
  },
  packs: new Collection()
};
globalThis.CONFIG = { A5E: { products: {} } };
globalThis.ui = { notifications: { warn() {}, error() {}, info() {} } };
globalThis.Hooks = { on() {}, once() {} };

/** A pack as Foundry v14 keeps one: a plain index at load, fields merged in on request. */
function makePack(collection, type, docs) {
  const pick = (d, fields) => {
    const e = { _id: d._id, name: d.name, type: d.type, img: d.img };
    for (const f of fields) {
      const val = f.split('.').reduce((o, k) => o?.[k], d);
      if (val === undefined) continue;
      const keys = f.split('.'); let t = e;
      for (const k of keys.slice(0, -1)) t = t[k] ??= {};
      t[keys.at(-1)] = val;
    }
    return e;
  };
  const pack = {
    collection, metadata: { type, id: collection }, index: new Collection(), treeBuilt: 0,
    initializeTree() { this.treeBuilt++; },
    documentClass: { database: { get: async (_cls, { indexFields = [] }) => docs.map(d => pick(d, indexFields)) } },
    async getIndex({ fields = [] } = {}) {
      for (const d of docs) {                    // the server answers with every document
        const e = pick(d, fields);
        const had = this.index.get(e._id);
        this.index.set(e._id, had ? Object.assign(had, e) : e);
      }
      return this.index;
    }
  };
  for (const d of docs) pack.index.set(d._id, pick(d, []));   // world load: the plain index
  game.packs.set(collection, pack);
  return pack;
}

const heritages = read('heritages.json');
const classes = read('classes.json');
const feats = read('feats.json');
const hPack = makePack('a5e.a5e-heritages', 'Item', heritages);
const cPack = makePack('a5e.a5e-classes', 'Item', classes);
const fPack = makePack('a5e.a5e-feats', 'Item', feats);
const challenges = JSON.parse(fs.readFileSync(path.join(R, 'scripts', 'data', 'imported', 'a5etools-challenges.json'), 'utf8'));
const jPack = makePack('world.a5e-mancer-imported-challenges', 'JournalEntry', challenges.map(c => ({ ...c, type: 'base' })));

const { AM } = await import(pathToFileURL(path.join(R, 'scripts', 'am.js')).href);
AM.log = () => {};
const { HiddenSources } = await import(pathToFileURL(path.join(R, 'scripts', 'utils', 'hiddenSources.js')).href);
const { PackFilter } = await import(pathToFileURL(path.join(R, 'scripts', 'utils', 'packFilter.js')).href);

const results = [];
const check = (n, ok, d = '') => results.push(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`);
const vc = (list) => list.filter(d => d.system?.source === 'voidrunnersCodex');
const vcChallenges = challenges.filter(c => c.flags['a5e-mancer'].challenge.source === 'voidrunnersCodex');

const before = { h: hPack.index.size, c: cPack.index.size, f: fPack.index.size, j: jPack.index.size };
const dropped = await HiddenSources.apply();
check('with Voidrunner\'s Codex saved as hidden, its heritages, classes and feats leave the indexes',
  hPack.index.size === before.h - vc(heritages).length && cPack.index.size === before.c - vc(classes).length && fPack.index.size === before.f - vc(feats).length
  && vc(heritages).length > 0 && vc(classes).length > 0,
  `heritages ${before.h}->${hPack.index.size}, classes ${before.c}->${cPack.index.size}, feats ${before.f}->${fPack.index.size}`);
check('the Voidrunner exploration challenges leave the Imported journal pack, read from the module\'s flags',
  jPack.index.size === before.j - vcChallenges.length && vcChallenges.length > 0, `${before.j}->${jPack.index.size}`);
check('everything else stays, and the sidebar tree is rebuilt where entries went',
  [...hPack.index.values()].every(e => !HiddenSources.isHidden({ system: { source: heritages.find(h => h._id === e._id)?.system?.source } }))
  && hPack.treeBuilt === 1 && dropped === vc(heritages).length + vc(classes).length + vc(feats).length + vcChallenges.length, `${dropped} taken out`);
check('applied once a session: a second call is the same answer, no second request', (await HiddenSources.apply()) === dropped);

const rich = await PackFilter.indexOf(cPack, ['name', 'type', 'img', 'system'], { types: ['class'] });
check('a picker\'s index request gets the whole pack from the server, and the hidden classes go again - from its answer and from the index',
  [...rich].every(e => e.system?.source !== 'voidrunnersCodex') && cPack.index.size === before.c - vc(classes).length,
  `${[...rich].length} classes offered`);
const names = [...rich].map(e => e.name);
check('...so a Voidrunner class is not offered, and the core ones are', vc(classes).every(c => !names.includes(c.name)) && names.includes('Wizard'),
  vc(classes).map(c => c.name).join(', '));

saved = null;
check('a setting no GM ever saved hides nothing, as a5e reads it - though its window shows Voidrunner\'s Codex ticked',
  HiddenSources.keys.size === 0 && HiddenSources.filter(vc(classes)).length === vc(classes).length && HiddenSources.drop(fPack) === 0);
saved = JSON.stringify([]);
check('saved empty, nothing is hidden either', HiddenSources.keys.size === 0);

console.log(results.join('\n'));
const fails = results.filter(x => x.startsWith('FAIL')).length;
console.log(`\n${results.length - fails}/${results.length} passed`);
process.exit(fails ? 1 : 0);
