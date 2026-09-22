// Step 3: a5e.tools archetype pages -> a5e item documents (the archetype and its
// features, with fixed ids) for the module's Imported compendium.
//   node tools/import/build-archetypes.cjs [--dry] [name...]
//
// Writes scripts/data/imported/a5etools-archetypes.json and generated.js (the
// manifest the module loads, over every converted file), and .cache/build-report.txt: every archetype's
// levels, features, choices, uses, actions and grants, to read before shipping.
// With names, or --dry, it only writes the report.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const P = require('./lib/paths.cjs');
const N = require('./lib/normalize.cjs');
const { segment } = require('./lib/segment.cjs');
const { detectGrants, sentences } = require('./lib/grants.cjs');
const { detectUses, detectAction } = require('./lib/actions.cjs');
const OVERRIDES = require('./archetype-overrides.cjs');

const PK = P.PACKS;
const FOUNDRY = P.PUBLIC;
const args = process.argv.slice(2);
const dry = args.includes('--dry');
const only = args.filter((a) => !a.startsWith('--')).map((s) => s.toLowerCase());

const want = JSON.parse(fs.readFileSync(P.WANT, 'utf8'));
const classinfo = JSON.parse(fs.readFileSync(P.CLASSINFO, 'utf8'));
const lk = N.lookups();

/* ── ids ─────────────────────────────────────────────────────────── */
const B62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const usedIds = new Map();
function rid(key, prefix = 'amI') {
  const h = crypto.createHash('sha1').update(key).digest();
  let s = prefix;
  for (let i = 0; s.length < 16; i++) s += B62[h[i % h.length] % 62];
  if (usedIds.has(s) && usedIds.get(s) !== key) throw new Error(`id clash ${s}: ${key} / ${usedIds.get(s)}`);
  usedIds.set(s, key);
  return s;
}

