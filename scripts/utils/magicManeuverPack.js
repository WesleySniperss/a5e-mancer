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
 * marking them as magic maneuvers, which is what tells them apart from a
 * combat maneuver once they are on an actor.
 */
export class MagicManeuverPack {

  static PACK_NAME = 'a5e-mancer-magic-maneuvers';
  static VERSION   = 6;          // bump to force a rebuild after data changes
  // Where the built version is recorded. A world setting, because a compendium
  // has no flag storage of its own — see #builtVersion.
  static SETTING   = 'magicManeuverPackVersion';

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
    // The built version is kept in a world setting, not on the pack.
    // CompendiumCollection is a DocumentCollection, not a Document: it has no
    // setFlag, so writing the marker there threw after the pack had already been
    // filled — the compendium existed and worked, but every reload rebuilt it
    // and reported a failure.
    const built = this.#builtVersion();
    if (pack && !force && built === this.VERSION) return pack;

    try {
      if (!pack) {
        // The namespaced class in v13+, the bare global before it. Reaching for
        // the global alone meant the pack was never created where that global is
        // gone, and the only sign was an error notification.
        const CC = foundry.documents?.collections?.CompendiumCollection
                ?? globalThis.CompendiumCollection;
        if (!CC?.createCompendium) {
          AM.log(1, 'CompendiumCollection.createCompendium is unavailable in this Foundry version');
          ui.notifications.error(`${AM.NAME}: this Foundry version does not expose the compendium API this needs.`);
          return null;
        }
        pack = await CC.createCompendium({
          label: 'Magic Maneuvers',
          name:  this.PACK_NAME,
          type:  'Item',
          packageType: 'world'
        });
        AM.log(3, 'Created the magic maneuver compendium');
      }

      await this.#populate(pack);
      await this.#rememberVersion(this.VERSION);
      ui.notifications.info(`${AM.NAME}: magic maneuver compendium ready (${MAGIC_MANEUVERS.length} entries).`);
      return pack;
    } catch (err) {
      AM.log(1, 'Could not build the magic maneuver compendium:', err);
      ui.notifications.error(`${AM.NAME}: the magic maneuver compendium could not be built — see the console.`);
      return null;
    }
  }

  /**
   * Which catalogue version the world was last built from.
   *
   * A setting rather than a flag on the pack: a compendium is a collection, not
   * a document, so it has no flag storage of its own across Foundry versions.
   * Unregistered settings throw, which on a fresh world simply means "never
   * built" — so the read is guarded and returns null.
   */
  static #builtVersion() {
    try { return game.settings.get(AM.ID, this.SETTING) ?? null; }
    catch { return null; }
  }

  static async #rememberVersion(v) {
    try { await game.settings.set(AM.ID, this.SETTING, v); }
    catch (err) {
      // Not fatal: the pack is built and usable, it will just be rebuilt again
      AM.log(2, 'Could not record the compendium version:', err);
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
   * `system.tradition` is the school. The school IS the tradition — that is what
   * lets these load, group, sort and display through a5e's and the module's
   * existing maneuver code instead of a parallel copy of it. Which classes may
   * take them is settled by CLASS_MANEUVER_TABLES.allowedTraditions, exactly as
   * for every other maneuver.
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
        tradition:    m.school,
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
      cast:      'When you cast a spell or cantrip',
      reaction:  'Reaction',
      triggered: 'On its trigger',
      special:   'Special condition'
    }[m.activation] ?? '';

    return [
      m.flavor ? `<p><em>${m.flavor}</em></p>` : '',
      `<p>${m.effect}</p>`,
      `<hr>`,
      `<p class="am-mm-meta"><strong>${schoolLabel}</strong> · ${m.degree}° · `
        + `<i class="fa-solid fa-bolt"></i> ${m.cost} exertion · ${when}</p>`
    ].filter(Boolean).join('\n');
  }

  /** Is this item one of ours? Used to keep them out of combat-maneuver lists. */
  static isMagicManeuver(entryOrItem) {
    const flags = entryOrItem?.flags ?? entryOrItem?.system?.flags ?? {};
    return !!flags?.[AM.ID]?.magicManeuver;
  }
}
