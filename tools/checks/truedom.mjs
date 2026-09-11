/* activateListeners against a DOM that answers like a real one.
 *
 * Every harness here has had the same blind spot: the element stub returned a
 * node for EVERY querySelector, where a browser returns null for anything not
 * in the markup. 49 of the selectors this sheet asks for match nothing on a
 * real character — and any of those results used without ?. throws, killing
 * every listener bound after it. The padlock is bound at line 2544, which is a
 * long way down that list.
 *
 * So: parse the HTML the sheet actually renders, and answer queries from it. */
import './stubs.mjs';
import Handlebars from 'handlebars';
import { readFileSync } from 'fs';
import { parse } from 'parse5';
import { registerSheetPartials } from './lib/partials.mjs';

globalThis.CONFIG = { A5E: { bonusTypes:{}, bonusLabels:{}, skills:{}, abilities:{},
  conditions:{}, actorSizes:{}, creatureTypes:{}, terrainTypes:{}, languages:{},
  damageTypes:{}, filters:{objects:{}}, ROLL_MODE:{}, reducerSortMap:{}, classes:{},
  spellLevels:{} } };
globalThis.game = { user:{isGM:true}, packs:new Collection(), modules:new Collection(),
  i18n:{localize:(k)=>k, format:(k)=>k, has:()=>false},
  settings:{get:()=>{throw new Error('unregistered');}, register(){}},
  a5e:{utils:{getDeterministicBonus:(f)=>Number(f)||0}}, system:{id:'a5e'} };
globalThis.fromUuidSync = () => null;
globalThis.fromUuid = async () => null;
globalThis.TextEditor = { enrichHTML: async (h) => h };

const R = 'c:/Users/Jonkm/AppData/Local/FoundryVTT/Data/modules/a5e-mancer/';
await import('file:///' + R + 'scripts/a5e-mancer.js');
const { A5eCharacterSheet } = await import('file:///' + R + 'scripts/app/A5eCharacterSheet.js');

Handlebars.registerHelper('eq', (a,b)=>a===b);
Handlebars.registerHelper('localize', (k)=>String(k??''));
['concat','numberFormat'].forEach(h=>Handlebars.registerHelper(h,()=>''));
/* Every partial the module registers, read from the module. Naming them by
   hand here is what broke all four of these checks the day a third one was
   added. */
registerSheetPartials(R);
const tpl = Handlebars.compile(readFileSync(R+'templates/sheet/tidy-character-sheet.hbs','utf8'));

/* ── A very small DOM over the parsed tree ───────────────────────────────── */
function build(node, parent = null) {
  const attrs = Object.fromEntries((node.attrs ?? []).map(a => [a.name, a.value]));
  const el = {
    tag: node.nodeName, parent,
    classes: (attrs.class ?? '').split(/\s+/).filter(Boolean),
    id: attrs.id ?? '',
    attrs,
    dataset: Object.fromEntries(Object.entries(attrs)
      .filter(([k]) => k.startsWith('data-'))
      .map(([k, v]) => [k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase()), v])),
    children: [],
    value: attrs.value ?? '', textContent: '', innerHTML: '', style: { setProperty(){} },
    checked: 'checked' in attrs,
    classList: { add(){}, remove(){}, toggle(){}, contains: (c) => el.classes.includes(c) },
    addEventListener(){}, removeEventListener(){}, remove(){}, appendChild(){},
    insertAdjacentHTML(){}, setAttribute(){}, getAttribute: (k) => attrs[k] ?? null,
    focus(){}, blur(){}, click(){},
    getBoundingClientRect: () => ({ width: 100, height: 20, top: 0, left: 0 }),
    querySelector(sel) { return query(el, sel)[0] ?? null; },
    querySelectorAll(sel) { return query(el, sel); },
    closest(sel) { let n = el; while (n) { if (matchOne(n, sel)) return n; n = n.parent; } return null; }
  };
  for (const c of node.childNodes ?? []) {
    if (c.nodeName === '#text' || c.nodeName === '#comment') continue;
    el.children.push(build(c, el));
  }
  return el;
}
function matchOne(el, piece) {
  for (const part of piece.split(',').map(s => s.trim())) {
    const bits = part.match(/(\.[\w-]+|#[\w-]+|\[[^\]]+\]|^[a-z]+)/gi) ?? [];
    if (!bits.length) continue;
    const ok = bits.every(b => {
      if (b.startsWith('.')) return el.classes.includes(b.slice(1));
      if (b.startsWith('#')) return el.id === b.slice(1);
      if (b.startsWith('[')) {
        const m = b.match(/\[([\w-]+)(?:=["']?([^\]"']*)["']?)?\]/);
        if (!m) return false;
        const v = el.attrs[m[1]];
        return m[2] === undefined ? v !== undefined : v === m[2];
      }
      return el.tag === b.toLowerCase();
    });
    if (ok) return true;
  }
  return false;
}
/* Descendant selectors only, which is all this sheet uses. */
function query(root, sel) {
  const out = [];
  for (const alt of sel.split(',').map(s => s.trim())) {
    const parts = alt.split(/\s+/).filter(Boolean);
    let level = [root];
    for (const p of parts) {
      const next = [];
      for (const n of level) collect(n, p, next);
      level = next;
    }
    for (const n of level) if (!out.includes(n)) out.push(n);
  }
  return out;
}
function collect(node, piece, into) {
  for (const c of node.children) {
    if (matchOne(c, piece)) into.push(c);
    collect(c, piece, into);
  }
}

const wrap = (i) => ({ id:i._id, uuid:'Item.'+i._id, name:i.name, type:i.type, img:i.img,
  system:i.system??{}, flags:i.flags??{}, effects:new Collection(),
  actions:new Collection(Object.entries(i.system?.actions??{})),
  getFlag:()=>undefined, _stats:{} });

const chars = JSON.parse(readFileSync('./world-chars.json','utf8'));
let bad = 0;
for (const locked of [true, false]) {
  for (const { actor: raw, items } of chars) {
    const actor = { id:raw._id, uuid:'Actor.'+raw._id, name:raw.name, type:raw.type,
      isOwner:true, img:'p.png', flags:{ a5e:{ sheetIsLocked: locked } }, system:raw.system,
      items:new Collection(items.map(i=>[i._id,wrap(i)])), effects:new Collection(),
      statuses:new Set(),
      getFlag:(s,k)=> (s==='a5e' && k==='sheetIsLocked') ? locked : undefined,
      getRollData:()=>({}), spellBooks:{first:()=>null, values:()=>[]} };
    const sheet = new A5eCharacterSheet(actor); sheet._actor = actor;
    const html = tpl(await sheet.getData());
    const doc = parse(html);
    const root = build(doc);
    try {
      sheet.activateListeners(root);
    } catch (e) {
      console.log(`${locked ? 'locked  ' : 'unlocked'} ${raw.name}: ${e.constructor.name}: ${e.message}`);
      const frame = (e.stack ?? '').split('\n').find(l => l.includes('A5eCharacterSheet'));
      if (frame) console.log('    ' + frame.trim());
      bad++;
      break;      // one report per state is enough
    }
  }
}
console.log(bad ? `\n${bad} state(s) throw before the listeners are done`
                : '\nactivateListeners survives a DOM that answers honestly');
process.exit(bad ? 1 : 0);
