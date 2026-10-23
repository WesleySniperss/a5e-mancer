import { AM } from '../am.js';
import { SITE_TEXT } from '../data/siteText.js';
import { applyEntry, norm } from './siteTextCore.js';

/**
 * Descriptions as a5e.tools has them.
 *
 * a5e.tools links a summoning spell's creatures to their stat blocks, and the
 * spells, items, maneuvers and conditions any text names; a5e's packs carry the
 * same text with almost none of those links. The packs also leave things out:
 * Control Weather's tables, the Bag of Tricks table, the Fellow Candlestick's
 * stat block, a Crystal Ball's three kinds, most backgrounds' opening lines and
 * some their connections and mementos. Reported 2026-10-13: "spells that
 * summon someone link the monsters' stat blocks on the site, here there is
 * nothing - and compare all the descriptions with the site".
 *
 * tools/import/build-site-text.cjs compares every entry with its page and
 * writes what to add as data (data/siteText.js); siteTextCore.js puts it in.
 * Here it is put into each item's prepared description, so the sheet, the chat
 * card, the item sheet and a compendium entry all show it - the stored text is
 * not changed. Links go to a5e's own documents (Conjure Fey's hag is a5e's
 * "Conjured Fey (Hag)"), or to the imported packs for what a5e lacks.
 *
 * Which entry an item is: by its own id (a compendium entry), the entry it was
 * made from, else its name; a name two entries share (a5e has two Soldier
 * backgrounds) goes to the one whose words the item's text holds.
 */
export class SiteText {

  /** entry id -> Map(description -> completed description), a few per entry */
  static #cache = new Map();
  static #failed = false;

  /**
   * The description as stored, without what this adds: for code that reads a
   * description for its rules - the spells a feature gives, a pack's contents,
   * a class's table, a background's lore tables - rather than showing it. The
   * links and blocks put in here are for reading; a table of beasts must not
   * become spells, nor a background's connections a second copy of a5e's.
   */
  static stored(doc) {
    const src = doc?._source?.system?.description;
    if (typeof src === 'string') return src;
    const d = doc?.system?.description;
    return typeof d === 'string' ? d : (d?.value ?? '');
  }

  static nameKey(item) {
    return `${item.type}|${String(item.name ?? '').toLowerCase().replace(/[’‘`]/g, "'").replace(/\s+/g, ' ').trim()}`;
  }

  /* Read once: it is asked for every item each time an actor is prepared, and
     game.settings.get is not free; the setting takes a reload anyway. */
  static #on = null;
  static enabled() {
    if (this.#on === null) {
      try { this.#on = game.settings.get(AM.ID, 'siteText') !== false; } catch { return true; }
    }
    return this.#on;
  }

  /** The entry an item is, or null. */
  static entryIdFor(item, html) {
    const entries = SITE_TEXT.entries;
    const source = item._stats?.compendiumSource ?? item.flags?.core?.sourceId;
    const sid = source ? String(source).split('.').pop() : null;
    if (sid && entries[sid]) return sid;
    if (item.id && entries[item.id]) return item.id;
    // made from a compendium entry the site adds nothing to: not another of that name
    if (String(source ?? '').startsWith('Compendium.')) return null;
    const ids = SITE_TEXT.names[this.nameKey(item)];
    if (!ids?.length) return null;
    if (ids.length === 1) return ids[0];
    const words = norm(html);
    const score = (id) => {
      const e = entries[id];
      return (e.links ?? []).filter(([w]) => words.includes(norm(w))).length
        + (e.add ?? []).filter(([a]) => a !== '^' && words.includes(a.slice(0, 30))).length;
    };
    /* A name several entries share (two Soldier backgrounds, an Extra Attack
       per class): the one whose words the text holds - none when no one's do. */
    const best = ids.reduce((b, id) => (score(id) > score(b) ? id : b), ids[0]);
    return score(best) > 0 ? best : null;
  }

  /**
   * a5e's own links that lead nowhere, sent where they meant to go: to the
   * paid modules its content came from (Bloody Heretics, Out of the Wilds),
   * which a5e's packs and a5e.tools hold too, or to a pack or ids a5e no longer
   * has. A link into a module that is installed is left alone - it works.
   * Reported 2026-10-14: "almost all of it is on that site, the paid modules
   * are another thing".
   */
  static relink(html) {
    if (!html.includes('@UUID[Compendium.')) return html;
    const map = SITE_TEXT.relink ?? {};
    return html.replace(/@UUID\[(Compendium\.[^\]]+)\](\{([^}]*)\})?/g, (m, uuid, braces, words) => {
      if (!(uuid in map)) return m;
      const [, scope, name] = uuid.split('.');
      if (scope !== 'a5e' && game.packs?.get(`${scope}.${name}`)) return m;
      /* A dead link a5e has since mended - the document is in its pack again -
         is a5e's own and goes where a5e meant. Only a link that resolves is
         left: one not found may be in a pack not indexed yet, and is sent on
         as before. */
      if (scope === 'a5e') {
        try { if (fromUuidSync(uuid)) return m; } catch { /* not indexed */ }
      }
      return map[uuid] ? `@UUID[${map[uuid]}]${braces ?? ''}` : (words ?? '');
    });
  }

  /** The item's prepared description, completed. */
  static apply(item) {
    const sys = item?.system;
    const html = sys?.description;
    if (typeof html !== 'string' || !html.trim()) return;
    const id = this.entryIdFor(item, html);
    if (!id) {
      const fixed = this.relink(html);
      if (fixed !== html) sys.description = fixed;
      return;
    }
    let byText = this.#cache.get(id);
    if (!byText) this.#cache.set(id, byText = new Map());
    // Before the packs are indexed relink cannot tell a mended link: worked out again after
    const key = `${game.ready ? 1 : 0}|${html}`;
    let out = byText.get(key);
    if (out === undefined) {
      out = applyEntry(this.relink(html), SITE_TEXT.entries[id], SITE_TEXT.targets);
      if (byText.size > 4) byText.clear();
      byText.set(key, out);
    }
    if (out !== html) sys.description = out;
  }

  /**
   * At init, before the world's documents are made: they are prepared once
   * then, and their descriptions are completed with them. Wrapped on Foundry's
   * Item, which every a5e item class reaches through BaseItemA5e's
   * super.prepareData().
   */
  static install() {
    const proto = foundry.documents.Item?.prototype;
    if (!proto?.prepareData || proto.prepareData.amSiteText) return;
    const original = proto.prepareData;
    const wrapped = function (...args) {
      const result = original.apply(this, args);
      if (SiteText.enabled()) {
        try { SiteText.apply(this); } catch (err) {
          if (!SiteText.#failed) { SiteText.#failed = true; AM.log(1, `Could not complete the description of ${this?.name}:`, err); }
        }
      }
      return result;
    };
    wrapped.amSiteText = true;
    proto.prepareData = wrapped;
  }
}
