/* A spell row as a person sees it: its C and R marks, a prepared spell's
 * colour, and the button that prepares it.
 *
 * Reported, in turn, as: prepared and always-prepared spells should be the
 * colours a5e's sheet gives them; the circles on spells are ellipses; they are
 * still crooked — mark them by colour, without the rings, and check they can
 * be read; and the prepare button never appeared.
 *
 * Laid out in a real browser under a5e's stylesheet as well as ours. Colours
 * are read back from a5e's own custom properties, and legibility from the
 * screenshot's pixels — a computed style cannot say what is behind a letter
 * once a gradient and a textured window are stacked there.
 *
 * Against earlier code: marks 20 x 28 (Tidy's state-indicator box, drawn
 * round); no prepared row coloured; the prepare control a 15px grey book among
 * the name's icons, with nothing marking it as a button.
 */
import Handlebars from 'handlebars';
import { readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ClassicLevel } from 'classic-level';
import { buildSheet, R } from './lib/sheetdom.mjs';
import { inBrowser } from './lib/browser.mjs';
import { readPng, contrast } from './lib/png.mjs';

const results = [];
const check = (name, ok, detail) => results.push([name, ok, detail]);

const db = new ClassicLevel(R + 'packcopy2/spells', { valueEncoding: 'json' });
let detect = null;
for await (const [k, v] of db.iterator()) if (k.startsWith('!items!') && v.name === 'Detect Magic') { detect = v; break; }
await db.close();

const { sheet, actor } = await buildSheet();
for (const [id, it] of [...actor.items.entries()]) if (it.type === 'spell') actor.items.delete(id);
/* Detect Magic carries both C and R; one copy in each of a5e's prepared
   states, 0, 1 and 2, so each mark is read on each row colour. */
[['Plain', 0], ['Prepared', 1], ['Always', 2]].forEach(([label, prepared], n) => {
  const id = `dm${n}`;
  actor.items.set(id, { id, uuid: 'Item.' + id, name: `${label} Detect Magic`, type: 'spell', img: detect.img,
    system: { ...JSON.parse(JSON.stringify(detect.system)), spellBook: 'b1', prepared },
    flags: {}, effects: new Collection(), actions: new Collection(Object.entries(detect.system.actions ?? {})),
    getFlag: () => undefined, _stats: {} });
});
actor.flags.a5e = { ...(actor.flags.a5e ?? {}), sheetIsLocked: true };
actor.system.spellBooks = { b1: { name: 'Book', showSpellSlots: true } };
const books = new Map([['b1', { _id: 'b1', name: 'Book', showSpellSlots: true }]]);
books.first = () => books.get('b1');
actor.spellBooks = books;

const tpl = Handlebars.compile(readFileSync(R + 'templates/sheet/tidy-character-sheet.hbs', 'utf8'));
const html = tpl(await sheet.getData());

function probe(doc) {
  doc.querySelectorAll('.tab[data-group="primary"]').forEach((t) => t.classList.toggle('active', t.dataset.tab === 'magic'));
  const box = (el) => { const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; };
  const probeVar = (name) => {
    const s = doc.createElement('div');
    s.style.background = `var(${name})`;
    doc.querySelector('.tab.magic').appendChild(s);
    const v = getComputedStyle(s).backgroundColor;
    s.remove();
    return v;
  };
  const rows = [];
  for (const r of doc.querySelectorAll('.tab.magic .tidy-table-row:not(.activity)')) {
    const name = r.querySelector('.cell-name')?.textContent?.trim();
    if (!name) continue;
    const marks = [...r.querySelectorAll('.am-mark')].map((m) => {
      const cs = getComputedStyle(m);
      return { t: m.textContent.trim(), ...box(m), color: cs.color, border: cs.borderTopWidth, radius: cs.borderTopLeftRadius };
    });
    const actions = r.querySelector('.row-actions');
    const prep = actions?.querySelector('[data-action="item-prepare"]');
    let prepInfo = null;
    if (prep) {
      /* Tidy gives a row container content-visibility: auto, and until it has
         been scrolled to, headless Edge hit-tests straight through it — every
         button in a row, the use button too, read as missed. Scrolled to first,
         as a person's pointer would have it. */
      r.scrollIntoView({ block: 'center' });
      const b = prep.getBoundingClientRect();
      const hit = doc.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
      prepInfo = { ...box(prep), reached: !!hit && (hit === prep || prep.contains(hit)),
        hit: hit ? `${hit.tagName.toLowerCase()}.${String(hit.className).trim().split(/\s+/).join('.')}` : null,
        color: getComputedStyle(prep.querySelector('i')).color, opacity: getComputedStyle(prep).opacity };
    }
    const compsEl = r.querySelector('.am-comps');
    const comps = compsEl ? { t: compsEl.textContent.trim(), ...box(compsEl), color: getComputedStyle(compsEl).color,
      tip: compsEl.dataset.tooltip } : null;
    rows.push({ name, bg: getComputedStyle(r).backgroundImage, marks, comps, prep: prepInfo,
      nameIcons: r.querySelectorAll('.am-state-icons [data-action="item-prepare"]').length,
      actionsW: actions ? box(actions).w : 0 });
  }
  const headActions = doc.querySelector('.tab.magic .tidy-table-header-row .header-cell-actions');
  return { rows, headActionsW: headActions ? headActions.getBoundingClientRect().width : 0,
    green: probeVar('--a5e-item-list-item-background-end-highlight'),
    purple: probeVar('--a5e-item-list-item-background-end-highlight-purple'),
    greenIcon: probeVar('--a5e-item-list-item-icon-color-active-highlight'),
    purpleIcon: probeVar('--a5e-item-list-item-icon-color-active-highlight-purple') };
}

