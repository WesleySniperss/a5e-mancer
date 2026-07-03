import { AM } from '../a5e-mancer.js';
import { DocumentService } from './documentService.js';
import { A5E_CLASS_DATA, classKey as classKeyOf } from '../data/a5eClassData.js';
import { iconForItem, applyItemIcon } from '../data/a5eIcons.js';

/**
 * Handles levelling up a character in a5e.
 *
 * a5e level-up steps:
 *  1. Choose class to level up (or new class for multiclass)
 *  2. Choose HP method: roll hit die, take average, or enter manually
 *  3. Gain class features for the new level (auto-applied from compendium)
 *  4. At levels 4/8/12/16/19: gain ASI or Feat (universal in A5e — all classes)
 *  5. Gain the class's knack-equivalent on its own schedule. EVERY A5e class has a
 *     knack-type feature, but named differently per class (Soldiering Knack, Skill
 *     Trick, Developed Talent, Sign of Faith, …) and gained at different levels.
 *     Names + cadences live in A5E_CLASS_DATA (verified from a5e.tools).
 *  6. Proficiency bonus updates automatically from total level
 *
 * In Foundry a5e the actor stores class items in actor.items (type='class').
 * The class item has system.classLevels (current level in that class).
 */

// Hit dice — authoritative A5e values come from A5E_CLASS_DATA (verified against
// a5e.tools). The few 5e-only names below are non-A5e fallbacks (A5e replaces them
// with Berserker/Adept/Herald) kept only so homebrew/imports don't break.
// This map is a LAST-RESORT fallback: getActorClasses reads the compendium first.
const HIT_DICE = {
  barbarian: 12, monk: 8, paladin: 10,
  ...Object.fromEntries(Object.entries(A5E_CLASS_DATA).map(([k, v]) => [k, v.hitDie])),
};

// ASI levels (based on CLASS level, not total level).
// In A5e (unlike D&D 5e) the schedule is UNIVERSAL: every class gains an ASI/Feat
// at 4, 8, 12, 16, 19 — there are NO class-specific extras. Verified against the
// official Fighter/Rogue/Wizard tables on a5e.tools: the 5e Fighter +6/+14 and
// Rogue +10 ASIs do not exist in A5e (those levels grant other features instead).
const ASI_LEVELS = [4, 8, 12, 16, 19];

/**
 * Multiclass prerequisites per A5e (Level Up: Advanced 5e) rules.
 * "and" = all must be met; "or" = any one suffices.
 * Each entry is [abilityKey, minimumScore].
 */
const CLASS_PREREQUISITES = {
  adept:      { and: [['dex', 13], ['wis', 13]] },
  artificer:  { and: [['int', 13]] },
  barbarian:  { and: [['str', 13]] },
  berserker:  { and: [['str', 13]] },
  bard:       { and: [['cha', 13]] },
  cleric:     { and: [['wis', 13]] },
  druid:      { and: [['wis', 13]] },
  fighter:    { or:  [['str', 13], ['dex', 13]] },
  herald:     { and: [['str', 13], ['cha', 13]] },
  marshal:    { and: [['cha', 13]] },
  monk:       { and: [['dex', 13], ['wis', 13]] },
  paladin:    { and: [['str', 13], ['cha', 13]] },
  psion:      { and: [['int', 13]] },
  psyknight:  { and: [['wis', 13]] },
  ranger:     { and: [['dex', 13], ['wis', 13]] },
  rogue:      { and: [['dex', 13]] },
  savant:     { and: [['int', 13]] },
  scientist:  { and: [['int', 13]] },
  scout:      { or:  [['cha', 13], ['dex', 13]] },
  sorcerer:   { and: [['cha', 13]] },
  trooper:    { and: [['con', 13]] },
  warlock:    { or:  [['int', 13], ['wis', 13], ['cha', 13]] },
  wizard:     { and: [['int', 13]] },
};

export class LevelUpService {

  /**
   * Get all current class items on an actor with their level data.
   */
  static getActorClasses(actor) {
    return actor.items
      .filter(i => i.type === 'class')
      .map(i => ({
        id:       i.id,
        name:     i.name,
        level:    i.system?.classLevels ?? i.system?.levels ?? i.system?.level ?? 1,
        hitDie:   i.system?.hp?.hitDiceSize
                  ?? i.system?.hitDice?.denomination
                  ?? i.system?.hitDie
                  ?? HIT_DICE[classKeyOf(i.name)]
                  ?? 8,
        img:      i.img,
        uuid:     i.getFlag('core', 'sourceId') ?? i.flags?.core?.sourceId ?? null
      }));
  }

