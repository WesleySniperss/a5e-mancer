/* A DOM that answers honestly, holding a real character from the world.
 *
 * This was the body of fireall.mjs. It is here because more than one check now
 * needs to drive the actual sheet: render the real template with a real actor,
 * bind the real activateListeners, then press things and watch what happens.
 * A static check says where to look; only this says what is true.
 *
 * What it is not: a browser. Layout, CSS and focus do not exist here. It
 * answers questions about wiring — is this element there, does this listener
 * reach it, does the click write what it claims to write.
 */
import '../stubs.mjs';
import Handlebars from 'handlebars';
import { readFileSync } from 'fs';
import { parse } from 'parse5';

export const R = 'c:/Users/Jonkm/AppData/Local/FoundryVTT/Data/modules/a5e-mancer/';

/* ── what the sheet's code reaches for on the way past ──────────────────── */

let effects = [];
/** Note that something happened — a write, an API call, a re-render. */
export const record = (what) => { effects.push(what); };
/** Everything recorded since the last call, and start again. */
export const takeEffects = () => { const e = effects; effects = []; return e; };

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
  async toMessage(){ record('chat message'); return this; } get total(){ return 7; } };
globalThis.ChatMessage = { create: async () => { record('chat message'); } };

/* ── a node tree with working selectors ─────────────────────────────────── */

/** Every listener anyone bound, so a check can call them by hand. */
export const listeners = [];

export function build(node, parent = null) {
  const attrs = Object.fromEntries((node.attrs ?? []).map(a => [a.name, a.value]));
  const el = { tag: node.nodeName, parent,
    classes: (attrs.class ?? '').split(/\s+/).filter(Boolean), id: attrs.id ?? '', attrs,
    dataset: Object.fromEntries(Object.entries(attrs).filter(([k]) => k.startsWith('data-'))
      .map(([k, v]) => [k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase()), v])),
    children: [], value: attrs.value ?? '1', textContent: '', innerHTML: '',
    style: { setProperty(){} }, checked: 'checked' in attrs,
    addEventListener(type, fn) { listeners.push({ el, type, fn }); },
    removeEventListener(){}, remove(){}, appendChild(){}, insertAdjacentHTML(){},
    setAttribute(){}, getAttribute: k => attrs[k] ?? null, focus(){}, blur(){}, click(){},
    getBoundingClientRect: () => ({ width:100, height:20, top:0, left:0 }),
    querySelector(s){ return q(el, s)[0] ?? null; }, querySelectorAll(s){ return q(el, s); },
    closest(s){ let n = el; while (n) { if (one(n, s)) return n; n = n.parent; } return null; } };
  /* A real classList, because checks now assert on what a handler toggles. */
  el.classList = {
    add(...c){ for (const x of c) if (!el.classes.includes(x)) el.classes.push(x); },
    remove(...c){ el.classes = el.classes.filter(x => !c.includes(x)); },
    contains: c => el.classes.includes(c),
    toggle(c, force){
      const on = force === undefined ? !el.classes.includes(c) : !!force;
      if (on) el.classList.add(c); else el.classList.remove(c);
      return on;
    },
    replace(a, b){ if (!el.classes.includes(a)) return false;
      el.classes = el.classes.map(x => x === a ? b : x); return true; }
  };
  /* Tolerate text nodes so .textContent means something: a row's name is read
     out of the markup by more than one handler now. */
  let text = '';
  for (const c of node.childNodes ?? []) {
    if (c.nodeName === '#text') { text += c.value ?? ''; continue; }
    if (c.nodeName === '#comment') continue;
    el.children.push(build(c, el));
  }
  Object.defineProperty(el, 'textContent', {
    get(){ return text + el.children.map(c => c.textContent).join(''); },
    set(v){ text = String(v); el.children.length = 0; }
  });
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
export function q(root, sel) { const out = [];
  for (const alt of sel.split(',').map(s => s.trim())) { let level = [root];
    for (const p of alt.split(/\s+/).filter(Boolean)) { const next = [];
      for (const n of level) coll(n, p, next); level = next; }
    for (const n of level) if (!out.includes(n)) out.push(n); }
  return out; }
function coll(node, piece, into) {
  for (const c of node.children) { if (one(c, piece)) into.push(c); coll(c, piece, into); } }

/* ── the sheet itself ───────────────────────────────────────────────────── */