const shot = join(tmpdir(), 'am-spellrowlook.png');
const { out } = inBrowser({ html, probe, width: 820, rootClasses: sheet.constructor.defaultOptions.classes, screenshot: shot });
const png = readPng(shot);
const rgb = (s) => (s.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
const row = (label) => out.rows.find((r) => r.name.startsWith(label)) ?? { marks: [] };

/* The marks. */
const marks = out.rows.flatMap((r) => r.marks.map((m) => ({ ...m, row: r.name })));
check('C and R are drawn with no ring', marks.length === 6 && marks.every((m) => parseFloat(m.border) === 0),
  marks.map((m) => `${m.t} border ${m.border}`).slice(0, 2).join(', '));
check('C and R are different colours', new Set(marks.map((m) => m.color)).size === 2,
  [...new Set(marks.map((m) => `${m.t} ${m.color}`))].join(', '));

/* Legibility on every row colour, from the pixels beside each letter. */
/* Sampled a few pixels above and below the letter, at its centre: C and R sit
   side by side, so a sample beside one lands on the other. */
const readings = marks.map((m) => {
  const samples = [[m.x + m.w / 2, m.y - 3], [m.x + m.w / 2, m.y + m.h + 3]].map(([x, y]) => png.pixel(x, y));
  const bg = samples.reduce((a, s) => a.map((v, i) => v + s[i] / samples.length), [0, 0, 0]);
  return { ...m, ratio: contrast(rgb(m.color), bg) };
});
const worst = readings.reduce((a, b) => (b.ratio < a.ratio ? b : a), readings[0] ?? { ratio: 0 });
check('every C and R reads at 4.5:1 or better on plain, prepared and always rows',
  readings.length === 6 && readings.every((r) => r.ratio >= 4.5),
  readings.map((r) => `${r.row.split(' ')[0]} ${r.t} ${r.ratio.toFixed(1)}`).join(', ')
    + (worst ? `; worst ${worst.ratio.toFixed(1)}` : ''));

/* Components: V S M, as a5e's sheet sets them, quieter than C and R and still
   readable. Detect Magic is vocalized and seen. */
const compRows = out.rows.map((r) => r.comps).filter(Boolean);
check('each spell shows its components, V and S for Detect Magic',
  compRows.length === 3 && compRows.every((c) => c.t.replace(/\s/g, '') === 'VS') && compRows.every((c) => /Vocalized/.test(c.tip ?? '')),
  compRows.map((c) => `${c.t.replace(/\s/g, '')} "${c.tip}"`).slice(0, 1).join(''));
const compReadings = compRows.map((c) => {
  const s = [[c.x + c.w / 2, c.y - 3], [c.x + c.w / 2, c.y + c.h + 3]].map(([x, y]) => png.pixel(x, y));
  const bg = s.reduce((a, p) => a.map((v, i) => v + p[i] / s.length), [0, 0, 0]);
  return contrast(rgb(c.color), bg);
});
check('the components read at 4.5:1 or better on every row colour', compReadings.length === 3 && compReadings.every((r) => r >= 4.5),
  compReadings.map((r) => r.toFixed(1)).join(', '));

/* Prepared colours. */
const transparent = (c) => !c || /rgba\(0, 0, 0, 0\)/.test(c) || c === 'transparent';
check('a5e’s highlight colours resolve on this sheet', !transparent(out.green) && !transparent(out.purple)
  && !transparent(out.greenIcon) && !transparent(out.purpleIcon),
  `green ${out.green}, purple ${out.purple}`);
check('a prepared spell’s row is a5e’s prepared green', row('Prepared').bg?.includes(out.green), row('Prepared').bg);
check('an always-prepared spell’s row is a5e’s purple', row('Always').bg?.includes(out.purple), row('Always').bg);
check('an unprepared spell’s row is left plain', row('Plain').bg === 'none', row('Plain').bg);

/* The prepare button. */
const preps = out.rows.map((r) => r.prep);
check('every spell row has a prepare button among its own buttons, as in a5e',
  preps.every(Boolean) && out.rows.every((r) => r.nameIcons === 0),
  out.rows.map((r) => `${r.name.split(' ')[0]} ${r.prep ? 'button' : 'none'}${r.nameIcons ? ' + name icon' : ''}`).join(', '));
check('the button is at least 20px and a click at its centre reaches it',
  preps.every((p) => p && p.w >= 20 && p.h >= 20 && p.reached),
  preps.map((p) => p ? `${p.w.toFixed(0)}x${p.h.toFixed(0)} ${p.reached ? 'reached' : 'MISSED 2192 ' + p.hit}` : 'none').join(', '));
check('prepared and always-prepared buttons are a5e’s active green and purple',
  row('Prepared').prep?.color === out.greenIcon && row('Always').prep?.color === out.purpleIcon,
  `prepared ${row('Prepared').prep?.color} (a5e ${out.greenIcon}), always ${row('Always').prep?.color} (a5e ${out.purpleIcon})`);
check('the actions column is as wide in the rows as in the heading',
  out.rows.every((r) => Math.abs(r.actionsW - out.headActionsW) < 1),
  `heading ${out.headActionsW.toFixed(0)}px, rows ${[...new Set(out.rows.map((r) => r.actionsW.toFixed(0)))].join('/')}px`);

let bad = 0;
for (const [name, ok, detail] of results) {
  if (!ok) bad++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name.padEnd(76)} ${detail}`);
}
process.exit(bad ? 1 : 0);
