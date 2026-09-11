/* Whose spells the spell window offers, against a5e's own pack.
 *
 * a5e keeps seventeen class spell lists. The Berserker is on none of them, nor
 * is the Fighter, the Rogue or anyone else who does not cast. The filter used
 * to read "this class has no list" as "no restriction", so opening the window
 * on a Berserker offered all 895 spells in the compendium — every one of which
 * that character can never learn. The comment where that was decided called it
 * costing nothing.
 *
 * So this asks the loader directly, with a5e's real pack behind it: a caster
 * gets its own list, a class with no list gets nothing, and a character whose
 * class cannot be named at all still gets everything, because that is a
 * genuine unknown rather than an answer.
 */
import './stubs.mjs';
import { ClassicLevel } from 'classic-level';

const R = 'c:/Users/Jonkm/AppData/Local/FoundryVTT/Data/modules/a5e-mancer/';

const db = new ClassicLevel(R + 'packcopy2/spells', { valueEncoding: 'json' });
const docs = [];
for await (const [key, v] of db.iterator()) {
  if (key.startsWith('!items!') && !key.includes('.')) docs.push(v);
}
await db.close();

/* a5e's seventeen, read from the system rather than listed here. */
const A5E = 'c:/Users/Jonkm/AppData/Local/FoundryVTT/Data/systems/a5e/a5e.js';
const src = (await import('fs')).readFileSync(A5E, 'utf8');
const at = src.indexOf('classSpellLists');
const open = src.indexOf('{', at);
let d = 0, k = open;
for (; k < src.length; k++) { if (src[k] === '{') d++; else if (src[k] === '}') { d--; if (!d) break; } }
const listKeys = [...src.slice(open, k).matchAll(/^\s*([A-Za-z]+):/gm)].map((m) => m[1]);

globalThis.CONFIG = { A5E: {
  classSpellLists: Object.fromEntries(listKeys.map((k2) => [k2, 'A5E.' + k2])),
  spellSchools: { primary: {}, secondary: {} },
  spellLevels: {}, itemRarity: {}, filters: { objects: {} }
} };
globalThis.game = {
  i18n: { localize: (s) => String(s).split('.').pop(), format: (s) => s, has: () => false },
  packs: new Collection(), modules: new Collection(), user: { isGM: true },
  settings: { get: () => { throw new Error('x'); }, register() {} },
  system: { id: 'a5e' }
};
globalThis.fromUuid = async () => null;
globalThis.fromUuidSync = () => null;

/* The real pack answers a plain getIndex() and throws only when asked to fold
   extra fields into it — getting that wrong in a scratch harness once made the
   loader look broken when it was the harness that was. */
const pack = {
  collection: 'a5e.spells',
  metadata: { label: 'Spells', type: 'Item', id: 'a5e.spells' },
  documentName: 'Item',
  index: new Collection(docs.map((x) => [x._id, { _id: x._id, name: x.name, type: x.type, img: x.img }])),
  async getIndex(opts) {
    if (opts?.fields) throw new Error('Cannot add property price, object is not extensible');
    return this.index;
  },
  async getDocuments({ _id__in } = {}) {
    const want = _id__in ? new Set(_id__in) : null;
    return docs.filter((x) => !want || want.has(x._id))
               .map((x) => ({ ...x, uuid: `Compendium.a5e.spells.Item.${x._id}` }));
  }
};
game.packs = new Collection([['a5e.spells', pack]]);

const { SpellService } = await import('file:///' + R + 'scripts/utils/spellService.js');

const count = async (cls) => {
  const byLevel = await SpellService.loadSpells(cls, 9);
  return [...byLevel.values()].flat();
};

const results = [];
const check = (name, ok, detail) => results.push([name, ok, detail]);

const all = await count(null);
check('with no class named, nothing is hidden', all.length === docs.length,
  `${all.length} of ${docs.length} spells`);

/* A caster gets its own list and not the whole pack.

   Its own list plus the spells that name no class at all, which the filter
   admits on purpose: a5e's pack leaves that field empty on some of its own
   entries, and homebrew and imported spells routinely do. Hiding those would
   hide the very spells a table has written itself.

   This check first expected the tagged count alone and reported the 103
   unlisted ones as intruders — the check being wrong about the rule rather
   than the rule being wrong. */
const wizard = await count('Wizard');
const tagged   = docs.filter((x) => (x.system?.classes ?? []).includes('wizard')).length;
const unlisted = docs.filter((x) => !(x.system?.classes ?? []).length).length;
check('a Wizard gets the wizard list and no other class\u2019s',
  wizard.length === tagged + unlisted && wizard.length < docs.length,
  `${wizard.length} spells = ${tagged} tagged wizard + ${unlisted} that name no class`
  + `, out of ${docs.length}`);

/* And every spell it got really is a wizard spell. */
const wrong = wizard.filter((s) => {
  const doc = docs.find((x) => x._id === s.id);
  const list = doc?.system?.classes ?? [];
  return list.length && !list.includes('wizard');
});
check('and nothing else came with them', wrong.length === 0,
  wrong.length ? `${wrong.length} that are on no wizard list, e.g. ${wrong[0].name}`
               : 'every one is on the wizard list');

/* The one that was reported. */
for (const notACaster of ['Berserker', 'Fighter', 'Rogue']) {
  const got = await count(notACaster);
  check(`a ${notACaster} is offered no spells`, got.length === 0,
    `${got.length} spells — a5e gives ${notACaster} no spell list`);
}

/* A class a5e does know, to be sure the rule did not simply empty everything. */
for (const caster of ['Witch', 'Herald', 'Wielder']) {
  const got = await count(caster);
  check(`a ${caster} still gets a list`, got.length > 0, `${got.length} spells`);
}

let bad = 0;
for (const [name, ok, detail] of results) {
  if (!ok) bad++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name.padEnd(42)} ${detail}`);
}
console.log(bad ? `\n${bad} case(s) offer the wrong spells`
                : `\nthe spell window offers each class its own list, and no more`);
process.exit(bad ? 1 : 0);
