/* Editing hit points, locked and unlocked; and whether a star lights where it
 * was clicked.
 *
 * Reported as: clicking the hit points offers current, maximum and temporary
 * whatever the padlock says. Unlocked that is right. Locked it should be the
 * one figure, replaced by what is typed, or healed and hurt by +N and -N —
 * damage through temporary hit points first. That arithmetic is a5e's own
 * (applyDamage in documents/actor/base.svelte.ts takes temp first), and the
 * field already routed a sign to it; what was wrong was the offer.
 *
 * And: starring something on its own tab left that star hollow. Only the
 * Favorites tab's rows carried `starred`, so the item was starred — it showed
 * under Favorites — and the star clicked on Inventory, Magic, Martial or
 * Features never lit.
 */
import { buildSheet, listeners, q } from './lib/sheetdom.mjs';

const results = [];
const check = (name, ok, detail) => results.push([name, ok, detail]);
const fire = async (el, type) => {
  for (const l of listeners.filter((x) => x.el === el && x.type === type))
    await l.fn({ preventDefault(){}, stopPropagation(){}, currentTarget: el, target: el });
};
const byId = (root, id) => q(root, `#${id}`)[0] ?? null;

/* ── Hit points ──────────────────────────────────────────────────────────── */
for (const locked of [true, false]) {
  const { actor, render, writes } = await buildSheet();
  actor.flags.a5e = { ...(actor.flags.a5e ?? {}), sheetIsLocked: locked };
  actor.system.attributes.hp = { value: 30, max: 45, baseMax: 45, temp: 5, bonus: 0 };
  const calls = [];
  actor.applyDamage = async (n) => { calls.push(['damage', n]); };
  actor.applyHealing = async (n) => { calls.push(['healing', n]); };
  const root = await render();
  const cur = byId(root, 'am-hp-current'), max = byId(root, 'am-hp-max'), temp = byId(root, 'am-hp-temp');
  const who = locked ? 'locked' : 'unlocked';

  if (locked) {
    check('locked: the editor is the current figure alone', !!cur && !max && !temp,
      `current ${!!cur}, max ${!!max}, temp ${!!temp}`);
  } else {
    check('unlocked: current, maximum and temporary', !!cur && !!max && !!temp,
      `current ${!!cur}, max ${!!max}, temp ${!!temp}`);
  }
  check(`${who}: the field holds the figure to be replaced`, cur?.attrs?.value === '30', `value "${cur?.attrs?.value}"`);

  if (cur) {
    calls.length = 0; writes.length = 0;
    cur.value = '-7'; await fire(cur, 'change');
    check(`${who}: -7 is damage, through a5e (temporary hit points first)`,
      calls.length === 1 && calls[0][0] === 'damage' && calls[0][1] === 7 && !writes.length,
      JSON.stringify(calls));
    calls.length = 0;
    cur.value = '+4'; await fire(cur, 'change');
    check(`${who}: +4 is healing, through a5e`, calls.length === 1 && calls[0][0] === 'healing' && calls[0][1] === 4,
      JSON.stringify(calls));
    calls.length = 0; writes.length = 0;
    cur.value = '12'; await fire(cur, 'change');
    check(`${who}: 12 sets the current figure`, !calls.length && writes.some((w) => w['system.attributes.hp.value'] === 12),
      JSON.stringify(writes));
  }
}

/* ── Stars ───────────────────────────────────────────────────────────────── */
/* Two characters: the one with most items, and the one with most spells, so
   Inventory, Features, Martial and Magic are all drawn. An item packed in a
   container is drawn inside it, not in the list, so a loose one is taken. */
for (const pick of [(all) => all.slice().sort((a, b) => b.items.length - a.items.length)[0],
                    (all) => all.slice().sort((a, b) => b.items.filter((i) => i.type === 'spell').length
                                                         - a.items.filter((i) => i.type === 'spell').length)[0]]) {
  const { actor, render } = await buildSheet({ choose: pick });
  const all = [...actor.items.values()].filter((it) => !it.system?.containerId);
  const byType = new Map();
  for (const it of all) if (!byType.has(it.type)) byType.set(it.type, it);
  for (const it of byType.values()) it.system.favorite = true;
  const root = await render();
  const tabs = new Map();
  for (const [type, it] of byType) {
    const stars = q(root, `[data-action="item-star"][data-id="${it.id}"]`);
    const places = stars.map((b) => {
      const tab = b.closest?.('.tab')?.dataset?.tab ?? '?';
      const lit = q(b, 'i')[0]?.attrs?.class?.includes('fa-solid');
      return `${tab}:${lit ? 'lit' : 'hollow'}`;
    });
    tabs.set(type, places);
  }
  const hollow = [...tabs].flatMap(([t, p]) => p.filter((x) => x.endsWith('hollow')).map((x) => `${t} on ${x}`));
  const drawnOutsideFavorites = [...tabs].filter(([, p]) => p.some((x) => !x.startsWith('favorites'))).length;
  check(`${actor.name}: a starred item’s star is lit on every tab it is drawn on`,
    hollow.length === 0 && drawnOutsideFavorites >= 3,
    hollow.length ? `hollow: ${hollow.join(', ')}` : [...tabs].map(([t, p]) => `${t} ${p.join(' ')}`).join('; '));

  for (const it of byType.values()) it.system.favorite = false;
  const root2 = await render();
  const lit = [...byType.values()].flatMap((it) => q(root2, `[data-action="item-star"][data-id="${it.id}"] i`))
    .filter((i) => i.attrs?.class?.includes('fa-solid'));
  check(`${actor.name}: and unstarred, none is`, lit.length === 0, `${lit.length} lit`);
}

let bad = 0;
for (const [name, ok, detail] of results) {
  if (!ok) bad++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name.padEnd(64)} ${detail}`);
}
process.exit(bad ? 1 : 0);
