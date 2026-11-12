/* a5e 1.5.0 against this module, in real Foundry: what 1.5.0 broke and the module puts right.
 *
 * a5e 1.5.0 (2026-11-06) moved class resources onto the character as resource
 * grants, and in passing renamed its roll classes. On a copy of the user's
 * world (2026-11-11):
 *   - every chat message rolled under 1.4 lost its rolls: "Unable to recreate
 *     e instance from provided data" (A5eFixes.oldRollNames);
 *   - "((@resource.sneak-attack)d6)" wrote the resource object into the formula
 *     and the attack with Sneak Attack ticked did not roll (resourceFormulas);
 *   - a quantity consumer spent nothing - a5e's issue #714, in 1.4.10 as well
 *     (quantityConsumers);
 *   - a class resource with no stored entry cannot be written, and a5e's packs
 *     ship its grants marked applied, so a character made by the builder (or
 *     migrated without having spent it) showed Rage 0/2 for good
 *     (resourceEntries);
 *   - the sheet's trackers wrote to classResources, which 1.5 has no more.
 * This checks each of them, on characters the builder makes as a player would,
 * and the trackers on the sheet: stepped in place, a class's figure shown, a
 * tracker made and removed. Everything it makes it deletes.
 *
 *   node tools/checks/a5e150.mjs --url <a copy's url> --user <a GM's user id>
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

const b = await openBrowser({ port: 9461, width: 1500, height: 900 });
const ev = (expr, ms = 240000) => Promise.race([b.evaluate(expr),
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
  const head = await ev(`({ a5e: game.system.version, mancer: game.modules.get('a5e-mancer').version, modules: game.modules.filter(m => m.active).length })`);
  console.log(`a5e ${head.a5e}, a5e-mancer ${head.mancer}, ${head.modules} modules`);
  if (!(await ev(`foundry.utils.isNewerVersion(game.system.version, '1.4.999')`))) {
    console.log('  (a5e before 1.5: nothing of 1.5 to check)');
    await b.close();
    process.exit(0);
  }

  /* The kit: errors, the builder as the builder runs it, a5e's documents by name */
  console.log(await ev(`(async () => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    window.__err = [];
    const keep = (s) => { if (!/Unable to recreate e instance/.test(s)) window.__err.push(String(s).slice(0, 400)); };
    const ce = console.error; console.error = function (...a) { keep(a.map(x => x?.message ?? String(x)).join(' ')); return ce.apply(this, a); };
    window.addEventListener('unhandledrejection', (e) => keep('REJECTED ' + (e.reason?.message ?? e.reason)));
    for (const a of game.actors.filter(x => /^AM 150 /.test(x.name))) await a.delete();
    for (const m of game.messages.filter(x => String(x.flavor ?? '').startsWith('AM 150'))) await m.delete();
    const index = {};
    for (const p of game.packs.filter(p => p.documentName === 'Item' && p.metadata.packageName === 'a5e')) {
      for (const e of await p.getIndex({ fields: ['type'] })) index[e.type + ':' + e.name] ??= 'Compendium.' + p.collection + '.Item.' + e._id;
    }
    const { ActorCreationService } = await import('/modules/a5e-mancer/scripts/utils/actorCreationService.js');
    const { AM } = await import('/modules/a5e-mancer/scripts/am.js');
    const { DOMManager } = await import('/modules/a5e-mancer/scripts/utils/DOMManager.js');
    const build = async (name, cls, background) => {
      AM.SELECTED = {}; AM.itemGrants = {};
      const parts = { heritage: index['heritage:Human'], culture: Object.entries(index).find(([k]) => k.startsWith('culture:'))[1], background: index['background:' + background], class: index['class:' + cls] };
      for (const [type, uuid] of Object.entries(parts)) if (uuid) await DOMManager.loadItemGrants(type, uuid);
      const fd = { object: { 'character-name': name, 'abilities[str]': 14, 'abilities[dex]': 16, 'abilities[con]': 13, 'abilities[int]': 10, 'abilities[wis]': 12, 'abilities[cha]': 8 } };
      for (const [type, uuid] of Object.entries(parts)) fd.object[type] = uuid ? 'x [' + uuid + ']' : '';
      const actor = await ActorCreationService.createCharacter(null, fd);
      await sleep(1500);
      for (const app of Object.values(ui.windows)) if (app.actor === actor) await app.close();
      for (const app of [...(foundry.applications.instances?.values?.() ?? [])]) if (app.actor === actor || app.document === actor) await app.close();
      return actor;
    };
    const fromPack = async (actor, type, name, data = {}) => {
      const doc = await fromUuid(index[type + ':' + name]);
      const src = doc.toObject(); foundry.utils.mergeObject(src, data);
      const [item] = await actor.createEmbeddedDocuments('Item', [src]);
      return item;
    };
    window.__k = { sleep, index, build, fromPack };
    return 'kit ready: ' + Object.keys(index).length + ' a5e items indexed';
  })()`));

  console.log('rolls stored under a5e 1.4');
  const rolls = await ev(`(async () => {
    const stored = game.messages.contents.filter(m => (m._source.rolls ?? []).length);
    const lost = stored.filter(m => m.rolls.length < m._source.rolls.length).length;
    const old = stored.filter(m => (m._source.rolls ?? []).some(r => { try { return (typeof r === 'string' ? JSON.parse(r) : r).class === 'e'; } catch { return false; } })).length;
    /* One made now as 1.4 wrote it */
    const roll = await new Roll('2d6 + 3').evaluate();
    const data = roll.toJSON(); data.class = 'e';
    const m = await ChatMessage.create({ flavor: 'AM 150 old roll', rolls: [JSON.stringify(data)] });
    await window.__k.sleep(600);
    const fresh = game.messages.get(m.id);
    return { stored: stored.length, old, lost, alias: CONFIG.Dice.rolls.some(c => c.name === 'e'), made: fresh?.rolls?.length ?? -1, total: fresh?.rolls?.[0]?.total, want: roll.total, isRoll: fresh?.rolls?.[0] instanceof Roll };
  })()`);
  check(rolls.lost === 0, 'every message in the world has its rolls', `${rolls.stored} with rolls, ${rolls.old} of them stored under 1.4, ${rolls.lost} lost`);
  check(rolls.made === 1 && rolls.isRoll && rolls.total === rolls.want, 'a roll stored as 1.4 stored it is read, with its total', `${rolls.made} roll(s), total ${rolls.total} of ${rolls.want}`);

  console.log('characters made by the builder');
  const made = await ev(`(async () => {
    const k = window.__k;
    const berserker = await k.build('AM 150 Berserker', 'Berserker', 'Soldier');
    const rogue = await k.build('AM 150 Rogue', 'Rogue', 'Troublemaker');
    window.__k.berserker = berserker; window.__k.rogue = rogue;
    const view = (a) => Object.fromEntries(Object.entries(a._source.system.resources ?? {}).map(([s, r]) => [s, r.type + ' ' + r.value]));
    return { berserker: view(berserker), rogue: view(rogue), rage: berserker.system.resources.rage ? berserker.system.resources.rage.value + '/' + berserker.system.resources.rage.max : null,
      hp: [berserker, rogue].map(a => a.system.attributes.hp.value + '/' + a.system.attributes.hp.max) };
  })()`);
  check(made.berserker.rage === 'uses 2' && made.rage === '2/2', 'a Berserker starts with its Rage stored, and full', JSON.stringify(made.berserker));
  check('sneak-attack' in made.rogue && 'cunning-action' in made.rogue, 'a Rogue has its Sneak Attack and Cunning Action stored', JSON.stringify(made.rogue));
  check(made.hp.every(h => { const [v, m] = h.split('/').map(Number); return m > 0 && v === m; }), 'both start with full hit points (the actor\'s default of 10 stood before)', made.hp.join(', '));
  const spent = await ev(`(async () => {
    const a = window.__k.berserker;
    await a.system.resources.rage.useResource({});
    await window.__k.sleep(500);
    return { stored: a._source.system.resources.rage?.value, shown: a.system.resources.rage?.value };
  })()`);
  check(spent.stored === 1 && spent.shown === 1, "a5e's own spending of a Rage is kept", JSON.stringify(spent));

  const mended = await ev(`(async () => {
    const a = window.__k.berserker;
    const Gone = foundry.data.operators.ForcedDeletion;
    await a.update({ 'system.resources.rage': new Gone() });
    await window.__k.sleep(400);
    const before = 'rage' in (a._source.system.resources ?? {});
    const tried = await a.update({ 'system.resources.rage.value': 1 }).then(() => a._source.system.resources?.rage?.value ?? null);
    const { A5eFixes } = await import('/modules/a5e-mancer/scripts/utils/a5eFixes.js');
    const names = await A5eFixes.resourceEntries(a);
    await window.__k.sleep(400);
    return { before, tried, names, after: a._source.system.resources?.rage ?? null };
  })()`);
  check(!mended.before && mended.tried === null, 'without its entry a Rage cannot be written (what 1.5.0 does)', `written: ${mended.tried}`);
  check(mended.names.includes('Rage') && mended.after?.value === 2 && mended.after?.type === 'uses', 'the repair stores it again, full', JSON.stringify(mended.after));

  console.log('@resource in a formula');
  const formula = await ev(`(async () => {
    const a = window.__k.rogue;
    const data = a.getRollData();
    const text = Roll.replaceFormulaData('((@resource.sneak-attack)d6)', data, { missing: '0' });
    let total = null, error = null;
    try { const r = await new Roll('((@resource.sneak-attack)d6)', data).evaluate(); total = r.total; } catch (e) { error = e.message; }
    const value = Roll.replaceFormulaData('@resource.sneak-attack.value', data, { missing: '0' });
    return { text, total, error, value };
  })()`);
  check(formula.error === null && formula.total >= 1 && formula.total <= 6 && /^\(\(1\)d6\)$/.test(formula.text), "Sneak Attack's dice at 1st level: 1d6", `${formula.text} = ${formula.total}${formula.error ? ' ' + formula.error : ''}`);
  check(/^\d+$/.test(formula.value), 'a resource\'s fields still read as before', `@resource.sneak-attack.value = ${formula.value}`);

  const attack = await ev(`(async () => {
    const k = window.__k, a = k.rogue;
    const dagger = await k.fromPack(a, 'object', 'Dagger', { system: { equippedState: 2 } });
    /* The Sneak Attack bonus ticked, as a player ticks it in the attack window */
    const [id, bonus] = Object.entries(a.system.bonuses?.damage ?? {}).find(([, x]) => /sneak-attack/.test(x.formula ?? '')) ?? [];
    if (!id) return { error: 'no Sneak Attack bonus on the rogue', bonuses: Object.values(a.system.bonuses?.damage ?? {}).map(x => x.formula) };
    await a.update({ ['system.bonuses.damage.' + id + '.default']: true });
    await k.sleep(400);
    const was = game.messages.contents.at(-1)?.id;
    const before = window.__err.length;
    const actionId = Object.keys(dagger.system.actions)[0];
    await dagger.activate(actionId, { skipRollDialog: true });
    let m = null; for (let t = 0; t < 120 && !m; t++) { await k.sleep(100); const l = game.messages.contents.at(-1); if (l && l.id !== was) m = l; }
    await k.sleep(800);
    const damage = (m?.rolls ?? []).filter(r => !/d20/.test(r.formula));
    return { card: !!m, formulas: (m?.rolls ?? []).map(r => r.formula), sneak: damage.some(r => /\\b1d6\\b|\\(1\\)d6/.test(r.formula) && /sneak/i.test(JSON.stringify(r.terms.map(t => t.options?.flavor ?? '')) + r.formula)), errors: window.__err.slice(before) };
  })()`);
  check(attack.card && attack.sneak && !attack.errors.length, 'a dagger attack with Sneak Attack ticked rolls, with its 1d6', `${JSON.stringify(attack.formulas)}${attack.error ? ' ' + attack.error : ''}${attack.errors?.length ? ' errors: ' + attack.errors.join(' | ') : ''}`);

  console.log('a potion drunk');
  const potion = await ev(`(async () => {
    const k = window.__k, a = k.rogue;
    const item = await k.fromPack(a, 'object', 'Potion of Healing', { system: { quantity: 3 } });
    const actionId = Object.keys(item.system.actions ?? {})[0];
    const consumers = Object.entries(item.system.actions?.[actionId]?.consumers ?? {}).map(([cid, c]) => ({ cid, type: c.type, itemId: c.itemId, def: c.default }));
    let q = consumers.find(c => c.type === 'quantity');
    if (!q) {
      await item.update({ ['system.actions.' + actionId + '.consumers.amQuantity0001']: { type: 'quantity', itemId: item.id, quantity: 1, default: true } });
      q = { cid: 'amQuantity0001', added: true };
    } else if (q.itemId !== item.id) {
      await item.update({ ['system.actions.' + actionId + '.consumers.' + q.cid + '.itemId']: item.id });
    }
    await k.sleep(400);
    const was = game.messages.contents.at(-1)?.id;
    await item.activate(actionId, { skipRollDialog: true });
    for (let t = 0; t < 80; t++) { await k.sleep(100); if (game.messages.contents.at(-1)?.id !== was) break; }
    await k.sleep(1200);
    return { consumers, q, quantity: a.items.get(item.id)?.system?.quantity };
  })()`);
  check(potion.quantity === 2, 'drinking one of three potions leaves two (a5e issue #714)', `quantity ${potion.quantity}; the pack's consumers ${JSON.stringify(potion.consumers)}`);

  console.log("the sheet's trackers");
  const sheet = await ev(`(async () => {
    const k = window.__k, a = k.berserker;
    const ours = Object.keys(CONFIG.Actor.sheetClasses.character).find(x => x.startsWith('a5e.A5e'));
    await a.update({ 'flags.core.sheetClass': ours, 'flags.a5e.sheetIsLocked': true });
    let redraws = 0;
    const hook = Hooks.on('renderActorSheet', (app) => { if (app.actor === a) redraws++; });
    await a.sheet.render(true);
    const root = () => (a.sheet.element instanceof HTMLElement ? a.sheet.element : a.sheet.element?.[0]);
    for (let i = 0; i < 200 && !root()?.querySelector('.am-tracker'); i++) await k.sleep(100);
    await k.sleep(1500);
    const chips = [...root().querySelectorAll('.am-tracker')].map(t => (t.querySelector('.am-a5e-label')?.textContent ?? t.querySelector('input.am-tracker-name')?.value ?? '').trim() + ' ' + (t.classList.contains('am-tracker-figure') ? '[' + t.querySelector('.am-tracker-figure-value')?.textContent.trim() + ']' : (t.querySelector('[data-action="resource-value"]')?.value ?? '') + '/' + (t.querySelector('.max')?.textContent ?? '')));
    const rage = [...root().querySelectorAll('.am-tracker')].find(t => /^Rage$/.test(t.querySelector('.am-a5e-label')?.textContent.trim() ?? ''));
    const r0 = redraws;
    rage?.querySelector('[data-action="resource-step"][data-delta="-1"]')?.click();
    await k.sleep(1500);
    const stepped = { stored: a._source.system.resources.rage?.value, shown: rage?.querySelector('[data-action="resource-value"]')?.value, redraws: redraws - r0, same: rage?.isConnected };
    /* a5e spending one, as an action does */
    const r1 = redraws;
    await a.system.resources.rage.useResource({});
    await k.sleep(1500);
    const rageNow = [...root().querySelectorAll('.am-tracker')].find(t => /^Rage$/.test(t.querySelector('.am-a5e-label')?.textContent.trim() ?? ''));
    const byA5e = { stored: a._source.system.resources.rage?.value, shown: rageNow?.querySelector('[data-action="resource-value"]')?.value, redraws: redraws - r1 };
    /* Unlocked: a tracker made, named, and taken away */
    await a.update({ 'flags.a5e.sheetIsLocked': false });
    for (let i = 0; i < 30 && !root()?.querySelector('[data-action="resource-add"]'); i++) await k.sleep(100);
    root().querySelector('[data-action="resource-add"]')?.click();
    for (let i = 0; i < 40 && !a._source.system.resources?.tracker; i++) await k.sleep(100);
    await k.sleep(1200);
    const made = a._source.system.resources?.tracker ?? null;
    const nameField = root().querySelector('[data-action="resource-field"][data-resource="tracker"][data-field="name"]');
    if (nameField) { nameField.value = 'Arrows'; nameField.dispatchEvent(new Event('change', { bubbles: true })); }
    await k.sleep(1200);
    const named = a._source.system.resources?.tracker?.name ?? null;
    root().querySelector('[data-action="resource-remove"][data-resource="tracker"]')?.click();
    for (let i = 0; i < 40 && a._source.system.resources?.tracker; i++) await k.sleep(100);
    const removed = !a._source.system.resources?.tracker;
    const grantedCross = !!root().querySelector('[data-action="resource-remove"][data-resource="rage"]');
    Hooks.off('renderActorSheet', hook);
    await a.update({ 'flags.a5e.sheetIsLocked': true });
    await a.sheet.close();
    return { chips, stepped, byA5e, made, named, removed, grantedCross, errors: window.__err.slice(-5) };
  })()`);
  check(sheet.chips.some(c => /^Rage \d\/2$/.test(c)), 'Rage is a tracker with its maximum', sheet.chips.join(' | '));
  check(sheet.chips.some(c => /^Rage Hit Points \[2\]$/.test(c)), "Rage Hit Points, a figure from the class table, is shown as the figure", sheet.chips.join(' | '));
  check(sheet.stepped.stored === 1 && sheet.stepped.shown === '1' && sheet.stepped.redraws === 0 && sheet.stepped.same, 'the minus spends one, in place', JSON.stringify(sheet.stepped));
  check(sheet.byA5e.stored === 0 && sheet.byA5e.shown === '0' && sheet.byA5e.redraws === 0, "a5e spending one is shown in place too", JSON.stringify(sheet.byA5e));
  check(sheet.made?.type === 'uses' && sheet.named === 'Arrows' && sheet.removed && !sheet.grantedCross, 'unlocked: a tracker made, named and taken away; a granted one has no cross', `made ${JSON.stringify(sheet.made)}, named ${sheet.named}, removed ${sheet.removed}`);
} catch (err) {
  failures++;
  console.log('FAILED', err.message);
}

