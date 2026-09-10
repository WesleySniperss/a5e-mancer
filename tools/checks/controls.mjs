/* Controls that are supposed to do a particular thing, asked whether they do it.
 *
 * fireall.mjs asks a weaker question — did anything at all happen — and it
 * cannot ask a stronger one, because "something happened" is all it knows. That
 * is not enough for the failures this project keeps producing. A coin field
 * that writes system.currency.undefined "does something": it calls update. It
 * is still broken, and it was broken for as long as anyone had been using this
 * sheet, because the input carries data-denom and the handler read
 * dataset.currency.
 *
 * So each case here names the control, presses it, and states what must be true
 * afterwards — the exact path written, the exact rows hidden. Every one of them
 * is a bug that was actually shipped, kept so it cannot come back.
 */
import { buildSheet, listeners, takeEffects, eventOn, q } from './lib/sheetdom.mjs';

const { sheet, actor, root, writes, character, render } = await buildSheet();

const results = [];
const check = (name, ok, detail) => { results.push([name, ok, detail]); };

/** Call the listeners of one type bound to an element. */
async function fireType(el, type, extra = {}) {
  const fns = listeners.filter(l => l.el === el && l.type === type);
  for (const f of fns) await f.fn(eventOn(el, extra));
  return fns.length;
}
const pathsWritten = () => writes.flatMap(w => Object.keys(w));

/* ── coins ──────────────────────────────────────────────────────────────
   The one that was broken: data-denom in the markup, dataset.currency in the
   handler, so every edit went to system.currency.undefined and the coin
   snapped back with nothing in the console. */
{
  const inputs = q(root, '[data-action="currency-edit"]');
  const wrote = [];
  for (const inp of inputs) {
    writes.length = 0;
    inp.value = '7';
    await fireType(inp, 'change');
    wrote.push([inp.dataset.denom, pathsWritten()]);
  }
  const bad = wrote.filter(([denom, paths]) =>
    !paths.includes(`system.currency.${denom}`));
  check('coin fields write system.currency.<denomination>',
    inputs.length > 0 && bad.length === 0,
    bad.length ? bad.map(([d, p]) => `${d} -> ${p.join(',') || 'nothing'}`).join('; ')
               : `${inputs.length} denominations, each to its own path`);
}

/* ── the features search ────────────────────────────────────────────────
   Drawn on both sheets, and for the whole life of the Quadrone rewrite it
   filtered .am-feat-item — markup that rewrite had already replaced. Typing
   in it did nothing whatever. */
{
  const box = root.querySelector('#am-feature-search');
  const tab = root.querySelector('.tidy-tab.features');
  const rows = tab ? q(tab, '.tidy-table-row-container') : [];
  const nameOf = (r) => (r.querySelector('.item-name')?.textContent ?? '').trim();

  let detail = 'no features on this character to filter';
  let ok = !!box && !!tab;
  if (box && rows.length) {
    /* A word out of one real feature's name, so at least that row must stay. */
    const target = nameOf(rows[0]).split(/\s+/).find(w => w.length > 3) ?? nameOf(rows[0]);
    box.value = target;
    await fireType(box, 'input');
    const kept = rows.filter(r => !r.classList.contains('am-hidden'));
    const hid  = rows.filter(r => r.classList.contains('am-hidden'));
    const wrongKept = kept.filter(r => !nameOf(r).toLowerCase().includes(target.toLowerCase()));
    ok = kept.length > 0 && hid.length > 0 && wrongKept.length === 0;
    detail = `"${target}": ${kept.length} of ${rows.length} rows kept`
           + (wrongKept.length ? `, ${wrongKept.length} of them not matching` : '');

    /* And clearing it must bring everything back. */
    box.value = '';
    await fireType(box, 'input');
    const back = rows.filter(r => !r.classList.contains('am-hidden')).length;
    if (back !== rows.length) { ok = false; detail += `; cleared, only ${back} came back`; }
  }
  check('the features search hides the rows that do not match', ok, detail);
}

/* ── the searches that filter in place ──────────────────────────────────
   These carry a data-action but listen for `input`, so fireall's click/change
   pass reports them as unbound. They are not; this is where that is settled. */
for (const [action, rowSel] of [['inv-search', '.tidy-table-row-container'],
                                ['fx-search',  '.am-fx-row']]) {
  const box = root.querySelector(`[data-action="${action}"]`);
  const n = box ? await fireType(box, 'input') : 0;
  check(`${action} answers an input event`, n > 0,
    box ? `${n} listener(s)` : 'the box itself is not drawn');
}

