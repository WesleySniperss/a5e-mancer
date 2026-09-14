/* Does "Add Feat" on the Features tab offer a5e's feats?
 *
 * Reported as: opening it shows "No feat compendiums found. Make sure your a5e
 * compendiums are enabled." — with the compendiums enabled.
 *
 * The window had a loader of its own. It kept entries of type `feat`, which
 * a5e's packs never use, and asked getIndex to fold `system` into an index
 * Foundry had already built, which throws on a5e's packs and was swallowed. So
 * it found nothing on every world and blamed the compendiums.
 *
 * This opens it against a5e's real feats pack, served by a stand-in that
 * behaves as Foundry does on that pack: the plain index carries only _id,
 * name, type and img, and asking it for more throws.
 *
 * Needs packcopy2/feats — a copy of systems/a5e/packs/feats with LOCK removed.
 */
import { ClassicLevel } from 'classic-level';
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
let dialog = null;
foundry.applications.api.DialogV2.wait = async (cfg) => { dialog = cfg; return null; };

const { root } = await buildSheet();
const button = q(root, '[data-action="open-feat-picker"]')[0];
check('the Features tab draws the Add Feat button', !!button, button ? 'found' : 'missing');
for (const l of listeners.filter((x) => x.el === button && x.type === 'click'))
  await l.fn({ preventDefault(){}, stopPropagation(){}, currentTarget: button, target: button });
for (let i = 0; i < 50 && !dialog && !warned.length; i++) await new Promise((r) => setTimeout(r, 20));

check('opening it raises no "no feats" warning', warned.length === 0, warned[0] ?? 'none');
const rows = (dialog?.content?.match(/class="am-feat-picker-row/g) ?? []).length;
const feats = docs.filter((d) => d.type === 'feature' && d.system?.featureType === 'feat').length;
check('it lists every feat in the pack', rows === feats, `${rows} rows, ${feats} feats in the pack`);
check('a feat’s prerequisite is shown', /Deadly Dance[\s\S]*?War Dancer feat/.test(dialog?.content ?? ''),
  'Deadly Dance → "War Dancer feat"');
check('class features and knacks in the same pack are not offered',
  !docs.filter((d) => d.system?.featureType !== 'feat').some((d) => (dialog?.content ?? '').includes(`>${d.name}<`)),
  `${docs.length - feats} non-feats kept out`);

let bad = 0;
for (const [name, ok, detail] of results) {
  if (!ok) bad++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name.padEnd(58)} ${detail}`);
}
process.exit(bad ? 1 : 0);
