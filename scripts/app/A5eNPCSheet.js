import { AM } from '../am.js';
import { A5eCharacterSheet } from './A5eCharacterSheet.js';

const MODULE_ID = 'a5e-mancer';

/**
 * The NPC sheet, in the same clothes as the character sheet.
 *
 * The old one was a statblock reader of its own: three hundred lines that
 * guessed at a5e's data paths with a chain of `??` fallbacks, most of which
 * a5e has never used. It read system.traits.dr, system.details.type,
 * system.attributes.legact — none of which exist. What it showed was whatever
 * the last fallback in each chain happened to return.
 *
 * This one does what a5e itself does. a5e has a single ActorSheet for both
 * kinds of actor and adapts it, and when the character sheet here was fed a
 * real monster out of a5e's pack — an Adult Red Dragon, 21 items — it built
 * its context and rendered without a single failure: six abilities, twenty-one
 * skills, fifteen features, six maneuvers, an inventory. There was never a
 * second sheet's worth of work here. So this is that sheet, subclassed, with
 * the parts a monster does not have replaced by the parts it does.
 *
 * What changes: the subtitle, which carries creature type, size, terrain and
 * challenge rating where a character carries classes and level; and the first
 * tab, which is the statblock — every action the monster has, grouped the way
 * the book groups them.
 */
