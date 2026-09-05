import { AM } from '../a5e-mancer.js';
import { PackFilter } from './packFilter.js';

/**
 * Filling back in what a character's items have lost.
 *
 * Items on the characters in a live world are frequently stubs: the name and
 * the actions are there, and every other field sits at its schema default. A
 * spell like that has no description, but it also has no level, no components,
 * no casting time and no school, because none of those were ever written. The
 * sheet is not hiding them — there is nothing to show.
 *
 * The compendium entry the stub came from still has all of it. This walks the
 * actor's items, finds the entry each one came from, and puts back only what is
 * missing.
 *
 * WHAT IS NEVER OVERWRITTEN
 * Anything the player has actually set. A field counts as the player's when it
 * differs from what a brand-new item of that type would have; those are kept
 * exactly, and the compendium only supplies the rest. So an edited spell keeps
 * its edits and gains its missing description, rather than being reset to the
 * book version.
 */
export class ItemRepair {

  /** Item types worth repairing — the ones that carry text a player reads. */
  static TYPES = ['spell', 'maneuver', 'object', 'feature'];

  /**
   * Item and actor names go into dialog HTML, and a name is not trusted text —
   * it comes from a compendium, an import or whatever a player typed. Escaped
   * so a name containing markup is read rather than run.
   */
  static esc(s) {
    const str = String(s ?? '');
    return foundry.utils?.escapeHTML?.(str)
      ?? str.replace(/[&<>"']/g, c =>
          ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /** Prose, once the markup and entities are stripped. */
  static hasText(html) {
    return String(html ?? '')
      .replace(/<[^>]*>/g, '')
      .replace(/&[a-z]+;/gi, ' ')
      .trim().length > 0;
  }

  /** The compendium source id an item was made from, if it records one. */
  static sourceId(item) {
    const raw = item?._stats?.compendiumSource ?? item?.flags?.core?.sourceId ?? '';
    if (!raw) return '';
    return PackFilter.normalizeSource(raw).split('.').pop() ?? '';
  }

  /**
   * Where each item could be filled in from.
   *
   * Two ways in, because neither covers the world on its own. The source id is
   * exact but most items do not carry one; the name is a guess but a good one,
   * and between them they reach the great majority. Source wins where both
   * apply.
   *
   * @returns {Promise<Map<string, {pack: string, id: string, by: 'source'|'name'}>>}
   *          keyed by the actor's item id
   */
  static async locate(actor) {
    const wanted = actor.items.filter(i =>
      this.TYPES.includes(i.type) && !this.hasText(i.system?.description));
    if (!wanted.length) return new Map();

    const byId   = new Map();   // compendium _id  → {pack, type}
    const byName = new Map();   // type|name       → {pack, id}

    for (const pack of PackFilter.itemPacks()) {
      let index;
      try {
        index = await pack.getIndex({ fields: ['name', 'type', 'system.description'] });
      } catch (err) {
        AM.log(2, `Could not index ${pack.collection}:`, err);
        continue;
      }
      for (const entry of index) {
        // An entry with nothing to say cannot help; skipping them here keeps a
        // blank compendium item from being chosen over a good one of the same
        // name in another pack.
        if (!this.hasText(entry.system?.description)) continue;
        byId.set(entry._id, { pack: pack.collection, id: entry._id, type: entry.type });
        const key = `${entry.type}|${entry.name.toLowerCase()}`;
        if (!byName.has(key)) byName.set(key, { pack: pack.collection, id: entry._id });
      }
    }

    const found = new Map();
    for (const item of wanted) {
      const sid = this.sourceId(item);
      const bySource = sid ? byId.get(sid) : null;
      if (bySource && bySource.type === item.type) {
        found.set(item.id, { pack: bySource.pack, id: bySource.id, by: 'source' });
        continue;
      }
      const byNameHit = byName.get(`${item.type}|${item.name.toLowerCase()}`);
      if (byNameHit) found.set(item.id, { ...byNameHit, by: 'name' });
    }
    return found;
  }

  /**
   * The system data a brand-new item of this type starts with — the baseline
   * that says which of an item's fields the player actually set.
   *
   * Cached per type: this builds a throwaway document, and the repair asks for
   * the same handful of types over and over.
   *
   * @returns {object|null} null when no blank could be built.
   */
  static #blankCache = new Map();

  static #blankSystem(type) {
    if (this.#blankCache.has(type)) return this.#blankCache.get(type);
    let blank = null;
    try {
      const cls = CONFIG.Item.documentClass;
      const sys = new cls({ name: 'a5e-mancer-probe', type }).toObject().system;
      // An empty object is not a usable baseline — see #mergeFor.
      if (sys && Object.keys(sys).length) blank = sys;
    } catch (err) {
      AM.log(2, `No blank ${type} to compare against:`, err);
    }
    this.#blankCache.set(type, blank);
    return blank;
  }

  /** Nothing there to lose: what may be filled in without overwriting anyone. */
  static #isEmpty(v) {
    if (v === null || v === undefined) return true;
    if (typeof v === 'string') return v.trim() === '';
    if (Array.isArray(v)) return v.length === 0;
    if (v instanceof Set || v instanceof Map) return v.size === 0;
    if (typeof v === 'object') return Object.keys(v).length === 0;
    return false;
  }

  /** Deep equality, through Foundry's own comparison where it exists. */
  static #same(a, b) {
    try {
      if (foundry.utils.objectsEqual && a && b
          && typeof a === 'object' && typeof b === 'object') {
        return foundry.utils.objectsEqual(a, b);
      }
    } catch { /* fall through */ }
    if (a === b) return true;
    try { return JSON.stringify(a) === JSON.stringify(b); } catch { return false; }
  }

  /**
   * Build the update for one item: the fields it never had, and nothing else.
   *
   * This fills key by key rather than merging the compendium's system data with
   * the actor's. A merge recurses, and on these items the one thing that IS
   * populated is `actions` — so the book's actions would be folded in beside the
   * character's and every repaired spell would list its actions twice. Filling
   * only untouched keys cannot do that: a key the character has any value in is
   * left exactly as it is.
   *
   * "Untouched" means still identical to what a brand-new item of that type
   * would hold. Where no such baseline can be built, it falls back to visibly
   * empty, which is narrower but never wrong.
   *
   * @returns {{_id: string, system: object}|null} null when nothing would change
   */
  static #mergeFor(item, sourceDoc) {
    const mine   = item.toObject().system ?? {};
    const theirs = sourceDoc.toObject().system ?? {};
    const blank  = this.#blankSystem(item.type);

    if (!blank) {
      AM.log(2, `No blank ${item.type} to compare against; `
              + `filling only visibly empty fields on ${item.name}`);
    }

    const untouched = (key) => blank
      ? this.#same(mine[key], blank[key])
      : this.#isEmpty(mine[key]);

    const fill = {};
    for (const [key, value] of Object.entries(theirs)) {
      if (this.#isEmpty(value)) continue;          // nothing to give
      if (blank && this.#same(value, blank[key])) continue;  // same as default anyway
      if (!untouched(key)) continue;               // the character's own — leave it
      fill[key] = value;
    }

    return Object.keys(fill).length ? { _id: item.id, system: fill } : null;
  }

  /**
   * What a repair would do, without doing it.
   * @returns {Promise<{updates: object[], rows: object[]}>}
   */
  static async plan(actor) {
    const located = await this.locate(actor);
    const updates = [], rows = [];

    for (const [itemId, hit] of located) {
      const item = actor.items.get(itemId);
      if (!item) continue;
      let doc;
      try {
        doc = await game.packs.get(hit.pack)?.getDocument(hit.id);
      } catch (err) {
        AM.log(2, `Could not read ${hit.pack}.${hit.id}:`, err);
        continue;
      }
      if (!doc || !this.hasText(doc.system?.description)) continue;

      const update = this.#mergeFor(item, doc);
      if (!update) continue;          // nothing this item would gain
      updates.push(update);
      rows.push({ name: item.name, type: item.type, by: hit.by, from: doc.name });
    }
    return { updates, rows };
  }

  /**
   * Repair an actor's items, asking first.
   *
   * Asking is the point: this rewrites system data on documents a player may
   * have spent time on, and while the merge is careful it is not something to
   * do to someone's character without showing them the count.
   */
  static async run(actor, { confirm = true } = {}) {
    if (!actor) return 0;

    const { updates, rows } = await this.plan(actor);
    if (!updates.length) {
      ui.notifications.info(`${AM.NAME}: nothing to fill in — every item already has its text.`);
      return 0;
    }

    if (confirm) {
      const byType = rows.reduce((m, r) => (m[r.type] = (m[r.type] ?? 0) + 1, m), {});
      const summary = Object.entries(byType)
        .sort((a, b) => b[1] - a[1])
        .map(([t, n]) => `<li>${n} ${this.esc(t)}${n === 1 ? '' : 's'}</li>`).join('');
      const sample = rows.slice(0, 12).map(r => this.esc(r.name)).join(', ');
      const more   = rows.length > 12 ? `, and ${rows.length - 12} more` : '';
      const named  = rows.filter(r => r.by === 'name').length;

      const ok = await foundry.applications.api.DialogV2.confirm({
        window: { title: `${AM.NAME}: fill in missing item text` },
        content:
            `<p>${updates.length} of ${this.esc(actor.name)}'s items have no description, and the`
          + ` compendium entry they came from still does. Their description, and any other`
          + ` field left empty — a spell's level, components and casting time among them —`
          + ` would be filled in.</p>`
          + `<ul>${summary}</ul>`
          + `<p class="am-hint">${sample}${more}</p>`
          + (named
              ? `<p class="am-hint">${named} of these were matched by name rather than by a`
              + ` recorded source, since most items on a character do not record one.</p>`
              : '')
          + `<p>Anything you have edited yourself is kept as it is.</p>`
      }).catch(() => false);
      if (!ok) return 0;
    }

    await actor.updateEmbeddedDocuments('Item', updates);
    AM.log(3, `Filled in ${updates.length} items on ${actor.name}`);
    ui.notifications.info(`${AM.NAME}: filled in ${updates.length} item(s) on ${actor.name}.`);
    return updates.length;
  }
}
