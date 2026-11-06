/* Residue's exertion is the level of the spell it follows, and Fill In brings learned magic maneuvers to the catalogue.
 *
 * "A bonus-action attack after every spell is imbalanced" (2026-11-06): of
 * three fixes the user chose "exertion equal to the spell's level". a5e
 * charges a resource consumer what the activation's consumption data says, so
 * MagicManeuverPack sets the exertion of such a maneuver to the level on the
 * actor's last spell card. Learned copies kept whatever the catalogue said when
 * they were learned, so Fill In now brings them up to date.
 *
 * This casts Fireball (3rd level) and Magic Missile (1st) from the compendium,
 * uses Residue after each and reads the exertion; uses it on a character who
 * cast nothing; and gives a character a copy as 2.97.0 had it (2 exertion, old
 * text) for MagicManeuverPack.refreshLearned. It makes actors and deletes them.
 *
 *   node tools/checks/residue.mjs --url <a copy's url> --user <a GM's user id>
 */
import { openBrowser } from './lib/cdp.mjs';

const arg = (name, fallback) => {
  const i = process.argv.indexOf('--' + name);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const BASE = arg('url', 'http://localhost:30011');
const USER = arg('user', null);
const Q = JSON.stringify;

let failures = 0, passes = 0;
const check = (ok, label, detail) => {
  ok ? passes++ : failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}: ${detail}`);
};

const b = await openBrowser({ port: 9449, width: 1500, height: 950 });
const ev = (expr, ms = 180000) => Promise.race([b.evaluate(expr),
  new Promise((_, rej) => setTimeout(() => rej(new Error('the page did not answer: ' + expr.trim().slice(0, 60))), ms))]);
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
  console.log(await ev(`'a5e-mancer ' + game.modules.get('a5e-mancer').version + ', ' + game.modules.filter(m => m.active).length + ' modules'`));

  const setup = await ev(`(async () => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    window.__said = [];
    const was = ui.notifications.notify;
    ui.notifications.notify = function (m, ...r) { window.__said.push(String(m)); return was.call(this, m, ...r); };
    if (game.paused) game.togglePause(false, { broadcast: false });
    document.querySelectorAll('.application.dialog, dialog.application').forEach(el => el.remove());
    for (const a of game.actors.filter(x => x.name.startsWith('AM residue '))) await a.delete();
    /* The world's catalogue, rebuilt to this version when the GM loaded */
    let pack = null, idx = null, residueDoc = null;
    for (let i = 0; i < 90 && !residueDoc?.system?.description?.includes('spending exertion equal to the level'); i++) {
      pack = game.packs.get('world.a5e-mancer-magic-maneuvers');
      idx = pack && await pack.getIndex();
      const e = idx?.find(x => x.name === 'Residue');
      residueDoc = e ? await pack.getDocument(e._id) : null;
      if (!residueDoc?.system?.description?.includes('spending exertion equal to the level')) await sleep(1000);
    }
    const spells = game.packs.get('a5e.a5e-spells');
    const sIdx = await spells.getIndex();
    const fireball = await spells.getDocument(sIdx.find(e => e.name === 'Fireball')._id);
    const missile = await spells.getDocument(sIdx.find(e => e.name === 'Magic Missile')._id);
    const make = async (name) => {
      const a = await Actor.create({ name, type: 'character', img: 'icons/svg/mystery-man.svg' });
      const book = await a.spellBooks.add({});
      await a.createEmbeddedDocuments('Item', [
        foundry.utils.mergeObject(fireball.toObject(), { 'system.spellBook': book }),
        foundry.utils.mergeObject(missile.toObject(), { 'system.spellBook': book }),
        residueDoc.toObject()]);
      await sleep(2000);
      await a.update({ 'system.spellResources.slots.1.current': 4, 'system.spellResources.slots.1.max': 4,
                       'system.spellResources.slots.3.current': 3, 'system.spellResources.slots.3.max': 3 });
      await a.update({ 'system.attributes.exertion.current': 10 });
      return a;
    };
    window.__r = { hero: await make('AM residue hero'), other: await make('AM residue other'), sleep, residueDoc };
    return { cost: residueDoc?.system?.exertionCost, text: !!residueDoc?.system?.description?.includes('spending exertion equal to the level') };
  })()`);
  check(setup.cost === 1 && setup.text, 'the world\'s catalogue: Residue at 1 exertion, with the new text', Q(setup));

  const use = (who, name) => ev(`(async () => {
    const r = window.__r; const actor = r.${who};
    window.__said.length = 0;
    const item = actor.items.getName(${Q(name)});
    const before = actor.system.attributes.exertion.current;
    const was = game.messages.contents.at(-1)?.id;
    await item.activate(Object.keys(item.system.actions)[0], { skipRollDialog: true });
    let m = null; for (let t = 0; t < 80 && !m; t++) { await r.sleep(100); const l = game.messages.contents.at(-1); if (l && l.id !== was) m = l; }
    await r.sleep(1500);
    return { card: !!m, castingLevel: m?.system?.castingLevel ?? null, spent: before - actor.system.attributes.exertion.current, said: window.__said.slice() };
  })()`);

  let r = await use('hero', 'Fireball');
  check(r.castingLevel === 3, 'Fireball\'s card states 3rd level', Q(r));
  r = await use('hero', 'Residue');
  check(r.card && r.spent === 3, 'Residue after it spends 3 exertion', Q(r));
  r = await use('hero', 'Magic Missile');
  r = await use('hero', 'Residue');
  check(r.card && r.spent === 1, 'Residue after Magic Missile spends 1', Q(r));
  r = await use('other', 'Residue');
  check(r.spent === 0 && r.said.some(s => /no spell of 1st level/.test(s)), 'Residue with no spell before it: nothing spent, and said', Q(r));

  const fill = await ev(`(async () => {
    const r = window.__r;
    const { MagicManeuverPack } = await import('/modules/a5e-mancer/scripts/utils/magicManeuverPack.js');
    /* A copy as 2.97.0 gave it: 2 exertion, its old text */
    const old = r.residueDoc.toObject();
    old.system.exertionCost = 2;
    old.system.description = '<p>Old text.</p>';
    const aid = Object.keys(old.system.actions)[0];
    const cid = Object.keys(old.system.actions[aid].consumers)[0];
    old.system.actions[aid].consumers[cid].quantity = 2;
    const actor = await Actor.create({ name: 'AM residue fill', type: 'character', img: 'icons/svg/mystery-man.svg' });
    const [copy] = await actor.createEmbeddedDocuments('Item', [old]);
    await r.sleep(800);
    const first = await MagicManeuverPack.refreshLearned(actor);
    const item = actor.items.get(copy.id);
    const again = await MagicManeuverPack.refreshLearned(actor);
    return { first, again, cost: item.system.exertionCost, quantity: item._source.system.actions[aid].consumers[cid].quantity,
      text: item.system.description.includes('spending exertion equal to the level') };
  })()`);
  check(fill.first.length === 1 && !fill.again.length && fill.cost === 1 && fill.quantity === 1 && fill.text,
    'Fill In brings a copy learned under 2.97.0 to the catalogue, once', Q(fill));
} catch (err) {
  failures++;
  console.log('FAILED', err.message);
}
try { await b.evaluate(`(async () => { for (const a of game.actors.filter(x => x.name.startsWith('AM residue '))) await a.delete(); return 'ok'; })()`); } catch {}
const bad = b.console.filter(l => /^\[(error|exception)\]/.test(l) && !/'filters'|unmount is not|reading 'name'|ticker|Invalid Asset/.test(l));
if (bad.length) console.log(`console: ${bad.length} other errors`);
for (const l of bad.slice(0, 6)) console.log('  ' + l.slice(0, 300).replace(/\n/g, ' | '));
await b.close();
console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
