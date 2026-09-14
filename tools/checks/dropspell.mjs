/* Dragging a spell onto the sheet — where does it go?
 *
 * Reported as: dropping a spell on the sheet says a spell book must be chosen.
 *
 * That is a5e refusing the create — SpellItemA5e._preCreate: "You must select
 * a spell book to create a spell." a5e's own sheet has a spell branch in its
 * drop that puts the spell into a book (SpellBook#addSpell writes
 * system.spellBook), or, dropped on Inventory, makes a Spell Scroll of it.
 * This sheet had ported the object branch only, so a spell fell through to
 * Foundry's plain create with no book on it. Destinies had the same gap.
 *
 * The drop is driven with a real a5e spell from the pack copy, and the actor's
 * spell books behave as a5e's SpellBookManager does: a Map with first(), each
 * book with an addSpell that records what it was handed.
 */
import { ClassicLevel } from 'classic-level';
import { buildSheet, R } from './lib/sheetdom.mjs';

const results = [];
const check = (name, ok, detail) => results.push([name, ok, detail]);

const db = new ClassicLevel(R + 'packcopy2/spells', { valueEncoding: 'json' });
let fireball = null;
for await (const [k, v] of db.iterator()) if (k.startsWith('!items!') && v.name === 'Fireball') { fireball = v; break; }
await db.close();
check('a5e’s Fireball was read from the pack', !!fireball, fireball ? `level ${fireball.system.level}` : 'missing');

/* a5e's scroll table, levels 3 — the one Fireball needs — from its config.ts. */
CONFIG.A5E.scrollData = { 3: { attackBonus: 7, cost: { value: 175, denomination: 'gp' },
  craftingComponent: 'Dire wolf hide', saveDC: 15, rarity: 'uncommon' } };

const spell = {
  id: fireball._id, uuid: `Compendium.a5e.a5e-spells.Item.${fireball._id}`, name: fireball.name,
  type: 'spell', parent: null, system: JSON.parse(JSON.stringify(fireball.system)),
  actions: new Map(Object.entries(fireball.system.actions ?? {})),
  toObject: () => JSON.parse(JSON.stringify(fireball))
};
globalThis.Item = globalThis.Item ?? {};
globalThis.Item.implementation = { fromDropData: async () => spell };

async function drop({ tab, books }) {
  const { sheet, actor } = await buildSheet();
  const handed = [];
  const created = [];
  const manager = new Map(books.map((id) => [id, { _id: id, addSpell: (it) => { handed.push({ id, it }); return it; } }]));
  manager.first = () => manager.values().next().value;
  actor.spellBooks = manager;
  actor.system.spellBooks = Object.fromEntries(books.map((id) => [id, {}]));
  const warned = [];
  ui.notifications.warn = (m) => warned.push(m);
  ui.notifications.error = (m) => warned.push(m);
  actor.createEmbeddedDocuments = async (_t, datas) => datas.map((d, n) => {
    /* a5e's SpellItemA5e._preCreate, which is what the report quoted. */
    if (d.type === 'spell' && !d.system?.spellBook) {
      ui.notifications.error('You must select a spell book to create a spell.');
      return null;
    }
    created.push(d);
    return { ...d, id: `new${n}`, update: async (u) => { created.push({ update: u }); } };
  }).filter(Boolean);
  sheet._tabs = [{ active: tab }];
  let threw = null;
  try {
    await sheet._onDropItem({ target: { closest: () => null } }, { type: 'Item', uuid: spell.uuid });
  } catch (err) { threw = err; }
  return { handed, created, warned, threw };
}

{
  const r = await drop({ tab: 'magic', books: ['book1', 'book2'] });
  check('dropped on Magic, the spell goes into a spell book through a5e’s addSpell',
    r.handed.length === 1 && r.handed[0].it === spell && !r.threw,
    r.threw ? `threw: ${r.threw.message}` : `${r.handed.length} addSpell call(s)${r.handed[0] ? `, into ${r.handed[0].id}` : ''}`);
  check('it goes into the first book, as the spell dialogs here add to',
    r.handed[0]?.id === 'book1', r.handed[0]?.id ?? 'none');
  check('and nothing is created around the book', r.created.length === 0, `${r.created.length} direct creates`);
}
{
  const r = await drop({ tab: 'inventory', books: ['book1'] });
  const scroll = r.created.find((d) => d.type === 'object');
  const actions = Object.values(scroll?.system?.actions ?? {});
  const consumerPointed = r.created.some((d) => d.update && Object.values(d.update).every((v) => v === 'new0'));
  check('dropped on Inventory, it becomes a Spell Scroll, as in a5e', scroll?.name === 'Spell Scroll (Fireball)',
    scroll?.name ?? 'no scroll');
  check('the scroll carries the spell’s actions, its save at the scroll’s DC',
    actions.length > 0 && actions.every((a) => Object.values(a.prompts ?? {}).filter((p) => p.type === 'savingThrow')
      .every((p) => p.saveDC?.type === 'custom' && p.saveDC?.bonus === 15)),
    `${actions.length} action(s)`);
  check('and each action spends the scroll itself', consumerPointed, consumerPointed ? 'consumers → the scroll' : 'not pointed');
  check('no book is involved', r.handed.length === 0, `${r.handed.length} addSpell call(s)`);
}
{
  const r = await drop({ tab: 'magic', books: [] });
  check('an actor with no spell book is told so, and nothing is created',
    r.warned.length === 1 && r.created.length === 0 && !r.threw, r.warned[0] ?? (r.threw?.message ?? 'no warning'));
}

let bad = 0;
for (const [name, ok, detail] of results) {
  if (!ok) bad++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name.padEnd(66)} ${detail}`);
}
process.exit(bad ? 1 : 0);
