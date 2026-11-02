/**
 * One half of an action, rolled through a5e: the attack alone, or the damage alone.
 *
 * The figures in an item's Actions table roll only themselves ("Roll to hit
 * only", "Roll damage only"). They were Foundry's plain rolls of the figure the
 * row shows, which a5e never saw. A natural 20 to hit came out as a plain number:
 * no critical on the card, no weapon's crit range, no critical for Impact Frames
 * to play. The damage rolled after it was never critical damage. Reported
 * 2026-11-02: "a crit on a 20 was not counted and not shown properly".
 *
 * So each half goes through a5e's own activation with the other half taken out
 * of a5e's roll state once its defaults are chosen. That gives a5e's card, crit
 * threshold and highlight, critical damage and apply buttons. Nothing is spent or
 * applied again: no consumers, no effects on the user, no concentration, no
 * macro. The two halves of one action would otherwise each spend it, which the
 * plain rolls never did. The damage alone is critical when the last attack this
 * client rolled with that action was, within a quarter of an hour; the card's
 * crit toggle still turns it either way.
 */
export class PartRolls {

  static #pending = null;          // { key, crit, until } for the damage card about to be made
  static #lastAttack = new Map();  // `${item uuid}|${action id}` -> { crit, at }
  static #WINDOW = 15 * 60 * 1000;

  static get available() {
    const proto = game.a5e?.managers?.RollStateManager?.prototype;
    return typeof proto?._preparePostDialogState === 'function' && typeof proto?.handleEffects === 'function';
  }

  /** At ready, when a5e's managers are there. */
  static install() {
    if (!this.available) return;
    const proto = game.a5e.managers.RollStateManager.prototype;
    if (proto._preparePostDialogState.amPartRolls) return;

    const prepare = proto._preparePostDialogState;
    const wrapped = function (data) {
      const state = prepare.call(this, data);
      const part = state?.options?.amPart;
      if (!part) return state;
      this._amPart = part;
      state.consumers = [];
      state.effects = [];
      if (part === 'attack') {
        state.rolls = [];
        state.prompts = [];
      } else {
        state.attack = {};
      }
      return state;
    };
    wrapped.amPartRolls = true;
    proto._preparePostDialogState = wrapped;

    // Concentration and the effects a5e puts on the user, which go with using the action
    const effects = proto.handleEffects;
    proto.handleEffects = function (...args) {
      if (this._amPart) return undefined;
      return effects.apply(this, args);
    };

    Hooks.on('preCreateChatMessage', (message, _data, _options, userId) => {
      if (userId !== game.user.id) return;
      const sys = message.system ?? {};
      if (!sys.itemId || !Array.isArray(sys.rollData)) return;
      const key = `${sys.itemId}|${sys.actionId}`;
      /* Every attack with an action, a half or the whole card: the damage
         rolled alone after it follows the last one */
      const attack = sys.rollData.find((r) => r?.type === 'attack');
      if (attack) this.#lastAttack.set(key, { crit: !!attack.isCrit, at: Date.now() });
      const pending = this.#pending;
      if (pending?.key === key && Date.now() < pending.until) {
        this.#pending = null;
        if (pending.crit && !attack) message.updateSource({ 'flags.a5e.isCrit': true });
      }
    });
  }

  /**
   * Roll one half of an item's action through a5e.
   * @param {Item} item
   * @param {string} actionId
   * @param {'attack'|'damage'} part
   */
  static async roll(item, actionId, part) {
    const key = `${item.uuid}|${actionId}`;
    if (part === 'damage') {
      const last = this.#lastAttack.get(key);
      /* a5e builds the card without waiting on its own activation, so the
         note waits for the card rather than for this call */
      this.#pending = { key, crit: !!last?.crit && Date.now() - last.at < this.#WINDOW, until: Date.now() + 30000 };
    }
    return item.activate(actionId, { skipRollDialog: true, executeMacro: false, amPart: part });
  }
}
