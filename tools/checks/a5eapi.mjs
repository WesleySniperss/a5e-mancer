/* Every a5e method this module calls, against the methods a5e actually has.
 *
 * Almost all of these are called with ?. — `actor.configureSenses?.()` — so a
 * name that is wrong does not throw. The control simply does nothing, silently,
 * which is the single most common shape of bug reported on this project.
 *
 * The system's own source is the authority. It ships as built JS beside the
 * unbuilt TypeScript, and both are searched: a method that appears in neither
 * does not exist.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const R = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..') + path.sep;
const SYS = 'c:/Users/Jonkm/AppData/Local/FoundryVTT/Data/systems/a5e/';

function readAll(root, exts, skip = /node_modules|[\\/]\.git|packs$/) {
  const out = [];
  (function walk(d) {
    let entries = [];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (!skip.test(p)) walk(p); }
      else if (exts.some(x => e.name.endsWith(x))) {
        try { out.push(fs.readFileSync(p, 'utf8')); } catch {}
      }
    }
  })(root);
  return out;
}

const system = readAll(SYS, ['.js', '.mjs', '.ts']).join('\n');
if (system.length < 10000) {
  console.log('the a5e system was not found beside this module; nothing to check against');
  process.exit(0);
}

const ours = readAll(R + 'scripts', ['.js']).join('\n');

/* Calls of the shape  <something>.name?.(   or  typeof x.name === 'function'
   on an actor or item. Anything reached optionally is what this is about. */
const called = new Map();          // name -> how it is called here
for (const m of ours.matchAll(/\.([a-z][A-Za-z0-9]*)\?\.\(/g))
  called.set(m[1], 'optional call');
for (const m of ours.matchAll(/typeof\s+[\w.]+\.([a-z][A-Za-z0-9]*)\s*===\s*['"]function['"]/g))
  called.set(m[1], 'guarded by typeof');

/* Names that are plainly ours, or plain JavaScript, are not a5e's to have. */
const OURS_OR_JS = new Set([
  'log', 'render', 'close', 'update', 'delete', 'get', 'set', 'has', 'map', 'filter',
  'find', 'some', 'every', 'push', 'join', 'split', 'slice', 'replace', 'trim',
  'then', 'catch', 'call', 'apply', 'bind', 'forEach', 'includes', 'indexOf',
  'toObject', 'getFlag', 'setFlag', 'unsetFlag', 'sheet', 'remove', 'closest',
  'querySelector', 'querySelectorAll', 'addEventListener', 'preventDefault',
  'stopPropagation', 'focus', 'blur', 'click', 'setProperty', 'getBoundingClientRect',
  'disconnect', 'observe', 'localize', 'format', 'createDocuments', 'deleteDocuments',
  'updateSource', 'clone', 'reset', 'toDragData', 'getRollData', 'prepareData'
]);

let missing = 0, found = 0;
const gone = [];
for (const [name, how] of [...called].sort()) {
  if (OURS_OR_JS.has(name)) continue;
  /* a method exists if the system declares it, in either source form */
  const declared =
    new RegExp('(?:async\\s+)?' + name + '\\s*\\(').test(system) ||
    new RegExp('\\b' + name + '\\s*[:=]\\s*(?:async\\s*)?(?:function|\\()').test(system);
  if (declared) { found++; continue; }
  gone.push([name, how]);
  missing++;
}

console.log(`${called.size} optional calls found, ${found} of them a5e declares`);
console.log(missing ? '\ncalled here, declared nowhere in a5e:' : '\nevery a5e method this module reaches for exists');
for (const [n, how] of gone) console.log(`  ${n.padEnd(34)} (${how})`);
process.exit(missing ? 1 : 0);
