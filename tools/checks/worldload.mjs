/* What the module asks the server for while a world loads.
 *
 * Reported as: something takes long to load.
 *
 * Two loaders run at `ready`, for every user, GM and player alike:
 *
 *   DocumentService.loadAndInitializeDocuments — the builder's lists of
 *     heritages, cultures, backgrounds, destinies and classes.
 *   SpellService.loadSpellcastingFeatures — the spell tables in the classes'
 *     Spellcasting features.
 *
 * This runs both over copies of a5e's Item packs (packcopy2/, 21 packs), behind
 * a pack that does what Foundry's CompendiumCollection does — getIndex and its
 * field check copied from client/documents/collections/compendium-collection.mjs,
 * including that it does not share a request still in flight — and counts the
 * requests and the JSON each would bring back.
 *
 * Against the released code (2.71.10), measured with AM_SCRIPTS pointing at a
 * copy of its scripts/:
 *   documents  105 index requests, every one carrying `system`: 119.2 MB of JSON
 *   features   31 document requests, one at a time
 * and from this tree: no requests for the lists, and 3 for the tables (2 of
 * them for documents, 0.8 MB — the classes pack's index, which the lists had
 * been paying for before).
 * What it read is compared too: the lists and the tables must be the same.
 *
 *   node tools/checks/worldload.mjs
 *   AM_SCRIPTS=<dir> node tools/checks/worldload.mjs --digest   another tree's scripts; prints what it read
 */
import './stubs.mjs';
import { createHash } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import { ClassicLevel } from 'classic-level';

const R = 'c:/Users/Jonkm/AppData/Local/FoundryVTT/Data/modules/a5e-mancer/';
const SCRIPTS = (process.env.AM_SCRIPTS ?? R + 'scripts').replace(/\\/g, '/').replace(/\/$/, '');
const DIGEST = process.argv.includes('--digest');
const results = [];
const check = (name, ok, detail) => results.push([name, ok, detail]);

/* ── The packs ───────────────────────────────────────────────────────────── */
const sys = JSON.parse(readFileSync(R + '../../systems/a5e/system.json', 'utf8'));
const requests = [];
const pick = (doc, fields) => {
  const out = {};
  for (const f of fields) {
    const path = f.split('.');
    let src = doc, dst = out;
    for (let i = 0; i < path.length; i++) {
      if (src == null || !(path[i] in Object(src))) break;
      if (i === path.length - 1) dst[path[i]] = JSON.parse(JSON.stringify(src[path[i]]));
      else { dst = dst[path[i]] ??= {}; src = src[path[i]]; }
    }
  }
  return out;
};
const tick = () => new Promise((r) => setTimeout(r, 1));

