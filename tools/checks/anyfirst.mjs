/* Loads every script in the module as if it were the first thing loaded.
 *
 * module.json's order is one order. A browser holding half the module in cache,
 * a manifest a running world read before the last change, another module
 * importing one of these files — each of those picks a different first file,
 * and a class that extends one from another module only survives some of them.
 * When it does not, the module dies at load and nothing registers: not an error
 * in a sheet, a sheet that will not open.
 *
 * So: every file, on its own, in its own process. If any of them cannot be
 * first, this fails.
 */
import path from 'path';
import fs from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import { spawnSync } from 'child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const R = path.resolve(HERE, '..', '..') + path.sep;

/* The child does the actual import, so one failure cannot poison the rest. */
if (process.argv[2]) {
  await import('./stubs.mjs');
  await import(pathToFileURL(process.argv[2]).href);
  process.exit(0);
}

const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.js')) files.push(p);
  }
})(path.join(R, 'scripts'));

let bad = 0;
for (const f of files) {
  const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), f],
                      { encoding: 'utf8' });
  const rel = path.relative(R, f).split(path.sep).join('/');
  if (r.status === 0) continue;
  /* Only the failures that are about load order matter here; a module that
     needs a Foundry global the stubs do not have is not this check's business. */
  const msg = (r.stderr || '').split('\n').find(l => /Error|error:/.test(l)) ?? '';
  if (/before initialization|Cannot access|circular|is not a constructor/i.test(msg)) {
    console.log(`CANNOT BE FIRST  ${rel}`);
    console.log(`                 ${msg.trim()}`);
    bad++;
  } else if (process.env.VERBOSE) {
    console.log(`(skipped)        ${rel}: ${msg.trim()}`);
  }
}
console.log(bad ? `\n${bad} file(s) break when loaded first`
                : `\nall ${files.length} scripts can be loaded first`);
process.exit(bad ? 1 : 0);
