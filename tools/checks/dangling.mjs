/* Selectors and dataset keys the JS reaches for that no markup ever writes.
 *
 * This is the shape almost every bug reported on this project has taken: the
 * handler is bound, it runs, it finds nothing, and it fails in silence. The dead
 * `toggleEquipmentChoice` was exactly that twice over — it stripped the class
 * `selected` where the template writes `am-selected`, and read
 * `dataset.optionIndex` off a button carrying `data-idx`. Neither mistake can
 * throw. Nothing in the console. The button simply does not work.
 *
 * Two families are checked, both narrow on purpose:
 *
 *   .am-*        our own classes. A class we author that JS looks for and no
 *                template renders is dead, with no judgement call to make.
 *                Foundry's and Tidy's classes are left alone — we do not own
 *                that markup and cannot say what it contains.
 *
 *   dataset.*    every dataset read, matched against the data- attribute that
 *                would have to exist to feed it, in kebab-case.
 *
 * As with every check here: this says where to look, not what is true. A class
 * can legitimately be injected by a library, and a dataset key can be set by
 * Foundry on an element we did not draw. Read the code before believing it.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const R = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..') + path.sep;

function collect(dir, ext, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) collect(p, ext, out);
    else if (e.name.endsWith(ext)) out.push(p);
  }
  return out;
}

const jsFiles  = collect(R + 'scripts', '.js');
const hbsFiles = collect(R + 'templates', '.hbs');
const js       = jsFiles.map(f => [f, fs.readFileSync(f, 'utf8')]);
const markup   = [...hbsFiles.map(f => fs.readFileSync(f, 'utf8')), ...js.map(([, s]) => s)].join('\n');

/* ── what the markup actually offers ───────────────────────────────────── */

/* Every class token that appears inside a class attribute anywhere, plus every
   class the JS adds at runtime. Handlebars sits inside these attributes
   ({{#if x}}am-selected{{/if}}), so the whole attribute is split on whitespace
   and the mustaches are dropped. */
const haveClass = new Set();
for (const m of markup.matchAll(/class(?:Name)?\s*=\s*["'`]([^"'`]*)["'`]/g))
  for (const tok of m[1].replace(/\{\{[^}]*\}\}/g, ' ').split(/\s+/)) if (tok) haveClass.add(tok);
for (const m of markup.matchAll(/classList\.(?:add|toggle|replace)\(([^)]*)\)/g))
  for (const s of m[1].matchAll(/['"`]([\w-]+)['"`]/g)) haveClass.add(s[1]);
/* classes built into a template literal: `am-tab am-${kind}` — the static half
   is still a real token, and a dynamic half means we cannot judge the rest */
for (const m of markup.matchAll(/class(?:Name)?\s*=\s*[`]([^`]*)[`]/g))
  for (const tok of m[1].split(/\s+/)) if (tok && !tok.includes('$')) haveClass.add(tok);

/* Every data- attribute the markup writes, and every dataset key JS assigns. */
const haveData = new Set();
for (const m of markup.matchAll(/data-([a-z][\w-]*)\s*=/g)) haveData.add(m[1]);
for (const m of markup.matchAll(/setAttribute\(\s*['"`]data-([a-z][\w-]*)/g)) haveData.add(m[1]);
for (const m of markup.matchAll(/dataset\.([A-Za-z][\w]*)\s*=[^=]/g))
  haveData.add(m[1].replace(/[A-Z]/g, c => '-' + c.toLowerCase()));
for (const m of markup.matchAll(/dataset\[\s*['"`]([\w-]+)/g))
  haveData.add(m[1].replace(/[A-Z]/g, c => '-' + c.toLowerCase()));

/* Foundry and the DOM set these on elements we did not draw. */
const NOT_OURS = new Set([
  'action', 'tab', 'group', 'application-part', 'appid', 'app-id', 'document-id',
  'uuid', 'pack', 'entry-id', 'tooltip', 'tooltip-direction', 'drag', 'draggable',
  'item-id', 'effect-id', 'actor-id', 'target', 'type', 'value', 'index', 'id',
  'name', 'key', 'filter', 'sort', 'mode', 'theme', 'tidy-render-scheme',
  /* a5e's own condition palette is a Svelte component:
     button.condition-container[data-status-id]. We decorate it; we do not
     draw it. */
  'status-id'
]);

/* ── what the JS asks for ──────────────────────────────────────────────── */

const missClass = [];
const missData  = [];

/* Comments are not code. A prose line naming the very class it says is gone
   — and these files carry many — would otherwise be reported as a live
   reference to it. Blanked rather than removed so every offset, and so every
   line number printed below, still points at the real line. */
const decomment = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\r\n]/g, ' '))
  .replace(/(^|[^:])\/\/[^\r\n]*/g, (m, p) => p + ' '.repeat(m.length - p.length));

for (const [file, raw] of js) {
  const src = decomment(raw);
  const rel = path.relative(R, file).replace(/\\/g, '/');
  const line = (i) => src.slice(0, i).split('\n').length;

  /* .am-* inside any selector string, and in classList calls */
  const asked = new Map();
  for (const m of src.matchAll(/['"`][^'"`]*?\.(am-[\w-]+)/g)) asked.set(m[1], m.index);
  for (const m of src.matchAll(/classList\.(?:add|remove|toggle|contains|replace)\(([^)]*)\)/g))
    for (const s of m[1].matchAll(/['"`](am-[\w-]+)['"`]/g)) asked.set(s[1], m.index);
  for (const [cls, at] of asked)
    if (!haveClass.has(cls)) missClass.push([rel, line(at), cls]);

  /* dataset reads — an assignment is a write, and writes are the supply side */
  const reads = new Map();
  for (const m of src.matchAll(/\.dataset\.([A-Za-z][\w]*)/g)) {
    const after = src.slice(m.index + m[0].length, m.index + m[0].length + 4);
    if (/^\s*=[^=]/.test(after)) continue;                       // a write
    const kebab = m[1].replace(/[A-Z]/g, c => '-' + c.toLowerCase());
    if (!reads.has(kebab)) reads.set(kebab, m.index);
  }
  for (const [key, at] of reads)
    if (!haveData.has(key) && !NOT_OURS.has(key)) missData.push([rel, line(at), key]);
}

const show = (title, rows, fmt) => {
  console.log(`\n${title}: ${rows.length}`);
  for (const r of rows.sort((a, b) => a[0].localeCompare(b[0]) || a[1] - b[1]))
    console.log(`  ${(r[0] + ':' + r[1]).padEnd(46)} ${fmt(r[2])}`);
};

show('classes asked for that no markup writes', missClass, c => '.' + c);
show('dataset keys read that no markup sets', missData, k => `data-${k}`);

const total = missClass.length + missData.length;
console.log(total ? `\n${total} reference(s) that cannot match anything — read each before believing it`
                  : '\nevery am- class and dataset key the JS reads is written somewhere');
process.exit(total ? 1 : 0);
