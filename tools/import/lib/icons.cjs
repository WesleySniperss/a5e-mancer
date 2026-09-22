// Icons for converted documents, borrowed from a5e's own documents with the
// most similar names - every one a core Foundry icon that exists in the install.
const fs = require('fs'), path = require('path');
const P = require('./paths.cjs');
const { norm } = require('./normalize.cjs');

const STOP = new Set('with from your that this into over under their them than then when what have been of the and for you a an to in on at by or as is it its be'.split(' '));
const FALLBACK = 'icons/sundries/documents/document-sealed-signatures-red.webp';
const ok = (img) => /^icons\//.test(img || '') && !/icons\/svg\//.test(img) && fs.existsSync(P.PUBLIC + img);
const wordsOf = (name) => norm(name).replace(/'/g, '').split(' ').filter((w) => w.length > 2 && !STOP.has(w));

/** An icon picker over the named packs: `pick(name, fallback, taken)`. */
function iconIndex(packNames) {
  const index = new Map(), freq = new Map();
  for (const p of packNames) {
    for (const d of JSON.parse(fs.readFileSync(path.join(P.PACKS, `${p}.json`), 'utf8'))) {
      if (!ok(d.img)) continue;
      for (const w of new Set(wordsOf(d.name))) {
        if (!index.has(w)) index.set(w, new Map());
        const m = index.get(w); m.set(d.img, (m.get(d.img) || 0) + 1);
        freq.set(w, (freq.get(w) || 0) + 1);
      }
    }
  }
  return function pick(name, fallback, taken) {
    const score = new Map();
    for (const w of wordsOf(name)) {
      const m = index.get(w) ?? index.get(w.replace(/s$/, '')) ?? index.get(w.replace(/(ing|ed)$/, ''));
      if (!m) continue;
      const weight = 1 / Math.log(2 + (freq.get(w) || 1));
      for (const [img, n] of m) score.set(img, (score.get(img) || 0) + weight * (1 + Math.log(n)) - (taken?.has(img) ? 0.4 : 0));
    }
    const best = [...score.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0];
    const icon = best ?? fallback ?? FALLBACK;
    return ok(icon) ? icon : FALLBACK;
  };
}

module.exports = { iconIndex, FALLBACK, ok };
