import { AM } from '../am.js';

/**
 * A player's initiative roll when no encounter is running on their scene.
 *
 * Foundry's Actor#rollInitiative lets only a GM start an encounter. A player
 * who rolls before the GM has started one gets "There is no active Combat
 * Encounter in your currently viewed Scene", and nothing is rolled or added.
 * Reported 2026-11-01: "a roll from Foundry, and the character from Foundry
 * was not added to the initiative". Tried on a copy of the world with real
 * clicks: the GM's roll from the sheet adds the token in every state of an
 * encounter, while a player's roll with no encounter adds nothing.
 *
 * Here the player's client rolls as a5e does (its dialog, formula and bonuses)
 * and posts the card with a note of the tokens and the scene. The active GM's
 * client starts the encounter there and puts them in it with that number, the
 * same way the Beyond20 bridge does. With no GM connected, nobody may start
 * one, so Foundry's own warning stands. Every other roll is Foundry's own.
 */
export class InitiativeRelay {

  static #queue = Promise.resolve();

  /** At init, after a5e has set its document classes. */
  static install() {
    const proto = CONFIG.Actor?.documentClass?.prototype;
    const roll = proto?.rollInitiative;
    if (typeof roll !== 'function' || roll.amRelay) return;
    const wrapped = function (options = {}) {
      if (game.user.isGM || game.combat || !game.users?.activeGM) return roll.call(this, options);
      return InitiativeRelay.#relay(this, options);
    };
    wrapped.amRelay = true;
    proto.rollInitiative = wrapped;

    /* One at a time: two players rolling at once must find the encounter the
       first one started, not start a second. */
    Hooks.on('createChatMessage', (message) => {
      if (!message.flags?.[AM.ID]?.initiative || !game.users?.activeGM?.isSelf) return;
      this.#queue = this.#queue.then(() => this.#add(message)).catch((err) => {
        AM.log(1, 'Initiative relay: could not add a player\'s roll', err);
        ui.notifications.error(game.i18n.format('am.initiative.relay-failed', { name: message.speaker?.alias ?? '?', error: err?.message ?? err }));
      });
    });
  }

  /** On the player's client: a5e's roll for this actor, posted with a note for the GM's client. */
  static async #relay(actor, { initiativeOptions = {} } = {}) {
    const scene = canvas?.scene ?? null;
    const tokens = actor.getActiveTokens(false, true);
    const name = tokens[0]?.name ?? actor.name;
    /* a5e's roll, and every module that wraps it, read a whole combatant:
       Monk's Combat Details asks it for a flag. So a combatant of an encounter
       that is never saved, for this actor on this scene. */
    const encounter = new (getDocumentClass('Combat'))({ scene: scene?.id ?? null });
    const combatant = new (getDocumentClass('Combatant'))(
      { actorId: actor.id, tokenId: tokens[0]?.id ?? null, sceneId: scene?.id ?? null }, { parent: encounter });
    let roll;
    try {
      roll = await combatant.getInitiativeRoll(initiativeOptions.rollOptions ?? {});
      if (roll && !roll._evaluated) await roll.evaluate();
    } catch (err) {
      /* a5e's dialog closed without rolling ends in reading its empty result;
         anything else is a failure, and said */
      if (!/rollFormula/.test(String(err?.message))) {
        console.error('a5e-mancer | initiative relay:', err);
        ui.notifications.error(game.i18n.format('am.initiative.relay-failed', { name, error: err?.message ?? err }));
      }
      return null;
    }
    if (!roll) return null;
    await roll.toMessage({
      speaker: { scene: scene?.id ?? null, actor: actor.id, token: tokens[0]?.id ?? null, alias: name },
      flavor: game.i18n.format('COMBAT.RollsInitiative', { name }),
      flags: {
        'core.initiativeRoll': true,
        [AM.ID]: { initiative: { scene: scene?.id ?? null, tokens: tokens.map((t) => t.id), actor: actor.id, total: roll.total } }
      }
    }, { rollMode: initiativeOptions.messageOptions?.rollMode ?? game.settings.get('core', 'rollMode') });
    return null;
  }

  /** On the active GM's client: the encounter on the player's scene, and the roll in it. */
  static async #add(message) {
    const note = message.flags[AM.ID].initiative;
    const total = Number(note.total);
    if (!Number.isFinite(total)) return;
    const scene = game.scenes.get(note.scene) ?? game.scenes.active ?? null;
    let combat = game.combats.find((c) => c.active && c.scene?.id === scene?.id)
      ?? game.combats.find((c) => c.active && !c.scene)
      ?? null;
    if (!combat) combat = await getDocumentClass('Combat').create({ scene: scene?.id ?? null, active: true });

    const tokens = (note.tokens ?? []).map((id) => scene?.tokens?.get(id)).filter(Boolean);
    const updates = [];
    const creates = [];
    const set = (list) => { for (const c of list) if (c.initiative !== total) updates.push({ _id: c.id, initiative: total }); };
    for (const t of tokens) {
      const existing = combat.getCombatantsByToken(t.id);
      if (existing.length) set(existing);
      else creates.push({ tokenId: t.id, sceneId: t.parent?.id, actorId: t.actorId, hidden: t.hidden, initiative: total });
    }
    // No token on that scene: the character itself, as Foundry's own roll does
    const actor = game.actors.get(note.actor);
    if (!tokens.length && actor) {
      const existing = combat.getCombatantsByActor(actor);
      if (existing.length) set(existing);
      else creates.push({ actorId: actor.id, hidden: false, initiative: total });
    }
    if (updates.length) await combat.updateEmbeddedDocuments('Combatant', updates);
    if (creates.length) await combat.createEmbeddedDocuments('Combatant', creates);
  }
}
