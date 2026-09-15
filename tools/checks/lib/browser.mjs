/* The sheet, in a real browser, with the real stylesheets.
 *
 * Every other check reads the markup through a DOM of our own, which knows
 * what an element is and nothing about where it lands. That is enough to say
 * a button exists and what its handler writes. It cannot say whether the
 * button is four pixels wide, whether the column beside it is drawn over it,
 * or whether a click at its centre reaches it at all — and those are exactly
 * the reports that kept coming back after checks said all was well.
 *
 * So this lays the rendered sheet out in headless Edge, inside the window
 * Foundry wraps a v1 sheet in, under Foundry's own stylesheet, a5e's, and this
 * module's in the order module.json loads them. A probe function runs in the
 * page once fonts have settled and returns plain JSON.
 *
 * What it is not: Foundry. No JavaScript of Foundry's or of the sheet runs, so
 * anything a listener does to the layout (the ability-box width classes, tab
 * switching) the probe must do itself, and says so where it does.
 */
import { execFileSync } from 'child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { R } from './sheetdom.mjs';

export const EDGE = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe'
].find((p) => existsSync(p));

/* Foundry's own public folder, for foundry2.css and Font Awesome. Read from
   the server's log rather than written in, since it moves with the install. */
/* Foundry's Data folder, for systems/a5e/a5e.css. Derived from where the
   module sits; a copy of the module elsewhere (a checkout of one commit, say)
   falls back to the real install, or a5e's stylesheet silently fails to load
   and every one of its colours reads as transparent. */
const DATA = [R.replace(/modules\/a5e-mancer\/$/, ''), 'c:/Users/Jonkm/AppData/Local/FoundryVTT/Data/']
  .find((d) => existsSync(d + 'systems/a5e/a5e.css')) ?? R.replace(/modules\/a5e-mancer\/$/, '');
export const CORE = (() => {
  const logs = join(DATA, '..', 'Logs');
  const guesses = ['D:/Games/FVTT/Foundry Virtual Tabletop/resources/app/public/'];
  try {
    for (const f of readdirSync(logs).filter((f) => f.endsWith('.log'))) {
      const m = readFileSync(join(logs, f), 'utf8').match(/file:\/\/\/([^"\s]*?)\/resources\/app\//);
      if (m) guesses.unshift(decodeURIComponent(m[1]) + '/resources/app/public/');
    }
  } catch { /* the guess stands */ }
  return guesses.find((g) => existsSync(g + 'css/foundry2.css')) ?? null;
})();

const fileUrl = (p) => 'file:///' + p.replace(/\\/g, '/').replace(/^\/+/, '');

/**
 * @param {object} o
 * @param {string} o.html        the sheet's rendered template
 * @param {Function} o.probe     (document) => JSON-able; runs after fonts load
 * @param {number} [o.width]     the window's width, as Foundry would size it
 * @param {number} [o.height]
 * @param {string[]} [o.rootClasses]  the sheet's classes, from defaultOptions
 */
export function inBrowser({ html, probe, width = 820, height = 860, rootClasses, screenshot }) {
  if (!EDGE) throw new Error('no Edge found — this check needs a real browser');
  if (!CORE) throw new Error('Foundry\u2019s public folder not found — foundry2.css is needed');

  const mod = JSON.parse(readFileSync(R + 'module.json', 'utf8'));
  const sheets = [
    fileUrl(CORE + 'css/foundry2.css'),
    fileUrl(CORE + 'fonts/fontawesome/css/all.min.css'),
    fileUrl(DATA + 'systems/a5e/a5e.css'),
    ...(mod.styles ?? []).map((s) => fileUrl(R + s))
  ];
  const classes = ['app', 'window-app', ...(rootClasses ?? [])].join(' ');

  const page = `<!doctype html><html><head><meta charset="utf-8">
<base href="${fileUrl(DATA)}">
${sheets.map((h) => `<link rel="stylesheet" href="${h}">`).join('\n')}
</head><body class="vtt game system-a5e theme-dark" style="overflow:auto">
<div class="${classes}" style="position:absolute;left:8px;top:8px;width:${width}px;height:${height}px">
  <header class="window-header flexrow draggable resizable"><h4 class="window-title">probe</h4></header>
  <section class="window-content">${html}</section>
</div>
<pre id="am-probe-out" style="display:none"></pre>
<script>
  document.fonts.ready.then(() => {
    let out;
    try { out = (${probe.toString()})(document); }
    catch (e) { out = { error: String(e && e.stack || e) }; }
    document.getElementById('am-probe-out').textContent = JSON.stringify(out);
  });
</script>
</body></html>`;

  const dir = mkdtempSync(join(tmpdir(), 'am-browser-'));
  const file = join(dir, 'sheet.html');
  writeFileSync(file, page);
  const edge = (extra) => execFileSync(EDGE, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--allow-file-access-from-files',
    `--user-data-dir=${join(dir, 'profile')}`, `--window-size=${width + 16},${height + 16}`,
    '--hide-scrollbars', '--virtual-time-budget=4000', ...extra, fileUrl(file)
  ], { maxBuffer: 64 * 1024 * 1024, timeout: 90000, stdio: ['ignore', 'pipe', 'ignore'] }).toString();

  /* A picture, for a person to look at: the probe still runs first, so
     whatever it sets up (the open tab) is what is photographed. */
  if (screenshot) edge([`--screenshot=${screenshot}`]);
  const dom = edge(['--dump-dom']);

  const m = dom.match(/<pre id="am-probe-out"[^>]*>([\s\S]*?)<\/pre>/);
  if (!m || !m[1]) throw new Error('the probe never reported — the page did not finish loading');
  const text = m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
  const out = JSON.parse(text);
  if (out?.error) throw new Error('probe threw in the page: ' + out.error);
  return { out, file };
}
