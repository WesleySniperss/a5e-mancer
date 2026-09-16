/* Do spells show their components — the stubs included?
 *
 * Reported as: there are no components on spells.
 *
 * The markup had been there since V S M were added, and spellrowlook.mjs
 * passed: it drew spells straight from a5e's pack, which carry components.
 * The spells on this world's actors mostly do not. 190 of 211 are stubs, their
 * actions and nothing else, so there was nothing to draw. 172 still record the
 * compendium entry they came from.
 *
 * This renders the world's characters with a5e's spell pack (packcopy2/spells)
 * behind game.packs, and counts the spells that show components.
 *
 * Reported next as: something takes long to load. The first release read each
 * source through fromUuid — for a compendium entry, a server request and a
 * whole Item apiece — before the sheet could draw: 52 of them across these
 * sheets, 21 on one. They are asked for a pack at a time now, and this counts
 * the requests: 15 in all, one per pack a sheet's stubs name, none on a redraw.
 */
import { readFileSync } from 'fs';
import { ClassicLevel } from 'classic-level';
import { buildSheet, q, R } from './lib/sheetdom.mjs';

const results = [];
const check = (name, ok, detail) => results.push([name, ok, detail]);

const db = new ClassicLevel(R + 'packcopy2/spells', { valueEncoding: 'json' });
const pack = new Map();
for await (const [k, v] of db.iterator()) if (k.startsWith('!items!')) pack.set(v._id, v);
await db.close();

const source = (uuid) => {
  const m = String(uuid ?? '').match(/^Compendium\.a5e\.a5e-spells\.(?:Item\.)?(\w+)$/);
  const d = m ? pack.get(m[1]) : null;
  return d ? { type: 'spell', system: d.system } : null;
};

/* The sheet reads sources a pack at a time; count what it asks for. The first
   release of this read each through fromUuid, one server trip per spell. */
let singleReads = 0;
const batches = [];
globalThis.fromUuid = async (uuid) => { singleReads++; return source(uuid); };
/* Every pack a source names answers, as it would in the world: stubs here also
   come from a5e's dnd5e-spells and a module's features pack. Only a5e-spells
   has its documents copied; the others answer with nothing. */
const packsSeen = new Map();
const packFor = (collection) => {
  if (!packsSeen.has(collection)) packsSeen.set(collection, {
    collection,
    async getDocuments({ _id__in } = {}) {
      batches.push(_id__in?.length ?? Infinity);
      await new Promise((r) => setTimeout(r, 1));
      if (collection !== 'a5e.a5e-spells') return [];
      return (_id__in ?? []).map((id) => pack.get(id)).filter(Boolean)
        .map((d) => ({ id: d._id, type: 'spell', system: d.system }));
    }
  });
  return packsSeen.get(collection);
};

const chars = JSON.parse(readFileSync(R + 'world-chars.json', 'utf8'));
let stubs = 0, sourced = 0, shown = 0, packHas = 0, renders = 0, worstBatches = 0, rerenderAsks = 0;
const missing = [];
for (const c of chars.filter((x) => x.items.some((i) => i.type === 'spell'))) {
  const { actor, render } = await buildSheet({ choose: (all) => all.find((x) => x.actor._id === c.actor._id) });
  game.packs.get = (id) => packFor(id);
  /* The packs this sheet's stubs name: one request each, at most. A stub by
     the sheet's rule, which is no component marked, not no field. */
  const marked = (x) => !!(x && (x.vocalized || x.seen || x.material));
  const packsNamed = new Set(c.items.filter((i) => i.type === 'spell' && !marked(i.system?.components))
    .map((i) => /^Compendium\.([^.]+\.[^.]+)\./.exec(i._stats?.compendiumSource ?? i.flags?.core?.sourceId ?? '')?.[1])
    .filter(Boolean));
  /* world-chars.json keeps each item's _stats; the harness wrapper does not. */
  for (const raw of c.items) { const it = actor.items.get(raw._id); if (it) it._stats = raw._stats ?? {}; }
  actor.flags.a5e = { ...(actor.flags.a5e ?? {}), sheetIsLocked: true };
  const before = batches.length;
  const root = await render();
  renders++;
  worstBatches = Math.max(worstBatches, batches.length - before - packsNamed.size);
  const again = batches.length;
  await render();
  rerenderAsks += batches.length - again;
  for (const raw of c.items.filter((i) => i.type === 'spell')) {
    const own = raw.system?.components;
    if (own) continue;
    stubs++;
    const uuid = raw._stats?.compendiumSource ?? raw.flags?.core?.sourceId;
    const src = uuid && source(uuid);
    if (!src) continue;
    sourced++;
    const c2 = src.system?.components ?? {};
    if (!(c2.vocalized || c2.seen || c2.material)) continue;
    packHas++;
    const row = q(root, `.tidy-table-row-container[data-item-id="${raw._id}"]`)[0];
    const comps = row ? q(row, '.am-comps')[0] : null;
    if (comps) shown++; else missing.push(`${c.actor.name}: ${raw.name}`);
  }
}

check('the world holds stub spells with a5e sources to read', sourced > 0, `${stubs} stubs, ${sourced} with a source in a5e’s spell pack`);
check('every such spell whose source has components shows them', packHas > 0 && shown === packHas,
  `${shown} of ${packHas} shown` + (missing.length ? `; missing: ${missing.slice(0, 3).join(', ')}` : ''));
check('sources are read a pack at a time, not a spell at a time',
  batches.length > 0 && worstBatches <= 0 && singleReads === 0,
  `${renders} sheets: ${batches.length} requests in all (${batches.join(', ')} ids), ${worstBatches > 0 ? worstBatches + " more than one per pack on a sheet" : "never more than one per pack a sheet names"}, ${singleReads} single reads`);
check('and a sheet drawn again asks for nothing', rerenderAsks === 0, `${rerenderAsks} requests on the second render`);

/* And one read closely: a stub with a material component. */
{
  const d = [...pack.values()].find((s) => s.system?.components?.material && s.system?.materials);
  const { actor, render } = await buildSheet();
  for (const [id, it] of [...actor.items.entries()]) if (it.type === 'spell') actor.items.delete(id);
  actor.items.set('stub1', { id: 'stub1', uuid: 'Item.stub1', name: d.name, type: 'spell', img: d.img,
    /* As Foundry loads a stub: the schema's defaults filled in, every component false. */
    system: { actions: d.system.actions ?? {}, components: { vocalized: false, seen: false, material: false }, materials: '' },
    _source: { system: { actions: d.system.actions ?? {}, components: { vocalized: false, seen: false, material: false } } }, _stats: { compendiumSource: `Compendium.a5e.a5e-spells.Item.${d._id}` },
    flags: {}, effects: new Collection(), actions: new Collection(), getFlag: () => undefined });
  actor.flags.a5e = { ...(actor.flags.a5e ?? {}), sheetIsLocked: true };
  const root = await render();
  const comps = q(root, '.am-comps')[0];
  const want = ['vocalized', 'seen', 'material'].filter((k) => d.system.components[k]).length;
  check('a stub spell shows its source’s letters, and the material in the tooltip',
    !!comps && q(comps, '.am-comp').length === want && (comps.dataset.tooltip ?? '').includes(d.system.materials.slice(0, 12)),
    comps ? `${comps.textContent} — "${comps.dataset.tooltip}"` : 'no components drawn');
}

let bad = 0;
for (const [name, ok, detail] of results) {
  if (!ok) bad++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name.padEnd(62)} ${detail}`);
}
process.exit(bad ? 1 : 0);
