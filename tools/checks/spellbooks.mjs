/* Spell books on the Magic tab, held to a5e's Spells page.
 *
 * Reported as: a5e's own sheet lets you choose spell books, and unlocked, edit
 * several of them — this one does not.
 *
 * a5e (ActorSpellsPage.svelte): one book shown at a time; a strip of books
 * drawn when unlocked or when there is more than one; unlocked, a cog and a bin
 * on each and a plus to add; a book's own settings (SpellBookConfig.svelte)
 * written straight to system.spellBooks.<id>; its showSpellSlots deciding the
 * stars; its points, inventions and charges shown for the book in view; and a
 * dropped spell going into the book in view.
 *
 * The actor's books behave as a5e's SpellBookManager: a Map with first(),
 * add() that writes a book and returns its id, remove() that deletes it.
 */
import { buildSheet, listeners, q } from './lib/sheetdom.mjs';

const results = [];
const check = (name, ok, detail) => results.push([name, ok, detail]);

const fire = async (el, type = 'click') => {
  for (const l of listeners.filter((x) => x.el === el && x.type === type))
    await l.fn({ preventDefault(){}, stopPropagation(){}, currentTarget: el, target: el });
};

const spell = (id, name, level, book) => ({
  _id: id, name, type: 'spell', img: 'x.png',
  system: { level, spellBook: book, actions: {}, schools: { primary: 'evocation' }, components: {} }
});

async function setup({ books, locked = true, bookData = {} }) {
  const { sheet, actor, render } = await buildSheet();
  for (const [id, it] of [...actor.items.entries()]) if (it.type === 'spell') actor.items.delete(id);
  const spells = [spell('s1', 'Alpha Bolt', 1, 'b1'), spell('s2', 'Beta Ward', 2, 'b1'),
                  spell('s3', 'Gamma Ray', 1, 'b2'), spell('s4', 'Stray Spark', 1, '')];
  for (const s of spells) actor.items.set(s._id, {
    id: s._id, uuid: 'Item.' + s._id, name: s.name, type: 'spell', img: s.img, system: s.system,
    flags: {}, effects: new Collection(), actions: new Collection(), getFlag: () => undefined, _stats: {} });

  const writes = [];
  actor.update = async (data) => { writes.push(data); return actor; };
  actor.flags.a5e = { ...(actor.flags.a5e ?? {}), sheetIsLocked: locked };
  actor.system.spellBooks = Object.fromEntries(books.map((id, n) => [id,
    { name: `Book ${n + 1}`, showSpellSlots: true, ...(bookData[id] ?? {}) }]));
  const manager = new Map(books.map((id) => [id, { _id: id, ...actor.system.spellBooks[id] }]));
  manager.first = () => manager.values().next().value;
  manager.add = async (data) => { const id = 'bNew'; manager.set(id, { _id: id, name: 'New Spell Book', ...data });
    actor.system.spellBooks[id] = { name: 'New Spell Book' }; writes.push({ add: id }); return id; };
  manager.remove = async (id) => { writes.push({ remove: id }); };
  actor.spellBooks = manager;
  actor.system.spellResources = { ...(actor.system.spellResources ?? {}),
    slots: { 1: { current: 1, max: 2, override: 0 }, 2: { current: 1, max: 1, override: 0 } },
    points: { current: 3, max: 7, override: 0 } };
  sheet.render = () => {};
  return { sheet, actor, render, writes };
}
const magic = (root) => q(root, '[data-tab="magic"]').find((n) => n.classes.includes('tidy-tab-contents'));
/* Each row's name, once: a row's summary repeats it in its own actions table. */
const namesIn = (root) => [...new Set(q(magic(root), '.cell-name').map((n) => n.textContent.trim()))];

/* One book, locked: no strip, as a5e. */
{
  const { render } = await setup({ books: ['b1'] });
  const root = await render();
  check('one book, locked: no strip', q(root, '.am-spellbooks').length === 0, `${q(root, '.am-spellbooks').length} strips`);
}

