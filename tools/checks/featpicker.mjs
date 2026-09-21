/* Does "Add Feat" on the Features tab offer a5e's feats, and can they be
 * filtered, read and taken?
 *
 * First reported as: opening it shows "No feat compendiums found" with the
 * compendiums enabled. The window had a loader of its own that kept entries
 * of type `feat` (a5e's packs never use it) and asked getIndex to fold
 * `system` into an index Foundry had already built, which throws on a5e's
 * packs. Then reported as: no filter, no prerequisites, not even a proper
 * list - it was a plain dialog with a name search over a column of rows. It
 * is FeatDialog now, the level-up's picker in a window of its own.
 *
 * This opens it against a5e's real feats pack, served by a stand-in that
 * behaves as Foundry does on that pack: the plain index carries only _id,
 * name, type and img, and asking it for more throws.
 *
 * Needs packcopy2/feats - a copy of systems/a5e/packs/feats with LOCK removed.
 */
import { ClassicLevel } from 'classic-level';
import Handlebars from 'handlebars';
import { readFileSync } from 'fs';
import { pathToFileURL } from 'url';
import { buildSheet, listeners, q, R } from './lib/sheetdom.mjs';

const results = [];
const check = (name, ok, detail) => results.push([name, ok, detail]);

const db = new ClassicLevel(R + 'packcopy2/feats', { valueEncoding: 'json' });
const docs = [];
for await (const [k, v] of db.iterator()) if (k.startsWith('!items!')) docs.push(v);
await db.close();
check('a5e’s feats pack was read', docs.length > 600, `${docs.length} documents`);

const collection = 'a5e.a5e-feats';
const pack = {
  collection,
  metadata: { type: 'Item', name: 'a5e-feats', label: 'A5E Feats' },
  index: docs.map((d) => Object.freeze({ _id: d._id, name: d.name, type: d.type, img: d.img })),
  async getIndex(opts) {
    if (opts?.fields) throw new TypeError('Cannot add property price, object is not extensible');
    return this.index;
  },
  async getDocuments(query = {}) {
    const ids = query._id__in ? new Set(query._id__in) : null;
    return docs.filter((d) => !ids || ids.has(d._id))
      .map((d) => ({ ...d, id: d._id, uuid: `Compendium.${collection}.Item.${d._id}`, toObject: () => ({ ...d }) }));
  }
};
game.packs = new Collection([[collection, pack]]);
game.packs.filter = (f) => [...game.packs.values()].filter(f);

const warned = [];
ui.notifications.warn = (m) => warned.push(m);
ui.notifications.info = () => {};

const { FeatDialog } = await import(pathToFileURL(R + 'scripts/app/FeatDialog.js').href);
const opened = [];
FeatDialog.prototype.render = function () { opened.push(this); return this; };

const { root, actor } = await buildSheet();
const button = q(root, '[data-action="open-feat-picker"]')[0];
check('the Features tab draws the Add Feat button', !!button, button ? 'found' : 'missing');
for (const l of listeners.filter((x) => x.el === button && x.type === 'click'))
  await l.fn({ preventDefault(){}, stopPropagation(){}, currentTarget: button, target: button });
const dialog = opened[0];
check('it opens the feat picker for this character', dialog instanceof FeatDialog && dialog.actor === actor,
  dialog ? dialog.constructor.name : 'nothing opened');
if (!dialog) { report(); }

const feats = docs.filter((d) => d.type === 'feature' && d.system?.featureType === 'feat');
const all = async () => {
  const names = [];
  let ctx = await dialog._prepareContext({});
  for (let p = 0; p < ctx.featPages; p++) {
    dialog._page = p;
    ctx = await dialog._prepareContext({});
    names.push(...ctx.feats.map((f) => f.name));
  }
  dialog._page = 0;
  return { names, ctx: await dialog._prepareContext({}) };
};

dialog._onlyEligible = false;
let { names, ctx } = await all();
check('opening it raises no "no feats" warning', warned.length === 0 && !ctx.noneLoaded && !ctx.failed, warned[0] ?? 'none');
check('with every filter off it lists every feat in the pack, 40 to a page',
  ctx.featTotal === feats.length && names.length === feats.length && ctx.feats.length === 40,
  `${ctx.featTotal} listed, ${feats.length} feats in the pack, ${ctx.featPages} pages`);
