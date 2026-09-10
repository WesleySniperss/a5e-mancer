/* The same honest DOM as sheetdom.mjs, holding a real monster out of a5e's own
 * pack and rendering the NPC sheet.
 *
 * The NPC sheet is generated from the character one and inherits its listeners,
 * so it is tempting to assume that whatever works there works here. It has not
 * always: the sheet is a different template, a different tab strip and a
 * different set of context keys, and a control can be drawn on one and not
 * reached on the other. This is where that gets settled rather than assumed.
 */
import '../stubs.mjs';
import Handlebars from 'handlebars';
import { readFileSync } from 'fs';
import { parse } from 'parse5';
import { ClassicLevel } from 'classic-level';
import { build, listeners, record, takeEffects, q, R } from './sheetdom.mjs';

export { listeners, takeEffects, q, R };

/**
 * Render the NPC sheet for one monster.
 * @param {object}   [opts]
 * @param {(all: any[]) => any} [opts.choose] which monster; the one with the
 *        most items by default, because it draws the most markup.
 */
export async function buildNPCSheet(opts = {}) {
  await import('file:///' + R + 'scripts/a5e-mancer.js');
  const { A5eNPCSheet } = await import('file:///' + R + 'scripts/app/A5eNPCSheet.js');

  Handlebars.registerHelper('eq', (a, b) => a === b);
  Handlebars.registerHelper('localize', (k) => String(k ?? ''));
  ['concat', 'numberFormat'].forEach(h => Handlebars.registerHelper(h, () => ''));
  Handlebars.registerPartial('tidy-table', readFileSync(R + 'templates/sheet/partial-tidy-table.hbs', 'utf8'));
  Handlebars.registerPartial('tidy-row',   readFileSync(R + 'templates/sheet/partial-tidy-row.hbs', 'utf8'));
  const tpl = Handlebars.compile(readFileSync(R + 'templates/sheet/npc-sheet.hbs', 'utf8'));

  /* a5e ships its packs as LevelDB. The copy is read directly; a LOCK file in
     it makes the open fail and the whole pack read as empty, which is how this
     check once reported "0 NPCs in a5e's pack" and passed. */
  const db = new ClassicLevel(R + 'packcopy2/monsters', { valueEncoding: 'json' });
  const actors = new Map(), itemsBy = new Map();
  for await (const [key, v] of db.iterator()) {
    if (key.startsWith('!actors!') && !key.includes('.')) actors.set(v._id, v);
    else if (key.startsWith('!actors.items!')) {
      const [, parentId] = key.split('!')[2].split('.');
      if (!itemsBy.has(parentId)) itemsBy.set(parentId, []);
      itemsBy.get(parentId).push(v);
    }
  }
  await db.close();

  const all = [...actors.values()].map(a => ({ actor: a, items: itemsBy.get(a._id) ?? [] }));
  const choose = opts.choose ?? ((list) => list.slice().sort((a, b) => b.items.length - a.items.length)[0]);
  const pick = choose(all);
  const raw = pick.actor;

  const wrap = (i) => {
    const it = { id: i._id, uuid: 'Actor.' + raw._id + '.Item.' + i._id, name: i.name,
      type: i.type, img: i.img, system: JSON.parse(JSON.stringify(i.system ?? {})),
      flags: i.flags ?? {}, effects: new Collection(),
      actions: new Collection(Object.entries(i.system?.actions ?? {})),
      getFlag: () => undefined, _stats: {}, parent: null,
      toObject: () => ({ ...i }), toDragData: () => ({ type: 'Item', uuid: it.uuid }) };
    for (const m of ['activate', 'configureItem', 'shareItemDescription', 'toggleAttunement',
                     'toggleDamagedState', 'toggleEquippedState', 'updateContainer', 'use',
                     'roll', 'toChat', 'share', 'delete', 'update', 'toMessage'])
      it[m] = async () => { record(`item.${m}`); return it; };
    return it;
  };

  const writes = [], flags = JSON.parse(JSON.stringify(raw.flags ?? {}));
  const actor = {
    id: raw._id, uuid: 'Actor.' + raw._id, name: raw.name, type: raw.type, isOwner: true,
    img: 'p.png', flags,
    system: JSON.parse(JSON.stringify(raw.system)),
    items: new Collection((pick.items ?? []).map(i => [i._id, wrap(i)])),
    effects: new Collection(), statuses: new Set(),
    getFlag: (s, k) => flags?.[s]?.[k],
    /* A real setFlag, because the padlock is judged by what it writes. */
    setFlag: async (s, k, v) => {
      (flags[s] ??= {})[k] = v;
      writes.push({ [`flags.${s}.${k}`]: v });
      record(`actor.setFlag ${s}.${k}=${v}`);
      return actor;
    },
    update: async (data) => { writes.push(data); record('actor.update'); return actor; },
    createEmbeddedDocuments: async () => { record('createEmbeddedDocuments'); return []; },
    updateEmbeddedDocuments: async () => { record('updateEmbeddedDocuments'); return []; },
    getRollData: () => ({}), spellBooks: { first: () => null, values: () => [] }
  };
  for (const m of ['addBonus', 'applyDamage', 'applyHealing', 'configureAbilityScore',
                   'configureBonus', 'configureSkill', 'deleteBonus', 'duplicateBonus',
                   'rollAbilityCheck', 'rollSavingThrow', 'rollSkillCheck', 'rollInitiative',
                   'toggleStatusEffect', 'triggerRest', 'configureSenses', 'configureLanguages',
                   'configureWeaponProficiencies', 'configureArmorProficiencies',
                   'configureToolProficiencies', 'configureDamageImmunities',
                   'configureDamageResistances', 'configureDamageVulnerabilities',
                   'configureConditionImmunities'])
    actor[m] = async () => { record(`actor.${m}`); return actor; };

  const sheet = new A5eNPCSheet(actor);
  sheet._actor = actor;
  sheet.render = () => { record('render'); };

  const render = async () => {
    const root = build(parse(tpl(await sheet.getData())));
    sheet.activateListeners(root);
    takeEffects();
    return root;
  };

  return { sheet, actor, flags, writes, render, root: await render(), monster: raw.name,
           population: all.length };
}
