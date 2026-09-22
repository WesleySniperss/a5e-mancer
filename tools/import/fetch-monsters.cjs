// Step 2d: the monsters a5e.tools has and a5e's packs lack, and their pages.
//   node tools/import/fetch-monsters.cjs [--refresh]
const fs = require('fs'), path = require('path');
const P = require('./lib/paths.cjs');
const L = require('./lib/lists.cjs');
const M = require('./lib/match.cjs');
const refresh = process.argv.includes('--refresh');

(async () => {
  const rows = await L.fetchList('monsters', { refresh });
  const have = JSON.parse(fs.readFileSync(path.join(P.PACKS, 'monsterIndex.json'), 'utf8'));
  const idx = M.index(have.map((m) => m.name));
  const seen = new Set();
  const want = rows.filter((r) => {
    if (idx.has(r.name) || seen.has(r.url)) return false;
    seen.add(r.url);
    return true;
  });
  fs.writeFileSync(path.join(P.CACHE, 'monsters-want.json'), JSON.stringify(want, null, 1));
  console.log(`${rows.length} monsters listed, ${want.length} to convert`);
  const dir = path.join(P.CACHE, 'pages', 'monsters');
  fs.mkdirSync(dir, { recursive: true });
  let n = 0;
  for (const r of want) {
    const f = path.join(dir, r.url.replace(/^\//, '').replace(/\//g, '_') + '.html');
    if (!refresh && fs.existsSync(f) && fs.statSync(f).size > 10000) continue;
    fs.writeFileSync(f, await L.get('https://a5e.tools' + r.url));
    n++;
    await new Promise((ok) => setTimeout(ok, 350));
  }
  console.log(`fetched ${n} pages`);
})().catch((err) => { console.error(err); process.exit(1); });
