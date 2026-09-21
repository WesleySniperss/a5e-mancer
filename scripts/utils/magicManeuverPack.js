import { AM } from '../am.js';
import { MAGIC_MANEUVERS, MM_SCHOOLS, MM_PROGRESSION } from '../data/magicManeuvers.js';
import { indexFieldsFor } from './compendiumIndexFix.js';
import { GrantAbsorber } from './grantAbsorber.js';

/* One icon each, from Foundry's own set as a5e's maneuvers are. All of them
   shared one rune before, so in the compendium browser and the sidebar the
   whole catalogue read as one repeated entry among a5e's pictures. */
const ICON = 'icons/magic/';
const MM_ICONS = {
  ice:             'water/snowflake-ice-blue.webp',
  acid:            'acid/dissolve-drip-droplet-smoke.webp',
  fire:            'fire/beam-jet-stream-embers.webp',
  thunder:         'sonic/explosion-shock-sound-wave.webp',
  lightning:       'lightning/bolt-forked-blue.webp',
  poison:          'death/skull-poison-green.webp',
  force:           'sonic/explosion-impact-shock-wave.webp',
  psychic:         'control/hypnosis-mesmerism-swirl.webp',
  necrotic:        'unholy/strike-body-life-soul-purple.webp',
  radiant:         'light/beam-rays-yellow.webp',
  peak:            'symbols/star-rising-purple.webp',
  bypass:          'movement/trail-streak-impact-blue.webp',
  reflection:      'light/beam-impact-deflect-teal.webp',
  bend:            'light/beam-deflect-path-yellow.webp',
  seeking:         'perception/shadow-stealth-eyes-purple.webp',
  pressure:        'sonic/projectile-shock-wave-blue.webp',
  resonance:       'sonic/projectile-sound-rings-wave.webp',
  suggestion:      'control/hypnosis-mesmerism-pendulum.webp',
  countercast:     'defensive/shield-barrier-deflect-gold.webp',
  'generous-hand': 'life/heart-hand-gold-green.webp',
  cleansing:       'life/cross-beam-green.webp',
  recall:          'time/arrows-circling-green.webp',
  harvest:         'death/skeleton-skull-soul-blue.webp',
  ricochet:        'movement/trail-streak-zigzag-teal.webp',
  riposte:         'defensive/shield-barrier-blades-teal.webp',
  steadfast:       'defensive/armor-stone-skin.webp',
  insight:         'perception/third-eye-blue-red.webp',
  premonition:     'perception/orb-crystal-ball-scrying-blue.webp',
  farsight:        'time/hourglass-tilted-glowing-gold.webp'
};

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
  static VERSION   = 12;         // bump to force a rebuild after data changes
  /* The feature that gives a magic maneuver caster its exertion pool, kept
     under one id so a character's copy is always recognisable. */
  static FEATURE_ID = 'amMagicManeuvers';
  /* The source every item names, registered as an a5e product (registerSource)
     so the browser shows it the way it shows AG beside a5e's own - and a5e's
     own setting for hiding a source from the browser can hide these too. */
  static SOURCE    = 'a5eMancerMagicManeuvers';
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
      const created = !pack;
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
      /* Beside a5e's maneuvers in the sidebar - once: when the pack is made, or
         the first time a world built before this rebuilds it. A GM who moves it
         afterwards keeps it where they put it. */
      if (created || (Number(built) || 0) < 11) await this.#placeBesideSystemManeuvers(pack);
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

  /** Into the compendium folder that holds a5e's own maneuvers, if it has one. */
  static async #placeBesideSystemManeuvers(pack) {
    try {
      if (pack.folder) return;
      const folder = game.packs.get('a5e.a5e-maneuvers')?.folder ?? null;
      if (folder) await pack.setFolder(folder);
    } catch (err) {
      AM.log(2, 'Could not put the magic maneuver compendium beside a5e\'s maneuvers:', err);
    }
  }

  /**
   * Register the source as an a5e product. a5e reads CONFIG.A5E.products for
   * the source mark on a browser row and an item sheet, and for its own
   * setting that hides a source from the browser.
   */
  static registerSource() {
    const products = CONFIG.A5E?.products;
    if (!products || products[this.SOURCE]) return;
    products[this.SOURCE] = {
      abbreviation: 'MM',
      affiliate: false,
      publisher: '',
      systems: ['a5e'],
      title: 'A5e Mancer: Magic Maneuvers',
      url: 'https://github.com/WesleySniperss/a5e-mancer'
    };
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

      // keepId for the feature's fixed id; the maneuvers carry none and get new ones
      await Item.createDocuments([this.featureData(), ...MAGIC_MANEUVERS.map(m => this.itemData(m))],
                                 { pack: pack.collection, keepId: true });
      /* The index a5e's browser filters and labels from. The system builds it
         at setup, before this pack is filled - without the system fields a
         rebuilt entry has no degree, school or exertion to filter on, and its
         row carries no "1st degree Elements (1 exertion point)" line. */
      await pack.getIndex({ fields: [...indexFieldsFor('maneuver'), 'flags'] });
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
    const actionId    = foundry.utils.randomID();
    const consumerId  = foundry.utils.randomID();

    return {
      name: m.name,
      type: 'maneuver',
      img:  ICON + (MM_ICONS[m.id] ?? 'symbols/runes-star-blue.webp'),
      system: {
        description:  this.#describe(m),
        degree:       m.degree,
        exertionCost: m.cost,
        tradition:    m.school,
        source:       this.SOURCE,
        actions: {
          [actionId]: {
            id:      actionId,
            name:    m.name,
            default: true,
            activation: { cost: 1, type: this.#activationType(m), reactionTrigger: m.reactionTrigger ?? '' },
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
    if (m.activation === 'reaction') return 'reaction';
    if (m.activation === 'bonusAction') return 'bonusAction';
    return 'special';
  }

  /**
   * Item description, in the shape a5e's own maneuvers use: the flavour line as
   * a plain first paragraph, then the mechanical text. Nothing else - no icon,
   * rule or summary line. Degree, exertion and tradition are item fields the
   * sheet and the pickers already show, and a card that repeated them with a
   * bolt, a degree sign and a bold school name stood out from every other
   * maneuver beside it. The school's own text belongs to the school.
   */
  static #describe(m) {
    return [
      m.flavor ? `<p>${m.flavor}</p>` : '',
      `<p>${m.effect}</p>`
    ].filter(Boolean).join('');
  }

  /**
   * The Magic Maneuvers feature: what a combat class's Combat Maneuvers feature
   * is to a fighter. Its exertion grant is what gives the pool - a5e sizes a
   * character's pool from the exertion grants on its features and nothing else,
   * so a wizard with magic maneuvers and no such feature had a pool of 0 and
   * could not pay for a single one. Twice the proficiency bonus, regained on a
   * short or long rest, as the combat maneuver classes have; a5e takes the
   * larger pool rather than adding them, so a fighter-wizard keeps one pool.
   */
  static featureData() {
    const ord = (n) => `${n}${n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'}`;
    const rows = MM_PROGRESSION.map(r =>
      `<tr><td>${ord(r.level)}</td><td>${r.known}</td><td>${r.schools}</td><td>${ord(r.maxDegree)}</td></tr>`).join('');
    return {
      _id: this.FEATURE_ID, name: 'Magic Maneuvers', type: 'feature',
      img: 'icons/magic/symbols/runes-star-pentagon-blue.webp',
      system: {
        description:
          `<p>You shape your spells with magic maneuvers, learned from the schools of magic: ${Object.values(MM_SCHOOLS).join(', ')}. You use them by spending exertion.</p>`
          + '<p><strong>Exertion.</strong> You have an exertion pool equal to twice your proficiency bonus, and you regain any exertion you have spent when you finish a short or long rest. An exertion pool from another feature is the same pool: they do not add up.</p>'
          + '<p><strong>Learning.</strong> The table shows how many magic maneuvers you know, from how many schools, and the highest degree you can learn, by your levels in the classes that learn them. Whenever you gain a level in such a class, you can replace one magic maneuver you know with another.</p>'
          + '<table border="1"><thead><tr><td>Level</td><td>Maneuvers Known</td><td>Schools</td><td>Maneuver Degree</td></tr></thead>'
          + `<tbody>${rows}</tbody></table>`
          + '<p><strong>Saving throws.</strong> A magic maneuver that calls for one uses your spell save DC.</p>',
        secretDescription: '', source: this.SOURCE,
        featureType: 'class', classes: '', class: '', prerequisite: '', requiresBloodied: false,
        concentration: false, favorite: false,
        uses: { value: 0, max: '', per: '', recharge: { formula: '1d6', threshold: 6 } },
        actions: {},
        grants: {
          amMMExertionPool: { _id: 'amMMExertionPool', grantType: 'exertion', exertionType: 'pool', poolType: 'doubleProf',
                              bonus: '', level: 1, levelType: 'character', optional: false, label: 'Exertion Pool', img: '' }
        }
      },
      flags: { [AM.ID]: { magicManeuverFeature: true } },
      effects: []
    };
  }

  /** Does this character know a magic maneuver, and lack the feature? */
  static #owesPool(actor) {
    if (actor?.type !== 'character') return false;
    const items = [...(actor.items ?? [])];
    if (items.some(i => i.flags?.[AM.ID]?.magicManeuverFeature)) return false;
    return items.some(i => i.type === 'maneuver' && Object.hasOwn(MM_SCHOOLS, i.system?.tradition ?? ''));
  }

  static #pending = new Map();

  /**
   * Give a character who knows a magic maneuver the Magic Maneuvers feature,
   * and with it the exertion pool, once. Created without a5e's grant window and
   * its grant applied here, the way the builder adds a feature.
   */
  static async ensurePool(actor) {
    if (!this.#owesPool(actor)) return null;
    // One at a time per character: the sweep and a new maneuver can meet
    if (this.#pending.has(actor.id)) return this.#pending.get(actor.id);
    const run = (async () => {
      const charLevel = [...actor.items].filter(i => i.type === 'class')
        .reduce((n, c) => n + (Number(c.system?.classLevels) || 0), 0) || 1;
      const [created] = await actor.createEmbeddedDocuments('Item', [this.featureData()], { noGrant: true });
      if (created) await GrantAbsorber.apply(actor, created, {}, { charLevel, clsLevel: charLevel });
      AM.log(3, `${actor.name}: Magic Maneuvers feature added, with its exertion pool`);
      return created ?? null;
    })();
    this.#pending.set(actor.id, run);
    try { return await run; }
    catch (err) { AM.log(1, `${actor.name}: the Magic Maneuvers feature could not be added:`, err); return null; }
    finally { this.#pending.delete(actor.id); }
  }

  /**
   * A magic maneuver arriving by any road - the level-up, the manage window,
   * a drop from the compendium - brings the pool with it. Only on the client
   * that made the change, or every connected player would add one.
   */
  static installHooks() {
    Hooks.on('createItem', (item, _options, userId) => {
      if (userId !== game.user?.id || item?.type !== 'maneuver') return;
      if (!Object.hasOwn(MM_SCHOOLS, item.system?.tradition ?? '')) return;
      const actor = item.parent;
      if (!actor) return;
      clearTimeout(this.#timers.get(actor.id));
      this.#timers.set(actor.id, setTimeout(() => {
        this.#timers.delete(actor.id);
        this.ensurePool(actor);
      }, 500));
    });
  }
  static #timers = new Map();

  /** For the GM, once a session: the characters who learned magic maneuvers before this. */
  static async sweep() {
    if (!game.user?.isGM) return 0;
    let n = 0;
    for (const actor of game.actors ?? []) {
      if (this.#owesPool(actor) && await this.ensurePool(actor)) n++;
    }
    if (n) AM.log(3, `Magic Maneuvers feature given to ${n} character(s) who knew magic maneuvers without an exertion pool`);
    return n;
  }

  /** Is this item one of ours? Used to keep them out of combat-maneuver lists. */
  static isMagicManeuver(entryOrItem) {
    const flags = entryOrItem?.flags ?? entryOrItem?.system?.flags ?? {};
    return !!flags?.[AM.ID]?.magicManeuver;
  }
}
