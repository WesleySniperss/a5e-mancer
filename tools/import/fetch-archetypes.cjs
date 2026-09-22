// Step 2: which a5e.tools archetypes a5e's packs and the world lack, and their pages.
//   node tools/import/fetch-archetypes.cjs [--refresh]
//
// An archetype counts as present when a pack has one of the same name for the
// same class. Same name for another class is not the same archetype (a5e's
// Mentalist is an adept, a5e.tools' a bard), and a5e's Soulknife names no class
// at all, so no class can take it. Two are left out on purpose:
//   Dread Knight - written by hand in scripts/data/imported/dreadKnight.js;
//   Tailor       - a5e's packs have it (Out of the Wilds), the same text.
// Pages are fetched once, a moment apart, and kept in the cache; --refresh
// fetches them again.
const fs = require('fs'), path = require('path');
const P = require('./lib/paths.cjs');
const SKIP = new Set(['Dread Knight', 'Tailor']);
const refresh = process.argv.includes('--refresh');

const txt = (s) => s.replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#039;/g, "'").replace(/\s+/g, ' ').trim();
const norm = (s) => s.toLowerCase().replace(/\s*\(.*\)/, '').replace(/[^a-z]/g, '');
const get = async (url) => {
  const res = await fetch(url, { headers: { 'User-Agent': 'a5e-mancer importer (github.com/WesleySniperss/a5e-mancer)' } });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.text();
};

(async () => {
  fs.mkdirSync(P.PAGES, { recursive: true });
  const listFile = path.join(P.CACHE, 'archetypes-list.html');
  if (refresh || !fs.existsSync(listFile)) fs.writeFileSync(listFile, await get('https://a5e.tools/archetypes'));
  const h = fs.readFileSync(listFile, 'utf8');
  const body = h.slice(h.indexOf('<tbody'), h.indexOf('</tbody>'));
  const rows = body.split('<tr').slice(1).map((r) => {
    const td = (k) => { const m = r.match(new RegExp('views-field-' + k + '"[^>]*>([\\s\\S]*?)</td>')); return m ? m[1] : ''; };
    const t = td('title');
    return { url: (t.match(/href="([^"]+)"/) || [])[1], name: txt(t), cls: txt(td('field-archetype-class')), blurb: txt(td('body')), src: txt(td('field-archetype-source')) };
  }).filter((r) => r.url);

  const have = [...JSON.parse(fs.readFileSync(path.join(P.PACKS, 'archetypes.json'), 'utf8')).map((a) => ({ name: a.name, cls: a.system?.class ?? '' })),
                ...JSON.parse(fs.readFileSync(path.join(P.PACKS, 'worldArchetypes.json'), 'utf8'))];
  const want = rows.filter((r) => !SKIP.has(r.name) && !have.some((a) => norm(a.name) === norm(r.name) && norm(a.cls) === norm(r.cls)));
  fs.writeFileSync(P.WANT, JSON.stringify(want, null, 1));
  console.log(`${rows.length} archetypes on a5e.tools; ${want.length} to convert`);

  let n = 0;
  for (const r of want) {
    const file = path.join(P.PAGES, r.url.split('/').pop() + '.html');
    if (!refresh && fs.existsSync(file) && fs.statSync(file).size > 10000) continue;
    fs.writeFileSync(file, await get('https://a5e.tools' + r.url));
    n++;
    await new Promise((ok) => setTimeout(ok, 400));
  }
  console.log(`fetched ${n} pages`);
})().catch((err) => { console.error(err); process.exit(1); });
