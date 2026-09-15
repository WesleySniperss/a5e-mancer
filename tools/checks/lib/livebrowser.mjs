/* The sheet's own JavaScript, running in a real browser, on a real DOM.
 *
 * lib/browser.mjs lays out markup the harness rendered; no script of the sheet
 * runs there. lib/sheetdom.mjs runs the sheet's script against a DOM of our
 * own. Neither can see a listener that a real browser refuses to bind, or a
 * real click that never reaches its handler — and "the stars do not spend",
 * "the boxes will not come off" kept being reported while both said all was
 * well.
 *
 * So this serves the module over HTTP to headless Edge, loads the real
 * A5eCharacterSheet with the same Foundry stand-ins the other checks use,
 * inserts the rendered sheet into the window Foundry would, calls
 * activateListeners with a jQuery-shaped wrapper as Foundry v1 does, and runs
 * a probe that may dispatch real pointer events. The actor records every
 * update it is sent.
 */
import http from 'http';
import { spawn } from 'child_process';
import { existsSync, mkdtempSync, readFileSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { extname, join, normalize } from 'path';
import { R } from './sheetdom.mjs';
import { EDGE, CORE } from './browser.mjs';

const DATA = [R.replace(/modules\/a5e-mancer\/$/, ''), 'c:/Users/Jonkm/AppData/Local/FoundryVTT/Data/']
  .find((d) => existsSync(d + 'systems/a5e/a5e.css'));
const MIME = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.html': 'text/html', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.png': 'image/png',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.hbs': 'text/plain' };

/* The globals sheetdom.mjs sets beside stubs.mjs, for the browser. */
const BOOT = `
globalThis.CONFIG = { A5E: { itemRarity:{}, bonusTypes:{abilities:'a'}, bonusLabels:{},
  skills:{}, abilities:{}, conditions:{}, actorSizes:{}, creatureTypes:{},
  terrainTypes:{}, languages:{}, damageTypes:{}, filters:{objects:{}},
  ROLL_MODE:{ PUBLIC:'publicroll' }, reducerSortMap:{ object:{ weapon:0, armor:1,
    shield:2, ammunition:3, container:4, consumable:5, tool:6, jewelry:7,
    clothing:8, miscellaneous:9 } }, classes:{}, spellLevels:{}, objectTypesPlural:{} } };
globalThis.game = { user:{isGM:true, id:'u1'}, packs:new Collection(),
  modules:new Collection(), i18n:{localize:(k)=>k, format:(k)=>k, has:()=>false},
  settings:{get:()=>{throw new Error('x');}, register(){}},
  a5e:{utils:{getDeterministicBonus:(f)=>Number(f)||0}}, system:{id:'a5e'} };
globalThis.fromUuidSync = () => null;
globalThis.fromUuid = async () => null;
globalThis.TextEditor = { enrichHTML: async (h) => h };
globalThis.Hooks = globalThis.Hooks ?? { on(){}, once(){}, callAll(){}, call(){ return true; }, off(){} };
`;

/**
 * @param {object} o
 * @param {string} o.html        the rendered sheet
 * @param {object} o.actorData   { actor, items } as world-chars.json holds them
 * @param {string[]} o.rootClasses
 * @param {Function} o.probe     async (doc, { sheet, actor, writes, bindError }) => JSON-able
 * @param {object} [o.patch]     plain values merged onto actor.system / actor.flags before binding
 */
export async function liveSheet({ html, actorData, rootClasses, probe, width = 820, height = 860, patch = {} }) {
  if (!EDGE || !CORE) throw new Error('needs Edge and Foundry\u2019s public folder');
  const mod = JSON.parse(readFileSync(R + 'module.json', 'utf8'));
  const sheets = ['/__core/css/foundry2.css', '/__core/fonts/fontawesome/css/all.min.css',
    '/systems/a5e/a5e.css', ...(mod.styles ?? []).map((s) => `/modules/a5e-mancer/${s}`)];

  const page = `<!doctype html><html><head><meta charset="utf-8">
${sheets.map((h) => `<link rel="stylesheet" href="${h}">`).join('\n')}
</head><body class="vtt game system-a5e theme-dark">
<div class="${['app', 'window-app', ...(rootClasses ?? [])].join(' ')}" style="position:absolute;left:8px;top:8px;width:${width}px;height:${height}px">
  <header class="window-header flexrow draggable resizable"><h4 class="window-title">live</h4></header>
  <section class="window-content">${html}</section>
</div>
<pre id="am-live-out" style="display:none"></pre>
<script type="module">
  const out = document.getElementById('am-live-out');
  const done = (v) => { out.textContent = JSON.stringify(v); out.dataset.done = '1'; };
  try {
    await import('/modules/a5e-mancer/tools/checks/stubs.mjs');
    await import('/__boot.js');
    const { A5eCharacterSheet } = await import('/modules/a5e-mancer/scripts/app/A5eCharacterSheet.js');
    const data = await (await fetch('/__actor.json')).json();
    const patch = await (await fetch('/__patch.json')).json();
    const writes = [];
    const raw = data.actor;
    const wrap = (i) => {
      const it = { id: i._id, uuid: 'Actor.' + raw._id + '.Item.' + i._id, name: i.name, type: i.type,
        img: i.img, system: structuredClone(i.system ?? {}), flags: i.flags ?? {},
        effects: new Collection(), actions: new Collection(Object.entries(i.system?.actions ?? {})),
        getFlag: () => undefined, _stats: {}, parent: null,
        toObject: () => ({ ...i }), toDragData: () => ({ type: 'Item', uuid: it.uuid }) };
      it.update = async (d) => { writes.push({ item: it.id, ...d }); return it; };
      return it;
    };
    const actor = {
      id: raw._id, uuid: 'Actor.' + raw._id, name: raw.name, type: raw.type, isOwner: true, img: 'p.png',
      flags: structuredClone(raw.flags ?? {}), system: structuredClone(raw.system),
      items: new Collection(data.items.map((i) => [i._id, wrap(i)])),
      effects: new Collection(), statuses: new Set(),
      getFlag: (s, k) => actor.flags?.[s]?.[k],
      setFlag: async (s, k, v) => { writes.push({ ['flags.' + s + '.' + k]: v }); return actor; },
      update: async (d) => { writes.push(d); return actor; },
      createEmbeddedDocuments: async () => [], updateEmbeddedDocuments: async (t, rows) => { writes.push({ embedded: rows }); return rows; },
      getRollData: () => ({}), spellBooks: { first: () => null, values: () => [], get: () => null }
    };
    Object.assign(actor.system, patch.system ?? {});
    Object.assign(actor.flags, patch.flags ?? {});
    const sheet = new A5eCharacterSheet(actor);
    sheet._actor = actor;
    sheet.render = () => {};
    const form = document.querySelector('.window-content > form') ?? document.querySelector('.window-content').firstElementChild;
    let bindError = null;
    try { sheet.activateListeners({ jquery: '3.7.1', 0: form, length: 1 }); }
    catch (e) { bindError = String(e && e.stack || e); }
    const result = await (${probe.toString()})(document, { sheet, actor, writes, bindError });
    done({ bindError, result });
  } catch (e) {
    done({ fatal: String(e && e.stack || e) });
  }
</script>
</body></html>`;

  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0]);
    const send = (code, type, body) => { res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' }); res.end(body); };
    if (url === '/' || url === '/page.html') return send(200, 'text/html', page);
    if (url === '/__boot.js') return send(200, 'text/javascript', BOOT);
    if (url === '/__actor.json') return send(200, 'application/json', JSON.stringify(actorData));
    if (url === '/__patch.json') return send(200, 'application/json', JSON.stringify(patch));
    let file;
    if (url.startsWith('/__core/')) file = join(CORE, url.slice('/__core/'.length));
    else if (url.startsWith('/modules/a5e-mancer/')) file = join(R, url.slice('/modules/a5e-mancer/'.length));
    else file = join(DATA, url.slice(1));
    file = normalize(file);
    if (!existsSync(file) || !statSync(file).isFile()) return send(404, 'text/plain', 'not found');
    send(200, MIME[extname(file)] ?? 'application/octet-stream', readFileSync(file));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  const dir = mkdtempSync(join(tmpdir(), 'am-live-'));
  const dom = await new Promise((resolve, reject) => {
    const child = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run',
      `--user-data-dir=${join(dir, 'profile')}`, `--window-size=${width + 16},${height + 16}`,
      '--virtual-time-budget=15000', '--dump-dom', `http://127.0.0.1:${port}/page.html`]);
    let stdout = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.on('error', reject);
    child.on('close', () => resolve(stdout));
    setTimeout(() => child.kill(), 120000);
  });
  server.close();

  const m = dom.match(/<pre id="am-live-out"[^>]*>([\s\S]*?)<\/pre>/);
  if (!m || !m[1]) throw new Error('the live page never reported — the module did not finish loading');
  const text = m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  const out = JSON.parse(text);
  if (out.fatal) throw new Error('the live page failed: ' + out.fatal);
  return out;
}
