/* Two methods with the same name in one class body.
 *
 * JavaScript does not complain: the later one simply replaces the earlier, and
 * everything the earlier one did stops happening. The character sheet had two
 * close() methods a few thousand lines apart — the second won, so the
 * ResizeObserver the first one disconnected was never disconnected, and every
 * sheet opened and closed left one behind, still firing its layout callback on
 * an element no longer in the document.
 *
 * Nothing else here would find that. It parses, it runs, and it only shows up
 * as a session that gets slower the longer it goes on.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const R = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..') + path.sep;

/* Brace-matched scan rather than a parser, so this check has no dependencies. */
function classesIn(src) {
  const out = [];
  const re = /(?:^|\n)\s*(?:export\s+)?(?:default\s+)?class\s+([A-Za-z0-9_$]+)/g;
  let m;
  while ((m = re.exec(src))) {
    const open = src.indexOf('{', m.index + m[0].length);
    if (open < 0) continue;
    let depth = 0, i = open, inS = null, inC = null;
    for (; i < src.length; i++) {
      const ch = src[i], nx = src[i + 1];
      if (inC) { if (inC === '//' && ch === '\n') inC = null;
                 else if (inC === '/*' && ch === '*' && nx === '/') { inC = null; i++; }
                 continue; }
      if (inS) { if (ch === '\\') i++; else if (ch === inS) inS = null; continue; }
      if (ch === '/' && nx === '/') { inC = '//'; i++; continue; }
      if (ch === '/' && nx === '*') { inC = '/*'; i++; continue; }
      if (ch === '"' || ch === "'" || ch === '`') { inS = ch; continue; }
      if (ch === '{') depth++;
      else if (ch === '}') { depth--; if (depth === 0) break; }
    }
    out.push({ name: m[1], body: src.slice(open + 1, i), start: open });
  }
  return out;
}

/* Member declarations at the top level of a class body: `name(`, `get name(`,
   `static name(`, `async name(`, `#name(`, and field forms `name =`. */
function membersOf(body) {
  const found = [];
  const lines = body.split('\n');
  let depth = 0, inC = false;
  for (const [n, raw] of lines.entries()) {
    const line = raw.trim();
    if (inC) { if (line.includes('*/')) inC = false; continue; }
    if (line.startsWith('/*')) { if (!line.includes('*/')) inC = true; continue; }
    if (line.startsWith('//') || line.startsWith('*')) continue;
    if (depth === 0) {
      const m = line.match(
        /^(?:static\s+)?(?:async\s+)?(?:\*\s*)?(?:(get|set)\s+)?(#?[A-Za-z0-9_$]+)\s*(\(|=[^=])/);
      if (m && !['if','for','while','switch','return','constructor','catch'].includes(m[2])) {
        const kind = m[1] ? m[1] + ' ' : (m[3] === '(' ? '' : 'field ');
        found.push({ name: kind + m[2], line: n + 1 });
      }
    }
    for (const ch of raw) { if (ch === '{') depth++; else if (ch === '}') depth--; }
  }
  return found;
}

const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p); else if (e.name.endsWith('.js')) files.push(p);
  }
})(path.join(R, 'scripts'));

let bad = 0;
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  const rel = path.relative(R, f).split(path.sep).join('/');
  for (const cls of classesIn(src)) {
    const seen = new Map();
    for (const mem of membersOf(cls.body)) {
      if (seen.has(mem.name)) {
        const before = src.slice(0, cls.start).split('\n').length;
        console.log(`DUPLICATE  ${rel}  class ${cls.name}  ${mem.name}()`);
        console.log(`           declared at lines ${before + seen.get(mem.name)} `
                  + `and ${before + mem.line} — the second one wins`);
        bad++;
      } else seen.set(mem.name, mem.line);
    }
  }
}
console.log(bad ? `\n${bad} duplicate member(s)` : '\nno duplicate class members');
process.exit(bad ? 1 : 0);
