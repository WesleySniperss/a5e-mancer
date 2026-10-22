/* After an a5e update: what moved that this module copies, or leans on.
 *
 * a5e 1.4.9 and 1.4.10 (2026-10) were content releases, and they still broke
 * things nothing reported: pool grants the builder read as "nothing to pick",
 * a class whose grants live only in 1.4's `config` shape, two index fields the
 * browser filters on. None of it threw. This lists, against the installed a5e:
 *
 *   1. index fields - compendiumIndexFix's FIELD_MAPPINGS against a5e's own
 *      (src/utils/db/indexCompendiaFields.ts);
 *   2. pool filters - grantPools' FILTERS against the browser's
 *      (src/view/dialogs/compendium-browser/utils/constructFilters.ts);
 *   3. grant types and selection modes (src/dataModels/item/Grants/) against
 *      the ones the module has been checked with; a pool on a type grantPools
 *      has no filters for stays a5e's window to ask;
 *   4. the count slip in a5e's feature and item grants - getSelectionComponent
 *      Props reading `this.selectionType` - which grantAbsorber works around;
 *   5. the a5e methods the module wraps or calls by name (a5eFixes, the
 *      absorber, the level-up);
 *   6. with --packs: every grant shape in a5e's packs, and the item and actor
 *      types, against the ones known when this was last brought up to date.
 *      A new shape is where new content breaks first.
 *
 * A difference is a place to look, not a verdict - the README's rule.
 *
 *   node tools/checks/a5eupdate.mjs [--packs] [--system <path to systems/a5e>]
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const R = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const at = argv.indexOf('--system');
const SYS = at >= 0 ? argv[at + 1] : path.resolve(R, '..', '..', 'systems', 'a5e');
const WANT_PACKS = argv.includes('--packs');

/* What this file was last brought up to date with. */
const CHECKED_WITH = '1.4.10';

const KNOWN_GRANT_TYPES = new Set([
  'ability', 'attack', 'currency', 'damage', 'exertion', 'expertiseDice', 'feature', 'healing',
  'hitPoint', 'initiative', 'item', 'maneuver', 'movement', 'proficiency', 'rollOverride',
  'senses', 'settings', 'skill', 'skillSpecialty', 'spell', 'trait'
]);

/* type/selectionType in a5e 1.4.10's packs; "-" is a grant still in 1.3's
   shape, which a5e migrates as it loads. */
const KNOWN_SHAPES = new Set([
  'ability/-', 'attack/-', 'currency/-', 'damage/-', 'exertion/-', 'expertiseDice/-',
  'feature/-', 'feature/limited', 'feature/pool', 'healing/-', 'hitPoint/-', 'initiative/-',
  'item/-', 'item/limited', 'maneuver/limited', 'maneuver/pool', 'movement/-', 'proficiency/-',
  'rollOverride/-', 'senses/-', 'settings/-', 'skill/-', 'skillSpecialty/-', 'spell/limited',
  'spell/pool', 'trait/-', '/-'
]);
const KNOWN_ITEM_TYPES = new Set(['archetype', 'background', 'class', 'culture', 'destiny', 'feature',
  'heritage', 'maneuver', 'object', 'spell', 'interaction', 'hacking', 'monsterFeature']);
const KNOWN_ACTOR_TYPES = new Set(['character', 'npc', 'party', 'follower', 'vehicle']);

/* The a5e names the module wraps or calls without a fallback that would say so. */
const PATCH_POINTS = [
  ['prepareData', 'a5eFixes.idempotentPrepare'],
  ['prepareBaseData', 'a5eFixes.idempotentAbilities'],
  ['prepareCreatureDerivedData', 'a5eFixes.idempotentAbilities'],
  ['prepareSkills', 'a5eFixes.skillExpertise'],
  ['getGrantedTraits', 'a5eFixes.grantedTraits'],
  ['conditionChanges', 'a5eFixes.paralyzedAdvantage'],
  ['createLeveledGrants', 'GrantAbsorber.levelUpWithoutDialog'],
  ['getSelectionComponentProps', 'GrantAbsorber#specOf'],
  ['requiresConfig', 'GrantAbsorber#needsConfig'],
  ['getApplyData', 'GrantAbsorber#applyData'],
  ['triggerRest', 'the sheet\'s rest buttons'],
  ['applyDamage', 'the sheet\'s hit point field'],
  ['applyHealing', 'the sheet\'s hit point field']
];

let problems = 0;
const say = (s = '') => console.log(s);
const flag = (s) => { problems++; console.log(`  ! ${s}`); };
const ok = (s) => console.log(`  ok ${s}`);

/* ── a5e's sources, out of its source map ── */
const sysJson = (() => { try { return JSON.parse(fs.readFileSync(path.join(SYS, 'system.json'), 'utf8')); } catch { return null; } })();
if (!sysJson) {
  console.log(`no a5e system at ${SYS}; nothing to check against`);
  process.exit(0);
}
say(`a5e ${sysJson.version} (this check was brought up to date with ${CHECKED_WITH})`);

