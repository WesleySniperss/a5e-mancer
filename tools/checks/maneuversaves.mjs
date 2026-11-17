/* Ice's and Psychic's disadvantage on the next save, in real Foundry (ManeuverSaves).
 *
 * "Ice gives disadvantage on the next Strength, Dexterity or Constitution
 * save" was text the GM had to remember (asked 2026-11-17: "it belongs to the
 * automation I asked for - but how do you track the target?"). a5e keeps no
 * record of whom a spell was cast at, so the spell's card now keeps it, and
 * the maneuver's card finds the caster's last spell card of its damage type.
 *
 * As a table plays it, canvas on: a player who owns the caster, on their own
 * client, targets and casts; the creatures are the GM's (one token unlinked,
 * as monsters are), so the GM's client puts the effect on. Cases:
 *   - Ray of Frost at the goblin, then Ice: the goblin gets it, at once - the
 *     maneuver its origin, the caster's turn its clock;
 *   - its Wisdom save leaves it; its Dexterity save rolls 2d20 low and spends it;
 *   - Vicious Mockery at the ogre, then Psychic: its Strength save leaves it,
 *     its Charisma save spends it;
 *   - Cone of Cold at both, the targets dropped, then Ice: nothing yet, a
 *     button for each on the card; the ogre's puts it on the ogre, again
 *     takes it off;
 *   - no cold spell in the chat, the goblin targeted, then Ice: the goblin;
 *     it lasts through the caster's next turn and ends with it.
 * Everything it makes it deletes.
 *
 *   node tools/checks/maneuversaves.mjs --url <a copy's url> --user <a GM's user id>
 */
import { openBrowser } from './lib/cdp.mjs';

