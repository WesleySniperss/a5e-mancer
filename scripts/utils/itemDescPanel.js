import { AM } from '../a5e-mancer.js';

/**
 * Floating "full description" popup, opened by right-clicking a maneuver or spell
 * card anywhere in the module — the pickers in the creation wizard, the level-up
 * dialog, and the manage dialogs on the character sheet.
 *
 * The point is to see what an option actually costs before taking it: exertion for
 * maneuvers, slot level / casting time / range / duration / components for spells.
 * That data is not on the cards, so it is read from the item document.
 *
 * ManeuverDialog and SpellDialog each carried their own copy of this; this is the
 * single implementation they now share.
 */
export class ItemDescPanel {

  static #el   = null;
  static #docs = new Map();   // uuid → { resources[], description }

  /* ── open / close ─────────────────────────────────────── */

  static close() {
    this.#el?.remove();
    this.#el = null;
  }

  /**
   * @param {string} uuid    compendium uuid of the maneuver/spell
   * @param {number} x       viewport coords of the click
   * @param {number} y
   * @param {object} [seed]  what the card already knows: name, img, and any
   *                         badges the caller wants shown before the doc loads
   */
  static async showForUuid(uuid, x, y, seed = {}) {
    if (!uuid) return;
    this.close();

    // Render immediately from what the card knows, then fill in from the document
    const panel = this.#build({ ...seed, resources: seed.resources ?? [], description: '', loading: true });
    this.#place(panel, x, y);
    this.#el = panel;

    const detail = await this.#load(uuid);
    if (this.#el !== panel || !panel.isConnected) return;   // superseded/closed

    // `loading: false` is the whole point of the flag. The placeholder used to be
    // driven by "description is empty", so anything genuinely without one — most
    // traits, plenty of features — sat on "Loading…" forever.
    const merged = {
      name: seed.name || detail.name,
      img:  seed.img  || detail.img,
      resources: [...(seed.resources ?? []), ...detail.resources],
      description: detail.description,
      loading: false
    };
    const fresh = this.#build(merged);
    panel.replaceWith(fresh);
    this.#el = fresh;
    this.#place(fresh, x, y);
  }

  /* ── data ─────────────────────────────────────────────── */

  static async #load(uuid) {
    if (this.#docs.has(uuid)) return this.#docs.get(uuid);

    let detail = { name: '', img: '', resources: [], description: '' };
    try {
      const doc = await fromUuid(uuid);
      if (doc) {
        detail = {
          name: doc.name,
          img:  doc.img,
          resources: this.#resourcesOf(doc),
          description: await this.#enrich(doc)
        };
      }
    } catch (err) {
      AM.log(2, `Could not load ${uuid} for the description panel:`, err);
    }
    this.#docs.set(uuid, detail);
    return detail;
  }

  /**
   * What the option costs to use. A5e spreads this across the item and its
   * actions, and not every field is present on every item, so each lookup is
   * independent and anything missing is simply left out.
   */
  static #resourcesOf(doc) {
    const sys = doc.system ?? {};
    const out = [];
    const push = (icon, label, value) => {
      if (value === undefined || value === null || value === '' ) return;
      out.push({ icon, label, value: String(value) });
    };

    // Maneuvers: exertion is the whole point
    const exertion = sys.exertionCost ?? sys.cost ?? null;
    push('fa-bolt', 'Exertion', exertion || null);
    if (sys.degree) push('fa-chess-rook', 'Degree', `${sys.degree}°`);

    // Spells: slot level and the casting economy
    if (sys.level !== undefined && doc.type === 'spell') {
      push('fa-hat-wizard', 'Level', sys.level === 0 ? 'Cantrip' : `Level ${sys.level}`);
    }

    // Activation / range / duration live on the item or on its first action
    const action = Object.values(sys.actions ?? {})[0] ?? {};
    const act = sys.activation ?? action.activation ?? {};
    if (act.type) push('fa-clock', 'Casting Time', `${act.cost ? `${act.cost} ` : ''}${act.type}`);

    const range = sys.range ?? action.ranges ?? action.range ?? null;
    const r = Array.isArray(range) ? range[0] : (typeof range === 'object' ? Object.values(range)[0] : range);
    if (r) push('fa-ruler', 'Range', typeof r === 'object' ? [r.range, r.distance].filter(Boolean).join(' ') : r);

    const dur = sys.duration ?? action.duration ?? null;
    if (dur) push('fa-hourglass', 'Duration',
      typeof dur === 'object' ? [dur.value, dur.unit].filter(Boolean).join(' ') : dur);

    // Spell components (V/S/M) — stored as flags plus a material string
    const comp = sys.components ?? {};
    const parts = [];
    if (comp.vocalized ?? comp.verbal) parts.push('V');
    if (comp.seen ?? comp.somatic)     parts.push('S');
    if (comp.material)                 parts.push('M');
    if (parts.length) push('fa-hand-sparkles', 'Components', parts.join(', '));
    if (comp.materialComponents?.consumed) push('fa-fire', 'Consumed', 'yes');

    if (sys.concentration) push('fa-brain', 'Concentration', 'yes');
    if (sys.ritual)        push('fa-book', 'Ritual', 'yes');

    const uses = sys.uses ?? {};
    if (uses.max) push('fa-repeat', 'Uses', `${uses.value ?? uses.max}/${uses.max}${uses.per ? ` per ${uses.per}` : ''}`);

    return out;
  }

