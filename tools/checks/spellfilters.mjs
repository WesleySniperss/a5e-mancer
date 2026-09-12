/* The filters in the spell window, pressed.
 *
 * Reported as: you cannot choose criteria, only the display order, and almost
 * nothing changes. The data behind the window turned out to be sound — a5e's
 * pack gives 895 spells with every level, all eight schools and 62 tags — so
 * the question left is whether the buttons that choose between them are drawn
 * and whether pressing one does anything.
 *
 * Level and school sit in the window's left column; sort sits in the toolbar
 * over the list. If the first were missing or inert, sort is exactly what would
 * be left, which is what was described.
 */
import './stubs.mjs';
import Handlebars from 'handlebars';
import { readFileSync } from 'fs';
import { parse } from 'parse5';
import { ClassicLevel } from 'classic-level';
import { build, listeners, q } from './lib/sheetdom.mjs';
import { registerSheetPartials } from './lib/partials.mjs';

const R = 'c:/Users/Jonkm/AppData/Local/FoundryVTT/Data/modules/a5e-mancer/';

/* a5e's own spells, and its own list of which classes have a list at all. */
const db = new ClassicLevel(R + 'packcopy2/spells', { valueEncoding: 'json' });
const docs = [];
for await (const [key, v] of db.iterator()) {
  if (key.startsWith('!items!') && !key.includes('.')) docs.push(v);
}
await db.close();

const sys = readFileSync('c:/Users/Jonkm/AppData/Local/FoundryVTT/Data/systems/a5e/a5e.js', 'utf8');
const readBlock = (name) => {
  const at = sys.indexOf(name + ' = {');
  if (at < 0) return {};
  const open = sys.indexOf('{', at);
  let d = 0, k = open;
  for (; k < sys.length; k++) { if (sys[k] === '{') d++; else if (sys[k] === '}') { d--; if (!d) break; } }
  return Object.fromEntries([...sys.slice(open, k).matchAll(/^\s*([A-Za-z]+):\s*"([^"]+)"/gm)]
    .map((m) => [m[1], m[2]]));
};

