/* Real clicks on the sheet's controls, with the sheet's own script bound in a
 * real browser: do they write what they should?
 *
 * Reported as: the spell-slot stars neither spend nor restore; earlier, the
 * Settings boxes would not come off. controls.mjs had proved both handlers
 * write the right path — by calling them. This clicks.
 */
import Handlebars from 'handlebars';
import { readFileSync } from 'fs';
import { buildSheet, R } from './lib/sheetdom.mjs';
import { liveSheet } from './lib/livebrowser.mjs';

const results = [];
const check = (name, ok, detail) => results.push([name, ok, detail]);

const chars = JSON.parse(readFileSync(R + 'world-chars.json', 'utf8'));
const pick = chars.filter((c) => c.items.some((i) => i.type === 'spell'))
  .sort((a, b) => b.items.length - a.items.length)[0];

const slots = { 1: { current: 2, max: 4, override: 0 }, 2: { current: 3, max: 3, override: 0 } };
const { sheet, actor } = await buildSheet({ choose: (all) => all.find((c) => c.actor._id === pick.actor._id) });
actor.flags.a5e = { ...(actor.flags.a5e ?? {}), sheetIsLocked: true };
actor.system.spellResources = { ...(actor.system.spellResources ?? {}), slots };
const tpl = Handlebars.compile(readFileSync(R + 'templates/sheet/tidy-character-sheet.hbs', 'utf8'));
const html = tpl(await sheet.getData());

async function probe(doc, { writes, actor }) {
  doc.querySelectorAll('.tab[data-group="primary"]').forEach((t) => t.classList.toggle('active', t.dataset.tab === 'magic'));
  const realClick = (el) => {
    el.scrollIntoView({ block: 'center' });
    const b = el.getBoundingClientRect();
    const x = b.x + b.width / 2, y = b.y + b.height / 2;
    const target = doc.elementFromPoint(x, y) ?? el;
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'])
      target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, view: window }));
    return target;
  };
  const out = {};
  const stars = [...doc.querySelectorAll('[data-action="slot-pip"]')];
  out.stars = stars.length;
  const lit = stars.find((s) => s.dataset.level === '1' && s.dataset.n === '2');
  const dark = stars.find((s) => s.dataset.level === '1' && s.dataset.n === '4');
  writes.length = 0;
  if (lit) { out.litHit = realClick(lit).className; await new Promise((r) => setTimeout(r, 50)); }
  out.afterLit = structuredClone(writes);
  writes.length = 0;
  if (dark) { out.darkHit = realClick(dark).className; await new Promise((r) => setTimeout(r, 50)); }
  out.afterDark = structuredClone(writes);

  /* A write that fails: the star is drawn at once, then put back, and the
     reason is said. */
  const notes = [];
  ui.notifications.error = (m) => notes.push(m);
  ui.notifications.warn = (m) => notes.push(m);
  const realUpdate = actor.update;
  actor.update = async () => { throw new Error('the document refused the update'); };
  const star3 = stars.find((s) => s.dataset.level === '1' && s.dataset.n === '1');
  if (star3) {
    const before = star3.classList.contains('am-slot-spent');
    realClick(star3);
    const during = star3.classList.contains('am-slot-spent');
    await new Promise((r) => setTimeout(r, 50));
    out.refused = { before, during, after: star3.classList.contains('am-slot-spent'), notes: [...notes] };
  }
  actor.update = realUpdate;

  doc.querySelectorAll('.tab[data-group="primary"]').forEach((t) => t.classList.toggle('active', t.dataset.tab === 'settings'));
  const box = [...doc.querySelectorAll('[data-action="setting-toggle"]')].find((b) => b.dataset.path === 'flags.a5e.showPassiveScores');
  writes.length = 0;
  if (box) { const before = box.checked; realClick(box); await new Promise((r) => setTimeout(r, 50)); out.box = { before, after: box.checked, disabled: box.disabled }; }
  out.afterBox = structuredClone(writes);
  return out;
}

const { bindError, result } = await liveSheet({ html, actorData: pick, rootClasses: sheet.constructor.defaultOptions.classes,
  probe, patch: { system: { spellResources: { ...(pick.actor.system.spellResources ?? {}), slots } }, flags: { a5e: { ...(pick.actor.flags?.a5e ?? {}), sheetIsLocked: true } } } });

check('activateListeners completes in a real browser', !bindError, bindError ?? 'no error');
check('the slot stars are drawn', result.stars >= 6, `${result.stars} stars`);
check('a real click on a lit star spends down to it (current 2 → 1)',
  result.afterLit.some((w) => w['system.spellResources.slots.1.current'] === 1),
  `${JSON.stringify(result.afterLit)} — click landed on ${result.litHit}`);
check('a real click on a spent star recovers up to it (current 2 → 4)',
  result.afterDark.some((w) => w['system.spellResources.slots.1.current'] === 4),
  `${JSON.stringify(result.afterDark)} — click landed on ${result.darkHit}`);
check('a star whose write is refused changes at once, goes back, and says why',
  !!result.refused && result.refused.during !== result.refused.before
    && result.refused.after === result.refused.before && result.refused.notes.some((n) => /refused/.test(n)),
  JSON.stringify(result.refused));
check('a real click on a Settings box writes its flag',
  result.afterBox.some((w) => 'flags.a5e.showPassiveScores' in w),
  `${JSON.stringify(result.box)} ${JSON.stringify(result.afterBox)}`);

let bad = 0;
for (const [name, ok, detail] of results) {
  if (!ok) bad++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name.padEnd(64)} ${detail}`);
}
process.exit(bad ? 1 : 0);
