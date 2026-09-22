// Write one converted content file into the module, then generated.js - the
// manifest the module loads - over every converted file there is.
const fs = require('fs'), path = require('path');
const P = require('./paths.cjs');

const djb2 = (text) => {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
};

const LABEL = { archetype: 'archetypes', feature: 'features', spell: 'spells and psionic powers', object: 'items', npc: 'monsters' };
/** A file holds actors or items; a pack can hold only one kind of document. */
const ACTOR_TYPES = new Set(['npc', 'character']);

function wrap(head, names) {
  const out = []; let line = ` *   ${head}: `;
  for (const [i, n] of names.entries()) {
    const piece = n + (i < names.length - 1 ? ',' : '');
    if (line.length + piece.length > 88) { out.push(line.trimEnd()); line = ' *     '; }
    line += piece + ' ';
  }
  out.push(line.trimEnd());
  return out.join('\n');
}

/** Write `docs` as scripts/data/imported/<name>.json, and rewrite generated.js. */
function emit(name, docs) {
  const file = path.join(P.OUT, `${name}.json`);
  fs.writeFileSync(file, JSON.stringify(docs));
  const files = fs.readdirSync(P.OUT).filter((f) => /^a5etools-.*\.json$/.test(f)).sort();
  const entries = files.map((f) => {
    const text = fs.readFileSync(path.join(P.OUT, f), 'utf8');
    const all = JSON.parse(text);
    const types = {};
    for (const d of all) types[d.type] = (types[d.type] || 0) + 1;
    const documents = all.some((d) => ACTOR_TYPES.has(d.type)) ? 'Actor' : 'Item';
    return { file: `scripts/data/imported/${f}`, count: all.length, hash: djb2(text), types, documents, all };
  });
  const byType = {};
  for (const e of entries) for (const [t, n] of Object.entries(e.types)) byType[t] = (byType[t] || 0) + n;
  const archetypes = entries.flatMap((e) => e.all.filter((d) => d.type === 'archetype'));
  const byClass = {};
  for (const a of archetypes) (byClass[a.system.class] ??= []).push(a.name);
  const js = `/**
 * Content converted from a5e.tools by tools/import - generated, do not edit by
 * hand: change the converter or its overrides and run it again.
 *
 * The documents are in the JSON files below, fetched only when the Imported
 * compendium is built; this manifest is what the module loads, and its hash is
 * how ImportedPack knows the pack is out of date.
 *
${Object.entries(byType).map(([t, n]) => ` *   ${n} ${LABEL[t] ?? t}`).join('\n')}
 *
 * Archetypes by class:
${Object.entries(byClass).sort().map(([c, n]) => wrap(c, n.sort())).join('\n')}
 */
export const GENERATED = {
  files: [
${entries.map((e) => `    { file: '${e.file}', count: ${e.count}, documents: '${e.documents}', hash: '${e.hash}' }`).join(',\n')}
  ],
  count: ${entries.reduce((n, e) => n + e.count, 0)},
  hash: '${djb2(entries.map((e) => e.hash).join('+'))}'
};
`;
  fs.writeFileSync(path.join(P.OUT, 'generated.js'), js);
  return { file, bytes: fs.statSync(file).size, total: entries.reduce((n, e) => n + e.count, 0) };
}

module.exports = { emit, djb2 };
