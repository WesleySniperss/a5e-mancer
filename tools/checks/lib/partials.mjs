/* Register the sheet partials, taking the list from the module.
 *
 * Six checks used to name `tidy-table` and `tidy-row` by hand. The moment a
 * third partial was added, every one of them died on
 *
 *     Error: The partial am-note-field could not be found
 *
 * which is a harness drifting from the thing it is supposed to be a copy of.
 * The module registers them as [name, file] pairs against `templates/`; this
 * reads those pairs out of the source, so adding a partial adds it here too.
 *
 * No side effects on import — the checks that use this set up their own globals
 * and must not inherit anyone else's.
 */
import Handlebars from 'handlebars';
import { readFileSync } from 'fs';

export function registerSheetPartials(root) {
  const src = readFileSync(root + 'scripts/a5e-mancer.js', 'utf8');
  const pairs = [...src.matchAll(/\[\s*'([\w-]+)',\s*'(sheet\/[\w.-]+\.hbs)'\s*\]/g)];
  if (!pairs.length) {
    throw new Error('no sheet partials found in a5e-mancer.js — the shape of that list has changed');
  }
  for (const [, name, file] of pairs) {
    Handlebars.registerPartial(name, readFileSync(root + 'templates/' + file, 'utf8'));
  }
  return pairs.length;
}
