/* Beyond20's REAL page script in a copy of the world: what reaches the tracker, and what a critical hit deals.
 *
 * "Did you fix the crits on Beyond20? They did not work. And an initiative roll
 * did not add the token to the tracker" (2026-10-31). Earlier tests posted copies
 * of its cards, which cannot see what its script does around them. Run for real,
 * it showed three things no copy of a card shows:
 *
 *   - with no actor of the card's exact name, its speaker is a guess (the token
 *     selected, else whoever the user plays as), and a GM's short name went on
 *     the GM's own character;
 *   - it warns "Cannot add initiative to tracker" whenever nothing is selected,
 *     over a roll the bridge did add;
 *   - "Roll Damages" answers only in the chat log's copy of a card: the copy that
 *     pops up while the sidebar is shut did nothing.
 *
 * So this loads the extension's own fvtt_script.js into a GM's page and a
 * player's, sends it the events the D&D Beyond tab sends, with the dice forced
 * where it matters, and reads the tracker, what reached the notifications and the
 * HP. It makes actors, tokens, encounters and a user, and deletes them; a run that
 * was killed has its leavings deleted by the next. On a copy it makes the viewed
 * scene the active one.
 *
 *   node tools/checks/beyond20.mjs --url <a copy's url> --user <a GM's user id> [--script <fvtt_script.js>]
 */
import { readFileSync, existsSync, readdirSync } from 'fs';
import path from 'path';
import { openBrowser } from './lib/cdp.mjs';

