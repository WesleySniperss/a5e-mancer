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
 * The class item has system.levels (current level in that class).
 */

const HIT_DICE = {
  artificer: 8, barbarian: 12, bard: 8, cleric: 8, druid: 8,
  fighter: 10, monk: 8, paladin: 10, ranger: 10, rogue: 8,
  sorcerer: 6, warlock: 8, wizard: 6
};

// ASI levels in a5e (same as 5e)
const ASI_LEVELS = [4, 8, 12, 16, 19];

// Exploration Knack levels (every 2 levels starting at 2)
const KNACK_LEVELS = [2, 4, 6, 8, 10, 12, 14, 16, 18, 20];

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
   */
  static getLevelUpInfo(cls, newClassLevel, newTotalLevel) {
    const gainsASI    = ASI_LEVELS.includes(newClassLevel);
    const gainsKnack  = KNACK_LEVELS.includes(newTotalLevel);
    const avgHP       = Math.ceil(cls.hitDie / 2) + 1; // average = (max+1)/2 rounded up

    return { gainsASI, gainsKnack, avgHP, hitDie: cls.hitDie, newClassLevel, newTotalLevel };
  }

  /**
   * Apply the level up to the actor.
   * @param {Actor} actor
   * @param {string} classItemId  - ID of the class item to level up
   * @param {number} hpGained     - HP to add
   * @param {string|null} featUuid - Optional feat/ASI item UUID
   * @param {string|null} knackUuid - Optional exploration knack UUID
   */
  static async applyLevelUp(actor, classItemId, hpGained, featUuid = null, knackUuid = null) {
    const classItem = actor.items.get(classItemId);
    if (!classItem) { AM.log(1, 'Class item not found:', classItemId); return false; }

    const currentLevel = classItem.system?.classLevels ?? classItem.system?.levels ?? classItem.system?.level ?? 1;
    const newLevel     = currentLevel + 1;

    // 1. Update class level (a5e uses system.classLevels)
    const levelUpdatePath = classItem.system?.classLevels !== undefined
      ? 'system.classLevels'
      : classItem.system?.levels !== undefined
        ? 'system.levels'
        : 'system.level';
    await classItem.update({ [levelUpdatePath]: newLevel });
    AM.log(3, `${classItem.name} levelled to ${newLevel}`);

    // 2. Add HP
    if (hpGained > 0) {
      const currentMax = actor.system?.attributes?.hp?.max ?? 0;
      const currentBase = actor.system?.attributes?.hp?.baseMax
                       ?? actor.system?.attributes?.hp?.max
                       ?? 0;
      // Try to update base max HP; a5e may use different paths
      const hpUpdates = {};
      if (actor.system?.attributes?.hp?.max !== undefined) {
        hpUpdates['system.attributes.hp.max'] = currentMax + hpGained;
      }
      if (actor.system?.attributes?.hp?.baseMax !== undefined) {
        hpUpdates['system.attributes.hp.baseMax'] = currentBase + hpGained;
      }
      if (Object.keys(hpUpdates).length) {
        await actor.update(hpUpdates);
      }
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

    // 5. Update proficiency bonus (auto from total level in a5e, but just in case)
    // a5e calculates this automatically, so we skip manual update

    ui.notifications.info(
      game.i18n.format('am.levelup.success', { class: classItem.name, level: newLevel }),
      { permanent: false }
    );
    return true;
  }

  /**
   * Get all feats and exploration knacks from compendiums for selection.
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
