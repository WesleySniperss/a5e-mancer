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
 * This renders the world's characters with fromUuid resolving a5e's spell pack
 * (packcopy2/spells), and counts the spells that show components.
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

globalThis.fromUuid = async (uuid) => {
  const m = String(uuid ?? '').match(/^Compendium\.a5e\.a5e-spells\.(?:Item\.)?(\w+)$/);
  const d = m ? pack.get(m[1]) : null;
  return d ? { type: 'spell', system: d.system } : null;
};

const chars = JSON.parse(readFileSync(R + 'world-chars.json', 'utf8'));
let stubs = 0, sourced = 0, shown = 0, packHas = 0;
const missing = [];
for (const c of chars.filter((x) => x.items.some((i) => i.type === 'spell'))) {
  const { actor, render } = await buildSheet({ choose: (all) => all.find((x) => x.actor._id === c.actor._id) });
  /* world-chars.json keeps each item's _stats; the harness wrapper does not. */
  for (const raw of c.items) { const it = actor.items.get(raw._id); if (it) it._stats = raw._stats ?? {}; }
  actor.flags.a5e = { ...(actor.flags.a5e ?? {}), sheetIsLocked: true };
  const root = await render();
  for (const raw of c.items.filter((i) => i.type === 'spell')) {
    const own = raw.system?.components;
    if (own) continue;
    stubs++;
    const uuid = raw._stats?.compendiumSource ?? raw.flags?.core?.sourceId;
    const src = uuid && (await fromUuid(uuid));
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
