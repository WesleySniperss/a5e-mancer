// What a5e.tools' descriptions have and the packs' do not, as data the module puts into
// descriptions at run time (scripts/utils/siteText.js):
// - links: the stat blocks a summoning spell names, the spells, items, maneuvers, feats and
//   monsters any text names, and conditions - wherever the site links them and a5e does not;
// - blocks a5e left out: tables, stat blocks, lore, a background's connections and mementos,
//   the text of items a5e has none for.
// Text the site words differently (a later printing, errata) is not touched, only reported.
//
//   node tools/import/prepare.cjs
//   node tools/import/fetch-descriptions.cjs
//   node tools/import/build-site-text.cjs        -> scripts/data/siteText.js
//
// Both a5e's packs and the module's imported content are read: an imported entry was made from
// the site page, but its converter kept only spell links.
const fs = require('fs'), path = require('path');
const { pathToFileURL } = require('url');
const P = require('./lib/paths.cjs');
const { variants, flat } = require('./lib/match.cjs');

const DESC = path.join(P.CACHE, 'descriptions');
const read = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const pack = (n) => read(path.join(P.PACKS, `${n}.json`));
const descOf = (d) => typeof d.system?.description === 'string' ? d.system.description : (d.system?.description?.value ?? '');

/** Each site list, the a5e packs its entries are in, and the type of their documents. */
const LISTS = {
  spells: { packs: ['spells'], type: 'spell' },
  'magic-items': { packs: ['adventuringGear'], type: 'object' },
  'mundane-equipment': { packs: ['adventuringGear'], type: 'object' },
  weapons: { packs: ['adventuringGear'], type: 'object' },
  'combat-maneuvers': { packs: ['maneuvers'], type: 'maneuver' },
  feats: { packs: ['feats'], type: 'feature' },
  backgrounds: { packs: ['backgrounds'], type: 'background' },
  destinies: { packs: ['destinies'], type: 'destiny' },
};
const A5E_PACK = { spells: 'a5e-spells', adventuringGear: 'a5e-adventuring-gear', maneuvers: 'a5e-maneuvers', feats: 'a5e-feats', backgrounds: 'a5e-backgrounds', destinies: 'a5e-destinies', archetypes: 'a5e-archetypes' };
/** What a site link of each kind can point at in a5e. */
const KIND_PACKS = {
  spell: ['spells'], 'psionic-power': ['spells'], 'magic-item': ['adventuringGear'], equipment: ['adventuringGear'], weapon: ['adventuringGear'],
  'combat-maneuver': ['maneuvers'], feat: ['feats'], background: ['backgrounds'], destiny: ['destinies'], archetype: ['archetypes'],
};
/** a5e's conditions (CONFIG.A5E.conditions), and words the site links for them. */
const CONDITIONS = new Set(['blinded', 'bloodied', 'charmed', 'confused', 'dazzled', 'deafened', 'doomed', 'encumbered', 'enervated', 'fatigue', 'fixated',
  'frightened', 'grappled', 'incapacitated', 'invisible', 'paralyzed', 'petrified', 'poisoned', 'prone', 'rattled', 'restrained', 'slowed', 'strife', 'stunned', 'unconscious']);
const CONDITION_WORDS = { blind: 'blinded', fatigued: 'fatigue', exhausted: 'fatigue', exhaustion: 'fatigue', grapple: 'grappled', poison: null };
/* Summoned creatures the site does not link, with the a5e stat block that is theirs. */
const EXTRA_LINKS = {
  'forest army': [['grove swarm', 'Grove Swarm']],
};
/** Lines a spell page repeats from its header; a5e keeps them as data. */
const META = /^(casting time|range|targets?|area|duration|components?|saving throw|classes|school|level|ritual)\s*:/i;

