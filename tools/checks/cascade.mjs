/*
 * Which declarations actually win for a given element, across every stylesheet
 * the sheet loads, in load order, by specificity.
 *
 * I have twice "fixed" the counter figures by writing rules and reasoning about
 * what they would override. This resolves the cascade instead: every matching
 * rule, sorted the way a browser sorts them, and the value that survives.
 */
import fs from 'fs';

const MOD = 'c:/Users/Jonkm/AppData/Local/FoundryVTT/Data/modules/a5e-mancer/';

/* Load order matters and is declared in module.json. quadrone.css is vendored
   and pulled in by the Tidy module itself, before ours. */
const SHEETS = [
  ['quadrone.css', MOD + 'tidy/quadrone.css'],
  ...JSON.parse(fs.readFileSync(MOD + 'module.json', 'utf8')).styles
      .map(s => [s, MOD + s])
];

/* A rule is a selector plus a flat declaration block. Nested blocks (& …) are
   flattened against their parent so they are counted too. */
function rules(src, file) {
  /* Comments out first. A comment that happens to contain "display: flex" was
     being read as a declaration — the check was reporting on its own prose. */
  src = src.split('/*').map((p, i) => i === 0 ? p : p.slice(p.indexOf('*/') + 2)).join(' ');
  const out = [];
  let i = 0;
  const walk = (from, to, prefix) => {
    let j = from;
    while (j < to) {
      const open = src.indexOf('{', j);
      if (open < 0 || open >= to) break;
      const sel = src.slice(j, open).trim();
      let d = 0, k = open;
      for (; k < to; k++) {
        if (src[k] === '{') d++;
        else if (src[k] === '}') { d--; if (!d) break; }
      }
      const body = src.slice(open + 1, k);
      if (/^@/.test(sel)) {
        /* at-rule: descend, keeping the prefix */
        if (/^@(media|supports|layer|container)/.test(sel)) walk(open + 1, k, prefix);
      } else {
        const full = prefix
          ? sel.split(',').map(s => s.trim().replace(/^&/, '').trim())
               .flatMap(s => prefix.map(p => (s.startsWith(':') ? p + s : p + ' ' + s)))
          : sel.split(',').map(s => s.trim());
        /* declarations at this level only */
        const flat = body.replace(/[^{}]*\{[^{}]*\}/g, '');
        if (flat.trim()) out.push({ file, sels: full, decls: flat, order: out.length });
        if (/\{/.test(body)) walk(open + 1, k, full);
      }
      j = k + 1;
    }
  };
  walk(0, src.length, null);
  return out;
}

function specificity(sel) {
  let a = 0, b = 0, c = 0;
  let s = sel.replace(/::?[a-z-]+(\([^)]*\))?/g, (m) =>
    /^::/.test(m) ? (c++, '') : (/:(is|where|not|has)\(/.test(m) ? m : (b++, '')));
  s = s.replace(/:where\([^)]*\)/g, '');
  s = s.replace(/:(?:is|not|has)\(([^)]*)\)/g, (_m, inner) => {
    const best = inner.split(',').map(x => specificity(x.trim()))
      .sort((p, q) => q[0] - p[0] || q[1] - p[1] || q[2] - p[2])[0] ?? [0, 0, 0];
    a += best[0]; b += best[1]; c += best[2];
    return '';
  });
  a += (s.match(/#[\w-]+/g) ?? []).length;
  b += (s.match(/\.[\w-]+/g) ?? []).length;
  b += (s.match(/\[[^\]]+\]/g) ?? []).length;
  c += (s.replace(/[#.][\w-]+/g, '').match(/\b[a-z][\w-]*/gi) ?? []).length;
  return [a, b, c];
}

/* The element under test, described as the set of simple selectors that match
   it and the chain of ancestors above it. */
function matches(sel, el) {
  const parts = sel.trim().split(/\s+(?![^(]*\))/);
  const last = parts[parts.length - 1];
  const hits = (piece, node) => {
    const bits = piece.match(/(::?[a-z-]+(\([^)]*\))?|\.[\w-]+|#[\w-]+|\[[^\]]+\]|^[a-z]+)/gi) ?? [];
    return bits.every(bit => {
      if (bit.startsWith('::')) return false;               // pseudo-element: not this box
      if (bit.startsWith(':')) {
        if (/^:(hover|focus|active|focus-within|focus-visible)/.test(bit)) return false;
        if (/^:(where|is)\(/.test(bit)) {
          const inner = bit.slice(bit.indexOf('(') + 1, -1);
          return inner.split(',').some(x => hits(x.trim(), node));
        }
        if (/^:not\(/.test(bit)) {
          const inner = bit.slice(5, -1);
          return !inner.split(',').some(x => hits(x.trim(), node));
        }
        return true;                                        // structural: assume yes
      }
      if (bit.startsWith('.')) return node.classes.includes(bit.slice(1));
      if (bit.startsWith('#')) return node.id === bit.slice(1);
      if (bit.startsWith('[')) {
        const m = bit.match(/\[([\w-]+)(?:([~^|$*]?=)"?([^\]"]*)"?)?\]/);
        if (!m) return true;
        const v = node.attrs?.[m[1]];
        return m[2] ? v === m[3] : v !== undefined;
      }
      return node.tag === bit.toLowerCase();
    });
  };
  if (!hits(last, el.self)) return false;
  /* ancestors, in order, allowing gaps (descendant combinator only) */
  let ai = el.ancestors.length - 1;
  for (let p = parts.length - 2; p >= 0; p--) {
    if (parts[p] === '>' || parts[p] === '+' || parts[p] === '~') continue;
    let found = false;
    while (ai >= 0) {
      if (hits(parts[p], el.ancestors[ai])) { found = true; ai--; break; }
      ai--;
    }
    if (!found) return false;
  }
  return true;
}

const ROOT = { tag: 'div', classes: ['tidy5e-sheet','application','sheet','actor','character',
  'quadrone','themed','theme-dark','a5e-mancer-sheet','app','window-app'] };
const target = process.argv[2] ?? 'value';

const CASES = {
  value: { self: { tag: 'input', classes: ['value','uninput','am-tracker-value'],
                   id: 'am-exertion-current', attrs: { type: 'number' } },
           ancestors: [ROOT, { tag:'header', classes:['sheet-header'] },
                       { tag:'div', classes:['am-tracker-row'] },
                       { tag:'div', classes:['am-a5e-stat','am-tracker','am-tracker-exertion'] },
                       { tag:'div', classes:['meter','progress','am-tracker-meter'] },
                       { tag:'div', classes:['label'] }] },
  max:   { self: { tag: 'span', classes: ['max'], attrs: {} },
           ancestors: [ROOT, { tag:'header', classes:['sheet-header'] },
                       { tag:'div', classes:['am-tracker-row'] },
                       { tag:'div', classes:['am-a5e-stat','am-tracker','am-tracker-exertion'] },
                       { tag:'div', classes:['meter','progress','am-tracker-meter'] },
                       { tag:'div', classes:['label'] }] },
  sep:   { self: { tag: 'span', classes: ['separator'], attrs: {} },
           ancestors: [ROOT, { tag:'header', classes:['sheet-header'] },
                       { tag:'div', classes:['am-tracker-row'] },
                       { tag:'div', classes:['am-a5e-stat','am-tracker','am-tracker-exertion'] },
                       { tag:'div', classes:['meter','progress','am-tracker-meter'] },
                       { tag:'div', classes:['label'] }] },
  label: { self: { tag: 'div', classes: ['label'], attrs: {} },
           ancestors: [ROOT, { tag:'header', classes:['sheet-header'] },
                       { tag:'div', classes:['am-tracker-row'] },
                       { tag:'div', classes:['am-a5e-stat','am-tracker','am-tracker-exertion'] },
                       { tag:'div', classes:['meter','progress','am-tracker-meter'] }] }
};

const el = CASES[target];
if (!el) { console.error('cases: ' + Object.keys(CASES).join(', ')); process.exit(1); }

const all = [];
let base = 0;
for (const [name, path] of SHEETS) {
  if (!fs.existsSync(path)) { console.log(`(missing ${name})`); continue; }
  const rs = rules(fs.readFileSync(path, 'utf8'), name);
  for (const r of rs) { r.order += base; all.push(r); }
  base += rs.length + 1;
}

const WATCH = ['font-size','font-family','font-weight','line-height','font-variant-numeric',
               'padding','padding-block','padding-inline','border','border-width','height',
               'width','box-sizing','vertical-align','text-align','appearance','field-sizing',
               'background','background-color','align-items','display','margin'];

const winners = new Map();
for (const r of all) {
  for (const sel of r.sels) {
    if (!matches(sel, el)) continue;
    const spec = specificity(sel);
    for (const m of r.decls.matchAll(/([-a-z]+)\s*:\s*([^;]+);?/g)) {
      const prop = m[1].trim();
      if (!WATCH.includes(prop)) continue;
      const important = /!important/.test(m[2]);
      const rank = [important ? 1 : 0, ...spec, r.order];
      const cur = winners.get(prop);
      if (!cur || cmp(rank, cur.rank) >= 0)
        winners.set(prop, { rank, value: m[2].replace('!important','').trim(), sel, file: r.file });
    }
  }
}
function cmp(a, b) { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i]; return 0; }

console.log(`winning declarations for: ${target}\n`);
for (const p of WATCH) {
  const w = winners.get(p);
  if (!w) continue;
  console.log(`  ${p.padEnd(20)} ${w.value.slice(0, 46).padEnd(48)} ${w.file}`);
  console.log(`  ${''.padEnd(20)} ${w.sel.trim().replace(/\s+/g,' ').slice(-90)}`);
}
