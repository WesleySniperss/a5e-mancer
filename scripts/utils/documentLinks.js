import { AM } from '../am.js';

/**
 * Links in descriptions that open what they name.
 *
 * Creatures with Monk's Enhanced Journal. It replaces
 * Actor#_onClickDocumentLink: an actor link opens as a tab of its journal,
 * which on Foundry v13 and later shows a blank page and the warning "Actor
 * sheet can no longer be opened in Enhanced Journal" - and the actor's own
 * sheet never comes. Every creature a spell or a feature links (a summoning
 * spell's stat blocks, the monsters a text names) is such a link: "the
 * creatures don't open" (reported 2026-09-24, again 2026-10-26). With Monk's
 * Enhanced Journal active, a click on an actor link opens the actor's sheet
 * here, before Foundry hands it to the journal. Alt+click is left to it, as
 * it has always meant "outside the journal".
 *
 * Links kept as HTML. A text that holds a link as Foundry once drew it -
 * <a class="content-link" data-uuid="..."> - instead of its @UUID markup has
 * no data-link, so Foundry's click handler passes it by and it does nothing
 * (a5e's Progenitor's Boon has three; text copied out of a journal has more).
 * A click on one opens its document, as a link Foundry drew would - once the
 * click has gone everywhere else and nothing took it: other modules draw
 * links of that shape for their own uses (Campaign Codex's sheet tabs), and
 * carry data of their own on them, so a link with any data Foundry does not
 * put there is left alone too.
 *
 * Links whose document is gone are mended before they are drawn: linkMend.js.
 */
export class DocumentLinks {

  static #installed = false;
  static #mej = false;

  /** The data Foundry puts on the links it draws, from v10 on. */
  static #FOUNDRY_DATA = new Set(['uuid', 'id', 'type', 'pack', 'tooltip', 'tooltipDirection', 'tooltipClass',
    'link', 'lookup', 'hash', 'entity', 'amLinked']);

  static install() {
    if (this.#installed) return;
    this.#installed = true;
    this.#mej = !!game.modules.get('monks-enhanced-journal')?.active;
    // Before Foundry's handler, which is on the body as the click bubbles
    if (this.#mej) {
      document.addEventListener('click', (event) => this.#onActorClick(event), true);
      AM.log(3, "Monk's Enhanced Journal is active: actor links open the actor's sheet");
    }
    // After everything else
    window.addEventListener('click', (event) => this.#onKeptClick(event));
  }

  static #isActor(link) {
    return link.dataset.type === 'Actor' || /(^|\.)Actor\.[^.]+$/.test(link.dataset.uuid ?? '');
  }

  static #onActorClick(event) {
    if (event.button !== 0 || event.altKey) return;
    const link = event.target?.closest?.('a[data-link][data-uuid]');
    if (!link || link.classList.contains('broken') || !this.#isActor(link)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    this.#open(link.dataset.uuid, event, true);
  }

  static #onKeptClick(event) {
    if (event.button !== 0 || event.defaultPrevented) return;
    const link = event.target?.closest?.('a[data-uuid]:not([data-link])');
    if (!link || link.classList.contains('broken') || !link.matches('.content-link, .entity-link')) return;
    if (Object.keys(link.dataset).some(k => !this.#FOUNDRY_DATA.has(k))) return;
    event.preventDefault();
    this.#open(link.dataset.uuid, event, this.#mej && !event.altKey && this.#isActor(link));
  }

  static async #open(uuid, event, sheet) {
    try {
      const doc = await fromUuid(uuid);
      if (!doc) {
        ui.notifications.warn(game.i18n.format('am.links.missing', { uuid }));
        return;
      }
      if (sheet || typeof doc._onClickDocumentLink !== 'function') doc.sheet?.render(true);
      else await doc._onClickDocumentLink(event);
    } catch (err) {
      AM.log(1, `The link ${uuid} could not be opened:`, err);
    }
  }
}