export class A5eNPCSheet extends A5eCharacterSheet {

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      /* Same Tidy classes as the character sheet, with `npc` in place of
         `character`. Tidy scopes a handful of its own rules to
         :where(.quadrone.actor):where(.npc) — the vitals block chiefly — so the
         class earns its place rather than just naming the thing. */
      classes: ['tidy5e-sheet', 'application', 'sheet', 'actor', 'npc',
                'quadrone', 'themed', 'theme-dark',
                'a5e-mancer-sheet', 'a5e-mancer-npc-sheet'],
      template: `modules/${MODULE_ID}/templates/sheet/npc-sheet.hbs`,
      /* A monster needs less width than a character: no class resources, no
         spell-slot ladder in the strip. */
      width: 760,
      height: 820,
      tabs: [{ navSelector: '.actor-tabs', contentSelector: '.main-content',
               initial: 'statblock' }],
      dragDrop: [{ dragSelector: '.tidy-table-row-container[data-item-id]',
                   dropSelector: '.main-content' }]
    });
  }

  /* ── Context ──────────────────────────────────────── */

  async getData() {
    const data  = await super.getData();
    const actor = this.actor;
    const sys   = actor.system ?? {};

    data.npc       = this.#npcHeader(sys);
    data.statblock = this.#statblock();
    return data;
  }

  /**
   * What stands where a character's class and level stand.
   *
   * Every path here was read off a5e's own monster pack rather than guessed:
   * details.creatureTypes is an array, details.cr a number, traits.size a
   * lowercase key, and the languages a monster speaks live under
   * proficiencies.languages, not under traits.
   */
  #npcHeader(sys) {
    const det = sys.details ?? {};
    const cr  = Number(det.cr ?? 0);

    const types = (Array.isArray(det.creatureTypes) ? det.creatureTypes : [])
      .map(t => this.#label('creatureTypes', t));
    const terrain = (Array.isArray(det.terrain) ? det.terrain : [])
      .map(t => this.#label('terrainTypes', t));

    /* The tags a5e keeps as flags of their own rather than as a creature type. */
    const tags = [];
    if (det.elite)   tags.push(game.i18n.localize('am.npc.elite'));
    if (det.isSwarm) tags.push(game.i18n.localize('am.npc.swarm'));
    if (det.isSquad) tags.push(game.i18n.localize('am.npc.squad'));

    return {
      cr:       A5eNPCSheet.crLabel(cr),
      crRaw:    cr,
      xp:       det.xp?.value ?? det.xp ?? A5eNPCSheet.crToXP(cr),
      size:     this.#label('actorSizes', sys.traits?.size ?? ''),
      types,
      typeLine: types.join(', '),
      terrain,
      tags,
      /* One line under the name, the way the book prints it:
         "Huge dragon, elite · mountains". */
      subtitle: [
        [this.#label('actorSizes', sys.traits?.size ?? ''), types.join(' ')]
          .filter(Boolean).join(' '),
        tags.join(', ')
      ].filter(Boolean).join(', '),
      languages: (sys.proficiencies?.languages ?? [])
        .map(l => this.#label('languages', l)).join(', ')
    };
  }

  /**
   * The statblock: every action the monster can take, grouped as the book
   * groups them.
   *
   * The grouping key is the action's own activation type, which is where a5e
   * actually records it — measured across the monster pack, 8426 actions,
   * 504 bonus actions, 356 reactions, 455 legendary. The old sheet looked for
   * the word "legendary" in the item's NAME, which found the ones that say so
   * and missed the 455 that simply are.
   *
   * An item can hold several actions, and a monster's often does — a bite that
   * is an action and a recharge breath that is not. Each action is listed
   * under its own heading, under the item's name, so the sheet says what the
   * book says.
   */
  #statblock() {
    const GROUPS = [
      { key: 'action',          label: 'am.npc.actions',           icon: 'fa-hand-fist' },
      { key: 'bonusAction',     label: 'am.npc.bonus-actions',     icon: 'fa-bolt' },
      { key: 'reaction',        label: 'am.npc.reactions',         icon: 'fa-reply' },
      { key: 'legendaryAction', label: 'am.npc.legendary-actions', icon: 'fa-crown' },
      { key: 'special',         label: 'am.npc.special',           icon: 'fa-star' },
      { key: 'passive',         label: 'am.npc.traits',            icon: 'fa-scroll' }
    ];
    const bucket = new Map(GROUPS.map(g => [g.key, []]));

    for (const item of this.actor.items) {
      if (!['feature', 'object', 'maneuver', 'spell'].includes(item.type)) continue;

      const actions = Object.entries(item.system?.actions ?? {});

      /* No action at all is a trait: the monster simply has it. 2353 of the
         items in a5e's pack are these, and the old sheet filed most of them
         under Actions. */
      if (!actions.length) {
        if (item.type === 'feature') bucket.get('passive').push(this.#entry(item));
        continue;
      }

      for (const [actionId, action] of actions) {
        const type = action?.activation?.type || '';
        /* 'minute', 'hour', 'none' and blank are not statblock headings. They
           are things the monster does outside a round, which the book prints
           among its traits. */
        const key = bucket.has(type) ? type
                  : (type === 'special' ? 'special' : 'passive');
        bucket.get(key).push(this.#entry(item, actionId, action));
      }
    }

    return GROUPS
      .map(g => ({ ...g, entries: bucket.get(g.key) }))
      .filter(g => g.entries.length);
  }

  /** One statblock line. Carries what the row template and the roll handlers need. */
  #entry(item, actionId = null, action = null) {
    const uses = action?.uses ?? item.system?.uses ?? null;
    const recharge = action?.uses?.recharge ?? item.system?.uses?.recharge ?? null;
    return {
      id:        item.id,
      uuid:      item.uuid,
      actionId,
      name:      action?.name || item.name,
      itemName:  item.name,
      /* Named separately only when the action is not simply the item. */
      subName:   action?.name && action.name !== item.name ? item.name : '',
      img:       item.img,
      type:      item.type,
      cost:      action?.activation?.cost ?? null,
      trigger:   action?.activation?.reactionTrigger ?? '',
      recharge:  recharge?.formula ? `${recharge.formula}` : '',
      uses:      (uses && (uses.max || uses.value)) ? uses : null,
      description: item.system?.description ?? ''
    };
  }

  /** A CONFIG.A5E label, falling back to the key itself made readable. */
  #label(group, key) {
    if (!key) return '';
    const raw = CONFIG.A5E?.[group]?.[key];
    if (raw) return game.i18n.localize(raw);
    return String(key).replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase());
  }

  /* ── Static helpers ───────────────────────────────── */

  /** "1/8", "1/4", "1/2" and otherwise the number, as the book prints it. */
  static crLabel(cr) {
    if (cr === 0.125) return '1/8';
    if (cr === 0.25)  return '1/4';
    if (cr === 0.5)   return '1/2';
    return String(cr ?? 0);
  }

  /** The standard XP-by-CR table, for monsters whose XP was never written down. */
  static crToXP(cr) {
    const TABLE = {
      0: 10, 0.125: 25, 0.25: 50, 0.5: 100,
      1: 200, 2: 450, 3: 700, 4: 1100, 5: 1800, 6: 2300, 7: 2900, 8: 3900,
      9: 5000, 10: 5900, 11: 7200, 12: 8400, 13: 10000, 14: 11500, 15: 13000,
      16: 15000, 17: 18000, 18: 20000, 19: 22000, 20: 25000, 21: 33000,
      22: 41000, 23: 50000, 24: 62000, 25: 75000, 26: 90000, 27: 105000,
      28: 120000, 29: 135000, 30: 155000
    };
    return TABLE[cr] ?? 0;
  }

  /* ── Listeners ────────────────────────────────────── */

  activateListeners(el) {
    super.activateListeners(el);
    if (!this.isEditable) return;

    /* A statblock line rolls the action it names, not the item's first one —
       a monster whose bite and breath live on one feature must be able to use
       either. a5e's own activate() takes the action id, so it is handed over
       rather than reimplemented. */
    el.querySelectorAll('[data-action="statblock-use"]').forEach(btn =>
      btn.addEventListener('click', async (event) => {
        event.preventDefault();
        const item = this.actor.items.get(btn.dataset.id);
        if (!item) return;
        const actionId = btn.dataset.actionId || null;
        try {
          if (actionId && typeof item.activate === 'function') await item.activate(actionId);
          else if (typeof item.activate === 'function')         await item.activate();
          else if (typeof item.use === 'function')              await item.use();
          else await item.share?.();
        } catch (err) {
          AM.log(2, `Could not use ${item.name}:`, err);
          ui.notifications.warn(err.message);
        }
      })
    );
  }
}
