// What a5e's packs say against what a5e.tools says, for every entry both have: spells, magic
// items, mundane equipment, weapons, combat maneuvers, feats, backgrounds, destinies.
//
//   node tools/import/prepare.cjs              (a5e's packs as JSON)
//   node tools/import/fetch-descriptions.cjs   (the site's texts and what they link to)
//   node tools/import/compare-descriptions.cjs [list ...]
//
// For each pair it reports
// - the sentences of the site's text that the pack's text does not have (or has reworded);
// - tables and lists the site has and the pack does not;
// - links: what the site links (stat blocks, spells, items, maneuvers, rules) and whether the
//   pack links the same words.
// The report goes to .cache/descriptions/compare.json; a summary is printed.
const fs = require('fs'), path = require('path');
const P = require('./lib/paths.cjs');
const { variants, flat } = require('./lib/match.cjs');

const DESC = path.join(P.CACHE, 'descriptions');
const SIDES = {
  spells: ['spells'],
  'magic-items': ['adventuringGear'],
  'mundane-equipment': ['adventuringGear'],
  weapons: ['adventuringGear'],
  'combat-maneuvers': ['maneuvers'],
  feats: ['feats'],
  backgrounds: ['backgrounds'],
  destinies: ['destinies'],
};
const LISTS = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(SIDES);

