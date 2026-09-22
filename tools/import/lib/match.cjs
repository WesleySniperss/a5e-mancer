// Is an a5e.tools entry already in a5e's packs? Names are written differently
// on each side - "Hand crossbow" / "Crossbow, Hand", "Duelling" / "Dueling",
// "Ammunition +1" / "+1 Ammunition", "Aerial Bracers (rare)" / "Aerial
// Bracers" - so both sides are reduced to the same set of name variants.
//
// a5e also writes a generic item once per variant: a5e.tools' "Holy Avenger"
// is a5e's "Holy Avenger Longsword", "Saber", ...; "Belt of Giant Strength" is
// "Belt of Frost Giant Strength"; "Potion of Healing" is "Healing Potion
// (Basic)"; "Weapon +1" is "Longsword +1". So an entry also counts as present
// when every word of its name (less "weapon", "sword", "armor") is a word of
// one a5e name - for gear only; spells are matched by name.
const flat = (s) => String(s ?? '').toLowerCase().replace(/&quot;|["“”]/g, '').replace(/[’‘`']/g, '')
  .replace(/\bduell/g, 'duel').replace(/\bgrey\b/g, 'gray').replace(/\barmour\b/g, 'armor')
  .replace(/[^a-z0-9+ ]/g, ' ').replace(/\s+/g, ' ').trim();
const STOP = new Set(['of', 'the', 'a', 'an', 'and', 'or', 'to']);
const GENERIC = new Set(['weapon', 'weapons', 'sword', 'armor']);
const stem = (w) => w.replace(/ies$/, 'y').replace(/(?<=[a-z]{3}[^s])s$/, '');

function variants(name) {
  const out = new Set();
  const base = String(name ?? '');
  const add = (s) => { const f = flat(s).replace(/^(the|a|an) /, ''); if (f) { out.add(f.replace(/ /g, '')); out.add(f.split(' ').sort().join(' ')); } };
  add(base);
  const noParen = base.replace(/\s*\([^)]*\)\s*/g, ' ').trim();
  add(noParen);
  for (const s of [base, noParen]) {
    const m = /^([^,]+),\s*(.+)$/.exec(s);
    if (m) { add(`${m[2]} ${m[1]}`); add(m[1]); }
  }
  const plus = /([+]\d)/.exec(base);
  if (plus) { const rest = base.replace(/[,]?\s*[+]\d(?:\s*,?\s*(?:[+]\d|or)\s*)*/g, ' ').trim(); add(`${rest} ${plus[1]}`); add(rest); }
  return out;
}
const words = (name) => flat(String(name).replace(/\s*\((?:rare|uncommon|common|very rare|legendary)\)\s*/gi, ' '))
  .split(' ').filter((w) => w && !STOP.has(w)).map(stem);

/** An index of names on one side; `has(name)` for the other side. */
function index(names, { subset = false } = {}) {
  const set = new Set();
  const bags = [];
  for (const n of names) {
    for (const v of variants(n)) set.add(v);
    if (subset) bags.push(new Set(words(n)));
  }
  const has = (n) => {
    if ([...variants(n)].some((v) => set.has(v))) return true;
    if (!subset) return false;
    let w = words(n);
    const pluses = w.filter((x) => /^\+\d$/.test(x));
    w = w.filter((x) => !/^\+\d$/.test(x));
    const core = w.filter((x) => !GENERIC.has(x));
    const need = core.length ? core : pluses.length ? [] : w;
    if (!need.length && !pluses.length) return false;
    return bags.some((b) => need.every((x) => b.has(x)) && (!pluses.length || pluses.some((p) => b.has(p))));
  };
  return { has, set };
}

module.exports = { variants, index, flat, words };
