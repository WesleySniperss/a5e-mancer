import { AM } from '../a5e-mancer.js';
import { DocumentService } from './documentService.js';
import { EquipmentService } from './equipmentService.js';
import { ManeuverService } from './maneuverService.js';
import { SpellService } from './spellService.js';
import { GrantAbsorber } from './grantAbsorber.js';
import { ItemDescPanel } from './itemDescPanel.js';
import { LoreTableService } from './loreTableService.js';
import { LevelUpService } from './levelUpService.js';

const ITEM_TYPES = ['heritage', 'culture', 'background', 'destiny', 'class'];

export class DOMManager {
  static #listeners  = [];
  static #descCache  = new Map(); // uuid → enriched HTML

  static async initialize(form) {
    this.cleanup();

    // ── Item dropdowns ───────────────────────────────────
    for (const type of ITEM_TYPES) {
      const dropdown = form.querySelector(`#${type}-dropdown`);
      if (!dropdown) continue;
      const handler = (e) => this.#onDropdownChange(type, e.target, form);
      dropdown.addEventListener('change', handler);
      this.#listeners.push({ el: dropdown, type: 'change', fn: handler });
      {
        const raw  = dropdown.value || '';
        // Fallback to AM.SELECTED when detail view re-renders (dropdown loses its value
        // because no option has the `selected` attribute in the Handlebars template)
        const uuid = this.#extractUuid(raw) || AM.SELECTED[type]?.uuid || null;
        if (!AM.SELECTED[type]?.uuid && uuid) {
          AM.SELECTED[type] = { value: raw, id: raw.split(' ')[0], uuid };
        }
        // Restore dropdown.value so formData includes the right value at submit time
        if (!raw && AM.SELECTED[type]?.value) {
          dropdown.value = AM.SELECTED[type].value;
        }
        if (uuid) this.#loadDescription(type, uuid, form);
        // Highlight the selected card when the card browser is visible
        const effectiveRaw = dropdown.value;
        if (effectiveRaw) {
          const grid = form.querySelector(`.am-card-grid[data-type="${type}"]`);
          if (grid) {
            grid.querySelectorAll('.am-card').forEach(c => {
              c.classList.toggle('am-card-selected', c.dataset.value === effectiveRaw);
            });
          }
        }
      }
    }

    // ── Card search inputs ────────────────────────────────
    for (const input of form.querySelectorAll('.am-card-search')) {
      const type = input.dataset.for;
      const fn = () => {
        const q = input.value.toLowerCase().trim();
        const grid = form.querySelector(`.am-card-grid[data-type="${type}"]`);
        if (!grid) return;
        grid.querySelectorAll('.am-card').forEach(card => {
          card.hidden = !!(q && !card.dataset.name.toLowerCase().includes(q));
        });
      };
      input.addEventListener('input', fn);
      this.#listeners.push({ el: input, type: 'input', fn });
    }

    // ── Heritage Gift radio buttons (dynamic) ────────────
    form.querySelectorAll('.am-gift-option').forEach(radio => {
      const fn = (e) => this.#onGiftSelected(e.target, form);
      radio.addEventListener('change', fn);
      this.#listeners.push({ el: radio, type: 'change', fn });
    });

    // ── Equipment choices ────────────────────────────────
    form.querySelectorAll('.am-equipment-option-btn').forEach(btn => {
      const fn = () => this.#onEquipmentChoice(btn, form);
      btn.addEventListener('click', fn);
      this.#listeners.push({ el: btn, type: 'click', fn });
    });

    // ── Standard array uniqueness ────────────────────────
    const arrayDropdowns = [...form.querySelectorAll('.ability-dropdown')];
    if (arrayDropdowns.length) {
      // How many times each value may be used. A rolled pool can hold the same
      // number twice (4d6kh3 repeats often), so capacity is a count, not a flag.
      // Without data-ability-pool every value has capacity 1 — the standard array.
      const poolCsv = form.querySelector('.ability-container[data-ability-pool]')
        ?.dataset.abilityPool ?? '';
      const capacity = new Map();
      for (const raw of poolCsv.split(',')) {
        const v = raw.trim();
        if (v) capacity.set(v, (capacity.get(v) ?? 0) + 1);
      }

      const enforceUnique = () => {
        const used = new Map();
        for (const dd of arrayDropdowns) {
          if (!dd.value) continue;
          used.set(dd.value, (used.get(dd.value) ?? 0) + 1);
        }
        for (const dd of arrayDropdowns) {
          const current = dd.value;
          for (const opt of dd.options) {
            if (!opt.value) continue;
            const max   = capacity.get(opt.value) ?? 1;
            const taken = (used.get(opt.value) ?? 0) - (opt.value === current ? 1 : 0);
            opt.disabled = taken >= max;
          }
        }
        DOMManager.updateAbilitiesSummary(form);
        DOMManager.updateTabIndicators(form);
      };
      for (const dd of arrayDropdowns) {
        const fn = enforceUnique;
        dd.addEventListener('change', fn);
        this.#listeners.push({ el: dd, type: 'change', fn });
      }
      enforceUnique();
    }

    // ── Manual / point-buy ability inputs ────────────────
    // Only the standard-array dropdowns had listeners, so rolled and point-buy
    // scores never refreshed the review panel or the tab-complete indicator.
    for (const el of form.querySelectorAll('.ability-score, .ability-block.point-buy input[type="hidden"]')) {
      const fn = () => {
        DOMManager.updateAbilitiesSummary(form);
        DOMManager.updateTabIndicators(form);
      };
      el.addEventListener('change', fn);
      this.#listeners.push({ el, type: 'change', fn });
      if (el.classList.contains('ability-score')) {
        el.addEventListener('input', fn);
        this.#listeners.push({ el, type: 'input', fn });
      }
    }

    // ── Roll method selector ─────────────────────────────
    const rollMethodSel = form.querySelector('#roll-method');
    if (rollMethodSel) {
      const fn = async (e) => {
        await game.settings.set(AM.ID, 'diceRollingMethod', e.target.value);
        AM.app?.render(false, { parts: ['abilities'] });
      };
      rollMethodSel.addEventListener('change', fn);
      this.#listeners.push({ el: rollMethodSel, type: 'change', fn });
    }

    // ── Character name ───────────────────────────────────
    const nameInput = form.querySelector('#character-name');
    if (nameInput) {
      const fn = () => this.#updateNameDisplay(form);
      nameInput.addEventListener('input', fn);
      this.#listeners.push({ el: nameInput, type: 'input', fn });
    }

    // ── Token art link ───────────────────────────────────
    const linkChk = form.querySelector('#link-token-art');
    if (linkChk) {
      const fn = () => this.#syncTokenArtRow(form);
      linkChk.addEventListener('change', fn);
      this.#listeners.push({ el: linkChk, type: 'change', fn });
    }

    // ── Starting wealth manual input ─────────────────────
    const wealthInput = form.querySelector('#starting-wealth-amount');
    if (wealthInput) {
      const fn = () => this.#updateWealthDisplay(form);
      wealthInput.addEventListener('input', fn);
      this.#listeners.push({ el: wealthInput, type: 'input', fn });
    }

    // ── Destiny narrative fields → live review sync ───────
    for (const id of ['destinyMotivation', 'destinyGoals', 'destinyConnection',
                       'destinyFulfillment', 'destinyInspiration']) {
      const el = form.querySelector(`#${id}`);
      if (!el) continue;
      const fn = () => this.#updateDestinyNarrativePreview(form);
      el.addEventListener('input', fn);
      this.#listeners.push({ el, type: 'input', fn });
    }

    // ── Right-click a card for the full description + its costs ──
    // Hover gives the short inline blurb; this is the "what does it cost me"
    // popup (exertion, casting time, components, uses).
    {
      const detach = ItemDescPanel.attach(form);
      this.#listeners.push({ el: form, type: '__cleanup', fn: detach });
    }

    // ── Inline card description hover ────────────────────
    for (const grid of form.querySelectorAll('.am-inline-card-grid')) {
      const panel = grid.closest('.lu-section, fieldset')?.querySelector('.am-inline-description');
      if (!panel) continue;
      const hintHtml = `<p class="am-hint am-inline-desc-hint">${game.i18n.localize('am.app.hover-for-description')}</p>`;
      if (!panel.innerHTML.trim()) panel.innerHTML = hintHtml;

      const onMouseover = async (e) => {
        const card = e.target.closest('.am-card[data-uuid]');
        if (!card) return;
        const uuid = card.dataset.uuid;
        if (this.#descCache.has(uuid)) {
          panel.innerHTML = this.#descCache.get(uuid);
        } else {
          panel.innerHTML = `<p class="am-loading"><i class="fas fa-spinner fa-spin"></i></p>`;
          const html = await DocumentService.getEnrichedDescription(uuid);
          const content = html || `<p class="am-hint">${game.i18n.localize('am.app.no-description')}</p>`;
          this.#descCache.set(uuid, content);
          if (panel.isConnected) panel.innerHTML = content;
        }
      };
      const onMouseleave = () => { panel.innerHTML = hintHtml; };

      grid.addEventListener('mouseover', onMouseover);
      grid.addEventListener('mouseleave', onMouseleave);
      this.#listeners.push({ el: grid, type: 'mouseover', fn: onMouseover });
      this.#listeners.push({ el: grid, type: 'mouseleave', fn: onMouseleave });
    }

    this.updateTabIndicators(form);
    this.updateReviewTab(form);
    this.updateProgressBar(form);
  }

