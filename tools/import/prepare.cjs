// Step 1: what the converter needs to know about a5e, read from the local install.
//   node tools/import/prepare.cjs
//
// - a5e's packs (spells, maneuvers, classes, archetypes, class features) as JSON,
//   read with Foundry's own classic-level from a copy of each pack (Foundry
//   holds a lock on the originals while it runs);
// - the archetypes in the world's packs too, so the list of what is missing
//   counts what the world already has (Plutonium imports, earlier builds);
// - CONFIG.A5E's maps (skills, tools, languages, specialties, traditions...),
//   out of the source map a5e ships, so grants use the system's own keys;
// - per class, the level its archetypes start at and their spellcasting block.
const fs = require('fs'), path = require('path');
const P = require('./lib/paths.cjs');
const { ClassicLevel } = require(P.CLASSIC_LEVEL);

async function readPack(dir) {
  const copy = path.join(P.CACHE, 'packcopy', path.basename(path.dirname(path.dirname(dir))) + '-' + path.basename(dir));
  fs.rmSync(copy, { recursive: true, force: true });
  fs.mkdirSync(copy, { recursive: true });
  for (const f of fs.readdirSync(dir)) if (f !== 'LOCK') { try { fs.copyFileSync(path.join(dir, f), path.join(copy, f)); } catch {} }
  const db = new ClassicLevel(copy, { valueEncoding: 'json' });
  const docs = [];
  for await (const [k, v] of db.iterator()) if (/^!items![^.!]+$/.test(k)) docs.push(v);
  await db.close();
  return docs;
}

(async () => {
  fs.mkdirSync(P.PACKS, { recursive: true });
  for (const name of ['spells', 'maneuvers', 'classes', 'archetypes', 'classFeatures', 'adventuringGear', 'feats', 'backgrounds', 'backgroundFeatures', 'destinies', 'destinyFeatures', 'heritages', 'heritageFeatures', 'cultures', 'cultureFeatures', 'monsters']) {
    const docs = await readPack(path.join(P.SYSTEM, 'packs', name));
    fs.writeFileSync(path.join(P.PACKS, `${name}.json`), JSON.stringify(docs));
    console.log(`a5e ${name}: ${docs.length}`);
  }
  // archetypes a world already has, from any of its Item packs
  const worldArchetypes = [];
  for (const world of fs.existsSync(P.WORLDS) ? fs.readdirSync(P.WORLDS) : []) {
    const packs = path.join(P.WORLDS, world, 'packs');
    if (!fs.existsSync(packs)) continue;
    for (const p of fs.readdirSync(packs)) {
      if (p === 'a5e-mancer-imported') continue;          // our own output is not "already there"
      try {
        const docs = await readPack(path.join(packs, p));
        for (const d of docs) if (d.type === 'archetype') worldArchetypes.push({ name: d.name, cls: d.system?.class ?? '', src: d.system?.source ?? '', pack: `${world}/${p}` });
      } catch {}
    }
  }
  fs.writeFileSync(path.join(P.PACKS, 'worldArchetypes.json'), JSON.stringify(worldArchetypes));
  console.log(`world archetypes: ${worldArchetypes.length}`);

  // CONFIG.A5E maps, from a5e's shipped source map
  const map = JSON.parse(fs.readFileSync(path.join(P.SYSTEM, 'a5e.js.map'), 'utf8'));
  const i = map.sources.indexOf('../src/config.ts');
  if (i < 0) throw new Error('a5e.js.map has no src/config.ts');
  const src = map.sourcesContent[i];
  const keys = {};
  for (const name of ['abilities', 'skills', 'tools', 'weapons', 'skillSpecialties', 'languages', 'maneuverTraditions', 'damageTypes', 'armor', 'senses', 'movement', 'spellSchools', 'objectTypes', 'itemRarity', 'currencyDenominations', 'abilityActivationTypes', 'psionicDisciplines', 'weaponProperties', 'timePeriods', 'healingTypes']) {
    const m = new RegExp('\\nconst ' + name + '(?::[^=]+)? = \\{').exec(src);
    if (!m) throw new Error(`config.ts: no ${name}`);
    let j = m.index + m[0].length - 1, depth = 0, k = j;
    for (; k < src.length; k++) { if (src[k] === '{') depth++; else if (src[k] === '}' && !--depth) break; }
    keys[name] = new Function('return ' + src.slice(j, k + 1).replace(/\bas const\b/g, ''))();
  }
  fs.writeFileSync(P.KEYS, JSON.stringify(keys, null, 1));
  console.log(`CONFIG.A5E maps: ${Object.keys(keys).join(', ')}`);

  // per class, from a5e's own archetypes
  const archetypes = JSON.parse(fs.readFileSync(path.join(P.PACKS, 'archetypes.json'), 'utf8'));
  const tally = {};
  for (const a of archetypes) {
    const c = a.system?.class; if (!c) continue;
    const lv = Math.min(...Object.values(a.system.grants || {}).filter((g) => g.grantType === 'feature').map((g) => Number(g.level) || 99));
    const t = tally[c] ??= { starts: {}, casting: {} };
    t.starts[lv] = (t.starts[lv] || 0) + 1;
    const key = JSON.stringify(a.system.spellcasting ?? null);
    t.casting[key] = (t.casting[key] || 0) + 1;
  }
  const top = (m) => Object.entries(m).sort((a, b) => b[1] - a[1])[0][0];
  const classinfo = Object.fromEntries(Object.entries(tally).map(([c, t]) => [c, { start: Number(top(t.starts)), spellcasting: JSON.parse(top(t.casting)) }]));
  fs.writeFileSync(P.CLASSINFO, JSON.stringify(classinfo, null, 1));
  console.log(`classes: ${Object.keys(classinfo).length}`);
  fs.rmSync(path.join(P.CACHE, 'packcopy'), { recursive: true, force: true });
})().catch((err) => { console.error(err); process.exit(1); });
