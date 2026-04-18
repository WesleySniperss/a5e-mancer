import { AM } from '../a5e-mancer.js';
import { ManeuverService, getTraditions } from '../utils/maneuverService.js';

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Standalone maneuver selection dialog.
 * Can be opened from:
 *  - Level Up dialog (picks N new maneuvers)
 *  - Character sheet button (manage all maneuvers)
 */
export class ManeuverDialog extends HandlebarsApplicationMixin(ApplicationV2) {

  /**
   * @param {Actor} actor
   * @param {object} options
   * @param {number} [options.slotsAvailable]   How many NEW maneuvers to pick (-1 = free manage, 0 = none allowed)
   * @param {number} [options.maxDegree]        Max degree allowed
   * @param {string[]} [options.allowedTraditions]  Filter to these traditions (empty = all)
   * @param {Function} [options.onConfirm]      Callback(selectedUuids, selectedTraditions)
   */
  constructor(actor, options = {}) {
    super(options);
    this.actor             = actor;
    this.slotsAvailable    = options.slotsAvailable ?? -1;
    this.maxDegree         = options.maxDegree ?? 5;
    this.allowedTraditions = options.allowedTraditions ?? [];
    this.onConfirm         = options.onConfirm ?? null;

    // State
    this._allManeuvers     = new Map(); // tradition → Map<degree, maneuver[]>
    this._selectedUuids    = new Set();
    this._activeTradition  = null;
    this._activeDegree     = null;
    this._searchText       = '';
    this._sortBy           = 'degree'; // 'degree' | 'name' | 'tradition'
    this._sortDir          = 'asc';    // 'asc' | 'desc'
    this._loading          = true;
    this._selectedTraditions = new Set(options.allowedTraditions);
    this._descMap          = new Map(); // uuid → full maneuver data for description panel
    this._sidebarDescHtml  = null;      // null = hidden, string = rendered HTML
    this._compendiumCache  = new Map(); // tradition name → description string
  }

  static DEFAULT_OPTIONS = {
    id: 'a5e-maneuver-dialog',
    tag: 'div',
    classes: ['am-app', 'am-maneuver-dialog'],
    position: { width: 780, height: 600 },
    window: {
      icon: 'fa-solid fa-swords',
      resizable: true,
      minimizable: false
    }
  };

  static PARTS = {
    main: { template: 'modules/a5e-mancer/templates/maneuver-dialog.hbs' }
  };

  get title() {
    const label = this.slotsAvailable > 0
      ? game.i18n.format('am.maneuvers.title-pick', { n: this.slotsAvailable })
      : game.i18n.localize('am.maneuvers.title-manage');  // -1 or 0
    return this.actor ? `${label} — ${this.actor.name}` : label;
  }

  /* ── Context ──────────────────────────────────────────── */

  async _prepareContext(_options) {
    if (this._loading) {
      this._allManeuvers = await ManeuverService.loadAllManeuvers();
      this._loading = false;
      // Pre-fill desc map with all loaded maneuvers
      for (const degreeMap of this._allManeuvers.values()) {
        for (const maneuvers of degreeMap.values()) {
          for (const m of maneuvers) this._descMap.set(m.uuid, m);
        }
      }
    }

    const knownManeuvers = this.actor ? ManeuverService.getActorManeuvers(this.actor) : [];
    const knownUuids     = new Set(knownManeuvers.map(m =>
      this.actor?.items.get(m.id)?.flags?.core?.sourceId ?? ''
    ).filter(Boolean));

    // Build tradition list
    const actorTraditions = new Set(this.actor ? ManeuverService.getActorTraditions(this.actor) : []);
    const allTraditions = getTraditions();
    const traditions = allTraditions
      .filter(t => {
        if (this.allowedTraditions.length) return this.allowedTraditions.includes(t.key);
        return true;
      })
      .map(t => {
        const tradMap = this._allManeuvers.get(t.key);
        const maneuverCount = tradMap
          ? [...tradMap.values()].flat().length
          : 0;
        return {
          key:           t.key,
          name:          t.label,
          known:         actorTraditions.has(t.key),
          selected:      this._selectedTraditions.has(t.key),
          maneuverCount
        };
      })
      // Only show traditions that have maneuvers or are known
      .filter(t => t.maneuverCount > 0 || t.known);

    // Build maneuver list for current filter
    const visibleManeuvers = this.#getVisibleManeuvers(knownUuids);

    const selectedCount = this._selectedUuids.size;
    const canSelectMore = this.slotsAvailable === -1 || (this.slotsAvailable > 0 && selectedCount < this.slotsAvailable);

    return {
      traditions,
      visibleManeuvers,
      activeTradition:   this._activeTradition,
      activeDegree:      this._activeDegree,
      searchText:        this._searchText,
      sortBy:            this._sortBy,
      sortDir:           this._sortDir,
      selectedUuids:     [...this._selectedUuids],
      selectedCount,
      slotsAvailable:    this.slotsAvailable,
      canSelectMore,
      maxDegree:         this.maxDegree,
      knownManeuvers,
      degrees:           [1, 2, 3, 4, 5].filter(d => d <= this.maxDegree),
      loading:           this._loading,
      freeManage:        this.slotsAvailable === -1
    };
  }

