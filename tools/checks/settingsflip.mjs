/* Tick a switch, redraw, untick it, redraw — and read the box each time.
 *
 * Reported as: the checkboxes in Settings cannot be unticked.
 *
 * Every check here that touched Settings had an actor whose update() recorded
 * the call and changed nothing. So each could prove the handler SENT the right
 * path and value, and none could prove the value came back on the next render.
 * A switch that writes correctly and is read back wrongly passes all of them.
 *
 * This one's actor applies what it is sent, dotted paths and all, and the sheet
 * is rendered again from that actor after every click — which is what Foundry
 * does after every update.
 */
import { buildSheet, listeners, q } from './lib/sheetdom.mjs';

const { sheet, actor, render } = await buildSheet();

/* An update that actually updates. */
const setPath = (obj, path, value) => {
  const parts = path.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (cur[parts[i]] === undefined || cur[parts[i]] === null || typeof cur[parts[i]] !== 'object')
      cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts.at(-1)] = value;
};
actor.update = async (data) => {
  for (const [path, value] of Object.entries(data)) setPath(actor, path, value);
  return actor;
};
actor.getFlag = (scope, key) => actor.flags?.[scope]?.[key];

const results = [];
const check = (name, ok, detail) => results.push([name, ok, detail]);

const boxFor = (root, path) => q(root, '[data-action="setting-toggle"]')
  .find((b) => b.dataset.path === path);
const isTicked = (b) => b ? ('checked' in (b.attrs ?? {})) : null;

const flip = async (box, to) => {
  box.checked = to;
  for (const l of listeners.filter((x) => x.el === box && x.type === 'change'))
    await l.fn({ target: box, currentTarget: box, preventDefault(){}, stopPropagation(){} });
};

let root = await render();
const paths = q(root, '[data-action="setting-toggle"]').map((b) => b.dataset.path);

/* ── Before anything is touched: does each box say what the page shows? ──
   This is what was actually broken. For the maneuver tab, the spell tab and
   the passive scores, the box read an unset flag as OFF while the sheet read
   it as ON — so the tab was there and its box was empty, and ticking it did
   nothing anyone could see. Flipping a switch on and off proves the write
   path. It cannot prove the box told the truth to begin with, which is why
   this check passed while the report stood. */
{
  const fresh = await buildSheet({ choose: (all) => all
    .slice().sort((a, b) => b.items.length - a.items.length)
    .find((c) => c.items.some((i) => i.type === 'maneuver')) });
  /* a character who has never opened Settings: no display flag set at all */
  for (const k of ['showFavoritesSection', 'showManeuverTab', 'showSpellTab',
                   'showPassiveScores', 'showXP', 'hideGenericResources'])
    if (fresh.actor.flags?.a5e) delete fresh.actor.flags.a5e[k];
  const r = await fresh.render();
  const box = (p) => q(r, '[data-action="setting-toggle"]').find((b) => b.dataset.path === p);
  const ticked = (p) => 'checked' in (box(p)?.attrs ?? {});

  const martialTab = q(r, '[data-tab="martial"]').length > 0;
  check('before anything is touched: the maneuver box matches the maneuver tab',
    ticked('flags.a5e.showManeuverTab') === martialTab,
    `tab ${martialTab ? 'shown' : 'hidden'}, box ${ticked('flags.a5e.showManeuverTab') ? 'ticked' : 'unticked'}`);

  const passivesShown = q(r, '.am-passives, [data-passive]').length > 0
    || /passive/i.test((r.querySelector('.tidy-tab.skills')?.textContent) ?? '');
  check('before anything is touched: the passive-scores box is ticked, as a5e defaults it',
    ticked('flags.a5e.showPassiveScores') === true,
    `box ${ticked('flags.a5e.showPassiveScores') ? 'ticked' : 'unticked'}; a5e reads an unset flag as on`);

  check('before anything is touched: experience is on, as a5e defaults it',
    ticked('flags.a5e.showXP') === true,
    `box ${ticked('flags.a5e.showXP') ? 'ticked' : 'unticked'}`);
}

for (const path of paths) {
  const label = q(root, '[data-action="setting-toggle"]')
    .find((b) => b.dataset.path === path)?.parent?.textContent?.trim() ?? path;

  /* Whatever it starts as, drive it to ticked, then unticked, then ticked. */
  let box = boxFor(root, path);
  const start = isTicked(box);

  await flip(box, true);
  root = await render();
  const afterOn = isTicked(boxFor(root, path));

  await flip(boxFor(root, path), false);
  root = await render();
  const afterOff = isTicked(boxFor(root, path));

  await flip(boxFor(root, path), true);
  root = await render();
  const afterOnAgain = isTicked(boxFor(root, path));

  const ok = afterOn === true && afterOff === false && afterOnAgain === true;
  check(label.replace(/\s+/g, ' ').slice(0, 48), ok,
    `started ${start ? 'on' : 'off'}; on -> ${afterOn ? 'on' : 'OFF'},`
    + ` off -> ${afterOff ? 'STILL ON' : 'off'}, on -> ${afterOnAgain ? 'on' : 'OFF'}`
    + `  (${path})`);
}

let bad = 0;
for (const [name, ok, detail] of results) {
  if (!ok) bad++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name.padEnd(48)} ${detail}`);
}
console.log(bad ? `\n${bad} switch(es) do not survive being turned off and redrawn`
                : `\nevery switch turns on, off and on again through a redraw`);
process.exit(bad ? 1 : 0);