globalThis.CONFIG = { A5E: {
  classSpellLists: readBlock('classSpellLists'),
  spellSchools: { primary: readBlock('spellSchools') , secondary: {} },
  spellLevels: {}, itemRarity: {}, filters: { objects: {} }
} };
/* spellSchools is nested; read its primary half directly. */
{
  const at = sys.indexOf('spellSchools = {');
  const p = sys.indexOf('primary: {', at);
  const open = sys.indexOf('{', p);
  let d = 0, k = open;
  for (; k < sys.length; k++) { if (sys[k] === '{') d++; else if (sys[k] === '}') { d--; if (!d) break; } }
  CONFIG.A5E.spellSchools.primary = Object.fromEntries(
    [...sys.slice(open, k).matchAll(/([A-Za-z]+):\s*"([^"]+)"/g)].map((m) => [m[1], m[2]]));
}

globalThis.game = {
  i18n: { localize: (s) => String(s).split('.').pop(), format: (s) => s, has: () => false },
  packs: new Collection(), modules: new Collection(), user: { isGM: true, id: 'u1' },
  settings: { get: () => { throw new Error('x'); }, register() {} },
  system: { id: 'a5e' }, a5e: { utils: { getDeterministicBonus: () => 0 } }
};
globalThis.fromUuid = async () => null;
globalThis.fromUuidSync = () => null;
globalThis.TextEditor = { enrichHTML: async (h) => h };

const pack = {
  collection: 'a5e.spells',
  metadata: { label: 'Spells', type: 'Item', id: 'a5e.spells' },
  documentName: 'Item',
  index: new Collection(docs.map((x) => [x._id, { _id: x._id, name: x.name, type: x.type, img: x.img }])),
  async getIndex(opts) {
    if (opts?.fields) throw new Error('Cannot add property price, object is not extensible');
    return this.index;
  },
  async getDocuments({ _id__in } = {}) {
    const want = _id__in ? new Set(_id__in) : null;
    return docs.filter((x) => !want || want.has(x._id))
               .map((x) => ({ ...x, uuid: `Compendium.a5e.spells.Item.${x._id}` }));
  }
};
game.packs = new Collection([['a5e.spells', pack]]);

Handlebars.registerHelper('eq', (a, b) => a === b);
Handlebars.registerHelper('localize', (k, opts) => {
  const s = String(k ?? '').split('.').pop();
  return opts?.hash?.n !== undefined ? `${s} ${opts.hash.n}` : s;
});
['concat', 'numberFormat'].forEach((h) => Handlebars.registerHelper(h, () => ''));
registerSheetPartials(R);
const tpl = Handlebars.compile(readFileSync(R + 'templates/spell-dialog.hbs', 'utf8'));

const { SpellDialog } = await import('file:///' + R + 'scripts/app/SpellDialog.js');

const actor = { id: 'a1', uuid: 'Actor.a1', name: 'Test', type: 'character',
  items: new Collection(), system: {}, flags: {}, isOwner: true,
  getFlag: () => undefined, getRollData: () => ({}) };

const dialog = new SpellDialog(actor, { className: 'Wizard', maxSpellLevel: 9,
  manage: true, cantripsToChoose: -1, spellsToChoose: -1 });

/* Render once, the way Foundry would: context, template, DOM, listeners. */
let root;
const draw = async () => {
  const ctx = await dialog._prepareContext({});
  root = build(parse(tpl(ctx)));
  dialog.element = root;
  listeners.length = 0;
  await dialog._onRender(ctx, {});
  return ctx;
};
/* render(false) inside a handler redraws in the real window; here it is the
   check that redraws, after the handler has set the state. */
dialog.render = () => {};

const results = [];
const check = (name, ok, detail) => results.push([name, ok, detail]);

let ctx = await draw();
const cards = (r) => q(r, '.am-spell-card').length || q(r, '[data-uuid]').length;

check('the window offers levels to choose from', (ctx.levels ?? []).length > 1,
  `${(ctx.levels ?? []).length} level buttons: ${(ctx.levels ?? []).join(', ')}`);
check('and schools', (ctx.schools ?? []).length > 1,
  `${(ctx.schools ?? []).length} school buttons`);
check('and the buttons are actually drawn',
  q(root, '.am-level-btn').length > 1 && q(root, '.am-school-btn').length > 1,
  `${q(root, '.am-level-btn').length} level, ${q(root, '.am-school-btn').length} school in the markup`);

const fire = async (el) => {
  for (const l of listeners.filter((x) => x.el === el && x.type === 'click'))
    await l.fn({ preventDefault(){}, stopPropagation(){}, currentTarget: el, target: el });
};

/* Choosing a level must narrow the list. */
{
  const before = ctx.visibleSpells.length;
  const btn = q(root, '.am-level-btn').find((b) => b.dataset.level === '3');
  const bound = listeners.filter((x) => x.el === btn && x.type === 'click').length;
  if (btn) await fire(btn);
  ctx = await draw();
  check('a level button is bound', bound > 0, `${bound} listener(s)`);
  check('choosing a level narrows the list',
    ctx.visibleSpells.length > 0 && ctx.visibleSpells.length < before,
    `${before} spells -> ${ctx.visibleSpells.length} at level 3`);
  check('and every one of them is that level',
    ctx.visibleSpells.every((s) => s.level === 3),
    ctx.visibleSpells.every((s) => s.level === 3) ? 'all level 3'
      : `${ctx.visibleSpells.filter((s) => s.level !== 3).length} are not`);
  /* Off again. */
  const again = q(root, '.am-level-btn').find((b) => b.dataset.level === '3');
  if (again) await fire(again);
  ctx = await draw();
  check('and pressing it again clears it', ctx.visibleSpells.length === before,
    `back to ${ctx.visibleSpells.length}`);
}

/* Choosing a school must narrow it too, and by school. */
{
  const before = ctx.visibleSpells.length;
  const btn = q(root, '.am-school-btn').find((b) => b.dataset.school === 'evocation');
  const bound = listeners.filter((x) => x.el === btn && x.type === 'click').length;
  if (btn) await fire(btn);
  ctx = await draw();
  check('a school button is bound', bound > 0, `${bound} listener(s)`);
  check('choosing a school narrows the list',
    ctx.visibleSpells.length > 0 && ctx.visibleSpells.length < before,
    `${before} spells -> ${ctx.visibleSpells.length} in evocation`);
  check('and every one of them is that school',
    ctx.visibleSpells.every((s) => s.school === 'evocation'),
    ctx.visibleSpells.every((s) => s.school === 'evocation') ? 'all evocation'
      : `${ctx.visibleSpells.filter((s) => s.school !== 'evocation').length} are not`);
}

let bad = 0;
for (const [name, ok, detail] of results) {
  if (!ok) bad++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name.padEnd(40)} ${detail}`);
}
console.log(bad ? `\n${bad} thing(s) the spell window will not let you choose`
                : `\nthe spell window's filters are drawn, bound, and narrow the list`);
process.exit(bad ? 1 : 0);
