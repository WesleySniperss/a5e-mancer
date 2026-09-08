/* Loads the module the way Foundry does, then FIRES ITS HOOKS in order:
 * init, setup, ready. Reports anything that throws, and whether the sheets
 * actually got registered by the end of it.
 *
 * This is the coverage that was missing. loadorder.mjs proves the files import;
 * it does not prove that a single line of hook code runs. A throw in the init
 * hook before Actors.registerSheet means Foundry never learns the sheet class
 * exists, and the symptom is not an error in the sheet — it is a sheet that
 * does not open at all.
 */
import path from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';
import './stubs.mjs';

const R = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..') + path.sep;
const mod = JSON.parse(readFileSync(R + 'module.json', 'utf8'));

/* A Hooks that keeps what it is given, so it can be fired on demand. */
const handlers = new Map();
const add = (name, fn) => {
  if (!handlers.has(name)) handlers.set(name, []);
  handlers.get(name).push(fn);
};
globalThis.Hooks = {
  on: add, once: add,
  off() {}, callAll() {}, call() {}
};

/* Settings behave as Foundry's do: reading one that was never registered
   THROWS, and registering the same key twice throws too. Both have bitten this
   module before. */
const registered = new Map();
const seen = new Set();
globalThis.game = {
  user: { isGM: true, id: 'u1' },
  packs: new Collection(),
  modules: new Collection(),
  actors: new Collection(),
  items: new Collection(),
  system: { id: 'a5e', version: '0.0.0' },
  i18n: { localize: (k) => k, format: (k) => k, has: () => false },
  settings: {
    register(ns, key, cfg) {
      const id = ns + '.' + key;
      if (seen.has(id)) throw new Error(`Setting ${id} is already registered`);
      seen.add(id);
      registered.set(id, cfg?.default);
    },
    registerMenu() {},
    get(ns, key) {
      const id = ns + '.' + key;
      if (!registered.has(id)) throw new Error(`"${id}" is not a registered game setting`);
      /* The module gates almost everything on `enable`; leave it on so the
         ready hooks actually run. */
      return registered.get(id);
    },
    set: async () => {}
  },
  a5e: { utils: { getDeterministicBonus: (f) => Number(f) || 0 } },
  keybindings: { register() {} }
};

const sheets = [];
globalThis.Actors = {
  unregisterSheet() {},
  registerSheet(scope, cls, opts) { sheets.push({ scope, name: cls?.name, opts }); }
};
globalThis.Items = { unregisterSheet() {}, registerSheet() {} };
globalThis.CONFIG = globalThis.CONFIG ?? {};
Object.assign(globalThis.CONFIG, {
  A5E: { statusEffects: [], conditions: {}, skills: {}, abilities: {} },
  statusEffects: [],
  Actor: { documentClass: class {} },
  Item: { documentClass: class {} }
});
globalThis.Handlebars = {
  registerPartial() {}, registerHelper() {}, compile: () => () => ''
};
globalThis.fromUuid = async () => null;
globalThis.fromUuidSync = () => null;
globalThis.TextEditor = { enrichHTML: async (h) => h };
globalThis.requestAnimationFrame = (f) => f();

let bad = 0;
for (const rel of mod.esmodules) {
  try { await import('file:///' + R + rel); }
  catch (e) { console.log(`FAIL importing ${rel}: ${e.message}`); bad++; }
}
if (bad) { console.log('\nmodule did not load'); process.exit(1); }

for (const phase of ['init', 'setup', 'ready']) {
  const fns = handlers.get(phase) ?? [];
  console.log(`--- ${phase} (${fns.length} handler${fns.length === 1 ? '' : 's'}) ---`);
  for (const [i, fn] of fns.entries()) {
    try {
      await fn();
    } catch (e) {
      console.log(`  handler #${i + 1} THREW: ${e.constructor.name}: ${e.message}`);
      const frame = (e.stack || '').split('\n').find(l => l.includes('a5e-mancer'));
      if (frame) console.log(`    ${frame.trim()}`);
      bad++;
    }
  }
}

console.log('\nsheets registered:');
for (const s of sheets) console.log(`  ${s.name} for ${JSON.stringify(s.opts?.types)}`);
for (const want of ['A5eCharacterSheet', 'A5eNPCSheet']) {
  if (!sheets.some(s => s.name === want)) { console.log(`  ** ${want} NEVER REGISTERED **`); bad++; }
}

console.log(bad ? `\n${bad} problem(s) firing the hooks`
                : '\nevery hook ran and both sheets registered');
process.exit(bad ? 1 : 0);
