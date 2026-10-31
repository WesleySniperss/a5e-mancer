/* The numbers on the status icons in the corner of the screen, in real Foundry.
 *
 * "You never made the numbers on the character's status icons in the corner of
 * the screen that show the rounds left. We have numbers when we put them by
 * hand: those are what should show it" (2026-10-31). What had gone wrong was not
 * the drawing, which only a look at the page finds out:
 *
 *   - a5e never sets CONFIG.time.roundTime, so a fight moved the world's clock
 *     by nothing, and an effect of "60 seconds" never ran down;
 *   - "next round" past a combatant that never had a turn threw in a5e's
 *     _onEndTurn, and nothing after it ran: no count, no effect ending;
 *   - the count hung on combatTurnChange, which comes after those events;
 *   - Bless, Bane and Hex state their duration only on the spell's action.
 *
 * So this does what a table does, with the canvas on: a digit over a status in
 * the token HUD, a spell's effect the way its card's button puts it on, the
 * tracker's own buttons, a level of fatigue, another token, a scene drawn again,
 * and what is computed for the panel's icons is read after each - the content
 * of the badge as the browser would paint it. Then it looks from a player's
 * client too: the GM's client counts, the player's has to show it.
 *
 * Needs a Foundry serving a copy of the world (README, "live checks"). It makes
 * two actors, two tokens, a combat and a user, and deletes them; on a copy it
 * makes the viewed scene the active one.
 *
 *   node tools/checks/statusrounds.mjs --url <a copy's url> --user <a GM's user id> [--shots <dir>]
 */
import { pathToFileURL } from 'url';
import path from 'path';
import { openBrowser } from './lib/cdp.mjs';