/* ── icons: borrowed from a5e's own features with the most similar names ── */
const STOP = new Set('with from your that this into over under their them than then when what have been of the and for you a an to in on at by or as is it its be'.split(' '));
const iconIndex = new Map();
const iconFreq = new Map();
{
  const docs = [...JSON.parse(fs.readFileSync(path.join(PK, 'classFeatures.json'), 'utf8')),
                ...JSON.parse(fs.readFileSync(path.join(PK, 'archetypes.json'), 'utf8'))];
  for (const d of docs) {
    if (!/^icons\//.test(d.img || '') || /icons\/svg\//.test(d.img) || !fs.existsSync(FOUNDRY + d.img)) continue;
    for (const w of new Set(N.norm(d.name).replace(/'/g, '').split(' ').filter((w) => w.length > 2 && !STOP.has(w)))) {
      if (!iconIndex.has(w)) iconIndex.set(w, new Map());
      const m = iconIndex.get(w); m.set(d.img, (m.get(d.img) || 0) + 1);
      iconFreq.set(w, (iconFreq.get(w) || 0) + 1);
    }
  }
}
const CLASS_ICON = {
  adept: 'icons/skills/melee/unarmed-punch-fist.webp', artificer: 'icons/tools/smithing/hammer-sledge-steel-grey.webp',
  bard: 'icons/tools/instruments/lute-gold-brown.webp', berserker: 'icons/skills/melee/weapons-crossed-swords-yellow.webp',
  cleric: 'icons/magic/holy/prayer-hands-glowing-yellow.webp', druid: 'icons/magic/nature/leaf-glow-teal.webp',
  fighter: 'icons/skills/melee/sword-shield-stylized-white.webp', herald: 'icons/magic/holy/barrier-shield-winged-cross.webp',
  marshal: 'icons/skills/social/intimidation-impressing.webp', psion: 'icons/magic/perception/eye-ringed-glow-angry-small-teal.webp',
  psyknight: 'icons/magic/perception/third-eye-blue-red.webp', ranger: 'icons/weapons/bows/longbow-leather-green.webp',
  rogue: 'icons/skills/melee/strike-dagger-white-orange.webp', savant: 'icons/sundries/books/book-open-purple.webp',
  sorcerer: 'icons/magic/fire/orb-vortex.webp', warlock: 'icons/magic/unholy/orb-glowing-purple.webp',
  wizard: 'icons/sundries/books/book-worn-brown-grey.webp'
};
function iconFor(name, cls, taken) {
  const words = N.norm(name).replace(/'/g, '').split(' ').filter((w) => w.length > 2 && !STOP.has(w));
  const score = new Map();
  for (const w of words) {
    const m = iconIndex.get(w) ?? iconIndex.get(w.replace(/s$/, '')) ?? iconIndex.get(w.replace(/(ing|ed)$/, ''));
    if (!m) continue;
    const weight = 1 / Math.log(2 + (iconFreq.get(w) || 1));
    for (const [img, n] of m) score.set(img, (score.get(img) || 0) + weight * (1 + Math.log(n)) - (taken?.has(img) ? 0.4 : 0));
  }
  const best = [...score.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0];
  const icon = best ?? CLASS_ICON[cls] ?? 'icons/sundries/documents/document-sealed-signatures-red.webp';
  return fs.existsSync(FOUNDRY + icon) ? icon : 'icons/sundries/documents/document-sealed-signatures-red.webp';
}

/* ── html ─────────────────────────────────────────────────────────── */
const ORD = (n) => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;
const ROW = /^\s*(?:<[^>]+>\s*)*(\d{1,2})\s*(?:s\s*t|n\s*d|r\s*d|t\s*h)\b[\s:–—-]*(.*)$/i;
/** Paragraph runs of "3rd  spell, spell" become a table a5e and ProseSpells read. */
function tablify(units, levelHead) {
  const out = [];
  for (let i = 0; i < units.length; i++) {
    const run = [];
    let j = i;
    while (j < units.length && units[j].tag === 'p') {
      const inner = units[j].html.replace(/^<p>|<\/p>$/g, '');
      const m = ROW.exec(inner);
      if (!m || !/@UUID\[Compendium\.a5e\.a5e-spells|<em>/.test(m[2])) break;
      run.push([Number(m[1]), m[2].replace(/^\s*(?:<\/?\w+>\s*)*[\s:–—-]*/, (x) => x.replace(/[\s:–—-]/g, '')).trim()]);
      j++;
    }
    if (run.length >= 2) {
      out.push({ tag: 'table', html: `<table border="1"><thead><tr><td><strong>${levelHead}</strong></td><td><strong>Spells</strong></td></tr></thead><tbody>`
        + run.map(([lv, cell]) => `<tr><td>${ORD(lv)}</td><td>${cell.replace(/^<\/em>|<em>$/g, '')}</td></tr>`).join('') + '</tbody></table>', text: '' });
      i = j - 1;
    } else out.push(units[i]);
  }
  return out;
}
const tidy = (html) => html
  .replace(/<table>/g, '<table border="1">')
  .replace(/<h[1-6]>/g, '<h3>').replace(/<\/h[1-6]>/g, '</h3>')
  .replace(/<p>\s*<\/p>/g, '');
const render = (units) => tidy(units.map((u) => u.html).join(''));
const blocksOf = (units) => units.flatMap((u) => /^(ul|ol)$/.test(u.tag) ? [...u.html.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => N.text(m[1])) : u.tag === 'table' ? [] : [u.text]);

const CHOICE_END = /\b(?:choose|select|pick)\b[^.]*\b(?:one|two|three|a single)?\b[^.]*\bfollowing\b[^.]*[:.]?\s*$|\bchoose one of the following\b|\byour choice of one of the following\b/i;
const PER_USE = /\bwhenever\b|\bwhen you (?:create|replace|craft|use|cast|spend)|\beach time\b|\bas an action\b|\bbonus action\b|\byou can now\b|\byou may now\b|\bare added to\b|\badded to your list\b|\bfor a number of rounds\b/i;
function isChoice(f) {
  if (f.subs.length < 2) return false;
  const last = f.units.filter((u) => u.tag === 'p').pop()?.text ?? '';
  const sents = sentences(last);
  const tail = sents[sents.length - 1] ?? '';
  return CHOICE_END.test(tail) && !PER_USE.test(tail);
}
const countOf = (f) => {
  const tail = f.units.filter((u) => u.tag === 'p').pop()?.text ?? '';
  const m = /\b(one|two|three)\b[^.]*\bfollowing\b/i.exec(tail);
  return m ? { one: 1, two: 2, three: 3 }[m[1].toLowerCase()] : 1;
};

/* ── sources ──────────────────────────────────────────────────────── */
function sourceOf(r, html) {
  if (/ZEITGEIST/i.test(r.src)) return 'adventuresInZeitgeist';
  if (/Voidrunner/i.test(r.src)) return 'voidrunnersCodex';
  if (/Adventurer's Guide/i.test(r.src)) return 'adventurersGuide';
  const iss = /<li><a href="\/rules\/gate-pass-gazette[^"]*">Gate Pass Gazette Issue #(\d+)<\/a><\/li>/.exec(html);
  return iss ? `gpg${iss[1]}` : 'a5eMancerGPG';
}
const SOURCE_TITLE = { adventuresInZeitgeist: 'Adventures in ZEITGEIST', voidrunnersCodex: "Voidrunner's Codex", adventurersGuide: "Adventurer's Guide", a5eMancerGPG: 'Gate Pass Gazette' };
const sourceTitle = (s) => SOURCE_TITLE[s] ?? (/^gpg(\d+)$/.test(s) ? `Gate Pass Gazette #${s.slice(3)}` : s);

const EXPANDED = 'Compendium.a5e.a5e-class-features.Item.9z7flr4asm95pk3c';
const PACK = 'Compendium.world.a5e-mancer-imported.Item.';

/* ── one archetype ────────────────────────────────────────────────── */
function build(r) {
  const pageId = r.url.split('/').pop();
  const html = fs.readFileSync(path.join(P.PAGES, pageId + '.html'), 'utf8');
  const seen = { traditions: new Set(), spells: new Set(), maneuvers: new Set(), unmatchedSpells: new Set() };
  const cls = r.cls.toLowerCase();
  const info = classinfo[cls];
  const us = N.units(N.clean(N.bodyOf(html), lk, seen));
  const seg = segment(us, { startLevel: info.start });
  const name = r.name.replace(/\s*\([^)]*\)\s*$/, '').trim();
  const slug = `${cls}-${N.norm(name).replace(/'/g, '').replace(/\s+/g, '-')}`;
  const ov = OVERRIDES[r.name] ?? {};
  const notes = [];
  const source = sourceOf(r, html);
  const caster = !!info.spellcasting && info.spellcasting.casterType !== 'none';
  ov.pre?.(seg, notes);

  // an "X Spells" subsection of a feature that is not a choice is a feature of its own
  for (const f of [...seg.features]) {
    if (isChoice(f) || ov.choice?.[f.name]) continue;
    for (const s of [...f.subs]) {
      if (/\bspells$/i.test(s.name) && !/^table/i.test(s.name)) {
        f.subs.splice(f.subs.indexOf(s), 1);
        seg.features.splice(seg.features.indexOf(f) + 1, 0, { name: s.name, lvl: f.lvl, units: s.units, subs: [] });
        notes.push(`${s.name}: its own feature`);
      }
    }
  }

  const docs = [];
  const taken = new Set();
  const featureDoc = (fname, units, lvl, { parent = null, subsInline = [] } = {}) => {
    const id = rid(`${slug}|${parent ? parent + '>' : ''}${fname}`);
    const spellFeature = /\bspells?\b/i.test(fname) && !/expanded/i.test(fname);
    const tUnits = tablify(units, spellFeature ? `${r.cls} Level` : 'Level');
    let body = render(tUnits);
    for (const s of subsInline) body += (s.fromHeading ? `<h3>${s.name}</h3>` : `<p><strong>${s.name}</strong></p>`) + render(s.units);
    // "Spell Level" heading a column of artificer levels would read as an expanded list
    if (spellFeature) body = body.replace(/(<td>\s*<strong>)\s*Spell Level\s*(<\/strong>\s*<\/td>)/i, `$1${r.cls} Level$2`);
    const blocks = [...blocksOf(units), ...subsInline.flatMap((s) => blocksOf(s.units))];
    // uses and the action from the feature's own text: inline lists of options (gadgets, modifications) are not how it is used
    const plain = blocksOf(units).join(' ');
    const grants = {};
    for (const g of detectGrants(blocks)) {
      const gid = rid(`${id}|g|${g.grantType}|${g.proficiencyType ?? g.skill ?? g.traits?.traitType ?? ''}|${JSON.stringify(g.keys ?? g.traits ?? g.specialties ?? g.senses ?? g.movementTypes ?? g.abilities ?? '')}`, 'g');
      grants[gid] = { _id: gid, level: lvl, levelType: 'class', optional: false, img: '', ...g };
    }
    const uses = detectUses(plain);
    const act = detectAction(fname, plain, { uses, caster, rid: (k) => rid(`${id}|a|${k}`, k) });
    const actions = act ? { [rid(`${id}|action`, 'a')]: act } : {};
    const img = iconFor(fname, cls, taken); taken.add(img);
    const doc = {
      _id: id, name: fname, type: 'feature', img,
      system: {
        description: body, secretDescription: '', source,
        featureType: 'class', classes: cls, class: '', prerequisite: '',
        requiresBloodied: false, concentration: /\bconcentration\b/i.test(plain) && /\bmaintain concentration|requires (?:your )?concentration|concentrat(?:e|ing) (?:on|as)/i.test(plain) && !!act,
        favorite: false,
        uses: uses ?? { value: 0, max: '', per: '', recharge: { formula: '1d6', threshold: 6 } },
        actions, grants
      },
      flags: { 'a5e-mancer': { imported: slug } },
      effects: []
    };
    docs.push(doc);
    return doc;
  };

  const features = [];
  for (const f of seg.features) {
    const choice = ov.choice?.[f.name] ?? isChoice(f);
    const fdoc = featureDoc(f.name, f.units, f.lvl, { subsInline: choice ? [] : f.subs });
    let optDocs = [];
    if (choice) {
      optDocs = f.subs.map((s) => featureDoc(s.name, s.units, f.lvl, { parent: f.name }));
      const total = (typeof choice === 'number' ? choice : countOf(f));
      const gid = rid(`${fdoc._id}|options`, 'g');
      fdoc.system.grants[gid] = {
        _id: gid, grantType: 'feature', level: f.lvl, levelType: 'class', optional: false, label: f.name, img: '',
        features: { base: [], options: optDocs.map((o) => ({ uuid: PACK + o._id, name: o.name, img: o.img, limitedReselection: true, selectionLimit: 1 })), total }
      };
      fdoc.system.description += `<p>${optDocs.map((o) => `@UUID[${PACK}${o._id}]{${o.name}}`).join(', ')}</p>`;
    }
    features.push({ f, doc: fdoc, options: optDocs });
  }
  ov.post?.(features, { rid, PACK, notes });

  // warlocks choose an expanded spell list; one without its own gets a5e's choice, as a5e's warlock archetypes do
  const ownList = features.some(({ f }) => /expanded spell list/i.test(f.name));
  const byLevel = new Map();
  for (const { f, doc } of features) {
    if (!byLevel.has(f.lvl)) byLevel.set(f.lvl, []);
    byLevel.get(f.lvl).push({ uuid: PACK + doc._id, name: doc.name, img: doc.img, limitedReselection: true, selectionLimit: 1 });
  }
  if (cls === 'warlock' && !ownList) {
    const first = Math.min(...byLevel.keys());
    byLevel.get(first).push({ uuid: EXPANDED, name: 'Expanded Spell List', img: '', limitedReselection: true, selectionLimit: 1 });
    notes.push('a5e Expanded Spell List offered at 1st');
  }
  const levels = [...byLevel.keys()].sort((a, b) => a - b);
  const grants = {};
  for (const lv of levels) {
    const gid = rid(`${slug}|level|${lv}`, 'g');
    grants[gid] = { _id: gid, grantType: 'feature', level: lv, levelType: 'class', optional: false, label: `${ORD(lv)} Level Archetype Features`, img: '',
      features: { base: byLevel.get(lv), options: [], total: 0 } };
  }
  const intro = render(seg.intro) + seg.extras.map((e) => `<h3>${e.name}</h3>` + render(e.units)).join('');
  const table = '<p><strong>Table: ' + name + '</strong></p><table border="1"><thead><tr><td>Level</td><td>Features</td></tr></thead><tbody>'
    + levels.map((lv) => `<tr><td>${ORD(lv)}</td><td>${byLevel.get(lv).map((e) => `@UUID[${e.uuid}]{${e.name}}`).join(', ')}</td></tr>`).join('')
    + '</tbody></table>';
  const archetype = {
    _id: rid(`${slug}|archetype`), name, type: 'archetype', img: iconFor(name + ' ' + cls, cls),
    system: {
      class: cls, slug: '', source, favorite: false, secretDescription: '',
      description: intro + table + `<p><em>Source: ${sourceTitle(source)}, via <a href="https://a5e.tools${r.url}">a5e.tools</a>.</em></p>`,
      grants, resources: [],
      spellcasting: JSON.parse(JSON.stringify(info.spellcasting)),
      actions: {}, price: { value: 0, denomination: 'gp', special: '' }
    },
    flags: { 'a5e-mancer': { imported: slug, url: `https://a5e.tools${r.url}` } },
    effects: []
  };
  return { archetype, docs, features, seg, notes, seen, r };
}

/* ── run ──────────────────────────────────────────────────────────── */
const all = [];
const report = [];
for (const r of want) {
  if (only.length && !only.includes(r.name.toLowerCase())) continue;
  const b = build(r);
  all.push(b.archetype, ...b.docs);
  report.push(`\n## ${b.archetype.name} / ${b.r.cls}  [${b.archetype.system.source}]  ${b.archetype.img}`);
  for (const { f, doc, options } of b.features) {
    const g = Object.values(doc.system.grants).filter((x) => x.grantType !== 'feature');
    const a = Object.values(doc.system.actions)[0];
    report.push(`  L${f.lvl} ${doc.name}${doc.system.uses.max ? `  uses ${doc.system.uses.max}/${doc.system.uses.per}` : ''}${a ? `  act:${a.activation.type}${Object.values(a.prompts)[0] ? ' save:' + Object.values(a.prompts)[0].ability + '/' + Object.values(a.prompts)[0].saveDC.type : ''}${Object.values(a.rolls)[0] ? ' roll:' + Object.values(a.rolls)[0].formula + ' ' + (Object.values(a.rolls)[0].damageType ?? Object.values(a.rolls)[0].healingType) : ''}` : ''}${g.length ? '  grants:' + g.map((x) => x.proficiencyType ?? x.traits?.traitType ?? x.grantType).join(',') : ''}  (${doc.img.split('/').pop()})`);
    for (const o of options) {
      const oa = Object.values(o.system.actions)[0];
      const og = Object.values(o.system.grants);
      report.push(`      - ${o.name}${o.system.uses.max ? `  uses ${o.system.uses.max}/${o.system.uses.per}` : ''}${oa ? '  act:' + oa.activation.type : ''}${og.length ? '  grants:' + og.map((x) => x.proficiencyType ?? x.traits?.traitType ?? x.grantType).join(',') : ''}`);
    }
  }
  if (b.notes.length) report.push('  note: ' + b.notes.join('; '));
  if (b.seg.warnings.length) report.push('  ! ' + b.seg.warnings.join('\n  ! '));
  if (b.seen.unmatchedSpells.size) report.push('  ? spells not found: ' + [...b.seen.unmatchedSpells].join(', '));
}
fs.writeFileSync(path.join(P.CACHE, 'build-report.txt'), report.join('\n'));
const archetypes = all.filter((d) => d.type === 'archetype');
console.log(`${archetypes.length} archetypes, ${all.length} documents - report in .cache/build-report.txt`);
if (dry || only.length) process.exit(0);

/* ── into the module ──────────────────────────────────────────────── */
const r = require('./lib/emit.cjs').emit('a5etools-archetypes', all);
console.log(`${path.relative(P.MODULE, r.file)}: ${(r.bytes / 1024).toFixed(0)} KB; generated.js lists ${r.total} documents`);
