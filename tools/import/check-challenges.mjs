// Step 4e: the converted exploration challenges, as journal entries.
//   node tools/import/check-challenges.mjs
import { createRequire } from 'module';
import path from 'path';
import fs from 'fs';
const require = createRequire(import.meta.url);
const P = require('./lib/paths.cjs');
const read = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const OUT = path.join(P.MODULE, 'scripts', 'data', 'imported');
const CHALLENGES = read(path.join(OUT, 'a5etools-challenges.json'));
const OTHER = ['a5etools-archetypes.json', 'a5etools-content.json', 'a5etools-origins.json', 'a5etools-monsters.json'].flatMap((f) => read(path.join(OUT, f)));
const WANT = read(path.join(P.CACHE, 'challenges-want.json'));

const results = [];
const check = (n, ok, d = '') => results.push(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`);
const bad = (l, f) => l.filter(f);
const names = (l) => l.slice(0, 5).map((d) => d.name).join(', ');
const one = (n) => CHALLENGES.find((c) => c.name === n);
const flags = (c) => c.flags['a5e-mancer'];
const text = (c) => c.pages[0].text.content;
const plain = (c) => text(c).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

/* A. the documents */
{
  check('314 exploration challenges, each a journal entry of one text page',
    CHALLENGES.length === 314 && CHALLENGES.every((c) => c.name && c.pages.length === 1 && c.pages[0].type === 'text' && c.pages[0].text.format === 1),
    `${CHALLENGES.length}`);
  const ids = [...CHALLENGES.map((c) => c._id), ...CHALLENGES.flatMap((c) => c.pages.map((p) => p._id)), ...OTHER.map((d) => d._id)];
  check('every id is 16 letters and digits and unique across the pack, pages included',
    CHALLENGES.every((c) => /^[A-Za-z0-9]{16}$/.test(c._id) && c.pages.every((p) => /^[A-Za-z0-9]{16}$/.test(p._id))) && new Set(ids).size === ids.length);
  check('every one is the page a5e.tools lists, by name', CHALLENGES.length === WANT.length
    && CHALLENGES.every((c, i) => c.name === WANT[i].name && flags(c).url === `https://a5e.tools${WANT[i].url}`));
  const short = bad(CHALLENGES, (c) => plain(c).length < 200);
  check('every challenge has its text', !short.length, names(short));
  const leaks = bad(CHALLENGES, (c) => /<(span|font|div|img)\b|style=|class=|&nbsp;|⟦L/.test(text(c)));
  check('no page markup left in the text', !leaks.length, names(leaks));
  const dup = CHALLENGES.map((c) => c.name).filter((n, i, all) => all.indexOf(n) !== i);
  check('no name twice', !dup.length, dup.slice(0, 3).join(', '));
  const srcOk = /^(adventurersGuide|voidrunnersCodex|trialsAndTreasures|adventuresInZeitgeist|dungeonDelversGuide|toSaveAKingdom|gpg\d+|a5eMancer\w+)$/;
  check('sources are product keys a5e or the module knows', CHALLENGES.every((c) => srcOk.test(flags(c).source ?? flags(c).challenge.source)),
    [...new Set(CHALLENGES.map((c) => flags(c).challenge.source))].join(', '));
  const spellIds = new Set(read(path.join(P.PACKS, 'spells.json')).map((s) => s._id));
  const links = CHALLENGES.flatMap((c) => [...text(c).matchAll(/@UUID\[([^\]]+)\]/g)].map((m) => m[1]));
  check('the spells the text names are links into a5e\'s spells', links.length > 200 && links.every((u) => spellIds.has(u.split('.').pop())),
    `${links.length} links`);
}

