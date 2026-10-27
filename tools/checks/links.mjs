/* Links in descriptions and drops on the sheet, in real Foundry.
 *
 * "Links to creatures and spells lead nowhere, in every description" and "why
 * can't I drag things from the compendium browser onto the sheet" (both
 * 2026-10-27). What has to hold:
 *
 *   - a link into a pack that is not there (a5e's 5e packs link the dnd5e
 *     system's: @Compendium[dnd5e.monsters...]{Clay Golem}) leads to the
 *     document of its name, of its kind - linkMend.js, namedDocs.js;
 *   - one that names a condition becomes a5e's condition; one nothing matches
 *     stays broken;
 *   - @creature[...] (5etools markup) links the creature;
 *   - a link kept in a text as HTML, without data-link, opens its document,
 *     and another module's link of that shape is left to it - documentLinks.js;
 *   - the panel under the cards keeps its text when the pointer leaves, and
 *     cards crossed on the way do not replace it - hoverPanel.js;
 *   - a drop on any part of the character sheet adds the item.
 *
 * With --packs it also enriches every description in a5e's Item packs and
 * prints the links still broken (some five minutes).
 *
 * Needs a Foundry serving a copy of the world (README, "live checks"); it
 * makes one test actor and deletes it.
 *
 *   node tools/checks/links.mjs [--url http://localhost:30011] [--user <id>] [--packs]
 */
import { openBrowser } from './lib/cdp.mjs';