class Pack {
  static DEFAULT = ['name', 'type', 'img'];
  #indexedFields;
  constructor(meta, docs) {
    this.collection = `a5e.${meta.name}`;
    this.metadata = { id: this.collection, name: meta.name, label: meta.label, type: 'Item', packageType: 'system' };
    this.documentName = 'Item';
    this.docs = docs;
    this.indexFields = [...Pack.DEFAULT];
    /* Built when the world loads, as Foundry does. */
    this.index = new Collection(docs.map((d) => [d._id, { _id: d._id, ...pick(d, Pack.DEFAULT) }]));
    this.#indexedFields = new Set(this.indexFields);
  }
  async getIndex({ fields = [] } = {}) {
    const indexFields = new Set([...this.indexFields, ...fields]);
    if ([...indexFields].every((f) => this.#indexedFields.has(f))) return this.index;
    const wanted = ['_id', ...indexFields];
    const index = this.docs.map((d) => pick(d, wanted));
    requests.push({ pack: this.collection, kind: 'index', fields: [...indexFields],
                    bytes: JSON.stringify(index).length });
    await tick();
    for (const i of index) this.index.set(i._id, { ...(this.index.get(i._id) ?? {}), ...i });
    this.#indexedFields = indexFields;
    return this.index;
  }
  async getDocuments(query = {}) {
    const ids = query._id__in ? new Set(query._id__in) : query._id ? new Set([query._id]) : null;
    const found = this.docs.filter((d) => !ids || ids.has(d._id));
    requests.push({ pack: this.collection, kind: 'documents', n: found.length, bytes: JSON.stringify(found).length });
    await tick();
    return found.map((d) => ({ ...JSON.parse(JSON.stringify(d)), id: d._id, uuid: `Compendium.${this.collection}.Item.${d._id}` }));
  }
  async getDocument(id) { return (await this.getDocuments({ _id: id }))[0] ?? null; }
}

const packs = [];
for (const meta of sys.packs.filter((p) => p.type === 'Item')) {
  const dir = R + 'packcopy2/' + meta.path.replace(/^packs\//, '').replace(/\.db$/, '');
  if (!existsSync(dir)) continue;
  const db = new ClassicLevel(dir, { valueEncoding: 'json' });
  const docs = [];
  for await (const [k, v] of db.iterator()) if (k.startsWith('!items!') && !k.includes('.')) docs.push(v);
  await db.close();
  packs.push(new Pack(meta, docs));
}

globalThis.game = {
  i18n: { localize: (s) => String(s).split('.').pop(), format: (s) => s, has: () => false },
  packs: new Collection(packs.map((p) => [p.collection, p])),
  modules: new Collection(), user: { isGM: true }, users: new Collection(),
  settings: { get: (m, k) => (k?.endsWith('Packs') ? [] : (() => { throw new Error('unset'); })()), register() {} },
  system: { id: 'a5e' }
};
globalThis.ui = { notifications: { error() {}, warn() {}, info() {} } };
globalThis.CONFIG = { A5E: {} };
globalThis.fromUuid = async () => null;
globalThis.fromUuidSync = () => null;

const { AM } = await import('file:///' + SCRIPTS + '/am.js');
AM.LOG_LEVEL = 0;
const { DocumentService } = await import('file:///' + SCRIPTS + '/utils/documentService.js');
const { SpellService } = await import('file:///' + SCRIPTS + '/utils/spellService.js');

const MB = (b) => (b / 1048576).toFixed(1) + ' MB';
const hash = (o) => createHash('sha1').update(JSON.stringify(o)).digest('hex').slice(0, 12);

/* ── The builder's lists ─────────────────────────────────────────────────── */
requests.length = 0;
await DocumentService.loadAndInitializeDocuments();
const docReq = [...requests];
const lists = Object.fromEntries(Object.entries(AM.documents).map(([t, groups]) =>
  [t, groups.flatMap((g) => g.docs.map((d) => d.uuid)).sort()]));
const heavy = docReq.filter((r) => r.fields?.some((f) => f === 'system' || f.startsWith('system.')));

/* ── The spell tables ────────────────────────────────────────────────────── */
requests.length = 0;
await SpellService.loadSpellcastingFeatures();
const featReq = [...requests];
const tables = Object.fromEntries([...SpellService.featureTables].sort(([a], [b]) => a.localeCompare(b)));

if (DIGEST) {
  console.log(`documents  ${docReq.length} requests, ${heavy.length} carrying system, ${MB(docReq.reduce((n, r) => n + r.bytes, 0))}`);
  console.log(`features   ${featReq.length} requests (${featReq.filter((r) => r.kind === 'documents').length} for documents), ${MB(featReq.reduce((n, r) => n + r.bytes, 0))}`);
  console.log(`lists      ${Object.entries(lists).map(([t, l]) => `${t} ${l.length}`).join(', ')}  #${hash(lists)}`);
  console.log(`tables     ${Object.keys(tables).length}: ${Object.keys(tables).join(', ')}  #${hash(tables)}`);
  process.exit(0);
}

/* What the released code read, recorded from its run (see the header). */
const RELEASED = { lists: '051bb08c42ec', tables: '2ad9c12e862d' };

const docBytes = docReq.reduce((n, r) => n + r.bytes, 0);
check('the builder\u2019s lists ask for no system data', heavy.length === 0,
  `${docReq.length} requests, ${MB(docBytes)}`);
check('and list the same origins as before',
  hash(lists) === RELEASED.lists && lists.class.length > 0 && lists.heritage.length > 0,
  `${Object.entries(lists).map(([t, l]) => `${t} ${l.length}`).join(', ')} #${hash(lists)}`);

const docCalls = featReq.filter((r) => r.kind === 'documents');
const perPack = new Map();
for (const r of docCalls) perPack.set(r.pack, (perPack.get(r.pack) ?? 0) + 1);
check('Spellcasting features: one document request per pack',
  docCalls.length > 0 && [...perPack.values()].every((n) => n === 1),
  [...perPack].map(([p, n]) => `${p} ${n}`).join(', ') + ` — ${docCalls.reduce((n, r) => n + r.n, 0)} features`);
check('and the same tables as before', hash(tables) === RELEASED.tables,
  `${Object.keys(tables).length} classes #${hash(tables)}`);

let bad = 0;
for (const [name, ok, detail] of results) {
  if (!ok) bad++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name.padEnd(56)} ${detail}`);
}
process.exit(bad ? 1 : 0);
