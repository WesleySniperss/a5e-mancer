/* Static import cycles. A benign one resolves by luck of ordering; a cycle
   crossing an `extends` does not resolve at all. Report both, and say which
   ones carry an extends. */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
/* The module root, found from this file rather than hardcoded, so the checks
   run wherever the repo is checked out. */
const R = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..') + path.sep;
const SCRIPTS = path.join(R, 'scripts');

const files = [];
(function walk(d) {
  for (const f of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, f.name);
    if (f.isDirectory()) walk(p); else if (f.name.endsWith('.js')) files.push(p);
  }
})(R);

const graph = new Map(), extendsOf = new Map();
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  const deps = [...src.matchAll(/^import\s[^;]*?from\s+'([^']+)'/gm)]
    .map(m => m[1]).filter(s => s.startsWith('.'))
    .map(s => {
      let t = path.resolve(path.dirname(f), s);
      if (!t.endsWith('.js')) t += '.js';
      return t;
    }).filter(t => fs.existsSync(t));
  graph.set(f, deps);
  const ext = [...src.matchAll(/class\s+\w+\s+extends\s+(\w+)/g)].map(m => m[1]);
  extendsOf.set(f, new Set(ext));
}

const rel = (f) => path.relative(SCRIPTS, f).split(String.fromCharCode(92)).join('/');
const cycles = [];
const state = new Map();
function dfs(node, stack) {
  state.set(node, 1);
  stack.push(node);
  for (const d of graph.get(node) ?? []) {
    if (state.get(d) === 1) cycles.push([...stack.slice(stack.indexOf(d)), d]);
    else if (!state.has(d)) dfs(d, stack);
  }
  stack.pop();
  state.set(node, 2);
}
for (const f of files) if (!state.has(f)) dfs(f, []);

if (!cycles.length) { console.log('no import cycles'); process.exit(0); }
let hard = 0;
for (const c of cycles) {
  /* Does any file in the ring extend a class it gets from the ring? */
  const risky = c.some(f => {
    const names = extendsOf.get(f) ?? new Set();
    if (!names.size) return false;
    const src = fs.readFileSync(f, 'utf8');
    return [...names].some(n =>
      new RegExp("import\s*\{[^}]*\b" + n + "\b[^}]*\}\s*from\s*'\.").test(src));
  });
  if (risky) hard++;
  console.log(`${risky ? 'HARD' : 'soft'}: ${c.map(rel).join(' -> ')}`);
}
console.log(`\n${cycles.length} cycle(s), ${hard} of them across an extends`);
process.exit(hard ? 1 : 0);