const arg = (name, fallback) => {
  const i = process.argv.indexOf('--' + name);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const BASE = arg('url', 'http://localhost:30011');
const USER = arg('user', null);

let failures = 0, passes = 0;
const check = (ok, label, detail = '') => {
  ok ? passes++ : failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? ': ' + detail : ''}`);
};

async function enter(b, user) {
  await b.send('Page.navigate', { url: `${BASE}/join` });
  await b.sleep(3000);
  await b.evaluate(`fetch('/join', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'join', userid: ${JSON.stringify(user)}, userId: ${JSON.stringify(user)}, password: '' }) }).then(r => r.status)`);
  await b.evaluate("localStorage.setItem('core.noCanvas', 'false')");
  await b.send('Page.navigate', { url: `${BASE}/game` });
  for (let i = 0; i < 400; i++) {
    await b.sleep(1000);
    try { if (await b.evaluate('!!(window.game && game.ready && globalThis.a5eMancer && canvas?.ready)')) return true; } catch {}
  }
  return false;
}

const gm = await openBrowser({ port: 9471 });
let player = null;
const timed = (b, expr, ms = 240000) => Promise.race([b.evaluate(expr),
  new Promise((_, rej) => setTimeout(() => rej(new Error('the page did not answer: ' + expr.trim().slice(0, 70))), ms))]);
const ev = (expr) => timed(gm, expr);
const pv = (expr) => timed(player, expr);

/* On the GM's client: a creature's maneuver effects, read until `until` holds or 8 s pass */
const fxOf = (who, until = 'true') => ev(`(async () => {
  const k = window.__ms;
  const read = () => {
    const actor = k.${who}.actor;
    return actor.effects.filter(e => e.flags?.['a5e-mancer']?.maneuverSave).map(e => ({
      name: e.name, origin: e.origin, abilities: e.flags['a5e-mancer'].maneuverSave.abilities,
      dur: [e.duration?.value, e.duration?.units, e.duration?.expiry].join(' '), startCombatant: e.start?.combatant ?? null,
      modes: Object.fromEntries(['str', 'dex', 'con', 'int', 'wis', 'cha'].map(a => [a, actor.system.abilities[a].save.rollMode]))
    }));
  };
  let fx = read();
  for (let i = 0; i < 80 && !(${until}); i++) { await k.sleep(100); fx = read(); }
  return fx;
})()`);

/* On the GM's client: a creature's save, its formula, and whether the spent note came */
const save = (who, ability) => ev(`(async () => {
  const k = window.__ms; const before = game.messages.contents.at(-1)?.id;
  await k.${who}.actor.rollSavingThrow('${ability}', { skipRollDialog: true });
  let m = null;
  for (let i = 0; i < 60; i++) { await k.sleep(100); m = game.messages.contents.find(x => x.system?.rollType === 'savingThrow' && x.id !== before && x.timestamp >= k.mark); if (m) break; }
  const said = () => game.messages.contents.some(x => x.timestamp >= k.mark && /spent\\./.test(x.content ?? '') && x.content.includes(k.${who}.name));
  let spent = false;
  for (let i = 0; i < 40 && !spent; i++) { await k.sleep(100); spent = said(); }
  k.mark = Date.now();
  return { formula: m?.rolls?.[0]?.formula ?? null, spent };
})()`);

/* On the player's client: target these tokens, then use this item; the card it made */
const use = (itemKey, targets) => pv(`(async () => {
  const k = window.__ms;
  const ids = ${JSON.stringify(targets)}.map(w => k.ids[w]);
  if (canvas.tokens.setTargets) canvas.tokens.setTargets(ids);
  else game.user.updateTokenTargets?.(ids);
  await k.sleep(400);
  const item = game.actors.get(k.casterId).items.get(k.items.${itemKey});
  /* This item's own last card, not the chat's last message: with no new card, the
     old one passed for it */
  const cardOf = () => game.messages.contents.findLast(x => x.type === 'item' && x.system?.itemId === item.uuid) ?? null;
  const before = cardOf()?.id ?? null;
  const notes = [];
  const notify = ui.notifications.notify;
  ui.notifications.notify = function (msg, type, opts) { notes.push((type ?? '') + ': ' + msg); return notify.call(this, msg, type, opts); };
  let threw = null;
  try { await item.activate([...item.actions.keys()][0], { skipRollDialog: true }); } catch (e) { threw = String(e?.message ?? e); }
  let m = null;
  for (let i = 0; i < 80; i++) { await k.sleep(100); m = cardOf(); if (m && m.id !== before) break; }
  ui.notifications.notify = notify;
  if (m?.id === before) m = null;
  await k.sleep(800);
  return { id: m?.id ?? null, fresh: !!m, notes, threw, targeted: game.user.targets.size,
           struck: (m?.flags?.['a5e-mancer']?.struck ?? []).map(c => c.name), on: m?.flags?.['a5e-mancer']?.maneuverOn ?? null };
})()`);

try {
  if (!await enter(gm, USER)) throw new Error('the world never came up');
  await gm.sleep(4000);
  console.log(await ev(`'a5e ' + game.system.version + ', a5e-mancer ' + game.modules.get('a5e-mancer').version`));
  const setup = await ev(`(async () => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    for (const c of game.combats.filter(c => c.getFlag('a5e-mancer', 'test') === 'AM mansaves')) await c.delete();
    for (const s of game.scenes) { const ids = s.tokens.filter(t => /^AM mansaves/.test(t.name ?? '')).map(t => t.id); if (ids.length) await s.deleteEmbeddedDocuments('Token', ids); }
    for (const a of game.actors.filter(x => /^AM mansaves/.test(x.name))) await a.delete();
    for (const u of game.users.filter(x => x.name === 'AM mansaves player')) await u.delete();
    if (game.paused) game.togglePause(false, { broadcast: false });
    document.querySelectorAll('.application.dialog, dialog.application').forEach((el) => el.remove());
    if (!canvas.scene.active) await canvas.scene.activate();
    const u = await User.create({ name: 'AM mansaves player', role: CONST.USER_ROLES.PLAYER });
    const caster = await Actor.create({ name: 'AM mansaves caster', type: 'character', ownership: { default: 0, [u.id]: 3 }, prototypeToken: { actorLink: true } });
    const goblin = await Actor.create({ name: 'AM mansaves goblin', type: 'npc', prototypeToken: { actorLink: false }, system: { attributes: { hp: { value: 300, baseMax: 300 } } } });
    const ogre = await Actor.create({ name: 'AM mansaves ogre', type: 'npc', prototypeToken: { actorLink: true }, system: { attributes: { hp: { value: 300, baseMax: 300 } } } });
    await u.update({ character: caster.id });
    await sleep(1500);
    const book = Object.keys(caster.system.spellBooks ?? {})[0];
    const spells = game.packs.get('a5e.a5e-spells'); const sIdx = await spells.getIndex();
    const mm = game.packs.get('world.a5e-mancer-magic-maneuvers'); const mIdx = await mm.getIndex();
    const items = {};
    for (const [key, pack, idx, name] of [['ray', spells, sIdx, 'Ray of Frost'], ['mockery', spells, sIdx, 'Vicious Mockery'], ['cone', spells, sIdx, 'Cone of Cold'],
                                           ['ice', mm, mIdx, 'Ice'], ['psychic', mm, mIdx, 'Psychic']]) {
      const src = (await pack.getDocument(idx.find(x => x.name === name)._id)).toObject();
      if (src.type === 'spell') src.system.spellBook = book;
      const [it] = await caster.createEmbeddedDocuments('Item', [src]);
      items[key] = it.id;
      await sleep(150);
    }
    await caster.update({ 'system.attributes.exertion.current': 30, 'system.attributes.exertion.max': 30 });
    /* Found by actor: the documents came back in another order once, and "the goblin" was the caster's token */
    const made = await canvas.scene.createEmbeddedDocuments('Token', [
      (await caster.getTokenDocument({ x: 300, y: 300 })).toObject(),
      (await goblin.getTokenDocument({ x: 500, y: 300 })).toObject(),
      (await ogre.getTokenDocument({ x: 700, y: 300 })).toObject()]);
    const [tc, tg, to] = [caster, goblin, ogre].map(a => made.find(t => t.actorId === a.id));
    const combat = await Combat.create({ scene: canvas.scene.id, active: true, flags: { 'a5e-mancer': { test: 'AM mansaves' } } });
    await combat.createEmbeddedDocuments('Combatant', [
      { actorId: caster.id, tokenId: tc.id, sceneId: canvas.scene.id, initiative: 20 },
      { actorId: goblin.id, tokenId: tg.id, sceneId: canvas.scene.id, initiative: 15 },
      { actorId: ogre.id, tokenId: to.id, sceneId: canvas.scene.id, initiative: 10 }]);
    await combat.startCombat();
    await sleep(800);
    window.__ms = { sleep, mark: Date.now(), user: u, caster, goblinBase: goblin, ogreBase: ogre, combat, tc, goblin: tg, ogre: to, items,
                    casterCombatant: combat.combatants.find(c => c.actorId === caster.id)?.id };
    return { player: u.id, casterId: caster.id, items, ids: { caster: tc.id, goblin: tg.id, ogre: to.id },
             itemUuids: Object.fromEntries(Object.entries(items).map(([k, id]) => [k, caster.items.get(id).uuid])), casterCombatant: window.__ms.casterCombatant,
             exertion: caster.system.attributes.exertion.current, turn: combat.combatant?.actorId === caster.id };
  })()`);
  check(setup.turn && setup.exertion > 0, 'set up: the caster\'s turn, exertion to spend', JSON.stringify({ turn: setup.turn, exertion: setup.exertion }));

  player = await openBrowser({ port: 9472 });
  if (!await enter(player, setup.player)) throw new Error('the player never got in');
  await player.sleep(3000);
  await pv(`(async () => {
    document.querySelectorAll('.application.dialog, dialog.application').forEach((el) => el.remove());
    window.__ms = { sleep: (ms) => new Promise(r => setTimeout(r, ms)), casterId: ${JSON.stringify(setup.casterId)}, items: ${JSON.stringify(setup.items)}, ids: ${JSON.stringify(setup.ids)} };
    return 'ok';
  })()`);

  // 1. Ray of Frost at the goblin, then Ice
  const ray = await use('ray', ['goblin']);
  check(ray.struck.join() === 'AM mansaves goblin', 'Ray of Frost\'s card keeps whom it was cast at', JSON.stringify(ray));
  const ice = await use('ice', ['goblin']);
  const g1 = await fxOf('goblin', 'fx.length');
  const e1 = g1[0];
  check(g1.length === 1 && e1.origin === setup.itemUuids.ice && e1.name === 'Ice' && / turnEnd$/.test(e1.dur) && e1.startCombatant === setup.casterCombatant
        && e1.modes.str === -1 && e1.modes.dex === -1 && e1.modes.con === -1 && e1.modes.wis === 0,
    'then Ice: on the goblin (an unlinked token), at once - Ice its origin, the caster\'s turn its clock, Str/Dex/Con only', JSON.stringify({ card: ice.on, fx: g1 }));

  // 2. its saves
  const wis = await save('goblin', 'wis');
  const g2 = await fxOf('goblin');
  check(wis.formula === '1d20' && g2.length === 1 && !wis.spent, 'its Wisdom save: one d20, and Ice stays', JSON.stringify({ wis, left: g2.length }));
  const dex = await save('goblin', 'dex');
  const g3 = await fxOf('goblin', '!fx.length');
  check(/^2d20/.test(dex.formula ?? '') && /dis|kl/.test(dex.formula ?? '') && !g3.length && dex.spent,
    'its Dexterity save: with disadvantage, and that spends it (said in chat)', JSON.stringify({ dex, left: g3.length }));

  // 3. Vicious Mockery at the ogre, then Psychic
  await use('mockery', ['ogre']);
  const psy = await use('psychic', ['ogre']);
  const o1 = await fxOf('ogre', 'fx.length');
  check(o1.length === 1 && o1[0].name === 'Psychic' && o1[0].modes.int === -1 && o1[0].modes.wis === -1 && o1[0].modes.cha === -1 && o1[0].modes.str === 0,
    'Vicious Mockery at the ogre, then Psychic: Int/Wis/Cha', JSON.stringify({ card: psy.on, fx: o1 }));
  const str = await save('ogre', 'str');
  const cha = await save('ogre', 'cha');
  const o2 = await fxOf('ogre', '!fx.length');
  check(str.formula === '1d20' && /^2d20/.test(cha.formula ?? '') && !o2.length && cha.spent,
    'its Strength save leaves it, its Charisma save rolls with disadvantage and spends it', JSON.stringify({ str, cha, left: o2.length }));

  // 4. Cone of Cold at both, targets dropped, then Ice: a button each
  const cone = await use('cone', ['goblin', 'ogre']);
  const cold = await use('ice', []);
  /* 'false': the whole 8 s, so a late putting-on by the GM's client is caught */
  const none = [...await fxOf('goblin', 'false'), ...await fxOf('ogre')];
  const buttons = await pv(`(async () => {
    await window.__ms.sleep(800);
    const el = document.querySelector('#chat [data-message-id="${cold.id}"]') ?? document.querySelector('[data-message-id="${cold.id}"]');
    return [...(el?.querySelectorAll('.am-maneuver-save') ?? [])].map(b => b.textContent.trim());
  })()`);
  check(cold.targeted === 0 && (cold.on?.creatures ?? []).length === 2 && !none.length && [...buttons].sort().join() === 'AM mansaves goblin,AM mansaves ogre',
    'Cone of Cold at both, then Ice with nothing targeted: the cone\'s two, nothing put on yet, a button for each', JSON.stringify({ cone: cone.struck, ice: { fresh: cold.fresh, notes: cold.notes, threw: cold.threw }, on: cold.on, buttons, put: none.length }));
  const press = () => pv(`(async () => {
    const el = document.querySelector('#chat [data-message-id="${cold.id}"]') ?? document.querySelector('[data-message-id="${cold.id}"]');
    [...el.querySelectorAll('.am-maneuver-save')].find(b => b.textContent.trim() === 'AM mansaves ogre')?.click();
    await window.__ms.sleep(300);
    return 'ok';
  })()`);
  await press();
  const o3 = await fxOf('ogre', 'fx.length');
  const g4 = await fxOf('goblin');
  check(o3.length === 1 && o3[0].name === 'Ice' && !g4.length, 'the player presses the ogre\'s: the GM\'s client puts it on the ogre alone', JSON.stringify({ ogre: o3.length, goblin: g4.length }));
  await press();
  const o4 = await fxOf('ogre', '!fx.length');
  check(!o4.length, 'pressed again: off', JSON.stringify(o4));

  // 5. no cold spell in the chat: the goblin targeted
  await ev(`(async () => {
    const k = window.__ms;
    const ids = game.messages.filter(m => m.system?.actorId === k.caster.uuid || m.speaker?.actor === k.caster.id).map(m => m.id);
    if (ids.length) await ChatMessage.deleteDocuments(ids);
    return ids.length;
  })()`);
  await use('ice', ['goblin']);
  const g5 = await fxOf('goblin', 'fx.length');
  check(g5.length === 1, 'no cold spell in the chat, the goblin targeted, then Ice: the goblin', JSON.stringify(g5));
  const turns = await ev(`(async () => {
    const k = window.__ms; const c = k.combat; const out = [];
    const on = () => k.goblin.actor.effects.some(e => e.flags?.['a5e-mancer']?.maneuverSave);
    const want = [true, true, true, false];
    for (let i = 0; i < 4; i++) {
      await c.nextTurn();
      await k.sleep(1500);
      for (let t = 0; t < 40 && on() !== want[i]; t++) await k.sleep(100);
      out.push((c.combatant?.name ?? '?').replace('AM mansaves ', '') + ':' + (on() ? 'on' : 'off'));
    }
    return out;
  })()`);
  check(turns.join() === 'goblin:on,ogre:on,caster:on,goblin:off', 'it lasts through the caster\'s next turn and ends with it', turns.join(', '));
} catch (err) {
  failures++;
  console.log(`  FAIL  the check could not go on: ${err.message}`);
}
try { await player?.close(); } catch {}
try {
  await ev(`(async () => {
    const k = window.__ms ?? {};
    try { await k.combat?.delete(); } catch {}
    try { await canvas.scene.deleteEmbeddedDocuments('Token', canvas.scene.tokens.filter(t => /^AM mansaves/.test(t.name ?? '')).map(t => t.id)); } catch {}
    for (const a of game.actors.filter(x => /^AM mansaves/.test(x.name))) { try { await a.delete(); } catch {} }
    try { await k.user?.delete(); } catch {}
    const ids = game.messages.filter(m => /AM mansaves/.test((m.speaker?.alias ?? '') + (m.content ?? ''))).map(m => m.id);
    if (ids.length) await ChatMessage.deleteDocuments(ids);
    return 'done';
  })()`);
} catch (err) { console.log('  could not clean up:', err.message); }
const ignored = /renderChatMessageHTML|Invalid Asset|'filters'|unmount is not a function|You must select a spell book/;
for (const [who, b] of [['GM', gm], ['player', player]]) {
  if (!b) continue;
  const bad = b.console.filter((l) => /^\[(error|exception)\]/.test(l) && /a5e-mancer/i.test(l) && !ignored.test(l));
  if (bad.length) failures++;
  console.log(`  ${bad.length ? 'FAIL' : 'ok  '}  the ${who}'s console: ${bad.length} errors naming a5e-mancer`);
  for (const l of bad.slice(0, 6)) console.log('        ' + l.slice(0, 320).replace(/\n/g, ' | '));
}
try { await gm.close(); } catch {}
console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
