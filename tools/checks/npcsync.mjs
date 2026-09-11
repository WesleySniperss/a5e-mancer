/* An NPC sync audit: for a spread of real monsters, which fields a5e holds with
   content never reach the rendered sheet. */
import './stubs.mjs';
import Handlebars from 'handlebars';
import { readFileSync } from 'fs';
import { ClassicLevel } from 'classic-level';
import { registerSheetPartials } from './lib/partials.mjs';

globalThis.CONFIG = { A5E: {
  bonusTypes: { abilities:'a', attacks:'b', damage:'c', exertion:'d', healing:'e',
                hitPoint:'f', initiative:'g', movement:'h', senses:'i', skills:'j' },
  bonusLabels:{}, skills:{}, abilities:{}, conditions:{}, actorSizes:{},
  creatureTypes:{}, terrainTypes:{}, languages:{}, damageTypes:{}, filters:{objects:{}},
  ROLL_MODE:{}, reducerSortMap:{}, classes:{}, spellLevels:{} } };
globalThis.game = { user:{isGM:true}, packs:new Collection(), modules:new Collection(),
  i18n:{localize:(k)=>k, format:(k)=>k, has:()=>false},
  settings:{get:()=>{throw new Error('x');}, register(){}},
  a5e:{utils:{getDeterministicBonus:(f)=>Number(f)||0}}, system:{id:'a5e'} };
globalThis.fromUuidSync = () => null;
globalThis.fromUuid = async () => null;
globalThis.TextEditor = { enrichHTML: async (h) => h };

const R = 'c:/Users/Jonkm/AppData/Local/FoundryVTT/Data/modules/a5e-mancer/';
await import('file:///' + R + 'scripts/a5e-mancer.js');
const { A5eNPCSheet } = await import('file:///' + R + 'scripts/app/A5eNPCSheet.js');

Handlebars.registerHelper('eq', (a,b)=>a===b);
Handlebars.registerHelper('localize', (k)=>String(k??''));
['concat','numberFormat'].forEach(h=>Handlebars.registerHelper(h,()=>''));
/* Every partial the module registers, read from the module. Naming them by
   hand here is what broke all four of these checks the day a third one was
   added. */
registerSheetPartials(R);
const tpl = Handlebars.compile(readFileSync(R+'templates/sheet/npc-sheet.hbs','utf8'));

const db = new ClassicLevel('./packcopy2/monsters', { valueEncoding: 'json' });
const actors = new Map(), itemsBy = new Map();
for await (const [k, v] of db.iterator()) {
  const p = k.split('!')[1];
  if (p === 'actors') actors.set(v._id, v);
  if (p === 'actors.items') {
    const o = k.split('!')[2].split('.')[0];
    if (!itemsBy.has(o)) itemsBy.set(o, []);
    itemsBy.get(o).push(v);
  }
}
await db.close();

const all = [...actors.values()];
console.log(`${all.length} NPCs in a5e's pack`);
const shape = all.filter(a => a.system?.details?.isShapechanger).length;
console.log(`  carrying isShapechanger: ${shape}`);
for (const k of ['damageImmunities','damageResistances','damageVulnerabilities','conditionImmunities']) {
  const n = all.filter(a => (a.system?.traits?.[k] ?? []).length).length;
  console.log(`  with ${k}: ${n}`);
}

const wrap=(i)=>({ id:i._id, uuid:'Item.'+i._id, name:i.name, type:i.type, img:i.img,
  system:i.system??{}, flags:i.flags??{}, effects:new Collection(),
  actions:new Collection(Object.entries(i.system?.actions??{})), getFlag:()=>undefined, _stats:{} });

/* A spread: shapechangers, immunity carriers, and a plain one. */
const picks = [
  all.find(a => a.system?.details?.isShapechanger),
  all.find(a => (a.system?.traits?.damageImmunities ?? []).length >= 2),
  all.find(a => (a.system?.traits?.conditionImmunities ?? []).length >= 2),
  all.find(a => a.name === 'Adult Red Dragon')
].filter(Boolean);

const missing = {};
for (const raw of picks) {
  const items = itemsBy.get(raw._id) ?? [];
  const actor = { id:raw._id, uuid:'Actor.'+raw._id, name:raw.name, type:'npc', isOwner:true,
    img:'p.png', flags:raw.flags??{}, system:raw.system,
    items:new Collection(items.map(i=>[i._id,wrap(i)])), effects:new Collection(),
    statuses:new Set(), getFlag:()=>undefined, getRollData:()=>({}),
    spellBooks:{first:()=>null, values:()=>[]} };
  const sheet = new A5eNPCSheet(actor); sheet._actor = actor;
  const html = tpl(await sheet.getData());
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

  const checks = {
    isShapechanger: raw.system?.details?.isShapechanger ? 'shapechanger' : null,
    damageImmunities: (raw.system?.traits?.damageImmunities ?? [])[0],
    damageResistances: (raw.system?.traits?.damageResistances ?? [])[0],
    damageVulnerabilities: (raw.system?.traits?.damageVulnerabilities ?? [])[0],
    conditionImmunities: (raw.system?.traits?.conditionImmunities ?? [])[0],
    notes: String(raw.system?.details?.notes ?? '').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim().slice(0,20),
    bio: String(raw.system?.details?.bio ?? '').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim().slice(0,20)
  };
  for (const [k, probe] of Object.entries(checks)) {
    if (!probe) continue;
    if (!text.toLowerCase().includes(String(probe).toLowerCase())) {
      (missing[k] ??= []).push(raw.name);
    }
  }
}
console.log('\nfields held with content that never reach the NPC sheet:');
const keys = Object.keys(missing);
if (!keys.length) console.log('  none');
for (const k of keys) console.log(`  ${k.padEnd(24)} ${missing[k].join(', ')}`);
