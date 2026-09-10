/* The builder windows dispatch clicks through ApplicationV2's actions map.
 *
 * That map IS the dispatch table: a data-action with no entry in it is a button
 * Foundry has nowhere to send, so the click does nothing and says nothing. And
 * unlike the character sheet — where handlers are bound with querySelector and
 * a name can be built from a variable, which is what made two earlier checks
 * lie — this one is exact. V2 looks the string up in the map.
 *
 * Each window is matched with the templates it declares in PARTS.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const R = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..') + path.sep;

const WINDOWS = [
  'scripts/app/A5eMancer.js',
  'scripts/app/LevelUpDialog.js',
  'scripts/app/ManeuverDialog.js',
  'scripts/app/SpellDialog.js'
];

/* Partials a template pulls in, so their actions are counted against the window
   that renders them. */
function partialsOf(src) {
  return [...src.matchAll(/\{\{>\s*([\w-]+)/g)].map(m => m[1]);
}
const PARTIAL_FILES = {
  'am-item-grants':   'templates/partial-item-grants.hbs',
  'am-spell-browser': 'templates/partial-spell-browser.hbs'
};

let problems = 0;
for (const w of WINDOWS) {
  const src = fs.readFileSync(R + w, 'utf8');
  const name = path.basename(w, '.js');

  /* The actions map, as declared in DEFAULT_OPTIONS. */
  const at = src.indexOf('actions: {');
  if (at < 0) { console.log(`${name}: no actions map`); continue; }
  let depth = 0, i = src.indexOf('{', at), end = i;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (!depth) { end = i; break; } }
  }
  /* from after the opening brace, so the word `actions` itself is not read
     as one of the map's own keys */
  const mapText = src.slice(src.indexOf('{', at) + 1, end);
  const declared = new Set([...mapText.matchAll(/^\s*([A-Za-z][\w]*)\s*:/gm)].map(m => m[1]));

  /* The templates it renders. A5eMancer builds its tab templates from a name
     — `templates/tab-${name}.hbs` — so no literal path appears for them and
     they have to be gathered from the directory. Without that, every action a
     tab draws reads as declared-but-never-drawn, which is noise, not a
     finding. */
  const templates = [...src.matchAll(/template:\s*'modules\/a5e-mancer\/([^']+)'/g)].map(m => m[1]);
  if (/templates\/tab-\$\{/.test(src)) {
    for (const f of fs.readdirSync(R + 'templates'))
      if (/^tab-.*\.hbs$/.test(f)) templates.push('templates/' + f);
  }
  const drawn = new Map();
  for (const t of templates) {
    let tsrc;
    try { tsrc = fs.readFileSync(R + 'templates/' + t.replace(/^templates\//, ''), 'utf8'); }
    catch { continue; }
    const files = [tsrc];
    for (const p of partialsOf(tsrc)) {
      const f = PARTIAL_FILES[p];
      if (!f) continue;
      try { files.push(fs.readFileSync(R + f, 'utf8')); } catch {}
    }
    for (const body of files)
      for (const m of body.matchAll(/data-action="([A-Za-z][\w]*)"/g)) {
        if (!drawn.has(m[1])) drawn.set(m[1], t);
      }
  }

  /* Two data-action values are not dispatched through the map and must not be
     counted against it:

       submit / saveOptions   these sit on <button type="submit">, and the form
                              handler reads event.submitter.dataset.action to
                              tell one from the other. The attribute is a
                              discriminator, not a key.
       tab                    ApplicationV2 handles tab groups itself.

     Both were reported as missing handlers on this check’s first run. Neither
     was. */
  const NOT_DISPATCHED = new Set(['submit', 'saveOptions', 'tab']);
  const missing = [...drawn.keys()]
    .filter(a => !declared.has(a) && !NOT_DISPATCHED.has(a)).sort();
  const unused  = [...declared].filter(a => !drawn.has(a)).sort();

  console.log(`\n${name}: ${declared.size} actions declared, ${drawn.size} drawn`);
  if (missing.length) {
    problems += missing.length;
    for (const a of missing) console.log(`  NO HANDLER  ${a.padEnd(28)} ${drawn.get(a)}`);
  } else console.log('  every drawn action has an entry in the map');
  if (unused.length) console.log(`  declared but never drawn: ${unused.join(', ')}`);
}

console.log(problems ? `\n${problems} button(s) Foundry has nowhere to send`
                     : '\nevery builder button has somewhere to go');
process.exit(problems ? 1 : 0);
