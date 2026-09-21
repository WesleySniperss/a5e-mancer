import { AM } from '../am.js';
import { FeatService } from '../utils/featService.js';
import { ItemDescPanel } from '../utils/itemDescPanel.js';
import { DocumentService } from '../utils/documentService.js';
import { PackFilter } from '../utils/packFilter.js';

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * "Add Feat" on the character sheet's Features tab.
 *
 * It was a plain dialog: one name-only search over a column of rows, the
 * prerequisite in faint small print, no filter and no way to read a feat
 * before taking it. The level-up already had a proper picker - the ones the
 * character qualifies for, their own class's, the ungated, four orders, pages,
 * the prerequisite on each card, right-click for the text - so this is that
 * picker in a window of its own, on the same FeatService and the same cards.
 *
 * Adding creates the feat the way a5e creates a dropped item, so a5e's own
 * grant window asks any choices the feat carries: there is no builder here to
 * have asked them.
 */
export class FeatDialog extends HandlebarsApplicationMixin(ApplicationV2) {

  static PAGE = 40;

  constructor(actor, options = {}) {
    super(options);
    this.actor = actor;
    // The level-up's defaults: the eligible ones first, 600-odd is not a list
    this._search       = '';
    this._onlyEligible = true;
    this._onlyMyClass  = false;
    this._onlyUngated  = false;
    this._sort         = 'name';
    this._dir          = 'asc';
    this._page         = 0;
    this._chosen       = null;
    this._descCache    = new Map();
  }

  static DEFAULT_OPTIONS = {
    id: 'a5e-mancer-feat-dialog',
    tag: 'div',
    classes: ['a5e-mancer-app', 'am-app', 'am-feat-dialog'],
    position: { width: 660, height: 700 },
    window: { icon: 'fa-solid fa-star', resizable: true, minimizable: false },
    actions: {
      fdToggle: FeatDialog.#onToggle,
      fdSort:   FeatDialog.#onSort,
      fdPage:   FeatDialog.#onPage,
      fdSelect: FeatDialog.#onSelect,
      fdAdd:    FeatDialog.#onAdd
    }
  };

  static PARTS = {
    main: { template: 'modules/a5e-mancer/templates/feat-dialog.hbs', scrollable: [''] }
  };

  get title() {
    const label = game.i18n.localize('am.feats.add-title');
    return this.actor ? `${label} — ${this.actor.name}` : label;
  }

  /* ── context ──────────────────────────────────────────── */

  async _prepareContext(_options) {
    let feats = [], total = 0, failed = false;
    try {
      total = (await FeatService.loadAll()).length;
      feats = await FeatService.optionsFor(this.actor, {
        search:       this._search,
        onlyEligible: this._onlyEligible,
        sort:         this._sort,
        dir:          this._dir,
        onlyMyClass:  this._onlyMyClass,
        onlyUngated:  this._onlyUngated
      });
    } catch (err) {
      AM.log(1, 'Feats could not be loaded:', err);
      failed = true;
    }

    const pages = Math.max(1, Math.ceil(feats.length / FeatDialog.PAGE));
    this._page  = Math.min(Math.max(0, this._page), pages - 1);
    const owned = FeatDialog.#ownedKeys(this.actor);
    const slice = feats.slice(this._page * FeatDialog.PAGE, (this._page + 1) * FeatDialog.PAGE);
    const chosen = this._chosen ? feats.find(f => f.uuid === this._chosen) ?? null : null;

    return {
      failed,
      noneLoaded:       !failed && total === 0,
      featSearch:       this._search,
      featOnlyEligible: this._onlyEligible,
      featMyClassOnly:  this._onlyMyClass,
      featUngatedOnly:  this._onlyUngated,
      featSortDir:      this._dir,
      featSorts: Object.entries(FeatService.SORTS).map(([key, s]) => ({
        key, label: s.label, active: this._sort === key
      })),
      featTotal:   feats.length,
      featPage:    this._page + 1,
      featPages:   pages,
      featHasPrev: this._page > 0,
      featHasNext: this._page < pages - 1,
      feats: slice.map(f => ({
        ...f,
        selected: f.uuid === this._chosen,
        owned: owned.has(PackFilter.normalizeSource(f.uuid)) || owned.has(f.name.toLowerCase())
      })),
      chosen
    };
  }