const arg = (name, fallback) => {
  const i = process.argv.indexOf('--' + name);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const BASE = arg('url', 'http://localhost:30011');
const USER = arg('user', null);
const SHOTS = arg('shots', null);

/* What the panel shows: each icon's name, and the badge the browser would paint on it. */
const LOOK = `(() => {
  const panel = document.querySelector('#a5e-effects-panel');
  const combat = game.combats?.active;
  const where = combat?.started ? 'r' + combat.round + ' t' + combat.turn : 'no combat';
  if (!panel) return { where, rows: [] };
  const rows = [...panel.querySelectorAll('img.a5e-effect-item__icon')].map((img) => {
    const root = img.parentElement?.parentElement;
    const c = root ? getComputedStyle(root, '::after').content : 'none';
    return img.alt + '=' + ((c === 'none' || c === 'normal') ? '-' : c.replace(/["']/g, ''));
  });
  const r = panel.getBoundingClientRect();
  return { where, rows, rect: { x: r.x, y: r.y, width: r.width, height: r.height } };
})()`;

let failures = 0, passes = 0;

/* Ask until it holds: a busy client may take a moment, a number wrong for six seconds is wrong. */
async function see(b, label, want, shot) {
  const asked = (expr) => Promise.race([b.evaluate(expr),
    new Promise((_, rej) => setTimeout(() => rej(new Error('the page did not answer')), 120000))]);
  const met = (s) => want.every((w) => (w.startsWith('!')
    ? !s.rows.some((r) => r.startsWith(w.slice(1) + '='))
    : s.rows.includes(w)));
  await b.sleep(1000);
  let s = await asked(LOOK);
  for (let t0 = Date.now(); !met(s) && Date.now() - t0 < 6000;) { await b.sleep(500); s = await asked(LOOK); }
  const ok = met(s);
  ok ? passes++ : failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  [${s.where}] ${label}: ${s.rows.join(', ') || 'no panel'}${ok ? '' : `   wanted ${want.join(', ')}`}`);
  if (shot && SHOTS && s.rect) {
    const { x, y, width, height } = s.rect;
    await b.shot(pathToFileURL(path.resolve(SHOTS, `${shot}.png`)), { x: Math.max(0, x - 30), y: Math.max(0, y - 20), width: width + 60, height: Math.min(height + 40, 520) });
  }
}

async function enter(b, user) {
  await b.send('Page.navigate', { url: `${BASE}/join` });
  await b.sleep(3000);
  await b.evaluate(`fetch('/join', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'join', userid: ${JSON.stringify(user)}, userId: ${JSON.stringify(user)}, password: '' }) }).then(r => r.status)`);
  await b.evaluate("localStorage.setItem('core.noCanvas', 'false')");
  await b.send('Page.navigate', { url: `${BASE}/game` });
  for (let i = 0; i < 400; i++) {
    await b.sleep(1000);
    try { if (await b.evaluate('!!(window.game && game.ready && globalThis.a5eMancer)')) return true; } catch {}
  }
  return false;
}

const gm = await openBrowser({ port: 9443 });
let player = null;
const ev = (expr) => Promise.race([gm.evaluate(expr),
  new Promise((_, rej) => setTimeout(() => rej(new Error('the page did not answer: ' + expr.trim().slice(0, 70))), 240000))]);
try {
  if (!await enter(gm, USER)) throw new Error('the world never came up');
  await gm.sleep(4000);
  console.log(await ev(`'a5e-mancer ' + game.modules.get('a5e-mancer').version + ', ' + game.modules.filter(m => m.active).length + ' modules, round ' + CONFIG.time.roundTime + 's'`));
  const playerId = await ev(`(async () => {
    if (game.paused) game.togglePause(false, { broadcast: false });
    document.querySelectorAll('.application.dialog, dialog.application').forEach((el) => el.remove());
    if (!canvas.scene.active) await canvas.scene.activate();
    const u = await User.create({ name: 'AM rounds player', role: CONST.USER_ROLES.PLAYER });
    window.__u = u;
    const ownership = { default: 0, [u.id]: 3 };
    window.__a = await Actor.create({ name: 'AM rounds hero', type: 'character', img: 'icons/svg/mystery-man.svg', ownership });
    window.__o = await Actor.create({ name: 'AM rounds foe', type: 'character', img: 'icons/svg/mystery-man.svg' });
    const [t1] = await canvas.scene.createEmbeddedDocuments('Token', [(await window.__a.getTokenDocument({ x: 300, y: 300 })).toObject()]);
    const [t2] = await canvas.scene.createEmbeddedDocuments('Token', [(await window.__o.getTokenDocument({ x: 500, y: 300 })).toObject()]);
    window.__t1 = t1; window.__t2 = t2;
    await new Promise(r => setTimeout(r, 2000));
    t1.object.control({ releaseOthers: true });
    return u.id;
  })()`);

  console.log('the GM, at the table');
  await ev(`(async () => {
    const hud = canvas.hud.token;
    hud.bind(window.__t1.object);
    await new Promise(r => setTimeout(r, 400));
    await hud.render(true);
    await new Promise(r => setTimeout(r, 1500));
    const el = hud.element instanceof HTMLElement ? hud.element : hud.element?.[0];
    el.querySelector('button.condition-container[data-status-id="prone"]').dispatchEvent(new MouseEvent('mouseenter'));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '3', code: 'Digit3', bubbles: true, cancelable: true }));
    await new Promise(r => setTimeout(r, 1200));
    await hud.close?.();
    return 'ok';
  })()`);
  await see(gm, 'a digit 3 over Prone in the token HUD', ['Prone=3']);

  await ev(`(async () => {
    const pack = game.packs.get('a5e.a5e-spells');
    const idx = await pack.getIndex();
    const on = async (spell, status) => {
      const doc = await pack.getDocument(idx.find(e => e.name === spell)._id);
      await doc.effects.find(e => e.statuses.has(status)).transferEffect(window.__t1.actor);
    };
    await on('Hold Person', 'paralyzed');
    await on('Fear', 'frightened');
    await on('Web', 'restrained');
    /* Bless states its minute on the spell's action, so it needs a spell someone knows */
    const bless = await pack.getDocument(idx.find(e => e.name === 'Bless')._id);
    const known = await Item.implementation.create({ ...bless.toObject(), 'system.spellBook': 'x' }, { parent: window.__a }) ;
    const owned = known ?? window.__a.items.find(i => i.name === 'Bless');
    await owned?.effects.contents[0]?.transferEffect(window.__t1.actor);
    return 'ok';
  })()`);
  await see(gm, 'Hold Person, Fear, Web and Bless from their cards', ['Prone=3', 'Held=10', 'Frightened=10', 'Restrained=1h', 'Bless=10'], 'spells');

  await ev(`(async () => {
    const c = await Combat.create({ scene: canvas.scene.id, active: true });
    window.__c = c;
    await c.createEmbeddedDocuments('Combatant', [
      { actorId: window.__a.id, tokenId: window.__t1.id, sceneId: canvas.scene.id, initiative: 20 },
      { actorId: window.__o.id, tokenId: window.__t2.id, sceneId: canvas.scene.id, initiative: 10 }]);
    await c.startCombat();
    ui.combat.render(true);
    await new Promise(r => setTimeout(r, 800));
    return 'ok';
  })()`);
  await see(gm, 'the combat starts', ['Prone=3', 'Held=10']);
  const press = (action) => ev(`(async () => {
    const root = ui.combat.element instanceof HTMLElement ? ui.combat.element : ui.combat.element?.[0];
    const btn = root?.querySelector('[data-action="${action}"]');
    if (btn) { btn.click(); return 'button'; }
    await window.__c.${action}(); return 'api';
  })()`);
  /* The foe has never had a turn: this is what threw in a5e's _onEndTurn */
  await press('nextRound');
  await see(gm, '"next round" past a foe who never had a turn', ['Prone=2', 'Held=9', 'Frightened=9', 'Bless=9'], 'round2');
  await press('nextTurn');
  await gm.sleep(1500);
  await press('nextTurn');
  await see(gm, 'two turns on: round 3', ['Prone=1', 'Held=8', 'Frightened=8', 'Bless=8'], 'round3');

  await ev(`(async () => {
    const { ConditionAutomation: CA } = await import('/modules/a5e-mancer/scripts/utils/conditionAutomation.js');
    window.__ca = CA;
    await CA.setRounds(window.__t1.actor, 'frightened', 5);
    return 'ok';
  })()`);
  await see(gm, 'a 5 put by hand on Frightened, a spell\'s status', ['Frightened=5', 'Held=8']);
  await press('nextRound');
  await see(gm, 'the next round: the hand\'s and the spell\'s both count; Prone is up', ['Frightened=4', 'Held=7', '!Prone']);
  await ev(`(async () => { await window.__ca.setRounds(window.__t1.actor, 'frightened', null); return 'ok'; })()`);
  await see(gm, 'the 5 taken off: the spell\'s own clock again', ['Frightened=7']);

  await ev(`(async () => { await window.__t1.actor.update({ 'system.attributes.fatigue': 2 }); return 'ok'; })()`);
  await see(gm, 'a level of fatigue rewrites the rows\' style', ['Held=7', 'Frightened=7']);
  await ev(`(async () => { window.__t2.object.control({ releaseOthers: true }); return 'ok'; })()`);
  await see(gm, 'another token selected, with nothing on it', ['!Held']);
  await ev(`(async () => { window.__t1.object.control({ releaseOthers: true }); return 'ok'; })()`);
  await see(gm, 'the hero selected again', ['Held=7', 'Frightened=7']);
  await ev(`(async () => { window.__t2.object.control({ releaseOthers: false }); return 'ok'; })()`);
  await see(gm, 'both selected: the panel is the first\'s', ['Held=7', 'Frightened=7']);

  console.log('a player, on another client');
  player = await openBrowser({ port: 9444 });
  if (!await enter(player, playerId)) throw new Error('the player never got in');
  await player.sleep(3000);
  const playerEv = (expr) => player.evaluate(expr);
  await playerEv(`(async () => {
    document.querySelectorAll('.application.dialog, dialog.application').forEach((el) => el.remove());
    canvas.tokens.get(${JSON.stringify(await ev('window.__t1.id'))})?.control({ releaseOthers: true });
    return 'ok';
  })()`);
  await see(player, 'the player selects their token', ['Held=7', 'Frightened=7', 'Bless=7']);
  await ev(`(async () => { await window.__ca.setRounds(window.__t1.actor, 'blinded', 2); await window.__t1.actor.toggleStatusEffect('blinded', { active: true }); return 'ok'; })()`);
  await see(player, 'the GM puts Blinded on, with a 2', ['Blinded=2']);
  await press('nextRound');
  await see(player, 'the GM\'s next round reaches the player\'s icons', ['Held=6', 'Frightened=6', 'Bless=6', 'Blinded=1'], 'player');

  console.log('and to the end');
  await ev(`(async () => { window.__t1.object.control({ releaseOthers: true }); return 'ok'; })()`);
  for (let i = 0; i < 6; i++) await ev(`(async () => { await window.__c.nextRound(); await new Promise(r => setTimeout(r, 700)); return 'ok'; })()`);
  await gm.sleep(2500);
  await ev(`(async () => { window.__t1.object?.control({ releaseOthers: true }); return 'ok'; })()`);
  await see(gm, 'past Hold Person\'s minute: it ended by itself, Blinded too', ['!Held', '!Frightened', '!Blinded', 'Restrained=59m'], 'ended');
  await ev(`(async () => { canvas.tokens.releaseAll(); await canvas.draw(); await new Promise(r => setTimeout(r, 2500)); canvas.tokens.get(window.__t1.id)?.control({ releaseOthers: true }); return 'ok'; })()`);
  await see(gm, 'the scene drawn again', ['Restrained=59m']);
} catch (err) {
  failures++;
  console.log(`  FAIL  the check could not go on: ${err.message}`);
}
player?.close();
try {
  await ev(`(async () => {
    try { await window.__c?.delete(); } catch {}
    for (const t of [window.__t1, window.__t2]) { try { await t?.delete(); } catch {} }
    for (const a of [window.__a, window.__o]) { try { await a?.delete(); } catch {} }
    try { await window.__u?.delete(); } catch {}
    return 'done';
  })()`);
} catch (err) { console.log('  could not clean up:', err.message); }
const ignored = /renderChatMessageHTML|Invalid Asset|'filters'|unmount is not a function|You must select a spell book/;
const bad = gm.console.filter((l) => /^\[(error|exception)\]/.test(l) && !ignored.test(l));
if (bad.length) failures++;
console.log(`  ${bad.length ? 'FAIL' : 'ok  '}  the GM's console: ${bad.length} errors besides the ones known from a5e and this test`);
for (const l of bad.slice(0, 8)) console.log('        ' + l.slice(0, 320).replace(/\n/g, ' | '));
gm.close();
console.log(`\n${passes}/${passes + failures} checks passed`);
process.exit(failures ? 1 : 0);