  static async #enrich(doc) {
    // A5e declares description as a plain HTMLField — there is no `.value`
    const raw = typeof doc.system?.description === 'string'
      ? doc.system.description
      : (doc.system?.description?.value ?? '');
    if (!raw) return '';
    try {
      const TE = foundry.applications?.ux?.TextEditor?.implementation ?? TextEditor;
      return await TE.enrichHTML(raw, { async: true, relativeTo: doc });
    } catch {
      return raw;
    }
  }

  /* ── markup ───────────────────────────────────────────── */

  static #build({ name = '', img = '', resources = [], description = '', loading = false }) {
    const panel = document.createElement('div');
    panel.className = 'am-item-desc-panel';

    const chips = resources.map(r =>
      `<span class="am-badge am-res-chip" data-tooltip="${r.label}">
         <i class="fa-solid ${r.icon}"></i> ${r.value}
       </span>`).join('');

    panel.innerHTML = `
      <div class="am-item-desc-header">
        ${img ? `<img src="${img}" alt="" />` : ''}
        <div class="am-item-desc-header-text">
          <div class="am-item-desc-title">${name}</div>
          <div class="am-item-desc-meta">${chips}</div>
        </div>
        <button class="am-item-desc-close" type="button" aria-label="Close">✕</button>
      </div>
      <div class="am-item-desc-body">
        ${description || `<p class="am-hint"><em>${game.i18n.localize(
            loading ? 'am.app.loading' : 'am.app.no-description')}</em></p>`}
      </div>`;

    panel.querySelector('.am-item-desc-close')
         ?.addEventListener('click', () => ItemDescPanel.close());
    // Clicks inside must not reach the card underneath (which would toggle it)
    panel.addEventListener('pointerdown', (e) => e.stopPropagation());
    panel.addEventListener('click',       (e) => e.stopPropagation());
    document.body.appendChild(panel);
    return panel;
  }

  static #place(panel, x, y) {
    const pw = panel.offsetWidth  || 352;
    const ph = Math.min(panel.scrollHeight || 320, 512);
    panel.style.left = `${Math.max(8, Math.min(x + 8, window.innerWidth  - pw - 8))}px`;
    panel.style.top  = `${Math.max(8, Math.min(y + 8, window.innerHeight - ph - 8))}px`;
  }

  /* ── wiring ───────────────────────────────────────────── */

  /**
   * Right-click any card carrying data-uuid inside `root` to open the panel.
   * Returns a cleanup function.
   */
  static attach(root, selector = '.am-card[data-uuid], .am-maneuver-card[data-uuid], .am-spell-card[data-uuid]') {
    if (!root) return () => {};

    const onContext = (event) => {
      const card = event.target.closest?.(selector);
      if (!card || !root.contains(card)) return;
      event.preventDefault();
      event.stopPropagation();
      ItemDescPanel.showForUuid(card.dataset.uuid, event.clientX, event.clientY, {
        name: card.dataset.name || card.querySelector('.am-card-name, .am-maneuver-name')?.textContent?.trim() || '',
        img:  card.dataset.img  || card.querySelector('img')?.src || ''
      });
    };
    const onAway = (event) => {
      if (!event.target.closest?.('.am-item-desc-panel')) ItemDescPanel.close();
    };

    root.addEventListener('contextmenu', onContext);
    document.addEventListener('pointerdown', onAway, true);

    return () => {
      root.removeEventListener('contextmenu', onContext);
      document.removeEventListener('pointerdown', onAway, true);
      ItemDescPanel.close();
    };
  }
}
