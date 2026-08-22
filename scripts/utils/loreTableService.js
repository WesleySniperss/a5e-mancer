import { AM } from '../a5e-mancer.js';
import { PackFilter } from './packFilter.js';

/**
 * Finds the roll tables inside an item's description so every one of them can be
 * rolled in the builder, instead of the two that used to be guessed at.
 *
 * A5e destinies carry several — source of inspiration, goals, connections and so
 * on — and backgrounds carry their own. They arrive in three different shapes,
 * and all three are handled, because relying on any one of them left destinies
 * looking like they had no tables at all:
 *
 *   1. inline HTML in the description — a <table> (numbered first column, or
 *      just positional rows) or an <ol>/<ul>
 *   2. @UUID links to real RollTable documents in the `a5e-roll-tables` pack
 *   3. RollTables named after the item, when the text links nothing
 *
 * The die is taken from the number of entries, which is how these tables are
 * written: a six-row table is a d6.
 */
export class LoreTableService {


  /**
   * @param {string} html  item description
   * @param {string} source  'destiny' | 'background' | …, used to build field keys
   * @returns {Array<{key,heading,die,entries:string[],source,index}>}
   */
  static extract(html, source = 'lore') {
    if (!html || typeof html !== 'string') return [];

    let root;
    try {
      root = document.createElement('div');
      root.innerHTML = html;
    } catch { return []; }

    const out = [];
    for (const el of root.querySelectorAll('table, ol, ul')) {
      // A list nested inside a table cell is part of that table, not its own
      if (el.closest('table') && el.tagName !== 'TABLE') continue;

      const entries = el.tagName === 'TABLE' ? this.#fromTable(el) : this.#fromList(el);
      if (entries.length < 2) continue;

      const index = out.length;
      out.push({
        source,
        index,
        key:     `${source}.${index}`,
        heading: this.#headingFor(el, index),
        die:     this.#dieFor(entries.length),
        entries
      });
    }
    return out;
  }

  /** Roll one table and return the entry text. */
  static roll(table) {
    if (!table?.entries?.length) return '';
    const n = 1 + Math.floor(Math.random() * table.entries.length);
    return table.entries[n - 1] ?? '';
  }

  /* ── RollTable documents ──────────────────────────────── */