  static cleanup() {
    for (const { el, type, fn } of this.#listeners) {
      // '__cleanup' entries hold a teardown function rather than a listener
      try { type === '__cleanup' ? fn() : el.removeEventListener(type, fn); } catch {}
    }
    this.#listeners = [];
  }

  /* ── Dropdown handlers ──────────────────────────────── */

  static async #onDropdownChange(type, select, form) {
    const raw  = select.value;
    const uuid = this.#extractUuid(raw);
    AM.SELECTED[type] = { value: raw, id: raw.split(' ')[0], uuid: uuid || '' };

    // Look up name + img from the loaded doc list (covers randomize and savedOptions restore;
    // cardSelect overwrites these immediately after the dispatch anyway)
    if (uuid) {
      for (const group of (AM.documents?.[type] ?? [])) {
        const doc = group.docs?.find(d => d.uuid === uuid);
        if (doc) { AM.SELECTED[type].name = doc.name; AM.SELECTED[type].img = doc.img; break; }
      }
    }

    // Sync card grid selection state (covers randomize + savedOptions restore)
    const grid = form.querySelector(`.am-card-grid[data-type="${type}"]`);
    if (grid) {
      grid.querySelectorAll('.am-card').forEach(c => {
        c.classList.toggle('am-card-selected', !!raw && c.dataset.value === raw);
      });
    }

