/* The HP bar and the initiative badge, in headless Edge, with and without
 * Carolingian UI's stylesheet.
 *
 * 1. Reported more than once: a pale square at the right end of the HP bar.
 *    Carolingian UI styles every button in an old-style window's form with a
 *    15% black wash (`body.crlngn-ui .app:not(.default.sheet):not(.pokerole)
 *    form button`). The HP figure is a button over 148px of the 176px bar, so
 *    the green was darkened everywhere but its last 28px. This walks the bar
 *    pixel by pixel below the digits and reports the largest step in
 *    brightness between neighbours: 39 at +147px with Carolingian before the
 *    fix, 3 without it — a smooth gradient steps by 1 to 3.
 *
 * 2. Reported on a monster: the initiative figure is cut off at the sides.
 *    Tidy makes .ability.initiative 3rem wide with overflow:hidden and puts a
 *    3.25rem badge in it: column 48px, badge 52px, 2px off each side, on both
 *    sheets. The badge has to sit inside its column.
 *
 * 3. The spell-slot stars: a spent star must look unlike a lit one, and no
 *    button on either sheet may look different under Carolingian — see below.
 *
 *   node tools/checks/vitals.mjs            the check
 *   node tools/checks/vitals.mjs --shots    also a PNG per case
 */
import Handlebars from 'handlebars';
import { existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { buildSheet, R } from './lib/sheetdom.mjs';
import { buildNPCSheet } from './lib/npcdom.mjs';
import { inBrowser } from './lib/browser.mjs';
import { readPng } from './lib/png.mjs';

const SHOTS = process.argv.includes('--shots');
const results = [];
const check = (name, ok, detail) => results.push([name, ok, detail]);

const CRLNGN = R.replace(/a5e-mancer\/$/, '') + 'crlngn-ui/styles/crlngn-ui-v14.css';
const haveCrlngn = existsSync(CRLNGN);
const modes = haveCrlngn ? [false, true] : [false];
if (!haveCrlngn) check('Carolingian UI installed', true, 'not installed here: only the plain cases run');

const pc = await buildSheet();
pc.actor.system.attributes.hp = { value: 45, max: 45, baseMax: 45, temp: 0, bonus: 0 };
pc.actor.flags.a5e = { ...(pc.actor.flags.a5e ?? {}), sheetIsLocked: true };
/* One slot left of two: a lit star and a spent one on the Level 1 heading. */
pc.actor.system.spellResources = { ...(pc.actor.system.spellResources ?? {}),
  slots: { 1: { current: 1, max: 2, override: 0 } } };
const pcHtml = Handlebars.compile(readFileSync(R + 'templates/sheet/tidy-character-sheet.hbs', 'utf8'))(await pc.sheet.getData());
const npc = await buildNPCSheet();
const npcHtml = Handlebars.compile(readFileSync(R + 'templates/sheet/npc-sheet.hbs', 'utf8'))(await npc.sheet.getData());

function measure(doc, crl) {
  if (crl) doc.body.classList.add('crlngn-ui', 'crlngn-sheets', 'crlngn-tabs', 'crlngn-sheet-tabs');
  const rect = (el) => { const b = el?.getBoundingClientRect(); return b ? [b.left, b.top, b.width, b.height] : null; };
  const col = doc.querySelector('.ability.initiative');
  return {
    bar: rect(doc.querySelector('.meter.progress.hit-points')),
    column: rect(col), columnOverflow: col && getComputedStyle(col).overflow,
    badge: rect(doc.querySelector('.ability.initiative .initiative-score-container')),
    stars: [...doc.querySelectorAll('[data-action="slot-pip"]')].map((s) => {
      const cs = getComputedStyle(s);
      return { spent: s.classList.contains('am-slot-spent'), bg: cs.backgroundColor,
               glyph: getComputedStyle(s.querySelector('i')).color, border: cs.borderTopColor };
    }),
    /* Every button on the sheet, hidden tabs included: computed styles are
       resolved for them all the same. */
    buttons: [...doc.querySelectorAll('.window-content button')].map((b, i) => {
      const cs = getComputedStyle(b);
      return [`${i} ${b.dataset.action ?? b.className}`, [cs.backgroundColor, cs.color, cs.borderTopWidth, cs.borderTopColor, cs.margin].join(' | ')];
    })
  };
}

const buttonsBy = {};

for (const [who, html, classes] of [['character', pcHtml, pc.sheet.constructor.defaultOptions.classes],
                                    ['NPC', npcHtml, npc.sheet.constructor.defaultOptions.classes]]) {
  for (const crl of modes) {
    const tag = `${who}${crl ? ', Carolingian' : ''}`;
    const shot = join(tmpdir(), `am-vitals-${who}-${crl ? 'crlngn' : 'plain'}.png`);
    const { out } = inBrowser({
      html: (crl ? `<link rel="stylesheet" href="file:///${CRLNGN}">` : '') + html,
      rootClasses: classes, screenshot: shot,
      probe: new Function('doc', `return (${measure.toString()})(doc, ${crl});`)
    });

    if (who === 'character') {
      const png = readPng(shot);
      const [x, y, w, h] = out.bar.map(Math.round);
      const yy = y + h * 0.8;
      let worst = 0, at = 0;
      for (let px = x + 4; px < x + w - 4; px++) {
        const a = png.pixel(px, yy), b = png.pixel(px + 1, yy);
        const d = Math.abs((a[0] + a[1] + a[2]) - (b[0] + b[1] + b[2]));
        if (d > worst) { worst = d; at = px - x; }
      }
      check(`${tag}: the HP bar is one smooth gradient`, worst <= 8, `largest step ${worst} at +${at}px of ${w}px`);
    }

    const [cl, , cw] = out.column, [bl, , bw] = out.badge;
    const inside = bl >= cl - 0.5 && bl + bw <= cl + cw + 0.5;
    check(`${tag}: the initiative badge sits inside its column`, inside || out.columnOverflow === 'visible',
      `column ${cl}..${cl + cw} (${cw}px, overflow ${out.columnOverflow}), badge ${bl}..${bl + bw} (${bw}px)`);

    if (who === 'character') {
      const lit = out.stars.find((s) => !s.spent), spent = out.stars.find((s) => s.spent);
      check(`${tag}: a spent slot star looks unlike a lit one`,
        !!lit && !!spent && lit.bg !== spent.bg && lit.glyph !== spent.glyph,
        lit && spent ? `lit ${lit.bg} / ${lit.glyph}; spent ${spent.bg} / ${spent.glyph}` : `${out.stars.length} stars drawn`);
    }
    (buttonsBy[who] ??= {})[crl ? 'crl' : 'plain'] = new Map(out.buttons);
    if (SHOTS) console.log(`  picture: ${shot}`);
  }
}

/* 3. Reported three times: the slot stars do not work. The world's own log
      had each click writing the right count, and nothing on the sheet
      changing: Carolingian's button rule (the one in 1.) outweighed the lit
      and spent styles, and drew both the same. The sheet now opts out of
      that rule, so no button should look any different under Carolingian. */
for (const [who, by] of Object.entries(buttonsBy)) {
  if (!by.crl) continue;
  const differ = [...by.plain].filter(([k, v]) => by.crl.get(k) !== v);
  check(`${who}: no button looks different under Carolingian`, differ.length === 0,
    differ.length ? `${differ.length} of ${by.plain.size}, e.g. ${differ[0][0]}: ${differ[0][1]}  →  ${by.crl.get(differ[0][0])}`
                  : `${by.plain.size} buttons compared`);
}

let bad = 0;
for (const [name, ok, detail] of results) {
  if (!ok) bad++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name.padEnd(58)} ${detail}`);
}
process.exit(bad ? 1 : 0);