  /**
   * A5e also ships its lore tables as real RollTable documents in
   * `a5e-roll-tables`, referenced from the item text as @UUID links — the HTML
   * parser above finds nothing in those descriptions, which is why a destiny
   * looked like it had no tables at all.
   *
   * Both routes are used: whatever is written inline, plus whatever the text
   * links to.
   */
  static async fromRollTableLinks(html, source, startIndex = 0) {
    if (!html) return [];

    // @UUID[Compendium.a5e.a5e-roll-tables.RollTable.abc123]{Label}
    const re = /@UUID\[([^\]]+)\](?:\{([^}]*)\})?/g;
    const out = [];
    const seen = new Set();
    let m;

    while ((m = re.exec(html))) {
      const uuid = m[1];
      if (!uuid || seen.has(uuid)) continue;
      seen.add(uuid);
      if (!/RollTable/i.test(uuid)) continue;

      try {
        const doc = await fromUuid(uuid);
        const entries = this.#fromRollTable(doc);
        if (entries.length < 2) continue;

        const index = startIndex + out.length;
        out.push({
          source,
          index,
          key:     `${source}.${index}`,
          heading: m[2]?.trim() || doc.name || game.i18n.format('am.app.lore.table-n', { n: index + 1 }),
          die:     entries.length,
          entries
        });
      } catch (err) {
        AM.log(2, `Roll table ${uuid} could not be read:`, err);
      }
    }
    return out;
  }

  /** Result text from a RollTable document, across Foundry versions. */
  static #fromRollTable(doc) {
    const results = doc?.results;
    if (!results || typeof results.map !== 'function') return [];
    return [...results]
      .map(r => {
        const raw = r.description ?? r.text ?? r.name ?? '';
        // Results can carry HTML; the field the player edits is plain text
        const div = document.createElement('div');
        div.innerHTML = String(raw);
        return div.textContent.trim();
      })
      .filter(Boolean);
  }

  /**
   * RollTables whose name starts with the item's, for content that links its
   * tables by nothing but a shared naming convention.
   */
  static async byItemName(itemName, source, startIndex = 0) {
    const name = String(itemName ?? '').trim().toLowerCase();
    if (!name) return [];

    const out = [];
    for (const pack of PackFilter.packsOfType('RollTable')) {
      try {
        const index = await pack.getIndex();
        for (const entry of index) {
          const n = entry.name?.toLowerCase() ?? '';
          if (!n.startsWith(name)) continue;
          // The prefix has to be the whole word. This route used to run only
          // when nothing else was found, so a loose match cost nothing; now that
          // it always runs, "Sage" must not claim "Sagebrush Encounters".
          const after = n.charAt(name.length);
          if (after && !/[\s:–—-]/.test(after)) continue;
          const doc = await pack.getDocument(entry._id);
          const entries = this.#fromRollTable(doc);
          if (entries.length < 2) continue;

          const i = startIndex + out.length;
          out.push({
            source, index: i, key: `${source}.${i}`,
            // Drop the item name prefix so the label reads as the table's subject
            heading: (entry.name.slice(itemName.length).replace(/^[\s:–—-]+/, '') || entry.name),
            die: entries.length,
            entries
          });
        }
      } catch { /* unreadable pack — skip */ }
    }
    return out;
  }

  /* ── parsing ──────────────────────────────────────────── */

  static #fromTable(el) {
    const rows = [...el.querySelectorAll('tr')].filter(r => r.querySelector('td'));
    return rows.map(row => {
      const cells = [...row.querySelectorAll('td')];
      if (!cells.length) return '';
      // A leading roll-number column ("1", "2–3") is a label, not content
      const first = cells[0].textContent.trim();
      const body  = /^\d+\s*([–—-]\s*\d+)?$/.test(first) && cells.length > 1
        ? cells.slice(1)
        : cells;
      return body.map(c => c.textContent.trim()).filter(Boolean).join(' — ');
    }).filter(Boolean);
  }

  static #fromList(el) {
    return [...el.querySelectorAll(':scope > li')]
      .map(li => li.textContent.trim())
      .filter(Boolean);
  }

  /**
   * The nearest heading above the table. Falls back to a bold lead-in or the
   * table's own caption, then to a generic label.
   */
  static #headingFor(el, index) {
    const caption = el.querySelector?.('caption')?.textContent?.trim();
    if (caption) return caption;

    let node = el.previousElementSibling;
    let hops = 0;
    while (node && hops < 4) {
      if (/^H[1-6]$/.test(node.tagName)) {
        const t = node.textContent.trim();
        if (t) return t;
      }
      // Paragraphs that are entirely bold read as headings in these descriptions
      const strong = node.querySelector?.('strong, b');
      if (strong && node.textContent.trim() === strong.textContent.trim()) {
        const t = strong.textContent.trim();
        if (t) return t;
      }
      node = node.previousElementSibling;
      hops++;
    }
    return game.i18n.format('am.app.lore.table-n', { n: index + 1 });
  }

  static #dieFor(count) {
    // The label must match what roll() actually does, which is pick uniformly
    // from the entries. Rounding 3 rows up to "d4" would advertise a result the
    // table cannot produce.
    return count;
  }

  /* ── loading ──────────────────────────────────────────── */

  /**
   * Every table an item offers, from all three places a5e puts them:
   * inline HTML, @UUID links to RollTable documents, and — failing both — tables
   * named after the item in the RollTable compendium.
   */
  static async load(uuid, source) {
    if (!uuid) return [];
    try {
      const doc = await fromUuid(uuid);
      if (!doc) return [];

      const raw = this.#descriptionOf(doc);

      const inline = this.extract(raw, source);
      const linked = await this.fromRollTableLinks(raw, source, inline.length);
      let tables = [...inline, ...linked];

      // A destiny's own description holds only the source of inspiration. The
      // tables players actually fill in — Connection to Your Destiny, Path of
      // Fulfillment — live in the feature documents it points at, so reading the
      // destiny alone found neither of them.
      for (const related of await this.#relatedDocs(doc)) {
        const text = this.#descriptionOf(related);
        if (!text) continue;
        const own    = this.extract(text, source);
        const linked2 = await this.fromRollTableLinks(text, source, tables.length + own.length);
        tables = [...tables, ...own, ...linked2];
      }

      // Always merged, never a fallback. A5e ships each background's Connections
      // and Mementos as RollTable documents named "<Background> Connections" and
      // "<Background> Mementos", and the description links neither — so treating
      // this route as a last resort meant any background whose text happened to
      // carry one inline list (most of them do) lost both tables outright. They
      // then fell through to the two plain textareas in the biography, which
      // have no die to roll: exactly the "rolling does nothing" report.
      const named = await this.byItemName(doc.name, source, tables.length);
      tables = [...tables, ...named];

      // Same table reached two ways — keep the first. Matched on content alone:
      // the inline copy and the RollTable document carry different headings
      // ("Connections and Mementos" against "Connections"), so a signature that
      // included the heading let the same entries through twice.
      const seen = new Set();
      tables = tables.filter(t => {
        const sig = t.entries.join('').slice(0, 400);
        if (seen.has(sig)) return false;
        seen.add(sig);
        return true;
      }).map((t, i) => ({ ...t, index: i, key: `${source}.${i}` }));

      AM.log(3, `${source}: ${tables.length} lore table(s) `
                + `(${inline.length} inline, ${linked.length} linked, ${named.length} by name)`);
      return tables;
    } catch (err) {
      AM.log(2, `Could not read ${source} lore tables:`, err);
      return [];
    }
  }

  /** a5e declares description as a plain HTMLField — there is no `.value`. */
  static #descriptionOf(doc) {
    return typeof doc?.system?.description === 'string'
      ? doc.system.description
      : (doc?.system?.description?.value ?? '');
  }

  /**
   * Documents an item points at whose text carries tables of its own.
   *
   * A destiny names three features by uuid rather than embedding them, and two of
   * those hold the tables the biography is meant to be filled from. Backgrounds
   * use `feature` the same way. Unknown or unreadable uuids are skipped rather
   * than failing the whole load.
   */
  static async #relatedDocs(doc) {
    const sys = doc?.system ?? {};
    const uuids = [
      sys.sourceOfInspiration, sys.inspirationFeature, sys.fulfillmentFeature,
      sys.feature
    ].filter(u => typeof u === 'string' && u);

    const out = [];
    for (const u of [...new Set(uuids)]) {
      try {
        const related = await fromUuid(u);
        if (related) out.push(related);
      } catch { /* skip */ }
    }
    return out;
  }
}
