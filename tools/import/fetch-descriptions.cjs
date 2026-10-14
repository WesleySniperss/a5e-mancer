// Every a5e.tools page whose text a5e's own packs also carry, for compare-descriptions.cjs:
// spells, magic items, mundane equipment, weapons, combat maneuvers, feats, backgrounds, destinies.
// Pages are cached in .cache/pages/<list>/ (as fetch-content.cjs caches them); only missing ones
// are fetched, half a second apart. Then each page's text fields are pulled out into
// .cache/descriptions/<list>.json: { name, url, body, higher, rare, fields, links: [{ href, text }] }.
// body is the entry's own text, which is a different field per list (a magic item's is
// field-mi-description, a feat's field-feat-details); fields is every text field of the entry,
// in page order, as [name, label, html] - a background's connections and mementos, a destiny's
// features. Only the page's <article> is read: the sidebar repeats field--name-body blocks.
// The texts link other pages by node number as often as by name (/node/1790 is the skeleton's stat
// block), so every /node/ page linked from any list is fetched too, and what it is goes into
// .cache/descriptions/nodes.json: { "/node/1790": { title, type, canonical } }.
//
//   node tools/import/fetch-descriptions.cjs [list ...]
const fs = require('fs'), path = require('path');
const P = require('./lib/paths.cjs');
const L = require('./lib/lists.cjs');

const ALL = ['spells', 'magic-items', 'mundane-equipment', 'weapons', 'combat-maneuvers', 'feats', 'backgrounds', 'destinies',
  'classes', 'archetypes', 'heritages', 'cultures'];
const LISTS = process.argv.slice(2).length ? process.argv.slice(2) : ALL;
const PAUSE = 500;

/* Lists that are not one of the site's list views. Archetypes: its archetype
   view (fetch-archetypes.cjs keeps it). Heritages and cultures: a table on a
   rules page each (fetch-origins.cjs). Classes: /rules/<class>, tried by a5e's
   class names (/classes/<class> is only a list of its archetypes); a page that
   is not there is remembered as such. */