/* Two books, locked: the strip, the first shown, a bookless spell kept in it. */
{
  const { sheet, render } = await setup({ books: ['b1', 'b2'] });
  let root = await render();
  const picks = q(root, '[data-action="spellbook-pick"]');
  check('two books: the strip draws both', picks.length === 2, picks.map((p) => p.textContent.trim().replace(/\s+/g, ' ')).join(' | '));
  const first = namesIn(root);
  check('the first book is shown, with the spell that names no book',
    first.includes('Alpha Bolt') && first.includes('Beta Ward') && first.includes('Stray Spark') && !first.includes('Gamma Ray'),
    first.join(', '));
  check('locked: no cog, bin or plus', q(root, '[data-action="spellbook-config"]').length === 0
    && q(root, '[data-action="spellbook-add"]').length === 0, 'none');

  await fire(picks[1]);
  root = await render();
  const second = namesIn(root);
  check('picking the second book shows its spells and only those',
    second.length === 1 && second[0] === 'Gamma Ray', second.join(', ') || 'nothing');
  check('and the pick survives a redraw', sheet._spellBook === 'b2', String(sheet._spellBook));
}

/* A book with its slots switched off, and one showing spell points. */
{
  const { render, writes } = await setup({ books: ['b1'], bookData: { b1: { showSpellSlots: false, showSpellPoints: true } } });
  const root = await render();
  check('a book with showSpellSlots off draws no stars', q(root, '.am-slot').length === 0, `${q(root, '.am-slot').length} stars`);
  const res = q(root, '[data-action="spell-resource"]');
  check('a book showing spell points draws them, left and total', res.length === 2,
    res.map((r) => `${r.dataset.path}=${r.attrs?.value}`).join(', '));
  if (res[0]) { res[0].value = '5'; await fire(res[0], 'change'); }
  check('changing points left writes system.spellResources.points.current',
    writes.some((w) => w['system.spellResources.points.current'] === 5), JSON.stringify(writes.at(-1)));
}

/* Unlocked: cog, bin, plus — and what each does. */
{
  const { sheet, render, writes } = await setup({ books: ['b1'], locked: false });
  let dialog = null, confirmed = null;
  foundry.applications.api.DialogV2.wait = async (cfg) => { dialog = cfg; return null; };
  foundry.applications.api.DialogV2.confirm = async (cfg) => { confirmed = cfg; return true; };
  let root = await render();
  check('unlocked, one book: the strip, with a cog, a bin and a plus',
    q(root, '.am-spellbooks').length === 1 && q(root, '[data-action="spellbook-config"]').length === 1
    && q(root, '[data-action="spellbook-delete"]').length === 1 && q(root, '[data-action="spellbook-add"]').length === 1,
    'drawn');

  await fire(q(root, '[data-action="spellbook-add"]')[0]);
  check('the plus adds a book through SpellBookManager.add, shows it, and opens its settings',
    writes.some((w) => w.add === 'bNew') && sheet._spellBook === 'bNew' && /Configure Spell Book/.test(dialog?.window?.title ?? ''),
    `${JSON.stringify(writes.find((w) => w.add))}, current ${sheet._spellBook}, dialog ${dialog?.window?.title}`);

  dialog = null;
  await fire(q(root, '[data-action="spellbook-config"]')[0]);
  check('the cog opens the book’s settings with a5e’s fields',
    ['name', 'ability', 'showArtifactCharges', 'showSpellInventions', 'showSpellPoints', 'showSpellSlots', 'disableSpellConsumers']
      .every((f) => (dialog?.content ?? '').includes(`data-field="${f}"`)), 'name, ability, five switches');

  await fire(q(root, '[data-action="spellbook-delete"]')[0]);
  check('the bin asks first, names the spells going with it, then removes the book',
    /2 spells/.test(confirmed?.content ?? '') && writes.some((w) => w.remove === 'b1'),
    `${(confirmed?.content ?? '').replace(/<[^>]+>/g, '')} → ${JSON.stringify(writes.find((w) => w.remove))}`);
}

let bad = 0;
for (const [name, ok, detail] of results) {
  if (!ok) bad++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name.padEnd(74)} ${detail}`);
}
process.exit(bad ? 1 : 0);