const arg = (name, fallback) => {
  const i = process.argv.indexOf('--' + name);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const BASE = arg('url', 'http://localhost:30011');
const USER = arg('user', null);
const PACKS = process.argv.includes('--packs');

const b = await openBrowser({ port: 9352 });
const ev = (expr, ms = 600000) => Promise.race([b.evaluate(expr),
  new Promise((_, rej) => setTimeout(() => rej(new Error(`the page did not answer in ${ms / 1000}s`)), ms))]);

/* Runs in the page. Returns [name, ok, detail][] */
async function inPage(packs) {
  const results = [];
  const check = (name, ok, detail = '') => results.push([name, !!ok, detail]);
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const TE = foundry.applications.ux.TextEditor.implementation;
  const enrich = async (markup) => { const d = document.createElement('div'); d.innerHTML = await TE.enrichHTML(markup); return d; };
  const open = () => [...Object.values(ui.windows), ...(foundry.applications.instances?.values?.() ?? [])];
  const opened = async (el, init = {}) => {
    const before = new Set(open());
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...init }));
    let fresh = [];
    for (let i = 0; i < 20 && !fresh.length; i++) { await sleep(200); fresh = open().filter(w => !before.has(w) && w.rendered && w.document); }
    const names = fresh.map(w => w.document.name);
    for (const w of fresh) { try { await w.close(); } catch {} }
    return names;
  };
  const link = (div) => div.querySelector('a.content-link');
  const packOf = (a) => a?.dataset.uuid?.split('.').slice(1, 3).join('.');

  let a = link(await enrich('@Compendium[dnd5e.monsters.0123456789abcdef]{Clay Golem}'));
  check('a creature link into the dnd5e system leads to the creature', a && !a.classList.contains('broken') && a.dataset.type === 'Actor', packOf(a));
  a = link(await enrich('@Compendium[dnd5e.spells.0123456789abcdef]{Wish}'));
  check("a spell link into the dnd5e system leads to a5e's spell", packOf(a) === 'a5e.a5e-spells', packOf(a));
  a = link(await enrich('@Compendium[dnd5e.classfeatures.0123456789abcdef]{Agonizing Blast}'));
  check('a class feature link finds "Invocation: Agonizing Blast" in a class feature pack', /class-features$/.test(packOf(a) ?? ''),
    a ? `${packOf(a)} ${fromUuidSync(a.dataset.uuid)?.name}` : 'none');
  let d = await enrich('@UUID[Compendium.dnd5e.rules.JournalEntry.w7eitkpD7QQTB6j0.JournalEntryPage.UWw13ISmMxDzmwbd]{Poisoned}');
  check("a rules page link that names a condition becomes a5e's condition", d.querySelector('[data-enricher-type="condition"]')?.dataset.id === 'poisoned');
  a = link(await enrich('@UUID[Compendium.foo.bar.Item.0123456789abcdef]{Nothing Of This Name}'));
  check('a link nothing matches stays broken', a?.classList.contains('broken'));
  a = link(await enrich('@creature[lemure||lemures]'));
  check('@creature links the creature, a plural to its singular', a?.dataset.type === 'Actor' && a.textContent.trim() === 'lemures');
  a = link(await enrich('@spell[Fireball|XPHB]'));
  check("@spell links a5e's own spell first", packOf(a) === 'a5e.a5e-spells', packOf(a));

  const fb = (await game.packs.get('a5e.a5e-spells').getIndex()).find(e => e.name === 'Fireball');
  const host = document.createElement('div');
  document.body.appendChild(host);
  host.innerHTML = `<a class="content-link" draggable="true" data-uuid="Compendium.a5e.a5e-spells.Item.${fb._id}" data-type="Item"><i class="fas fa-suitcase"></i>Fireball</a>`;
  let names = await opened(host.querySelector('a'));
  check('a link kept as HTML, without data-link, opens its document', names.includes('Fireball'), names.join(', '));
  host.innerHTML = `<a class="content-link" data-cc-sheet-tab="true" data-uuid="Compendium.a5e.a5e-spells.Item.${fb._id}" data-tab="notes">tab</a>`;
  names = await opened(host.querySelector('a'));
  check("another module's link with data of its own is left to it", !names.length, names.join(', '));
  host.innerHTML = (await enrich('@Compendium[dnd5e.monsters.0123456789abcdef]{Clay Golem}')).innerHTML;
  names = await opened(host.querySelector('a'));
  check('a mended creature link opens the creature', names.includes('Clay Golem'), names.join(', '));
  host.remove();

  // the panel under the cards, with the timer run by hand
  const { HoverPanel } = await import('/modules/a5e-mancer/scripts/utils/hoverPanel.js');
  const box = document.createElement('div');
  box.innerHTML = `<div class="g"><button class="am-card" data-uuid="A"></button><button class="am-card" data-uuid="B"></button><button class="am-card" data-uuid="C"></button></div><div class="p">hint</div>`;
  document.body.appendChild(box);
  const grid = box.querySelector('.g'), panel = box.querySelector('.p');
  const realSet = window.setTimeout, realClear = window.clearTimeout;
  const pending = new Map(); let next = 1;
  window.setTimeout = (fn) => { const id = next++; pending.set(id, fn); return id; };
  window.clearTimeout = (id) => pending.delete(id);
  const elapse = () => { const fns = [...pending.values()]; pending.clear(); fns.forEach(f => f()); };
  try {
    const memory = {};
    const how = { keyOf: HoverPanel.uuidOf, htmlOf: (k) => `text ${k}`, memory, has: HoverPanel.holds(grid) };
    const off = HoverPanel.bind(grid, panel, how);
    const over = (k) => grid.querySelector(`[data-uuid="${k}"]`).dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    over('A'); await 0;
    check('the first card hovered shows at once', panel.textContent === 'text A', panel.textContent);
    over('B'); over('C'); grid.dispatchEvent(new MouseEvent('mouseleave')); elapse(); await 0;
    check('cards crossed on the way out, and leaving, keep the text', panel.textContent === 'text A', panel.textContent);
    over('C'); elapse(); await 0;
    check('a card the pointer rests on takes the panel', panel.textContent === 'text C', panel.textContent);
    off();
    panel.textContent = 'hint';
    HoverPanel.bind(grid, panel, how); await 0;
    check('the card shown comes back when the window draws again', panel.textContent === 'text C', panel.textContent);
  } finally { window.setTimeout = realSet; window.clearTimeout = realClear; box.remove(); }

  // drops on every part of the character sheet
  const actor = await Actor.create({ name: 'AM links check', type: 'character' });
  try {
    const key = Object.keys(CONFIG.Actor.sheetClasses.character).find(k => k.startsWith('a5e.A5e'));
    const sheet = new (CONFIG.Actor.sheetClasses.character[key].cls)(actor);
    await sheet.render(true);
    for (let i = 0; i < 100 && !sheet.rendered; i++) await sleep(150);
    await sleep(1500);
    const mh = (await game.packs.get('a5e.a5e-spells').getIndex()).find(e => e.name === 'Mage Hand');
    const payload = JSON.stringify({ type: 'Item', uuid: `Compendium.a5e.a5e-spells.Item.${mh._id}` });
    for (const [where, sel] of [['the portrait and name', '.sheet-header-content'], ['the trackers', '.am-tracker-row'], ['the tab strip', '.tabs-row'], ['a tab', '.main-content']]) {
      const el = sheet.element[0].querySelector(sel);
      const n = actor.items.size;
      const dt = new DataTransfer(); dt.setData('text/plain', payload);
      for (const type of ['dragenter', 'dragover', 'drop']) el?.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
      for (let i = 0; i < 20 && actor.items.size === n; i++) await sleep(200);
      check(`a spell dropped on ${where} is added`, actor.items.size > n);
    }
    await sheet.close();
  } finally { await actor.delete(); }

  if (packs) {
    let total = 0, broken = 0;
    const left = new Map();
    for (const pack of game.packs.filter(p => p.metadata.packageName === 'a5e' && p.documentName === 'Item')) {
      for (const doc of await pack.getDocuments()) {
        const html = doc.system?.description;
        if (!html?.includes('@')) continue;
        const div = document.createElement('div');
        div.innerHTML = await TE.enrichHTML(html, { relativeTo: doc });
        for (const x of div.querySelectorAll('a.content-link')) {
          total++;
          if (x.classList.contains('broken')) { broken++; left.set(x.textContent.trim(), `${pack.metadata.name}:${doc.name}`); }
        }
      }
    }
    results.push([`a5e's Item packs: ${total} links, ${broken} still broken: ${[...left].map(([k, w]) => `${k} (${w})`).join(', ')}`, true, '']);
  }
  return results;
}