/* A chat card whose item is gone - a monster's attack after its token was deleted: a5e 1.5's ItemCard read the
   name of nothing, and the card came up blank with an error at every load of the log (A5eFixes.goneItemCards) */
try {
  const card = await b.evaluate(`(async () => {
    const actor = await Actor.create({ name: 'AM 150 gone card', type: 'npc' });
    const [item] = await actor.createEmbeddedDocuments('Item', [{ name: 'AM 150 Claw', type: 'object' }]);
    const msg = await ChatMessage.create({ type: 'item', speaker: { alias: 'AM 150 gone card' },
      system: { itemId: item.uuid, actorId: actor.uuid, actionName: 'AM 150 Claw', actorName: actor.name, img: item.img } });
    const before = (await msg.renderHTML())?.querySelector('.a5e-chat-card__body__header')?.textContent ?? '';
    await actor.delete();
    const errs = [];
    const ce = console.error;
    console.error = (...a) => { errs.push(a.map(x => x?.message ?? String(x)).join(' ').slice(0, 160)); return ce.apply(console, a); };
    let html = null;
    try { html = await msg.renderHTML(); } finally { console.error = ce; }
    const title = (html?.querySelector('.a5e-chat-card__body__header')?.textContent ?? '').replace(/\\s+/g, ' ').trim();
    const outside = msg.item;
    await msg.delete();
    return { before: before.replace(/\\s+/g, ' ').trim(), title, errs, outside: outside === undefined ? 'undefined' : typeof outside };
  })()`);
  check(!card.errs.length && /AM 150 Claw/.test(card.title) && /AM 150 Claw/.test(card.before) && card.outside === 'undefined',
    "a card whose item is gone is drawn, titled by its action, and the message's item is still nothing outside the drawing", JSON.stringify(card));
} catch (err) {
  failures++;
  console.log('FAILED', err.message);
}

try {
  await b.evaluate(`(async () => {
    for (const a of game.actors.filter(x => /^AM 150 /.test(x.name))) await a.delete();
    for (const m of game.messages.filter(x => String(x.flavor ?? '').startsWith('AM 150') || (x.speaker?.alias ?? '').startsWith('AM 150'))) await m.delete();
    return 'ok';
  })()`);
} catch {}
const bad = b.console.filter(l => /^\[(error|exception)\]/.test(l) && !/Unable to recreate e instance/.test(l) && /a5e-mancer/i.test(l));
if (bad.length) console.log(`console: ${bad.length} errors naming a5e-mancer`);
for (const l of bad.slice(0, 6)) console.log('  ' + l.slice(0, 300).replace(/\n/g, ' | '));
await b.close();
console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
