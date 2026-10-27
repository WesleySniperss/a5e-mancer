/**
 * A card's text in the panel under the cards, while the pointer is on it.
 *
 * The text stays when the pointer leaves the cards, so the links in it can
 * be clicked. Until 2026-10-27 the panel went back to its hint the moment the
 * pointer left the cards, and on the way down to the panel it crossed other
 * cards, each putting its own text up: a spell's creatures and spells could
 * be seen in it but never reached ("the links lead nowhere"). Now another
 * card's text comes once the pointer rests on that card, and the card shown
 * is kept for when the window draws again (a pick redraws it).
 */
export class HoverPanel {

  /** How long the pointer rests on another card before its text takes the panel, in ms. */
  static REST = 200;

  static #LOADING = '<p class="am-loading"><i class="fas fa-spinner fa-spin"></i></p>';

  /**
   * @param {HTMLElement} cards   what holds the cards
   * @param {HTMLElement} panel   where the text goes
   * @param {object} how
   * @param {(target: Element) => string|null} how.keyOf   the card the pointer is on, as a key
   * @param {(key: string) => string|Promise<string>} how.htmlOf   the panel's html for that card
   * @param {{key?: string}} [how.memory]   the card shown, kept across draws of the window
   * @param {(key: string) => boolean} [how.has]   whether that card is still among the cards
   * @returns {() => void} takes the listeners off
   */
  static bind(cards, panel, { keyOf, htmlOf, memory = {}, has = null }) {
    let shown = null, timer = null, ticket = 0;
    const show = async (key) => {
      clearTimeout(timer); timer = null;
      shown = memory.key = key;
      const mine = ++ticket;
      const result = htmlOf(key);
      if (result instanceof Promise) panel.innerHTML = this.#LOADING;
      const html = await result;
      if (mine === ticket && panel.isConnected) panel.innerHTML = html;
    };
    const onOver = (event) => {
      const key = keyOf(event.target);
      if (!key) return;
      if (key === shown) { clearTimeout(timer); timer = null; return; }
      if (shown === null) { show(key); return; }
      clearTimeout(timer);
      timer = setTimeout(() => show(key), this.REST);
    };
    const onLeave = () => { clearTimeout(timer); timer = null; };
    cards.addEventListener('mouseover', onOver);
    cards.addEventListener('mouseleave', onLeave);
    if (memory.key && has?.(memory.key)) show(memory.key);
    return () => {
      clearTimeout(timer);
      cards.removeEventListener('mouseover', onOver);
      cards.removeEventListener('mouseleave', onLeave);
    };
  }

  /** keyOf for cards that carry their document's uuid. */
  static uuidOf(target) {
    return target?.closest?.('.am-card[data-uuid]')?.dataset.uuid ?? null;
  }

  /** has, for the same cards. */
  static holds(cards) {
    return (uuid) => [...cards.querySelectorAll('.am-card[data-uuid]')].some(c => c.dataset.uuid === uuid);
  }
}
