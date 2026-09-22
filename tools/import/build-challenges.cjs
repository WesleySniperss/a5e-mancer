// Step 3e: a5e.tools exploration challenge pages -> journal entries, with fixed ids.
//   node tools/import/build-challenges.cjs [--dry] [name...]
//
// a5e has no item type for an exploration challenge, and nothing to hang one
// on: it is a page of text with a tier, a challenge rating, an area and the
// regions it is met in. So each becomes a journal entry of one page - what the
// site shows, in the order it shows it - filed under its kind, and the numbers
// are kept in the module's flags as well as written at the top, so a journal
// can still be picked out by tier or rating later.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const P = require('./lib/paths.cjs');
const N = require('./lib/normalize.cjs');
const { fieldsOf } = require('./lib/fields.cjs');
const { emit } = require('./lib/emit.cjs');

const dry = process.argv.includes('--dry');
const only = process.argv.slice(2).filter((a) => !a.startsWith('--')).map((s) => s.toLowerCase());
const want = JSON.parse(fs.readFileSync(path.join(P.CACHE, 'challenges-want.json'), 'utf8'));
const lk = N.lookups();

/* ── ids ─────────────────────────────────────────────────────────── */
const B62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const used = new Map();
function rid(key, prefix = 'amJ') {
  const h = crypto.createHash('sha1').update(key).digest();
  let s = prefix;
  for (let i = 0; s.length < 16; i++) s += B62[h[i % h.length] % 62];
  if (used.has(s) && used.get(s) !== key) throw new Error(`id clash ${s}: ${key} / ${used.get(s)}`);
  used.set(s, key);
  return s;
}

/* ── shared ──────────────────────────────────────────────────────── */
const SOURCES = {
  "Adventurer's Guide": 'adventurersGuide', "Voidrunner's Codex": 'voidrunnersCodex', 'Trials & Treasures': 'trialsAndTreasures',
  'Adventures in ZEITGEIST': 'adventuresInZeitgeist', "Dungeon Delver's Guide": 'dungeonDelversGuide', 'To Save A Kingdom': 'toSaveAKingdom',
  'Monstrous Menagerie': 'monstrousMenagerie'
};
const sourceOf = (s) => {
  const t = String(s ?? '').trim();
  if (SOURCES[t]) return SOURCES[t];
  const gpg = /Gate Pass Gazette(?: Issue)? #?(\d+)/i.exec(t);
  if (gpg) return Number(gpg[1]) <= 21 ? `gpg${gpg[1]}` : 'a5eMancerGPG';
  return /gate pass/i.test(t) ? 'a5eMancerGPG' : t ? 'a5eMancerOther' : '';
};
const FOLDER = { Traps: 'Traps', Terrain: 'Terrain', Supernatural: 'Supernatural', Weather: 'Weather', Circumstance: 'Circumstance',
  Creatures: 'Creatures', Technological: 'Technological', Urban: 'Urban', Constructed: 'Constructed' };

/** The page writes its bold and italics as styled spans; make them markup the cleaner keeps. */
function emphasis(html) {
  const stack = [], pairs = [];
  for (const m of html.matchAll(/<span\b[^>]*>|<\/span>/g)) {
    if (m[0] === '</span>') { const open = stack.pop(); if (open) pairs.push({ open, close: m }); }
    else stack.push(m);
  }
  const ins = [];
  for (const { open, close } of pairs) {
    const before = [], after = [];
    if (/font-weight:\s*(?:700|800|900|bold)/i.test(open[0])) { before.push('<strong>'); after.unshift('</strong>'); }
    if (/font-style:\s*italic/i.test(open[0])) { before.push('<em>'); after.unshift('</em>'); }
    if (!before.length) continue;
    ins.push([open.index + open[0].length, before.join('')], [close.index, after.join('')]);
  }
  // from the back, so the offsets ahead of each insertion still hold
  for (const [at, text] of ins.sort((a, b) => b[0] - a[0])) html = html.slice(0, at) + text + html.slice(at);
  return html;
}

/** A challenge rating is written "8" or "1/2". */
const number = (s) => {
  const frac = /^\s*(\d+)\s*\/\s*(\d+)\s*$/.exec(String(s ?? ''));
  return frac ? Number(frac[1]) / Number(frac[2]) : Number(s) || 0;
};

