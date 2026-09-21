/* The patched sheet against a full redraw of the same actor, in real Foundry.
 *
 * _render skips Foundry's redraw when everything that changed is something
 * livePatch can draw in place. The only thing that makes that safe is this:
 * after the patch, the sheet's markup has to be what a full redraw of the same
 * actor would have produced, character by character. Both sides are serialized
 * by the same browser out of the same template, so any difference is a real
 * one — a number left stale, a class not toggled, a tooltip still reading the
 * old figure.
 *
 * It also checks the other half: a change nobody claims — a name, an item —
 * must still cost a redraw. A patch that swallowed those would leave the sheet
 * showing yesterday.
 *
 * Needs a Foundry serving a copy of the world (see tools/checks/README.md,
 * "live checks"), and Edge. Nothing here writes to a world you play in: every
 * value it sets it puts back, and it is pointed at a copy.
 *
 *   node tools/checks/livepatch.mjs [--url http://localhost:30011] [--user <id>]
 */
import { openBrowser } from './lib/cdp.mjs';

const arg = (name, fallback) => {
  const i = process.argv.indexOf('--' + name);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const BASE = arg('url', 'http://localhost:30011');
const USER = arg('user', null);

const results = [];
const check = (name, ok, detail = '') => results.push([name, ok, detail]);

/* Progress goes to stderr as it happens: a live world can stall on a dialog or
   a migration, and a check that only speaks at the end then says nothing. */
const step = (s) => process.stderr.write(`  · ${s}\n`);

const b = await openBrowser({ port: 9351 });
/* No question to the page may wait forever. */
const ev = (expr, ms = 90000) => Promise.race([b.evaluate(expr),
  new Promise((_, rej) => setTimeout(() => rej(new Error(`the page did not answer in ${ms / 1000}s: ${expr.trim().slice(0, 90)}`)), ms))]);
try {
  await b.send('Page.navigate', { url: BASE + '/join' });
  await b.sleep(2500);
  const user = USER ?? await b.evaluate(`(() => {
    const el = document.querySelector('select[name="userid"] option[value]:not([value=""])');
    return el?.value ?? null;
  })()`);
  if (!user) throw new Error('no user to join as — pass --user <id>');
  await b.evaluate(`fetch('/join', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'join', userId: ${JSON.stringify(user)}, password: '' }) }).then(r => r.status)`);
  await b.send('Page.navigate', { url: BASE + '/game' });
  let ready = false;
  for (let i = 0; i < 150 && !ready; i++) { await b.sleep(1000); try { ready = await b.evaluate('!!(window.game && game.ready)'); } catch {} }
  if (!ready) throw new Error('the world never came up');
  /* A hidden tab has its timers throttled to as much as a minute; every wait
     below would be measured in those. */
  if (await ev('document.hidden')) throw new Error('the Foundry tab is hidden — its timers are throttled; see lib/cdp.mjs');
  step('the world is up');
  await b.sleep(4000);

  /* ── The sheet under test, and the plumbing the cases share ───────────── */
  const setup = `
    window.__am = window.__am ?? (() => {
      const st = { redraws: 0 };
      const open = async (actor) => {
        /* A v1 window closes behind a slide animation, and a headless page
           may not run one to the end: wait for it, but not for ever. */
        for (const w of Object.values(ui.windows)) {
          await Promise.race([w.close?.(), new Promise((r) => setTimeout(r, 1500))]);
        }
        const key = Object.keys(CONFIG.Actor.sheetClasses[actor.type]).find((k) => k.startsWith('a5e.A5e'));
        const sheet = new (CONFIG.Actor.sheetClasses[actor.type][key].cls)(actor);
        const inner = sheet.getData.bind(sheet);
        sheet.getData = async (...a) => { st.redraws++; return inner(...a); };
        sheet.render(true);
        for (let i = 0; i < 80 && !sheet.rendered; i++) await new Promise((r) => setTimeout(r, 150));
        await new Promise((r) => setTimeout(r, 1500));
        st.sheet = sheet; st.actor = actor;
        return sheet;
      };
      /* The markup as it is SHOWN. A field's figure is its value property,
         which innerHTML does not serialize — it prints the attribute the
         template wrote — so each field's live value is written onto a copy.
         And a style set from script serializes as "--x: 5%;" where the
         template wrote "--x: 5%", so every style is put through the same
         parser on both sides. A tooltip Foundry is animating is not ours. */
      const markup = () => {
        const live = st.sheet.element[0];
        const copy = live.cloneNode(true);
        const fields = [...live.querySelectorAll('input, select, textarea')];
        const copies = [...copy.querySelectorAll('input, select, textarea')];
        fields.forEach((f, i) => copies[i]?.setAttribute('data-shown', f.type === 'checkbox' ? String(f.checked) : f.value));
        copy.querySelectorAll('input').forEach((f) => f.removeAttribute('value'));
        copy.querySelectorAll('[style]').forEach((n) => n.setAttribute('style', n.style.cssText));
        return copy.innerHTML
          .replace(/\\s*data-tooltip-id="[^"]*"/g, '')
          .replace(/ aria-describedby="[^"]*"/g, '');
      };
      /* Wait until nothing has redrawn the sheet for a while. */
      const quiet = async (ms = 2500) => {
        let seen = st.redraws, still = 0;
        for (let t = 0; t < 12000 && still < ms; t += 100) {
          await new Promise((r) => setTimeout(r, 100));
          if (st.redraws !== seen) { seen = st.redraws; still = 0; } else still += 100;
        }
      };
      /* Set the actor to a state and draw it the slow way: the ground truth.
         render: false keeps this write from drawing, but not the effects a5e
         writes after it, so those are waited out before the redraw. */
      const full = async (data) => {
        await st.actor.update(data, { render: false });
        await quiet();
        await st.sheet.render(true);
        await new Promise((r) => setTimeout(r, 900));
        return markup();
      };
      /* Set it the way play does, and let _render decide. Then wait for the
         sheet to go quiet: a5e can follow a write with effects of its own —
         Bloodied, Unconscious — and the sheet gathers those into one redraw
         that lands REDRAW_QUIET after the last of them. */
      const live = async (data) => {
        const before = st.redraws;
        await st.actor.update(data);
        await quiet();
        return { html: markup(), redraws: st.redraws - before };
      };
      return { st, open, markup, quiet, full, live };
    })(); 'ok'`;
  await b.evaluate(setup);

  /* ── Cases ────────────────────────────────────────────────────────────── */
  /* redraws: how many full redraws the change may cost. 0 is a patch. */
  const CASES = [
    /* From full, one point: above half, so no condition comes or goes. */
    { name: 'a point of damage', redraws: 0,
      from: (a) => ({ 'system.attributes.hp.value': a.hpMax }),
      to:   (a) => ({ 'system.attributes.hp.value': a.hpMax - 1 }) },
    /* To 0 a5e adds Unconscious and Incapacitated, one write each; back up it
       takes them off. Each asked for a redraw of its own — four, before —
       and gathered they are one: three trials on Casxangil, requests 250–300ms
       apart, one redraw each time. Gathering waits REDRAW_QUIET for the next,
       so a server slow enough to leave a longer gap splits the burst in two;
       measured once, with four other checks loading the machine. Two is
       allowed; three would mean the gathering is not working. */
    { name: 'down to nothing', redraws: { max: 2 },
      from: (a) => ({ 'system.attributes.hp.value': a.hpMax }),
      to:   () => ({ 'system.attributes.hp.value': 0 }) },
    { name: 'back up from nothing', redraws: { max: 2 },
      from: () => ({ 'system.attributes.hp.value': 0 }),
      to:   (a) => ({ 'system.attributes.hp.value': a.hpMax }) },
    { name: 'temporary hit points appearing', redraws: 1,
      from: () => ({ 'system.attributes.hp.temp': 0 }),
      to:   () => ({ 'system.attributes.hp.temp': 6 }) },
    { name: 'temporary hit points spent down', redraws: 0,
      from: () => ({ 'system.attributes.hp.temp': 6 }),
      to:   () => ({ 'system.attributes.hp.temp': 2 }) },
    { name: 'a point of exertion', redraws: 0, skipUnless: 'exertion',
      from: (a) => ({ 'system.attributes.exertion.current': Math.max(1, a.exertion) }),
      to:   (a) => ({ 'system.attributes.exertion.current': Math.max(0, a.exertion - 1) }) },
    /* A monster keeps exertion on this module's flag: a5e's NPC model has no
       field for it. */
    { name: 'a point of exertion', redraws: 0, skipUnless: 'npcExertion',
      from: () => ({ 'flags.a5e-mancer.exertion': { current: 3, max: 5 } }),
      to:   () => ({ 'flags.a5e-mancer.exertion.current': 2 }) },
    /* A book with showSpellSlots off (a5e's "Innate Spellcasting") draws no
       stars. Open on one, with nothing on screen to set, the rule leaves it
       to a redraw — the safe answer, and the one expected. The Archfey
       Enchanter opened on its innate book until homeSpellBook; it now opens
       on "Spellcasting", and its slot is patched like any other. */
    { name: 'a spell slot spent', redraws: (a) => (a.slotDrawn ? 0 : 1), skipUnless: 'slot',
      from: (a) => ({ [`system.spellResources.slots.${a.slotLevel}.current`]: a.slotMax }),
      to:   (a) => ({ [`system.spellResources.slots.${a.slotLevel}.current`]: Math.max(0, a.slotMax - 1) }) },
    /* A flag no rule owns. A name would do, but Foundry trims one, and a
       trailing space is then no change at all — nothing renders, and the
       check would be asking a question nobody asked. */
    { name: 'a change nobody claims still redraws', redraws: 1,
      from: () => ({ 'flags.world.amLivePatchProbe': 1 }),
      to:   () => ({ 'flags.world.amLivePatchProbe': 2 }) }
  ];

  const names = (await ev(`game.actors.filter(a => a.isOwner).map(a => a.name)`)) ?? [];
  const wanted = names.filter((n) => n).slice(0, 60);
  const chosen = await ev(`(() => {
    const want = ${JSON.stringify(wanted)};
    const withSheet = want.map(n => game.actors.getName(n)).filter(a => a && (a.type === 'character' || a.type === 'npc'));
    const score = (a) => a.items.size + (Object.values(a.system?.spellResources?.slots ?? {}).some(s => s.max > 0) ? 1000 : 0);
    /* The two heaviest characters, and a monster: the NPC sheet extends this
       one and inherits _render, over a template of its own. */
    const ranked = withSheet.sort((x, y) => score(y) - score(x));
    const best = [...ranked.filter(a => a.type === 'character').slice(0, 2), ...ranked.filter(a => a.type === 'npc').slice(0, 1)];
    return best.map(a => ({ name: a.name, id: a.id, type: a.type, items: a.items.size }));
  })()`);

  step(`testing on ${chosen.map((c) => `${c.name} (${c.type}, ${c.items} items)`).join(', ')}`);
  for (const who of chosen) {
    step(`opening ${who.name}`);
    const facts = await ev(`(async () => {
      const a = game.actors.get('${who.id}');
      await window.__am.open(a);
      const slots = Object.entries(a.system?.spellResources?.slots ?? {}).find(([, s]) => (s.max ?? 0) > 0);
      return { name: a.name, type: a.type, hp: a.system.attributes.hp.value, hpMax: a.system.attributes.hp.max,
               temp: a.system.attributes.hp.temp ?? 0,
               exertion: a.system.attributes?.exertion?.current ?? null,
               slotLevel: slots?.[0] ?? null, slotMax: slots?.[1]?.max ?? null,
               slotDrawn: !!slots && window.__am.st.sheet.element[0].querySelectorAll(
                 '[data-action="slot-pip"][data-level="' + slots[0] + '"], [data-action="slot-field"][data-level="' + slots[0] + '"]').length > 0,
               nodes: window.__am.st.sheet.element[0].querySelectorAll('*').length };
    })()`);

    /* Every field a case writes, as it was, put back at the end. */
    const restore = await ev(`(() => { const a = game.actors.get('${who.id}');
      const r = { 'system.attributes.hp.value': a.system.attributes.hp.value,
                  'system.attributes.hp.temp': a.system.attributes.hp.temp ?? 0,
                  'flags.world.-=amLivePatchProbe': null };
      if (${JSON.stringify(facts.exertion)} !== null) r['system.attributes.exertion.current'] = a.system.attributes.exertion.current;
      const lv = ${JSON.stringify(facts.slotLevel)};
      if (lv) r['system.spellResources.slots.' + lv + '.current'] = a.system.spellResources.slots[lv].current;
      const ex = a.flags?.['a5e-mancer']?.exertion;
      if (a.type === 'npc') r['flags.a5e-mancer.exertion'] = ex ?? { current: 0, max: 0 };
      return r; })()`);

    for (const c of CASES) {
      if (c.skipUnless === 'exertion' && facts.exertion === null) continue;
      if (c.skipUnless === 'slot' && !facts.slotLevel) continue;
      if (c.skipUnless === 'npcExertion' && facts.type !== 'npc') continue;
      /* Below 4, a point off full can already be half: Bloodied, a redraw. */
      if (c.name === 'a point of damage' && facts.hpMax < 4) continue;
      const from = JSON.stringify(c.from(facts));
      const to   = JSON.stringify(c.to(facts));
      step(`${facts.name}: ${c.name}`);
      const out = await ev(`(async () => {
        await window.__am.full(${from});
        const statuses = () => [...window.__am.st.actor.statuses].sort().join(',');
        const s0 = statuses();
        const live = await window.__am.live(${to});
        const moved = s0 !== statuses();
        const truth = await window.__am.full(${to});
        return { redraws: live.redraws, moved, same: live.html === truth,
                 lenLive: live.html.length, lenTruth: truth.length,
                 at: (() => { for (let i = 0; i < Math.min(live.html.length, truth.length); i++)
                        if (live.html[i] !== truth[i]) return { i, live: live.html.slice(Math.max(0, i - 60), i + 60), truth: truth.slice(Math.max(0, i - 60), i + 60) };
                      return null; })() };
      })()`);

      const who_ = `${facts.name}: ${c.name}`;
      check(`${who_} — drawn the same as a redraw`, out.same,
        out.same ? '' : `at ${out.at?.i}\n        patched … ${out.at?.live}\n        redrawn … ${out.at?.truth}`);
      /* A write whose preparing moved a condition — the monster that goes
         deaf at 269 — is no longer a number: it has to cost the redraw. */
      let want = typeof c.redraws === 'function' ? c.redraws(facts) : c.redraws;
      if (out.moved && want === 0) want = 1;
      const ok = typeof want === 'object' ? out.redraws >= 1 && out.redraws <= want.max : out.redraws === want;
      const said = typeof want === 'object' ? `1–${want.max} redraws` : want ? `${want} redraw` : 'no redraw';
      check(`${who_} — ${said}${out.moved ? ' (a condition moved)' : ''}`, ok, `redrew ${out.redraws} time(s)`);
    }

    await ev(`window.__am.full(${JSON.stringify(restore)}).then(() => null)`);
  }
} finally {
  b.close();
}

/* ── Report ─────────────────────────────────────────────────────────────── */
const bad = results.filter(([, ok]) => !ok);
console.log('\nthe sheet after a patch, against a full redraw\n');
for (const [name, ok, detail] of results) {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? `\n        ${detail}` : ''}`);
}
console.log(`\n${results.length - bad.length}/${results.length} checks passed`);
process.exit(bad.length ? 1 : 0);
