// Step 3c: a5e.tools heritage and culture pages -> a5e heritage, culture and
// feature documents, with fixed ids.
//   node tools/import/build-origins.cjs [--dry] [name...]
//
// A heritage page is its traits (Age, Size, Speed and the named ones), its
// gifts to choose one of, its paragon gifts at 10th level, and lore; a culture
// page is its traits and its languages. a5e makes a document of each named
// trait and gift, and grants for size, speed, creature type and languages -
// so this does the same, and .cache/origins-report.txt says what it read.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const P = require('./lib/paths.cjs');
const N = require('./lib/normalize.cjs');
const { detectGrants } = require('./lib/grants.cjs');
const { detectUses, detectAction } = require('./lib/actions.cjs');
const { iconIndex } = require('./lib/icons.cjs');
const { emit } = require('./lib/emit.cjs');

const dry = process.argv.includes('--dry');
const only = process.argv.slice(2).filter((a) => !a.startsWith('--')).map((s) => s.toLowerCase());
const want = JSON.parse(fs.readFileSync(path.join(P.CACHE, 'origins-want.json'), 'utf8'));
const lk = N.lookups();
const pickIcon = iconIndex(['heritages', 'heritageFeatures', 'cultures', 'cultureFeatures', 'paragonGifts']);
const PACK = 'Compendium.world.a5e-mancer-imported.Item.';

/* ── ids ─────────────────────────────────────────────────────────── */
const B62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const used = new Map();
function rid(key, prefix = 'amI') {
  const h = crypto.createHash('sha1').update(key).digest();
  let s = prefix;
  for (let i = 0; s.length < 16; i++) s += B62[h[i % h.length] % 62];
  if (used.has(s) && used.get(s) !== key) throw new Error(`id clash ${s}: ${key} / ${used.get(s)}`);
  used.set(s, key);
  return s;
}

/* ── reading a page ──────────────────────────────────────────────── */
const SOURCES = {
  "Adventurer's Guide": 'adventurersGuide', "Voidrunner's Codex": 'voidrunnersCodex', 'Trials & Treasures': 'trialsAndTreasures',
  'Adventures in ZEITGEIST': 'adventuresInZeitgeist', "Dungeon Delver's Guide": 'dungeonDelversGuide', 'To Save A Kingdom': 'toSaveAKingdom',
  "Planestrider's Journal": 'a5eMancerPlanestrider', 'Mythological Figures & Maleficent Monsters': 'a5eMancerMythological'
};
const sourceOf = (s) => {
  const t = String(s ?? '').trim();
  if (SOURCES[t]) return SOURCES[t];
  const gpg = /Gate Pass Gazette(?:r)?(?: Issue)? #?(\d+)/i.exec(t);
  if (gpg) return Number(gpg[1]) <= 21 ? `gpg${gpg[1]}` : 'a5eMancerGPG';
  return /gate pass/i.test(t) ? 'a5eMancerGPG' : t ? 'a5eMancerOther' : '';
};
const seenStub = () => ({ traditions: new Set(), spells: new Set(), maneuvers: new Set(), unmatchedSpells: new Set() });
const unitsOf = (file) => {
  const html = fs.readFileSync(file, 'utf8');
  const body = N.bodyOf(html.slice(html.indexOf('<article')));
  return N.units(N.clean(body, lk, seenStub()));
};
const render = (units) => units.map((u) => u.html).join('')
  .replace(/<table>/g, '<table border="1">').replace(/<h2>/g, '<h3>').replace(/<\/h2>/g, '</h3>');
const blocksOf = (units) => units.flatMap((u) => /^(ul|ol)$/.test(u.tag) ? [...u.html.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => N.text(m[1])) : u.tag === 'table' ? [] : [u.text]);
/** A trait's lead-in: "<strong><em>Sharp Talons.</em></strong> Your talons ..." */
const LEAD = /^<p>\s*(?:<strong>\s*<em>|<em>\s*<strong>|<strong>|<em>)\s*([^<]{2,60}?)\s*[.:]?\s*(?:<\/strong>\s*<\/em>|<\/em>\s*<\/strong>|<\/strong>|<\/em>)/;
/* Some pages set nothing in bold (the trollkin's), so a plain "Claws. You grow
   ..." counts too: a short capitalised lead-in, a stop, and then the trait. */