/**
 * Render the sheet for a real character and bind its listeners.
 * @param {object} [opts]
 * @param {(chars: any[]) => any} [opts.choose]  which character; the one with
 *        the most items by default, because it draws the most markup.
 */
export async function buildSheet(opts = {}) {
  await import('file:///' + R + 'scripts/a5e-mancer.js');
  const { A5eCharacterSheet } = await import('file:///' + R + 'scripts/app/A5eCharacterSheet.js');

  Handlebars.registerHelper('eq', (a, b) => a === b);
  Handlebars.registerHelper('localize', (k) => String(k ?? ''));
  ['concat', 'numberFormat'].forEach(h => Handlebars.registerHelper(h, () => ''));
  Handlebars.registerPartial('tidy-table', readFileSync(R + 'templates/sheet/partial-tidy-table.hbs', 'utf8'));
  Handlebars.registerPartial('tidy-row',   readFileSync(R + 'templates/sheet/partial-tidy-row.hbs', 'utf8'));
  const tpl = Handlebars.compile(readFileSync(R + 'templates/sheet/tidy-character-sheet.hbs', 'utf8'));

  const chars = JSON.parse(readFileSync(R + 'world-chars.json', 'utf8'));
  const choose = opts.choose ?? ((c) => c.slice().sort((a, b) => b.items.length - a.items.length)[0]);
  const pick = choose(chars);
  const raw = pick.actor;

  /* An item that answers every a5e method we might reach for, recording it. */
  const wrap = (i) => {
    const it = { id:i._id, uuid:'Actor.'+raw._id+'.Item.'+i._id, name:i.name, type:i.type,
      img:i.img, system:JSON.parse(JSON.stringify(i.system ?? {})), flags:i.flags??{},
      effects:new Collection(), actions:new Collection(Object.entries(i.system?.actions??{})),
      getFlag:()=>undefined, _stats:{}, parent:null,
      toObject:()=>({ ...i }), toDragData:()=>({ type:'Item', uuid:it.uuid }) };
    for (const m of ['activate','configureItem','shareItemDescription','toggleAttunement',
                     'toggleDamagedState','toggleEquippedState','updateContainer','use',
                     'roll','toChat','share','delete','update','toMessage'])
      it[m] = async () => { record(`item.${m}`); return it; };
    return it;
  };

  /* The actor records the path of every write, because a handler that writes
     the wrong path is indistinguishable from one that works until you look. */
  const writes = [];
  const actor = {
    id: raw._id, uuid:'Actor.'+raw._id, name: raw.name, type: raw.type, isOwner: true,
    img:'p.png', flags: JSON.parse(JSON.stringify(raw.flags ?? {})),
    system: JSON.parse(JSON.stringify(raw.system)),
    items: new Collection(pick.items.map(i => [i._id, wrap(i)])),
    effects: new Collection(), statuses: new Set(),
    getFlag: (s,k) => actor.flags?.[s]?.[k],
    setFlag: async () => { record('actor.setFlag'); return actor; },
    update: async (data) => { writes.push(data); record('actor.update'); return actor; },
    createEmbeddedDocuments: async () => { record('createEmbeddedDocuments'); return []; },
    updateEmbeddedDocuments: async () => { record('updateEmbeddedDocuments'); return []; },
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
    actor[m] = async () => { record(`actor.${m}`); return actor; };

  const sheet = new A5eCharacterSheet(actor);
  sheet._actor = actor;
  sheet.render = () => { record('render'); };

  /* Rendering again matters: a control whose markup depends on the actor —
     the spell-slot stars, the padlock's two states — can only be judged by
     changing the actor and looking at the sheet a second time. */
  const render = async () => {
    const root = build(parse(tpl(await sheet.getData())));
    sheet.activateListeners(root);
    takeEffects();                     // rendering is not a finding
    return root;
  };

  return { sheet, actor, writes, render, root: await render(), character: raw.name };
}

/** A plausible enough event for a handler that only wants the element. */
export const eventOn = (el, extra = {}) => ({
  preventDefault(){}, stopPropagation(){}, currentTarget: el, target: el,
  clientX: 0, clientY: 0, shiftKey: false, ctrlKey: false, button: 0, ...extra
});

/** Call every listener of these types bound to `el`. */
export async function fire(el, types = ['click']) {
  const list = listeners.filter(l => l.el === el && types.includes(l.type));
  for (const l of list) await l.fn(eventOn(el));
  return list.length;
}