/* ── hit points take a sign ─────────────────────────────────────────────
   The +/- buttons were removed in favour of typing +N or -N, which has to
   reach a5e's own applyHealing and applyDamage rather than setting the value. */
{
  const hp = root.querySelector('#am-hp-current');
  const seen = [];
  for (const typed of ['+5', '-3']) {
    if (!hp) break;
    takeEffects();
    hp.value = typed;
    await fireType(hp, 'change');
    seen.push([typed, takeEffects()]);
  }
  const heals = seen.find(([t]) => t === '+5')?.[1] ?? [];
  const hurts = seen.find(([t]) => t === '-3')?.[1] ?? [];
  check('typing +5 heals and -3 damages',
    heals.some(e => /applyHealing/.test(e)) && hurts.some(e => /applyDamage/.test(e)),
    hp ? `+5 -> ${heals.join(',') || 'nothing'} | -3 -> ${hurts.join(',') || 'nothing'}`
       : 'the field is not drawn');
}

/* ── the spell-slot stars ───────────────────────────────────────────────
   a5e derives slots.N.max during prepareData, so every character read
   straight out of the world has a stored max of 0 and no stars to press.
   They are seeded here for that reason, and only that reason: the question
   is what the control does, not what this world happens to hold.

   a5e's own rule, from its ItemListSpellSlots component: star n is spent
   when n is above what is left; clicking a lit star sets current to n-1,
   clicking a spent one sets it to n. */
{
  /* A second sheet, for a character who actually casts: the stars sit on a
     spell table's heading, and the character with the most items in this
     world has no spells at all. */
  const { actor: caster, writes: casterWrites, render: renderCaster } =
    await buildSheet({ choose: (all) => all
      .filter(c => c.items.some(i => i.type === 'spell'))
      .sort((a, b) => b.items.length - a.items.length)[0] });

  caster.system.spellResources = caster.system.spellResources ?? {};
  caster.system.spellResources.slots = { ...(caster.system.spellResources.slots ?? {}),
    '3': { current: 2, max: 4, override: 0 } };
  const r = await renderCaster();
  const stars = q(r, '.am-slot').filter(b => b.dataset.level === '3');
  const spent = stars.filter(b => b.classList.contains('am-slot-spent'));

  check('a level heading draws one star per slot', stars.length === 4,
    `${stars.length} stars for 4 slots, ${spent.length} of them spent`);
  check('the spent ones are the ones above what is left', spent.length === 2,
    `current 2 of 4, so stars 3 and 4 should be dark: ${spent.length} are`);

  /* Click star 2, which is lit: a5e sets current to 1. */
  casterWrites.length = 0;
  const lit = stars.find(b => b.dataset.n === '2');
  if (lit) await fireType(lit, 'click');
  const afterSpend = casterWrites.map(w => w['system.spellResources.slots.3.current'])
    .filter(v => v !== undefined);
  check('clicking a lit star spends down to it', afterSpend[0] === 1,
    `current 2, clicked star 2 -> ${afterSpend[0] ?? 'nothing written'} (a5e: 1)`);

  /* Click star 4, which is spent: a5e sets current to 4. */
  casterWrites.length = 0;
  const dark = stars.find(b => b.dataset.n === '4');
  if (dark) await fireType(dark, 'click');
  const afterRecover = casterWrites.map(w => w['system.spellResources.slots.3.current'])
    .filter(v => v !== undefined);
  check('clicking a spent star recovers up to it', afterRecover[0] === 4,
    `current 2, clicked star 4 -> ${afterRecover[0] ?? 'nothing written'} (a5e: 4)`);

  /* And the row of nine tracker cards is gone. */
  check('the old row of slot trackers is gone',
    q(r, '[data-action="slot-dec"]').length === 0
    && q(r, '[data-action="slot-inc"]').length === 0,
    'no slot-dec / slot-inc anywhere on the sheet');
}

/* ── the sidebar toggle ─────────────────────────────────────────────────
   Changes no document, so "did something" can never see it. */
{
  const btn = root.querySelector('[data-action="toggle-sidebar"]');
  const bar = root.querySelector('.sidebar');
  const before = bar?.classList.contains('expanded');
  if (btn) await fireType(btn, 'click');
  const after = bar?.classList.contains('expanded');
  check('the sidebar toggle opens and closes the sidebar',
    !!btn && !!bar && before !== after,
    !btn ? 'no toggle drawn' : !bar ? 'no sidebar drawn' : `expanded ${before} -> ${after}`);
}

/* ── report ─────────────────────────────────────────────────────────────── */
console.log(`driving ${character}\n`);
let bad = 0;
for (const [name, ok, detail] of results) {
  if (!ok) bad++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}`);
  console.log(`        ${detail}`);
}
console.log(bad ? `\n${bad} control(s) do not do what they are for`
                : `\nevery control checked here does what it is for`);
process.exit(bad ? 1 : 0);
