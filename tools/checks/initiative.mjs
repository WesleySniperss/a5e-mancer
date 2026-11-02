/* A character's initiative from Foundry, in a copy of the world, with real clicks: what reaches the tracker.
 *
 * "A roll from Foundry, and the character from Foundry was not added to the
 * initiative" (2026-11-01). Pressed for real on a GM's client and a player's,
 * the sheet's initiative button adds the token in every state of an encounter,
 * except one: a player whose scene has no encounter gets Foundry's "There is no
 * active Combat Encounter in your currently viewed Scene", and nothing is rolled
 * or added (only a GM may start an encounter). InitiativeRelay sends such a roll
 * to the active GM's client, which starts the encounter and puts the token in it.
 *
 * This presses the button and the dialog's Roll as a person does, one dialog at
 * a time, and reads the GM's tracker against the number on the card: a player
 * with no encounter, two of their characters at once, the dialog closed without
 * rolling, a player with an encounter, a GM with none, and a player with no GM
 * connected. It makes actors, tokens, encounters and a user, and deletes them; a
 * run that was killed has its leavings deleted by the next.
 *
 *   node tools/checks/initiative.mjs --url <a copy's url> --user <a GM's user id>
 */
import { openBrowser } from './lib/cdp.mjs';

const arg = (name, fallback) => {
  const i = process.argv.indexOf('--' + name);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const BASE = arg('url', 'http://localhost:30011');
const USER = arg('user', null);
const Q = JSON.stringify;
const HERO = 'AM init hero';
const SECOND = 'AM init second';
const PLAYER = 'AM init player';

let failures = 0, passes = 0;
const check = (ok, label, detail = '') => {
  ok ? passes++ : failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? ': ' + detail : ''}`);
};

async function enter(b, user) {
  await b.send('Page.navigate', { url: `${BASE}/join` });
  await b.sleep(3000);
  await b.evaluate(`fetch('/join', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'join', userid: ${Q(user)}, userId: ${Q(user)}, password: '' }) }).then(r => r.status)`);
  await b.evaluate("localStorage.setItem('core.noCanvas', 'false')");
  await b.send('Page.navigate', { url: `${BASE}/game` });
  for (let i = 0; i < 400; i++) {
    await b.sleep(1000);
    try { if (await b.evaluate('!!(window.game && game.ready && globalThis.a5eMancer)')) return true; } catch {}
  }
  return false;
}
const asker = (b) => (expr, ms = 180000) => Promise.race([b.evaluate(expr),
  new Promise((_, rej) => setTimeout(() => rej(new Error('the page did not answer: ' + expr.trim().slice(0, 70))), ms))]);

/* On either client: what was said, and the sheet's button pressed as a person presses it */
const KIT = `(() => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  window.__k = { sleep, said: [] };
  const was = ui.notifications.notify;
  ui.notifications.notify = function (m, ...r) { window.__k.said.push(String(m)); return was.call(this, m, ...r); };
  window.addEventListener('unhandledrejection', (e) => window.__k.said.push('REJECTED: ' + (e.reason?.message ?? e.reason)));
  const dialogs = () => [...document.querySelectorAll('.roll-initiative-button')];
  const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  window.__k.press = async (name, { api = false, cancel = false } = {}) => {
    const k = window.__k; k.said.length = 0;
    const actor = game.actors.getName(name);
    if (api) {
      await actor.rollInitiative({ createCombatants: true, initiativeOptions: { rollOptions: { skipRollDialog: true } } });
      return 'rolled';
    }
    await actor.sheet.render(true);
    let button = null;
    for (let i = 0; i < 200 && !button; i++) {
      await sleep(150);
      const root = actor.sheet.element instanceof HTMLElement ? actor.sheet.element : actor.sheet.element?.[0];
      button = root?.querySelector('[data-action="roll-initiative"]');
    }
    if (!button) return 'no button on the sheet';
    await sleep(800);
    button.click();
    let roll = null;
    for (let i = 0; i < 100 && !roll; i++) { await sleep(150); roll = dialogs().find(visible) ?? null; }
    if (roll) {
      await sleep(1200);
      if (cancel) {
        const id = roll.closest('.application')?.id;
        await foundry.applications.instances?.get?.(id)?.close?.();
      } else roll.click();
    }
    await sleep(1500);
    try { await actor.sheet.close(); } catch {}
    return roll ? 'pressed' : 'no dialog';
  };
  return 'kit';
})()`;

const gm = await openBrowser({ port: 9445, width: 1600, height: 1000 });
let pl = null;
const g = asker(gm);
try {
  if (!await enter(gm, USER)) throw new Error('the world never came up');
  await gm.sleep(4000);
  await g(KIT);
  console.log(await g(`'a5e-mancer ' + game.modules.get('a5e-mancer').version + ', ' + game.modules.filter(m => m.active).length + ' modules'`));
  const userId = await g(`(async () => {
    if (game.paused) game.togglePause(false, { broadcast: false });
    document.querySelectorAll('.application.dialog, dialog.application').forEach(el => el.remove());
    if (!canvas.scene.active) await canvas.scene.activate();
    for (const c of [...game.combats]) { try { await c.delete(); } catch {} }
    for (const a of game.actors.filter(x => [${Q(HERO)}, ${Q(SECOND)}].includes(x.name))) {
      await canvas.scene.deleteEmbeddedDocuments('Token', canvas.scene.tokens.filter(t => t.actorId === a.id).map(t => t.id));
      await a.delete();
    }
    for (const x of game.users.filter(x => x.name === ${Q(PLAYER)})) await x.delete();
    const ours = Object.keys(CONFIG.Actor.sheetClasses.character).find(k => k.startsWith('a5e.A5e'));
    const u = await User.create({ name: ${Q(PLAYER)}, role: CONST.USER_ROLES.PLAYER });
    const own = { default: 0, [u.id]: 3 };
    const make = async (name, x) => {
      const a = await Actor.create({ name, type: 'character', img: 'icons/svg/mystery-man.svg', ownership: own, flags: { core: { sheetClass: ours } } });
      await canvas.scene.createEmbeddedDocuments('Token', [(await a.getTokenDocument({ x, y: 300 })).toObject()]);
    };
    await make(${Q(HERO)}, 300);
    await make(${Q(SECOND)}, 500);
    await window.__k.sleep(1500);
    return u.id;
  })()`);

  /* The GM's view of it: the encounters on this scene, and who is in them with what */
  const look = `(() => {
    const here = game.combats.filter(c => c.scene?.id === canvas.scene.id || !c.scene);
    const cards = game.messages.contents.filter(m => m.flags?.core?.initiativeRoll && m.timestamp > (window.__k.since ?? 0));
    return { encounters: here.length,
      tracker: here.flatMap(c => c.combatants.map(x => x.name + '=' + x.initiative)).sort().join(', '),
      cards: cards.map(m => (m.speaker?.alias ?? '?') + ' ' + m.rolls?.[0]?.total).sort().join(', ') };
  })()`;
  const clear = `(async () => { for (const c of [...game.combats]) { try { await c.delete(); } catch {} } window.__k.since = Date.now(); await window.__k.sleep(500); return 'ok'; })()`;
  const settle = async () => { await gm.sleep(2500); return g(look); };
  const same = (r) => r.tracker && r.cards && r.tracker.split(', ').every(t => { const [n, v] = t.split('='); return r.cards.includes(n + ' ' + v); });

  pl = await openBrowser({ port: 9446, width: 1600, height: 1000 });
  if (!await enter(pl, userId)) throw new Error('the player never got in');
  await pl.sleep(5000);
  const p = asker(pl);
  await p(KIT);
  await p(`(async () => { document.querySelectorAll('.application.dialog, dialog.application').forEach(el => el.remove()); return 'ok'; })()`);

  console.log('a player, no encounter on their scene');
  await g(clear); await pl.sleep(800);
  await p(`window.__k.press(${Q(HERO)})`);
  let r = await settle();
  let said = await p('window.__k.said.slice()');
  check(r.encounters === 1 && /^AM init hero=\d+$/.test(r.tracker) && same(r) && !said.length,
    'the sheet\'s button and the dialog: the GM\'s client starts one, the token in it with the card\'s number', `${JSON.stringify(r)}${said.length ? ' | said: ' + said.join(' / ') : ''}`);

  await g(clear); await pl.sleep(800);
  await p(`window.__k.press(${Q(HERO)}, { api: true })`);
  r = await settle();
  check(r.encounters === 1 && /^AM init hero=\d+$/.test(r.tracker) && same(r), 'without the dialog', JSON.stringify(r));

  await g(clear); await pl.sleep(800);
  await p(`Promise.all([window.__k.press(${Q(HERO)}, { api: true }), window.__k.press(${Q(SECOND)}, { api: true })])`);
  r = await settle();
  check(r.encounters === 1 && /^AM init hero=\d+, AM init second=\d+$/.test(r.tracker) && same(r), 'two characters at once: one encounter, both in it', JSON.stringify(r));

  await g(clear); await pl.sleep(800);
  await p(`(async () => { const real = CONFIG.Dice.randomUniform; CONFIG.Dice.randomUniform = () => 0.0001; try { await window.__k.press(${Q(HERO)}, { api: true }); } finally { CONFIG.Dice.randomUniform = real; } return 'ok'; })()`);
  r = await settle();
  check(r.encounters === 1 && /^AM init hero=2\d$/.test(r.tracker) && same(r), 'a natural 20', JSON.stringify(r));

  await g(clear); await pl.sleep(800);
  await p(`window.__k.press(${Q(HERO)}, { cancel: true })`);
  r = await settle();
  said = await p('window.__k.said.slice()');
  check(r.encounters === 0 && !r.cards && !said.length, 'the dialog closed without rolling: nothing', `${JSON.stringify(r)}${said.length ? ' | said: ' + said.join(' / ') : ''}`);

  console.log('as before');
  await g(clear);
  await g(`(async () => { await Combat.create({ scene: canvas.scene.id, active: true }); await window.__k.sleep(600); return 'ok'; })()`);
  await pl.sleep(800);
  await p(`window.__k.press(${Q(HERO)})`);
  r = await settle();
  check(r.encounters === 1 && /^AM init hero=\d+$/.test(r.tracker) && same(r), 'a player with an encounter: Foundry\'s own roll', JSON.stringify(r));
  await g(clear);
  await g(`window.__k.press(${Q(HERO)})`);
  r = await settle();
  check(r.encounters === 1 && /^AM init hero=\d+$/.test(r.tracker) && same(r), 'the GM with no encounter: Foundry starts one', JSON.stringify(r));

  console.log('no GM connected');
  await g(clear);
  await gm.send('Page.navigate', { url: 'about:blank' });
  await pl.sleep(4000);
  const alone = await p(`(async () => {
    const before = game.messages.size;
    await window.__k.press(${Q(HERO)}, { api: true });
    await window.__k.sleep(1500);
    return { gm: game.users.activeGM?.name ?? 'none', said: window.__k.said.slice(), cards: game.messages.size - before, encounters: game.combats.size };
  })()`);
  check(alone.gm === 'none' && alone.said.includes('COMBAT.NoneActive') && !alone.cards && !alone.encounters, 'Foundry\'s warning stands, nothing rolled', JSON.stringify(alone));
} catch (err) {
  failures++;
  console.log('FAILED', err.message);
}

/* Leave the copy as it was */
try {
  if (!await gm.evaluate('!!(window.game && game.ready)').catch(() => false)) await enter(gm, USER);
  await gm.evaluate(`(async () => {
    for (const c of [...game.combats]) { try { await c.delete(); } catch {} }
    for (const a of game.actors.filter(x => [${Q(HERO)}, ${Q(SECOND)}].includes(x.name))) {
      await canvas.scene.deleteEmbeddedDocuments('Token', canvas.scene.tokens.filter(t => t.actorId === a.id).map(t => t.id));
      await a.delete();
    }
    for (const x of game.users.filter(x => x.name === ${Q(PLAYER)})) await x.delete();
    return 'ok';
  })()`);
} catch {}
const bad = [...gm.console, ...(pl?.console ?? [])].filter(l => /^\[(error|exception)\]/.test(l)
  && !/'bars'|unmount is not|Invalid Asset|reading 'name'|'filters'/.test(l));
if (bad.length) console.log(`console: ${bad.length} other errors`);
for (const l of bad.slice(0, 6)) console.log('  ' + l.slice(0, 300).replace(/\n/g, ' | '));
try { await pl?.close(); } catch {}
try { await gm.close(); } catch {}
console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