check('class features and knacks in the same pack are not offered',
  !docs.filter((d) => d.system?.featureType !== 'feat').some((d) => names.includes(d.name)),
  `${docs.length - feats.length} non-feats kept out`);

// the markup, drawn from the real template
Handlebars.registerHelper('gt', (a, b) => a > b);
const tpl = Handlebars.compile(readFileSync(R + 'templates/feat-dialog.hbs', 'utf8'));
dialog._search = 'Deadly Dance';
let html = tpl(await dialog._prepareContext({}));
check('a feat’s prerequisite is on its card', /Deadly Dance[\s\S]*?am-card-pre[^>]*>[\s\S]*?War Dancer feat/.test(html),
  'Deadly Dance → "War Dancer feat"');
dialog._search = '';

dialog._onlyEligible = true;
ctx = await dialog._prepareContext({});
check('"only ones I qualify for" narrows the list and keeps no failed one',
  ctx.featTotal < feats.length && ctx.featTotal > 0 && (await all()).ctx.featTotal === ctx.featTotal
  && (await FeatServiceRows({ onlyEligible: true })).every((f) => f.met),
  `${ctx.featTotal} of ${feats.length}`);
dialog._onlyEligible = false;
dialog._onlyUngated = true;
ctx = await dialog._prepareContext({});
check('"ungated" keeps only feats nothing gates', ctx.featTotal > 0 && ctx.featTotal < feats.length
  && (await FeatServiceRows({ onlyUngated: true })).every((f) => !f.gated), `${ctx.featTotal}`);
dialog._onlyUngated = false;

dialog._search = 'shield';
ctx = await dialog._prepareContext({});
check('search narrows by name or prerequisite', ctx.featTotal > 0 && ctx.featTotal < 60
  && ctx.feats.every((f) => /shield/i.test(f.name + ' ' + f.preText)), `${ctx.featTotal} for "shield"`);
dialog._search = '';

const firstBy = async (sort, dir) => { dialog._sort = sort; dialog._dir = dir; return (await dialog._prepareContext({})).feats[0]?.name; };
const nameAsc = await firstBy('name', 'asc');
const nameDesc = await firstBy('name', 'desc');
check('sorting by name, and clicking it again reverses it', nameAsc && nameDesc && nameAsc !== nameDesc, `${nameAsc} … ${nameDesc}`);
dialog._sort = 'name'; dialog._dir = 'asc';

// picking and adding
const act = (name, dataset = {}) => FeatDialog.DEFAULT_OPTIONS.actions[name].call(dialog, {}, { dataset });
ctx = await dialog._prepareContext({});
const pickUuid = ctx.feats[0].uuid;
act('fdSelect', { uuid: pickUuid });
html = tpl(await dialog._prepareContext({}));
check('a picked feat is marked and the Add button comes alive',
  /am-card am-card-selected/.test(html) && !/data-action="fdAdd" disabled/.test(html), 'selected, button enabled');
let created = null;
globalThis.Item = { create: async (data, opts) => { created = { data, opts }; return data; } };
globalThis.fromUuid = async (u) => (await pack.getDocuments({ _id__in: [u.split('.').pop()] }))[0] ?? null;
await act('fdAdd');
check('adding creates the feat on the character, with its source recorded',
  created?.opts?.parent === actor && created?.data?._stats?.compendiumSource === pickUuid && dialog._chosen === null,
  created ? created.data.name : 'nothing created');

// the page and the filter buttons all reach an action
html = tpl(await dialog._prepareContext({}));
const acts = [...html.matchAll(/data-action="([^"]+)"/g)].map((m) => m[1]);
check('every button in it has an action the dialog defines',
  acts.length > 0 && acts.every((a) => a in FeatDialog.DEFAULT_OPTIONS.actions), [...new Set(acts)].join(', '));

async function FeatServiceRows(opts) {
  const { FeatService } = await import(pathToFileURL(R + 'scripts/utils/featService.js').href);
  return FeatService.optionsFor(actor, opts);
}

report();
function report() {
  let bad = 0;
  for (const [name, ok, detail] of results) {
    if (!ok) bad++;
    console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name.padEnd(62)} ${detail}`);
  }
  process.exit(bad ? 1 : 0);
}
