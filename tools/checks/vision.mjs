/* A token's vision follows its character mid-session, with a5e's "Automate Vision Rules" on (TokenVision.follow).
 *
 * a5e works a token's vision out when the token is prepared. When the character
 * changed, it prepared the token again for the scene on view only, then asked
 * the canvas to redo vision modes instead of the token's own vision: the sight
 * drawn on the map kept the old radius, and a token on another scene kept the
 * old range until a reload. The user's players went without their darkvision
 * (2026-11-15).
 *
 * With the canvas on, as a GM: a character with darkvision, its token on the
 * scene on view and on another scene. Its darkvision raised: both tokens, and
 * the sight drawn on the map, follow; deafened takes hearing away; a hit point
 * change draws nothing again. a5e's setting is switched on for the run if it
 * was off, and put back. Everything it makes it deletes.
 *
 *   node tools/checks/vision.mjs --url <a copy's url> --user <a GM's user id>
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

const b = await openBrowser({ port: 9463, width: 1500, height: 900 });
const ev = (expr, ms = 240000) => Promise.race([b.evaluate(expr),
  new Promise((_, rej) => setTimeout(() => rej(new Error('the page did not answer: ' + expr.trim().slice(0, 70))), ms))]);

try {
  await b.send('Page.navigate', { url: `${BASE}/join` });
  await b.sleep(3000);
  await b.evaluate(`fetch('/join', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'join', userid: ${JSON.stringify(USER)}, userId: ${JSON.stringify(USER)}, password: '' }) }).then(r => r.status)`);
  await b.evaluate("localStorage.setItem('core.noCanvas', 'false')");
  await b.send('Page.navigate', { url: `${BASE}/game` });
  let ready = false;
  for (let i = 0; i < 400 && !ready; i++) { await b.sleep(1000); try { ready = await b.evaluate('!!(window.game && game.ready && globalThis.a5eMancer && canvas?.ready)'); } catch {} }
  if (!ready) throw new Error('the world (with its canvas) never came up');
  await b.sleep(6000);
  const head = await ev(`({ a5e: game.system.version, mancer: game.modules.get('a5e-mancer').version, scene: canvas.scene?.name, scenes: game.scenes.size })`);
  console.log(`a5e ${head.a5e}, a5e-mancer ${head.mancer}, on view: ${head.scene}`);
  if (!head.scene || head.scenes < 2) throw new Error('needs a scene on view and one more');

  const r = await ev(`(async () => {
    const wait = (ms) => new Promise(r => setTimeout(r, ms));
    for (const a of game.actors.filter(x => /^AM vision /.test(x.name))) await a.delete();
    const wasOn = game.settings.get('a5e', 'automateVisionRules');
    if (!wasOn) await game.settings.set('a5e', 'automateVisionRules', true);
    const out = { wasOn };
    let actor, far;
    try {
      actor = await Actor.create({ name: 'AM vision dwarf', type: 'character', system: { attributes: { senses: { darkvision: { distance: 60 } } } } });
      await wait(1000);
      const here = canvas.scene, there = game.scenes.find(s => s.id !== here.id);
      const data = async (x) => (await actor.getTokenDocument({ x, y: 200, actorLink: true })).toObject();
      const [t] = await here.createEmbeddedDocuments('Token', [await data(400)]);
      [far] = await there.createEmbeddedDocuments('Token', [await data(400)]);
      for (let i = 0; i < 40 && !t.object; i++) await wait(100);
      await wait(800);
      const o = t.object;
      o.control({ releaseOthers: true });
      await wait(800);
      const read = (d) => ({ token: d.sight.range + ' ' + d.sight.visionMode, drawn: d.object?.vision?.data ? Math.round(d.object.vision.data.radius) : null,
        want: d.object ? Math.round(d.object.sightRange) : null, hearing: !!d.detectionModes?.hearing });
      out.before = { here: read(t), far: read(far) };
      let redraws = 0; const own = o.initializeVisionSource;
      o.initializeVisionSource = function (...x) { redraws++; return own.apply(this, x); };
      await actor.update({ 'system.attributes.senses.darkvision.distance': 90 });
      await wait(1500);
      out.raised = { here: read(t), far: read(far), redraws };
      redraws = 0;
      const hp = actor.system.attributes.hp.value;
      await actor.update({ 'system.attributes.hp.value': hp + 1 });
      await wait(1000);
      out.hitPoints = { redraws };
      await actor.toggleStatusEffect('deafened', { active: true });
      await wait(1000);
      out.deafened = read(t);
      await actor.toggleStatusEffect('deafened', { active: false });
      await wait(1000);
      out.hears = read(t);
      delete o.initializeVisionSource;
    } finally {
      try { await far?.delete(); } catch {}
      try { for (const d of actor?.getDependentTokens?.() ?? []) await d.delete(); } catch {}
      try { await actor?.delete(); } catch {}
      if (!wasOn) await game.settings.set('a5e', 'automateVisionRules', false);
    }
    return out;
  })()`);
  const { before, raised, hitPoints, deafened, hears } = r;
  check(before.here.token === '60 darkvision' && before.here.drawn === before.here.want && before.far.token === '60 darkvision',
    'a placed token sees its character\'s darkvision', JSON.stringify(before));
  check(raised.here.token === '90 darkvision' && raised.here.drawn != null && raised.here.drawn === raised.here.want && raised.here.drawn > before.here.drawn,
    'darkvision raised mid-session: the token on view and the sight drawn on the map follow, no reload', JSON.stringify(raised.here));
  check(raised.far.token === '90 darkvision', 'its token on a scene not on view follows too', JSON.stringify(raised.far));
  check(hitPoints.redraws === 0, 'a hit point change draws nothing again', JSON.stringify(hitPoints));
  check(deafened.hearing === false && hears.hearing === true, 'deafened takes hearing away, and it comes back', JSON.stringify({ deafened, hears }));
} catch (err) {
  failures++;
  console.log('FAILED', err.message);
}
const bad = b.console.filter(l => /^\[(error|exception)\]/.test(l) && /a5e-mancer/i.test(l));
if (bad.length) console.log(`console: ${bad.length} errors naming a5e-mancer`);
for (const l of bad.slice(0, 6)) console.log('  ' + l.slice(0, 300).replace(/\n/g, ' | '));
await b.close();
console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