    if (uuid) {
      await this.#loadDescription(type, uuid, form);
      // Grants we can ask for ourselves, so a5e's window stays shut for this item
      await this.loadItemGrants(type, uuid);
      // Spells an origin gives in its text. a5e has no grant type for spells, so
      // these are written in prose and recorded nowhere; without this they were
      // never gained at all.
      await this.loadOriginSpells(type, uuid);
      // Lore tables live in the description; the Biography tab rolls them
      if (type === 'destiny' || type === 'background') {
        AM.loreTables[type] = await LoreTableService.load(uuid, type);
        for (const key of Object.keys(AM.loreRolls)) {
          if (key.startsWith(`${type}.`)) delete AM.loreRolls[key];
        }
        await AM.app?.render(false, { parts: ['biography'] });
      }
      // Side effects per type
      if (type === 'heritage')   await this.#onHeritageChanged(uuid, form);
      if (type === 'class')      await this.#onClassChanged(uuid, form);
      if (type === 'background') await this.#onBackgroundChanged(uuid, form);
    } else {
      AM.itemGrants[type] = null;
      // Changing heritage invalidates a mixed gift chosen against the old one
      if (type === 'heritage') {
        AM.mixedHeritage = { enabled: false, sourceUuid: '', sourceName: '', giftUuid: '', options: [] };
      }
      const panel = form.querySelector(`#${type}-description`);
      if (panel) panel.innerHTML = '';
      if (type === 'heritage')   this.#clearHeritageGifts(form);
    }

    this.updateTabIndicators(form);
    this.updateReviewTab(form);

