/* Loads module.json's esmodules in the order Foundry loads them.
 *
 * This is the check that was missing. module.json listed A5eCharacterSheet.js
 * first, so Foundry reached it before the entry point — and with A5eNPCSheet
 * extending it through an import cycle that order throws outright, at load,
 * before a single hook runs. Nothing else here would have caught it: every
 * file parses, every template compiles, and importing the entry point by hand
 * happens to work. Only the declared order fails. */
import path from 'path';
import './stubs.mjs';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
/* The module root, found from this file rather than hardcoded, so the checks
   run wherever the repo is checked out. */
const R = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..') + path.sep;
const mod = JSON.parse(readFileSync(R + 'module.json', 'utf8'));

globalThis.CONFIG = globalThis.CONFIG ?? { A5E: {}, Actor: { documentClass: class {} }, Item: {} };
globalThis.game = globalThis.game ?? {
  user: { isGM: true }, packs: new Collection(), modules: new Collection(),
  i18n: { localize: (k) => k, format: (k) => k, has: () => false },
  settings: { get: () => { throw new Error('unregistered'); }, register(){} },
  system: { id: 'a5e' }
};
globalThis.Actors = { unregisterSheet(){}, registerSheet(){} };
globalThis.Items   = { unregisterSheet(){}, registerSheet(){} };

let bad = 0;
for (const rel of mod.esmodules) {
  try { await import('file:///' + R + rel); console.log(`  ok   ${rel}`); }
  catch (e) {
    console.log(`  FAIL ${rel}`);
    console.log(`       ${e.constructor.name}: ${e.message}`);
    bad++;
  }
}
console.log(bad ? `\n${bad} module(s) fail to load in the declared order`
                : '\nevery declared esmodule loads, in order');
process.exit(bad ? 1 : 0);
