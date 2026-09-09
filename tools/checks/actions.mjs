/* Every data-action the sheets draw, against every one they listen for.
 *
 * A button whose action nobody binds does nothing and says nothing. A listener
 * for an action nobody draws is dead code that reads as coverage. Both have
 * happened here, so both are counted.
 *
 * The first version of this check cost more than it found. It looked only for
 * data-action="…" spelled out in the script, and reported cycle-fatigue and
 * cycle-strife as unbound — while a handler three hundred lines further down
 * bound both through `[data-action="${action}"]` in a loop. Acting on that
 * report added a second handler to each button, so one click would have moved
 * the track by two. A functional test caught it; the check had not.
 *
 * Hence namedInScript below, and hence the rule this whole file exists under:
 * a static check says where to look, never what is true. Confirm by firing the
 * handler before changing anything.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const R = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..') + path.sep;

const TEMPLATES = [
  'templates/sheet/tidy-character-sheet.hbs',
  'templates/sheet/npc-sheet.hbs',
  'templates/sheet/partial-tidy-row.hbs',
  'templates/sheet/partial-tidy-table.hbs'
];
const SCRIPTS = ['scripts/app/A5eCharacterSheet.js'];

const drawn = new Map();     // action -> files that draw it
for (const t of TEMPLATES) {
  const src = fs.readFileSync(R + t, 'utf8');
  for (const m of src.matchAll(/data-action="([a-zA-Z-]+)"/g)) {
    if (!drawn.has(m[1])) drawn.set(m[1], new Set());
    drawn.get(m[1]).add(path.basename(t));
  }
}

/* Handlebars can build an action from a variable; those are reported apart
   rather than counted as missing. */
const dynamic = TEMPLATES.some(t =>
  /data-action="\{\{/.test(fs.readFileSync(R + t, 'utf8')));

const bound = new Set();
const boundClasses = new Set();
for (const s of SCRIPTS) {
  const src = fs.readFileSync(R + s, 'utf8');
  for (const m of src.matchAll(/data-action=\\?["']([a-zA-Z-]+)\\?["']/g)) bound.add(m[1]);
  /* The row partial can be told which action to use, so anything passed as
     useAction counts as bound too. */
  for (const m of src.matchAll(/useAction[=:]\s*['"]([a-zA-Z-]+)['"]/g)) bound.add(m[1]);
  /* Some controls are bound by their class rather than their action —
     .sidebar-toggle is one. If the element carrying data-action="x" also
     carries a class the script listens on, that counts. */
  for (const m of src.matchAll(/querySelector(?:All)?\(\s*['"]\.([\w-]+)['"]/g))
    boundClasses.add(m[1]);
}
for (const t of TEMPLATES) {
  const src = fs.readFileSync(R + t, 'utf8');
  for (const m of src.matchAll(/useAction="([a-zA-Z-]+)"/g)) bound.add(m[1]);
}

/* An action is covered if its own name is listened for, or if the element
   drawing it carries a class the script binds to. */
const drawnWithClass = new Map();
for (const t of TEMPLATES) {
  const src = fs.readFileSync(R + t, 'utf8');
  for (const m of src.matchAll(/<[^>]*data-action="([a-zA-Z-]+)"[^>]*>/g)) {
    const classes = (m[0].match(/class="([^"]*)"/)?.[1] ?? '').split(/\s+/);
    if (!drawnWithClass.has(m[1])) drawnWithClass.set(m[1], new Set());
    for (const cl of classes) drawnWithClass.get(m[1]).add(cl);
  }
}
const coveredByClass = (a) =>
  [...(drawnWithClass.get(a) ?? [])].some(cl => boundClasses.has(cl));

/* A selector can be built from a variable — a loop over
   [['cycle-fatigue', …], ['cycle-strife', …]] binds both without either name
   ever appearing inside data-action="…". So a name quoted anywhere in the
   script counts as bound. Loose, but it errs towards silence rather than
   towards crying wolf, and a name that appears nowhere at all is the case
   worth catching. */
const quoted = new Set();
for (const s of SCRIPTS) {
  const src = fs.readFileSync(R + s, 'utf8');
  for (const m of src.matchAll(/['"`]([a-z][a-zA-Z]*(?:-[a-zA-Z]+)+)['"`]/g)) quoted.add(m[1]);
}
const namedInScript = (a) => quoted.has(a);

const unbound = [...drawn.keys()]
  .filter(a => !bound.has(a) && !coveredByClass(a) && !namedInScript(a)).sort();
const unused  = [...bound].filter(a => !drawn.has(a)).sort();

console.log(`${drawn.size} actions drawn, ${bound.size} listened for`);
if (dynamic) console.log('(a template builds at least one action from a variable)');

console.log(unbound.length ? `\ndrawn but nothing listens for them:` : '\nevery drawn action has a listener');
for (const a of unbound) console.log(`  ${a.padEnd(26)} ${[...drawn.get(a)].join(', ')}`);

console.log(unused.length ? `\nlistened for but never drawn:` : '\nevery listener has something to listen to');
for (const a of unused) console.log(`  ${a}`);

process.exit(unbound.length ? 1 : 0);