const sources = new Map();
try {
  const map = JSON.parse(fs.readFileSync(path.join(SYS, 'a5e.js.map'), 'utf8'));
  map.sources.forEach((src, i) => {
    const text = map.sourcesContent?.[i];
    if (text == null) return;
    const clean = src.replace(/^(\.\.\/)+/, '').replace(/[?#].*$/, '');
    if (clean.startsWith('src/')) sources.set(clean, text);
  });
} catch (err) {
  console.log(`a5e.js.map could not be read (${err.message}); only the packs can be checked`);
}
const source = (suffix) => [...sources].find(([p]) => p.endsWith(suffix))?.[1] ?? null;

/* An object literal after `name ... = {`, as a value: these files hold plain data. */
function literal(text, name) {
  const start = text?.search(new RegExp(`\\b${name}\\b[^=]*=\\s*\\{`));
  if (start == null || start < 0) return null;
  const open = text.indexOf('{', start);
  let depth = 0, end = open;
  for (; end < text.length; end++) {
    if (text[end] === '{') depth++;
    else if (text[end] === '}') { depth--; if (!depth) break; }
  }
  try { return Function(`"use strict"; return (${text.slice(open, end + 1)});`)(); }
  catch { return null; }
}
const ours = (file) => fs.readFileSync(path.join(R, file), 'utf8');

/* ── 1. index fields ── */
say('\nindex fields (compendiumIndexFix FIELD_MAPPINGS)');
{
  const theirs = literal(source('utils/db/indexCompendiaFields.ts'), 'FIELD_MAPPINGS');
  const mine = literal(ours('scripts/utils/compendiumIndexFix.js'), 'FIELD_MAPPINGS');
  if (!theirs || !mine) flag('could not read one of the two field lists');
  else {
    let same = true;
    for (const type of new Set([...Object.keys(theirs), ...Object.keys(mine)])) {
      const a = new Set(theirs[type] ?? []), b = new Set(mine[type] ?? []);
      const missing = [...a].filter(f => !b.has(f)), extra = [...b].filter(f => !a.has(f));
      if (!theirs[type]) { flag(`${type}: ours only`); same = false; continue; }
      if (!mine[type]) { flag(`${type}: new in a5e (${[...a].join(', ')})`); same = false; continue; }
      if (missing.length) { flag(`${type}: a5e indexes ${missing.join(', ')} too`); same = false; }
      if (extra.length) { flag(`${type}: ours has ${extra.join(', ')}, a5e does not`); same = false; }
    }
    if (same) ok('the same as a5e\'s');
  }
}

/* ── 2. pool filters ── */
say('\npool filters (grantPools FILTERS)');
{
  const text = source('compendium-browser/utils/constructFilters.ts');
  const typeMap = text ? Object.fromEntries([...(text.match(/const typeMap\s*=\s*\{([^}]*)\}/)?.[1] ?? '')
    .matchAll(/(\w+)\s*:\s*(\w+)/g)].map(m => [m[1], m[2]])) : {};
  const mine = literal(ours('scripts/utils/grantPools.js'), 'FILTERS');
  if (!text || !mine) flag('could not read one of the two filter tables');
  else {
    for (const [grantType, spec] of Object.entries(mine)) {
      const theirs = typeMap[spec.type] ? literal(text, typeMap[spec.type]) : null;
      if (!theirs) { flag(`${grantType}: a5e's browser has no filters for "${spec.type}"`); continue; }
      const diffs = [];
      for (const name of new Set([...Object.keys(theirs), ...Object.keys(spec.filters)])) {
        const a = theirs[name], b = spec.filters[name];
        if (!a) { diffs.push(`${name} is ours only`); continue; }
        if (!b) { diffs.push(`${name} is new in a5e - a pool using it is left to a5e`); continue; }
        if (a.key !== b.key || a.type !== b.type) diffs.push(`${name}: a5e reads ${a.key} as ${a.type}`);
        const subs = new Set([...Object.keys(a.subFilters ?? {}), ...Object.keys(b.subFilters ?? {})]);
        for (const s of subs) {
          const x = a.subFilters?.[s], y = b.subFilters?.[s];
          if (!x || !y || x.key !== y.key || x.type !== y.type) diffs.push(`${name}.${s} differs`);
        }
      }
      if (diffs.length) for (const d of diffs) flag(`${grantType}: ${d}`);
      else ok(`${grantType} (${spec.type})`);
    }
  }
}

/* ── 3. grant types and their selection modes ── */
say('\ngrant types');
{
  const files = [...sources.keys()].filter(p => /dataModels\/item\/Grants\/(\w+)Grant\.ts$/.test(p) && !/BaseGrant/.test(p));
  if (!files.length) flag('no grant sources found');
  const pools = new Set(Object.keys(literal(ours('scripts/utils/grantPools.js'), 'FILTERS') ?? {}));
  for (const file of files) {
    const name = file.match(/(\w+)Grant\.ts$/)[1];
    const type = name[0].toLowerCase() + name.slice(1);
    const text = sources.get(file);
    const modes = text.match(/selectionType:\s*new fields\.StringField\(\{[\s\S]*?choices:\s*\{([^}]*)\}/)?.[1];
    const choices = modes ? [...modes.matchAll(/(\w+)\s*:/g)].map(m => m[1]) : [];
    const known = KNOWN_GRANT_TYPES.has(type);
    if (!known) flag(`${type}: a grant type the module has not been checked with`);
    if (choices.includes('pool') && !pools.has(type)) {
      say(`  -  ${type}: its pools are left to a5e's window (grantPools has no filters for it)`);
    }
    const unknownModes = choices.filter(c => c !== 'limited' && c !== 'pool');
    if (unknownModes.length) flag(`${type}: selection mode(s) ${unknownModes.join(', ')}`);
  }
  const missing = [...KNOWN_GRANT_TYPES].filter(t => !files.some(f => f.endsWith(`/${t[0].toUpperCase()}${t.slice(1)}Grant.ts`)));
  if (missing.length) flag(`gone from a5e: ${missing.join(', ')}`);
  else if (files.length) ok(`${files.length} grant types, none new`);
}

/* ── 4. the count slip ── */
say('\ncount of a limited feature or item grant');
{
  for (const name of ['FeatureGrant', 'ItemGrant']) {
    const text = source(`Grants/${name}.ts`);
    if (!text) { flag(`${name}.ts not found`); continue; }
    if (/this\.selectionType\s*===/.test(text)) ok(`${name} still reads this.selectionType - grantAbsorber's own count stays needed`);
    else say(`  -  ${name} no longer reads this.selectionType: grantAbsorber's count from config.*.total may be retired`);
  }
}

/* ── 5. names the module leans on ── */
say('\na5e methods the module wraps or calls');
{
  const all = [...sources.values()].join('\n');
  let missing = 0;
  for (const [name, user] of PATCH_POINTS) {
    if (!new RegExp(`\\b${name}\\b`).test(all)) { flag(`${name} is gone (used by ${user})`); missing++; }
  }
  if (!missing && sources.size) ok(`all ${PATCH_POINTS.length} still there`);
}

/* ── 6. the packs ── */
if (WANT_PACKS) {
  say('\npacks (a copy, so a running Foundry\'s locks do not matter)');
  let ClassicLevel;
  try { ({ ClassicLevel } = await import('classic-level')); }
  catch { flag('classic-level is not installed beside the module; the packs are not read'); }
  if (ClassicLevel) {
    const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'a5eupdate-'));
    try {
      fs.cpSync(path.join(SYS, 'packs'), copy, { recursive: true, filter: (src) => path.basename(src) !== 'LOCK' });
      const shapes = new Map(), itemTypes = new Map(), actorTypes = new Map();
      const note = (map, key, where) => { if (!map.has(key)) map.set(key, []); map.get(key).push(where); };
      for (const pack of fs.readdirSync(copy)) {
        const dir = path.join(copy, pack);
        if (!fs.statSync(dir).isDirectory()) continue;
        const db = new ClassicLevel(dir, { valueEncoding: 'json' });
        await db.open();
        for await (const [key, doc] of db.iterator()) {
          if (/^!items![^.!]+$/.test(key)) {
            note(itemTypes, doc.type, `${pack}:${doc.name}`);
            for (const g of Object.values(doc.system?.grants ?? {})) {
              note(shapes, `${g?.type || g?.grantType || ''}/${g?.config?.selectionType ?? '-'}`, `${pack}:${doc.name}`);
            }
          } else if (/^!actors![^.!]+$/.test(key)) note(actorTypes, doc.type, `${pack}:${doc.name}`);
        }
        await db.close();
      }
      const report = (label, map, known) => {
        const fresh = [...map].filter(([k]) => !known.has(k));
        if (!fresh.length) { ok(`${label}: ${map.size}, none new`); return; }
        for (const [k, where] of fresh) flag(`${label} "${k}" x${where.length}, e.g. ${where.slice(0, 3).join(' / ')}`);
      };
      report('grant shape', shapes, KNOWN_SHAPES);
      report('item type', itemTypes, KNOWN_ITEM_TYPES);
      report('actor type', actorTypes, KNOWN_ACTOR_TYPES);
      const pools = [...shapes].filter(([k]) => k.endsWith('/pool'));
      if (pools.length) say(`  -  pool grants: ${pools.map(([k, w]) => `${k} x${w.length}`).join(', ')}`);
    } finally {
      fs.rmSync(copy, { recursive: true, force: true });
    }
  }
}

say(`\n${problems ? `${problems} place(s) to look at` : 'nothing to look at'}`);
process.exit(0);
