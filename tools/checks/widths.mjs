/* The character sheet at the widths it is actually opened at.
 *
 * Reported: on a smaller screen some numbers and values are eaten, or end up
 * outside their frames. The sheet opens at 820px, and every earlier layout
 * check measured it there and nowhere else.
 *
 * This lays the sheet out in headless Edge at several window widths, applies
 * the abilities-row layout class the sheet's own ResizeObserver would (the
 * probe must, since no sheet JavaScript runs here), and lists every piece of
 * text that is cut: wider or taller than a box that clips it, or out past the
 * window's content.
 *
 *   node tools/checks/widths.mjs            the check
 *   node tools/checks/widths.mjs --shots    also a PNG per width
 *   node tools/checks/widths.mjs --tab=magic   another tab under the header
 */
import Handlebars from 'handlebars';
import { readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { buildSheet, R } from './lib/sheetdom.mjs';
import { inBrowser } from './lib/browser.mjs';

const SHOTS = process.argv.includes('--shots');
const TAB = (process.argv.find((a) => a.startsWith('--tab=')) ?? '--tab=favorites').slice(6);
/* Tidy's sheet will not go narrower than 700px, so that is the floor. */
const WIDTHS = (process.argv.find((a) => a.startsWith('--widths='))?.slice(9).split(',').map(Number)) ?? [700, 760, 820, 960, 1200];
const HEIGHT = Number(process.argv.find((a) => a.startsWith('--height='))?.slice(9) ?? 860);
const results = [];
const check = (name, ok, detail) => results.push([name, ok, detail]);

/* --char=Name picks a character from world-chars.json; --font=18 sets the root
   font size, as Foundry's interface scale does - every size here is in rem. */
const CHAR = process.argv.find((a) => a.startsWith('--char='))?.slice(7);
const FONT = Number(process.argv.find((a) => a.startsWith('--font='))?.slice(7) ?? 0);
const pc = await buildSheet(CHAR ? { choose: (cs) => cs.find((c) => c.actor.name === CHAR) ?? cs[0] } : {});
pc.actor.flags.a5e = { ...(pc.actor.flags.a5e ?? {}), sheetIsLocked: true };
const html = Handlebars.compile(readFileSync(R + 'templates/sheet/tidy-character-sheet.hbs', 'utf8'))(await pc.sheet.getData());
const classes = pc.sheet.constructor.defaultOptions.classes;

/* Runs in the page. The layout class is the sheet's own arithmetic
   (applyAbilityLayout): 3.5rem an ability to collapse, 4rem to shrink, plus
   20.5rem of everything else. */
function probe(doc, width, tab, font) {
  if (font) doc.documentElement.style.fontSize = font + 'px';
  const fontPx = parseFloat(getComputedStyle(doc.documentElement).fontSize) || 16;
  /* The width the sheet is drawn at: Tidy will not let it go under 43.75rem,
     whatever width was asked for - applyAbilityLayout measures the same way */
  const drawn = doc.querySelector('.window-content > *')?.getBoundingClientRect().width || width;
  const rems = drawn / fontPx;
  const box = doc.querySelector('.abilities-container');
  box?.classList.toggle('abilities-size-compact', rems < 6 * 3.5 + 20.5);
  box?.classList.toggle('abilities-size-small', rems >= 6 * 3.5 + 20.5 && rems < 6 * 4 + 20.5);
  // Show the tab asked for, as a click on it would
  for (const t of doc.querySelectorAll('.tidy-tab[data-tab]')) t.classList.toggle('active', t.dataset.tab === tab);

  // The window's own frame: the content box grows with what overflows it
  const content = doc.querySelector('.window-app').getBoundingClientRect();
  const clips = (el) => { const o = getComputedStyle(el); return /hidden|clip|auto|scroll/.test(o.overflowX + o.overflowY); };
  /* Drawn at all: not in a collapsed row (an expandable wrapper at height 0),
     not hidden */
  const shown = (el) => {
    const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
    if (!(r.width > 0 && r.height > 0) || s.visibility === 'hidden') return false;
    for (let a = el.parentElement; a; a = a.parentElement) {
      const b = a.getBoundingClientRect();
      if ((b.height === 0 || b.width === 0) && /hidden|clip/.test(getComputedStyle(a).overflow)) return false;
    }
    return true;
  };
  const cut = [];
  const leaves = [...doc.querySelectorAll('.window-content *')].filter((el) =>
    el.children.length === 0 && (el.textContent.trim() || el.tagName === 'INPUT') && shown(el)
    && !el.closest('.tidy-tab:not(.active)'));
  for (const el of leaves) {
    const r = el.getBoundingClientRect();
    const text = el.tagName === 'INPUT' ? `[input ${el.value}]` : el.textContent.trim().slice(0, 30);
    const where = (el.closest('[class]')?.className || el.tagName).toString().split(/\s+/).slice(0, 2).join('.');
    /* Wider than itself: text-overflow or a fixed width cutting the glyphs */
    /* An ellipsis is a summary cut on purpose (an item's context line), not text lost */
    const ellipsis = (e) => getComputedStyle(e).textOverflow === 'ellipsis';
    if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX !== 'visible' && el.clientWidth > 0 && !ellipsis(el)) {
      cut.push({ text, where, why: `own box ${el.clientWidth}px, needs ${el.scrollWidth}px` });
      continue;
    }
    /* Past an ancestor that clips it. A box that scrolls down clips only what
       cannot be scrolled to, which is what goes out sideways. */
    let a = el.parentElement, bad = null, scrolled = false;
    while (a && !a.classList.contains('window-content')) {
      if (clips(a)) {
        const b = a.getBoundingClientRect();
        /* A box that scrolls down only cuts what it cannot scroll to: sideways */
        const o = getComputedStyle(a);
        const scrollsY = /auto|scroll/.test(o.overflowY);
        if (r.left < b.left - 1 || r.right > b.right + 1 || (!scrollsY && !scrolled && (r.top < b.top - 1 || r.bottom > b.bottom + 1))) {
          bad = `outside ${a.className.toString().split(/\s+/).slice(0, 2).join('.')} (${Math.round(b.width)}x${Math.round(b.height)})`;
          break;
        }
        // Below a box that scrolls down, the rest is reached by scrolling
        if (scrollsY) scrolled = true;
      }
      a = a.parentElement;
    }
    if (!bad && (r.right > content.right + 1 || r.left < content.left - 1)) bad = 'outside the window';
    if (bad) cut.push({ text, where, why: bad });
  }
  const layout = box?.classList.contains('abilities-size-compact') ? 'compact' : box?.classList.contains('abilities-size-small') ? 'small' : 'normal';
  /* The initiative is Tidy's hexagon art, not a bordered box; the AC shield
     keeps its shape; nothing in the header row runs past the window */
  const init = doc.querySelector('.initiative-score-container');
  const ic = init && getComputedStyle(init);
  const shield = doc.querySelector('.ac-container .shield')?.getBoundingClientRect();
  const win = doc.querySelector('.window-app').getBoundingClientRect();
  const header = [...doc.querySelectorAll('.sheet-header *')].filter((e) => e.getBoundingClientRect().width > 0);
  const past = header.filter((e) => e.getBoundingClientRect().right > win.right + 1).map((e) => String(e.className).split(' ')[0]).slice(0, 4);
  return { layout, cut, drawn: Math.round(drawn),
    initiative: ic ? { image: ic.backgroundImage !== 'none', border: parseFloat(ic.borderTopWidth) || 0 } : null,
    shield: shield ? +(shield.height / shield.width).toFixed(2) : null, past };
}

