import { AM } from '../am.js';

/**
 * A character's darkvision on their token.
 *
 * a5e works the range out (system.attributes.senses.darkvision.distance, its
 * base plus every senses bonus - a heritage's darkvision is one) but carries it
 * to a token only with its own "automate vision rules" setting, which is off
 * by default. So a dwarf made in the builder came out seeing 60 feet in the
 * dark on the sheet and nothing on the map. Reported 2026-10-06: "no darkvision
 * set up from the heritage or culture".
 *
 * The prototype token is set from the range when the character is made, and
 * again whenever the range changes - with the tokens already placed - but only
 * where nobody has set the sight by hand: the range on the token has to be the
 * one this last wrote (or none). With a5e's own automation on, a5e draws
 * vision itself and this stays out of it.
 */
export class TokenVision {

  static FLAG = 'visionSync';

  static get enabled() {
    try { return game.settings.get(AM.ID, 'darkvisionToTokens') !== false; }
    catch { return true; }
  }

  static get a5eAutomates() {
    try { return !!game.settings.get('a5e', 'automateVisionRules'); }
    catch { return false; }
  }

  static distanceOf(actor) {
    return Math.max(0, Number(actor?.system?.attributes?.senses?.darkvision?.distance) || 0);
  }

  static #pending = new Map();

  /** Re-check after anything that can move the range, on the client that moved it. */
  static installHooks() {
    const schedule = (actor, userId) => {
      if (!actor || actor.documentName !== 'Actor' || actor.type !== 'character') return;
      if (userId !== game.user?.id) return;
      clearTimeout(this.#pending.get(actor.id));
      this.#pending.set(actor.id, setTimeout(() => {
        this.#pending.delete(actor.id);
        this.sync(actor).catch(err => AM.log(2, 'Token vision could not be updated:', err));
      }, 800));
    };
    Hooks.on('updateActor', (actor, changes, _options, userId) => {
      const keys = Object.keys(foundry.utils.flattenObject(changes ?? {}));
      if (keys.some(k => k.startsWith('system.bonuses') || k.startsWith('system.attributes.senses'))) schedule(actor, userId);
    });
    for (const hook of ['createItem', 'deleteItem']) {
      Hooks.on(hook, (doc, ...rest) => schedule(doc?.parent, rest.at(-1)));
    }
    /* Effects only when they touch senses: a condition coming and going (Bloodied
       at half hit points) is no reason to look, and looking wrote the token
       mid-fight the first time - a redraw the sheet did not need. */
    const sensesEffect = (fx) => (fx?.system?.changes ?? fx?.changes ?? []).some(c => String(c?.key ?? '').includes('senses'));
    for (const hook of ['createActiveEffect', 'deleteActiveEffect', 'updateActiveEffect']) {
      Hooks.on(hook, (fx, ...rest) => { if (sensesEffect(fx)) schedule(fx?.parent, rest.at(-1)); });
    }
    /* The characters already in the world, once, as it loads - not at the first
       change of each in play. The GM's client, so it is done once. */
    if (game.user?.isGM && this.enabled && !this.a5eAutomates) {
      for (const actor of game.actors ?? []) {
        if (actor.type !== 'character') continue;
        this.sync(actor).catch(err => AM.log(2, `Token vision for ${actor.name}:`, err));
      }
    }
  }

  /**
   * Bring the prototype token (and placed tokens) to the character's darkvision.
   * @param {boolean} [force]  the character is new: whatever the token says is a default
   */
  static async sync(actor, { force = false } = {}) {
    if (!this.enabled || this.a5eAutomates || actor?.type !== 'character' || !actor.isOwner) return false;
    const range = this.distanceOf(actor);
    const sight = actor.prototypeToken?.sight ?? {};
    const current = Math.max(0, Number(sight.range) || 0);
    const ours = Number(actor.getFlag(AM.ID, this.FLAG) ?? 0) || 0;

    // Set by hand since: leave it
    if (!force && current !== ours) return false;
    const want = range > 0 ? 'darkvision' : 'basic';
    if (current === range && (range === 0 || sight.visionMode === want)) {
      if (ours !== range) await actor.setFlag(AM.ID, this.FLAG, range);
      return false;
    }

    const visionMode = range > 0 ? 'darkvision' : (sight.visionMode === 'darkvision' ? 'basic' : sight.visionMode || 'basic');
    const update = { range, visionMode, ...(range > 0 ? { enabled: true } : {}) };
    await actor.update({ 'prototypeToken.sight': update, [`flags.${AM.ID}.${this.FLAG}`]: range });

    // The tokens already out, where they still show what was synced before
    for (const token of actor.getActiveTokens?.(false, true) ?? []) {
      const tokenRange = Math.max(0, Number(token.sight?.range) || 0);
      if (tokenRange !== current) continue;
      try { await token.update({ sight: update }); }
      catch (err) { AM.log(2, `Token ${token.name} vision not updated:`, err); }
    }
    AM.log(3, `Token vision for ${actor.name}: ${range ? `${range} ft darkvision` : 'no darkvision'}`);
    return true;
  }
}
