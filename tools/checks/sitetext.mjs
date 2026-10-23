/* Descriptions completed from a5e.tools (utils/siteText.js, data/siteText.js)
 * against a5e's real pack texts and the imported ones: every link lands, every
 * block finds its place, running it twice changes nothing, and what comes out
 * is still well-formed HTML.
 *
 * Probes: Conjure Fey's hag, hound and redcap link a5e's "Conjured Fey (...)"
 * stat blocks; Animate Dead links the skeleton twice and the zombie once;
 * Control Weather gets its three tables after the paragraph they belong to;
 * Artisan gets its connections and mementos; a Bag of Tricks variant gets the
 * table of bags; "rat" is not linked inside "giant rat"; Wild Shape gets its
 * table from the druid's page and Pact Boon links the imp; no word the site
 * links by itself ("cursed" to the Cursed background) comes through.
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
const core = await import(pathToFileURL(path.join(R, 'scripts', 'utils', 'siteTextCore.js')).href);
const { SITE_TEXT } = await import(pathToFileURL(path.join(R, 'scripts', 'data', 'siteText.js')).href);
const { applyEntry, insertBlocks, linkText, occurrences, blocksOf, anchorOf } = core;

const read = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const docs = new Map();
for (const p of ['spells', 'adventuringGear', 'maneuvers', 'feats', 'backgrounds', 'destinies', 'classes', 'archetypes', 'classFeatures', 'heritages', 'heritageFeatures', 'cultures', 'cultureFeatures']) for (const d of read(path.join(PACKS, `${p}.json`))) docs.set(d._id, d);
for (const f of fs.readdirSync(path.join(R, 'scripts', 'data', 'imported')).filter(f => /^a5etools-.*\.json$/.test(f))) for (const d of read(path.join(R, 'scripts', 'data', 'imported', f))) if (!docs.has(d._id)) docs.set(d._id, d);
const monsters = read(path.join(PACKS, 'monsterIndex.json'));
const descOf = (d) => typeof d.system?.description === 'string' ? d.system.description : (d.system?.description?.value ?? '');

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.log('  FAIL', msg); } };

/** Tags left open or closed twice. */
function balanced(html) {
  const stack = [];
  for (const m of html.matchAll(/<(\/?)([a-z][a-z0-9]*)\b[^>]*?(\/?)>/gi)) {
    const [, close, tag, self] = m; const t = tag.toLowerCase();
    if (self || ['br', 'hr', 'img', 'input', 'col'].includes(t)) continue;
    if (!close) stack.push(t);
    else if (stack.at(-1) === t) stack.pop();
    else return false;
  }
  return stack.length === 0;
}

