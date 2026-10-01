/**
 * The module's stylesheets, loaded fresh for each version of it.
 *
 * Foundry imports a module's styles by their bare path - `@import
 * "modules/a5e-mancer/styles/tidy-a5e.css" layer(modules)` - the same URL
 * whatever the version. Foundry's own server answers it with `no-cache`, so a
 * browser asks again on every load; a host in front of it need not. On the
 * Forge, 2.80.0 reached a player as the new templates over 2.79.0's
 * tidy-a5e.css: the death-save panel, always in the markup now and hidden by
 * a rule the old stylesheet does not have, sat under every portrait as three
 * skulls, and dropping to 0 hit points did nothing. A plain reload kept the
 * old copy; only Ctrl+F5 let it go. The notes pane that vanished on one laptop
 * and not on the other was most likely the same.
 *
 * So at init each of our import rules is swapped, in place, for the same file
 * with `?v=<version>` on it. A new version is a new URL, which no cache holds.
 * Same rule position, same layer - the cascade is the one Foundry built - only
 * the copy is current. The first load of a version also fetches each file
 * with `cache: 'reload'` before swapping, so a host that redirects to the
 * query-less file has that copy refreshed too, and the swap itself is served
 * from the cache with no gap in between.
 *
 * Scripts and templates cannot be swapped like this; they come from the same
 * hosts, but a stale stylesheet under fresh markup is the case that was seen.
 */

const MODULE_ID = 'a5e-mancer';
const SEEN_KEY = `${MODULE_ID}.freshStyles`;

export class FreshStyles {

  static async install() {
    const mod = game.modules.get(MODULE_ID);
    const version = mod?.version;
    if (!version) return;

    // module.json's paths, as they end every href Foundry writes for them:
    // "styles/tidy-a5e.css", "tidy/quadrone.css"
    const prefix = `modules/${MODULE_ID}/`;
    const ours = [...(mod.styles ?? [])]
      .map((s) => String(s?.src ?? s ?? ''))
      .map((src) => (src.startsWith(prefix) ? src.slice(prefix.length) : src))
      .filter(Boolean);
    if (!ours.length) return;

    const found = [];
    for (const el of document.querySelectorAll('style')) {
      let rules;
      try { rules = el.sheet?.cssRules; } catch { continue; }
      if (!rules) continue;
      for (const rule of rules) {
        if (!(rule instanceof CSSImportRule)) continue;
        const href = rule.href ?? '';
        const bare = href.split(/[?#]/)[0];
        if (!bare.includes(`${MODULE_ID}/`)) continue;
        if (!ours.some((tail) => bare.endsWith(`/${tail}`) || bare === tail)) continue;
        // Already versioned: our own swap, or a host that puts the version in the path
        if (/[?&]v=/.test(href) || bare.includes(`/${version}/`)) continue;
        found.push({ sheet: el.sheet, rule, href });
      }
    }
    if (!found.length) return;

    const fresh = (href) => `${href}${href.includes('?') ? '&' : '?'}v=${encodeURIComponent(version)}`;

    let firstOfVersion = true;
    try { firstOfVersion = localStorage.getItem(SEEN_KEY) !== version; } catch { /* storage blocked */ }
    if (firstOfVersion) {
      await Promise.all(found.map(({ href }) =>
        fetch(fresh(href), { cache: 'reload', mode: 'no-cors', credentials: 'same-origin' }).catch(() => null)));
      try { localStorage.setItem(SEEN_KEY, version); } catch { /* storage blocked */ }
    }

    let swapped = 0;
    for (const { sheet, rule, href } of found) {
      const index = [...sheet.cssRules].indexOf(rule);
      if (index < 0) continue;
      // null: no layer; '': the anonymous one. A browser without layerName gets
      // the layer Foundry gives module styles.
      const layer = rule.layerName === undefined ? 'modules' : rule.layerName;
      const layerText = layer === null ? '' : (layer === '' ? ' layer' : ` layer(${layer})`);
      const media = rule.media?.mediaText ? ` ${rule.media.mediaText}` : '';
      try {
        sheet.insertRule(`@import url(${JSON.stringify(fresh(href))})${layerText}${media};`, index);
        sheet.deleteRule(index + 1);
        swapped++;
      } catch (err) {
        console.warn(`${MODULE_ID} | could not reload ${href}:`, err);
      }
    }
    if (swapped) console.log(`${MODULE_ID} | stylesheets loaded for ${version}${firstOfVersion ? ' (first load of this version)' : ''}`);
  }
}
