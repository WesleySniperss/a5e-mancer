// Step 2c: the heritages and cultures a5e.tools has and a5e's packs lack.
//   node tools/import/fetch-origins.cjs [--refresh]
//
// These are not one of a5e.tools' list views but two rules pages, each a table
// of a name and where it is from, so they are read from there.
const fs = require('fs'), path = require('path');
const P = require('./lib/paths.cjs');
const L = require('./lib/lists.cjs');
const M = require('./lib/match.cjs');
const refresh = process.argv.includes('--refresh');

const INDEXES = { heritages: 'rules/heritages', cultures: 'rules/cultures-0' };
const clean = (s) => s.replace(/<[^>]+>/g, ' ').replace(/&#039;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

(async () => {
  const want = {};
  for (const [kind, page] of Object.entries(INDEXES)) {
    const file = path.join(P.CACHE, `rules-${kind}.html`);
    if (refresh || !fs.existsSync(file)) { fs.writeFileSync(file, await L.get(`https://a5e.tools/${page}`)); await new Promise((ok) => setTimeout(ok, 350)); }
    const html = fs.readFileSync(file, 'utf8');
    const article = html.slice(html.indexOf('<article'), html.indexOf('</article>'));
    const body = article.slice(article.indexOf('<tbody'), article.indexOf('</tbody>'));
    const rows = body.split('<tr').slice(1).map((r) => {
      const tds = [...r.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1]);
      const link = (tds[0] || '').match(/href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
      if (!link) return null;
      return { url: link[1].replace(/^https:\/\/a5e\.tools/, ''), name: clean(link[2]), blurb: clean(tds[1] ?? ''), src: clean(tds[2] ?? tds[1] ?? '') };
    }).filter(Boolean);
    const idx = M.index(JSON.parse(fs.readFileSync(path.join(P.PACKS, `${kind}.json`), 'utf8')).map((d) => d.name));
    want[kind] = rows.filter((r) => !idx.has(r.name));
    console.log(`${kind}: ${rows.length} listed, ${want[kind].length} to convert`);
  }
  fs.writeFileSync(path.join(P.CACHE, 'origins-want.json'), JSON.stringify(want, null, 1));
  let n = 0;
  for (const [kind, rows] of Object.entries(want)) {
    const dir = path.join(P.CACHE, 'pages', kind);
    fs.mkdirSync(dir, { recursive: true });
    for (const r of rows) {
      const f = path.join(dir, r.url.replace(/^\//, '').replace(/\//g, '_') + '.html');
      if (!refresh && fs.existsSync(f) && fs.statSync(f).size > 10000) continue;
      fs.writeFileSync(f, await L.get('https://a5e.tools' + r.url));
      n++;
      await new Promise((ok) => setTimeout(ok, 350));
    }
  }
  console.log(`fetched ${n} pages`);
})().catch((err) => { console.error(err); process.exit(1); });