const seenStub = () => ({ traditions: new Set(), spells: new Set(), maneuvers: new Set(), unmatchedSpells: new Set() });
const label = /<div class="field--label[^"]*">[\s\S]*?<\/div>/;
/** The spans the emphasis came from leave their spaces inside it; put them back outside. */
const tidy = (html) => html
  .replace(/((?:<(?:strong|em)>)+)\s+/g, ' $1').replace(/\s+((?:<\/(?:strong|em)>)+)/g, '$1 ')
  // some pages close the emphasis against the next sentence: "<em>Critical Failure.</em>A humanoid"
  .replace(/((?:<\/(?:strong|em)>)+)(?=[A-Z(])/g, '$1 ')
  .replace(/\s{2,}/g, ' ')
  .replace(/<p>\s+/g, '<p>').replace(/\s+<\/p>/g, '</p>')
  .trim();
const section = (field) => (field ? tidy(N.clean(emphasis(field.html.replace(label, '')), lk, seenStub())) : '');

/* ── one challenge ───────────────────────────────────────────────── */
function challengeDoc(row) {
  const slug = row.url.split('/').pop();
  const id = rid(`challenge|${slug}|${row.name}`);
  const file = path.join(P.CACHE, 'pages', 'challenges', row.url.replace(/^\//, '').replace(/\//g, '_') + '.html');
  const html = fs.readFileSync(file, 'utf8');
  const article = html.slice(html.indexOf('<article'), html.indexOf('</article>'));
  const F = fieldsOf(article);
  const notes = [];
  const field = (n) => String(F[`explorechall-${n}`]?.text ?? row[`explorechall-${n}`] ?? '').trim();

  const kind = field('type');
  const tier = field('tier');
  const cr = field('cr');
  const area = field('area');
  const regions = F['explorechall-region']?.items?.length
    ? F['explorechall-region'].items
    : String(row['explorechall-region'] ?? '').split(/\s*,\s*/).filter(Boolean);
  const source = sourceOf(F['explorechall-source']?.text ?? row['explorechall-source']);

  const description = section(F['explorechall-description']);
  const solutions = section(F['explorechall-possiblesolut']);
  if (!description) notes.push('no description read');
  if (!kind) notes.push('no kind, so it is filed under Other');

  const head = [kind, tier !== '' ? `Tier ${tier}` : '', cr !== '' ? `CR ${cr}` : '', area].filter(Boolean).join(' &middot; ');
  const content = `<p><strong>${head}</strong></p>`
    + (regions.length ? `<p><em>${regions.join(', ')}</em></p>` : '')
    + (description ? `<h2>Description</h2>${description}` : '')
    + (solutions ? `<h2>Possible Solutions</h2>${solutions}` : '');

  const entry = {
    _id: id, name: row.name, folder: null, sort: 0,
    pages: [{
      _id: rid(`${id}|page`), name: row.name, type: 'text', sort: 100000,
      title: { show: false, level: 1 },
      text: { format: 1, content },
      system: {}, image: {}, video: { controls: true, volume: 0.5 }, src: null,
      flags: {}, ownership: { default: -1 }
    }],
    categories: [],
    flags: { 'a5e-mancer': {
      imported: `challenges/${slug}`, url: `https://a5e.tools${row.url}`, folder: FOLDER[kind] ?? 'Other',
      challenge: { kind, tier: Number(tier) || 0, cr: number(cr), area, regions, source }
    } },
    ownership: { default: 0 }
  };
  return { entry, notes };
}

/* ── run ─────────────────────────────────────────────────────────── */
const all = [];
const report = [];
let withNotes = 0;
for (const row of want) {
  if (only.length && !only.includes(row.name.toLowerCase())) continue;
  const { entry, notes } = challengeDoc(row);
  all.push(entry);
  const c = entry.flags['a5e-mancer'].challenge;
  const text = entry.pages[0].text.content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  report.push(`  ${entry.name} [${c.source}] ${c.kind || '?'} tier ${c.tier} CR ${c.cr} ${c.area}`
    + ` · ${c.regions.length} regions · ${text.length} characters`);
  if (notes.length) { report.push('      ! ' + notes.join('; ')); withNotes++; }
}
fs.writeFileSync(path.join(P.CACHE, 'challenges-report.txt'), report.join('\n'));
console.log(`${all.length} exploration challenges, ${withNotes} with notes - report in .cache/challenges-report.txt`);
if (dry || only.length) process.exit(0);
const r = emit('a5etools-challenges', all);
console.log(`${path.relative(P.MODULE, r.file)}: ${(r.bytes / 1024).toFixed(0)} KB; generated.js lists ${r.total} documents`);
