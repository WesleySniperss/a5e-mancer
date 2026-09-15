/* A spell row as a person sees it: its C and R marks, and a prepared spell's
 * colour.
 *
 * Reported as: prepared and always-prepared spells should be the colours a5e's
 * own sheet gives them; and the circles on spells are ellipses, and look daft.
 *
 * Laid out in a real browser under a5e's stylesheet as well as ours, so the
 * colours can be read back from a5e's own custom properties — the check does
 * not carry a copy of them to drift.
 *
 * Against the released code: every mark measured 20 x 28 (Tidy's
 * .item-state-indicator box, drawn round), and no prepared row had any colour.
 */
import Handlebars from 'handlebars';
import { readFileSync } from 'fs';
import { ClassicLevel } from 'classic-level';
import { buildSheet, R } from './lib/sheetdom.mjs';
import { inBrowser } from './lib/browser.mjs';

const results = [];
const check = (name, ok, detail) => results.push([name, ok, detail]);

const db = new ClassicLevel(R + 'packcopy2/spells', { valueEncoding: 'json' });
const pack = [];
for await (const [k, v] of db.iterator()) if (k.startsWith('!items!')) pack.push(v);
await db.close();
const pick = (n) => pack.find((d) => d.name === n);

const { sheet, actor } = await buildSheet();
for (const [id, it] of [...actor.items.entries()]) if (it.type === 'spell') actor.items.delete(id);
/* Detect Magic carries both C and R; the prepared states are a5e's 0, 1, 2. */
const put = (name, prepared) => { const d = pick(name); actor.items.set(d._id, {
  id: d._id, uuid: 'Item.' + d._id, name: d.name, type: 'spell', img: d.img,
  system: { ...JSON.parse(JSON.stringify(d.system)), spellBook: 'b1', prepared },
  flags: {}, effects: new Collection(), actions: new Collection(Object.entries(d.system.actions ?? {})),
  getFlag: () => undefined, _stats: {} }); };
put('Detect Magic', 0); put('Bless', 1); put('Shield', 2);
actor.flags.a5e = { ...(actor.flags.a5e ?? {}), sheetIsLocked: true };
actor.system.spellBooks = { b1: { name: 'Book', showSpellSlots: true } };
const books = new Map([['b1', { _id: 'b1', name: 'Book', showSpellSlots: true }]]);
books.first = () => books.get('b1');
actor.spellBooks = books;

const tpl = Handlebars.compile(readFileSync(R + 'templates/sheet/tidy-character-sheet.hbs', 'utf8'));
const html = tpl(await sheet.getData());

function probe(doc) {
  doc.querySelectorAll('.tab[data-group="primary"]').forEach((t) => t.classList.toggle('active', t.dataset.tab === 'magic'));
  const marks = [...doc.querySelectorAll('.tab.magic .am-mark')].map((m) => {
    const b = m.getBoundingClientRect();
    return { t: m.textContent.trim(), w: +b.width.toFixed(1), h: +b.height.toFixed(1) };
  });
  /* a5e's own values, as its stylesheet resolves them on this sheet. */
  const probeVar = (name) => {
    const s = doc.createElement('div');
    s.style.background = `var(${name})`;
    doc.querySelector('.tab.magic').appendChild(s);
    const v = getComputedStyle(s).backgroundColor;
    s.remove();
    return v;
  };
  const rows = {};
  for (const r of doc.querySelectorAll('.tab.magic .tidy-table-row:not(.activity)')) {
    const n = r.querySelector('.cell-name')?.textContent?.trim();
    if (n) rows[n] = getComputedStyle(r).backgroundImage;
  }
  return { marks, rows,
    green: probeVar('--a5e-item-list-item-background-end-highlight'),
    purple: probeVar('--a5e-item-list-item-background-end-highlight-purple') };
}

const { out } = inBrowser({ html, probe, width: 820, rootClasses: sheet.constructor.defaultOptions.classes });

check('the C and R marks are circles, not ovals', out.marks.length >= 3 && out.marks.every((m) => m.w === m.h),
  out.marks.map((m) => `${m.t} ${m.w}x${m.h}`).join(', '));
check('a5e’s highlight colours resolve on this sheet', /rgba?\(/.test(out.green) && /rgba?\(/.test(out.purple),
  `green ${out.green}, purple ${out.purple}`);
check('a prepared spell’s row is a5e’s prepared green', (out.rows.Bless ?? '').includes(out.green),
  out.rows.Bless ?? 'no row');
check('an always-prepared spell’s row is a5e’s purple', (out.rows.Shield ?? '').includes(out.purple),
  out.rows.Shield ?? 'no row');
check('an unprepared spell’s row is left plain', (out.rows['Detect Magic'] ?? 'none') === 'none',
  out.rows['Detect Magic'] ?? 'no row');

let bad = 0;
for (const [name, ok, detail] of results) {
  if (!ok) bad++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name.padEnd(56)} ${detail}`);
}
process.exit(bad ? 1 : 0);
