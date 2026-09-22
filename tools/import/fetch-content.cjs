// Step 2b: what a5e.tools lists and a5e's packs lack - spells, psionic powers,
// magic items, weapons, mundane equipment, combat maneuvers, feats,
// backgrounds, destinies - and their pages.
//   node tools/import/fetch-content.cjs [--refresh]
//
// "Lacks" is decided by lib/match.cjs: names are compared in several spellings,
// and for gear a generic entry counts as present when a5e has it per variant
// ("Holy Avenger" / "Holy Avenger Longsword"). Mounts, pets, hirelings and
// services come too: as the entry a character buys, linked to the creature's
// stat block where a5e has one.
const fs = require('fs'), path = require('path');
const P = require('./lib/paths.cjs');
const L = require('./lib/lists.cjs');
const M = require('./lib/match.cjs');
const refresh = process.argv.includes('--refresh');

const LISTS = {
  spells:              { against: 'spells' },
  'psionic-powers':    { against: 'spells' },
  'magic-items':       { against: 'adventuringGear', subset: true },
  weapons:             { against: 'adventuringGear', subset: true },
  'mundane-equipment': { against: 'adventuringGear', subset: true },
  'combat-maneuvers':  { against: 'maneuvers' },
  feats:               { against: 'feats' },
  backgrounds:         { against: 'backgrounds' },
  destinies:           { against: 'destinies' }
};
const fileOf = (list, url) => path.join(P.CACHE, 'pages', list, url.replace(/^\//, '').replace(/\//g, '_') + '.html');

(async () => {
  const want = {};
  for (const [list, how] of Object.entries(LISTS)) {
    const rows = await L.fetchList(list, { refresh });
    const docs = JSON.parse(fs.readFileSync(path.join(P.PACKS, `${how.against}.json`), 'utf8'));
    const idx = M.index(docs.map((d) => d.name), { subset: !!how.subset });
    // a5e.tools lists some entries twice (two Camels, two Mastiffs); one each
    const seen = new Set();
    want[list] = rows.filter((r) => {
      if (idx.has(r.name) || how.skipTypes?.includes(r.type) || seen.has(r.url)) return false;
      seen.add(r.url);
      return true;
    });
    console.log(`${list}: ${rows.length} listed, ${want[list].length} to convert`);
  }
  fs.writeFileSync(path.join(P.CACHE, 'content-want.json'), JSON.stringify(want, null, 1));
  let n = 0;
  for (const [list, rows] of Object.entries(want)) {
    fs.mkdirSync(path.join(P.CACHE, 'pages', list), { recursive: true });
    for (const r of rows) {
      const f = fileOf(list, r.url);
      if (!refresh && fs.existsSync(f) && fs.statSync(f).size > 10000) continue;
      fs.writeFileSync(f, await L.get('https://a5e.tools' + r.url));
      n++;
      await new Promise((ok) => setTimeout(ok, 350));
    }
  }
  console.log(`fetched ${n} pages`);
})().catch((err) => { console.error(err); process.exit(1); });

module.exports = { fileOf };
