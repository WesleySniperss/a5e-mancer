import { AM } from '../a5e-mancer.js';
import { DocumentService } from './documentService.js';

/**
 * Handles levelling up a character in a5e.
 *
 * a5e level-up steps:
 *  1. Choose class to level up (or new class for multiclass)
 *  2. Choose HP method: roll hit die, take average, or enter manually
 *  3. Gain class features for the new level (auto-applied from compendium)
 *  4. At levels 4/8/12/16/19: gain ASI or Feat
 *  5. Every 2 levels: gain Exploration Knack
 *  6. Proficiency bonus updates automatically from total level
 *
 * In Foundry a5e the actor stores class items in actor.items (type='class').
 * The class item has system.classLevels (current level in that class).
 */

const HIT_DICE = {
  artificer: 8, barbarian: 12, berserker: 12, bard: 8, cleric: 8, druid: 8,
  fighter: 10, herald: 10, monk: 8, marshal: 8, paladin: 10, ranger: 10, rogue: 8,
  sorcerer: 6, warlock: 8, wizard: 6, adept: 8, psion: 6, scout: 8, trooper: 10
};

// ASI levels by class (based on CLASS level, not total level).
// Fighter gets extra ASIs at 6 and 14; Rogue gets an extra at 10.
const CLASS_ASI_LEVELS = {
  fighter:  [4, 6, 8, 12, 14, 16, 19],
  rogue:    [4, 8, 10, 12, 16, 19],
  _default: [4, 8, 12, 16, 19],
};

// Exploration Knack levels by class (based on CLASS level, every even class level).
// Most classes follow the standard schedule; list overrides here if a class differs.
const CLASS_KNACK_LEVELS = {
  _default: [2, 4, 6, 8, 10, 12, 14, 16, 18, 20],
  // e.g. someClass: [3, 6, 9, ...]
};

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
  ranger:     { and: [['dex', 13], ['wis', 13]] },
  rogue:      { and: [['dex', 13]] },
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
                  ?? HIT_DICE[i.name.toLowerCase()]
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
    const key        = cls.name?.toLowerCase() ?? '';
    const asiLevels  = CLASS_ASI_LEVELS[key]   ?? CLASS_ASI_LEVELS._default;
    const knackLevels = CLASS_KNACK_LEVELS[key] ?? CLASS_KNACK_LEVELS._default;

    const gainsASI   = asiLevels.includes(newClassLevel);
    const gainsKnack = knackLevels.includes(newClassLevel);
    const avgHP      = Math.ceil(cls.hitDie / 2) + 1;

    return { gainsASI, gainsKnack, avgHP, hitDie: cls.hitDie, newClassLevel, newTotalLevel };
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
                    ?? HIT_DICE[entry.name.toLowerCase()]
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

    // Add exploration knack
    if (knackUuid) {
      try {
        const knackItem = await fromUuid(knackUuid);
        if (knackItem) {
          const kd = knackItem.toObject();
          kd._stats = kd._stats || {};
          kd._stats.compendiumSource = knackUuid;
          await actor.createEmbeddedDocuments('Item', [kd]);
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

    // 3. Add feat / ASI item
    if (featUuid) {
      try {
        const featItem = await fromUuid(featUuid);
        if (featItem) {
          const data = featItem.toObject();
          data._stats = data._stats || {};
          data._stats.compendiumSource = featUuid;
          await actor.createEmbeddedDocuments('Item', [data]);
          AM.log(3, `Added feat: ${featItem.name}`);
        }
      } catch (err) { AM.log(2, 'Error adding feat:', err); }
    }

    // 4. Add exploration knack
    if (knackUuid) {
      try {
        const knackItem = await fromUuid(knackUuid);
        if (knackItem) {
          const data = knackItem.toObject();
          data._stats = data._stats || {};
          data._stats.compendiumSource = knackUuid;
          await actor.createEmbeddedDocuments('Item', [data]);
          AM.log(3, `Added knack: ${knackItem.name}`);
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
              img:  entry.img,
              type: entry.type
            });
          }
        }
      } catch {}
    }
    return results.sort((a, b) => a.name.localeCompare(b.name));
  }

  static async getExplorationKnacks() {
    const results = [];
    const packs = game.packs.filter(p => p.metadata.type === 'Item');
    for (const pack of packs) {
      try {
        const index = await pack.getIndex({ fields: ['name', 'type', 'img'] });
        for (const entry of index) {
          if (entry.type === 'feature' &&
            entry.name.toLowerCase().includes('knack')) {
            results.push({
              name: entry.name,
              uuid: `Compendium.${pack.collection}.${entry._id}`,
              img:  entry.img
            });
          }
        }
      } catch {}
    }
    return results.sort((a, b) => a.name.localeCompare(b.name));
  }
}
