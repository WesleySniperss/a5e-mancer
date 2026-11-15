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
 * vision itself (every sense, every token, nothing written) and this writes
 * nothing; it only has a5e work a token's vision out again when its character
 * changes (follow).
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
  static #following = new Map();

  /**
   * a5e's automation works a token's vision out when the token is prepared: at
   * load, or when the token itself changes. Foundry prepares a token again for
   * its character's change only when an effect alters the token, so a character
   * who gained darkvision mid-session (a level, an item, an effect, a spell, Fill
   * In) went on with the old sight on the map until a reload. Measured on Foundry
   * 14.370 and a5e 1.5.1: 90 ft on the sheet, 60 on the token. Reported
   * 2026-11-15: "players' darkvision did not work last time".
   *
   * a5e tries itself, for the scene on view only: it prepares the token again,
   * but then asks the canvas to redo vision modes, not the token's own vision -
   * the sight drawn on the map kept its old radius (1250 px for 60 ft on a 20 px
   * foot, still 1250 with 90 on the token). And a token on a scene not on view
   * was not prepared again at all, so it showed the old sight when that scene
   * came up.
   *
   * So the tokens of a creature whose senses no longer match the vision they
   * were prepared with are prepared again, with a5e's own code, and a drawn
   * sight that no longer matches its token is drawn again. On this client
   * only; nothing is written.
   * @returns {number} how many tokens were prepared or drawn again
   */
  static follow(actor) {
    if (!this.a5eAutomates || !this.#a5eDrawsVision()) return 0;
    let done = 0;
    for (const doc of actor?.getDependentTokens?.() ?? []) {
      const stale = this.#stale(doc);
      if (stale) doc.reset();
      const drawn = doc.rendered ? doc.object : null;
      const redraw = !!drawn && !drawn.destroyed && (stale || this.#drawnStale(drawn));
      if (redraw) drawn.initializeVisionSource();
      if (stale || redraw) done++;
    }
    return done;
  }

  /** The sight drawn on the map is not the token's: another range or mode. */
  static #drawnStale(token) {
    const v = token.vision;
    if (!v?.data) return false; // nothing drawn: it is drawn from the token when it is
    return Math.round(Number(v.data.radius) || 0) !== Math.round(Number(token.sightRange) || 0)
      || v.data.visionMode !== token.document?.sight?.visionMode;
  }

  /** a5e's token class still works vision out itself (its _prepareDetectionModes) */
  static #a5eDrawsVision() {
    const Token = CONFIG.Token?.documentClass;
    return !!Token && Object.prototype.hasOwnProperty.call(Token.prototype, '_prepareDetectionModes');
  }

  /** The token shows other vision than a5e would give it now (a5e's rules, read from its code). */
  static #stale(doc) {
    const actor = doc?.actor;
    if (!actor || actor.isParty?.()) return false;
    if (!(doc.automateVision ?? this.a5eAutomates)) return false;
    let charsOnly = doc.charOnlyVisionAutomation;
    if (charsOnly === undefined) { try { charsOnly = game.settings.get('a5e', 'visionRulesApplyToCharactersOnly') !== false; } catch { charsOnly = true; } }
    if (actor.type === 'npc' && charsOnly) return false;
    const v = actor.visionData;
    if (!v?.senses) return false;
    const range = v.hasDarkvision ? Number(v.senses.darkvision?.distance) || 0 : 0;
    const modes = doc.detectionModes ?? {};
    const reach = (id, has, sense) => (modes[id] ? Number(modes[id].range) || 0 : null) !== (has ? Number(v.senses[sense]?.distance) || 0 : null);
    return (Number(doc.sight?.range) || 0) !== range
      || doc.sight?.visionMode !== (v.hasDarkvision ? 'darkvision' : 'basic')
      || reach('blindsight', v.hasBlindsight, 'blindsight')
      || reach('feelTremor', v.hasTremorsense, 'tremorsense')
      || reach('seeAll', v.hasTruesight, 'truesight')
      || !!modes.hearing === !!actor.statuses?.has?.('deafened');
  }

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
    /* With a5e's automation on: every client, every change to a creature or what
       it carries, since each client prepares its own tokens and nothing is
       written. Comparing a few numbers per token; most changes find nothing. */
    /* Gathered, not put off: the first change sets the look 150 ms on, and the
       ones in between join it. Putting it off again at each change waited out
       a whole stream - the fifty basic actions a5e gives a new character, one
       createItem each - and the sight was redrawn seconds late (the 2.99.3
       release run). */
    const follow = (doc) => {
      const actor = doc?.documentName === 'Actor' ? doc : (doc?.parent?.documentName === 'Actor' ? doc.parent : doc?.parent?.parent);
      if (!actor || actor.documentName !== 'Actor' || !this.a5eAutomates) return;
      if (this.#following.has(actor.uuid)) return;
      this.#following.set(actor.uuid, setTimeout(() => {
        this.#following.delete(actor.uuid);
        try { this.follow(actor); } catch (err) { AM.log(2, `Token vision for ${actor.name} not followed:`, err); }
      }, 150));
    };
    Hooks.on('updateActor', (actor) => follow(actor));
    for (const kind of ['Item', 'ActiveEffect']) {
      for (const verb of ['create', 'update', 'delete']) Hooks.on(verb + kind, (doc) => follow(doc));
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
