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

async function renderWith(flags, resources, tweak) {
  const raw = JSON.parse(JSON.stringify(base.actor));
  raw.flags = { ...(raw.flags ?? {}), a5e: { ...(raw.flags?.a5e ?? {}), ...flags } };
  if (resources) raw.system.resources = resources;
  if (tweak) tweak(raw.system);
  const actor = { id:raw._id, uuid:'Actor.'+raw._id, name:raw.name, type:raw.type,
    isOwner:true, img:'p.png', flags:raw.flags, system:raw.system,
    items:new Collection(base.items.map(i=>[i._id, wrap(i, raw._id)])),
    effects:new Collection(), statuses:new Set(),
    getFlag:(s,k)=>raw.flags?.[s]?.[k], getRollData:()=>({}),
    spellBooks:{first:()=>null, values:()=>[]} };
  const sheet = new A5eCharacterSheet(actor); sheet._actor = actor;
  return tpl(await sheet.getData());
}

/* Every switch the Settings tab draws, taken from the sheet's own context
   rather than from a list kept here.

   The list WAS kept here, and it held six. The sheet drew twenty-two. The
   ones it did not name were never tested, and two of them were the problem:
   `trackInventoryWeight` was offered and read nowhere at all, and
   `showSpellSlots` was read and offered nowhere. A check that names its own
   subjects only ever finds what it was already looking for.

   Which groups must move the page:

     sheet      all of them. That group exists to say what this sheet draws.
     inventory  the two about display — the weight column and whether weight
                is tracked at all. The other two change a5e's arithmetic.

   automation, rest and rolls are a5e's own behaviour. A tick there correctly
   changes nothing here, and they are listed at the end rather than failed. */

/* Some switches can only show their effect on a character that has the thing
   they govern. a5e derives slot maxima at prepare time, so one read out of
   the world has none and the stars would be absent either way. */
const SEEDED = {
  hideGenericResources: { resources: { primary: { label: 'Rage', value: 1, max: '3' } } },
  showSpellSlots: { system: (sys) => {
    sys.spellResources = sys.spellResources ?? {};
    sys.spellResources.slots = { ...(sys.spellResources.slots ?? {}),
      '3': { current: 2, max: 4, override: 0 } };
  } }
};

const MUST_SHOW = {
  sheet: () => true,
  inventory: (flag) => flag === 'showWeightColumn' || flag === 'trackInventoryWeight'
};

/* What the sheet itself says it offers. */
const probe = await (async () => {
  const raw = JSON.parse(JSON.stringify(base.actor));
  const actor = { id:raw._id, uuid:'Actor.'+raw._id, name:raw.name, type:raw.type,
    isOwner:true, img:'p.png', flags:raw.flags ?? {}, system:raw.system,
    items:new Collection(base.items.map(i=>[i._id, wrap(i, raw._id)])),
    effects:new Collection(), statuses:new Set(),
    getFlag:(s,k)=>raw.flags?.[s]?.[k], getRollData:()=>({}),
    spellBooks:{first:()=>null, values:()=>[]} };
  const sheet = new A5eCharacterSheet(actor); sheet._actor = actor;
  return (await sheet.getData()).settings ?? {};
})();

const flagOf = (row) => String(row.path ?? '').replace(/^flags\.a5e\./, '');

/* Everything BEFORE the Settings tab.

   Ticking a switch always changes the Settings tab, because the checkbox that
   was ticked redraws with a `checked` on it. The first version of this
   compared whole pages and so reported every switch as changing seven
   characters of markup — its own — including the ones that do nothing at all.
   A check that cannot tell the difference between an effect and its own
   reflection is worse than none. */
const outside = (html) => {
  const at = html.indexOf('data-tab-contents-for="settings"');
  return at < 0 ? html : html.slice(0, at);
};

let dead = 0;
const quiet = [];
console.log('switch                              effect on the sheet');
for (const group of ['sheet', 'inventory', 'automation', 'rest', 'rolls']) {
  for (const row of probe[group] ?? []) {
    const flag = flagOf(row);
    if (!row.path?.startsWith('flags.a5e.')) continue;   // a system field, not a flag
    const seed = SEEDED[flag] ?? {};
    const on  = outside(await renderWith({ ...seed.also, [flag]: true  }, seed.resources, seed.system));
    const off = outside(await renderWith({ ...seed.also, [flag]: false }, seed.resources, seed.system));
    const moves = on !== off;
    const required = (MUST_SHOW[group] ?? (() => false))(flag);

    if (!moves && required) { dead++;
      console.log(`  ${row.label.padEnd(34)} NONE — and this group promises one`);
    } else if (moves) {
      console.log(`  ${row.label.padEnd(34)} ${Math.abs(on.length - off.length)} characters of markup`);
    } else {
      quiet.push(row.label);
    }
  }
}

if (quiet.length) {
  console.log(`\n  these change a5e's behaviour and correctly not this page:`);
  for (const q of quiet) console.log(`    ${q}`);
}

/* And the other direction: a display switch a5e has that we never offer is a
   switch that silently does not exist here. */
const OFFERED = new Set(Object.values(probe).flat().map(flagOf));
const A5E_DISPLAY = ['showSpellTab', 'showManeuverTab', 'showFavoritesSection',
  'showPassiveScores', 'showXP', 'hideGenericResources', 'showSpellSlots',
  'showWeightColumn', 'trackInventoryWeight'];
const missing = A5E_DISPLAY.filter((f) => !OFFERED.has(f));
if (missing.length) {
  dead += missing.length;
  console.log(`\n  a5e has these and this sheet offers no switch for them:`);
  for (const m of missing) console.log(`    ${m}`);
}

console.log(dead ? `\n${dead} switch(es) this sheet claims and does not honour`
                 : `\nevery switch this sheet claims changes what it draws`);
process.exit(dead ? 1 : 0);
