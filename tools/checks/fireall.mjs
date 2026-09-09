/* Fire every action handler the sheet binds, and see what each one does.
 *
 * Static checks have twice told me a control was dead when it was not, and once
 * the other way. So this clicks them: build a DOM from the sheet's own HTML,
 * bind the listeners, then for each element carrying a data-action, call its
 * handlers and record whether anything happened — a document write, an a5e API
 * call, a re-render — or nothing at all.
 *
 * "Nothing at all" is not proof of a bug: a handler can legitimately decline
 * (an already-known maneuver, a value unchanged). It is a list of places to
 * look, which is all a check ever is.
 */
import './stubs.mjs';
import Handlebars from 'handlebars';
import { readFileSync } from 'fs';
import { parse } from 'parse5';

globalThis.CONFIG = { A5E: { itemRarity:{}, bonusTypes:{abilities:'a'}, bonusLabels:{},
  skills:{}, abilities:{}, conditions:{}, actorSizes:{}, creatureTypes:{},
  terrainTypes:{}, languages:{}, damageTypes:{}, filters:{objects:{}},
  ROLL_MODE:{ PUBLIC:'publicroll' }, reducerSortMap:{ object:{ weapon:0, armor:1,
    shield:2, ammunition:3, container:4, consumable:5, tool:6, jewelry:7,
    clothing:8, miscellaneous:9 } }, classes:{}, spellLevels:{}, objectTypesPlural:{} } };
globalThis.game = { user:{isGM:true, id:'u1'}, packs:new Collection(),
  modules:new Collection(), i18n:{localize:(k)=>k, format:(k)=>k, has:()=>false},
  settings:{get:()=>{throw new Error('x');}, register(){}},
  a5e:{utils:{getDeterministicBonus:(f)=>Number(f)||0}}, system:{id:'a5e'} };
globalThis.fromUuidSync = () => null;
globalThis.fromUuid = async () => null;
globalThis.TextEditor = { enrichHTML: async (h) => h };
globalThis.Roll = class { constructor(f){ this.f=f; } async evaluate(){ return this; }
  async toMessage(){ effects.push('chat message'); return this; } get total(){ return 7; } };
globalThis.ChatMessage = { create: async () => { effects.push('chat message'); } };

const R = 'c:/Users/Jonkm/AppData/Local/FoundryVTT/Data/modules/a5e-mancer/';
await import('file:///' + R + 'scripts/a5e-mancer.js');
const { A5eCharacterSheet } = await import('file:///' + R + 'scripts/app/A5eCharacterSheet.js');
Handlebars.registerHelper('eq', (a,b)=>a===b);
Handlebars.registerHelper('localize', (k)=>String(k??''));
['concat','numberFormat'].forEach(h=>Handlebars.registerHelper(h,()=>''));
Handlebars.registerPartial('tidy-table', readFileSync(R+'templates/sheet/partial-tidy-table.hbs','utf8'));
Handlebars.registerPartial('tidy-row',   readFileSync(R+'templates/sheet/partial-tidy-row.hbs','utf8'));
const tpl = Handlebars.compile(readFileSync(R+'templates/sheet/tidy-character-sheet.hbs','utf8'));

