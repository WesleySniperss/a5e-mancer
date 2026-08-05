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
    this.actor = actor;

    // What the character's class tables actually entitle them to. Used whenever the
    // caller doesn't state a limit — opening this from the sheet used to mean
    // "unlimited", which let players take every maneuver and every tradition.
    const ent = ManeuverService.getActorEntitlement(actor);
    this.entitlement = ent;

    this.slotsAvailable    = options.slotsAvailable ?? ent?.remainingManeuvers ?? -1;
    this.maxDegree         = options.maxDegree      ?? ent?.maxDegree ?? 5;
    this.allowedTraditions = options.allowedTraditions
                             ?? (ent?.allowedTraditions ? [...ent.allowedTraditions] : []);
    this.traditionLimit    = options.traditionLimit  ?? ent?.traditions ?? 0;
    this.onConfirm         = options.onConfirm ?? null;
    // GMs can lift the caps for homebrew/corrections via the footer toggle.
    this._unlocked         = false;

    // State — restore previous selections so re-opening can't duplicate picks
    this._allManeuvers     = new Map(); // tradition → Map<degree, maneuver[]>
    this._selectedUuids    = new Set(options.initialSelectedUuids ?? []);
    this._activeTradition  = null;
    this._activeDegree     = null;
    this._searchText       = '';
    this._sortBy           = 'degree'; // 'degree' | 'name' | 'tradition'
    this._sortDir          = 'asc';    // 'asc' | 'desc'
    this._loading          = true;
    // Traditions the player is claiming in this session. Starts empty — seeding it
    // from allowedTraditions granted proficiency in every tradition the class *may*
    // choose, instead of the ones actually picked.
    this._selectedTraditions = new Set(options.initialSelectedTraditions ?? []);
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
    // Source UUIDs *and* names — reading only flags.core.sourceId (removed in v12)
    // returned an empty set, so every known maneuver stayed pickable and got added twice.
    const knownUuids     = ManeuverService.getActorManeuverKeys(this.actor);

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
    const slots         = this.#effectiveSlots();
    const canSelectMore = slots === -1 || (slots > 0 && selectedCount < slots);

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
      slotsAvailable:    slots,
      showSlots:         slots > 0,
      canSelectMore,
      maxDegree:         this.maxDegree,
      knownManeuvers,
      knownCount:        this.entitlement?.knownCount ?? knownManeuvers.length,
      entitlement:       this.entitlement,
      traditionLimit:    this.#effectiveTraditionLimit(),
      selectedTraditionCount: this._selectedTraditions.size,
      isGM:              game.user.isGM,
      unlocked:          this._unlocked,
      degrees:           [1, 2, 3, 4, 5].filter(d => d <= this.maxDegree),
      loading:           this._loading,
      freeManage:        slots === -1
    };
  }

  /** Slot cap in force right now (-1 = uncapped). */
  #effectiveSlots() {
    return this._unlocked ? -1 : this.slotsAvailable;
  }

  /** Tradition cap in force right now (0 = uncapped). */
  #effectiveTraditionLimit() {
    return this._unlocked ? 0 : this.traditionLimit;
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

    // GM unlock — lifts the slot/tradition caps for homebrew or corrections
    el.querySelector('.am-maneuver-unlock')?.addEventListener('click', () => {
      this._unlocked = !this._unlocked;
      this.render(false);
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
            alreadyKnown: ManeuverService.isKnown(knownUuids, m),
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
    const tradition = card.dataset.tradition || '';
    if (card.classList.contains('am-already-known')) {
      ui.notifications.warn(game.i18n.localize('am.maneuvers.already-known'));
      return;
    }

    const slots      = this.#effectiveSlots();
    const tradLimit  = this.#effectiveTraditionLimit();

    if (this._selectedUuids.has(uuid)) {
      this._selectedUuids.delete(uuid);
      card.classList.remove('am-selected');
      // Release the tradition if this was the last pick from it
      if (tradition && !this.#actorHasTradition(tradition) && !this.#anySelectedFrom(tradition)) {
        this._selectedTraditions.delete(tradition);
      }
    } else {
      if (slots !== -1 && (slots === 0 || this._selectedUuids.size >= slots)) {
        ui.notifications.warn(
          slots === 0
            ? game.i18n.localize('am.maneuvers.no-slots')
            : game.i18n.format('am.maneuvers.slots-full', { n: slots })
        );
        return;
      }
      // A5e classes are proficient in a fixed number of combat traditions —
      // picking from a new one past that cap is not a legal choice.
      if (tradition && !this.#actorHasTradition(tradition) && !this._selectedTraditions.has(tradition)) {
        const used = new Set([
          ...ManeuverService.getActorTraditions(this.actor ?? { system: {} }),
          ...this._selectedTraditions
        ]);
        if (tradLimit > 0 && used.size >= tradLimit) {
          ui.notifications.warn(game.i18n.format('am.app.maneuvers.tradition-limit', { n: tradLimit }));
          return;
        }
        this._selectedTraditions.add(tradition);
      }
      this._selectedUuids.add(uuid);
      card.classList.add('am-selected');
    }

    // Update counter
    const counter = this.element.querySelector('.am-selected-count');
    if (counter) counter.textContent = this._selectedUuids.size;
    const tradCounter = this.element.querySelector('.am-selected-tradition-count');
    if (tradCounter) tradCounter.textContent = this._selectedTraditions.size;
  }

  #actorHasTradition(tradition) {
    if (!this.actor) return false;
    return ManeuverService.getActorTraditions(this.actor).includes(tradition);
  }

  /** Is any still-selected maneuver from this tradition? */
  #anySelectedFrom(tradition) {
    const tradMap = this._allManeuvers.get(tradition);
    if (!tradMap) return false;
    const uuids = new Set([...tradMap.values()].flat().map(m => m.uuid));
    return [...this._selectedUuids].some(u => uuids.has(u));
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
