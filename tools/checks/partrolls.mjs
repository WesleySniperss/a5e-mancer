/* The attack alone and the damage alone, from an item's Actions table on our sheet, in a copy of the world.
 *
 * "A crit on a 20 was not counted and not shown properly" (2026-11-02). The two
 * figures in the Actions table rolled Foundry's plain dice, which a5e never saw:
 * a natural 20 to hit was a plain number, and the damage rolled after it never
 * critical. PartRolls rolls each half through a5e with the other half taken out.
 *
 * This expands a Longsword's row on the sheet and presses its figures, with the
 * dice forced: a natural 20, then its damage, applied to a token; a plain roll
 * and its damage; a natural 1; a crit range of 19. Then that the halves spend
 * nothing and start no concentration, where the whole action does both (the
 * action is given an item use and concentration for the purpose). It makes two
 * actors and a token, and deletes them.
 *
 *   node tools/checks/partrolls.mjs --url <a copy's url> --user <a GM's user id> [--shots <dir>]
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
const Q = JSON.stringify;
const HERO = 'AM part hero';
const TARGET = 'AM part target';

let failures = 0, passes = 0;
const check = (ok, label, detail = '') => {
  ok ? passes++ : failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? ': ' + detail : ''}`);
};

const b = await openBrowser({ port: 9445, width: 1600, height: 1000 });
const ev = (expr, ms = 180000) => Promise.race([b.evaluate(expr),
  new Promise((_, rej) => setTimeout(() => rej(new Error('the page did not answer: ' + expr.trim().slice(0, 70))), ms))]);
try {
  await b.send('Page.navigate', { url: `${BASE}/join` });
  await b.sleep(3000);
  await b.evaluate(`fetch('/join', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'join', userid: ${Q(USER)}, userId: ${Q(USER)}, password: '' }) }).then(r => r.status)`);
  await b.evaluate("localStorage.setItem('core.noCanvas', 'false')");
  await b.send('Page.navigate', { url: `${BASE}/game` });
  let ready = false;
  for (let i = 0; i < 400 && !ready; i++) { await b.sleep(1000); try { ready = await b.evaluate('!!(window.game && game.ready && globalThis.a5eMancer)'); } catch {} }
  if (!ready) throw new Error('the world never came up');
  await b.sleep(4000);
  console.log(await ev(`'a5e-mancer ' + game.modules.get('a5e-mancer').version + ', a5e ' + game.system.version + ', ' + game.modules.filter(m => m.active).length + ' modules'`));

  console.log(await ev(`(async () => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    if (game.paused) game.togglePause(false, { broadcast: false });
    document.querySelectorAll('.application.dialog, dialog.application').forEach(el => el.remove());
    for (const a of game.actors.filter(x => [${Q(HERO)}, ${Q(TARGET)}].includes(x.name))) {
      await canvas.scene.deleteEmbeddedDocuments('Token', canvas.scene.tokens.filter(t => t.actorId === a.id).map(t => t.id));
      await a.delete();
    }
    const ours = Object.keys(CONFIG.Actor.sheetClasses.character).find(k => k.startsWith('a5e.A5e'));
    const hero = await Actor.create({ name: ${Q(HERO)}, type: 'character', img: 'icons/svg/mystery-man.svg', flags: { core: { sheetClass: ours } } });
    const target = await Actor.create({ name: ${Q(TARGET)}, type: 'character', img: 'icons/svg/mystery-man.svg', system: { attributes: { hp: { value: 100, baseMax: 100 } } } });
    const [tt] = await canvas.scene.createEmbeddedDocuments('Token', [(await target.getTokenDocument({ x: 500, y: 300 })).toObject()]);
    let doc = null;
    for (const p of game.packs.filter(p => p.documentName === 'Item' && p.metadata.packageName === 'a5e')) {
      const e = (await p.getIndex()).find(x => x.name === 'Longsword');
      if (e) { doc = await p.getDocument(e._id); break; }
    }
    const [item] = await hero.createEmbeddedDocuments('Item', [doc.toObject()]);
    const actionId = Object.keys(item.system.actions)[0];
    const attackRollId = Object.entries(item.system.actions[actionId].rolls).find(([, r]) => r.type === 'attack')[0];
    /* Something to spend and a concentration to start, so that it shows whether the halves do either */
    await item.update({
      'system.uses.value': 3, 'system.uses.max': '3',
      ['system.actions.' + actionId + '.duration.concentration']: true,
      ['system.actions.' + actionId + '.consumers.amUse']: { type: 'itemUses', quantity: 1, default: true },
    });
    /* The figures are on the Favourites tab, where the sheet opens: the Longsword starred */
    await hero.setFlag('a5e-mancer', 'favorites', [item.id]);
    const activated = [];
    Hooks.on('a5e.itemActivate', (it, data) => activated.push((data?.rolls ?? []).map(r => r?.type + (r?.isCrit ? '!' : '')).join('+')));
    await sleep(1500);
    tt.object.control({ releaseOthers: true });
    await hero.sheet.render(true, { left: 40, top: 40 });
    for (let i = 0; i < 200; i++) { await sleep(150); const root = hero.sheet.element instanceof HTMLElement ? hero.sheet.element : hero.sheet.element?.[0]; if (root?.querySelector('[data-item-id="' + item.id + '"] [data-action="roll-attack"]')) break; }
    const root = hero.sheet.element instanceof HTMLElement ? hero.sheet.element : hero.sheet.element?.[0];
    const first = root.querySelector('[data-item-id="' + item.id + '"] [data-action="roll-attack"]');
    first?.closest('.tidy-table-row-container[data-item-id]:not([data-action-id])')?.querySelector('.item-name')?.click();
    await sleep(600);
    window.__p = { hero, target, tt, item, actionId, attackRollId, sleep, activated, real: CONFIG.Dice.randomUniform };
    return 'set up: ' + item.name + ', uses ' + item.system.uses.value + ', buttons ' + root.querySelectorAll('[data-item-id="' + item.id + '"] [data-action="roll-attack"], [data-item-id="' + item.id + '"] [data-action="roll-damage"]').length;
  })()`));

  /* Press one figure with the dice forced; read the card a5e made */
  const press = (which, force) => ev(`(async () => {
    const p = window.__p;
    const root = p.hero.sheet.element instanceof HTMLElement ? p.hero.sheet.element : p.hero.sheet.element?.[0];
    const button = root.querySelector('[data-item-id="' + p.item.id + '"] [data-action="${which}"]');
    if (!button) return { error: 'no ${which} button' };
    const was = game.messages.contents.at(-1)?.id;
    CONFIG.Dice.randomUniform = () => ${force};
    p.activated.length = 0;
    button.click();
    let m = null; for (let t = 0; t < 80 && !m; t++) { await p.sleep(100); const l = game.messages.contents.at(-1); if (l && l.id !== was) m = l; }
    await p.sleep(1200);
    CONFIG.Dice.randomUniform = p.real;
    if (!m) return { error: 'no card' };
    p.m = m;
    const el = ui.chat.element.querySelector('.chat-log .chat-message[data-message-id="' + m.id + '"]');
    return { a5eCard: m.type === 'item', rolls: (m.system?.rollData ?? []).map(r => r.type + (r.isCrit ? '!' : '')).join('+'),
      flagCrit: m.getFlag('a5e', 'isCrit') ?? null,
      shown: [...(el?.querySelectorAll('.roll') ?? [])].map(x => x.textContent.trim() + ([...x.classList].find(c => /roll--(max|min)/.test(c)) ? '(' + [...x.classList].find(c => /roll--(max|min)/.test(c)).slice(6) + ')' : '')).join(' '),
      activated: p.activated.join(' | '), uses: p.item.system.uses.value, concentrating: p.hero.statuses.has('concentration') };
  })()`);
  /* The card as the browser draws it, with --shots: a critical in a screenshot is what was asked for */
  const shoot = async (name) => {
    if (!SHOTS) return;
    const rect = await ev(`(async () => {
      const p = window.__p;
      ui.sidebar.expand(); ui.sidebar.changeTab?.('chat', 'primary');
      await p.sleep(500);
      const el = ui.chat.element.querySelector('.chat-log .chat-message[data-message-id="' + p.m.id + '"]');
      el?.scrollIntoView({ block: 'end' });
      await p.sleep(400);
      const r = el?.getBoundingClientRect();
      return r ? { x: r.x, y: r.y, width: r.width, height: r.height } : null;
    })()`);
    if (rect?.width) await b.shot(pathToFileURL(path.resolve(SHOTS, name + '.png')), { x: Math.max(0, rect.x - 10), y: Math.max(0, rect.y - 10), width: rect.width + 20, height: Math.min(rect.height + 20, 700) });
  };
  const apply = () => ev(`(async () => {
    const p = window.__p;
    const el = ui.chat.element.querySelector('.chat-log .chat-message[data-message-id="' + p.m.id + '"]');
    const full = [...(el?.querySelectorAll('.damage-buttons__item') ?? [])].find(x => /^Apply Damage$/i.test(x.dataset.tooltip || x.getAttribute('aria-label') || x.textContent.trim()));
    const was = p.target.system.attributes.hp.value;
    if (!full) return 'no Apply Damage button';
    full.click();
    await p.sleep(1500);
    const now = p.target.system.attributes.hp.value;
    await p.target.update({ 'system.attributes.hp.value': 100 });
    return was - now;
  })()`);

  console.log('a natural 20 to hit, then its damage');
  let r = await press('roll-attack', 0.0001);
  await shoot('attack-20');
  check(r.a5eCard && r.rolls === 'attack!' && /\(max\)/.test(r.shown) && /attack!/.test(r.activated), 'the attack alone: a5e\'s card, a critical, highlighted, and a5e told of it (Impact Frames)', JSON.stringify(r));
  r = await press('roll-damage', 0.0001);
  await shoot('damage-after-20');
  let dealt = await apply();
  check(r.a5eCard && /^damage/.test(r.rolls) && !/attack/.test(r.rolls) && r.flagCrit === true && r.shown === '16' && dealt === 16, 'the damage alone: critical damage, 8 and 8 more, and 16 applied', `${JSON.stringify(r)} | applied ${dealt}`);

  console.log('a plain 12, then its damage');
  r = await press('roll-attack', 0.41);
  check(r.a5eCard && r.rolls === 'attack' && !/\((max|min)\)/.test(r.shown), 'the attack alone: no critical', JSON.stringify(r));
  r = await press('roll-damage', 0.5);
  dealt = await apply();
  check(r.a5eCard && r.flagCrit === null && r.shown === '4' && dealt === 4, 'the damage alone: plain damage', `${JSON.stringify(r)} | applied ${dealt}`);

  console.log('a natural 1');
  r = await press('roll-attack', 0.9999);
  await shoot('attack-1');
  check(r.rolls === 'attack' && /\(min\)/.test(r.shown), 'marked as a fumble', JSON.stringify(r));

  console.log('a weapon that crits on 19');
  await ev(`(async () => { const p = window.__p; await p.item.update({ ['system.actions.' + p.actionId + '.rolls.' + p.attackRollId + '.critThreshold']: 19 }); await p.sleep(800); return 'ok'; })()`);
  r = await press('roll-attack', 0.06);
  check(r.rolls === 'attack!' && /\(max\)/.test(r.shown), 'a 19 is a critical', JSON.stringify(r));
  r = await press('roll-damage', 0.0001);
  check(r.flagCrit === true && r.shown === '16', 'and its damage critical', JSON.stringify(r));

  console.log('what the halves spend');
  const spent = await ev(`({ uses: window.__p.item.system.uses.value, concentrating: window.__p.hero.statuses.has('concentration') })`);
  check(spent.uses === 3 && !spent.concentrating, 'nothing used up, no concentration started', JSON.stringify(spent));
  const whole = await ev(`(async () => {
    const p = window.__p;
    const was = game.messages.contents.at(-1)?.id;
    await p.item.activate(p.actionId, { skipRollDialog: true });
    for (let t = 0; t < 80; t++) { await p.sleep(100); if (game.messages.contents.at(-1)?.id !== was) break; }
    await p.sleep(1500);
    return { uses: p.item.system.uses.value, concentrating: p.hero.statuses.has('concentration'), rolls: (game.messages.contents.at(-1)?.system?.rollData ?? []).map(r => r.type).join('+') };
  })()`);
  check(whole.uses === 2 && whole.concentrating && /attack\+damage/.test(whole.rolls), 'the control: the whole action spends a use and starts concentration', JSON.stringify(whole));
} catch (err) {
  failures++;
  console.log('FAILED', err.message);
}
try {
  await b.evaluate(`(async () => {
    const p = window.__p; if (p) CONFIG.Dice.randomUniform = p.real;
    try { await p?.hero?.sheet?.close(); } catch {}
    for (const a of game.actors.filter(x => [${Q(HERO)}, ${Q(TARGET)}].includes(x.name))) {
      await canvas.scene.deleteEmbeddedDocuments('Token', canvas.scene.tokens.filter(t => t.actorId === a.id).map(t => t.id));
      await a.delete();
    }
    return 'ok';
  })()`);
} catch {}
const bad = b.console.filter(l => /^\[(error|exception)\]/.test(l) && !/'bars'|unmount is not|Invalid Asset|reading 'name'|'filters'/.test(l));
if (bad.length) console.log(`console: ${bad.length} other errors`);
for (const l of bad.slice(0, 6)) console.log('  ' + l.slice(0, 300).replace(/\n/g, ' | '));
await b.close();
console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