  /**
   * Total character level across all classes.
   */
  static getTotalLevel(actor) {
    return this.getActorClasses(actor)
      .reduce((sum, cls) => sum + cls.level, 0);
  }

  /**
   * Get what the actor gains at a given class + total level.
   * Both ASI and Exploration Knack are based on CLASS level, not total level —
   * each class has its own progression table.
   */
  static getLevelUpInfo(cls, newClassLevel, newTotalLevel) {
    const knack      = A5E_CLASS_DATA[classKeyOf(cls.name)]?.knack ?? null;
    const knackLevels = knack?.levels ?? [];

    const gainsASI   = ASI_LEVELS.includes(newClassLevel);
    const gainsKnack = knackLevels.includes(newClassLevel);
    const knackName  = knack?.name ?? null;
    const avgHP      = Math.ceil(cls.hitDie / 2) + 1;

    return { gainsASI, gainsKnack, knackName, avgHP, hitDie: cls.hitDie, newClassLevel, newTotalLevel };
  }

  /**
   * Check whether the actor meets multiclass prerequisites for a given class.
   * Returns { meets: boolean, missing: string[], missingText: string }
   */
  static checkPrerequisites(actor, className) {
    const key = className.toLowerCase().replace(/[^a-z]/g, '');
    const prereqs = CLASS_PREREQUISITES[key];
    if (!prereqs) return { meets: true, missing: [], missingText: '' };

    const abilities = actor.system?.abilities ?? {};
    const score = (ab) => abilities[ab]?.value ?? 0;

    if (prereqs.and) {
      const missing = prereqs.and
        .filter(([ab, min]) => score(ab) < min)
        .map(([ab, min]) => `${ab.toUpperCase()} ${min}+`);
      return { meets: missing.length === 0, missing, missingText: missing.join(', ') };
    }
    if (prereqs.or) {
      const meets = prereqs.or.some(([ab, min]) => score(ab) >= min);
      if (meets) return { meets: true, missing: [], missingText: '' };
      const reqs = prereqs.or.map(([ab, min]) => `${ab.toUpperCase()} ${min}+`).join(' or ');
      return { meets: false, missing: [reqs], missingText: reqs };
    }
    return { meets: true, missing: [], missingText: '' };
  }

