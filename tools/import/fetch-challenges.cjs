// Step 2e: a5e.tools' exploration challenges, and their pages.
//   node tools/import/fetch-challenges.cjs [--refresh]
//
// a5e ships none of these - it has no item type for them and its journals pack
// holds only reference - so there is nothing to compare against: the list is
// the want list.
const fs = require('fs'), path = require('path');
const P = require('./lib/paths.cjs');
const L = require('./lib/lists.cjs');
const refresh = process.argv.includes('--refresh');

(async () => {
  const rows = await L.fetchList('exploration-challenges', { refresh });
  const seen = new Set();
  const want = rows.filter((r) => (seen.has(r.url) ? false : seen.add(r.url)));
  fs.writeFileSync(path.join(P.CACHE, 'challenges-want.json'), JSON.stringify(want, null, 1));
  console.log(`${rows.length} exploration challenges listed, ${want.length} to convert`);
  const dir = path.join(P.CACHE, 'pages', 'challenges');
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
