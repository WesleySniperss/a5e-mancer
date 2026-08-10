import { AM } from '../a5e-mancer.js';

/**
 * Finds the roll tables inside an item's description so every one of them can be
 * rolled in the builder, instead of the two that used to be guessed at.
 *
 * A5e destinies carry several — source of inspiration, goals, connections and so
 * on — and backgrounds carry their own. They are plain HTML in the description,
 * not RollTable documents, so they have to be read out of the markup: either a
 * <table> (numbered first column, or just positional rows) or an <ol>/<ul>.
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

  /** Read the tables out of a compendium item, by uuid. */
  static async load(uuid, source) {
    if (!uuid) return [];
    try {
      const doc = await fromUuid(uuid);
      if (!doc) return [];
      const raw = typeof doc.system?.description === 'string'
        ? doc.system.description
        : (doc.system?.description?.value ?? '');
      const tables = this.extract(raw, source);
      AM.log(3, `${source}: found ${tables.length} lore table(s)`);
      return tables;
    } catch (err) {
      AM.log(2, `Could not read ${source} lore tables:`, err);
      return [];
    }
  }
}
