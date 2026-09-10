/* What one redraw of the sheet costs, on every character in the world.
 *
 * Trackers were reported as laggy — type a number, wait. Every write on this
 * sheet re-renders it, and a re-render is getData() plus the template. This
 * measures both, on real characters, so the number being argued about is a
 * measured one.
 *
 * It is not a browser: no layout, no paint, no Foundry. What it measures is the
 * part this module is responsible for, which is the part that can be fixed
 * here.
 */
import Handlebars from 'handlebars';
import { readFileSync } from 'fs';
import { buildSheet, R } from './lib/sheetdom.mjs';

const chars = JSON.parse(readFileSync(R + 'world-chars.json', 'utf8'));
const tpl = Handlebars.compile(readFileSync(R + 'templates/sheet/tidy-character-sheet.hbs', 'utf8'));

const rows = [];
for (let i = 0; i < chars.length; i++) {
  const { sheet, character } = await buildSheet({ choose: (all) => all[i] });

  /* Warm BOTH halves before timing either, and take the median of the runs
     rather than the mean.

     The first version warmed only getData, so whichever character happened to
     be measured first paid for compiling the template and reported three
     times its real cost — it named a six-item character as the most expensive
     sheet in the world. A median also throws out the one run in ten where the
     garbage collector lands in the middle. */
  const median = (xs) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  let ctx = await sheet.getData();
  let html = tpl(ctx);

  const dataRuns = [];
  for (let n = 0; n < 7; n++) {
    const t0 = performance.now();
    ctx = await sheet.getData();
    dataRuns.push(performance.now() - t0);
  }
  const data = median(dataRuns);

  const drawRuns = [];
  for (let n = 0; n < 7; n++) {
    const t0 = performance.now();
    html = tpl(ctx);
    drawRuns.push(performance.now() - t0);
  }
  const draw = median(drawRuns);

  rows.push({ name: character, items: chars[i].items.length, data, draw,
              total: data + draw, kb: html.length / 1024 });
}

rows.sort((a, b) => b.total - a.total);
const sum = (f) => rows.reduce((n, r) => n + f(r), 0);

console.log(`one redraw, ${rows.length} characters, milliseconds\n`);
console.log(`  ${'character'.padEnd(22)} ${'items'.padStart(5)} ${'getData'.padStart(8)}`
          + ` ${'template'.padStart(8)} ${'total'.padStart(8)} ${'markup'.padStart(9)}`);
for (const r of rows.slice(0, 8))
  console.log(`  ${r.name.slice(0, 22).padEnd(22)} ${String(r.items).padStart(5)}`
    + ` ${r.data.toFixed(1).padStart(8)} ${r.draw.toFixed(1).padStart(8)}`
    + ` ${r.total.toFixed(1).padStart(8)} ${(r.kb.toFixed(0) + ' kB').padStart(9)}`);

const worst = rows[0], mean = sum(r => r.total) / rows.length;
console.log(`\n  worst  ${worst.total.toFixed(1)} ms  (${worst.name}, ${worst.items} items)`);
console.log(`  mean   ${mean.toFixed(1)} ms`);
console.log(`  of that, getData is ${(100 * sum(r => r.data) / sum(r => r.total)).toFixed(0)}%`
          + ` and the template ${(100 * sum(r => r.draw) / sum(r => r.total)).toFixed(0)}%`);

/* A redraw the player waits on. 16ms is one frame at 60Hz; a keystroke that
   costs more than a few frames is felt. */
const slow = rows.filter(r => r.total > 50);
console.log(slow.length
  ? `\n${slow.length} character(s) cost more than 50 ms a redraw: `
    + slow.map(r => `${r.name} ${r.total.toFixed(0)}ms`).join(', ')
  : '\nno character costs more than 50 ms a redraw');