(async () => {
  const core = await import(pathToFileURL(path.join(P.MODULE, 'scripts', 'utils', 'siteTextCore.js')).href);
  const { norm, blocksOf, anchorOf, insertBlocks, occurrences, patternOf } = core;
  const shingles = (html) => { const w = norm(html).split(' ').filter(Boolean); const out = []; for (let i = 0; i + 3 <= w.length; i++) out.push(w.slice(i, i + 3).join(' ')); return out; };
  const coverage = (html, set) => { const sh = shingles(html); return sh.length ? sh.filter(x => set.has(x)).length / sh.length : null; };

  // ---- what links can point at
  const docsOf = Object.fromEntries([...new Set(Object.values(LISTS).flatMap(l => l.packs).concat(['archetypes']))].map(n => [n, pack(n)]));
  const monsters = pack('monsterIndex');
  const imported = [];
  for (const f of fs.readdirSync(P.OUT).filter(f => /^a5etools-.*\.json$/.test(f))) {
    const kind = /monsters/.test(f) ? 'Actor' : /challenges/.test(f) ? 'JournalEntry' : 'Item';
    for (const d of read(path.join(P.OUT, f))) imported.push({ ...d, kind });
  }
  const importedUuid = (d) => `Compendium.world.${d.kind === 'Actor' ? 'a5e-mancer-imported-monsters' : d.kind === 'JournalEntry' ? 'a5e-mancer-imported-challenges' : 'a5e-mancer-imported'}.${d.kind}.${d._id}`;
  const importedAt = new Map();          // page -> its documents: the entry, and a background's or destiny's features
  for (const d of imported) {
    const url = String(d.flags?.['a5e-mancer']?.url ?? '').replace(/^https?:\/\/a5e\.tools/, '');
    if (!importedAt.has(url)) importedAt.set(url, []);
    importedAt.get(url).push(d);
  }
  /** What a link to a page means: the entry itself, not one of its features. */
  const importedByUrl = { get: (url) => { const ds = importedAt.get(url) ?? []; return ds.find(d => d.type !== 'feature') ?? ds[0]; } };
  const nodes = read(path.join(DESC, 'nodes.json'));
  const spellRows = read(path.join(DESC, 'spells.json'));
  const spellByUrl = new Map(spellRows.map(r => [r.url, r.name]));

  const stem = (w) => w.replace(/ies$/, 'y').replace(/(?<=[a-z]{3}[^s])s$/, '');
  const bag = (name) => new Set(flat(name).split(' ').filter(w => w && !['of', 'the', 'a', 'an'].includes(w)).map(stem));
  const monsterBags = monsters.map(m => ({ m, bag: bag(m.name) }));
  function monsterTarget(name, { summon } = {}) {
    const f = flat(name);
    let hit = monsters.find(m => flat(m.name) === f);
    if (summon) {
      // a conjuring spell's creature: a5e's "Conjured Woodland Beings (Satyr)" over the plain Satyr
      const c = monsters.find(m => /^conjured /i.test(m.name) && flat((m.name.match(/\(([^)]+)\)\s*$/) || [])[1] ?? '') === f);
      if (c) hit = c;
    }
    if (!hit) {
      const want = bag(name);
      const cands = monsterBags.filter(x => [...want].every(w => x.bag.has(w))).sort((a, b) => a.bag.size - b.bag.size);
      if (cands.length && cands[0].bag.size <= want.size + 2) hit = cands[0].m;
    }
    return hit ? `Compendium.a5e.a5e-monsters.Actor.${hit._id}` : null;
  }
  function itemTarget(kind, name) {
    for (const p of KIND_PACKS[kind] ?? []) {
      const docs = docsOf[p];
      const exact = docs.find(d => flat(d.name) === flat(name));
      if (exact) return `Compendium.a5e.${A5E_PACK[p]}.Item.${exact._id}`;
    }
    for (const p of KIND_PACKS[kind] ?? []) {
      const want = variants(name);
      const near = docsOf[p].find(d => [...variants(d.name)].some(v => want.has(v)));
      if (near) return `Compendium.a5e.${A5E_PACK[p]}.Item.${near._id}`;
    }
    return null;
  }
  /** Where a site link goes in Foundry: a uuid, 'condition:<id>', or null. */
  function resolve(href, text, { summon } = {}) {
    const h = href.replace(/[?#].*$/, '');
    const words = text.toLowerCase().trim();
    let kind, name;
    if (h.startsWith('/spell/')) { kind = 'spell'; name = spellByUrl.get(h) ?? h.slice(7).replace(/-/g, ' '); }
    else if (h.startsWith('/rules/')) { kind = 'rules'; name = h.slice(7); }
    else if (nodes[h]) { kind = nodes[h].type === 'srd-page' ? 'rules' : nodes[h].type; name = nodes[h].title; }
    else return null;
    if (kind === 'rules') {
      const id = CONDITIONS.has(words) ? words : CONDITION_WORDS[words];
      return /conditions/.test(h) || CONDITIONS.has(words) ? (id ? `condition:${id}` : null) : null;
    }
    if (kind === 'monster') return monsterTarget(name, { summon }) ?? (importedByUrl.get(h) ? importedUuid(importedByUrl.get(h)) : null)
      ?? (nodes[h]?.canonical && importedByUrl.get(nodes[h].canonical) ? importedUuid(importedByUrl.get(nodes[h].canonical)) : null);
    const own = itemTarget(kind, name);
    if (own) return own;
    /* An animal the site sells as equipment (the weasel of a Bag of Tricks, a
       riding horse) is a stat block in a5e: that, before the imported item. */
    if (kind === 'equipment') {
      const beast = monsters.find(m => flat(m.name) === flat(name));
      if (beast) return `Compendium.a5e.a5e-monsters.Actor.${beast._id}`;
    }
    const imp = importedByUrl.get(h) ?? importedByUrl.get(nodes[h]?.canonical ?? '');
    if (imp) return importedUuid(imp);
    /* A generic page linked by a particular name ("greater healing potion" to the
       site's Potion of Healing, a5e's "Healing Potion (Greater)"). */
    return itemTarget(kind, text) ?? (kind === 'equipment' ? monsterTarget(name) : null);
  }

  // ---- the site's text of an entry, as HTML Foundry can show
  const ATTRS = /\s(colspan|rowspan)="\d+"/gi;
  function clean(html, opts) {
    return String(html ?? '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<span class="freelinking-link"\s*>([\s\S]*?)<\/span>/g, '$1')
      .replace(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g, (m, href, inner) => {
        const text = inner.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
        const local = href.replace(/^https?:\/\/a5e\.tools/, '');
        const t = local.startsWith('/') ? resolve(local, text, opts) : null;
        return t ? core.linkMarkup(t, text) : inner;
      })
      .replace(/<\/?(div|span|section|article|font|colgroup|col)\b[^>]*>/gi, '')
      .replace(/<img\b[^>]*>/gi, '')
      .replace(/<(\/?)(p|td|th|tr|table|tbody|thead|tfoot|ul|ol|li|h[1-6]|em|strong|b|i|u|blockquote|br|hr|sup|sub)\b([^>]*)>/gi,
        (m, close, tag, attrs) => close ? `</${tag.toLowerCase()}>` : `<${tag.toLowerCase()}${(attrs.match(ATTRS) || []).join('')}>`)
      .replace(/<p>(\s|&nbsp;|<br>)*<\/p>/gi, '')
      .replace(/\s*\n\s*/g, ' ')
      .replace(/>\s+</g, '> <')
      .trim();
  }
  /** A field's text with its label put in front, as a5e writes a labelled paragraph. */
  function labelled(label, html) {
    if (!label) return html;
    const t = html.trim();
    return /^<p>/i.test(t) ? t.replace(/^<p>/i, `<p><strong>${label}.</strong> `) : `<p><strong>${label}.</strong> ${t}</p>`;
  }
  function siteHtml(list, r, opts) {
    if (list === 'spells') return clean(r.body, opts) + (r.higher ? labelled('<em>Cast at Higher Levels</em>', clean(r.higher, opts)) : '');
    if (list === 'backgrounds' || list === 'destinies') {
      const f = Object.fromEntries(r.fields.map(([n, label, html]) => [n.replace(/^field-(background|destiny)-/, ''), { label, html: clean(html, opts) }]));
      const out = [f.body?.html ?? ''];
      const N = r.name.toUpperCase();
      if (list === 'backgrounds') {
        for (const k of ['skill-prof', 'tool-prof', 'lang']) if (f[k]) out.push(`<p><strong>${f[k].label}:</strong> ${f[k].html.replace(/<\/?p>/g, '')}</p>`);
        if (f['suggested-equip']) out.push(`<p><strong>Suggested Equipment:</strong> ${f['suggested-equip'].html.replace(/<\/?p>/g, '')}</p>`);
        if (f['feature-desc']) out.push(labelled(`Feature: ${(f['feature-name']?.html ?? '').replace(/<[^>]+>/g, '').trim()}`, f['feature-desc'].html));
        if (f['adventures-adv']) out.push(labelled('Adventures and Advancement', f['adventures-adv'].html));
        const items = (k) => Array.from({ length: 10 }, (_, i) => f[`${k}-${i + 1}`]?.html.replace(/<\/?p>/g, '')).filter(Boolean);
        const con = items('connection'), mem = items('memento');
        if (con.length) out.push(`<h3><strong>${N} CONNECTIONS</strong></h3>`, `<ol>${con.map(x => `<li>${x}</li>`).join('')}</ol>`);
        if (mem.length) out.push(`<h3><strong>${N} MEMENTOS</strong></h3>`, `<ol>${mem.map(x => `<li>${x}</li>`).join('')}</ol>`);
      } else {
        for (const k of ['source-of-insp', 'insp-feature', 'fulfilling-your', 'fulfillment-feat']) if (f[k]) out.push(labelled(f[k].label, f[k].html));
        const mot = Array.from({ length: 6 }, (_, i) => f[`motivation-${i + 1}`]?.html.replace(/<\/?p>/g, '')).filter(Boolean);
        if (mot.length) out.push(`<p><strong>Table: ${r.name} Destiny</strong></p>`,
          `<table><thead><tr><th>d${mot.length}</th><th>Motivation</th></tr></thead><tbody>${mot.map((x, i) => `<tr><td>${i + 1}</td><td>${x}</td></tr>`).join('')}</tbody></table>`);
      }
      return out.join('');
    }
    return clean(r.body, opts);
  }

  // ---- blocks repeated across a list (a tool's rules, a focus's) are not the entry's own
  const rowsOf = Object.fromEntries(Object.keys(LISTS).map(l => [l, read(path.join(DESC, `${l}.json`))]));
  const seen = new Map();
  for (const [list, rows] of Object.entries(rowsOf)) for (const r of rows) for (const b of new Set(blocksOf(clean(r.body)).map(norm))) {
    if (b.length > 40) seen.set(b, (seen.get(b) ?? 0) + 1);
  }
  const boilerplate = (b) => (seen.get(norm(b)) ?? 0) >= 3;

  // ---- pair every a5e document (and imported one) with the site entry it is
  const FEATURES = { backgrounds: 'backgroundFeatures', destinies: 'destinyFeatures' };
  const featureDocs = Object.fromEntries(Object.entries(FEATURES).map(([l, p]) => [l, new Map(pack(p).map(d => [d._id, d]))]));
  const withFeatures = (list, doc) => {
    if (!FEATURES[list]) return descOf(doc);
    let html = descOf(doc);
    for (const id of JSON.stringify(doc.system?.grants ?? {}).match(/[A-Za-z0-9]{16}(?=")/g) ?? []) { const f = featureDocs[list].get(id); if (f) html += descOf(f); }
    return html;
  };

  const targets = [], targetIndex = new Map();
  const tIndex = (t) => { if (!targetIndex.has(t)) { targetIndex.set(t, targets.length); targets.push(t); } return targetIndex.get(t); };
  const entries = {}, names = {};
  const report = { pairs: 0, links: {}, unresolved: {}, adds: [], reworded: [], unpaired: {} };

  /**
   * One a5e (or imported) document against its text on the site: the blocks to add
   * and the links to make, into entries and names. mode: 'entry' (a list's own
   * entry), 'feature' (a class, archetype, heritage or culture feature - its
   * section of the page), 'parent' (the class, archetype... itself - links only).
   */
  function processPair(list, type, { doc, row, uuid, packHtml, imported: isImported }, mode = 'entry') {
    report.pairs++;
    const summon = list === 'spells' && /conjure/i.test(row.name);
    const html = siteHtml(list, row, { summon });
    const ownHtml = descOf(doc);
    const all = new Set(shingles(packHtml)), allNorm = norm(packHtml);

    // blocks: what the pack has none of
    let blocks = blocksOf(html);
    /* A stat block a5e has as an actor of its own (a spell's grove swarm, its
       woodland beings) is linked, not copied: from its title - a short bold line
       naming an a5e monster, with armor class or hit points just after - to the end. */
    const statAt = blocks.findIndex((b, i) => {
      const words = b.replace(/<[^>]+>/g, ' ').trim();
      if (!/^<p>\s*<strong>/i.test(b) || words.split(/\s+/).length > 5) return false;
      if (!/armor class|\bac\b|hit points|\bhp\b/i.test(blocks.slice(i + 1, i + 5).join(' ').replace(/<[^>]+>/g, ' '))) return false;
      const title = bag(words);
      return title.size && monsterBags.some(x => [...title].every(w => x.bag.has(w)));
    });
    if (statAt >= 0) {
      blocks = blocks.slice(0, statAt);
      while (blocks.length && /^<hr/i.test(blocks.at(-1))) blocks.pop();
    }
    const present = blocks.map(b => {
      if (/^<hr/i.test(b)) return true;
      const cov = coverage(b, all);
      return cov === null ? allNorm.includes(norm(b)) || !norm(b) : cov >= 0.35;
    });
    const missingOk = (b) => !META.test(norm(b) ? b.replace(/<[^>]+>/g, '').trim() : '') && !boilerplate(b);
    const ownBlocks = blocksOf(ownHtml).filter(b => norm(b));
    const ownSets = ownBlocks.map(b => new Set(shingles(b)));
    const anchorFor = (i) => {
      for (let j = i - 1; j >= 0; j--) {
        if (!present[j] || /^<hr/i.test(blocks[j])) continue;
        const sh = shingles(blocks[j]);
        let bi = -1, bs = 0;
        ownSets.forEach((s, k) => { const n = sh.filter(x => s.has(x)).length; if (n > bs) { bs = n; bi = k; } });
        if (bi < 0) { const n = norm(blocks[j]); bi = ownBlocks.findIndex(b => norm(b).includes(n)); }
        if (bi >= 0) return anchorOf(ownBlocks[bi]);
      }
      return '^';
    };
    const add = [];
    const thin = norm(ownHtml).split(' ').filter(Boolean).length < 5;
    /* What may be added. Equipment and weapons: only to an item with no text -
       elsewhere the site's extra is a tool's rules or an encyclopedia line. A
       spell: tables and stat blocks - a paragraph it has that a5e does not is
       a later printing's wording (Harm, Hex), not something a5e left out. A
       variant (a5e's "Bag of Tricks (Gray)" for the site's one page of every
       bag): the table of them all, not the text of the others. */
    const variant = flat(doc.name) !== flat(row.name);
    const statblock = (g) => /armor class|\bac\b/i.test(g.replace(/<[^>]+>/g, ' ')) && /hit points|\bhp\b/i.test(g.replace(/<[^>]+>/g, ' '));
    /* A feature (its section of a class or heritage page, found by its heading):
       the tables, or the whole text where a5e's has none - a section's end is a
       guess, and a paragraph past it would be another feature's. The class or
       heritage itself: links only. */
    const tablesOnly = variant || list === 'spells' || (mode === 'feature' && !thin);
    const allowed = (g) => {
      if (mode === 'parent') return false;
      if ((list === 'mundane-equipment' || list === 'weapons') && !thin) return false;
      const words = norm(g).split(' ').filter(Boolean).length;
      if (tablesOnly) return /<table/i.test(g) && words <= 300 || (!variant && mode === 'entry' && statblock(g));
      return words >= (thin ? 3 : 8) || /<table/i.test(g);
    };
    for (let i = 0; i < blocks.length; i++) {
      if (present[i] || !missingOk(blocks[i])) continue;
      let j = i, group = '';
      while (j < blocks.length && !present[j] && missingOk(blocks[j])) group += blocks[j++];
      if (tablesOnly) {
        // only the tables of a group, each on its own with the title line before it
        const tables = [];
        for (let k = i; k < j; k++) {
          if (!/^<table/i.test(blocks[k])) continue;
          const title = k > i && !/^<table/i.test(blocks[k - 1]) && norm(blocks[k - 1]).split(' ').length <= 8 ? blocks[k - 1] : '';
          tables.push(title + blocks[k]);
        }
        const keep = statblock(group) && !variant && mode === 'entry' ? [group] : tables;
        for (const t of keep) if (allowed(t)) add.push([thin ? '^' : anchorFor(i), t]);
      } else if (allowed(group)) add.push([thin ? '^' : anchorFor(i), group]);
      i = j - 1;
    }
    if (add.length) report.adds.push({ list, name: doc.name, imported: !!isImported, blocks: add.length, words: add.reduce((n, [, h]) => n + norm(h).split(' ').length, 0), first: norm(add[0][1]).slice(0, 90) });
    // reworded: paragraphs the pack has in part only - reported, not changed
    blocks.forEach((b, i) => { const c = coverage(b, all); if (present[i] && c !== null && c < 0.8 && c >= 0.35 && norm(b).split(' ').length > 12 && !/<table/i.test(b) && missingOk(b)) report.reworded.push({ list, name: doc.name, site: b.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 240), coverage: +c.toFixed(2) }); });

    // links: the site's, at the same place in the pack's text
    const finalHtml = insertBlocks(ownHtml, add);
    const links = [];
    const usedFirst = new Set();
    const rawLinks = [];
    for (const field of list === 'spells' ? [row.body, row.higher] : (list === 'backgrounds' || list === 'destinies') && mode === 'entry' ? row.fields.map(f => f[2]) : [row.body]) {
      const src = String(field ?? '').replace(/<!--[\s\S]*?-->/g, '').replace(/<span class="freelinking-link"\s*>([\s\S]*?)<\/span>/g, '$1');
      for (const m of src.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)) {
        const text = m[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
        if (!text) continue;
        const occ = occurrences(src, text);
        rawLinks.push({ href: m[1].replace(/^https?:\/\/a5e\.tools/, ''), text, k: occ.findIndex(o => o.start >= m.index && o.start < m.index + m[0].length), siteCount: occ.length });
      }
    }
    for (const [text, monster] of EXTRA_LINKS[flat(row.name)] ?? []) rawLinks.push({ extra: monsterTarget(monster), text, k: 0, siteCount: 1 });
    for (const l of rawLinks) {
      const target = l.extra ?? (l.href.startsWith('/') ? resolve(l.href, l.text, { summon }) : null);
      const kind = l.extra ? 'monster' : (l.href.startsWith('/spell/') ? 'spell' : l.href.startsWith('/rules/') ? 'rules' : nodes[l.href]?.type ?? 'other');
      if (!target) {
        if (kind !== 'rules' && kind !== 'srd-page' && kind !== 'monster-type') {
          report.unresolved[kind] = (report.unresolved[kind] ?? 0) + 1;
          (report.unresolvedNames ??= {})[`${kind}: ${nodes[l.href]?.title ?? l.href}`] = l.text;
        }
        continue;
      }
      if (target === uuid) continue;
      /* The site links any word that is the title of a page ("freelinking"): a
         curse to the Cursed background, dim light to the Light destiny, guards to
         the Guard background. A background or destiny only where it is named,
         with a capital - "your destiny changes to Revenge". */
      if (/\.a5e-(backgrounds|destinies)\.|a5e-mancer-imported\.Item/.test(target) && /^[a-z]/.test(l.text)
          && (/\.a5e-(backgrounds|destinies)\./.test(target) || ['background', 'destiny'].includes(kind))) continue;
      const inOwn = occurrences(ownHtml, l.text);
      if (inOwn.some(o => !o.linkable)) continue;               // a5e links it already
      // a condition once per text: the site links every "restrained", one is enough to read it
      if (target.startsWith('condition:') && links.some(x => targets[x[1]] === target)) continue;
      const inFinal = occurrences(finalHtml, l.text);
      /* Not where the words are part of longer ones the site links on their own:
         "rat" inside "giant rat". */
      const longer = rawLinks.filter(o => o.text.length > l.text.length && patternOf(l.text).test(o.text)).flatMap(o => occurrences(finalHtml, o.text));
      const free = (i) => inFinal[i]?.linkable && !longer.some(o => o.start <= inFinal[i].start && inFinal[i].end <= o.end);
      let occ;
      if (inFinal.length === l.siteCount && l.k >= 0 && free(l.k)) occ = l.k;
      else if (!usedFirst.has(l.text.toLowerCase())) occ = inFinal.findIndex((o, i) => free(i));
      else continue;
      usedFirst.add(l.text.toLowerCase());
      if (occ < 0 || links.some(x => x[0].toLowerCase() === l.text.toLowerCase() && x[2] === occ)) continue;
      links.push([l.text, tIndex(target), occ]);
      const k = target.startsWith('condition:') ? 'condition' : target.includes('Actor') ? 'monster' : kind;
      report.links[k] = (report.links[k] ?? 0) + 1;
    }

    if (!add.length && !links.length) return;
    entries[doc._id] = { ...(add.length ? { add } : {}), ...(links.length ? { links } : {}) };
    const key = `${type}|${doc.name.toLowerCase().replace(/[’‘`]/g, "'").replace(/\s+/g, ' ').trim()}`;
    (names[key] ??= []).includes(doc._id) || names[key].push(doc._id);
  }

  for (const [list, { packs: packNames, type }] of Object.entries(LISTS)) {
    const rows = rowsOf[list];
    const rowByVariant = new Map();
    for (const r of rows) for (const v of variants(r.name)) { if (!rowByVariant.has(v)) rowByVariant.set(v, []); rowByVariant.get(v).push(r); }
    const pairs = [];
    for (const p of packNames) for (const doc of docsOf[p]) {
      if (list === 'mundane-equipment' || list === 'weapons' || list === 'magic-items') {
        // one gear pack for three lists: a magic item is the one with a rarity
        const magic = !!doc.system?.rarity && doc.system.rarity !== 'mundane';
        if ((list === 'magic-items') !== magic) continue;
        if (list === 'weapons' && doc.system?.objectType !== 'weapon') continue;
      }
      const cands = new Set();
      for (const v of variants(doc.name)) for (const r of rowByVariant.get(v) ?? []) cands.add(r);
      if (list === 'spells') for (const r of rows) if (flat(doc.name) !== flat(r.name) && flat(doc.name).endsWith(' ' + flat(r.name))) cands.add(r);   // a rare version
      if (!cands.size) continue;
      const own = withFeatures(list, doc);
      const ownSet = new Set(shingles(own));
      let best = null;
      for (const r of cands) {
        /* Either way round: how much of the site's text the pack has, or how much of
           the pack's text is in the site's - a pack that kept a fifth of a long
           entry (Vekeshi Blade, Ring of Elemental Command) is still that entry. */
        const site = siteHtml(list, r);
        const cov = Math.max(coverage(site, ownSet) ?? 0, coverage(own, new Set(shingles(site))) ?? 0);
        const exact = flat(r.name) === flat(doc.name);
        const score = cov + (exact ? 0.05 : 0);
        if (cov >= 0.3 || (exact && norm(descOf(doc)).split(' ').length < 5)) if (!best || score > best.score) best = { r, score };
      }
      if (best) pairs.push({ doc, row: best.r, uuid: `Compendium.a5e.${A5E_PACK[p]}.Item.${doc._id}`, packHtml: own });
    }
    for (const r of rows) {
      // a page's imported documents are the entry and its features: the one of this list's type
      const d = (importedAt.get(r.url) ?? []).find(x => x.kind === 'Item' && x.type === type);
      if (d) pairs.push({ doc: d, row: r, uuid: importedUuid(d), packHtml: descOf(d), imported: true });
    }
    report.unpaired[list] = rows.filter(r => !pairs.some(p => p.row === r)).map(r => r.name);

    for (const pair of pairs) processPair(list, type, pair);
  }

  const SYS = read(path.join(P.SYSTEM, 'system.json')).packs;
  const packNameOf = Object.fromEntries(SYS.map(p => [path.basename(p.path).replace(/\.db$/, ''), p.name]));
  const sysPacks = new Set(SYS.map(p => `a5e.${p.name}`));

  /* Classes, archetypes, heritages and cultures: one page on the site, a
     document and its features in a5e. Each feature is found on the page by its
     name - a heading, or a paragraph that opens with it in bold - and compared
     with its section: from there to the next heading as high (or, for a bold
     opening, the next place a feature could start). The class or heritage
     itself is compared with the page's text before its first feature, for
     links only. */
  const PAGES = {
    classes: { parents: 'classes', type: 'class', features: ['classFeatures'] },
    archetypes: { parents: 'archetypes', type: 'archetype', features: ['classFeatures'] },
    heritages: { parents: 'heritages', type: 'heritage', features: ['heritageFeatures'] },
    cultures: { parents: 'cultures', type: 'culture', features: ['cultureFeatures'] },
  };
  const baseName = (n) => flat(String(n).replace(/\s*\([^)]*\)\s*$/, ''));
  function marksOf(html) {
    const out = [];
    for (const m of html.matchAll(/<(h[1-6])\b[^>]*>([\s\S]*?)<\/\1>/g)) out.push({ at: m.index, after: m.index + m[0].length, level: Number(m[1][1]), text: m[2].replace(/<[^>]+>/g, '').trim() });
    for (const m of html.matchAll(/<p\b[^>]*>\s*((?:<(?:strong|b|em|i)\b[^>]*>\s*)+)([^<]{2,90}?)\s*</g)) out.push({ at: m.index, after: m.index, level: 9, text: m[2].trim(), lead: true });
    return out.sort((x, y) => x.at - y.at);
  }
  const done = new Set(Object.keys(entries));
  for (const [list, k] of Object.entries(PAGES)) {
    const rows = fs.existsSync(path.join(DESC, `${list}.json`)) ? read(path.join(DESC, `${list}.json`)) : [];
    const parents = pack(k.parents).map(d => ({ d, uuid: `Compendium.a5e.${packNameOf[k.parents]}.Item.${d._id}` }));
    const featureById = new Map(k.features.flatMap(f => pack(f).map(d => [d._id, { d, uuid: `Compendium.a5e.${packNameOf[f]}.Item.${d._id}` }])));
    for (const row of rows) {
      const html = String(row.body || row.fields.map(f => f[2]).join(''))
        .replace(/<span style="font-weight:\s*(?:700|bold);?">([\s\S]*?)<\/span>/g, '<strong>$1</strong>');
      const marks = marksOf(html);
      // the document(s) this page is: a5e's by name (an archetype for the same class), or the imported ones made from it
      const groups = [];
      for (const { d, uuid } of parents) {
        if (baseName(d.name) !== baseName(row.name)) continue;
        if (row.cls && d.system?.class && flat(d.system.class) !== flat(row.cls)) continue;
        const ids = [...new Set(JSON.stringify(d.system?.grants ?? {}).match(/[A-Za-z0-9]{16}(?=")/g) ?? [])];
        groups.push({ parent: { d, uuid }, features: ids.map(i => featureById.get(i)).filter(Boolean) });
      }
      const here = importedAt.get(row.url) ?? [];
      const impParent = here.find(x => x.kind === 'Item' && x.type === k.type);
      if (impParent) groups.push({ parent: { d: impParent, uuid: importedUuid(impParent), imported: true }, features: here.filter(x => x.type === 'feature').map(d => ({ d, uuid: importedUuid(d), imported: true })) });
      for (const { parent, features } of groups) {
        let first = html.length;
        for (const f of features) {
          if (done.has(f.d._id)) continue;
          const want = baseName(f.d.name);
          const at = marks.findIndex(m => { const t = baseName(m.text.replace(/[.:]\s*$/, '')); return t === want || t.replace(/^\d+(st|nd|rd|th) level /, '') === want; });
          if (at < 0) continue;
          const m = marks[at];
          const next = marks.slice(at + 1).find(n => m.lead ? true : !n.lead && n.level <= m.level);
          const section = html.slice(m.after, next ? next.at : html.length);
          first = Math.min(first, m.at);
          done.add(f.d._id);
          processPair(`${list}-features`, 'feature', { doc: f.d, row: { name: f.d.name, url: row.url, body: section, higher: '', fields: [] }, uuid: f.uuid, packHtml: descOf(f.d), imported: f.imported }, 'feature');
        }
        if (done.has(parent.d._id)) continue;
        done.add(parent.d._id);
        processPair(list, k.type, { doc: parent.d, row: { name: parent.d.name, url: row.url, body: html.slice(0, first), higher: '', fields: [] }, uuid: parent.uuid, packHtml: descOf(parent.d), imported: parent.imported }, 'parent');
      }
    }
  }

  /* a5e's own links that lead nowhere: to the paid modules its content came
     from (Bloody Heretics, Out of the Wilds - the same content is in a5e's packs
     and on a5e.tools), to a pack that is gone (a5e-magic-items), or to ids its
     packs no longer have (dnd5e-spells). Each goes to the document of that name
     a5e has now - '' where there is none, and the words stay without a link. */
  const every = Object.keys(packNameOf).filter(n => n !== 'monsters' && fs.existsSync(path.join(P.PACKS, `${n}.json`)))
    .flatMap(n => pack(n).map(d => ({ d, uuid: `Compendium.a5e.${packNameOf[n]}.Item.${d._id}`, n })));
  const exists = new Set([...every.map(x => x.d._id), ...monsters.map(m => m._id)]);
  const named = new Map();
  const nameKeys = (s) => { const f = flat(s); return [f, f.replace(/s$/, ''), `${f}s`]; };
  for (const x of every) for (const k of nameKeys(x.d.name)) { if (!named.has(k)) named.set(k, []); named.get(k).push(x); }
  for (const d of imported.filter(d => d.kind === 'Item')) for (const k of nameKeys(d.name)) { if (!named.has(k)) named.set(k, []); named.get(k).push({ d, uuid: importedUuid(d), n: 'imported' }); }
  const relink = {};
  for (const { d } of every) for (const m of JSON.stringify(d.system ?? {}).matchAll(/@UUID\[(Compendium\.([\w-]+)\.([\w-]+)\.(?:Item\.|Actor\.)?([A-Za-z0-9]{16}))\](?:\{([^}]*)\})?/g)) {
    const [, uuid, scope, name, id, label] = m;
    if (sysPacks.has(`${scope}.${name}`) && exists.has(id)) continue;
    if (uuid in relink || !label) continue;
    const spell = /spell/i.test(name);
    const cands = nameKeys(label.replace(/\s*\([^)]*\)\s*$/, '')).flatMap(k => named.get(k) ?? []);
    const best = cands.find(x => spell ? /spell/i.test(x.n) : !/spell/i.test(x.n)) ?? cands[0];
    relink[uuid] = best?.uuid ?? '';
  }
  report.relinked = Object.entries(relink).map(([from, to]) => `${from} -> ${to || '(words only)'}`);
  const data = { targets, entries, names, relink };
  const out = path.join(P.MODULE, 'scripts', 'data', 'siteText.js');
  fs.writeFileSync(out, '// Generated by tools/import/build-site-text.cjs from a5e.tools - do not edit by hand.\n'
    + '// targets: what links point at; entries: by document id, { add: [[anchor, html]], links: [[words, target, occurrence]] };\n'
    + '// names: type|name -> document ids, for copies that do not record where they came from.\n'
    + '// relink: a5e\'s own links that lead nowhere -> the document of that name a5e has (\'\' = none).\n'
    + `export const SITE_TEXT = ${JSON.stringify(data)};\n`);
  fs.writeFileSync(path.join(DESC, 'site-text-report.json'), JSON.stringify(report, null, 1));
  const size = fs.statSync(out).size;
  console.log(`${report.pairs} entries paired; ${Object.keys(entries).length} get something (${(size / 1024).toFixed(0)} KB)`);
  console.log('links:', report.links);
  console.log('unresolved links:', report.unresolved);
  console.log(`blocks added to ${report.adds.length} entries; reworded paragraphs reported: ${report.reworded.length}`);
  for (const [l, n] of Object.entries(report.unpaired)) if (n.length) console.log(`not paired in ${l}: ${n.length}`);
})();