const read = (f) => fs.readFileSync(path.join(P.CACHE, f), 'utf8');
function rulesRows(file) {
  const html = read(file);
  const article = html.slice(html.indexOf('<article'), html.indexOf('</article>'));
  return article.slice(article.indexOf('<tbody'), article.indexOf('</tbody>')).split('<tr').slice(1).map((r) => {
    const link = r.match(/<td[^>]*>[\s\S]*?href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    return link ? { url: local(link[1]), name: L.txt(link[2]) } : null;
  }).filter(Boolean);
}
const SOURCES = {
  archetypes: () => L.rowsOf(read('archetypes-list.html')).map(r => ({ url: r.url, name: r.name, cls: r['archetype-class'] })),
  heritages: () => rulesRows('rules-heritages.html'),
  cultures: () => rulesRows('rules-cultures.html'),
  classes: () => {
    const rows = new Map();
    for (const c of JSON.parse(read(path.join('packs', 'classes.json')))) {
      const name = c.name.replace(/\s*\(.*\)\s*/, '');
      const url = `/rules/${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
      if (!rows.has(url)) rows.set(url, { url, name, guess: true });
    }
    return [...rows.values()];
  },
};

const fileOf = (list, url) => path.join(P.CACHE, 'pages', list, url.replace(/^\//, '').replace(/\//g, '_') + '.html');
/** A link as a path on the site: some texts write the whole address. */
const local = (href) => href.replace(/^https?:\/\/a5e\.tools/, '');

/** The field holding each list's own text; body where not named. */
const BODY = { 'magic-items': 'field-mi-description', feats: 'field-feat-details' };

/** The inner HTML of the first element carrying `field--name-<name>`, its label left out. */
function field(html, name) {
  const at = html.indexOf(`field--name-${name} `) >= 0 ? html.indexOf(`field--name-${name} `) : html.indexOf(`field--name-${name}"`);
  if (at < 0) return '';
  const open = html.lastIndexOf('<div', at);
  let depth = 0, i = open;
  const re = /<\/?div\b[^>]*>/g;
  re.lastIndex = open;
  let m;
  while ((m = re.exec(html))) {
    if (m[0].startsWith('</')) { depth--; if (depth === 0) { i = m.index; break; } }
    else depth++;
  }
  const inner = html.slice(html.indexOf('>', open) + 1, i);
  return inner.replace(/<div class="field--label">[\s\S]*?<\/div>/, '').trim();
}

/** Every text field of an entry, in page order: [name, label, html]. */
function fieldsOf(article) {
  const out = [];
  for (const m of article.matchAll(/class="[^"]*field--name-([a-z0-9_-]+) field--type-(text[a-z_-]*|string)[^"]*"/g)) {
    const html = field(article, m[1]);
    const label = L.txt((article.slice(m.index, m.index + 600).match(/<div class="field--label">([\s\S]*?)<\/div>/) || [])[1] ?? '');
    if (L.txt(html)) out.push([m[1], label, html]);
  }
  return out;
}

function linksOf(html) {
  return [...html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)]
    .map(m => ({ href: local(m[1]), text: L.txt(m[2]) }))
    .filter(l => l.href.startsWith('/') && l.text);
}

(async () => {
  fs.mkdirSync(path.join(P.CACHE, 'descriptions'), { recursive: true });
  for (const list of LISTS) {
    const rows = SOURCES[list] ? SOURCES[list]() : await L.fetchList(list);
    fs.mkdirSync(path.join(P.CACHE, 'pages', list), { recursive: true });
    let fetched = 0, failed = 0;
    const out = [];
    for (const row of rows) {
      const f = fileOf(list, row.url);
      if (!fs.existsSync(f)) {
        try {
          fs.writeFileSync(f, await L.get('https://a5e.tools' + row.url));
          fetched++;
          await new Promise(ok => setTimeout(ok, PAUSE));
        } catch (err) {
          // a guessed class page that is not there: remembered, not asked again
          if (row.guess && /: 404$/.test(err.message)) { fs.writeFileSync(f, ''); continue; }
          failed++; console.log(`  ${row.url}: ${err.message}`); continue;
        }
      }
      if (!fs.statSync(f).size) continue;
      const page = fs.readFileSync(f, 'utf8').replace(/<!--[\s\S]*?-->/g, '');
      const html = page.slice(page.indexOf('<article'), page.indexOf('</article>'));
      const body = field(html, BODY[list] ?? 'body');
      const higher = field(html, 'field-spellcast-at-higher-levels');
      const rare = field(html, 'field-spell-rare-versions');
      const fields = fieldsOf(html);
      out.push({ name: row.name, url: row.url, ...(row.cls ? { cls: row.cls } : {}), body, higher, rare, fields, links: linksOf(fields.map(x => x[2]).join(' ')) });
    }
    fs.writeFileSync(path.join(P.CACHE, 'descriptions', `${list}.json`), JSON.stringify(out, null, 1));
    console.log(`${list}: ${rows.length} rows, ${fetched} fetched, ${failed} failed, ${out.filter(o => o.body).length} with a text`);
  }

  // Every /node/ page any list links to, from every list's output (not only the ones run now).
  const dir = path.join(P.CACHE, 'descriptions');
  const hrefs = new Set();
  for (const f of ALL.map(l => `${l}.json`).filter(f => fs.existsSync(path.join(dir, f)))) {
    for (const r of JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))) {
      for (const l of r.links) { const h = local(l.href); if (/^\/node\/\d+$/.test(h)) hrefs.add(h); }
    }
  }
  fs.mkdirSync(path.join(P.CACHE, 'pages', 'nodes'), { recursive: true });
  const nodes = {};
  let fetched = 0;
  for (const h of [...hrefs].sort()) {
    const f = fileOf('nodes', h);
    if (!fs.existsSync(f)) {
      try { fs.writeFileSync(f, await L.get('https://a5e.tools' + h)); fetched++; await new Promise(ok => setTimeout(ok, PAUSE)); }
      catch (err) { console.log(`  ${h}: ${err.message}`); continue; }
    }
    const html = fs.readFileSync(f, 'utf8');
    nodes[h] = {
      title: L.txt((html.match(/<title>([^<|]*)/) || [])[1] ?? ''),
      type: (html.match(/<body[^>]*class="[^"]*node-type-([a-z_-]+)/) || [])[1] ?? '',
      canonical: local((html.match(/rel="canonical" href="([^"]+)"/) || [])[1] ?? ''),
    };
  }
  fs.writeFileSync(path.join(dir, 'nodes.json'), JSON.stringify(nodes, null, 1));
  console.log(`nodes: ${hrefs.size} linked, ${fetched} fetched`);
})();