const decode = (s) => String(s ?? '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
  .replace(/&#0?39;|&rsquo;|&lsquo;/g, "'").replace(/&ldquo;|&rdquo;/g, '"').replace(/&mdash;/g, '—').replace(/&ndash;/g, '–')
  .replace(/&times;/g, '×').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#(\d+);/g, (m, n) => String.fromCharCode(+n));
/** The words of a text, as the reader sees them: links and markup reduced to their words. */
const plain = (html) => decode(String(html ?? '')
  .replace(/@UUID\[[^\]]*\]\{([^}]*)\}/g, '$1').replace(/@UUID\[([^\]]*)\]/g, '')
  .replace(/\[\[\/\w+[^\]]*?label="([^"]*)"[^\]]*\]\]/g, '$1').replace(/\[\[\/condition id=(\w+)[^\]]*\]\]/g, '$1')
  .replace(/\[\[\/r(?:oll)? ([^\]]*)\]\]/g, '$1').replace(/<[^>]+>/g, ' '))
  .replace(/[’‘`]/g, "'").replace(/[“”]/g, '"').replace(/[​‌‍﻿]/g, '').replace(/\s+/g, ' ').trim();
/** For comparing: lower case, letters and digits only. */
const norm = (s) => plain(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const sentences = (html) => plain(html).split(/(?<=[.!?:])\s+(?=[A-Z0-9"(])/).map(s => s.trim()).filter(s => s.split(' ').length >= 5);
const shingles = (s, n = 3) => { const w = norm(s).split(' '); const out = []; for (let i = 0; i + n <= w.length; i++) out.push(w.slice(i, i + n).join(' ')); return out; };

const pack = (name) => JSON.parse(fs.readFileSync(path.join(P.PACKS, `${name}.json`), 'utf8'));
const descOf = (d) => typeof d.system?.description === 'string' ? d.system.description : (d.system?.description?.value ?? '');

/* The site's text of an entry: its own text, and for backgrounds and destinies every field (the
   feature, connections, mementos, motivations), which a5e spreads over the item and its features. */
const ALL_FIELDS = new Set(['backgrounds', 'destinies']);
const SKIP_FIELDS = /source|cost|weight|damage|range|ability-score|spell-target|component|saving-throw|rare-versions/;
function siteTextOf(list, r) {
  if (!ALL_FIELDS.has(list)) return r.body + (r.higher ? `<p>Cast at Higher Levels. ${r.higher}</p>` : '');
  return r.fields.filter(([name]) => !SKIP_FIELDS.test(name)).map(([, label, html]) => `<p>${label ? label + ' ' : ''}${html}</p>`).join('');
}
/* The pack's text: the item's, and the features its grants give (a background's feature, a
   destiny's inspiration and fulfillment features). */
const FEATURES = { backgrounds: 'backgroundFeatures', destinies: 'destinyFeatures' };
const featureDocs = {};
function packTextOf(list, doc) {
  let html = descOf(doc);
  if (!FEATURES[list]) return html;
  const byId = (featureDocs[list] ??= new Map(pack(FEATURES[list]).map(d => [d._id, d])));
  for (const id of JSON.stringify(doc.system?.grants ?? {}).match(/[A-Za-z0-9]{16}(?=")/g) ?? []) {
    const f = byId.get(id);
    if (f) html += descOf(f);
  }
  return html;
}

// what the site's links point at
const nodes = JSON.parse(fs.readFileSync(path.join(DESC, 'nodes.json'), 'utf8'));
const spellByUrl = new Map(JSON.parse(fs.readFileSync(path.join(DESC, 'spells.json'), 'utf8')).map(r => [r.url, r.name]));
function target(href) {
  const h = href.replace(/[?#].*$/, '');
  if (h.startsWith('/spell/')) return { kind: 'spell', name: spellByUrl.get(h) ?? h.slice(7).replace(/-/g, ' ') };
  if (h.startsWith('/rules/')) return { kind: 'rules', name: h.slice(7).replace(/-/g, ' ') };
  const n = nodes[h];
  if (n) return { kind: n.type === 'srd-page' ? 'rules' : n.type, name: n.title, canonical: n.canonical };
  return { kind: 'unknown', name: h };
}

/** Does the pack's text link these words: an @UUID, an <a>, or one of a5e's enrichers? */
function linked(html, words) {
  const w = norm(words);
  for (const m of String(html).matchAll(/@UUID\[[^\]]*\]\{([^}]*)\}|<a\b[^>]*>([\s\S]*?)<\/a>|\[\[\/condition id=(\w+)[^\]]*\]\]/g)) {
    if (norm(m[1] ?? m[2] ?? m[3] ?? '') === w) return true;
  }
  return false;
}

const report = {};
for (const list of LISTS) {
  const site = JSON.parse(fs.readFileSync(path.join(DESC, `${list}.json`), 'utf8'));
  const docs = SIDES[list].flatMap(pack);
  const byName = new Map();
  for (const d of docs) for (const v of variants(d.name)) { if (!byName.has(v)) byName.set(v, []); byName.get(v).push(d); }
  const exact = new Map();
  for (const d of docs) { const k = flat(d.name); if (!exact.has(k)) exact.set(k, d); }

  const rows = [];
  let paired = 0;
  for (const r of site) {
    const doc = exact.get(flat(r.name)) ?? [...variants(r.name)].map(v => byName.get(v)?.[0]).find(Boolean);
    if (!doc) { rows.push({ name: r.name, url: r.url, missing: true }); continue; }
    paired++;
    const theirs = packTextOf(list, doc);
    const mine = norm(theirs);
    const mineShingles = new Set(shingles(theirs));
    const siteText = siteTextOf(list, r);
    const lost = [], reworded = [];
    for (const s of sentences(siteText)) {
      const n = norm(s);
      if (!n || mine.includes(n)) continue;
      const sh = shingles(s);
      const hit = sh.filter(x => mineShingles.has(x)).length / Math.max(1, sh.length);
      (hit >= 0.6 ? reworded : lost).push(s);
    }
    const count = (html, re) => (String(html).match(re) || []).length;
    const tables = [count(siteText, /<table\b/g), count(theirs, /<table\b/g)];
    const lists = [count(siteText, /<li\b/g), count(theirs, /<li\b/g)];
    const links = r.links.map(l => ({ text: l.text, ...target(l.href), inPack: linked(theirs, l.text) }));
    rows.push({ name: r.name, url: r.url, doc: doc.name, id: doc._id, lost, reworded, tables, lists, links,
      siteWords: norm(siteText).split(' ').length, packWords: mine.split(' ').length });
  }
  report[list] = rows;

  const withLost = rows.filter(r => r.lost?.length);
  const linkKinds = {};
  for (const r of rows) for (const l of r.links ?? []) {
    const k = (linkKinds[l.kind] ??= { site: 0, pack: 0, entries: new Set() });
    k.site++; if (l.inPack) k.pack++; else k.entries.add(r.name);
  }
  console.log(`\n== ${list}: ${site.length} on the site, ${paired} paired, ${rows.filter(r => r.missing).length} not in a5e's packs`);
  console.log(`   sentences missing in ${withLost.length} entries (${withLost.reduce((n, r) => n + r.lost.length, 0)} sentences), reworded in ${rows.filter(r => r.reworded?.length).length}`);
  console.log(`   tables missing in ${rows.filter(r => r.tables && r.tables[0] > r.tables[1]).length}, list items missing in ${rows.filter(r => r.lists && r.lists[0] > r.lists[1]).length}`);
  for (const [k, v] of Object.entries(linkKinds)) console.log(`   links to ${k}: ${v.site} on the site, ${v.pack} linked in the pack; unlinked in ${v.entries.size} entries`);
}
fs.writeFileSync(path.join(DESC, 'compare.json'), JSON.stringify(report, null, 1));