// ---- every entry, on its own document's text
let entries = 0, links = 0, linked = 0, adds = 0, placed = 0, missingDocs = 0;
const strays = [];
for (const [id, e] of Object.entries(SITE_TEXT.entries)) {
  const doc = docs.get(id);
  if (!doc) { missingDocs++; continue; }
  entries++;
  const html = descOf(doc);
  const out = applyEntry(html, e, SITE_TEXT.targets);
  ok(applyEntry(out, e, SITE_TEXT.targets) === out, `${doc.name}: a second pass changes the text`);
  ok(balanced(out) || !balanced(html), `${doc.name}: tags no longer balanced`);
  // blocks: each where its anchor is
  const blocks = blocksOf(html).map(anchorOf);
  for (const [anchor] of e.add ?? []) {
    adds++;
    if (anchor === '^' || blocks.some(a => a && a.startsWith(anchor))) placed++;
    else strays.push(`${doc.name}: no block "${anchor.slice(0, 40)}"`);
  }
  // links: each one in
  const filled = insertBlocks(html, e.add);
  for (const [words, t, occ] of e.links ?? []) {
    links++;
    const spot = occurrences(filled, words)[occ];
    if (spot?.linkable) linked++;
    else strays.push(`${doc.name}: "${words}" #${occ} has no free place`);
  }
  const markup = (out.match(/@UUID\[|\[\[\/condition /g) || []).length - (html.match(/@UUID\[|\[\[\/condition /g) || []).length;
  ok(markup >= (e.links ?? []).length, `${doc.name}: ${(e.links ?? []).length} links, ${markup} put in`);
}
ok(missingDocs === 0, `${missingDocs} entries name a document neither a5e's packs nor the imported ones hold`);
ok(linked === links, `${links - linked} of ${links} links found no place`);
ok(placed === adds, `${adds - placed} of ${adds} blocks found no anchor`);
for (const s of strays.slice(0, 10)) console.log('   ', s);

// ---- probes
const byName = (type, name) => {
  const ids = SITE_TEXT.names[`${type}|${name.toLowerCase()}`] ?? [];
  return ids.map(id => ({ id, doc: docs.get(id), e: SITE_TEXT.entries[id] }))[0];
};
const nameOfTarget = (t) => { const id = t.split('.').pop(); return monsters.find(m => m._id === id)?.name ?? docs.get(id)?.name ?? t; };
const linksOf = (html) => [...html.matchAll(/@UUID\[([^\]]+)\]\{([^}]*)\}/g)].map(m => [m[2], nameOfTarget(m[1])]);

{
  const { doc, e } = byName('spell', 'Conjure Fey');
  const out = applyEntry(descOf(doc), e, SITE_TEXT.targets);
  const l = Object.fromEntries(linksOf(out));
  ok(l.hag === 'Conjured Fey (Hag)' && l.hound === 'Conjured Fey (Hound)' && l.redcap === 'Conjured Fey (Redcap)', `Conjure Fey links ${JSON.stringify(l)}`);
}
{
  const { doc, e } = byName('spell', 'Animate Dead');
  const l = linksOf(applyEntry(descOf(doc), e, SITE_TEXT.targets));
  ok(l.filter(([w, n]) => w === 'skeleton' && n === 'Skeleton').length === 2 && l.filter(([w, n]) => w === 'zombie' && n === 'Zombie').length === 1, `Animate Dead links ${JSON.stringify(l)}`);
}
{
  const { doc, e } = byName('spell', 'Control Weather');
  const out = applyEntry(descOf(doc), e, SITE_TEXT.targets);
  ok((out.match(/<table/g) || []).length === 3, `Control Weather has ${(out.match(/<table/g) || []).length} tables`);
  ok(out.indexOf('<table') > out.toLowerCase().indexOf('precipitation') - 400, 'Control Weather: the tables come after the text about them');
}
{
  const { doc, e } = byName('background', 'Artisan');
  const out = applyEntry(descOf(doc), e, SITE_TEXT.targets);
  ok(/ARTISAN CONNECTIONS/.test(out) && /ARTISAN MEMENTOS/.test(out) && (out.match(/<li>/g) || []).length >= 20, 'Artisan gets its connections and mementos');
}
{
  const { doc, e } = byName('object', 'Bag of Tricks (Gray)');
  const out = applyEntry(descOf(doc), e, SITE_TEXT.targets);
  ok(/<table/.test(out) && /Rust bag of tricks/i.test(out), 'Bag of Tricks (Gray) gets the table of every bag');
  ok(!/giant @UUID\[[^\]]+\]\{rat\}/i.test(out), '"rat" is not linked inside "giant rat"');
}
{
  // a copy whose text a player changed: blocks go to the end, nothing is lost or doubled
  const { doc, e } = byName('spell', 'Control Weather');
  const edited = '<p>My own notes.</p>' + descOf(doc).replace(/<p>/, '<p>Edited: ');
  const out = applyEntry(edited, e, SITE_TEXT.targets);
  ok(out.includes('My own notes.') && (out.match(/<table/g) || []).length === 3, 'an edited copy keeps its text and gets the tables once');
}
{
  /* a5e adds the tables itself, a word of its own at the start of each: they
     are a5e's, and ours step aside - found by the first words alone, all three
     came twice. */
  const { doc, e } = byName('spell', 'Control Weather');
  const own = insertBlocks(descOf(doc), e.add.map(([a, b]) => [a, b.replace(/>([^<]*?)([A-Za-z]{3,})/, '>$1Changed')]));
  const out = applyEntry(own, e, SITE_TEXT.targets);
  ok((own.match(/<table/g) || []).length === 3 && (out.match(/<table/g) || []).length === 3, `tables a5e words its own way are not added again (${(out.match(/<table/g) || []).length})`);
}
{
  // linkText leaves existing links and enrichers alone
  const html = '<p>A @UUID[Compendium.a5e.a5e-monsters.Actor.x]{skeleton} and a skeleton, [[/condition id=prone label="prone"]] then prone.</p>';
  const out = linkText(html, [['skeleton', 0, 0], ['skeleton', 0, 1], ['prone', 1, 0], ['prone', 1, 1]], ['Compendium.a5e.a5e-monsters.Actor.y', 'condition:prone']);
  ok((out.match(/@UUID/g) || []).length === 2 && out.includes('{skeleton} and a @UUID[Compendium.a5e.a5e-monsters.Actor.y]{skeleton}'), `linkText: existing link kept, the free one linked (${out})`);
  ok((out.match(/\[\[\/condition/g) || []).length === 2, 'linkText: the condition enricher is not linked inside');
}

{
  // a class feature, from its section of the class page
  const ids = SITE_TEXT.names['feature|wild shape'] ?? [];
  const outs = ids.map(id => applyEntry(descOf(docs.get(id)), SITE_TEXT.entries[id], SITE_TEXT.targets));
  ok(outs.some(o => /<table/.test(o) && /Ape/.test(o)), 'Wild Shape gets its table of shapes');
  const pact = (SITE_TEXT.names['feature|pact boon'] ?? []).map(id => linksOf(applyEntry(descOf(docs.get(id)), SITE_TEXT.entries[id], SITE_TEXT.targets))).flat();
  ok(pact.some(([w, n]) => /imp/i.test(w) && n === 'Imp'), `Pact Boon links the imp's stat block (${JSON.stringify(pact.slice(0, 4))})`);
  // what the site links by itself ("freelinking"): no curse to the Cursed background, no dim light to the Light destiny
  const all = Object.values(SITE_TEXT.entries).flatMap(e => (e.links ?? []).map(([w, t]) => [w, SITE_TEXT.targets[t]]));
  ok(!all.some(([w, t]) => /^[a-z]/.test(w) && /a5e-(backgrounds|destinies)\./.test(t)), 'no lower-case word links a background or destiny');
}

// ---- a5e's own links that lead nowhere (SiteText.relink)
{
  const everyId = new Set([...docs.keys(), ...monsters.map(m => m._id)]);
  for (const p of ['classFeatures', 'heritageFeatures', 'destinyFeatures', 'interactions', 'dnd5e-spells']) {
    const f = path.join(PACKS, `${p}.json`);
    if (fs.existsSync(f)) for (const d of read(f)) everyId.add(d._id);
  }
  const relink = Object.entries(SITE_TEXT.relink ?? {});
  ok(relink.length > 20, `${relink.length} broken a5e links mapped`);
  const lost = relink.filter(([, to]) => to && !everyId.has(to.split('.').pop()));
  ok(!lost.length, `relinked to documents that do not exist: ${lost.map(x => x[1]).join(', ')}`);

  globalThis.game = { packs: new Map(), settings: { get: () => true, storage: new Map() }, i18n: { localize: (k) => k } };
  globalThis.foundry = { utils: {} };
  const { SiteText } = await import(pathToFileURL(path.join(R, 'scripts', 'utils', 'siteText.js')).href);
  const feat = read(path.join(PACKS, 'feats.json')).find(d => d.name === 'Infused Tracker');
  const fixed = SiteText.relink(descOf(feat));
  ok(!/a5e-bloody-heretics/.test(fixed) && (fixed.match(/@UUID\[Compendium\.a5e\.a5e-class-features/g) || []).length >= 3, 'Infused Tracker: Bloody Heretics links go to a5e\'s class features');
  game.packs.set('a5e-bloody-heretics.bloody-heretics', {});
  ok(SiteText.relink(descOf(feat)) === descOf(feat), 'with Bloody Heretics installed its links are left alone');
  game.packs.delete('a5e-bloody-heretics.bloody-heretics');
  const none = relink.find(([, to]) => !to)?.[0];
  if (none) ok(SiteText.relink(`<p>x @UUID[${none}]{Words} y</p>`) === '<p>x Words y</p>', 'a link with nowhere to go becomes its words');
  ok(SiteText.relink('<p>@UUID[Compendium.a5e.a5e-spells.Item.ayutqhkyombboux8]{fine}</p>').includes('@UUID['), 'a working link is untouched');
  // a dead a5e link a5e has since mended - its document found again - is a5e's own
  const mended = relink.find(([from, to]) => from.startsWith('Compendium.a5e.') && to)?.[0];
  if (mended) {
    globalThis.fromUuidSync = (uuid) => (uuid === mended ? { name: 'mended' } : null);
    ok(SiteText.relink(`<p>@UUID[${mended}]{Words}</p>`) === `<p>@UUID[${mended}]{Words}</p>`, 'a dead link a5e has mended is left as a5e wrote it');
    delete globalThis.fromUuidSync;
    ok(SiteText.relink(`<p>@UUID[${mended}]{Words}</p>`) !== `<p>@UUID[${mended}]{Words}</p>`, '...and still sent on while it is dead');
  }
}

console.log(`site text: ${entries} entries, ${links} links, ${adds} blocks; ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