for (const width of WIDTHS) {
  const shot = join(tmpdir(), `am-width-${TAB}-${width}x${HEIGHT}.png`);
  const { out } = inBrowser({
    html, rootClasses: classes, width, height: HEIGHT, screenshot: SHOTS ? shot : undefined,
    probe: new Function('doc', `return (${probe.toString()})(doc, ${width}, ${JSON.stringify(TAB)}, ${FONT});`)
  });
  const tag = `${width}px${FONT ? ` @${FONT}px` : ''} (${out.layout}, drawn ${out.drawn})`;
  check(`${tag}: the initiative is the hexagon, not a frame`, out.initiative?.image && !out.initiative?.border && out.layout !== 'compact', JSON.stringify(out.initiative));
  check(`${tag}: the AC shield keeps its shape`, out.shield > 1 && out.shield < 1.4, `height/width ${out.shield}`);
  check(`${tag}: nothing in the header runs past the window`, out.past.length === 0, out.past.join(', ') || 'none');
  check(`${tag}: nothing cut`, out.cut.length === 0,
    out.cut.length ? `${out.cut.length}: ` + out.cut.slice(0, 6).map((c) => `"${c.text}" in ${c.where} — ${c.why}`).join('; ') : 'all text inside its box');
  if (SHOTS) console.log(`  picture: ${shot}`);
}

let bad = 0;
for (const [name, ok, detail] of results) {
  if (!ok) bad++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name.padEnd(72)} ${detail}`);
}
process.exit(bad ? 1 : 0);
