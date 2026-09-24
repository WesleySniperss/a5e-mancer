/* Your Flavor's Foundry-overlay chat texture, carried past the cascade layers:
 * when the bridge judges the texture live, and the value it hands the CSS.
 *
 * Both are read off the page Your Flavor builds, so the page is stubbed as it
 * builds it: its body class, its saved <style> and the preview one (the saved one
 * disabled while the editor previews), a texture rule whose selector is real or
 * - with the chat area switched off - one that matches nothing, and the texture
 * variable declared on the body with a URL relative to the page.
 *
 * Found live (tools/checks/README.md, "yftexture.mjs"): with the overlay on, the
 * texture never reached a message, and the first fix drew it from
 * /systems/a5e/ui/parchment.jpg and /modules/a5e-mancer/styles/ui/parchment.jpg.
 */
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const R = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const TEXTURE = 'linear-gradient(0deg, rgba(61, 43, 31, 0.6), rgba(61, 43, 31, 0.6)), url("ui/parchment.jpg")';
const RULE = (selector) => `\n${selector} {\n    background-image: var(--yf-foundry-chat-texture) !important;\n    background-repeat: repeat !important;\n}\n`;
const LIVE = RULE('body.yf-foundry-customized #chat-log .chat-message,\nbody.yf-foundry-customized .chat-message');
const NEVER = RULE('body.yf-foundry-customized .yf-never-match');

const styles = new Map();
const bodyClasses = new Set();
const bodyVars = new Map();
let declared = TEXTURE;
const style = (id, text, disabled = false) => styles.set(id, { id, textContent: text, disabled });

globalThis.document = {
  baseURI: 'http://localhost:30000/game',
  head: {},
  body: {
    classList: {
      contains: (c) => bodyClasses.has(c),
      toggle: (c, on) => (on ? bodyClasses.add(c) : bodyClasses.delete(c)),
      remove: (c) => bodyClasses.delete(c)
    },
    style: { setProperty: (k, v) => bodyVars.set(k, v), removeProperty: (k) => bodyVars.delete(k) }
  },
  getElementById: (id) => styles.get(id) ?? null
};
globalThis.getComputedStyle = () => ({ getPropertyValue: (k) => (k === '--yf-foundry-chat-texture' ? ` ${declared}` : '') });
globalThis.game = { settings: { get: () => undefined }, modules: { get: () => undefined } };
globalThis.Hooks = { on() { return 0; }, off() {} };

const { YourFlavorService: S } = await import(pathToFileURL(path.join(R, 'scripts/utils/yourFlavorService.js')).href);

const results = [];
const check = (n, ok, d = '') => results.push(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`);
const reset = () => { styles.clear(); bodyClasses.clear(); declared = TEXTURE; };

/* when the texture is live */
reset(); style('your-flavor-foundry-customization', LIVE);
check('overlay off (no body class): not live, whatever the <style> holds', !S._chatTextureLive());
bodyClasses.add('yf-foundry-customized');
check('overlay on with its texture rule: live', S._chatTextureLive());
style('your-flavor-foundry-customization', NEVER);
check('chat area switched off - the rule matches nothing: not live', !S._chatTextureLive());
style('your-flavor-foundry-customization', RULE('body.yf-foundry-customized #sidebar'));
check('a texture rule for something other than chat messages: not live', !S._chatTextureLive());
style('your-flavor-foundry-customization', LIVE, true);
style('your-flavor-foundry-customization-preview', NEVER);
check('previewing a look without the texture: the saved one is disabled, so not live', !S._chatTextureLive());
style('your-flavor-foundry-customization-preview', LIVE);
check('previewing a look with it: live', S._chatTextureLive());
styles.delete('your-flavor-foundry-customization-preview');
check('preview removed, saved style still disabled: not live', !S._chatTextureLive());
style('your-flavor-foundry-customization', '');
check('emptied <style> (Your Flavor cleared its customization): not live', !S._chatTextureLive());

/* the value handed to the CSS */
reset();
check('the page-relative parchment URL is made absolute against the page',
  S._chatTexture() === 'linear-gradient(0deg, rgba(61, 43, 31, 0.6), rgba(61, 43, 31, 0.6)), url("http://localhost:30000/ui/parchment.jpg")', S._chatTexture());
document.baseURI = 'https://example.org/vtt/game';
check('behind a route prefix, the prefix is kept', /url\("https:\/\/example\.org\/vtt\/ui\/parchment\.jpg"\)$/.test(S._chatTexture()), S._chatTexture());
declared = "url(icons/a.png), url('https://cdn.example/b.webp'), url(data:image/png;base64,AAAA)";
check('unquoted, single-quoted, absolute and data: URLs',
  S._chatTexture() === 'url("https://example.org/vtt/icons/a.png"), url("https://cdn.example/b.webp"), url("data:image/png;base64,AAAA")', S._chatTexture());
declared = '';
check('nothing declared: nothing handed on', S._chatTexture() === '');

console.log(results.join('\n'));
const fails = results.filter(x => x.startsWith('FAIL')).length;
console.log(`\n${results.length - fails}/${results.length} passed`);
process.exit(fails ? 1 : 0);