/* B. what they are filed and searched by */
{
  const kinds = new Set(['Traps', 'Terrain', 'Supernatural', 'Weather', 'Circumstance', 'Creatures', 'Technological', 'Urban', 'Constructed']);
  const areas = new Set(['Immediate', 'Local', 'Intermediate', 'Greater', 'Region']);
  check('each is filed under the kind a5e.tools gives it', CHALLENGES.every((c) => kinds.has(flags(c).folder) && flags(c).folder === flags(c).challenge.kind),
    [...new Set(CHALLENGES.map((c) => flags(c).folder))].sort().join(', '));
  check('the tier, the challenge rating, the area and the regions are kept, so a journal can be picked out by them',
    CHALLENGES.every((c) => { const q = flags(c).challenge; return q.tier >= 0 && q.tier <= 4 && q.cr >= 0 && areas.has(q.area) && q.regions.length >= 1; }),
    `tiers ${[...new Set(CHALLENGES.map((c) => flags(c).challenge.tier))].sort().join('')}, CR up to ${Math.max(...CHALLENGES.map((c) => flags(c).challenge.cr))}`);
  // the page writes a rating as "1/2" where the flag holds 0.5
  const rating = (s) => (/^\d+\/\d+$/.test(s) ? Number(s.split('/')[0]) / Number(s.split('/')[1]) : Number(s));
  check('and written at the top of the page as the site writes them',
    CHALLENGES.every((c) => {
      const q = flags(c).challenge;
      const head = (/^<p><strong>([^<]*)<\/strong><\/p>/.exec(text(c)) ?? [])[1]?.split(' &middot; ') ?? [];
      return head[0] === q.kind && head[1] === `Tier ${q.tier}` && rating(head[2].replace('CR ', '')) === q.cr && head[3] === q.area;
    }), text(CHALLENGES[0]).slice(0, 70));
  check('description and solutions are kept apart, under their own headings',
    CHALLENGES.every((c) => /<h2>Description<\/h2>/.test(text(c))) && CHALLENGES.filter((c) => /<h2>Possible Solutions<\/h2>/.test(text(c))).length > 300,
    `${CHALLENGES.filter((c) => /<h2>Possible Solutions<\/h2>/.test(text(c))).length} with solutions`);
  const folders = [...new Set(CHALLENGES.map((c) => flags(c).folder))];
  const { ImportedPack } = await import(new URL(`file://${path.join(P.MODULE, 'scripts', 'utils', 'importedPack.js').replace(/\\/g, '/')}`).href)
    .catch(() => ({ ImportedPack: null }));
  check('the pack knows the order to put those folders in',
    !ImportedPack || folders.every((f) => ImportedPack.FOLDER_ORDER.JournalEntry.includes(f)),
    ImportedPack ? ImportedPack.FOLDER_ORDER.JournalEntry.join(', ') : 'importedPack.js needs Foundry to load');
}

/* C. close reads */
{
  const t = one('Acid Bucket Trap');
  check('Acid Bucket Trap: a trap of tier 0 and CR 1, met in four regions, with mage hand linked in its solutions',
    flags(t).challenge.kind === 'Traps' && flags(t).challenge.tier === 0 && flags(t).challenge.cr === 1
    && flags(t).challenge.regions.length === 4 && /mage hand/.test(text(t)) && /<h2>Possible Solutions<\/h2>/.test(text(t)),
    flags(t).challenge.regions.join(', '));
  const f = one('Acid Field');
  check('Acid Field: the lead-ins the page writes as styled spans are bold again, with their spacing',
    /<strong><em>Acidic Spray\.<\/em><\/strong> Every half hour/.test(text(f)) && /<strong><em>Nature\.<\/em><\/strong> A Nature check/.test(text(f)),
    (text(f).match(/<strong>.{0,40}/g) ?? []).slice(1, 3).join(' | '));
  const glued = bad(CHALLENGES, (c) => /<\/(strong|em)>[A-Z(]/.test(text(c)));
  check('an emphasis closed against the next sentence does not swallow the space', !glued.length, names(glued));
  const solutions = bad(CHALLENGES, (c) => />\s*Potential Outcomes\s*</.test(text(c)) && !/<h3>Potential Outcomes<\/h3>/.test(text(c)));
  check('"Potential Outcomes" stays the heading it is on the page', !solutions.length, names(solutions));
}

console.log(results.join('\n'));
const fails = results.filter((x) => x.startsWith('FAIL')).length;
console.log(`\n${results.length - fails}/${results.length} passed`);
process.exit(fails ? 1 : 0);