    // Re-render the card-browser tab to switch to detail view after selection
    if (uuid) await AM.app?.render(false, { parts: [type] });
  }

  static async #loadDescription(type, uuid, form) {
    const panel = form.querySelector(`#${type}-description`);
    if (!panel) return;
    // Skip loading spinner if the panel already has content (e.g. pre-rendered by detail view template)
    if (!panel.innerHTML.trim()) {
      panel.innerHTML = `<p class="am-loading"><i class="fas fa-spinner fa-spin"></i> ${game.i18n.localize('am.app.loading')}</p>`;
    }
    const html = await DocumentService.getEnrichedDescription(uuid);
    const content = html || `<p>${game.i18n.localize('am.app.no-description')}</p>`;
    panel.innerHTML = content;
    // Cache for the detail-view template so re-renders avoid the loading flash
    if (AM.SELECTED[type]) AM.SELECTED[type].descriptionHtml = content;
  }

  /* ── Heritage Gift ──────────────────────────────────── */

  static async #onHeritageChanged(uuid, form) {
    // Gifts are the heritage's feature grants. If loadItemGrants took those on —
    // it runs just before this — then asking again here is the same choice twice.
    if (AM.itemGrants?.heritage?.absorb) {
      AM.heritageGifts = [];
      AM.SELECTED.heritageGift = { name: '', uuid: '' };
      await AM.app?.render(false, { parts: ['tabs', 'heritageGift'] });
      return;
    }

    // Show loading state on gift tab
    const giftPanel = form.querySelector('[data-tab="heritageGift"]');
    if (giftPanel) {
      const container = giftPanel.querySelector('.am-gift-list');
      if (container) container.innerHTML = `<p class="am-loading"><i class="fas fa-spinner fa-spin"></i> ${game.i18n.localize('am.app.loading')}</p>`;
    }

    const gifts = await EquipmentService.loadHeritageGifts(uuid);
    AM.heritageGifts = gifts;

    // Re-render only the heritageGift part, then re-attach radio listeners
    if (AM.app) {
      await AM.app.render(false, { parts: ['heritageGift'] });
      // Re-attach radio listeners to newly rendered DOM
      const newForm = AM.app.element;
      newForm?.querySelectorAll('.am-gift-option').forEach(radio => {
        const fn = (e) => this.#onGiftSelected(e.target, newForm);
        radio.addEventListener('change', fn);
        this.#listeners.push({ el: radio, type: 'change', fn });
      });
    }
  }

  static #clearHeritageGifts(form) {
    AM.heritageGifts = [];
    AM.SELECTED.heritageGift = null;
    AM.app?.render(false, { parts: ['tabs', 'heritageGift'] });
  }

  static #onGiftSelected(radio, form) {
    AM.SELECTED.heritageGift = {
      uuid: radio.dataset.uuid || null,
      name: radio.dataset.name || radio.value,
      idx:  radio.value
    };
    // Sync the selected UUID into the hidden form input so formData picks it up
    const hiddenInput = form.querySelector('#heritage-gift-uuid');
    if (hiddenInput) hiddenInput.value = radio.dataset.uuid || '';
    this.updateReviewTab(form);
  }

  /* ── Equipment ──────────────────────────────────────── */

  static async #onClassChanged(uuid, form) {
    if (!AM.equipmentData) AM.equipmentData = {};
    AM.equipmentData.class         = await EquipmentService.loadStartingEquipment(uuid, 'class');
    AM.equipmentData.wealthFormula = await EquipmentService.getStartingWealthFormula(uuid);
    await SpellService.loadClassSpellInfo(uuid);

    // Extract hit die from class item (needed for HP picker in class tab detail view)
    try {
      const classItem = await fromUuid(uuid);
      if (classItem && AM.SELECTED.class) {
        /* a5e keeps the hit die at system.hp.hitDiceSize, as a NUMBER. There is
         * no system.hitDice field at all — ClassItemA5e.hitDice is a computed
         * property on the document, not system data — so both paths this used
         * to read returned undefined and every class got ''. That emptied the
         * HP picker, and the archetype picker with it, because the template had
         * nested one inside the other. Old names kept as fallbacks in case a
         * homebrew class carries them. */
        const size = classItem.system?.hp?.hitDiceSize
          ?? classItem.system?.hitDice
          ?? classItem.system?.hitDie
          ?? '';
        AM.SELECTED.class.hitDie = typeof size === 'number' && size > 0
          ? `d${size}`
          : String(size || '');
      }

      // Some classes pick their archetype at 1st level — the cleric's Divine
      // Domain is the one everybody notices. The level-up dialog has asked for
      // this for a long time; the builder never did, so a cleric made here
      // started play with no domain and nothing saying one was owed.
      //
      // `archetypeLevel` is the class item's own field, so this asks the class
      // rather than keeping a list of which ones do it at 1st.
      AM.archetypes = { level: 0, options: [], uuid: null };
      const archLevel = LevelUpService.archetypeLevelOf(classItem);
      if (archLevel === 1) {
        AM.archetypes.level   = 1;
        AM.archetypes.options = await LevelUpService.getArchetypesForClass(classItem);
        AM.log(3, `${classItem.name}: ${AM.archetypes.options.length} archetype(s) at 1st level`);
      }
    } catch (err) {
      AM.log(2, 'Could not read the class for its archetype level:', err);
    }

    // Reset selections and inline browser state when class changes
    AM.creationManeuvers = null;
    AM.creationSpells    = null;
    AM.allManeuversData  = null;
    AM.allSpellsData     = null;
    AM.maneuverFilter    = { tradition: null };
    AM.spellFilter       = { level: null, school: null };
    AM.hpChoice          = { method: 'max', value: 0 };

    // Background-load compendium data; re-render tabs when each finishes
    ManeuverService.loadAllManeuvers().then(data => {
      AM.allManeuversData = data;
      AM.app?.render(false, { parts: ['maneuvers'] });
    });
    const spellInfo = SpellService.getClassSpellInfo(AM.SELECTED.class?.name ?? '');
    SpellService.loadSpells(AM.SELECTED.class?.name ?? '', spellInfo?.maxLevel ?? 1).then(data => {
      AM.allSpellsData = data;
      AM.app?.render(false, { parts: ['spells'] });
    });

    if (AM.app) {
      await AM.app.render(false, { parts: ['equipment', 'maneuvers', 'spells'] });
      const newForm = AM.app.element;
      newForm?.querySelectorAll('.am-equipment-option-btn').forEach(btn => {
        const fn = () => this.#onEquipmentChoice(btn, newForm);
        btn.addEventListener('click', fn);
        this.#listeners.push({ el: btn, type: 'click', fn });
      });
    }
  }

  static async #onBackgroundChanged(uuid, form) {
    if (!AM.equipmentData) AM.equipmentData = {};
    AM.equipmentData.background = await EquipmentService.loadStartingEquipment(uuid, 'background');
    if (AM.app) {
        await AM.app.render(false, { parts: ['equipment'] });
        const newForm = AM.app.element;
        newForm?.querySelectorAll('.am-equipment-option-btn').forEach(btn => {
          const fn = () => this.#onEquipmentChoice(btn, newForm);
          btn.addEventListener('click', fn);
          this.#listeners.push({ el: btn, type: 'click', fn });
        });
      }
  }

  /**
   * Work out whether the builder can ask for this item's grants itself. When it
   * can, the item is later created with `noGrant: true` and a5e's window never
   * opens for it — that is how five sequential pop-ups become none.
   *
   * The class carries three things that are not grants at all — level hit points,
   * the spellcasting ability and the spell book — so absorbing it also means
   * running GrantAbsorber.applyClassTail afterwards. Archetypes are chosen at a
   * later level, so creation never has to deal with them.
   */
  /**
   * Read the spells an origin hands out in prose, and the features it grants.
   *
   * The Orc heritage says "you know one cantrip of your choice"; the Dragonbound
   * and High Elf cultures say the same; Stoic Orc gives two 1st-level ritual
   * spells. None of it is a grant — a5e has no grant type for spells — so the
   * builder has to read the text or the character never gets them.
   */
  /**
   * The gift options of a heritage other than the one chosen.
   *
   * a5e: "With your Narrator's approval, you can choose a heritage gift from a
   * heritage other than the one you originally chose" — only the gift. Traits,
   * size and speed stay with the heritage itself, so nothing else is touched.
   */
  static async loadMixedHeritageGifts() {
    const mix = AM.mixedHeritage;
    mix.options = [];
    if (!mix.enabled || !mix.sourceUuid) return;

    try {
      const doc = await fromUuid(mix.sourceUuid);
      if (!doc) return;
      mix.sourceName = doc.name;

      // Creation is 1st level, which is what separates Gifts from Paragon Gifts
      const lv = { charLevel: 1, clsLevel: 1 };
      const features = await GrantAbsorber.describeFeatures(doc, lv);
      const gift = features.find(f => GrantAbsorber.isGiftGrant(f));
      mix.options = gift?.options ?? [];

      // A gift from the old source is not on the new one's list
      if (!mix.options.some(o => o.key === mix.giftUuid)) mix.giftUuid = '';
      AM.log(3, `Mixed heritage: ${mix.options.length} gift(s) offered from ${doc.name}`);
    } catch (err) {
      AM.log(2, 'Could not read the other heritage\'s gifts:', err);
    }
  }

  static async loadOriginSpells(type, uuid) {
    AM.originSpells[type] = null;
    try {
      const doc = await fromUuid(uuid);
      if (!doc) return;

      const texts = [DocumentService.rawDescription?.(doc) ?? doc.system?.description ?? ''];

      // The granted features carry the sentence as often as the origin itself.
      // Base features always; an option only once it is chosen — reading them
      // all offered a cantrip from a gift the character had not taken, which is
      // the same mistake the grant tree was making.
      const choices = AM.itemGrants?.[type]?.choices ?? {};
      for (const [id, grant] of (doc.grants?.entries?.() ?? [])) {
        if (grant?.grantType !== 'feature') continue;
        const picked = choices[id] ?? [];
        const uuids = [
          ...(grant.features?.base ?? []).map(f => f.uuid ?? f),
          ...(grant.features?.options ?? []).map(f => f.uuid ?? f).filter(u => picked.includes(u))
        ];
        for (const u of uuids) {
          try {
            const child = await fromUuid(u);
            if (child) texts.push(child.system?.description ?? '');
          } catch { /* unreadable — skip */ }
        }
      }

      const allowances = [];
      for (const t of texts) allowances.push(...SpellService.spellsFromProse(t));
      if (!allowances.length) return;

      // Same level twice means one larger allowance, not two entries
      const merged = new Map();
      for (const a of allowances) merged.set(a.level, (merged.get(a.level) ?? 0) + a.count);

      AM.originSpells[type] = {
        name: doc.name,
        rows: [...merged.entries()].map(([level, count]) => ({ level, count }))
      };
      AM.log(3, `${doc.name}: ${merged.size} spell allowance(s) read from its text`);
    } catch (err) {
      AM.log(2, `Could not read the spells ${type} gives in its text:`, err);
    }
  }

  /**
   * Rebuild an origin's grant tree against the choices made so far.
   *
   * The tree depends on those choices: a gift's own contents only belong in it
   * once the gift is taken. Picking one therefore changes what there is to show,
   * so the tree is described again rather than filtered — the sub-grants of the
   * newly chosen option have to be read from its document, and they were never
   * fetched while it was unchosen.
   */
  static async refreshItemGrants(type) {
    const store = AM.itemGrants?.[type];
    if (!store?.absorb || !store.uuid) return;
    try {
      const doc = await fromUuid(store.uuid);
      if (!doc) return;
      const lv = { charLevel: 1, clsLevel: 1 };
      const tree = await GrantAbsorber.describeTree(doc, lv, { choices: store.choices ?? {} });
      store.grants   = tree.grants;
      store.features = tree.features;

      // A choice that no longer has a row — its parent option was deselected —
      // must not stay in the answers, or it would be applied for a gift the
      // character does not have.
      const live = new Set([...tree.grants, ...tree.features].map(g => g.id));
      for (const id of Object.keys(store.choices ?? {})) {
        if (!live.has(id)) delete store.choices[id];
      }

      // A gift can be the thing that grants a cantrip, so the allowance read
      // from the text has to be taken again against the new picks.
      await this.loadOriginSpells(type, store.uuid);
    } catch (err) {
      AM.log(2, `Could not rebuild ${type} grants:`, err);
    }
  }

  static async loadItemGrants(type, uuid) {
    AM.itemGrants[type] = null;
    if (!AM.deferToSystemGrants) return;   // GM chose to keep our old pickers
    try {
      const doc = await fromUuid(uuid);
      if (!doc) return;
      // Creation is always 1st level, for both the character and the class
      const lv = { charLevel: 1, clsLevel: 1 };
      if (!await GrantAbsorber.canAbsorb(doc, lv)) {
        AM.log(3, `${type} ${doc.name}: grants left to a5e (unsupported grant present)`);
        return;
      }
      // The whole tree, not just the top level: a5e nests the choices that matter
      // inside the features an item grants, and asking only the top level meant
      // every one of those silently took its base set.
      const tree = await GrantAbsorber.describeTree(doc, lv);
      const store = {
        absorb:   true,
        uuid,                      // kept so the tree can be rebuilt on a change
        grants:   tree.grants,
        features: tree.features,
        choices:  {}
      };
      if (type === 'class') {
        // Offer the ability only when the class actually leaves it open
        const opts = doc.system?.spellcasting?.ability?.options ?? [];
        store.spellcastingOptions = [...opts];
        store.spellcastingAbility = opts[0] ?? doc.system?.spellcasting?.ability?.base ?? '';
      }
      AM.itemGrants[type] = store;
    } catch (err) {
      AM.log(2, `Could not read ${type} grants:`, err);
    }
  }

  static #onEquipmentChoice(btn, _form) {
    const group = btn.closest('.am-equipment-choice-group');
    if (!group) return;
    group.querySelectorAll('.am-equipment-option').forEach(el => el.classList.remove('am-selected'));
    btn.closest('.am-equipment-option')?.classList.add('am-selected');
    const hidden = group.querySelector('input[type="hidden"]');
    if (hidden) hidden.value = btn.dataset.idx ?? '0';
  }

  static #updateWealthDisplay(form) {
    const input  = form.querySelector('#starting-wealth-amount');
    const result = form.querySelector('#wealth-roll-result');
    if (result && input) result.textContent = input.value ? `${input.value} gp` : '';
  }

  /* ── Review tab ─────────────────────────────────────── */

  static updateReviewTab(form) {
    if (!form) return;
    const panel = form.querySelector('#finalize-panel');
    if (!panel) return;

    for (const type of [...ITEM_TYPES, 'heritageGift']) {
      const el = panel.querySelector(`.review-${type}`);
      if (!el) continue;
      if (type === 'heritageGift') {
        // Hidden outright when the Heritage tab covers it — an empty row here
        // would read as something the player forgot to pick
        const row = el.closest('.review-item');
        if (row) row.hidden = !!AM.itemGrants?.heritage?.absorb;
        el.textContent = AM.SELECTED.heritageGift?.name || '—';
      } else {
        el.textContent = this.#getSelectedName(type, form) || '—';
      }
    }

    this.updateAbilitiesSummary(form);
    this.#updateNameDisplay(form);
    this.#updatePortraitSrc(form);
    this.#updateBioPreview(form);
    this.#updateDestinyNarrativePreview(form);
    this.#updateHpReview(panel);
  }

  static #updateHpReview(panel) {
    if (!panel) return;
    const row = panel.querySelector('.review-hp-row');
    const el  = panel.querySelector('.review-hp');
    if (!row || !el) return;

    const hitDie = AM.SELECTED.class?.hitDie ?? '';
    const hitNum = parseInt(hitDie.replace('d', '')) || 0;
    if (!hitNum || !AM.SELECTED.class?.uuid) { row.style.display = 'none'; return; }

    const method = AM.hpChoice?.method ?? 'max';
    let label, value;
    if (method === 'max') {
      label = game.i18n.localize('am.app.class.hp-max');
      value = hitNum;
    } else if (method === 'avg') {
      label = game.i18n.localize('am.app.class.hp-avg');
      value = Math.floor(hitNum / 2) + 1;
    } else {
      label = game.i18n.localize('am.app.class.hp-roll');
      value = AM.hpChoice?.value || '?';
    }
    el.textContent = `${label} — ${value} + CON mod`;
    row.style.display = '';
  }

  static updateAbilitiesSummary(form) {
    if (!form) return;
    const grid = form.querySelector('.abilities-grid');
    if (!grid) return;
    const scores = {};
    form.querySelectorAll('[name^="abilities["]').forEach(el => {
      const m = el.name.match(/abilities\[(\w+)\]/);
      if (m) scores[m[1]] = el.value || AM.ABILITY_SCORES.DEFAULT;
    });
    const labels = { str:'STR', dex:'DEX', con:'CON', int:'INT', wis:'WIS', cha:'CHA' };
    grid.innerHTML = Object.entries(labels).map(([key, abbr]) =>
      `<div class="ability-review-item"><span class="abbr">${abbr}</span><span class="score">${scores[key] ?? AM.ABILITY_SCORES.DEFAULT}</span></div>`
    ).join('');
  }

  static updateTabIndicators(form) {
    if (!form) return;
    const app = form.closest('.application');
    if (!app) return;

    const checks = {
      start:       () => !!(form.querySelector('#character-name')?.value?.trim()),
      heritage:    () => !!(AM.SELECTED.heritage?.uuid),
      heritageGift:() => !!(AM.SELECTED.heritageGift?.name) || (AM.heritageGifts || []).length === 0,
      culture:     () => !!(AM.SELECTED.culture?.uuid),
      background:  () => !!(AM.SELECTED.background?.uuid),
      destiny:     () => !!(AM.SELECTED.destiny?.uuid),
      class:       () => !!(AM.SELECTED.class?.uuid),
      abilities:   () => {
        const inputs = form.querySelectorAll('[name^="abilities["]');
        return inputs.length > 0 && [...inputs].every(el => el.value && el.value !== '');
      },
      maneuvers:   () => {
        const className = AM.SELECTED.class?.name ?? '';
        const info = className ? ManeuverService.getClassManeuverInfo(className, 1) : null;
        if (!info) return true; // no maneuvers for this class
        return (AM.creationManeuvers?.uuids?.length ?? 0) >= info.maneuversKnown;
      },
      spells:      () => {
        const className = AM.SELECTED.class?.name ?? '';
        const info = className ? SpellService.getClassSpellInfo(className) : null;
        if (!info) return true; // no spells for this class
        const cantripsDone = (AM.creationSpells?.cantrips?.length ?? 0) >= (info.cantrips ?? 0);
        const spellsDone   = info.type !== 'known' || (AM.creationSpells?.spells?.length ?? 0) >= (info.spellsKnown ?? 0);
        return cantripsDone && spellsDone;
      },
      equipment:   () => true, // optional
      biography:   () => true, // optional
      finalize:    () => true
    };

    for (const [tabId, checkFn] of Object.entries(checks)) {
      const navLink = app.querySelector(`[data-tab="${tabId}"]`);
      if (!navLink) continue;
      try {
        const complete = checkFn();
        navLink.classList.toggle('am-tab-complete',   complete);
        navLink.classList.toggle('am-tab-incomplete', !complete);
      } catch {}
    }
  }

  /* ── Misc ───────────────────────────────────────────── */

  static updateProgressBar(form) {
    if (!form) return;
    const required = form.querySelectorAll('[aria-required="true"]');
    if (!required.length) return;
    let filled = 0;
    required.forEach(el => {
      if (el.tagName === 'SELECT' ? !!el.value : !!el.value?.trim()) filled++;
    });
    const pct = Math.round((filled / required.length) * 100);
    const header = form.closest('.application')?.querySelector('.am-app-header');
    if (header) header.style.setProperty('--progress-percent', `${pct}%`);
    const text = form.closest('.application')?.querySelector('.wizard-progress-text');
    if (text) text.textContent = `${pct}% ${game.i18n.localize('am.app.creation-progress')}`;
  }

  static #updatePortraitSrc(form) {
    const artInput = form?.querySelector('#character-art-path');
    const img      = form?.querySelector('.character-portrait img');
    if (artInput?.value && img) img.src = artInput.value;
  }

  static #updateNameDisplay(form) {
    const name = form?.querySelector('#character-name')?.value?.trim() || '—';
    form?.querySelectorAll('.character-name-display').forEach(el => { el.textContent = name; });
  }

  static #syncTokenArtRow(form) {
    const chk = form.querySelector('#link-token-art');
    const row = form.querySelector('#token-art-row');
    if (row) row.style.display = chk?.checked ? 'none' : '';
  }

  static #updateDestinyNarrativePreview(form) {
    const panel = form.querySelector('#finalize-panel');
    if (!panel) return;

    const fields = [
      ['#destinyMotivation',  '.review-destinyMotivation'],
      ['#destinyGoals',       '.review-destinyGoals'],
      ['#destinyConnection',  '.review-destinyConnection'],
      ['#destinyFulfillment', '.review-destinyFulfillment'],
      ['#destinyInspiration', '.review-destinyInspiration'],
    ];
    for (const [inputSel, reviewSel] of fields) {
      const val = form.querySelector(inputSel)?.value?.trim() || '—';
      const el  = panel.querySelector(reviewSel);
      if (el) el.textContent = val;
    }
  }

  static #updateBioPreview(form) {
    const preview = form.querySelector('.bio-preview');
    if (!preview) return;

    const traits = form.querySelector('#traits')?.value?.trim();
    const motivation = form.querySelector('#destinyMotivation')?.value?.trim();
    const goals      = form.querySelector('#destinyGoals')?.value?.trim();

    const parts = [];
    if (traits)     parts.push(`<div class="bio-review-row"><span class="bio-review-label">${game.i18n.localize('am.app.biography.traits')}:</span> ${traits.slice(0, 150)}</div>`);
    if (motivation) parts.push(`<div class="bio-review-row"><span class="bio-review-label">${game.i18n.localize('am.app.biography.destiny-motivation')}:</span> ${motivation.slice(0, 150)}</div>`);
    if (goals)      parts.push(`<div class="bio-review-row"><span class="bio-review-label">${game.i18n.localize('am.app.biography.destiny-goals')}:</span> ${goals.slice(0, 150)}</div>`);

    preview.innerHTML = parts.length ? parts.join('') : '<span class="am-hint">—</span>';
  }

  static #extractUuid(raw) {
    if (!raw) return null;
    const m = raw.match(/\[([^\]]+)\]/);
    return m ? m[1] : null;
  }

  static #getSelectedName(type, form) {
    // Prefer the selected card's data-name (always present and trimmed)
    const selectedCard = form.querySelector(`.am-card-grid[data-type="${type}"] .am-card.am-card-selected`);
    if (selectedCard?.dataset.name) return selectedCard.dataset.name;
    // Fall back to the hidden select's selected option text
    const dd  = form.querySelector(`#${type}-dropdown`);
    const opt = dd?.options[dd?.selectedIndex];
    return opt?.textContent?.trim() || '';
  }
}
