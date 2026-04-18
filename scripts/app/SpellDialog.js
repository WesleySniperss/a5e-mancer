import { AM } from '../a5e-mancer.js';
import { SpellService, getSpellSchools, getSecondarySchoolsForClass } from '../utils/spellService.js';

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class SpellDialog extends HandlebarsApplicationMixin(ApplicationV2) {

  /**
   * @param {Actor|null} actor  - null during character creation
   * @param {object} options
   * @param {string}   options.className
   * @param {number}   options.cantripsToChoose
   * @param {number}   options.spellsToChoose
   * @param {number}   options.maxSpellLevel
   * @param {Function} options.onConfirm  callback(cantrips[], spells[])
   */
  constructor(actor, options = {}) {
    super(options);
    this.actor            = actor;
    this.className        = options.className ?? '';
    this.cantripsToChoose = options.cantripsToChoose ?? 0;
    this.spellsToChoose   = options.spellsToChoose ?? 0;
    this.maxSpellLevel    = options.maxSpellLevel ?? 1;
    this.onConfirm        = options.onConfirm ?? null;

    this._allSpells        = new Map(); // level → spell[]
    // Pre-populate from AM.creationSpells so re-opening the dialog restores selections
    this._selectedCantrips = new Set(AM.creationSpells?.cantrips ?? []);
    this._selectedSpells   = new Set(AM.creationSpells?.spells   ?? []);
    this._activeLevel           = null;    // null = show all
    this._activeSchool          = null;    // primary school filter
    this._activeSecondarySchool = null;    // secondary school tag filter
    this._searchText            = '';
    this._sortBy           = 'level'; // 'level' | 'name' | 'school'
    this._sortDir          = 'asc';   // 'asc' | 'desc'
    this._loading          = true;
    this._descMap          = new Map(); // uuid → full spell data for description panel
    this._sidebarDescHtml  = null;      // null = hidden, string = rendered HTML
    this._compendiumCache  = new Map(); // school name → description string
  }

  static DEFAULT_OPTIONS = {
    id: 'a5e-spell-dialog',
    tag: 'div',
    classes: ['am-app', 'am-spell-dialog'],
    position: { width: 820, height: 620 },
    window: { icon: 'fa-solid fa-sparkles', resizable: true, minimizable: false }
  };

  static PARTS = {
    main: { template: 'modules/a5e-mancer/templates/spell-dialog.hbs' }
  };

  get title() {
    return game.i18n.format('am.spells.title', { class: this.className });
  }

  /* ── Context ──────────────────────────────────────────── */

  async _prepareContext(_options) {
    if (this._loading) {
      this._allSpells = await SpellService.loadSpells(this.className, this.maxSpellLevel);
      this._loading   = false;
      // Pre-fill desc map with all loaded spells
      for (const spells of this._allSpells.values()) {
        for (const s of spells) this._descMap.set(s.uuid, s);
      }
    }

    // Build set of known spell identifiers: compendium source UUID + name fallback
    const knownUuids = this.actor ? (() => {
      const s = new Set();
      for (const spell of SpellService.getActorSpells(this.actor)) {
        const item = this.actor.items.get(spell.id);
        const src  = item?._stats?.compendiumSource ?? item?.flags?.core?.sourceId;
        if (src) s.add(src);
        s.add(spell.name.toLowerCase()); // name fallback
      }
      return s;
    })() : new Set();

    const visibleSpells = this.#getVisible(knownUuids);

    const levels = [...this._allSpells.entries()]
      .filter(([l, spells]) => spells.length && l <= this.maxSpellLevel)
      .map(([l]) => l);

    return {
      className:             this.className,
      cantripsToChoose:      this.cantripsToChoose,
      spellsToChoose:        this.spellsToChoose,
      maxSpellLevel:         this.maxSpellLevel,
      selectedCantrips:      this._selectedCantrips.size,
      selectedSpells:        this._selectedSpells.size,
      activeLevel:           this._activeLevel,
      activeSchool:          this._activeSchool,
      activeSecondarySchool: this._activeSecondarySchool,
      searchText:            this._searchText,
      sortBy:                this._sortBy,
      sortDir:               this._sortDir,
      levels,
      schools:               getSpellSchools(),
      secondarySchools:      getSecondarySchoolsForClass(this.className),
      visibleSpells,
      loading:               this._loading,
      totalSelected:         this._selectedCantrips.size + this._selectedSpells.size
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

    // Level filter
    el.querySelectorAll('.am-level-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const l = parseInt(btn.dataset.level);
        this._activeLevel = this._activeLevel === l ? null : l;
        this.render(false);
      });
    });

    // Primary school filter
    el.querySelectorAll('.am-school-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const s = btn.dataset.school;
        this._activeSchool = this._activeSchool === s ? null : s;
        this._activeSecondarySchool = null; // clear secondary when primary changes
        if (this._activeSchool) {
          const name = btn.textContent?.trim() ?? s;
          this.#loadSidebarDesc(name);
        } else {
          this._sidebarDescHtml = null;
          const panel = el.querySelector('.am-sidebar-desc');
          if (panel) { panel.style.display = 'none'; panel.innerHTML = ''; }
        }
        this.render(false);
      });
    });

    // Secondary school (tag) filter
    el.querySelectorAll('.am-secondary-school-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const s = btn.dataset.school;
        this._activeSecondarySchool = this._activeSecondarySchool === s ? null : s;
        this._activeSchool = null; // clear primary when secondary changes
        if (this._activeSecondarySchool) {
          const name = btn.textContent?.trim() ?? s;
          this.#loadSidebarDesc(name);
        } else {
          this._sidebarDescHtml = null;
          const panel = el.querySelector('.am-sidebar-desc');
          if (panel) { panel.style.display = 'none'; panel.innerHTML = ''; }
        }
        this.render(false);
      });
    });

    // Search
    const search = el.querySelector('#spell-search');
    if (search) {
      search.value = this._searchText;
      search.addEventListener('input', (e) => {
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

    // Spell cards
    el.querySelectorAll('.am-spell-card').forEach(card => {
      card.addEventListener('click', () => this.#toggleSpell(card));
      card.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this.#showDescPanel(card, e.clientX, e.clientY);
      });
    });

    // Close desc panel on click outside
    el.addEventListener('click', (e) => {
      if (!e.target.closest('.am-item-desc-panel')) this.#closeDescPanel();
    }, true);

    // Buttons
    el.querySelector('.am-spell-confirm')?.addEventListener('click', () => this.#confirm());
    el.querySelector('.am-spell-cancel')?.addEventListener('click',  () => this.close());
  }

  /* ── Logic ────────────────────────────────────────────── */

  #getVisible(knownUuids) {
    const results = [];
    for (const [level, spells] of this._allSpells) {
      if (level > this.maxSpellLevel) continue;
      if (this._activeLevel !== null && level !== this._activeLevel) continue;
      for (const s of spells) {
        if (this._activeSchool && s.school !== this._activeSchool) continue;
        if (this._activeSecondarySchool &&
            !s.secondarySchools?.includes(this._activeSecondarySchool)) continue;
        if (this._searchText) {
          const q = this._searchText.toLowerCase();
          if (!s.name.toLowerCase().includes(q) &&
              !s.description.toLowerCase().includes(q)) continue;
        }
        results.push({
          ...s,
          alreadyKnown: knownUuids.has(s.uuid) || knownUuids.has(s.name.toLowerCase()),
          selected:     this._selectedCantrips.has(s.uuid) || this._selectedSpells.has(s.uuid),
          levelLabel:   level === 0 ? 'Cantrip' : `Level ${level}`
        });
      }
    }

    const dir = this._sortDir === 'desc' ? -1 : 1;
    return results.sort((a, b) => {
      switch (this._sortBy) {
        case 'name':
          return dir * a.name.localeCompare(b.name);
        case 'school':
          return dir * (a.school || '').localeCompare(b.school || '') || a.name.localeCompare(b.name);
        case 'level':
        default:
          return dir * (a.level - b.level) || a.name.localeCompare(b.name);
      }
    });
  }

  #toggleSpell(card) {
    const uuid  = card.dataset.uuid;
    const level = parseInt(card.dataset.level);
    if (card.classList.contains('am-already-known')) return;

    const isCantrip  = level === 0;
    const set        = isCantrip ? this._selectedCantrips : this._selectedSpells;
    const limit      = isCantrip ? this.cantripsToChoose  : this.spellsToChoose;
    const limitLabel = isCantrip ? 'am.spells.cantrips-full' : 'am.spells.spells-full';

    if (set.has(uuid)) {
      set.delete(uuid);
    } else {
      // -1 = unlimited (character sheet management); 0 = none allowed; >0 = capped
      if (limit !== -1 && set.size >= limit) {
        ui.notifications.warn(
          limit === 0
            ? game.i18n.localize('am.spells.none-allowed')
            : game.i18n.format(limitLabel, { n: limit })
        );
        return;
      }
      set.add(uuid);
    }

    // Persist selections to AM.creationSpells immediately (for creation flow)
    // so that closing and reopening the dialog restores the in-progress selection
    if (!this.actor) {
      AM.creationSpells = {
        cantrips: [...this._selectedCantrips],
        spells:   [...this._selectedSpells],
        names:    AM.creationSpells?.names ?? []
      };
    }

    // Update just this card visually
    card.classList.toggle('am-selected', set.has(uuid));
    const counter = this.element.querySelector(
      isCantrip ? '.am-cantrip-count' : '.am-spell-count'
    );
    if (counter) counter.textContent = set.size;
  }

  #showDescPanel(card, x, y) {
    this.#closeDescPanel();
    const uuid = card.dataset.uuid;
    const data = this._descMap.get(uuid) ?? {};
    const level = parseInt(card.dataset.level ?? 0);

    const panel = document.createElement('div');
    panel.className = 'am-item-desc-panel';
    panel.innerHTML = `
      <div class="am-item-desc-header">
        <img src="${data.img ?? ''}" alt="" />
        <div class="am-item-desc-header-text">
          <div class="am-item-desc-title">${data.name ?? ''}</div>
          <div class="am-item-desc-meta">
            <span class="am-badge ${level === 0 ? 'am-badge-cantrip' : 'am-badge-spell'}">${data.levelLabel ?? card.dataset.levelLabel ?? ''}</span>
            ${data.schoolLabel ? `<span>${data.schoolLabel}</span>` : ''}
            ${data.ritual ? '<span class="am-badge am-badge-ritual">Ritual</span>' : ''}
            ${data.concentration ? '<span class="am-badge am-badge-conc">Concentration</span>' : ''}
          </div>
        </div>
        <button class="am-item-desc-close" type="button">✕</button>
      </div>
      <div class="am-item-desc-body">${data.description || '<em>No description available.</em>'}</div>`;

    panel.querySelector('.am-item-desc-close').addEventListener('click', () => this.#closeDescPanel());
    document.body.appendChild(panel);

    // Position: keep within viewport
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
    if (this.onConfirm) {
      await this.onConfirm([...this._selectedCantrips], [...this._selectedSpells]);
    } else if (this.actor) {
      const all = [...this._selectedCantrips, ...this._selectedSpells];
      await SpellService.applySpellsToActor(this.actor, all);
    }
    this.close();
  }
}
