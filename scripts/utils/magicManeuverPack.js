import { AM } from '../a5e-mancer.js';
import { MAGIC_MANEUVERS, MM_SCHOOLS, MM_SCHOOL_LORE } from '../data/magicManeuvers.js';

/**
 * Builds a world compendium of the magic maneuvers so they can be browsed,
 * dragged and read like any other maneuver.
 *
 * Shipping a module pack is not an option here: since Foundry v11 packs are
 * LevelDB, which would mean generating a binary database outside Foundry and
 * hoping it loads. Building the pack from inside Foundry uses the same API the
 * system does and is verifiable at runtime.
 *
 * The items are created as type `maneuver` on purpose — that gives them a5e's own
 * item sheet, chat card and degree/exertion display, which is what makes them sit
 * beside the combat maneuvers rather than looking bolted on. They carry a flag
 * marking them as magic maneuvers, and ManeuverService filters on it so they
 * never appear in the combat-maneuver pickers, where they would be wrong.
 */
export class MagicManeuverPack {

  static PACK_NAME = 'a5e-mancer-magic-maneuvers';
  static VERSION   = 3;          // bump to force a rebuild after data changes
  static FLAG      = 'magicManeuverPack';

  static get collection() { return `world.${this.PACK_NAME}`; }

  /** The pack, if it exists. */
  static get pack() { return game.packs.get(this.collection) ?? null; }

  /**
   * Create and fill the pack when it is missing or out of date. Safe to call on
   * every startup; it does nothing once current.
   */
  static async ensure({ force = false } = {}) {
    if (!game.user.isGM) return null;                     // only a GM may create packs
    if (!game.settings.get(AM.ID, 'buildMagicManeuverPack')) return null;

    let pack = this.pack;
    const built = pack?.getFlag?.(AM.ID, this.FLAG) ?? pack?.metadata?.flags?.[AM.ID]?.[this.FLAG];

    if (pack && !force && built === this.VERSION) return pack;

    try {
      if (!pack) {
        pack = await CompendiumCollection.createCompendium({
          label: 'Magic Maneuvers',
          name:  this.PACK_NAME,
          type:  'Item',
          packageType: 'world'
        });
        AM.log(3, 'Created the magic maneuver compendium');
      }

      await this.#populate(pack);
      await pack.setFlag(AM.ID, this.FLAG, this.VERSION);
      ui.notifications.info(`${AM.NAME}: magic maneuver compendium ready (${MAGIC_MANEUVERS.length} entries).`);
      return pack;
    } catch (err) {
      AM.log(1, 'Could not build the magic maneuver compendium:', err);
      ui.notifications.error(`${AM.NAME}: the magic maneuver compendium could not be built — see the console.`);
      return null;
    }
  }

  /** Replace the pack's contents with the current catalogue. */
  static async #populate(pack) {
    const wasLocked = pack.locked;
    if (wasLocked) await pack.configure({ locked: false });

    try {
      // Clear first, so a rebuild after a data change leaves nothing stale
      const existing = await pack.getDocuments();
      if (existing.length) {
        await Item.deleteDocuments(existing.map(d => d.id), { pack: pack.collection });
      }

      await Item.createDocuments(MAGIC_MANEUVERS.map(m => this.itemData(m)),
                                 { pack: pack.collection, keepId: false });
      AM.log(3, `Magic maneuver compendium filled with ${MAGIC_MANEUVERS.length} entries`);
    } finally {
      if (wasLocked) await pack.configure({ locked: true });
    }
  }

  /**
   * One maneuver as an a5e maneuver item.
   *
   * `system.tradition` is deliberately left empty: these belong to schools, not
   * combat traditions, and writing a tradition key would file them under a
   * tradition the character may not even have.
   *
   * The action matters more than it looks. `system.exertionCost` is display only
   * — the system spends exertion through a resource consumer on an action, so
   * without one the card would advertise a cost and charge nothing. With it,
   * using the maneuver deducts the points through a5e's own path, which is the
   * whole automation these need: the effects are narrated and applied by hand.
   */
  static itemData(m) {
    const schoolLabel = MM_SCHOOLS[m.school] ?? m.school;
    const actionId    = foundry.utils.randomID();
    const consumerId  = foundry.utils.randomID();

    return {
      name: m.name,
      type: 'maneuver',
      img:  'icons/magic/symbols/runes-star-blue.webp',
      system: {
        description:  this.#describe(m, schoolLabel),
        degree:       m.degree,
        exertionCost: m.cost,
        tradition:    '',
        source:       'A5e Mancer — Magic Maneuvers',
        actions: {
          [actionId]: {
            id:      actionId,
            name:    m.name,
            default: true,
            activation: { cost: 1, type: this.#activationType(m), reactionTrigger: '' },
            consumers: {
              [consumerId]: {
                type:            'resource',
                resource:        'exertion',
                quantity:        m.cost,
                classIdentifier: '',
                restore:         false,
                default:         true,
                label:           ''
              }
            }
          }
        }
      },
      flags: {
        [AM.ID]: {
          magicManeuver: true,          // what ManeuverService filters on
          maneuverId:    m.id,
          school:        m.school,
          trigger:       m.trigger,
          damageType:    m.damageType ?? null,
          activation:    m.activation
        }
      }
    };
  }

  /**
   * Our activation vocabulary onto a5e's. `cast` and `triggered` both become
   * `special`: they ride along with something else the character is already
   * doing, so calling them an action would misstate the cost.
   */
  static #activationType(m) {
    return m.activation === 'reaction' ? 'reaction' : 'special';
  }

  /**
   * Item description: italic flavour first, then the mechanical text, as the
   * specification asks. The school's own text belongs to the school and is not
   * repeated onto every maneuver.
   */
  static #describe(m, schoolLabel) {
    const when = {
      cast:      'При касті власного закляття',
      reaction:  'Реакція',
      triggered: 'За тригером',
      special:   'Особлива умова'
    }[m.activation] ?? '';

    return [
      m.flavor ? `<p><em>${m.flavor}</em></p>` : '',
      `<p>${m.effect}</p>`,
      `<hr>`,
      `<p class="am-mm-meta"><strong>${schoolLabel}</strong> · ${m.degree}° · `
        + `<i class="fa-solid fa-bolt"></i> ${m.cost} виснаження · ${when}</p>`
    ].filter(Boolean).join('\n');
  }

  /** Is this item one of ours? Used to keep them out of combat-maneuver lists. */
  static isMagicManeuver(entryOrItem) {
    const flags = entryOrItem?.flags ?? entryOrItem?.system?.flags ?? {};
    return !!flags?.[AM.ID]?.magicManeuver;
  }
}