  /** Feats already on the character, by compendium source and by name. */
  static #ownedKeys(actor) {
    const keys = new Set();
    for (const item of actor?.items ?? []) {
      if (!FeatService.isFeat(item)) continue;
      const src = item._stats?.compendiumSource ?? item.flags?.core?.sourceId ?? '';
      if (src) keys.add(PackFilter.normalizeSource(src));
      keys.add(item.name.toLowerCase());
    }
    return keys;
  }

  /* ── render ───────────────────────────────────────────── */

  async _onRender(_context, _options) {
    const el = this.element;

    this._detachDescPanel?.();
    this._detachDescPanel = ItemDescPanel.attach(el, '.am-card[data-uuid]');

    // The search re-renders the part, which replaces the field being typed into
    const search = el.querySelector('.am-feat-search');
    if (search) {
      search.addEventListener('input', (e) => {
        this._search = e.target.value ?? '';
        this._page = 0;
        this._searchFocused = true;
        this.render();
      });
      if (this._searchFocused) {
        search.focus();
        search.setSelectionRange(search.value.length, search.value.length);
      }
    }

    // Hovering a card reads its text into the panel below, as in the level-up
    const grid  = el.querySelector('.am-inline-card-grid');
    const panel = el.querySelector('.am-inline-description');
    if (grid && panel) {
      const hint = panel.innerHTML;
      grid.addEventListener('mouseover', async (e) => {
        const card = e.target.closest('.am-card[data-uuid]');
        if (!card) return;
        const uuid = card.dataset.uuid;
        if (!this._descCache.has(uuid)) {
          panel.innerHTML = `<p class="am-loading"><i class="fas fa-spinner fa-spin"></i></p>`;
          const html = await DocumentService.getEnrichedDescription(uuid);
          this._descCache.set(uuid, html || `<p class="am-hint">${game.i18n.localize('am.app.no-description')}</p>`);
        }
        if (panel.isConnected) panel.innerHTML = this._descCache.get(uuid);
      });
      grid.addEventListener('mouseleave', () => { panel.innerHTML = hint; });
    }
  }

  async _preClose(options) {
    this._detachDescPanel?.();
    this._detachDescPanel = null;
    return super._preClose?.(options);
  }

  /* ── actions (this = the dialog) ──────────────────────── */

  static #onToggle(_event, target) {
    const which = target.dataset.filter;
    if (which === 'eligible') this._onlyEligible = !this._onlyEligible;
    else if (which === 'my-class') this._onlyMyClass = !this._onlyMyClass;
    else if (which === 'ungated') this._onlyUngated = !this._onlyUngated;
    this._page = 0;
    this.render();
  }

  /* Clicking the order in force reverses it, as the level-up's sort does. */
  static #onSort(_event, target) {
    const key = target.dataset.sort;
    if (!key) return;
    if (this._sort === key) this._dir = this._dir === 'asc' ? 'desc' : 'asc';
    else { this._sort = key; this._dir = 'asc'; }
    this._page = 0;
    this.render();
  }

  static #onPage(_event, target) {
    this._page = Math.max(0, this._page + Number(target.dataset.dir ?? 0));
    this.render();
  }

  static #onSelect(_event, target) {
    const uuid = target.dataset.uuid;
    this._chosen = this._chosen === uuid ? null : uuid;
    this.render();
  }

  static async #onAdd() {
    const uuid = this._chosen;
    if (!uuid || !this.actor) return;
    try {
      const item = await fromUuid(uuid);
      if (!item) return;
      /* Created the way a5e creates a dropped item, so its grant window asks
         the feat's own choices. The source is recorded, as the other dialogs
         record it, so the feat is known as owned afterwards. */
      const data = item.toObject();
      data._stats = { ...(data._stats ?? {}), compendiumSource: uuid };
      await Item.create(data, { parent: this.actor });
      ui.notifications.info(game.i18n.format('am.feats.added', { name: item.name }));
      this._chosen = null;
      this.render();
    } catch (err) {
      AM.log(1, 'Could not add the feat:', err);
      ui.notifications.error(game.i18n.format('am.feats.add-failed', { error: err.message }));
    }
  }
}