  /**
   * Get all class items available in compendiums.
   */
  static async getCompendiumClasses() {
    const results = [];
    for (const pack of game.packs.filter(p => p.metadata.type === 'Item')) {
      try {
        const index = await pack.getIndex({ fields: ['name', 'type', 'img', 'system'] });
        for (const entry of index) {
          if (entry.type !== 'class') continue;
          results.push({
            name:   entry.name,
            uuid:   `Compendium.${pack.collection}.${entry._id}`,
            img:    entry.img,
            hitDie: entry.system?.hp?.hitDiceSize
                    ?? HIT_DICE[classKeyOf(entry.name)]
                    ?? 8,
          });
        }
      } catch {}
    }
    return results.sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Apply a multiclass entry: add new class at level 1 + HP.
   */
  static async applyMulticlass(actor, classUuid, hpGained, knackUuid = null) {
    const classDoc = await fromUuid(classUuid);
    if (!classDoc) { AM.log(1, 'Multiclass: class not found', classUuid); return false; }

    // Prevent adding a class the actor already has
    const alreadyHasClass = actor.items.some(i =>
      i.type === 'class' && (
        (i._stats?.compendiumSource ?? i.flags?.core?.sourceId) === classUuid ||
        i.name.toLowerCase() === classDoc.name.toLowerCase()
      )
    );
    if (alreadyHasClass) {
      AM.log(2, `Multiclass aborted: actor already has ${classDoc.name}`);
      ui.notifications.warn(`${classDoc.name} is already one of this character's classes.`);
      return false;
    }

    const data = classDoc.toObject();
    // Force level 1 regardless of what the compendium item says
    if (data.system?.classLevels !== undefined)     data.system.classLevels = 1;
    else if (data.system?.levels !== undefined)     data.system.levels = 1;
    else if (data.system?.level !== undefined)      data.system.level = 1;
    data._stats = data._stats || {};
    data._stats.compendiumSource = classUuid;

    await actor.createEmbeddedDocuments('Item', [data]);
    AM.log(3, `Multiclassed into ${classDoc.name}`);

    // Add HP
    if (hpGained > 0) {
      const hp = actor.system?.attributes?.hp;
      const updates = {};
      if (hp?.max !== undefined)     updates['system.attributes.hp.max']     = hp.max + hpGained;
      if (hp?.baseMax !== undefined) updates['system.attributes.hp.baseMax'] = hp.baseMax + hpGained;
      if (Object.keys(updates).length) await actor.update(updates);
    }

    // Add exploration knack (skip if already present)
    if (knackUuid) {
      try {
        const alreadyHasKnack = actor.items.some(i =>
          (i._stats?.compendiumSource ?? i.flags?.core?.sourceId) === knackUuid
        );
        if (!alreadyHasKnack) {
          const knackItem = await fromUuid(knackUuid);
          if (knackItem) {
            const kd = knackItem.toObject();
            kd._stats = kd._stats || {};
            kd._stats.compendiumSource = knackUuid;
            applyItemIcon(kd);
            await actor.createEmbeddedDocuments('Item', [kd]);
          }
        }
      } catch (err) { AM.log(2, 'Error adding knack on multiclass:', err); }
    }

    ui.notifications.info(
      game.i18n.format('am.levelup.multiclass-success', { class: classDoc.name }),
      { permanent: false }
    );
    return true;
  }

  /**
   * Apply the level up to the actor.
   */
  static async applyLevelUp(actor, classItemId, hpGained, featUuid = null, knackUuid = null) {
    const classItem = actor.items.get(classItemId);
    if (!classItem) { AM.log(1, 'Class item not found:', classItemId); return false; }

    const currentLevel = classItem.system?.classLevels ?? classItem.system?.levels ?? classItem.system?.level ?? 1;
    const newLevel     = currentLevel + 1;

    // 1. Update class level
    const levelUpdatePath = classItem.system?.classLevels !== undefined
      ? 'system.classLevels'
      : classItem.system?.levels !== undefined
        ? 'system.levels'
        : 'system.level';
    await classItem.update({ [levelUpdatePath]: newLevel });
    AM.log(3, `${classItem.name} levelled to ${newLevel}`);

    // 2. Add HP
    if (hpGained > 0) {
      const currentMax  = actor.system?.attributes?.hp?.max ?? 0;
      const currentBase = actor.system?.attributes?.hp?.baseMax ?? currentMax;
      const hpUpdates = {};
      if (actor.system?.attributes?.hp?.max !== undefined)
        hpUpdates['system.attributes.hp.max'] = currentMax + hpGained;
      if (actor.system?.attributes?.hp?.baseMax !== undefined)
        hpUpdates['system.attributes.hp.baseMax'] = currentBase + hpGained;
      if (Object.keys(hpUpdates).length) await actor.update(hpUpdates);
      AM.log(3, `Added ${hpGained} HP`);
    }

    // 3. Add feat / ASI item (skip if already present)
    if (featUuid) {
      try {
        const alreadyHasFeat = actor.items.some(i =>
          (i._stats?.compendiumSource ?? i.flags?.core?.sourceId) === featUuid
        );
        if (!alreadyHasFeat) {
          const featItem = await fromUuid(featUuid);
          if (featItem) {
            const data = featItem.toObject();
            data._stats = data._stats || {};
            data._stats.compendiumSource = featUuid;
            applyItemIcon(data);
            await actor.createEmbeddedDocuments('Item', [data]);
            AM.log(3, `Added feat: ${featItem.name}`);
          }
        } else {
          AM.log(2, `Feat already exists, skipping: ${featUuid}`);
        }
      } catch (err) { AM.log(2, 'Error adding feat:', err); }
    }

    // 4. Add exploration knack (skip if already present)
    if (knackUuid) {
      try {
        const alreadyHasKnack = actor.items.some(i =>
          (i._stats?.compendiumSource ?? i.flags?.core?.sourceId) === knackUuid
        );
        if (!alreadyHasKnack) {
          const knackItem = await fromUuid(knackUuid);
          if (knackItem) {
            const data = knackItem.toObject();
            data._stats = data._stats || {};
            data._stats.compendiumSource = knackUuid;
            applyItemIcon(data);
            await actor.createEmbeddedDocuments('Item', [data]);
            AM.log(3, `Added knack: ${knackItem.name}`);
          }
        } else {
          AM.log(2, `Knack already exists, skipping: ${knackUuid}`);
        }
      } catch (err) { AM.log(2, 'Error adding knack:', err); }
    }

    ui.notifications.info(
      game.i18n.format('am.levelup.success', { class: classItem.name, level: newLevel }),
      { permanent: false }
    );
    return true;
  }

  /**
   * Get all feats from compendiums for ASI selection.
   */
  static async getFeats() {
    const results = [];
    const featPacks = game.packs.filter(p => p.metadata.type === 'Item');
    for (const pack of featPacks) {
      try {
        const index = await pack.getIndex({ fields: ['name', 'type', 'img', 'system'] });
        for (const entry of index) {
          if (entry.type === 'feat' || entry.type === 'feature') {
            results.push({
              name: entry.name,
              uuid: `Compendium.${pack.collection}.${entry._id}`,
              img:  iconForItem(entry.name, entry.type, entry.img ?? '') ?? entry.img,
              type: entry.type
            });
          }
        }
      } catch {}
    }
    return results.sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Get the knack-equivalent features a class can pick (Soldiering Knacks, Skill
   * Tricks, Elective Studies, Signs of Faith, …). Every A5e class has these but they
   * are named per class via CONFIG.A5E.knackTypes and are not always tagged
   * featureType==='knack' in the compendium — so matching is tiered and degrades
   * gracefully so the picker is never empty when a knack is actually due.
   *
   * @param {string|null} className - Class name to filter for (e.g. "Fighter"). null = all.
   */
  static async getExplorationKnacks(className = null) {
    const key   = className ? classKeyOf(className) : null;
    const packs = game.packs.filter(p => p.metadata.type === 'Item');

    // Singular/plural-tolerant stem so "Elective Study" matches "Elective Studies".
    const norm = s => (s ?? '').toLowerCase().replace(/[^a-z]/g, '');
    const fold = s => norm(s).replace(/(ies|es|s|y)$/, '');
    const knackName = key ? (CONFIG.A5E?.knackTypes?.[key] ?? null) : null;
    const knackStem = knackName ? fold(knackName) : null;            // e.g. "electivestud"

    const nameIsClassKnack = (name) => !!knackStem && fold(name).includes(knackStem);

    const classMatches = (entry) => {
      if (!key) return true;
      const raw   = entry.system?.classes ?? entry.system?.classIdentifier ?? '';
      const cands = Array.isArray(raw) ? raw
                  : (raw && typeof raw === 'object') ? Object.keys(raw)
                  : (typeof raw === 'string' && raw) ? [raw] : [];
      if (cands.some(c => { const ck = norm(c); return ck && (ck.includes(key) || key.includes(ck)); })) return true;
      return nameIsClassKnack(entry.name);            // item name embeds this class's knack name
    };

    const isKnackType = (e) => (e.system?.featureType ?? '').toLowerCase() === 'knack';

    // Collect features matching a predicate, deduped by uuid.
    const collect = async (predicate) => {
      const out = [], seen = new Set();
      for (const pack of packs) {
        try {
          const index = await pack.getIndex({ fields: ['name', 'type', 'img', 'system'] });
          for (const entry of index) {
            if (entry.type !== 'feature' || !predicate(entry)) continue;
            const uuid = `Compendium.${pack.collection}.${entry._id}`;
            if (seen.has(uuid)) continue;
            seen.add(uuid);
            out.push({ name: entry.name, uuid, img: iconForItem(entry.name, 'feature', entry.img ?? '') ?? entry.img });
          }
        } catch {}
      }
      return out;
    };

    // Tier 1: tagged as a knack AND belongs to this class.
    let results = await collect(e => isKnackType(e) && classMatches(e));
    // Tier 2: name embeds this class's knack name, whatever the featureType
    //         (covers classes whose picks aren't tagged 'knack', e.g. Wizard Elective Studies).
    if (!results.length && knackStem) results = await collect(e => nameIsClassKnack(e.name));
    // Tier 3: any knack-typed feature, so the picker is never empty when one is due.
    if (!results.length)              results = await collect(isKnackType);

    return results.sort((a, b) => a.name.localeCompare(b.name));
  }
}
