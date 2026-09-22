// Step 4c: the converted heritages and cultures, against a5e's own keys and packs.
//   node tools/import/check-origins.mjs
import { createRequire } from 'module';
import path from 'path';
import fs from 'fs';
const require = createRequire(import.meta.url);
const P = require('./lib/paths.cjs');
const M = require('./lib/match.cjs');
const K = JSON.parse(fs.readFileSync(P.KEYS, 'utf8'));
const read = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const OUT = path.join(P.MODULE, 'scripts', 'data', 'imported');
const ORIGINS = read(path.join(OUT, 'a5etools-origins.json'));
const OTHER = ['a5etools-archetypes.json', 'a5etools-content.json'].flatMap((f) => read(path.join(OUT, f)));

const results = [];
const check = (n, ok, d = '') => results.push(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`);
const bad = (l, f) => l.filter(f);
const names = (l) => l.slice(0, 5).map((d) => d.name).join(', ');

const heritages = ORIGINS.filter((d) => d.type === 'heritage');
const cultures = ORIGINS.filter((d) => d.type === 'culture');
const feats = ORIGINS.filter((d) => d.type === 'feature');
const byId = new Map(ORIGINS.map((d) => [d._id, d]));
const G = (d, kind) => Object.values(d.system.grants).filter((g) => (g.traits?.traitType ?? g.grantType) === kind);
const label = (d, l) => Object.values(d.system.grants).find((g) => g.label === l);

/* A. the documents */
{
  check('20 heritages and 33 cultures, with their traits, gifts and paragon gifts',
    heritages.length === 20 && cultures.length === 33 && feats.length === ORIGINS.length - 53,
    `${heritages.length}/${cultures.length}/${feats.length}`);
  const ids = [...ORIGINS, ...OTHER].map((d) => d._id);
  check('every id is 16 letters and digits and unique across the pack', ids.every((i) => /^[A-Za-z0-9]{16}$/.test(i)) && new Set(ids).size === ids.length);
  const known = new Set([...ORIGINS, ...OTHER].map((d) => d._id));
  const links = ORIGINS.flatMap((d) => Object.values(d.system.grants).flatMap((g) => [...(g.features?.base ?? []), ...(g.features?.options ?? [])].map((e) => e.uuid)));
  check("every trait, gift and paragon gift a heritage or culture grants exists", links.length > 250 && links.every((u) => known.has(u.split('.').pop())), `${links.length} links`);
  const missing = [...new Set(ORIGINS.map((d) => d.img))].filter((i) => !fs.existsSync(P.PUBLIC + i));
  check('every icon is one of Foundry\'s', !missing.length, missing.slice(0, 3).join(', '));
  const leaks = bad(ORIGINS, (d) => /<(span|font|div|img|a)\b|style=|class=|&nbsp;|⟦L/.test(d.system.description));
  check('no page markup left in the text', !leaks.length, names(leaks));
  const short = bad(ORIGINS, (d) => d.system.description.replace(/<[^>]+>/g, '').trim().length < 20);
  check('every document has its text', !short.length, names(short));
  const hIdx = M.index(read(path.join(P.PACKS, 'heritages.json')).map((d) => d.name));
  const cIdx = M.index(read(path.join(P.PACKS, 'cultures.json')).map((d) => d.name));
  const dup = [...bad(heritages, (d) => hIdx.has(d.name)), ...bad(cultures, (d) => cIdx.has(d.name))];
  check('none of them is already in a5e\'s packs', !dup.length, names(dup));
  check('features are a5e\'s heritage, culture and paragon kinds', feats.every((d) => ['heritage', 'culture', 'paragon'].includes(d.system.featureType)));
  const srcOk = /^(adventurersGuide|voidrunnersCodex|adventuresInZeitgeist|dungeonDelversGuide|toSaveAKingdom|gpg\d+|a5eMancer\w+)$/;
  check('sources are product keys a5e or the module knows', ORIGINS.every((d) => srcOk.test(d.system.source)), names(bad(ORIGINS, (d) => !srcOk.test(d.system.source))));
}

/* B. heritages */
{
  const sizes = new Set(['tiny', 'sm', 'med', 'lg', 'huge', 'grg']);
  check('each heritage has a speed, a creature type a5e knows, and a size where the page gives one',
    heritages.every((d) => G(d, 'movement').length === 1 && G(d, 'creatureTypes')[0]?.traits.base.every((c) => Object.hasOwn(K.creatureTypes, c))
      && G(d, 'size').every((g) => [...g.traits.base, ...g.traits.options].every((s) => sizes.has(s)))),
    `${heritages.filter((d) => G(d, 'size').length).length}/20 with a size`);
  const gifts = heritages.filter((d) => label(d, 'Gifts'));
  check('gifts are one to choose, paragon gifts one at 10th level and optional',
    gifts.every((d) => label(d, 'Gifts').features.total === 1 && label(d, 'Gifts').features.options.length >= 2)
      && heritages.filter((d) => label(d, 'Paragon Gifts')).every((d) => { const g = label(d, 'Paragon Gifts'); return g.level === 10 && g.optional && g.features.total === 1; }),
    `${gifts.length} with gifts, ${heritages.filter((d) => label(d, 'Paragon Gifts')).length} with paragon gifts`);
  const bf = heritages.find((d) => d.name === 'Birdfolk');
  check('Birdfolk: Medium, 30 feet, two traits, the gifts of the page and its two variants, six paragon gifts',
    G(bf, 'size')[0].traits.base[0] === 'med' && G(bf, 'movement')[0].bonus === '30' && label(bf, 'Traits').features.base.length === 2
      && label(bf, 'Gifts').features.options.length === 7 && label(bf, 'Paragon Gifts').features.options.length === 6,
    `${label(bf, 'Gifts').features.options.length} gifts`);
  const dre = heritages.find((d) => d.name === 'Dreamborn');
  check('Dreamborn: fey, and "usually Medium or Small" is a size to pick', G(dre, 'creatureTypes')[0].traits.base.join() === 'fey'
    && G(dre, 'size')[0].traits.options.sort().join() === 'med,sm' && G(dre, 'size')[0].traits.total === 1);
  const ox = heritages.find((d) => d.name === 'Oxfolk');
  check('Oxfolk: the page names no size category, so none is invented', !G(ox, 'size').length && /7 and 8 feet/.test(ox.system.description));
  const traitNames = label(bf, 'Traits').features.base.map((e) => byId.get(e.uuid.split('.').pop()).name);
  check('a trait is a document named for its heritage, as a5e names them', traitNames.join(' | ') === 'Avian Senses (Birdfolk) | Wind Rider (Birdfolk)', traitNames.join(' | '));
  check('"Suggested Cultures" is lore, not a gift', !feats.some((d) => /^suggested/i.test(d.name)));
  check('a trait\'s own grants are read: the Birdfolk\'s Avian Senses is an expertise die',
    Object.values(byId.get(label(bf, 'Traits').features.base[0].uuid.split('.').pop()).system.grants).some((g) => g.grantType === 'expertiseDice'));
}

/* C. cultures */
{
  const langs = cultures.map((d) => G(d, 'languages')[0]).filter(Boolean);
  check('every culture has its languages, in a5e\'s keys', langs.length === cultures.length
    && langs.every((g) => [...g.traits.base, ...g.traits.options].every((k) => Object.hasOwn(K.languages, k))), `${langs.length}/${cultures.length}`);
  check('every culture has its traits as documents', cultures.every((d) => label(d, 'Traits')?.features.base.length >= 2));
  const bm = cultures.find((d) => d.name === 'Bloodmarked');
  const bl = G(bm, 'languages')[0].traits;
  check('Bloodmarked: Common and Gnoll known, one more of four named', bl.base.sort().join() === 'common,gnoll' && bl.total === 1 && bl.options.length === 4, JSON.stringify(bl).slice(0, 120));
  const ac = cultures.find((d) => d.name === 'Airship Crew');
  const sky = label(ac, 'Traits').features.base.map((e) => byId.get(e.uuid.split('.').pop())).find((d) => d.name === 'Skysailor');
  check('Airship Crew: Skysailor gives air vehicles and tinker\'s tools',
    Object.values(sky.system.grants).some((g) => g.proficiencyType === 'tool' && g.keys.base.includes('airVehicles') && g.keys.base.includes('tinkersTools')));
}

console.log(results.join('\n'));
const fails = results.filter((x) => x.startsWith('FAIL')).length;
console.log(`\n${results.length - fails}/${results.length} passed`);
process.exit(fails ? 1 : 0);