let results = [];
try {
  await b.send('Page.navigate', { url: BASE + '/join' });
  await b.sleep(2500);
  const user = USER ?? await b.evaluate(`(() => document.querySelector('select[name="userid"] option[value]:not([value=""])')?.value ?? null)()`);
  if (!user) throw new Error('no user to join as — pass --user <id>');
  await b.evaluate(`fetch('/join', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'join', userId: ${JSON.stringify(user)}, password: '' }) }).then(r => r.status)`);
  await b.evaluate("localStorage.setItem('core.noCanvas', 'true')");
  await b.send('Page.navigate', { url: BASE + '/game' });
  let ready = false;
  for (let i = 0; i < 150 && !ready; i++) { await b.sleep(1000); try { ready = await b.evaluate('!!(window.game && game.ready)'); } catch {} }
  if (!ready) throw new Error('the world never came up');
  for (let i = 0; i < 180; i++) { if (await ev('!!globalThis.a5eMancer')) break; await b.sleep(1000); }
  await b.sleep(3000);
  results = await ev(`(${inPage.toString()})(${PACKS})`, PACKS ? 1200000 : 300000);
} catch (err) {
  results.push([`the check could not run: ${err.message}`, false, '']);
} finally {
  await b.close();
}
for (const [name, ok, detail] of results) console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? `   (${detail})` : ''}`);
const failed = results.filter(r => !r[1]).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
