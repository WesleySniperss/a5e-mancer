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
 *   #id          every getElementById and every '#…' selector, against the
 *                ids the templates draw. An id built from a variable —
 *                `ability-${i}-score` — is matched as the pattern it is, so a
 *                renamed field still shows up.
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
/* Classes built into a template literal: `am-tab am-${kind}`.

   A token that CONTAINS an interpolation still writes the literal part before
   it: `am-att-row${on ? ' am-att-on' : ''}` puts `am-att-row` on the element
   as surely as a plain attribute would. Dropping such tokens whole reported
   that class as written nowhere, which was the check misreading its own
   source rather than a fault in the sheet.

   So each token is cut at its first ${ and the literal head kept. A token
   that begins with one has no literal head and is skipped, which is the
   honest answer for `${cls}-row`. */
for (const m of markup.matchAll(/class(?:Name)?\s*=\s*[`]([^`]*)[`]/g))
  for (const tok of m[1].split(/\s+/)) {
    const head = tok.split('${')[0];
    if (head) haveClass.add(head);
  }

/* And the same for a class list assembled inside a template literal that is
   not an attribute at all — `class="am-att-row${…}"` sits inside one. */
for (const m of markup.matchAll(/class(?:Name)?\s*=\s*\\?["']([^"'`]*)\$\{/g)) {
  const head = m[1].split(/\s+/).pop();
  if (head) haveClass.add(head);
}

/* Every data- attribute the markup writes, and every dataset key JS assigns. */
const haveData = new Set();
for (const m of markup.matchAll(/data-([a-z][\w-]*)\s*=/g)) haveData.add(m[1]);
for (const m of markup.matchAll(/setAttribute\(\s*['"`]data-([a-z][\w-]*)/g)) haveData.add(m[1]);
for (const m of markup.matchAll(/dataset\.([A-Za-z][\w]*)\s*=[^=]/g))
  haveData.add(m[1].replace(/[A-Z]/g, c => '-' + c.toLowerCase()));
for (const m of markup.matchAll(/dataset\[\s*['"`]([\w-]+)/g))
  haveData.add(m[1].replace(/[A-Z]/g, c => '-' + c.toLowerCase()));

/* Every id the markup draws, held as the pattern it is: literal text with a
   gap wherever a mustache fills one in.

   The nuance that matters, and that the first version got wrong: an id which
   is ENTIRELY dynamic — id="{{this.id}}" on a table row, and there are fifty
   of those here — has no literal text at all. As a pattern it is `.+`, it
   matches every lookup on the page, and the check quietly passes everything.
   It WAS passing everything: a deliberately fake id went unreported. Ids like
   that are dropped. They say nothing about what is on the page, and a check
   that cannot tell must not answer.

   The gap is [\\w:.-]* and not .+, so `am-x-y` cannot be satisfied by some
   unrelated id that merely begins and ends the same way. */
const HOLE = /\{\{[^}]*\}\}|\$\{[^}]*\}/g;
const ESC  = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, (c) => '\\' + c);

const haveId = [];
const supply = (raw) => {
  const parts = String(raw).split(HOLE);
  if (!parts.join('').trim()) return;            // nothing literal to go on
  haveId.push(new RegExp('^' + parts.map(ESC).join('[\\w:.-]*') + '$'));
};

/* ids written straight into the markup */
const dynamicIds = new Set();
for (const m of markup.matchAll(/\bid=["'`]([^"'`]+)["'`]/g)) {
  supply(m[1]);
  /* A wholly dynamic one — id="{{this.inputId}}" — is no use as a pattern,
     but it does name the context key that fills it, and that key is built
     somewhere in the JS. Follow it. */
  const whole = m[1].match(/^\{\{\s*(?:this\.|\.\.\/|@)?([\w.]+)\s*\}\}$/);
  if (whole) dynamicIds.add(whole[1].split('.').pop());
}
for (const key of dynamicIds)
  for (const m of markup.matchAll(new RegExp('\\b' + key + '\\s*[:=]\\s*([`\'"])((?:[^\\\\]|\\\\.)*?)\\1', 'g')))
    supply(m[2]);

/* An ApplicationV2 window's own root carries the id from its DEFAULT_OPTIONS,
   which no template ever draws. */
for (const m of markup.matchAll(/^\s*id:\s*['"]([\w-]+)['"]/gm)) supply(m[1]);

/* An id the JS builds — `ability-${i}-score` — is probed with its holes filled
   by a plain value, which is what the markup's own gap will accept. */
const idDrawn = (want) => {
  const probe = want.replace(HOLE, '0');
  if (!want.split(HOLE).join('').trim()) return true;   // wholly dynamic
  return haveId.some(rx => rx.test(probe));
};

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

/* Elements someone else draws and we only reach into: Foundry's own sidebar,
   and a5e's effects panel. */
const NOT_OUR_IDS = new Set(['sidebar', 'a5e-effects-panel', 'chat-log']);

/* ── what the JS asks for ──────────────────────────────────────────────── */

const missClass = [];
const missData  = [];
const missId    = [];

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

  /* getElementById('x') and querySelector('#x'), including the ones built
     from a template literal. */
  const wanted = new Map();
  /* Read to the closing quote of the same kind, stepping over anything inside
     a ${…}. `lore-${key.replace(/\./g, '-')}` carries quotes of its own, and a
     character class that stops at the first one reports a fragment. */
  const literalAt = (i) => {
    const quote = src[i];
    let out = '', depth = 0;
    for (let j = i + 1; j < src.length; j++) {
      const c = src[j];
      if (c === '\\') { out += c + src[++j]; continue; }
      if (quote === '`' && c === '$' && src[j + 1] === '{') { depth++; out += '${'; j++; continue; }
      if (depth) { if (c === '{') depth++; else if (c === '}') depth--; out += c; continue; }
      if (c === quote) return out;
      if (c === '\n') return null;
      out += c;
    }
    return null;
  };
  for (const m of src.matchAll(/getElementById\(\s*(?=[`'"])/g)) {
    const lit = literalAt(m.index + m[0].length);
    if (lit && !wanted.has(lit)) wanted.set(lit, m.index);
  }
  for (const m of src.matchAll(/querySelector(?:All)?\(\s*(?=[`'"])/g)) {
    const lit = literalAt(m.index + m[0].length);
    if (!lit) continue;
    const id = lit.match(/^#([\w-]+(?:\$\{[^}]*\}[\w-]*)*)$/);
    if (id && !wanted.has(id[1])) wanted.set(id[1], m.index);
  }
  for (const [id, at] of wanted)
    if (!idDrawn(id) && !NOT_OUR_IDS.has(id)) missId.push([rel, line(at), id]);
}

const show = (title, rows, fmt) => {
  console.log(`\n${title}: ${rows.length}`);
  for (const r of rows.sort((a, b) => a[0].localeCompare(b[0]) || a[1] - b[1]))
    console.log(`  ${(r[0] + ':' + r[1]).padEnd(46)} ${fmt(r[2])}`);
};

show('classes asked for that no markup writes', missClass, c => '.' + c);
show('dataset keys read that no markup sets', missData, k => `data-${k}`);
show('ids looked up that no markup draws', missId, i => '#' + i);

const total = missClass.length + missData.length + missId.length;
console.log(total ? `\n${total} reference(s) that cannot match anything — read each before believing it`
                  : '\nevery am- class, dataset key and id the JS reads is written somewhere');
process.exit(total ? 1 : 0);
