/* Handlers bound with querySelector — the singular — against markup that holds
 * more than one of that element.
 *
 * querySelector returns the FIRST match. If the control the player actually
 * uses is the second one, the listener is on a different element and the click
 * does nothing at all. There is no error, nothing in the console, and the
 * button simply does not respond — which is exactly what "it doesn't click"
 * looks like from the outside.
 *
 * Run from the scratch directory, where world-chars.json is.
 */
import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const R = path.resolve(HERE, '..', '..') + path.sep;

const js = readFileSync(R + 'scripts/app/A5eCharacterSheet.js', 'utf8');
const tplSrc = readFileSync(R + 'templates/sheet/tidy-character-sheet.hbs', 'utf8');

/* Every selector reached for with the singular form. */
const singular = [...js.matchAll(/el\.querySelector\(\s*'([^']+)'/g)].map(m => m[1]);
const plural   = new Set([...js.matchAll(/el\.querySelectorAll\(\s*'([^']+)'/g)].map(m => m[1]));

/* Count occurrences in the markup. Handlebars is left un-rendered on purpose:
   an element inside {{#each}} is one in the source and many on screen, and that
   is precisely the case that bites. */
function occurrences(sel) {
  const da = sel.match(/\[data-action="([^"]+)"\]/);
  if (da) return (tplSrc.match(new RegExp(`data-action="${da[1]}"`, 'g')) ?? []).length;
  const id = sel.match(/^#([\w-]+)$/);
  if (id) return (tplSrc.match(new RegExp(`id="${id[1]}"`, 'g')) ?? []).length;
  const cls = sel.match(/^\.([\w-]+)$/);
  if (cls) return (tplSrc.match(new RegExp(`class="[^"]*\\b${cls[1]}\\b`, 'g')) ?? []).length;
  return -1;   // not a shape this check can count
}

/* Is it inside a repeating block? Crude but useful: the nearest {{#each above
   the occurrence has no matching {{/each}} before it. */
function insideEach(sel) {
  const da = sel.match(/\[data-action="([^"]+)"\]/);
  const needle = da ? `data-action="${da[1]}"` : null;
  if (!needle) return false;
  let i = tplSrc.indexOf(needle);
  while (i !== -1) {
    const before = tplSrc.slice(0, i);
    const opens = (before.match(/\{\{#each/g) ?? []).length;
    const closes = (before.match(/\{\{\/each\}\}/g) ?? []).length;
    if (opens > closes) return true;
    i = tplSrc.indexOf(needle, i + 1);
  }
  return false;
}

let bad = 0;
const seen = new Set();
for (const sel of singular) {
  if (seen.has(sel)) continue;
  seen.add(sel);
  const n = occurrences(sel);
  const each = insideEach(sel);
  if (n > 1 || each) {
    console.log(`${each ? 'IN AN {{#each}}' : `${n} IN THE MARKUP`}  ${sel}`);
    console.log(`    bound with querySelector, so only the first one responds`
              + (plural.has(sel) ? ' (also bound with querySelectorAll elsewhere)' : ''));
    bad++;
  }
}
console.log(bad ? `\n${bad} singular binding(s) over markup that has more than one`
                : `\nevery querySelector binding has exactly one target`);
process.exit(bad ? 1 : 0);
