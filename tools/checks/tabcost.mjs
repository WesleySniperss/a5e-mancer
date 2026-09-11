/* What one tab costs, measured warm and with the panels actually removed.
 *
 * Two earlier attempts at this were wrong, in different ways, and both are
 * worth naming because the first produced a number I nearly acted on:
 *
 *   1. It timed the whole sheet FIRST, cold, and got 14.8 ms. A later script
 *      that had already run seventeen templates got 4.2 ms for the same thing.
 *      The difference was V8 warming up on the Handlebars runtime, and the
 *      conclusion drawn from it — "the chrome costs 11 of the 15 ms" — was pure
 *      artifact.
 *   2. It built the stripped template with string .replace() against a source
 *      that has CRLF line endings, using text that had been split and rejoined
 *      with LF. Nothing matched, nothing was stripped, and "the chrome" was
 *      measured as the entire sheet.
 */
import Handlebars from 'handlebars';
import { readFileSync } from 'fs';
import { buildSheet, R } from './lib/sheetdom.mjs';

const src = readFileSync(R + 'templates/sheet/tidy-character-sheet.hbs', 'utf8');
const lines = src.split(/\r?\n/);

const tabs = [];
for (let i = 0; i < lines.length; i++) {
  const m = lines[i].match(/^(\s*)<div class="tab tidy-tab (\w[\w-]*)/);
  if (!m) continue;
  const [, indent, name] = m;
  const close = `${indent}</div>`;
  let j = i + 1;
  while (j < lines.length && lines[j] !== close) j++;
  tabs.push({ name, from: i, to: j });
  i = j;
}

/* Every line that belongs to some tab panel. */
const inTab = new Set();
for (const t of tabs) for (let i = t.from; i <= t.to; i++) inTab.add(i);
const chromeSrc = lines.filter((_, i) => !inTab.has(i)).join('\n');

const chars = JSON.parse(readFileSync(R + 'world-chars.json', 'utf8'));
const heavy = chars.map((c, n) => [n, c.items.length]).sort((a, b) => b[1] - a[1])[0][0];
const { sheet, character } = await buildSheet({ choose: (all) => all[heavy] });
const ctx = await sheet.getData();

const whole  = Handlebars.compile(lines.join('\n'));
const chrome = Handlebars.compile(chromeSrc);
const parts  = tabs.map(t => ({ name: t.name,
  fn: Handlebars.compile(lines.slice(t.from, t.to + 1).join('\n')) }));

for (let n = 0; n < 40; n++) { whole(ctx); chrome(ctx); for (const p of parts) p.fn(ctx); }
const median = (xs) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const time = (fn) => {
  const runs = [];
  for (let n = 0; n < 25; n++) { const t = performance.now(); fn(ctx); runs.push(performance.now() - t); }
  return median(runs);
};

const wholeMs = time(whole),  wholeKb  = whole(ctx).length / 1024;
const chromeMs = time(chrome), chromeKb = chrome(ctx).length / 1024;

console.log(`${character}, ${chars[heavy].items.length} items — the heaviest sheet in this world\n`);
console.log(`  ${'the whole sheet'.padEnd(28)} ${wholeMs.toFixed(2).padStart(6)} ms ${(wholeKb.toFixed(0) + ' kB').padStart(8)}`);
console.log(`  ${'header + sidebar + tab strip'.padEnd(28)} ${chromeMs.toFixed(2).padStart(6)} ms ${(chromeKb.toFixed(0) + ' kB').padStart(8)}`);
console.log(`  ${'all ten tab panels'.padEnd(28)} ${(wholeMs - chromeMs).toFixed(2).padStart(6)} ms ${((wholeKb - chromeKb).toFixed(0) + ' kB').padStart(8)}\n`);
console.log(`  ${'tab'.padEnd(28)} ${'build'.padStart(6)}    ${'markup'.padStart(8)}`);

const rows = parts.map(p => ({ name: p.name, ms: time(p.fn), kb: p.fn(ctx).length / 1024 }))
                  .sort((a, b) => b.ms - a.ms);
for (const r of rows)
  console.log(`  ${r.name.padEnd(28)} ${r.ms.toFixed(2).padStart(6)} ms ${(r.kb.toFixed(0) + ' kB').padStart(8)}`);

const heaviest = rows[0];
const light = rows.find(r => r.name === 'favorites') ?? rows[rows.length - 1];
console.log(`\n  today`);
console.log(`    a redraw                 ${wholeMs.toFixed(2)} ms, ${wholeKb.toFixed(0)} kB`);
console.log(`    switching a tab          free — Foundry toggles one class`);
console.log(`  if only the open tab were built`);
console.log(`    a redraw on ${light.name.padEnd(13)} ${(chromeMs + light.ms).toFixed(2)} ms, ${(chromeKb + light.kb).toFixed(0)} kB`);
console.log(`    a redraw on ${heaviest.name.padEnd(13)} ${(chromeMs + heaviest.ms).toFixed(2)} ms, ${(chromeKb + heaviest.kb).toFixed(0)} kB`);
console.log(`    switching to ${heaviest.name.padEnd(12)} ${(chromeMs + heaviest.ms).toFixed(2)} ms + a full DOM replace, where today it is free`);
