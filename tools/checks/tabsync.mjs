/* For every real character and a spread of real NPCs: what does a5e hold, and
   what do our Bonuses and Notes tabs actually render? Anything a5e stores with
   content that never reaches the screen is a sync failure. */
import './stubs.mjs';
import Handlebars from 'handlebars';
import { readFileSync } from 'fs';
import { parse } from 'parse5';

/* The real configuration, taken from a5e's source rather than invented. */
globalThis.CONFIG = { A5E: {
  bonusTypes: {
    abilities: 'A5E.abilities.headings.ability', attacks: 'A5E.Attack',
    damage: 'A5E.damage.title', exertion: 'A5E.exertion.title',
    healing: 'A5E.healing.title', hitPoint: 'A5E.hitPoints.title',
    initiative: 'A5E.initiative.title', movement: 'A5E.details.movement.title',
    senses: 'A5E.senses.title', skills: 'A5E.skillLabels.title'
  },
  bonusLabels: {}, skills:{}, abilities:{}, conditions:{}, actorSizes:{},
  creatureTypes:{}, terrainTypes:{}, languages:{}, filters:{objects:{}},
  ROLL_MODE:{}, reducerSortMap:{}, classes:{}, spellLevels:{}
} };
globalThis.game = { user:{isGM:true}, packs:new Collection(), modules:new Collection(),
  i18n:{localize:(k)=>k, format:(k)=>k, has:()=>false},
  settings:{get:()=>{throw new Error('x');}, register(){}},
  a5e:{utils:{getDeterministicBonus:(f)=>Number(f)||0}}, system:{id:'a5e'} };
globalThis.fromUuidSync = () => null;
globalThis.fromUuid = async () => null;
globalThis.TextEditor = { enrichHTML: async (h) => h };

const R = 'c:/Users/Jonkm/AppData/Local/FoundryVTT/Data/modules/a5e-mancer/';
await import('file:///' + R + 'scripts/a5e-mancer.js');
const { A5eCharacterSheet } = await import('file:///' + R + 'scripts/app/A5eCharacterSheet.js');
const { A5eNPCSheet } = await import('file:///' + R + 'scripts/app/A5eNPCSheet.js');

Handlebars.registerHelper('eq', (a,b)=>a===b);
Handlebars.registerHelper('localize', (k)=>String(k??''));
['concat','numberFormat'].forEach(h=>Handlebars.registerHelper(h,()=>''));
Handlebars.registerPartial('tidy-table', readFileSync(R+'templates/sheet/partial-tidy-table.hbs','utf8'));
Handlebars.registerPartial('tidy-row',   readFileSync(R+'templates/sheet/partial-tidy-row.hbs','utf8'));
const charTpl = Handlebars.compile(readFileSync(R+'templates/sheet/tidy-character-sheet.hbs','utf8'));
const npcTpl  = Handlebars.compile(readFileSync(R+'templates/sheet/npc-sheet.hbs','utf8'));

function tabText(html, tab) {
  const doc = parse(html);
  let found = null;
  (function walk(n){ if(found) return;
    const a=(n.attrs??[]).find(x=>x.name==='data-tab-contents-for');
    if(a?.value===tab){found=n;return;}
    for(const c of n.childNodes??[]) walk(c); })(doc);
  if (!found) return null;
  let text=''; let inputs=0;
  (function walk(n){
    if(n.nodeName==='#text') text+=n.value;
    if(n.nodeName==='input'||n.nodeName==='textarea') inputs++;
    for(const c of n.childNodes??[]) walk(c); })(found);
  return { text: text.replace(/\s+/g,' ').trim(), inputs };
}

const wrap=(i)=>({ id:i._id, uuid:'Item.'+i._id, name:i.name, type:i.type, img:i.img,
  system:i.system??{}, flags:i.flags??{}, effects:new Collection(),
  actions:new Collection(Object.entries(i.system?.actions??{})), getFlag:()=>undefined, _stats:{} });

const chars = JSON.parse(readFileSync('./world-chars.json','utf8'));
const BIO = ['bio','notes','privateNotes','appearance','bonds','flaws','ideals','goals'];
const missing = Object.fromEntries(BIO.map(k=>[k,0]));
const held    = Object.fromEntries(BIO.map(k=>[k,0]));
let bonusEmpty = 0, bonusWithData = 0, dcShown = 0;

for (const { actor: raw, items } of chars) {
  const actor = { id:raw._id, uuid:'Actor.'+raw._id, name:raw.name, type:raw.type, isOwner:true,
    img:'p.png', flags:raw.flags??{}, system:raw.system,
    items:new Collection(items.map(i=>[i._id,wrap(i)])), effects:new Collection(),
    statuses:new Set(), getFlag:()=>undefined, getRollData:()=>({}),
    spellBooks:{first:()=>null, values:()=>[]} };
  const sheet = new A5eCharacterSheet(actor); sheet._actor = actor;
  const ctx = await sheet.getData();
  const html = charTpl(ctx);

  const notes = tabText(html, 'notes') ?? { text:'', inputs:0 };
  const det = raw.system?.details ?? {};
  for (const k of BIO) {
    const v = String(det[k] ?? '').replace(/<[^>]+>/g,'').trim();
    if (!v) continue;
    held[k]++;
    const probe = v.slice(0, 24).replace(/\s+/g,' ');
    if (!notes.text.includes(probe)) missing[k]++;
  }

  const bon = tabText(html, 'bonuses') ?? { text:'', inputs:0 };
  const anyBonus = ['abilities','movement','senses','hitPoint','skills','damage','attacks']
    .some(k => Object.keys(raw.system?.bonuses?.[k] ?? {}).length);
  if (anyBonus) { bonusWithData++; if (!/Ability|Movement|Senses|Hit Point|Skill/i.test(bon.text)
      && bon.text.replace(/Global Bonuses|Maneuver DC|Spell DC/g,'').trim().length < 4) bonusEmpty++; }
  if (/Maneuver DC/.test(bon.text) && /Spell DC/.test(bon.text)) dcShown++;
}

console.log(`${chars.length} characters\n`);
console.log('bio fields a5e holds with content, and how often they never reach the Notes tab:');
for (const k of BIO) console.log(`  ${k.padEnd(14)} held by ${String(held[k]).padStart(2)}   not shown on ${missing[k]}`);
console.log(`\nBonuses tab: DC fields present on ${dcShown}/${chars.length}`);
console.log(`  characters with real bonus entries: ${bonusWithData}, of which the tab shows nothing: ${bonusEmpty}`);
