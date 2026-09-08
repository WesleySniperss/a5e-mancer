/* Every switch on the Settings tab, and the padlock: write what the handler
   writes, then rebuild the context and see whether the sheet reads it back.
   A switch that writes to a path nothing reads looks exactly like a switch that
   does nothing. */
import './stubs.mjs';
import { readFileSync } from 'fs';

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

const setProp = (o, p, v) => {
  const parts = p.split('.'); let cur = o;
  for (let i = 0; i < parts.length - 1; i++) cur = (cur[parts[i]] ??= {});
  cur[parts.at(-1)] = v;
};
const getProp = (o, p) => p.split('.').reduce((x, k) => x?.[k], o);

const chars = JSON.parse(readFileSync('./world-chars.json','utf8'));
const { actor: raw, items } = chars.find(c => c.items.length > 40) ?? chars[0];
const wrap = (i) => ({ id:i._id, uuid:'Item.'+i._id, name:i.name, type:i.type, img:i.img,
  system:i.system??{}, flags:i.flags??{}, effects:new Collection(),
  actions:new Collection(), getFlag:()=>undefined, _stats:{} });

function makeActor() {
  const a = {
    id: raw._id, uuid: 'Actor.' + raw._id, name: raw.name, type: raw.type, isOwner: true,
    img: 'p.png',
    flags: JSON.parse(JSON.stringify(raw.flags ?? {})),
    system: JSON.parse(JSON.stringify(raw.system)),
    items: new Collection(items.map(i => [i._id, wrap(i)])),
    effects: new Collection(), statuses: new Set(),
    getFlag: (s, k) => a.flags?.[s]?.[k],
    setFlag: async (s, k, v) => { setProp(a, `flags.${s}.${k}`, v); return a; },
    update: async (data) => { for (const [k, v] of Object.entries(data)) setProp(a, k, v); return a; },
    getRollData: () => ({}), spellBooks: { first: () => null, values: () => [] }
  };
  return a;
}

const ctxOf = async (actor) => {
  const s = new A5eCharacterSheet(actor);
  s._actor = actor;
  return s.getData();
};

/* Collect every switch the context offers, from the context itself. */
const probe = await ctxOf(makeActor());
const rows = [
  ...(probe.settings?.sheet ?? []),
  ...(probe.settings?.automation ?? []),
  ...(probe.settings?.inventory ?? [])
].filter(r => r.path && typeof r.on === 'boolean');
const numbers = (probe.settings?.numbers ?? []).filter(r => r.path);

console.log(`${rows.length} boolean switches, ${numbers.length} numeric settings\n`);

let bad = 0;
for (const row of rows) {
  const actor = makeActor();
  const before = (await ctxOf(actor));
  const find = (c) => [...(c.settings?.sheet ?? []), ...(c.settings?.automation ?? []),
                       ...(c.settings?.inventory ?? [])].find(r => r.path === row.path);
  const was = find(before).on;
  /* what the handler does */
  await actor.update({ [row.path]: !was });
  const after = find(await ctxOf(actor));
  if (after.on === was) {
    console.log(`DEAD  ${row.path}`);
    console.log(`      wrote ${!was}, the sheet still reads ${after.on}`);
    bad++;
  }
}

for (const row of numbers) {
  const actor = makeActor();
  const target = 17;
  await actor.update({ [row.path]: target });
  const after = (await ctxOf(actor)).settings.numbers.find(r => r.path === row.path);
  if (Number(after?.value) !== target) {
    console.log(`DEAD  ${row.path}`);
    console.log(`      wrote ${target}, the sheet reads ${after?.value}`);
    bad++;
  }
}

/* The padlock writes the same kind of flag. */
{
  const actor = makeActor();
  const before = (await ctxOf(actor)).unlocked;
  await actor.setFlag('a5e', 'sheetIsLocked', !(actor.flags?.a5e?.sheetIsLocked ?? true));
  const after = (await ctxOf(actor)).unlocked;
  console.log(`\npadlock: unlocked ${before} -> ${after}  ${before === after ? 'DEAD' : 'ok'}`);
  if (before === after) bad++;
}

console.log(bad ? `\n${bad} control(s) write where the sheet does not read`
                : `\nevery switch round-trips`);
process.exit(bad ? 1 : 0);