  /* ── Render ───────────────────────────────────────────── */

  async _onRender(_ctx, _opts) {
    const el = this.element;

    // Restore sidebar description panel if one was active
    const sidebarPanel = el.querySelector('.am-sidebar-desc');
    if (sidebarPanel) {
      if (this._sidebarDescHtml) {
        sidebarPanel.style.display = '';
        sidebarPanel.innerHTML = this._sidebarDescHtml;
      } else {
        sidebarPanel.style.display = 'none';
      }
    }

    // Tradition filter buttons
    el.querySelectorAll('.am-tradition-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const t = btn.dataset.tradition;
        this._activeTradition = this._activeTradition === t ? null : t;
        // Show tradition description in sidebar
        if (this._activeTradition) {
          const name = btn.querySelector('span')?.textContent?.trim() ?? t;
          this.#loadSidebarDesc(name);
        } else {
          this._sidebarDescHtml = null;
          const panel = el.querySelector('.am-sidebar-desc');
          if (panel) { panel.style.display = 'none'; panel.innerHTML = ''; }
        }
        this.render(false);
      });
    });

    // Tradition selection checkboxes (for first-level picking)
    el.querySelectorAll('.am-tradition-select').forEach(chk => {
      chk.addEventListener('change', (e) => {
        const t = e.target.dataset.tradition;
        if (e.target.checked) this._selectedTraditions.add(t);
        else this._selectedTraditions.delete(t);
      });
    });

    // Degree filter
    el.querySelectorAll('.am-degree-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const d = parseInt(btn.dataset.degree);
        this._activeDegree = this._activeDegree === d ? null : d;
        this.render(false);
      });
    });

    // Search
    const searchInput = el.querySelector('#maneuver-search');
    if (searchInput) {
      searchInput.value = this._searchText;
      searchInput.addEventListener('input', (e) => {
        this._searchText = e.target.value;
        this.render(false);
      });
    }

    // Sort controls
    el.querySelectorAll('.am-sort-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const by = btn.dataset.sort;
        if (this._sortBy === by) {
          this._sortDir = this._sortDir === 'asc' ? 'desc' : 'asc';
        } else {
          this._sortBy  = by;
          this._sortDir = 'asc';
        }
        this.render(false);
      });
    });

    // Maneuver select/deselect + right-click description
    el.querySelectorAll('.am-maneuver-card').forEach(card => {
      card.addEventListener('click', () => this.#toggleManeuver(card));
      card.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this.#showDescPanel(card, e.clientX, e.clientY);
      });
    });

    // Close desc panel on click outside
    el.addEventListener('click', (e) => {
      if (!e.target.closest('.am-item-desc-panel')) this.#closeDescPanel();
    }, true);

    // Confirm button
    el.querySelector('.am-maneuver-confirm')?.addEventListener('click', () => this.#confirm());

    // Cancel button
    el.querySelector('.am-maneuver-cancel')?.addEventListener('click', () => this.close());
  }

  /* ── Logic ────────────────────────────────────────────── */

  #getVisibleManeuvers(knownUuids) {
    const results = [];
    for (const [tradition, degreeMap] of this._allManeuvers) {
      if (this._activeTradition && tradition !== this._activeTradition) continue;
      if (this.allowedTraditions.length && !this.allowedTraditions.includes(tradition)) continue;

      for (const [degree, maneuvers] of degreeMap) {
        if (this._activeDegree && degree !== this._activeDegree) continue;
        if (degree > this.maxDegree) continue;

        for (const m of maneuvers) {
          if (this._searchText) {
            const q = this._searchText.toLowerCase();
            if (!m.name.toLowerCase().includes(q) &&
                !m.description.toLowerCase().includes(q)) continue;
          }
          results.push({
            ...m,
            alreadyKnown: knownUuids.has(m.uuid),
            selected:     this._selectedUuids.has(m.uuid)
          });
        }
      }
    }

    const dir = this._sortDir === 'desc' ? -1 : 1;
    return results.sort((a, b) => {
      switch (this._sortBy) {
        case 'name':
          return dir * a.name.localeCompare(b.name);
        case 'tradition':
          return dir * (a.traditionLabel || '').localeCompare(b.traditionLabel || '') || a.name.localeCompare(b.name);
        case 'degree':
        default:
          return dir * (a.degree - b.degree) || a.name.localeCompare(b.name);
      }
    });
  }

  #toggleManeuver(card) {
    const uuid = card.dataset.uuid;
    const alreadyKnown = card.classList.contains('am-already-known');
    if (alreadyKnown) return;

    if (this._selectedUuids.has(uuid)) {
      this._selectedUuids.delete(uuid);
      card.classList.remove('am-selected');
    } else {
      if (this.slotsAvailable !== -1 && (this.slotsAvailable === 0 || this._selectedUuids.size >= this.slotsAvailable)) {
        ui.notifications.warn(
          game.i18n.format('am.maneuvers.slots-full', { n: this.slotsAvailable })
        );
        return;
      }
      this._selectedUuids.add(uuid);
      card.classList.add('am-selected');
    }

    // Update counter
    const counter = this.element.querySelector('.am-selected-count');
    if (counter) counter.textContent = this._selectedUuids.size;
  }

  #showDescPanel(card, x, y) {
    this.#closeDescPanel();
    const uuid = card.dataset.uuid;
    const data = this._descMap.get(uuid) ?? {};

    const panel = document.createElement('div');
    panel.className = 'am-item-desc-panel';
    panel.innerHTML = `
      <div class="am-item-desc-header">
        <img src="${data.img ?? ''}" alt="" />
        <div class="am-item-desc-header-text">
          <div class="am-item-desc-title">${data.name ?? ''}</div>
          <div class="am-item-desc-meta">
            <span class="am-badge">${data.degree ?? ''}°</span>
            ${data.traditionLabel ? `<span>${data.traditionLabel}</span>` : ''}
            ${data.exertion ? `<span class="am-badge am-badge-gold"><i class="fa-solid fa-bolt"></i> ${data.exertion}</span>` : ''}
          </div>
        </div>
        <button class="am-item-desc-close" type="button">✕</button>
      </div>
      <div class="am-item-desc-body">${data.description || '<em>No description available.</em>'}</div>`;

    panel.querySelector('.am-item-desc-close').addEventListener('click', () => this.#closeDescPanel());
    document.body.appendChild(panel);

    const pw = 352, ph = Math.min(panel.scrollHeight, 512);
    const vw = window.innerWidth, vh = window.innerHeight;
    panel.style.left = `${Math.min(x + 8, vw - pw - 8)}px`;
    panel.style.top  = `${Math.min(y + 8, vh - ph - 8)}px`;
    this._descPanel = panel;
  }

  #closeDescPanel() {
    this._descPanel?.remove();
    this._descPanel = null;
  }

  async _preClose() {
    this.#closeDescPanel();
    return super._preClose?.() ?? true;
  }

  async #loadSidebarDesc(name) {
    this._sidebarDescHtml = `<strong>${name}</strong><p><em>${game.i18n.localize('am.app.loading')}</em></p>`;
    const panel = this.element?.querySelector('.am-sidebar-desc');
    if (panel) { panel.style.display = ''; panel.innerHTML = this._sidebarDescHtml; }
    const desc = await this.#lookupCompendiumDesc(name);
    this._sidebarDescHtml = `<strong>${name}</strong>${
      desc
        ? `<div class="am-desc-body">${desc}</div>`
        : `<p class="am-hint"><em>${game.i18n.localize('am.app.no-description')}</em></p>`
    }`;
    const p2 = this.element?.querySelector('.am-sidebar-desc');
    if (p2) p2.innerHTML = this._sidebarDescHtml;
  }

  async #lookupCompendiumDesc(name) {
    if (this._compendiumCache.has(name)) return this._compendiumCache.get(name);
    const q = name.toLowerCase().trim();
    for (const pack of game.packs) {
      if (!['JournalEntry', 'Item'].includes(pack.metadata.type)) continue;
      try {
        const index = await pack.getIndex();
        const hit = index.find(e => e.name.toLowerCase().trim() === q);
        if (!hit) continue;
        const doc = await pack.getDocument(hit._id);
        const desc = pack.metadata.type === 'JournalEntry'
          ? (doc.pages?.find(p => p.type === 'text')?.text?.content ?? '')
          : (doc.system?.description?.value ?? '');
        if (desc) { this._compendiumCache.set(name, desc); return desc; }
      } catch {}
    }
    this._compendiumCache.set(name, '');
    return '';
  }

  async #confirm() {
    const selectedUuids     = [...this._selectedUuids];
    const selectedTraditions = [...this._selectedTraditions];

    if (this.onConfirm) {
      await this.onConfirm(selectedUuids, selectedTraditions);
    } else {
      // Direct apply mode
      await ManeuverService.applyManeuversToActor(
        this.actor, selectedUuids, selectedTraditions
      );
    }
    this.close();
  }
}