const arg = (name, fallback) => {
  const i = process.argv.indexOf('--' + name);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const BASE = arg('url', 'http://localhost:30011');
const USER = arg('user', null);
const Q = JSON.stringify;

/* Names no world has: nothing in a copy may answer for the test's hero */
const HERO = 'Zephyrine Am Beaumont';
const SHORT = 'Zephyrine';
const DUMMY = 'AM b20 dummy';
const STRAY = 'AM b20 GM character';
const PLAYER = 'AM b20 player';

/* The newest copy of the extension in Chrome's default profile, unless told */
function findScript() {
  const given = arg('script', null);
  if (given) return given;
  const root = path.join(process.env.LOCALAPPDATA ?? '', 'Google/Chrome/User Data/Default/Extensions/gnblbpbepfbfmoobegdogkglpbhcjofh');
  const versions = existsSync(root) ? readdirSync(root).sort() : [];
  return versions.length ? path.join(root, versions.at(-1), 'dist/fvtt_script.js') : null;
}
const SCRIPT = findScript();
if (!SCRIPT || !existsSync(SCRIPT)) {
  console.log('Beyond20 is not installed here: pass --script <its dist/fvtt_script.js>');
  process.exit(2);
}

/* What both pages need, kept on window so that each step below stays one expression. */
const KIT = `(() => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const character = (name) => ({ name, source: 'D&D Beyond', avatar: '', id: '123', type: 'Character', url: 'https://www.dndbeyond.com/characters/123', abilities: [], proficiency: '+3', settings: {} });
  const realRandom = CONFIG.Dice.randomUniform;
  window.__b20 = {
    sleep, character,
    roll: (request) => document.dispatchEvent(new CustomEvent('Beyond20_Roll', { detail: [request] })),
    rendered: (request) => document.dispatchEvent(new CustomEvent('Beyond20_RenderedRoll', { detail: [request] })),
    initiative: (name, whisper = 0) => ({ action: 'roll', character: character(name), type: 'initiative', roll: '1d20+2', advantage: 0, whisper, initiative: '+2' }),
    attack: (name, extra = {}) => ({ action: 'roll', character: character(name), type: 'attack', roll: '1d20+5', advantage: 0, whisper: 0,
      name: 'Longsword', 'attack-source': 'item', description: 'A long sword.', rollAttack: true, rollDamage: true, rollCritical: false,
      'to-hit': '+5', reach: '5 ft', 'attack-type': 'Melee', proficient: true, properties: [],
      damages: ['1d8+3'], 'damage-types': ['Slashing'], 'critical-damages': ['1d8'], 'critical-damage-types': ['Slashing'], ...extra }),
    /* 0.0001 reads as the highest face: a natural 20 and every die at its top. Else a plain middling roll */
    dice: (high) => { CONFIG.Dice.randomUniform = high ? () => 0.0001 : () => 0.6; },
    honest: () => { CONFIG.Dice.randomUniform = realRandom; },
    last: () => game.messages.contents.at(-1),
    next: async (after, ms = 8000) => {
      for (const t0 = Date.now(); Date.now() - t0 < ms;) { const m = game.messages.contents.at(-1); if (m && m.id !== after) return m; await sleep(100); }
      return null;
    },
    said: [],
    copies: (id) => [...document.querySelectorAll('.chat-message[data-message-id="' + id + '"]')],
  };
  /* What reached the screen: warn and its like end in notify, and a hushed warning never gets there */
  const was = ui.notifications.notify;
  ui.notifications.notify = function (message, ...rest) { window.__b20.said.push(String(message)); return was.call(this, message, ...rest); };
  return 'kit';
})()`;
const SAID = 'window.__b20.said.slice()';

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

async function load(b) {
  const asked = (expr) => Promise.race([b.evaluate(expr),
    new Promise((_, rej) => setTimeout(() => rej(new Error('the page did not answer: ' + expr.trim().slice(0, 70))), 240000))]);
  await asked(readFileSync(SCRIPT.replace(/dist[\\/]fvtt_script\.js$/, 'libs/alertify.min.js'), 'utf8') + '\n;"lib"');
  await asked(readFileSync(SCRIPT, 'utf8') + '\n;"loaded"');
  await asked(KIT);
  return asked;
}

const gm = await openBrowser({ port: 9445, width: 1600, height: 1000 });
let player = null;
try {
  if (!await enter(gm, USER)) throw new Error('the world never came up');
  await gm.sleep(4000);
  const ev = await load(gm);
  console.log(await ev(`'a5e-mancer ' + game.modules.get('a5e-mancer').version + ', ' + game.modules.filter(m => m.active).length + ' modules, Beyond20 script ' + !!game.beyond20?.loaded`));
  const playerId = await ev(`(async () => {
    if (game.paused) game.togglePause(false, { broadcast: false });
    document.querySelectorAll('.application.dialog, dialog.application').forEach(el => el.remove());
    if (!canvas.scene.active) await canvas.scene.activate();
    for (const c of [...game.combats]) { try { await c.delete(); } catch {} }
    /* What a run that was killed left */
    const made = ${Q([HERO, DUMMY, STRAY])};
    for (const a of game.actors.filter(x => made.includes(x.name))) {
      if (game.user.character?.id === a.id) await game.user.update({ character: null });
      await canvas.scene.deleteEmbeddedDocuments('Token', canvas.scene.tokens.filter(t => t.actorId === a.id).map(t => t.id));
      await a.delete();
    }
    for (const x of game.users.filter(x => x.name === ${Q(PLAYER)})) await x.delete();

    const u = await User.create({ name: ${Q(PLAYER)}, role: CONST.USER_ROLES.PLAYER });
    const ownership = { default: 0, [u.id]: 3 };
    const hp = { attributes: { hp: { value: 100, baseMax: 100 } } };
    const hero = await Actor.create({ name: ${Q(HERO)}, type: 'character', img: 'icons/svg/mystery-man.svg', ownership, system: hp });
    const dummy = await Actor.create({ name: ${Q(DUMMY)}, type: 'character', img: 'icons/svg/mystery-man.svg', system: hp });
    /* The GM plays someone: that is whom the guess of a speaker falls on */
    const stray = game.user.character ? null : await Actor.create({ name: ${Q(STRAY)}, type: 'character', img: 'icons/svg/mystery-man.svg' });
    if (stray) await game.user.update({ character: stray.id });
    const [t1] = await canvas.scene.createEmbeddedDocuments('Token', [(await hero.getTokenDocument({ x: 300, y: 300 })).toObject()]);
    const [t2] = await canvas.scene.createEmbeddedDocuments('Token', [(await dummy.getTokenDocument({ x: 500, y: 300 })).toObject()]);
    await new Promise(r => setTimeout(r, 1500));
    canvas.tokens.releaseAll();
    Object.assign(window.__b20, { u, hero, dummy, stray, t1, t2 });
    window.__b20.combat = await Combat.create({ scene: canvas.scene.id, active: true });
    return u.id;
  })()`);
  console.log('the GM plays as ' + await ev(`game.user.character?.name ?? 'nobody'`));

  /* Every roll below: who ends up in the tracker, what stayed on the screen. */
  const tracker = `(() => { const c = window.__b20.combat; return c ? c.combatants.map(x => x.name).sort().join(', ') : '(no encounter)'; })()`;
  const clear = `(async () => { const k = window.__b20; await k.combat.deleteEmbeddedDocuments('Combatant', k.combat.combatants.map(x => x.id)); k.said.length = 0; return 'ok'; })()`;
  const rollInitiative = (args, wait = 2800) => `(async () => {
    const k = window.__b20; const before = k.last()?.id;
    k.dice(false); k.roll(k.initiative(${args})); const m = await k.next(before); k.honest();
    await k.sleep(${wait});
    return m?.id ?? null;
  })()`;
  const scenario = async (label, roll, want, { warned = null } = {}) => {
    await ev(clear);
    await roll();
    const got = await ev(tracker);
    const said = await ev(SAID);
    const own = said.filter(s => /Cannot add initiative/.test(s));
    check(got === want && !own.length && (!warned || said.some(s => warned.test(s))), label,
      `tracker: ${got || '(empty)'}${own.length ? ' | Beyond20 said: ' + own[0] : ''}${warned ? ' | said: ' + (said.join(' / ') || 'nothing') : ''}`);
  };

  console.log('initiative, a GM rolling, nothing selected');
  await scenario('the exact name', () => ev(rollInitiative(Q(HERO))), HERO);
  await scenario('a short name: the character whose name it begins, not the one the GM plays', () => ev(rollInitiative(Q(SHORT))), HERO);
  await scenario('a name nobody has: nobody added, and said so', () => ev(rollInitiative(Q('Nobody At All'))), '', { warned: /Nobody At All/ });
  await scenario('whispered to the GM', () => ev(rollInitiative(Q(HERO) + ', 1')), HERO);

  /* The control: what is looked for above does show, and the filter hangs on the setting */
  await ev(`game.settings.set('a5e-mancer', 'beyond20Initiative', false)`);
  await ev(clear);
  await ev(rollInitiative(Q(HERO)));
  const off = await ev(SAID);
  check(off.some(m => /^Cannot add initiative/.test(m)) && !(await ev(tracker)), 'our setting off: Beyond20\'s own warning is back and we add nothing', off.join(' / ') || 'nothing said');
  await ev(`game.settings.set('a5e-mancer', 'beyond20Initiative', true)`);

  console.log('initiative, a GM rolling, a token selected');
  await ev(`(async () => { window.__b20.t2.object.control({ releaseOthers: true }); await window.__b20.sleep(300); return 'ok'; })()`);
  await scenario('another name on D&D Beyond: the token selected', () => ev(rollInitiative(Q('Someone Else On Beyond'))), DUMMY);
  await ev(`(async () => { canvas.tokens.releaseAll(); return 'ok'; })()`);

  console.log('initiative, a card D&D Beyond\'s digital dice already rendered');
  await scenario('its card alone reaches the tracker', async () => {
    const id = await ev(rollInitiative(Q(HERO), 2500));
    await ev(`(async () => {
      const k = window.__b20;
      await k.combat.deleteEmbeddedDocuments('Combatant', k.combat.combatants.map(x => x.id));
      const html = game.messages.get(${Q(id)}).content;
      const before = k.last()?.id;
      k.rendered({ action: 'rendered-roll', request: k.initiative(${Q(HERO)}), title: 'Initiative (+2)', html, character: ${Q(HERO)}, whisper: 0, play_sound: false, source: 'D&D Beyond', attributes: {}, description: '',
        attack_rolls: [{ total: 15, formula: '1d20+2', discarded: false, parts: [{ formula: '1d20', amount: 1, faces: 20, total: 13, rolls: [{ roll: 13 }] }, '+', 2] }], roll_info: [], damage_rolls: [], total_damages: {}, open: false });
      await k.next(before);
      await k.sleep(2800);
      return 'ok';
    })()`);
  }, HERO);

  console.log('initiative, no encounter at all');
  await ev(clear);
  const started = await ev(`(async () => {
    const k = window.__b20;
    await k.combat.delete(); await k.sleep(500);
    const before = k.last()?.id;
    k.dice(false); k.roll(k.initiative(${Q(HERO)})); await k.next(before); k.honest();
    await k.sleep(3200);
    k.combat = game.combats.find(c => c.scene?.id === canvas.scene.id && c.active) ?? null;
    return k.combat ? k.combat.combatants.map(x => x.name).join(', ') : '(none)';
  })()`);
  check(started === HERO, 'the GM\'s roll starts one', started);

  /* A natural 20 */
  const hp = (who) => `window.__b20.${who}.system.attributes.hp.value`;
  const attackCard = (extra = '') => `(async () => {
    const k = window.__b20; const before = k.last()?.id;
    k.dice(true); k.roll(k.attack(${Q(HERO)}${extra ? ', ' + extra : ''})); const m = await k.next(before); await k.sleep(600); k.honest();
    await k.sleep(1500);
    return m?.id ?? null;
  })()`;
  const applyCritical = (id, who) => `(async () => {
    const k = window.__b20; const was = ${hp(who)};
    const btn = k.copies(${Q(id)}).flatMap(c => [...c.querySelectorAll('[data-tooltip]')]).find(n => /critical hit/i.test(n.dataset.tooltip) || (/^Apply \\d+ damage$/.test(n.dataset.tooltip) && n.closest('.beyond20-combined-damage')));
    if (!btn) return 'no button';
    btn.click();
    await k.sleep(1500);
    return btn.dataset.tooltip + ': HP ' + was + ' -> ' + ${hp(who)};
  })()`;
  const reset = (who) => `(async () => { await window.__b20.${who}.update({ 'system.attributes.hp.value': 100 }); return 'ok'; })()`;

  console.log('a natural 20: every die at its top on a Longsword, 1d8+3 and 1d8 more');
  await ev(`(async () => { window.__b20.t2.object.control({ releaseOthers: true }); await window.__b20.sleep(300); return 'ok'; })()`);
  let id = await ev(attackCard());
  let res = await ev(applyCritical(id, 'dummy'));
  check(/19 damage.*100 -> 81/.test(res), 'one damage roll: its button deals both', res);
  await ev(reset('dummy'));
  id = await ev(attackCard(`{ damages: ['1d8+3', '1d6'], 'damage-types': ['Slashing', 'Fire'], 'critical-damages': ['1d8', '1d6'], 'critical-damage-types': ['Slashing', 'Fire'] }`));
  res = await ev(applyCritical(id, 'dummy'));
  check(/31 damage.*100 -> 69/.test(res), 'two damage types: the combined total', res);
  await ev(reset('dummy'));

  console.log('a natural 20 with Beyond20\'s automatic damage off: "Roll Damages" on the card');
  const pressRollDamages = (where) => `(async () => {
    const k = window.__b20; const before = k.last()?.id;
    k.dice(true); k.roll(k.attack(${Q(HERO)}, { rollDamage: false })); const m = await k.next(before); await k.sleep(2200);
    const inPopup = (el) => !!el.closest('#chat-notifications');
    const buttons = k.copies(m.id).flatMap(c => [...c.querySelectorAll('.beyond20-button-roll-damages')]);
    const chosen = buttons.find(b => ${where === 'popup' ? 'inPopup(b)' : '!inPopup(b)'});
    if (!chosen) { k.honest(); return { copies: buttons.length, id: null, cards: 0 }; }
    const asked = k.last()?.id;
    const count = game.messages.size;
    chosen.click();
    const card = await k.next(asked); await k.sleep(1800); k.honest();
    return { copies: buttons.length, id: card?.id ?? null, cards: game.messages.size - count };
  })()`;
  /* The sidebar shut: this is when Foundry pops the card up */
  const pops = await ev(`(async () => { ui.sidebar.collapse(); await window.__b20.sleep(800); return ui.chat._shouldShowNotifications(); })()`);
  check(pops === true, 'the sidebar shut: Foundry pops cards up', String(pops));
  for (const where of ['log', 'popup']) {
    const pressed = await ev(pressRollDamages(where));
    if (!pressed.id) { check(false, `pressed on the ${where}'s copy`, `no damage card (copies of the button: ${pressed.copies})`); continue; }
    res = await ev(applyCritical(pressed.id, 'dummy'));
    check(/19 damage.*100 -> 81/.test(res) && pressed.cards === 1, `pressed on the ${where}'s copy: one damage card, with the critical`, `${res} (${pressed.cards} card, ${pressed.copies} copies of the button)`);
    await ev(reset('dummy'));
  }
  /* The dice in a description are bound the same way as the button */
  const spot = await ev(`(async () => {
    const k = window.__b20; const before = k.last()?.id;
    k.dice(false); k.roll(k.attack(${Q(HERO)}, { description: 'Burns for 2d6 fire.' })); const m = await k.next(before); await k.sleep(2200);
    const spots = k.copies(m.id).flatMap(c => [...c.querySelectorAll('.ct-beyond20-custom-roll')]);
    const chosen = spots.find(el => el.closest('#chat-notifications'));
    if (!chosen) { k.honest(); return { spots: spots.length, cards: 0 }; }
    const asked = k.last()?.id;
    const count = game.messages.size;
    chosen.querySelector('strong').click();
    await k.next(asked); await k.sleep(1500); k.honest();
    return { spots: spots.length, cards: game.messages.size - count };
  })()`);
  check(spot.cards === 1, 'the dice in a description, pressed on the popup\'s copy: one roll', `${spot.cards} card, ${spot.spots} copies of the dice`);
  const dead = await ev(`(async () => {
    const k = window.__b20;
    const m = game.messages.contents.findLast(x => x.content.includes('beyond20-button-roll-damages'));
    const log = ui.chat.element.querySelector('.chat-log .chat-message[data-message-id="' + m.id + '"]');
    /* What a reload leaves: the same card, drawn anew, with no Beyond20 behind it */
    const button = log.querySelector('.beyond20-button-roll-damages');
    $(button).off('click');
    k.said.length = 0;
    const before = k.last()?.id;
    button.click();
    await k.sleep(1000);
    return { said: k.said.slice(), rolled: k.last()?.id !== before };
  })()`);
  check(!dead.rolled && dead.said.some(s => /Roll it again from D&D Beyond/.test(s)), 'a card drawn anew: says so, rolls nothing', dead.said.join(' / ') || 'nothing said');
  await ev(`(async () => { canvas.tokens.releaseAll(); ui.sidebar.expand(); return 'ok'; })()`);

  /* A player, in their own browser: the roll is theirs, the tracker the GM's to fill */
  console.log('a player, on another client, with the GM connected');
  player = await openBrowser({ port: 9446, width: 1600, height: 1000 });
  if (!await enter(player, playerId)) throw new Error('the player never got in');
  await player.sleep(4000);
  const pv = await load(player);
  await pv(`(async () => { document.querySelectorAll('.application.dialog, dialog.application').forEach(el => el.remove()); return 'ok'; })()`);
  await player.sleep(1000);
  const playerRoll = (args, wait = 3200) => pv(`(async () => {
    const k = window.__b20; const before = k.last()?.id;
    k.said.length = 0;
    k.dice(false); k.roll(k.initiative(${args})); await k.next(before); k.honest();
    await k.sleep(${wait});
    return 'ok';
  })()`);
  const playerScene = async (label, args, want) => {
    await ev(clear);
    await playerRoll(args);
    const got = await ev(tracker);
    const own = (await pv(SAID)).filter(s => /Cannot add initiative/.test(s));
    check(got === want && !own.length, label, `tracker: ${got || '(empty)'}${own.length ? ' | the player was told: ' + own[0] : ''}`);
  };
  await playerScene('the exact name, nothing selected', Q(HERO), HERO);
  await playerScene('a short name, no character assigned', Q(SHORT), HERO);
  await playerScene('a name nobody has, no character assigned: nobody added', Q('Nobody At All'), '');
  const told = await ev(SAID);
  check(told.some(s => /Nobody At All/.test(s)), 'and the GM is told', told.join(' / ') || 'nothing said');
  await ev(`(async () => { await window.__b20.u.update({ character: window.__b20.hero.id }); return 'ok'; })()`);
  await player.sleep(800);
  await playerScene('a name of its own on D&D Beyond: the character assigned to the player', Q('The Ragin Cajun'), HERO);
  await pv(`(async () => { canvas.tokens.placeables.find(t => t.actor?.name === ${Q(HERO)}).control({ releaseOthers: true }); await new Promise(r => setTimeout(r, 300)); return 'ok'; })()`);
  await playerScene('their token selected: there once, whoever gets there first', Q(HERO), HERO);
  await pv(`(async () => { canvas.tokens.releaseAll(); return 'ok'; })()`);
  await ev(`(async () => { await window.__b20.combat.delete(); window.__b20.combat = null; return 'ok'; })()`);
  await player.sleep(800);
  await playerRoll(Q(HERO));
  const byPlayer = await ev(`(async () => {
    const k = window.__b20;
    k.combat = game.combats.find(c => c.scene?.id === canvas.scene.id && c.active) ?? null;
    return k.combat ? k.combat.combatants.map(x => x.name).join(', ') : '(none)';
  })()`);
  check(byPlayer === HERO, 'no encounter: the GM\'s client starts it for the player', byPlayer);

  console.log('a player\'s natural 20, on their own character');
  const playerCrit = await pv(`(async () => {
    const k = window.__b20; const before = k.last()?.id;
    const hero = game.actors.getName(${Q(HERO)});
    k.dice(true); k.roll(k.attack(${Q(HERO)})); const m = await k.next(before); await k.sleep(600); k.honest();
    await k.sleep(1500);
    const btn = k.copies(m.id).flatMap(c => [...c.querySelectorAll('[data-tooltip]')]).find(n => /critical hit/i.test(n.dataset.tooltip));
    if (!btn) return 'no button';
    const was = hero.system.attributes.hp.value;
    btn.click();
    await k.sleep(1500);
    return btn.dataset.tooltip + ': HP ' + was + ' -> ' + hero.system.attributes.hp.value;
  })()`);
  check(/19 damage.*100 -> 81/.test(playerCrit), 'the button on the card', playerCrit);
} catch (err) {
  failures++;
  console.log('FAILED', err.message);
}

/* Leave the copy as it was */
try {
  await gm.evaluate(`(async () => {
    const k = window.__b20;
    k?.honest?.();
    await game.settings.set('a5e-mancer', 'beyond20Initiative', true);
    for (const c of [...game.combats]) { try { await c.delete(); } catch {} }
    for (const t of [k?.t1, k?.t2]) { try { await t?.delete(); } catch {} }
    if (k?.stray) await game.user.update({ character: null });
    for (const a of [k?.hero, k?.dummy, k?.stray]) { try { await a?.delete(); } catch {} }
    try { await k?.u?.delete(); } catch {}
    return 'ok';
  })()`);
} catch {}
const bad = [...gm.console, ...(player?.console ?? [])].filter(l => /^\[(error|exception)\]/.test(l)
  && !/renderChatMessageHTML|Invalid Asset|'filters'|unmount is not a function|You must select a spell book|'bars'/.test(l));
if (bad.length) console.log(`console: ${bad.length} other errors`);
for (const l of bad.slice(0, 6)) console.log('  ' + l.slice(0, 300).replace(/\n/g, ' | '));
try { await player?.close(); } catch {}
try { await gm.close(); } catch {}
console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