const PLAIN_LEAD = /^<p>\s*((?!You\b|Your\b|When|Whenever|If\b|At\b|In\b|As\b|Once\b|This\b|These\b|The\b|A\b|An\b|Additionally|Characters|Some|Most|Many|Each|While|After|Before|Starting|Beginning)[A-Z][\w'’-]*(?: [\w'’-]+){0,3})\s*[.:]\s+(?=[A-Z(])/;
const leadOf = (u) => {
  if (u.tag !== 'p') return null;
  const bold = (LEAD.exec(u.html) || [])[1];
  if (bold) return bold;
  const plain = (PLAIN_LEAD.exec(u.html) || [])[1];
  return plain && u.text.length > plain.length + 20 ? plain : null;
};
/* And a heading that is only a paragraph ("Trollkin Traits") still opens a section. */
const HEAD_TEXT = /^[A-Z][\w'’ -]{0,40}\b(Traits|Gifts|Paragon(?: Gifts)?|Culture|Cultures)$/;

const SIZES = { tiny: 'tiny', small: 'sm', medium: 'med', large: 'lg', huge: 'huge', gargantuan: 'grg' };
const K = JSON.parse(fs.readFileSync(P.KEYS, 'utf8'));
const LANGUAGES = Object.keys(K.languages);
const CREATURE_TYPES = Object.keys(K.creatureTypes);
const langsIn = (text) => { const f = ' ' + N.norm(text).replace(/'/g, '') + ' '; return LANGUAGES.filter((k) => f.includes(` ${k} `) || (k === 'deep' && / deep speech /.test(f)) || (k === 'cant' && / thieves cant /.test(f))); };
/** "You know Common, Gnoll, and one Beran language such as Draconic, Goblin, Minotaur, or Orc." */
function languageGrant(text) {
  const cut = /\b(one|two|three)\b[^.]*?\blanguages?\b\s*(?:such as|of your choice|from|:)?/i.exec(text);
  const before = cut ? text.slice(0, cut.index) : text;
  const after = cut ? text.slice(cut.index + cut[0].length) : '';
  const base = langsIn(before);
  const named = langsIn(after);
  const total = cut ? ({ one: 1, two: 2, three: 3 })[cut[1].toLowerCase()] : 0;
  const options = total ? (named.length ? named : LANGUAGES).filter((k) => !base.includes(k)) : [];
  return { base, options, total: options.length ? total : 0, traitType: 'languages' };
}
const MOVES = { walking: 'walk', walk: 'walk', climbing: 'climb', climb: 'climb', swimming: 'swim', swim: 'swim', flying: 'fly', fly: 'fly', burrowing: 'burrow', burrow: 'burrow' };

function grantsFrom(blocks, idBase, extra = {}) {
  const out = {};
  for (const g of detectGrants(blocks)) {
    const gid = rid(`${idBase}|g|${g.grantType}|${g.proficiencyType ?? g.skill ?? g.traits?.traitType ?? ''}|${JSON.stringify(g.keys ?? g.traits ?? g.specialties ?? g.senses ?? g.movementTypes ?? g.abilities ?? '')}`, 'g');
    out[gid] = { _id: gid, level: 1, levelType: 'character', optional: false, img: '', ...g };
  }
  return Object.assign(out, extra);
}
function featureDoc(id, name, units, featureType, source, folder, imported) {
  const description = render(units);
  const blocks = blocksOf(units);
  const plain = blocks.join(' ');
  const uses = detectUses(plain);
  const act = detectAction(name, plain, { uses, caster: false, rid: (k) => rid(`${id}|a|${k}`, k) });
  return {
    _id: id, name, type: 'feature', img: pickIcon(name, 'icons/sundries/documents/document-sealed-signatures-red.webp'),
    system: {
      description, secretDescription: '', source, featureType, classes: '', class: '', prerequisite: '',
      requiresBloodied: false, concentration: false, favorite: false,
      uses: uses ?? { value: 0, max: '', per: '', recharge: { formula: '1d6', threshold: 6 } },
      actions: act ? { [rid(`${id}|action`, 'a')]: act } : {},
      grants: grantsFrom(blocks, id)
    },
    flags: { 'a5e-mancer': { imported, url: '', folder } },
    effects: []
  };
}

/** The page's h2 sections: { heading, units }, with the text before the first one as the intro. */
function sections(units) {
  const out = [{ heading: '', units: [] }];
  for (const u of units) {
    if (u.tag === 'hr') continue;
    if (u.tag === 'h2' || (u.tag === 'p' && HEAD_TEXT.test(u.text) && u.text.split(' ').length <= 5)) out.push({ heading: u.text, units: [] });
    else out[out.length - 1].units.push(u);
  }
  return out;
}
/** A section's h3 subsections, and what came before them. */
function subsections(units) {
  const intro = [];
  const subs = [];
  for (const u of units) {
    if (u.tag === 'h3' || (u.tag === 'p' && /^[A-Z][\w'’ -]{2,40}$/.test(u.text) && u.text.split(' ').length <= 5 && !/^(Age|Size|Speed|Type|Languages)$/i.test(u.text))) subs.push({ name: u.text.replace(/[:.]\s*$/, ''), units: [] });
    else (subs.length ? subs[subs.length - 1].units : intro).push(u);
  }
  return { intro, subs };
}

/* ── a heritage ──────────────────────────────────────────────────── */
function heritageDocs(row) {
  const slug = row.url.split('/').pop();
  const id = rid(`heritage|${slug}|${row.name}`);
  const name = row.name;
  const source = sourceOf(row.src);
  const units = unitsOf(path.join(P.CACHE, 'pages', 'heritages', row.url.replace(/^\//, '').replace(/\//g, '_') + '.html'));
  const secs = sections(units);
  const docs = [];
  const notes = [];
  const grants = {};
  const traitRefs = [], giftRefs = [], paragonRefs = [];
  let creatureTypes = ['humanoid'];
  const ref = (d) => ({ uuid: PACK + d._id, name: d.name, img: d.img, limitedReselection: true, selectionLimit: 1 });

  for (const sec of secs) {
    const h = sec.heading.toLowerCase();
    if (/\btraits?\b/.test(h) && !/variant/.test(h)) {
      let current = null;
      for (const u of sec.units) {
        const lead = leadOf(u);
        if (lead) {
          const key = lead.toLowerCase();
          if (/^age\b/.test(key)) { current = null; continue; }            // lore, not a grant
          if (/^size\b/.test(key)) {
            const said = [...new Set((u.text.toLowerCase().match(/\b(tiny|small|medium|large|huge|gargantuan)\b/g) ?? []).map((w) => SIZES[w]))];
            if (said.length) {
              const gid = rid(`${id}|size`, 'g');
              // "Your true size is Small or Medium": a size the player picks
              grants[gid] = { _id: gid, grantType: 'trait', level: 1, levelType: 'character', optional: false, img: '', label: 'Size',
                traits: said.length > 1 ? { base: [], options: said, total: 1, traitType: 'size' } : { base: said, options: [], total: 0, traitType: 'size' } };
            } else notes.push(`size not read: ${u.text.slice(0, 60)}`);
            current = null; continue;
          }
          if (/^type\b/.test(key)) {
            const t = CREATURE_TYPES.filter((c) => new RegExp(`\\b${c}s?\\b`, 'i').test(u.text.slice(0, 40)));
            if (t.length) creatureTypes = t;
            else notes.push(`type not read: ${u.text.slice(0, 60)}`);
            current = null; continue;
          }
          if (/^speed\b/.test(key)) {
            const walk = /\b(?:base )?(?:walking )?speed is (\d+) feet/i.exec(u.text);
            const extra = [...u.text.matchAll(/\b(climbing|swimming|flying|burrowing|climb|swim|fly|burrow) speed (?:of |equal to )?(\d+) feet/gi)];
            const types = ['walk', ...extra.map((e) => MOVES[e[1].toLowerCase()])];
            const bonus = walk?.[1] ?? extra[0]?.[2];
            if (bonus) { const gid = rid(`${id}|speed`, 'g'); grants[gid] = { _id: gid, grantType: 'movement', level: 1, levelType: 'character', optional: false, img: '', label: 'Speed', movementTypes: { base: [...new Set(types)], options: [], total: 0 }, bonus: String(bonus), unit: 'feet' }; }
            else notes.push(`speed not read: ${u.text.slice(0, 60)}`);
            current = null; continue;
          }
          current = { name: lead.replace(/[.:]$/, ''), units: [u] };
          docs.push(current);
          continue;
        }
        if (current) current.units.push(u); // the trait's further paragraphs
      }
      continue;
    }
    if (/\bgifts?\b/.test(h) || /\bparagon\b/.test(h)) {
      const paragon = /\bparagon\b/.test(h);
      const { subs } = subsections(sec.units);
      for (const s of subs) {
        if (/^suggested\b/i.test(s.name)) continue;
        const d = featureDoc(rid(`${id}|${paragon ? 'paragon' : 'gift'}|${s.name}`), s.name, s.units, paragon ? 'paragon' : 'heritage', source,
          paragon ? 'Paragon Gifts' : 'Heritage Features', `heritages/${slug}/${s.name}`);
        (paragon ? paragonRefs : giftRefs).push(ref(d));
        docs.push(d);
      }
      if (/variant/.test(h)) notes.push(`${sec.heading}: its gifts offered with the rest`);
      continue;
    }
  }
  // the named traits, as documents
  const traitDocs = docs.filter((d) => !d._id);
  for (const t of traitDocs) {
    const d = featureDoc(rid(`${id}|trait|${t.name}`), `${t.name} (${name})`, t.units, 'heritage', source, 'Heritage Features', `heritages/${slug}/${t.name}`);
    traitRefs.push(ref(d));
    docs[docs.indexOf(t)] = d;
  }
  const featureGrant = (key, label, refs, extra = {}) => {
    if (!refs.length) return;
    const gid = rid(`${id}|${key}`, 'g');
    grants[gid] = { _id: gid, grantType: 'feature', level: 1, levelType: 'character', optional: false, img: '', label,
      features: { base: extra.choose ? [] : refs, options: extra.choose ? refs : [], total: extra.choose ? 1 : 0 }, ...extra.grant };
  };
  featureGrant('traits', 'Traits', traitRefs);
  featureGrant('gifts', 'Gifts', giftRefs, { choose: true });
  if (paragonRefs.length) {
    const gid = rid(`${id}|paragon`, 'g');
    grants[gid] = { _id: gid, grantType: 'feature', level: 10, levelType: 'character', optional: true, img: '', label: 'Paragon Gifts',
      features: { base: [], options: paragonRefs, total: 1 } };
  }
  const ctid = rid(`${id}|creature`, 'g');
  grants[ctid] = { _id: ctid, grantType: 'trait', level: 1, levelType: 'character', optional: false, img: '',
    label: creatureTypes.map((c) => c[0].toUpperCase() + c.slice(1)).join(' or '),
    traits: { base: creatureTypes, options: [], total: 0, traitType: 'creatureTypes' } };

  const heritage = {
    _id: id, name, type: 'heritage', img: pickIcon(name, 'icons/environment/people/group.webp'),
    system: { description: render(units), secretDescription: '', source, favorite: false, grants, price: { value: 0, denomination: 'gp', special: '' } },
    flags: { 'a5e-mancer': { imported: `heritages/${slug}`, url: `https://a5e.tools${row.url}`, folder: 'Heritages' } },
    effects: []
  };
  return { docs: [heritage, ...docs], notes, counts: { traits: traitRefs.length, gifts: giftRefs.length, paragon: paragonRefs.length } };
}

/* ── a culture ───────────────────────────────────────────────────── */
function cultureDocs(row) {
  const slug = row.url.split('/').pop();
  const id = rid(`culture|${slug}|${row.name}`);
  const name = row.name;
  const source = sourceOf(row.src);
  const units = unitsOf(path.join(P.CACHE, 'pages', 'cultures', row.url.replace(/^\//, '').replace(/\//g, '_') + '.html'));
  const docs = [];
  const notes = [];
  const grants = {};
  const traitRefs = [];
  let current = null;
  for (const u of units) {
    if (u.tag === 'h2' || u.tag === 'h3') { current = null; continue; }
    const lead = leadOf(u);
    if (lead) {
      if (/^languages?\b/i.test(lead)) {
        const gid = rid(`${id}|languages`, 'g');
        grants[gid] = { _id: gid, grantType: 'trait', level: 1, levelType: 'character', optional: false, img: '', label: 'Languages', traits: languageGrant(u.text) };
        current = null;
        continue;
      }
      current = { name: lead.replace(/[.:]$/, ''), units: [u] };
      docs.push(current);
      continue;
    }
    if (current) current.units.push(u);
  }
  const traitDocs = docs.filter((d) => !d._id);
  for (const t of traitDocs) {
    const d = featureDoc(rid(`${id}|trait|${t.name}`), t.name, t.units, 'culture', source, 'Culture Features', `cultures/${slug}/${t.name}`);
    traitRefs.push({ uuid: PACK + d._id, name: d.name, img: d.img, limitedReselection: true, selectionLimit: 1 });
    docs[docs.indexOf(t)] = d;
  }
  if (traitRefs.length) {
    const gid = rid(`${id}|traits`, 'g');
    grants[gid] = { _id: gid, grantType: 'feature', level: 1, levelType: 'character', optional: false, img: '', label: 'Traits',
      features: { base: traitRefs, options: [], total: 0 } };
  } else notes.push('no traits read');
  const culture = {
    _id: id, name, type: 'culture', img: pickIcon(name, 'icons/environment/settlement/house-farmland-small.webp'),
    system: { description: render(units), secretDescription: '', source, favorite: false, grants, actions: {}, price: { value: 0, denomination: 'gp', special: '' } },
    flags: { 'a5e-mancer': { imported: `cultures/${slug}`, url: `https://a5e.tools${row.url}`, folder: 'Cultures' } },
    effects: []
  };
  return { docs: [culture, ...docs], notes, counts: { traits: traitRefs.length } };
}

/* ── run ─────────────────────────────────────────────────────────── */
const all = [];
const report = [];
for (const [kind, rows] of Object.entries(want)) {
  report.push(`\n## ${kind} (${rows.length})`);
  for (const row of rows) {
    if (only.length && !only.includes(row.name.toLowerCase())) continue;
    const { docs, notes, counts } = kind === 'heritages' ? heritageDocs(row) : cultureDocs(row);
    all.push(...docs);
    const head = docs[0];
    const g = Object.values(head.system.grants).map((x) => `${x.grantType === 'feature' ? x.label.toLowerCase() : x.grantType === 'trait' ? x.traits.traitType : x.grantType}${x.features ? ` ${x.features.base.length || x.features.options.length}${x.features.total ? ' pick ' + x.features.total : ''}` : x.traits ? ' ' + (x.traits.base.join(',') || x.traits.total) : x.bonus ? ' ' + x.bonus : ''}`);
    report.push(`  ${head.name} [${head.system.source}] ${g.join(' · ')}`);
    for (const d of docs.slice(1)) {
      const dg = Object.values(d.system.grants).map((x) => x.proficiencyType ?? x.traits?.traitType ?? x.grantType);
      report.push(`      - ${d.name}${d.system.featureType === 'paragon' ? ' [paragon]' : ''}${dg.length ? '  grants:' + dg.join(',') : ''}${Object.keys(d.system.actions).length ? '  act' : ''}`);
    }
    if (notes.length) report.push('    note: ' + notes.join('; '));
  }
}
fs.writeFileSync(path.join(P.CACHE, 'origins-report.txt'), report.join('\n'));
const types = all.reduce((o, d) => ((o[d.type === 'feature' ? d.system.featureType : d.type] = (o[d.type === 'feature' ? d.system.featureType : d.type] || 0) + 1), o), {});
console.log(`${all.length} documents ${JSON.stringify(types)} - report in .cache/origins-report.txt`);
if (dry || only.length) process.exit(0);
const r = emit('a5etools-origins', all);
console.log(`${path.relative(P.MODULE, r.file)}: ${(r.bytes / 1024).toFixed(0)} KB; generated.js lists ${r.total} documents`);
