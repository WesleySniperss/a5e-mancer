/**
 * Every script of this version, whatever the browser has kept.
 *
 * Foundry lists a module's scripts by their bare path, the same URL whatever
 * the version. Its own server answers with `no-cache`, so a browser asks again
 * on every load; the Forge does not, and a browser keeps a file it thinks is
 * still good - longer the longer the file went unchanged. So after an update
 * the files changed lately can arrive new and the others old. Templates come
 * over the socket and are always new; styles have freshStyles.js. Scripts were
 * the gap. 2.96.0 reached the user as a new a5e-mancer.js importing a name from
 * last version's livePatch.js: "does not provide an export named", at link
 * time, so no file of the module ran - no sheet, no numbers on the statuses,
 * nothing (2026-10-30). Reproduced exactly by putting that one old file back.
 *
 * This file imports nothing and is listed first, so it runs whatever state the
 * others are in. At the first load of a version it reads each script of the
 * module twice, as the browser holds it and as the server has it now, which
 * also puts the new copy in the browser's cache. If any differed, the scripts
 * this page is running are not all this version's: the page loads again, once,
 * usually before the world has come up. Any later load does one small request
 * for the version.
 *
 * And if the module still did not come up, the GM and the players are told so
 * on screen, with the browser's reason, instead of nothing at all.
 */

const MODULE_ID = 'a5e-mancer';
const SEEN_KEY = `${MODULE_ID}.freshScripts`;
const RELOADED_KEY = `${MODULE_ID}.freshScripts.reloaded`;

/** Every relative import of a script: a named one, a bare one, a dynamic one. */
const IMPORT = /(?:\bfrom\s*|\bimport\s*\(?\s*)['"`](\.{1,2}\/[^'"`\n]+?\.m?js)['"`]/g;

function read(area, key) {
  try { return globalThis[area].getItem(key); } catch { return null; }
}

function write(area, key, value) {
  try { globalThis[area].setItem(key, value); } catch { /* storage blocked */ }
}

/** The version the server has now. */
async function serverVersion() {
  try {
    const response = await fetch(new URL('../module.json', import.meta.url), { cache: 'reload' });
    return response.ok ? ((await response.json()).version ?? null) : null;
  } catch { return null; }
}

/**
 * One script, as the browser holds it and as the server has it. `force-cache`
 * answers with whatever copy is held, however old; `reload` goes to the server
 * and replaces that copy. Null when the server would not give it.
 */
async function readBoth(url) {
  try {
    const held = await fetch(url, { cache: 'force-cache' }).then((r) => (r.ok ? r.text() : null)).catch(() => null);
    const response = await fetch(url, { cache: 'reload' });
    if (!response.ok) return null;
    return { held, now: await response.text(), at: response.url || url };
  } catch { return null; }
}

/** Every script the module's entry points reach, followed as the browser follows them. */
async function walk() {
  const ours = [...document.querySelectorAll('script[type="module"][src]')]
    .map((el) => el.src).filter((src) => src.includes(`/${MODULE_ID}/`));
  let frontier = [...new Set([...ours, new URL('./a5e-mancer.js', import.meta.url).href])];
  const seen = new Set(frontier);
  const stale = [];
  let failed = 0;
  while (frontier.length) {
    const results = await Promise.all(frontier.map(readBoth));
    const next = [];
    results.forEach((result, i) => {
      if (!result) { failed++; return; }
      if (result.held !== null && result.held !== result.now) stale.push(frontier[i]);
      seen.add(result.at);
      for (const [, spec] of result.now.matchAll(IMPORT)) {
        const url = new URL(spec, result.at).href;
        if (!seen.has(url)) { seen.add(url); next.push(url); }
      }
    });
    frontier = next;
  }
  return { stale, failed, count: seen.size };
}

let started = false;

async function freshen(version) {
  if (started || !version || read('localStorage', SEEN_KEY) === version) return;
  started = true;
  const { stale, failed, count } = await walk();
  // A file the server would not give is looked for again next time
  if (!failed) write('localStorage', SEEN_KEY, version);
  if (!stale.length) return;
  console.warn(`${MODULE_ID} | ${stale.length} of ${count} scripts were an older version's:`, stale);
  // Once a session for a version, and only if that can be remembered: never a loop
  if (read('sessionStorage', RELOADED_KEY) === version) return;
  write('sessionStorage', RELOADED_KEY, version);
  if (read('sessionStorage', RELOADED_KEY) === version) location.reload();
}

/** The browser's reason, if a file of the module failed: a link error or a missing file. */
let failure = null;
function noteFailure(event) {
  const where = String(event.filename || event.target?.src || '');
  if (failure || !where.includes(`/${MODULE_ID}/`)) return;
  failure = event.message || `could not load ${where}`;
}

if (typeof document !== 'undefined' && typeof Hooks !== 'undefined') {
  window.addEventListener('error', noteFailure, true);
  serverVersion().then(freshen).catch(() => null);
  Hooks.once('init', () => {
    freshen(game.modules.get(MODULE_ID)?.version).catch(() => null);
  });
  Hooks.once('ready', () => {
    window.removeEventListener('error', noteFailure, true);
    const up = Object.keys(CONFIG.Actor?.sheetClasses?.character ?? {}).some((key) => key.endsWith('.A5eCharacterSheet'));
    if (up) return;
    try { localStorage.removeItem(SEEN_KEY); } catch { /* storage blocked */ }
    const why = failure ?? 'see the console (F12)';
    console.error(`${MODULE_ID} | The module did not load: ${why}`);
    ui.notifications?.error(`A5e Mancer did not load: ${why}. Clear this browser's cached files for the site and open the game again.`, { permanent: true });
  });
}
