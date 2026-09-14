/* Can a spell-slot star be seen and hit, and do the spell columns fit?
 *
 * Reported as: the stars do not work, are too small and too narrow, there is
 * not room for them — shorten the other columns (A for an action, C for
 * concentration, a target as a number).
 *
 * controls.mjs already proved a click on a star writes what a5e writes. It
 * passed the whole time this report stood, because it calls the handler; it
 * never asks where anything lands. This lays the Magic tab out in a real
 * browser, under the real stylesheets, with real spells from a5e's pack, and
 * asks what a person at the screen would.
 *
 * Against the previous layout, at the default 820px window, it reported:
 *   header  Cantrips=206 | Cast Time=112 | Range=112 | Duration=0 | Save=0
 *   stars   18.4x18.4
 * — two of four columns hidden outright, and pips of 18px. Those are the
 * first two failures below; the star-reach test passed then and passes now,
 * which is why it is not the only one.
 *
 *   node tools/checks/slotroom.mjs            the check
 *   node tools/checks/slotroom.mjs --shots    also writes a PNG per width
 */
import Handlebars from 'handlebars';
import { readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ClassicLevel } from 'classic-level';
import { buildSheet, R } from './lib/sheetdom.mjs';
import { inBrowser } from './lib/browser.mjs';

const SHOTS = process.argv.includes('--shots');
const results = [];
const check = (name, ok, detail) => results.push([name, ok, detail]);

/* Every spell a5e ships, all 895: whether a short column holds its value is
   a question about the longest value, and a hand-picked dozen would only
   answer it for the dozen. The first run over all of them found seven free-
   text ranges ("100 feet above you", "Same plane") cut to an ellipsis. */
const db = new ClassicLevel(R + 'packcopy2/spells', { valueEncoding: 'json' });
const pack = [];
for await (const [k, v] of db.iterator()) if (k.startsWith('!items!')) pack.push(v);
await db.close();
const chosen = pack;

async function render(unlocked) {
  const { sheet, actor } = await buildSheet();
  for (const [id, it] of [...actor.items.entries()]) if (it.type === 'spell') actor.items.delete(id);
  for (const d of chosen) actor.items.set(d._id, {
    id: d._id, uuid: 'Item.' + d._id, name: d.name, type: 'spell', img: d.img,
    system: JSON.parse(JSON.stringify({ level: 0, ...d.system })), flags: {},
    effects: new Collection(), actions: new Collection(Object.entries(d.system.actions ?? {})),
    getFlag: () => undefined, _stats: {}, parent: null });
  actor.flags.a5e = { ...(actor.flags.a5e ?? {}), sheetIsLocked: !unlocked };
  /* a5e derives max at prepare time; a stored actor holds none. */
  actor.system.spellResources = { slots: {
    1: { current: 2, max: 4, override: 0 }, 2: { current: 3, max: 3, override: 0 },
    3: { current: 1, max: 3, override: 0 } } };
  const tpl = Handlebars.compile(readFileSync(R + 'templates/sheet/tidy-character-sheet.hbs', 'utf8'));
  return { html: tpl(await sheet.getData()), rootClasses: sheet.constructor.defaultOptions.classes };
}

function probe(doc) {
  /* Foundry's Tabs would do this on a click; nothing of Foundry runs here. */
  doc.querySelectorAll('.tab[data-group="primary"]').forEach((t) =>
    t.classList.toggle('active', t.dataset.tab === 'magic'));
  doc.querySelectorAll('.actor-tabs [data-tab]').forEach((t) =>
    t.classList.toggle('active', t.dataset.tab === 'magic'));

  const w = (el) => +el.getBoundingClientRect().width.toFixed(1);
  const out = { tables: [], clipped: [] };
  for (const sec of doc.querySelectorAll('.tab.magic .tidy-table[data-tidy-section-key]')) {
    const head = sec.querySelector(':scope > header');
    head.scrollIntoView({ block: 'center' });
    const h3 = head.querySelector('h3');
    const stars = [...head.querySelectorAll('.am-slot')].map((s) => {
      const b = s.getBoundingClientRect();
      const hit = doc.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
      return { w: w(s), reached: !!hit && (hit === s || s.contains(hit)) };
    });
    const columns = [...head.querySelectorAll('.tidy-table-header-cell:not(.primary):not(.header-cell-actions)')]
      .map((c) => ({ text: c.textContent.trim(), w: w(c) }));
    out.tables.push({ key: sec.dataset.tidySectionKey, h3Clipped: h3.scrollWidth > h3.clientWidth + 1,
      stars, fields: head.querySelectorAll('.am-slot-field').length, columns });
    head.scrollIntoView({ block: 'center' });
    for (const cell of sec.querySelectorAll('.tidy-table-row .tidy-table-cell.text-cell:not(.primary) > .cell-text')) {
      if (cell.offsetParent && (cell.scrollWidth > cell.clientWidth + 1 || cell.scrollHeight > cell.clientHeight + 1))
        out.clipped.push(`${cell.closest('.tidy-table-row').querySelector('.cell-name')?.textContent}: "${cell.textContent.trim()}"`);
    }
  }
  doc.querySelectorAll('*').forEach((e) => { if (e.scrollTop) e.scrollTop = 0; });
  return out;
}

const locked = await render(false);
for (const width of [700, 820]) {
  const shot = SHOTS ? join(tmpdir(), `am-spells-${width}.png`) : undefined;
  const { out } = inBrowser({ ...locked, probe, width, screenshot: shot });
  if (shot) console.log(`  picture: ${shot}`);
  const all = out.tables;
  const stars = all.flatMap((t) => t.stars);
  const cols = all[0]?.columns ?? [];
  const shown = cols.filter((c) => c.w > 0).map((c) => c.text);

  if (width === 820)
    check(`${width}px: all five spell columns are shown`, shown.length === 5,
      cols.map((c) => `${c.text}=${c.w}`).join(' | '));
  else
    check(`${width}px: range, duration and roll stay at the minimum width`,
      ['Range', 'Duration', 'Roll'].every((n) => shown.includes(n)), `shown: ${shown.join(', ')}`);
  check(`${width}px: every star is at least 1.3rem`, stars.length > 0 && stars.every((s) => s.w >= 20.8),
    `${stars.length} stars, ${[...new Set(stars.map((s) => s.w))].join('/')}px`);
  check(`${width}px: a click at a star's centre reaches it`, stars.every((s) => s.reached),
    `${stars.filter((s) => s.reached).length}/${stars.length}`);
  check(`${width}px: no level's name is cut short by its stars`, all.every((t) => !t.h3Clipped),
    all.filter((t) => t.h3Clipped).map((t) => t.key).join(', ') || 'none cut');
  check(`${width}px: no short value is clipped in its column`, out.clipped.length === 0,
    out.clipped.slice(0, 4).join('; ') || `${chosen.length} real spells, none clipped`);
}

const open = await render(true);
{
  const { out } = inBrowser({ ...open, probe, width: 820 });
  const levels = out.tables.filter((t) => /^Level/.test(t.key));
  check('unlocked: each level shows a5e’s two slot fields instead of stars',
    levels.length > 0 && levels.every((t) => t.fields === 2 && t.stars.length === 0),
    levels.map((t) => `${t.key}: ${t.fields} fields, ${t.stars.length} stars`).join('; '));
}

let bad = 0;
for (const [name, ok, detail] of results) {
  if (!ok) bad++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name.padEnd(58)} ${detail}`);
}
process.exit(bad ? 1 : 0);
