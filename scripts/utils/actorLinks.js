import { AM } from '../am.js';

/**
 * Links to creatures that open their sheet.
 *
 * Monk's Enhanced Journal replaces Actor#_onClickDocumentLink: an actor link
 * opens as a tab of its journal, which on Foundry v13 and later shows a blank
 * page and the warning "Actor sheet can no longer be opened in Enhanced
 * Journal" - and the actor's own sheet never comes. Every creature a spell or
 * a feature links (a summoning spell's stat blocks, the monsters a text names)
 * is such a link: "the creatures don't open" (reported 2026-09-24, again
 * 2026-10-26). With Monk's Enhanced Journal active, a click on an actor link
 * opens the actor's sheet here, before Foundry hands it to the journal.
 * Alt+click is left to it, as it has always meant "outside the journal".
 */
export class ActorLinks {

  static #installed = false;

  static install() {
    if (this.#installed || !game.modules.get('monks-enhanced-journal')?.active) return;
    this.#installed = true;
    // The capture phase: Foundry's own handler is on the body, as the click bubbles
    document.addEventListener('click', (event) => this.#onClick(event), true);
    AM.log(3, "Monk's Enhanced Journal is active: actor links open the actor's sheet");
  }

  static #onClick(event) {
    if (event.button !== 0 || event.altKey) return;
    const link = event.target?.closest?.('a[data-link][data-uuid]');
    if (!link || link.classList.contains('broken')) return;
    const uuid = link.dataset.uuid ?? '';
    if (link.dataset.type !== 'Actor' && !/(^|\.)Actor\.[^.]+$/.test(uuid)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    this.#open(uuid);
  }

  static async #open(uuid) {
    try {
      const actor = await fromUuid(uuid);
      if (!actor) {
        ui.notifications.warn(game.i18n.format('am.links.actor-missing', { uuid }));
        return;
      }
      actor.sheet?.render(true);
    } catch (err) {
      AM.log(1, `The actor ${uuid} could not be opened:`, err);
    }
  }
}