let effects = [];
const listeners = [];
function build(node, parent = null) {
  const attrs = Object.fromEntries((node.attrs ?? []).map(a => [a.name, a.value]));
  const el = { tag: node.nodeName, parent,
    classes: (attrs.class ?? '').split(/\s+/).filter(Boolean), id: attrs.id ?? '', attrs,
    dataset: Object.fromEntries(Object.entries(attrs).filter(([k]) => k.startsWith('data-'))
      .map(([k, v]) => [k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase()), v])),
    children: [], value: attrs.value ?? '1', textContent: '', innerHTML: '',
    style: { setProperty(){} }, checked: 'checked' in attrs,
    classList: { add(){}, remove(){}, toggle(){}, contains: c => el.classes.includes(c) },
    addEventListener(type, fn) { listeners.push({ el, type, fn }); },
    removeEventListener(){}, remove(){}, appendChild(){}, insertAdjacentHTML(){},
    setAttribute(){}, getAttribute: k => attrs[k] ?? null, focus(){}, blur(){}, click(){},
    getBoundingClientRect: () => ({ width:100, height:20, top:0, left:0 }),
    querySelector(s){ return q(el, s)[0] ?? null; }, querySelectorAll(s){ return q(el, s); },
    closest(s){ let n = el; while (n) { if (one(n, s)) return n; n = n.parent; } return null; } };
  for (const c of node.childNodes ?? []) {
    if (c.nodeName === '#text' || c.nodeName === '#comment') continue;
    el.children.push(build(c, el));
  }
  return el;
}
function one(el, piece) {
  for (const part of piece.split(',').map(s => s.trim())) {
    const bits = part.match(/(\.[\w-]+|#[\w-]+|\[[^\]]+\]|^[a-z]+)/gi) ?? [];
    if (!bits.length) continue;
    if (bits.every(b => {
      if (b.startsWith('.')) return el.classes.includes(b.slice(1));
      if (b.startsWith('#')) return el.id === b.slice(1);
      if (b.startsWith('[')) { const m = b.match(/\[([\w-]+)(?:=["']?([^\]"']*)["']?)?\]/);
        if (!m) return false; const v = el.attrs[m[1]];
        return m[2] === undefined ? v !== undefined : v === m[2]; }
      return el.tag === b.toLowerCase(); })) return true;
  }
  return false;
}
function q(root, sel) { const out = [];
  for (const alt of sel.split(',').map(s => s.trim())) { let level = [root];
    for (const p of alt.split(/\s+/).filter(Boolean)) { const next = [];
      for (const n of level) coll(n, p, next); level = next; }
    for (const n of level) if (!out.includes(n)) out.push(n); }
  return out; }
function coll(node, piece, into) {
  for (const c of node.children) { if (one(c, piece)) into.push(c); coll(c, piece, into); } }

const chars = JSON.parse(readFileSync('./world-chars.json','utf8'));
const pick = chars.slice().sort((a,b)=>b.items.length-a.items.length)[0];
const raw = pick.actor;

/* An item that answers every a5e method we might reach for, recording the call. */
const wrap = (i) => {
  const it = { id:i._id, uuid:'Actor.'+raw._id+'.Item.'+i._id, name:i.name, type:i.type,
    img:i.img, system:JSON.parse(JSON.stringify(i.system ?? {})), flags:i.flags??{},
    effects:new Collection(), actions:new Collection(Object.entries(i.system?.actions??{})),
    getFlag:()=>undefined, _stats:{}, parent:null,
    toObject:()=>({ ...i }), toDragData:()=>({ type:'Item', uuid:it.uuid }) };
  for (const m of ['activate','configureItem','shareItemDescription','toggleAttunement',
                   'toggleDamagedState','toggleEquippedState','updateContainer','use',
                   'roll','toChat','share','delete','update','toMessage'])
    it[m] = async () => { effects.push(`item.${m}`); return it; };
  return it;
};

const actor = {
  id: raw._id, uuid:'Actor.'+raw._id, name: raw.name, type: raw.type, isOwner: true,
  img:'p.png', flags: JSON.parse(JSON.stringify(raw.flags ?? {})),
  system: JSON.parse(JSON.stringify(raw.system)),
  items: new Collection(pick.items.map(i => [i._id, wrap(i)])),
  effects: new Collection(), statuses: new Set(),
  getFlag: (s,k) => actor.flags?.[s]?.[k],
  setFlag: async () => { effects.push('actor.setFlag'); return actor; },
  update: async () => { effects.push('actor.update'); return actor; },
  createEmbeddedDocuments: async () => { effects.push('createEmbeddedDocuments'); return []; },
  updateEmbeddedDocuments: async () => { effects.push('updateEmbeddedDocuments'); return []; },
  getRollData: () => ({}), spellBooks:{ first:()=>null, values:()=>[] }
};
for (const m of ['addBonus','applyDamage','applyHealing','configureAbilityScore',
                 'configureBonus','configureSkill','deleteBonus','duplicateBonus',
                 'rollAbilityCheck','rollSavingThrow','rollSkillCheck','rollInitiative',
                 'toggleStatusEffect','triggerRest','configureSenses','configureLanguages',
                 'configureWeaponProficiencies','configureArmorProficiencies',
                 'configureToolProficiencies','configureDamageImmunities',
                 'configureDamageResistances','configureDamageVulnerabilities',
                 'configureConditionImmunities'])
  actor[m] = async () => { effects.push(`actor.${m}`); return actor; };

const sheet = new A5eCharacterSheet(actor);
sheet._actor = actor;
sheet.render = () => { effects.push('render'); };
const html = tpl(await sheet.getData());
const root = build(parse(html));
sheet.activateListeners(root);

/* Every element carrying a data-action, one of each action. */
const seen = new Map();
(function walk(n) {
  const a = n.attrs?.['data-action'];
  if (a && !seen.has(a)) seen.set(a, n);
  for (const c of n.children) walk(c);
})(root);

const silent = [], threw = [], worked = [];
for (const [action, el] of [...seen].sort()) {
  const fns = listeners.filter(l => l.el === el && (l.type === 'click' || l.type === 'change'));
  if (!fns.length) { silent.push([action, 'no listener on this element']); continue; }
  effects = [];
  let error = null;
  for (const l of fns) {
    const ev = { preventDefault(){}, stopPropagation(){}, currentTarget: el, target: el,
                 clientX: 0, clientY: 0, shiftKey: false, ctrlKey: false, button: 0 };
    try { await l.fn(ev); } catch (e) { error = e.message; }
  }
  if (error) threw.push([action, error]);
  else if (!effects.length) silent.push([action, 'ran, changed nothing']);
  else worked.push([action, effects.join(', ')]);
}

console.log(`${seen.size} distinct actions drawn on this character\n`);
console.log(`did something : ${worked.length}`);
console.log(`threw         : ${threw.length}`);
console.log(`silent        : ${silent.length}\n`);
for (const [a, e] of threw)  console.log(`  THREW   ${a.padEnd(24)} ${e}`);
for (const [a, w] of silent) console.log(`  silent  ${a.padEnd(24)} ${w}`);
