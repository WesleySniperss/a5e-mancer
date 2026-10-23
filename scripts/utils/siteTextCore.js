/**
 * What a5e.tools' text has and a5e's own text lacks, put into a description:
 * the blocks a5e left out (tables, stat blocks, lore, a background's
 * connections and mementos) and the links the site makes (a summoning spell's
 * stat blocks, the spells, items and maneuvers a text names, conditions).
 *
 * Plain functions on HTML strings, without Foundry: the module runs them on
 * every item's description (siteText.js), and tools/import/build-site-text.cjs
 * runs the very same ones on a5e's packs when it works out where each block
 * goes and which occurrence of a word the site links - so the two cannot
 * disagree about either.
 */

const ENTITIES = { nbsp: ' ', amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', rsquo: "'", lsquo: "'", ldquo: '"', rdquo: '"', mdash: '—', ndash: '–', times: '×', hellip: '…', minus: '−' };

export function decode(s) {
  return String(s ?? '')
    .replace(/&#(\d+);/g, (m, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (m, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
}

/** A text reduced to its words, for comparing: lower case, letters and digits, single spaces. */
export function norm(html) {
  return decode(String(html ?? '')
    .replace(/@UUID\[[^\]]*\]\{([^}]*)\}/g, '$1')
    .replace(/\[\[\/condition [^\]]*?label="([^"]*)"[^\]]*\]\]/g, '$1')
    .replace(/<[^>]+>/g, ' '))
    .toLowerCase().replace(/[’‘`']/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

/** How a block is found again: the start of its words. */
export function anchorOf(html) {
  return norm(html).slice(0, 60);
}

const BLOCK = /^(p|h[1-6]|table|ul|ol|hr|blockquote|pre|figure|dl)$/i;

/**
 * The top-level blocks of a description, in order. Wrappers (div, section) are
 * looked through; text outside any block is a block of its own.
 */
export function blocksOf(html) {
  const src = String(html ?? '').replace(/<\/?(div|section|article)\b[^>]*>/gi, '');
  const out = [];
  const re = /<(\/?)([a-z][a-z0-9]*)\b[^>]*?(\/?)>/gi;
  let depth = 0, start = 0, open = null, last = 0, m;
  while ((m = re.exec(src))) {
    const [tag, closing, name, selfClose] = [m[0], m[1], m[2].toLowerCase(), m[3]];
    if (!BLOCK.test(name)) continue;
    if (depth === 0 && !closing) {
      const loose = src.slice(last, m.index);
      if (loose.trim()) out.push(loose.trim());
      if (name === 'hr' || selfClose) { out.push(tag); last = re.lastIndex; continue; }
      depth = 1; start = m.index; open = name;
    } else if (name === open) {
      if (closing) depth--; else depth++;
      if (depth === 0) { out.push(src.slice(start, re.lastIndex)); last = re.lastIndex; open = null; }
    }
  }
  const rest = src.slice(open ? start : last);
  if (rest.trim()) out.push(rest.trim());
  return out;
}

/** The runs of four words a text holds, its words as norm gives them. */
function wordRuns(words) {
  const w = String(words).split(' ').filter(Boolean);
  const runs = new Set();
  for (let i = 0; i + 4 <= w.length; i++) runs.add(w.slice(i, i + 4).join(' '));
  return runs;
}

/**
 * How much of a block a text already holds, as its share of the block's
 * four-word runs; null for a block too short to have one.
 */
function heldShare(words, runs) {
  const mine = wordRuns(words);
  if (!mine.size) return null;
  let held = 0;
  for (const run of mine) if (runs.has(run)) held++;
  return held / mine.size;
}

/**
 * At or above this share a block is one the text already has, in other
 * words. a5e may add a block the site has with its start worded its own way
 * - a heading, one word changed - and found by its first words alone it was
 * put in a second time (115 of 118 blocks, in a test that changed one word).
 * Measured on a5e 1.4.10's texts (2026-10-23): no block shares more than
 * 0.23 with the text it completes; reworded at its start, all but two of the
 * shortest share 0.83 or more.
 */
const HELD = 0.6;

/** Does a description already hold this block - its first words, or most of its runs? */
export function holdsBlock(html, add) {
  const have = norm(html);
  const words = norm(add);
  if (!words) return true;
  if (have.includes(words.slice(0, 80))) return true;
  const share = heldShare(words, wordRuns(have));
  return share !== null && share >= HELD;
}

/**
 * Put in the blocks a description lacks. Each addition is [anchor, html]: the
 * html goes after the block that starts with anchor ('^' for the very start),
 * or at the end where no block does. An addition the description already
 * holds - its first words, or most of its four-word runs, however a5e has
 * worded its start - is left out, so running this again changes nothing, and
 * a block a5e adds itself is not shown twice.
 */
export function insertBlocks(html, adds) {
  if (!adds?.length) return html;
  const have = norm(html);
  const runs = wordRuns(have);
  const blocks = blocksOf(html);
  const anchors = blocks.map(anchorOf);
  const after = new Map();            // block index (-1 = start, blocks.length = end) -> html[]
  let changed = false;
  for (const [anchor, add] of adds) {
    const words = norm(add);
    if (!words || have.includes(words.slice(0, 80))) continue;
    const share = heldShare(words, runs);
    if (share !== null && share >= HELD) continue;
    let at = anchor === '^' ? -1 : anchors.findIndex(a => a && anchor && a.startsWith(anchor));
    if (at < 0 && anchor !== '^') at = blocks.length;
    if (!after.has(at)) after.set(at, []);
    after.get(at).push(add);
    changed = true;
  }
  if (!changed) return html;
  const out = [...(after.get(-1) ?? [])];
  blocks.forEach((b, i) => { out.push(b, ...(after.get(i) ?? [])); });
  out.push(...(after.get(blocks.length) ?? []));
  return out.join('');
}

/** The words of a link, as a pattern that also matches them written with entities or curly quotes. */
export function patternOf(text) {
  const parts = String(text).trim().split(/\s+/).map(w => w
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/'/g, "(?:'|’|‘|&rsquo;|&lsquo;|&#0?39;)")
    .replace(/-/g, '(?:-|–|&ndash;)'));
  return new RegExp(`(?<![A-Za-z0-9])${parts.join('(?:\\s|&nbsp;|&#160;)+')}(?![A-Za-z0-9])`, 'gi');
}

/**
 * Every place the words occur in the description's text, in order, and whether
 * a link may go there: not inside a tag, an existing link or an enricher, where
 * a link already is.
 */
export function occurrences(html, text) {
  const src = String(html ?? '');
  const tokens = /<a\b[^>]*>([\s\S]*?)<\/a>|@\w+\[[^\]]*\](?:\{([^}]*)\})?|\[\[[\s\S]*?\]\](?:\{([^}]*)\})?|<[^>]*>/gi;
  const found = [];
  const scan = (from, to, linkable) => {
    const re = patternOf(text);
    const part = src.slice(from, to);
    let m;
    while ((m = re.exec(part))) found.push({ start: from + m.index, end: from + m.index + m[0].length, linkable });
  };
  let last = 0, m;
  while ((m = tokens.exec(src))) {
    scan(last, m.index, true);
    /* The words a link or an enricher shows count too, so the numbering is the
       same once a link is in; nothing more goes there. Only the words shown:
       not an address, an id, or a condition's id beside its label. */
    const shown = m[1] ?? m[2] ?? m[3] ?? (m[0].match(/^\[\[[^\]]*?label="([^"]*)"/) || [])[1];
    if (shown) {
      const at = m.index + m[0].lastIndexOf(shown);
      scan(at, at + shown.length, false);
    }
    last = tokens.lastIndex;
  }
  scan(last, src.length, true);
  return found;
}

/** The markup of one link: an a5e condition, or a document by uuid. */
export function linkMarkup(target, words) {
  if (target.startsWith('condition:')) return `[[/condition id=${target.slice(10)} label="${words.replace(/"/g, '')}"]]`;
  return `@UUID[${target}]{${words}}`;
}

/**
 * Link the words the site links. Each link is [words, target index, occurrence]:
 * the occurrence-th place those words occur (counting from 0) becomes a link,
 * unless a link is there already.
 */
export function linkText(html, links, targets) {
  if (!links?.length) return html;
  const edits = [];
  for (const [words, t, occ] of links) {
    const target = targets[t];
    if (!target) continue;
    const spot = occurrences(html, words)[occ ?? 0];
    if (!spot?.linkable) continue;
    if (edits.some(e => spot.start < e.end && e.start < spot.end)) continue;
    edits.push({ ...spot, target });
  }
  edits.sort((a, b) => b.start - a.start);
  let out = String(html);
  for (const e of edits) out = out.slice(0, e.start) + linkMarkup(e.target, out.slice(e.start, e.end)) + out.slice(e.end);
  return out;
}

/** A description with what the site adds: the missing blocks first, then the links. */
export function applyEntry(html, entry, targets) {
  if (!entry || typeof html !== 'string' || !html.trim()) return html;
  return linkText(insertBlocks(html, entry.add), entry.links, targets);
}
