/* Does each switch on the Settings tab actually CHANGE the sheet?
 *
 * roundtrip.mjs proved a checkbox remembers its own state. That is a different
 * question, and answering it was not enough: showSpellTab and showManeuverTab
 * round-tripped perfectly while doing nothing, because the sheet computed
 * `flag || hasItems` — which lets a flag add a tab and never take one away.
 *
 * This flips each switch, renders the sheet both ways, and reports whether the
 * HTML differs. A switch whose two renders are identical does nothing here.
 *
 * Run from the scratch directory, where world-chars.json is.
 */
import './stubs.mjs';
import Handlebars from 'handlebars';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { registerSheetPartials } from './lib/partials.mjs';

const R = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..') + path.sep;

globalThis.CONFIG = { A5E: { itemRarity:{}, bonusTypes:{}, bonusLabels:{}, skills:{},
  abilities:{}, conditions:{}, actorSizes:{}, creatureTypes:{}, terrainTypes:{},
  languages:{}, damageTypes:{}, filters:{objects:{}}, ROLL_MODE:{},
  reducerSortMap:{ object:{ weapon:0, armor:1, shield:2, ammunition:3, container:4,
    consumable:5, tool:6, jewelry:7, clothing:8, miscellaneous:9 } },
  classes:{}, spellLevels:{}, objectTypesPlural:{} } };
globalThis.game = { user:{isGM:true}, packs:new Collection(), modules:new Collection(),
  i18n:{localize:(k)=>k, format:(k)=>k, has:()=>false},
  settings:{get:()=>{throw new Error('x');}, register(){}},
  a5e:{utils:{getDeterministicBonus:(f)=>Number(f)||0}}, system:{id:'a5e'} };
globalThis.fromUuidSync = () => null;
globalThis.fromUuid = async () => null;
globalThis.TextEditor = { enrichHTML: async (h) => h };

const { A5eCharacterSheet } = await import('file:///' + R + 'scripts/app/A5eCharacterSheet.js');
Handlebars.registerHelper('eq', (a,b)=>a===b);
Handlebars.registerHelper('localize', (k)=>String(k??''));
['concat','numberFormat'].forEach(h=>Handlebars.registerHelper(h,()=>''));
/* Every partial the module registers, read from the module. Naming them by
   hand here is what broke all four of these checks the day a third one was
   added. */
registerSheetPartials(R);
const tpl = Handlebars.compile(readFileSync(R+'templates/sheet/tidy-character-sheet.hbs','utf8'));

const wrap = (i, o) => ({ id:i._id, uuid:'Actor.'+o+'.Item.'+i._id, name:i.name,
  type:i.type, img:i.img, system:i.system??{}, flags:i.flags??{},
  effects:new Collection(), actions:new Collection(Object.entries(i.system?.actions??{})),
  getFlag:()=>undefined, _stats:{} });

const chars = JSON.parse(readFileSync('./world-chars.json', 'utf8'));
/* A character carrying enough that most switches have something to act on. */
const base = chars.slice().sort((a,b)=>b.items.length-a.items.length)[0];

async function renderWith(flags, resources) {
  const raw = JSON.parse(JSON.stringify(base.actor));
  raw.flags = { ...(raw.flags ?? {}), a5e: { ...(raw.flags?.a5e ?? {}), ...flags } };
  if (resources) raw.system.resources = resources;
  const actor = { id:raw._id, uuid:'Actor.'+raw._id, name:raw.name, type:raw.type,
    isOwner:true, img:'p.png', flags:raw.flags, system:raw.system,
    items:new Collection(base.items.map(i=>[i._id, wrap(i, raw._id)])),
    effects:new Collection(), statuses:new Set(),
    getFlag:(s,k)=>raw.flags?.[s]?.[k], getRollData:()=>({}),
    spellBooks:{first:()=>null, values:()=>[]} };
  const sheet = new A5eCharacterSheet(actor); sheet._actor = actor;
  return tpl(await sheet.getData());
}

/* The four this sheet is meant to act on itself. The rest belong to a5e and
   change its behaviour, not this sheet's appearance — they are listed at the
   end rather than failed. */
const OURS = [
  { flag: 'showSpellTab',          label: 'Show the spell tab' },
  { flag: 'showManeuverTab',       label: 'Show the maneuver tab' },
  { flag: 'showFavoritesSection',  label: 'Show the Favorites section' },
  { flag: 'showXP',                label: 'Show experience' },
  { flag: 'showPassiveScores',     label: 'Show passive scores' },
  { flag: 'hideGenericResources',  label: 'Hide the generic resources',
    resources: { primary: { label:'Rage', value:1, max:'3' } } }
];

let dead = 0;
console.log(`switch                        effect on the sheet`);
for (const s of OURS) {
  const on  = await renderWith({ [s.flag]: true  }, s.resources);
  const off = await renderWith({ [s.flag]: false }, s.resources);
  const same = on === off;
  if (same) dead++;
  console.log(`  ${s.label.padEnd(28)} ${same ? 'NONE — the switch does nothing'
    : `${Math.abs(on.length - off.length)} characters of markup`}`);
}
console.log(dead ? `\n${dead} switch(es) this sheet claims and does not honour`
                 : `\nevery switch this sheet claims changes what it draws`);
process.exit(dead ? 1 : 0);
