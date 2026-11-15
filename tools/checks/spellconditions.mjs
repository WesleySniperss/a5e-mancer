/* Conditions from spells, and their time, in real Foundry (SpellConditions, ConditionAutomation).
 *
 * About a hundred a5e spells give a condition by their text and carry no
 * effect with it, so a failed save put nothing on; and Power Word Stun's stun,
 * "at the end of the target's turn, it makes a Constitution saving throw to
 * end the effect", was never offered that save (2026-11-15). As a GM, no
 * canvas: a caster with a spell book and a target, both with tokens, in an
 * encounter, the caster first. Each spell is cast to its card and the target's
 * save rolled as from the card's prompt (DC 99 to fail, 1 to pass):
 *   - Grease: prone, the spell its origin, the HUD's own status id;
 *   - Sunbeam: blinded for 1 round - still on at the target's turn, gone when
 *     the caster's next turn starts;
 *   - Shocking Revelation: rattled until the end of the target's next turn -
 *     on through its turn, gone when it ends;
 *   - Slow passed: rattled;
 *   - Charm Person: its own effect and charmed, for the spell's hour;
 *   - Color Spray (no save): its card's row has Blinded; a click puts it on
 *     the selected target until the caster's next turn, a second takes it off;
 *   - Power Word Stun's stun offers its save when the target's turn ends.
 * Everything it makes it deletes.
 *
 *   node tools/checks/spellconditions.mjs --url <a copy's url> --user <a GM's user id>
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

const b = await openBrowser({ port: 9464, width: 1500, height: 900 });
const ev = (expr, ms = 300000) => Promise.race([b.evaluate(expr),
  new Promise((_, rej) => setTimeout(() => rej(new Error('the page did not answer: ' + expr.trim().slice(0, 70))), ms))]);

try {
  await b.send('Page.navigate', { url: `${BASE}/join` });
  await b.sleep(3000);
  await b.evaluate(`fetch('/join', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'join', userid: ${JSON.stringify(USER)}, userId: ${JSON.stringify(USER)}, password: '' }) }).then(r => r.status)`);
  await b.evaluate("localStorage.setItem('core.noCanvas', 'true')");
  await b.send('Page.navigate', { url: `${BASE}/game` });
  let ready = false;
  for (let i = 0; i < 400 && !ready; i++) { await b.sleep(1000); try { ready = await b.evaluate('!!(window.game && game.ready && globalThis.a5eMancer)'); } catch {} }
  if (!ready) throw new Error('the world never came up');
  await b.sleep(6000);
  const head = await ev(`({ a5e: game.system.version, mancer: game.modules.get('a5e-mancer').version })`);
  console.log(`a5e ${head.a5e}, a5e-mancer ${head.mancer}`);

  const r = await ev(`(async () => {
    const wait = (ms) => new Promise(r => setTimeout(r, ms));
    const out = {};
    for (const c of game.combats.filter(c => /^AM spellcond/.test(c.getFlag('a5e-mancer', 'test') ?? ''))) await c.delete();
    for (const a of game.actors.filter(x => /^AM spellcond /.test(x.name))) await a.delete();
    const { ConditionAutomation } = await import('/modules/a5e-mancer/scripts/utils/conditionAutomation.js');
    /* No canvas: what a turn change and a card's button read of it (Monk's Combat Details reads canvas.tokens.get) */
    const stub = { controlled: [], placeables: [], get() { return null; }, releaseAll() {} };
    Object.defineProperty(canvas, 'tokens', { value: stub, configurable: true });
    const pack = game.packs.get('a5e.a5e-spells');
    const index = await pack.getIndex();
    const scene = game.scenes.active ?? game.scenes.contents[0];
    const caster = await Actor.create({ name: 'AM spellcond caster', type: 'character', prototypeToken: { actorLink: true } });
    const target = await Actor.create({ name: 'AM spellcond target', type: 'npc', prototypeToken: { actorLink: true }, system: { attributes: { hp: { value: 40, baseMax: 40 } } } });
    await wait(1500);
    const book = Object.keys(caster.system.spellBooks ?? {})[0];
    const spells = {};
    for (const name of ['Grease', 'Sunbeam', 'Shocking Revelation', 'Slow', 'Charm Person', 'Color Spray', 'Power Word Stun']) {
      const e = index.find(x => x.name === name);
      const src = (await pack.getDocument(e._id)).toObject();
      src.system.spellBook = book;
      const [it] = await caster.createEmbeddedDocuments('Item', [src]);
      spells[name] = it;
      await wait(200);
    }
    const tokens = await scene.createEmbeddedDocuments('Token', [
      (await caster.getTokenDocument({ x: 100, y: 100 })).toObject(),
      (await target.getTokenDocument({ x: 300, y: 100 })).toObject()]);
    const combat = await Combat.create({ scene: scene.id, flags: { 'a5e-mancer': { test: 'AM spellcond' } } });
    await combat.createEmbeddedDocuments('Combatant', [
      { tokenId: tokens[0].id, sceneId: scene.id, actorId: caster.id, initiative: 20 },
      { tokenId: tokens[1].id, sceneId: scene.id, actorId: target.id, initiative: 10 }]);
    await combat.activate();
    await combat.startCombat();
    await wait(800);
    const turnOf = () => combat.combatant?.actor?.name ?? null;
    const toCaster = async () => { for (let i = 0; i < 4 && combat.combatant?.actorId !== caster.id; i++) { await combat.nextTurn(); await wait(700); } };

    /* Cast to a card, the target's save as from its prompt */
    const cast = async (name) => {
      const item = spells[name];
      const was = game.messages.contents.at(-1)?.id;
      await item.activate([...item.actions.keys()][0], { skipRollDialog: true });
      for (let t = 0; t < 60; t++) { await wait(100); if (game.messages.contents.at(-1)?.id !== was) break; }
      await wait(600);
      return game.messages.contents.at(-1);
    };
    const save = async (msg, dc) => {
      const p = (msg.system?.prompts ?? []).find(p => p.type === 'savingThrow');
      ConditionAutomation.expectSave(target, p.ability, { kind: 'prompt', ability: p.ability, dc, effects: [...(msg.system?.effects ?? [])], itemUuid: msg.system?.itemId, onSave: '', messageId: msg.id });
      await target.rollSavingThrow(p.ability, { skipRollDialog: true });
      await wait(1500);
    };
    const fx = (status) => target.effects.find(e => e.statuses?.has(status));
    const view = (e) => e ? { name: e.name, id: e.id, origin: e.origin, dur: [e.duration?.value, e.duration?.units, e.duration?.expiry].join(' '), startCombatant: e.start?.combatant ?? null } : null;
    const clear = async () => { const ids = target.effects.map(e => e.id); if (ids.length) await target.deleteEmbeddedDocuments('ActiveEffect', ids); await wait(300); };

    try {
      // Grease
      await toCaster();
      await save(await cast('Grease'), 99);
      out.grease = { fx: view(fx('prone')), statusId: CONFIG.statusEffects.find(s => s.id === 'prone')?._id, item: spells.Grease.uuid };
      await clear();

      // Sunbeam: 1 round, from the caster's turn
      await toCaster();
      await save(await cast('Sunbeam'), 99);
      out.sunbeam = { cast: view(fx('blinded')), casterCombatant: combat.combatants.find(c => c.actorId === caster.id)?.id };
      await combat.nextTurn(); await wait(1200);
      out.sunbeam.targetTurn = { turn: turnOf(), on: !!fx('blinded') };
      await combat.nextTurn(); await wait(1500);
      out.sunbeam.casterNext = { turn: turnOf(), on: !!fx('blinded') };
      await clear();

      // Shocking Revelation: until the end of the target's next turn
      await toCaster();
      await save(await cast('Shocking Revelation'), 99);
      out.shocking = { cast: view(fx('rattled')), targetCombatant: combat.combatants.find(c => c.actorId === target.id)?.id };
      await combat.nextTurn(); await wait(1200);
      out.shocking.targetTurn = { turn: turnOf(), on: !!fx('rattled') };
      await combat.nextTurn(); await wait(1500);
      out.shocking.afterTargetTurn = { turn: turnOf(), on: !!fx('rattled') };
      await clear();

      // Slow, passed: rattled
      await toCaster();
      await save(await cast('Slow'), 1);
      out.slow = { rattled: view(fx('rattled')), slowed: !!fx('slowed') };
      await clear();

      // Charm Person: its own effect, and charmed for the hour
      await toCaster();
      await save(await cast('Charm Person'), 99);
      out.charm = { effects: target.effects.map(e => e.name + '{' + [...e.statuses].join(',') + '}' + (e.duration?.value ?? '')), charmed: view(fx('charmed')) };
      await clear();

      // Color Spray: the card's row, a click on the selected target
      await toCaster();
      const card = await cast('Color Spray');
      await wait(800);
      /* The card as drawn now: a message is drawn again when it changes, and a click
         on a button no longer on the page reaches nobody */
      const drawn = () => document.querySelector('#chat-log [data-message-id="' + card.id + '"]') ?? document.querySelector('[data-message-id="' + card.id + '"]');
      const chip = () => drawn()?.querySelector('.am-spell-condition[data-am-condition="blinded"]');
      const chips = [...(drawn()?.querySelectorAll('.am-spell-condition') ?? [])].map(c => c.dataset.amCondition);
      stub.controlled = [{ document: tokens[1], actor: target, name: target.name }];
      chip()?.click();
      for (let i = 0; i < 30 && !fx('blinded'); i++) await wait(100);
      await wait(500);
      out.colorSpray = { chips, targets: game.user.targets?.size ?? 0, after: view(fx('blinded')), casterCombatant: combat.combatants.find(c => c.actorId === caster.id)?.id };
      chip()?.click();
      for (let i = 0; i < 30 && fx('blinded'); i++) await wait(100);
      await wait(500);
      out.colorSpray.again = !!fx('blinded');
      stub.controlled = [];
      await clear();

      // Power Word Stun's stun: its save offered at the end of the target's turn
      await toCaster();
      const pws = await cast('Power Word Stun');
      await save(pws, 99);
      out.pws = { stunned: view(fx('stunned')) };
      const seen = game.messages.size;
      await combat.nextTurn(); await wait(800);
      await combat.nextTurn(); await wait(1500);
      out.pws.offered = game.messages.contents.slice(seen).some(m => /can try to end/.test(m.content ?? '') && /Power Word Stun/.test(m.content ?? ''));
      await clear();
    } finally {
      delete canvas.tokens;
      try { await combat.delete(); } catch {}
      try { await scene.deleteEmbeddedDocuments('Token', tokens.map(t => t.id)); } catch {}
      try { await caster.delete(); await target.delete(); } catch {}
      for (const m of game.messages.filter(m => /AM spellcond/.test(m.speaker?.alias ?? '') || /AM spellcond/.test(m.content ?? ''))) { try { await m.delete(); } catch {} }
    }
    return out;
  })()`);

  const g = r.grease?.fx;
  check(!!g && g.origin === r.grease.item && g.id === r.grease.statusId && /^Prone \\(Grease\\)$|Prone \(Grease\)/.test(g.name),
    'Grease failed: prone, the spell its origin, the HUD\'s own status', JSON.stringify(r.grease));
  const s = r.sunbeam;
  check(!!s?.cast && /^1 rounds turnStart$/.test(s.cast.dur) && s.cast.startCombatant === s.casterCombatant && s.targetTurn.on && !s.casterNext.on,
    'Sunbeam failed: blinded for 1 round - on at the target\'s turn, gone at the caster\'s next', JSON.stringify(s));
  const sh = r.shocking;
  check(!!sh?.cast && / turnEnd$/.test(sh.cast.dur) && sh.cast.startCombatant === sh.targetCombatant && sh.targetTurn.on && !sh.afterTargetTurn.on,
    'Shocking Revelation failed: rattled through the target\'s next turn, gone when it ends', JSON.stringify(sh));
  check(!!r.slow?.rattled && !r.slow.slowed, 'Slow passed: rattled, not slowed', JSON.stringify(r.slow));
  check(r.charm?.effects?.some(n => /^Charm Person/.test(n)) && !!r.charm.charmed && /^3600 seconds/.test(r.charm.charmed.dur),
    'Charm Person failed: its own effect, and charmed for the hour', JSON.stringify(r.charm));
  check(r.colorSpray?.chips?.includes('blinded') && !!r.colorSpray.after && / turnStart$/.test(r.colorSpray.after.dur) && r.colorSpray.after.startCombatant === r.colorSpray.casterCombatant && r.colorSpray.again === false,
    'Color Spray\'s card: a Blinded button; a click puts it on until the caster\'s next turn, a second takes it off', JSON.stringify(r.colorSpray));
  check(!!r.pws?.stunned && r.pws.offered === true, 'Power Word Stun: its stun offers the save when the target\'s turn ends', JSON.stringify(r.pws));
} catch (err) {
  failures++;
  console.log('FAILED', err.message);
}
const bad = b.console.filter(l => /^\[(error|exception)\]/.test(l) && /a5e-mancer/i.test(l));
if (bad.length) console.log(`console: ${bad.length} errors naming a5e-mancer`);
for (const l of bad.slice(0, 8)) console.log('  ' + l.slice(0, 300).replace(/\n/g, ' | '));
await b.close();
console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
