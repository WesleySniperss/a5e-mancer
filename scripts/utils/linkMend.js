import { AM } from '../am.js';
import { NamedDocs } from './namedDocs.js';
import { ForeignMarkup } from './foreignMarkup.js';

/**
 * Links whose document is not there go to the document of the same name.
 *
 * Foundry draws a link it cannot follow as a broken link, which does nothing
 * when clicked. a5e's own texts hold hundreds of them: its packs of 5e
 * content link the dnd5e system's packs (@Compendium[dnd5e.monsters...]
 * {Clay Golem} in Manual of Golems, {Wish} in the Deck of Many Things,
 * {Charm Person} in the Staff of Charming), some texts link paid modules
 * (The Pod Person Plague's Pup Clones) or packs that were renamed. Asked
 * 2026-10-27: "links to creatures and spells lead nowhere - in every
 * description". When the link names a document of its kind that is in a
 * pack the user can see, or in the world, it now leads there; a condition
 * (dnd5e's rules pages: Poisoned) becomes a5e's condition link. A link with
 * no name, or one nothing matches, stays broken.
 *
 * Wraps TextEditor._createContentLink, so sheets, chat cards, journals and
 * our panels all get it. Monk's Enhanced Journal wraps it as well, through
 * libWrapper; so do we when libWrapper is there.
 */
export class LinkMend {

  static #installed = false;
  static #seen = new Map();   // original target -> uuid used, for linkMend.report()

  static install() {
    if (this.#installed) return;
    const TE = foundry.applications?.ux?.TextEditor?.implementation;
    if (typeof TE?._createContentLink !== 'function') return;
    this.#installed = true;
    const wrapper = async function (wrapped, match, options) {
      const anchor = await wrapped(match, options);
      if (!(anchor instanceof HTMLElement) || !anchor.classList.contains('broken')) return anchor;
      try { return (await LinkMend.#mend(match, options)) ?? anchor; }
      catch (err) { AM.log(2, 'A broken link could not be mended:', err); return anchor; }
    };
    if (globalThis.libWrapper?.register) {
      libWrapper.register(AM.ID, 'foundry.applications.ux.TextEditor.implementation._createContentLink', wrapper, 'WRAPPER');
    } else {
      const original = TE._createContentLink;
      TE._createContentLink = function (match, options) { return wrapper.call(this, original.bind(this), match, options); };
    }
    AM.log(3, 'Broken links go to the document of the same name');
  }

  /** What a link was meant to lead to, from its pack's name when the pack is not there. */
  static #hint(packName) {
    const n = String(packName ?? '').toLowerCase();
    if (/monster|bestiar|creature|npc|summon|actor|familiar|mount/.test(n)) return { documentName: 'Actor' };
    if (/spell/.test(n)) return { documentName: 'Item', type: 'spell' };
    if (/maneuver/.test(n)) return { documentName: 'Item', type: 'maneuver' };
    if (/table/.test(n)) return { documentName: 'RollTable' };
    if (/journal|rule|condition/.test(n)) return { documentName: 'JournalEntry' };
    if (/macro/.test(n)) return { documentName: 'Macro' };
    if (/item|equipment|gear|weapon|armou?r|magic|treasure|loot/.test(n)) return { documentName: 'Item', type: 'object' };
    if (/feat|feature|class|race|heritage|background|culture|destin|trait|archetype|option|power/.test(n)) return { documentName: 'Item', type: 'feature' };
    return null;
  }

  /**
   * The kind of document a link wants: from its uuid ("Compendium.x.y.Actor.id",
   * "Actor.id", a page "...JournalEntry.id.JournalEntryPage.id"), else from its pack's name.
   */
  static #wanted(type, target) {
    const kinds = CONST.ALL_DOCUMENT_TYPES ?? [];
    if (type !== 'UUID' && type !== 'Compendium') return { documentName: type };
    const parts = String(target ?? '').split('.');
    const named = parts.filter(p => kinds.includes(p));
    const pack = type === 'Compendium' ? parts[1] : (parts[0] === 'Compendium' ? parts[2] : null);
    const hint = pack ? this.#hint(pack) : null;
    const kind = pack ? NamedDocs.kindOf(pack) : null;
    if (named.length) {
      const documentName = named.at(-1);
      return { documentName, kind, type: hint?.documentName === documentName ? hint.type : undefined };
    }
    return { documentName: null, ...hint, kind };
  }

  static async #mend(match, options) {
    const [type, target, hash, label] = match.slice(1, 5);
    // A legacy link may name its document instead of giving an id: @Compendium[dnd5e.monsters.Mastiff]
    const last = String(target ?? '').split('.').at(-1);
    const name = label || (/^[a-zA-Z0-9]{16}$/.test(last) ? '' : (type === 'UUID' ? '' : last));
    if (!name) return null;
    const { documentName, type: itemType, kind: packKind } = this.#wanted(type, target);

    if (!documentName || documentName === 'JournalEntry' || documentName === 'JournalEntryPage') {
      const id = NamedDocs.key(name);
      if (CONFIG.A5E?.conditions?.[id]) {
        this.#note(target, `condition ${id}`);
        return ForeignMarkup.conditionElement(id, label, options);
      }
    }
    const docNames = documentName === 'JournalEntryPage' ? ['JournalEntry']
      : documentName ? [documentName] : ['Item', 'Actor'];
    for (const docName of docNames) {
      const plural = docName === 'Actor' || docName === 'Item';
      const uuid = (itemType && NamedDocs.uuidOf(docName, name, { type: itemType, plural, kind: packKind }))
        || NamedDocs.uuidOf(docName, name, { plural, kind: packKind });
      if (!uuid) continue;
      const doc = await fromUuid(uuid);
      if (!doc?.toAnchor) continue;
      this.#note(target, uuid);
      const anchor = doc.toAnchor({ name: label || doc.name, dataset: hash ? { hash } : {} });
      anchor.dataset.amLinked = target;
      return anchor;
    }
    return null;
  }

  static #note(target, to) {
    if (this.#seen.size > 400) this.#seen.clear();
    this.#seen.set(target, to);
  }

  /** The broken links mended since the page loaded: original target -> where it leads now. */
  static report() {
    return Object.fromEntries(this.#seen);
  }
}
