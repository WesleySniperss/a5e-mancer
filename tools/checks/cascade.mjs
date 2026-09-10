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

/* A selector list is separated by commas — but only the commas OUTSIDE any
   parentheses.

   Splitting on every comma is how this check spent its whole life lying. Tidy
   ships minified, and nearly every rule in it is written

     .tidy5e-sheet.quadrone :is(button,.button).button.button-icon-only…

   which a plain split cuts into `.tidy5e-sheet.quadrone :is(button` and
   `.button)…`. The first fragment has an unterminated pseudo-class, the
   matcher reads `:is` as a structural pseudo it cannot evaluate and assumes
   yes — and so a rule for one specific button matched every element asked
   about. `width: 1.375rem` and `pointer-events: none` were being reported as
   the winners on the AC shield from a rule about spell-slot buttons.

   Everything this check has ever said about a Tidy rule was suspect for that
   reason. */
function splitList(sel) {
  const out = [];
  let depth = 0, start = 0;
  for (let i = 0; i < sel.length; i++) {
    const c = sel[i];
    if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (c === ',' && depth === 0) { out.push(sel.slice(start, i).trim()); start = i + 1; }
  }
  out.push(sel.slice(start).trim());
  return out.filter(Boolean);
}

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
          ? splitList(sel).map(s => s.replace(/^&/, '').trim())
               .flatMap(s => prefix.map(p => (s.startsWith(':') ? p + s : p + ' ' + s)))
          : splitList(sel);
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
        /* A structural pseudo this cannot evaluate — :nth-child and the
           like — is assumed to match, which is the right way to be wrong
           about those. But an UNTERMINATED one is a parse failure, not a
           selector, and must never be read as a match. */
        if (/^:(is|where|not|has)$/.test(bit)) return false;
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

/* The NPC sheet is the same sheet with `npc` in place of `character` and one
   extra class of its own. Tidy scopes part of the vitals block to
   :where(.quadrone.actor):where(.npc), and a whole section of this module's
   own stylesheet is still scoped to .a5e-mancer-npc-sheet from the design
   before this one — so what wins here is not what wins on a character, and
   reasoning about it from the character sheet has been wrong twice. */
const NPC_ROOT = { tag: 'div', classes: ['tidy5e-sheet','application','sheet','actor','npc',
  'quadrone','themed','theme-dark','a5e-mancer-sheet','a5e-mancer-npc-sheet','app','window-app'] };
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
                       { tag:'div', classes:['meter','progress','am-tracker-meter'] }] },

  /* The AC badge, on both sheets. Reported as changing shape while the sheet
     is dragged: the art is a background scaled to contain, and if nothing
     holds the box to the picture's proportions the box and the picture part
     company as the column changes width. */
  shield: { self: { tag: 'div', classes: ['shield'], attrs: { 'data-attribution': 'attributes.ac' } },
            ancestors: [ROOT, { tag:'div', classes:['ac-container'] }] },
  npcshield: { self: { tag: 'div', classes: ['shield'], attrs: { 'data-attribution': 'attributes.ac' } },
               ancestors: [NPC_ROOT, { tag:'div', classes:['ac-container'] }] },

  /* The padlock, on the NPC sheet, where clicking it is reported to do
     nothing. The handler is bound and the flag flips when it is called, so
     what is left is whether the click ever reaches the button. */
  npclock: { self: { tag: 'button', classes: ['button','button-icon-only','button-borderless'],
                     attrs: { 'data-action': 'toggle-lock', type: 'button' } },
             ancestors: [NPC_ROOT, { tag:'section', classes:['window-content'] },
                         { tag:'header', classes:['sheet-header'] },
                         { tag:'div', classes:['actor-details'] },
                         { tag:'div', classes:['actor-details-name-row'] },
                         { tag:'div', classes:['sheet-header-actions','flexrow'] }] },
  npccontent: { self: { tag: 'section', classes: ['window-content'], attrs: {} },
                ancestors: [NPC_ROOT] },

  /* One spell slot, as a star on a level heading. It is a <button>, and Tidy
     gives every button in the sheet a min-height, a border and a transition —
     all three have to lose here or the stars come out field-height, boxed and
     animating under the pointer. */
  slot: { self: { tag: 'button', classes: ['am-slot'],
                  attrs: { 'data-action': 'slot-pip', type: 'button' } },
          ancestors: [ROOT, { tag:'section', classes:['tidy-table'] },
                      { tag:'header', classes:['tidy-table-header-row'] },
                      { tag:'div', classes:['tidy-table-header-cell','primary'] },
                      { tag:'span', classes:['am-slots'] }] }
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
               'background','background-color','align-items','display','margin',
               /* what makes a wired button unclickable */
               'pointer-events','z-index','position','inset','top','right','overflow',
               /* what holds a background-image badge to the shape of its art */
               'aspect-ratio','min-height','max-height','min-width','max-width',
               'background-size','transition','flex','flex-basis'];

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
