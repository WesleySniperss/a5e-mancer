import { AM } from '../a5e-mancer.js';
import {
  ActorCreationService, CharacterArtPicker, DOMManager,
  EquipmentService, FormValidation, SavedOptions, StatRoller,
  ManeuverService, CLASS_MANEUVER_TABLES, getTraditions
} from '../utils/index.js';
import { SpellService, CLASS_SPELL_TABLES } from '../utils/spellService.js';

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export const TAB_ORDER = [
  'start', 'heritage', 'heritageGift', 'culture',
  'background', 'destiny', 'class', 'abilities',
  'maneuvers', 'spells', 'equipment', 'biography', 'finalize'
];

export class A5eMancer extends HandlebarsApplicationMixin(ApplicationV2) {

  static DEFAULT_OPTIONS = {
    id: 'a5e-mancer-app',
    tag: 'form',
    form: { handler: A5eMancer.formHandler, closeOnSubmit: true, submitOnChange: false },
    actions: {
      adjustScore:            StatRoller.adjustScore.bind(StatRoller),
      rollStat:               A5eMancer.rollStat,
      rollWealth:             A5eMancer.rollWealth,
      selectCharacterArt:     CharacterArtPicker.selectCharacterArt,
      selectTokenArt:         CharacterArtPicker.selectTokenArt,
      selectPlayerAvatar:     CharacterArtPicker.selectPlayerAvatar,
      resetOptions:           A5eMancer.resetOptions,
      nosubmit:               A5eMancer.noSubmit,
      previousTab:            A5eMancer.navigatePrev,
      nextTab:                A5eMancer.navigateNext,
      randomize:              A5eMancer.randomizeAll,
      randomizeCharacterName: A5eMancer.randomizeName,
      randomizeTabContent:    A5eMancer.randomizeTabContent,
      cardSelect:             A5eMancer.cardSelect,
      clearCardSelection:     A5eMancer.clearCardSelection,
      rollDestinyTable:       A5eMancer.rollDestinyTable,
      toggleEquipmentChoice:  A5eMancer.toggleEquipmentChoice,
      setHpMethod:             A5eMancer.setHpMethod,
      rollHpDie:               A5eMancer.rollHpDie,
      filterManeuverTradition: A5eMancer.filterManeuverTradition,
      toggleManeuver:          A5eMancer.toggleManeuver,
      filterSpellLevel:        A5eMancer.filterSpellLevel,
      filterSpellSchool:       A5eMancer.filterSpellSchool,
      toggleSpell:             A5eMancer.toggleSpell
    },
    classes: ['am-app'],
    position: { height: 700, width: 1100, top: 60 },
    window: {
      icon: 'fa-solid fa-hat-wizard',
      resizable: true,
      minimizable: true
    }
  };

  static PARTS = {
    header:      { template: 'modules/a5e-mancer/templates/app-header.hbs',      classes: ['am-app-header'] },
    tabs:        { template: 'modules/a5e-mancer/templates/app-nav.hbs',         classes: ['am-app-nav'] },
    start:       { template: 'modules/a5e-mancer/templates/tab-start.hbs',       classes: ['am-app-tab-content'] },
    heritage:    { template: 'modules/a5e-mancer/templates/tab-heritage.hbs',    classes: ['am-app-tab-content'] },
    heritageGift:{ template: 'modules/a5e-mancer/templates/tab-heritage-gift.hbs', classes: ['am-app-tab-content'] },
    culture:     { template: 'modules/a5e-mancer/templates/tab-culture.hbs',     classes: ['am-app-tab-content'] },
    background:  { template: 'modules/a5e-mancer/templates/tab-background.hbs', classes: ['am-app-tab-content'] },
    destiny:     { template: 'modules/a5e-mancer/templates/tab-destiny.hbs',     classes: ['am-app-tab-content'] },
    class:       { template: 'modules/a5e-mancer/templates/tab-class.hbs',       classes: ['am-app-tab-content'] },
    abilities:   { template: 'modules/a5e-mancer/templates/tab-abilities.hbs',   classes: ['am-app-tab-content'] },
    maneuvers:   { template: 'modules/a5e-mancer/templates/tab-maneuvers.hbs',   classes: ['am-app-tab-content'] },
    spells:      { template: 'modules/a5e-mancer/templates/tab-spells.hbs',      classes: ['am-app-tab-content'] },
    equipment:   { template: 'modules/a5e-mancer/templates/tab-equipment.hbs',   classes: ['am-app-tab-content'] },
    biography:   { template: 'modules/a5e-mancer/templates/tab-biography.hbs',   classes: ['am-app-tab-content'] },
    finalize:    { template: 'modules/a5e-mancer/templates/tab-finalize.hbs',    classes: ['am-app-tab-content'] },
    footer:      { template: 'modules/a5e-mancer/templates/app-footer.hbs',      classes: ['am-app-footer'] }
  };

  #isRendering = false;

  get title() { return `${AM.NAME} | ${game.user.name}`; }

  /* ── context ─────────────────────────────────────────── */

  _prepareContext(options) {
    try {
      return {
        heritageDocs:   AM.documents.heritage   || [],
        cultureDocs:    AM.documents.culture     || [],
        backgroundDocs: AM.documents.background  || [],
        destinyDocs:    AM.documents.destiny     || [],
        classDocs:      AM.documents.class       || [],
        tabs:    this._getTabs(options.parts),
        players: game.users.map(u => ({ id: u.id, name: u.name, color: u.color.css }))
      };
    } catch (err) {
      AM.log(1, 'Context error:', err);
      return { heritageDocs:[], cultureDocs:[], backgroundDocs:[], destinyDocs:[], classDocs:[], tabs:{}, players:[] };
    }
  }

  _preparePartContext(partId, context) {
    try {
      if (context.tabs?.[partId]) context.tab = context.tabs[partId];
      const currentIndex = TAB_ORDER.indexOf(this.tabGroups['a5e-mancer-tabs']);

      switch (partId) {
        case 'class': {
          context.selectedItem = A5eMancer.#buildSelectedItem('class');
          if (context.selectedItem) {
            const hitDie = AM.SELECTED.class?.hitDie ?? '';
            const hitNum = parseInt(hitDie.replace('d', '')) || 0;
            context.hitDie    = hitDie;
            context.hitDieNum = hitNum;
            context.hitDieAvg = hitNum > 0 ? Math.floor(hitNum / 2) + 1 : 0;
            context.hpChoice  = AM.hpChoice;
          }
          break;
        }

        case 'heritage':
        case 'culture':
        case 'background':
        case 'destiny':
          context.selectedItem = A5eMancer.#buildSelectedItem(partId);
          break;

        case 'start':
          context.playerCustomizationEnabled = game.settings.get(AM.ID, 'enablePlayerCustomization');
          context.tokenCustomizationEnabled  = game.settings.get(AM.ID, 'enableTokenCustomization');
          context.isGM = game.user.isGM;
          break;

        case 'heritageGift':
          // Gifts are loaded dynamically by DOMManager when heritage is selected
          context.heritageSelected = !!AM.SELECTED.heritage?.uuid;
          context.heritageGifts   = AM.heritageGifts || [];
          break;

        case 'maneuvers': {
          const className = A5eMancer.#getSelectedClassName();
          const classKey  = className?.toLowerCase() ?? '';
          context.classSelected         = !!AM.SELECTED.class?.uuid;
          context.maneuverInfo          = classKey ? ManeuverService.getClassManeuverInfo(className, 1) : null;
          context.isManeuverClass       = classKey ? !!CLASS_MANEUVER_TABLES[classKey] : false;
          context.selectedManeuverUuids = AM.creationManeuvers?.uuids ?? [];
          context.selectedTraditions    = AM.creationManeuvers?.traditions ?? [];
          context.selectedManeuverNames = AM.creationManeuvers?.names ?? [];
          context.maneuversLoaded       = !!AM.allManeuversData;
          if (context.maneuverInfo && AM.allManeuversData) {
            context.inlineTraditions = A5eMancer.#buildTraditionPills(
              AM.allManeuversData, context.selectedTraditions, AM.maneuverFilter.tradition
            );
            context.visibleManeuvers = A5eMancer.#filterManeuvers(
              AM.allManeuversData, context.maneuverInfo.maxDegree,
              AM.maneuverFilter.tradition, context.selectedManeuverUuids
            );
            context.maneuverFilterTradition = AM.maneuverFilter.tradition ?? '';
          }
          break;
        }

        case 'spells': {
          const className = A5eMancer.#getSelectedClassName();
          const classKey  = className?.toLowerCase() ?? '';
          context.classSelected        = !!AM.SELECTED.class?.uuid;
          context.spellInfo            = classKey ? SpellService.getClassSpellInfo(className) : null;
          context.isSpellcaster        = classKey ? (!!CLASS_SPELL_TABLES[classKey] || SpellService._dynamicIsSpellcaster) : false;
          context.selectedCantripUuids = AM.creationSpells?.cantrips ?? [];
          context.selectedSpellUuids   = AM.creationSpells?.spells ?? [];
          context.selectedCantripCount = (AM.creationSpells?.cantrips ?? []).length;
          context.selectedSpellCount   = (AM.creationSpells?.spells ?? []).length;
          context.selectedSpellNames   = AM.creationSpells?.names ?? [];
          context.spellsLoaded         = !!AM.allSpellsData;
          if (context.spellInfo && AM.allSpellsData) {
            const result = A5eMancer.#filterSpells(
              AM.allSpellsData, context.spellInfo, AM.spellFilter,
              AM.creationSpells?.cantrips ?? [], AM.creationSpells?.spells ?? []
            );
            context.visibleSpells        = result.spells;
            context.spellLevelPills      = result.levelPills;
            context.spellSchoolPills     = result.schoolPills;
            context.spellLevelAllActive  = result.levelAllActive;
            context.spellSchoolAllActive = result.schoolAllActive;
          }
          break;
        }

        case 'equipment':
          context.classEquipment      = AM.equipmentData?.class      || null;
          context.backgroundEquipment = AM.equipmentData?.background || null;
          context.wealthFormula       = AM.equipmentData?.wealthFormula || null;
          break;

        case 'abilities': {
          const method = StatRoller.getDiceRollingMethod();
          context.diceRollMethod  = method;
          // For point buy always start at MIN (8) so budget shows 27/27
          const pbScore = method === 'pointBuy' ? AM.ABILITY_SCORES.MIN : AM.ABILITY_SCORES.DEFAULT;
          context.abilities       = StatRoller.buildAbilitiesContext(pbScore);
          context.standardArray   = StatRoller.getStandardArrayValues();
          context.totalPoints     = StatRoller.getTotalPoints();
          context.pointsSpent     = StatRoller.calculateTotalPointsSpent(
            context.abilities.map(a => a.currentScore)
          );
          context.remainingPoints = context.totalPoints - context.pointsSpent;
          context.allowedMethods  = game.settings.get(AM.ID, 'allowedMethods');
          context.chainedRolls    = game.settings.get(AM.ID, 'chainedRolls');
          break;
        }

        case 'biography':
          context.alignments = (game.settings.get(AM.ID, 'alignments') || '')
            .split(',').map(s => s.trim()).filter(Boolean);
          context.enableAlignmentFaithInputs = game.settings.get(AM.ID, 'enableAlignmentFaithInputs');
          context.selectedDestiny = AM.SELECTED.destiny ?? null;
          break;

        case 'footer':
          context.navigationButtons = game.settings.get(AM.ID, 'enableNavigationButtons');
          context.randomizeButton   = game.settings.get(AM.ID, 'enableRandomize');
          context.isFirstTab        = currentIndex === 0;
          context.isLastTab         = currentIndex === TAB_ORDER.length - 1;
          context.previousTabName   = currentIndex > 0
            ? game.i18n.localize(`am.app.tab-names.${TAB_ORDER[currentIndex - 1]}`) : '';
          context.nextTabName       = currentIndex < TAB_ORDER.length - 1
            ? game.i18n.localize(`am.app.tab-names.${TAB_ORDER[currentIndex + 1]}`) : '';
          context.canCreateActor = game.user.can('ACTOR_CREATE') || game.user.isGM;
          break;
      }
    } catch (err) {
      AM.log(1, `Part context error for ${partId}:`, err);
    }
    return context;
  }

  _getTabs(parts) {
    const group = 'a5e-mancer-tabs';
    if (!this.tabGroups[group]) this.tabGroups[group] = 'start';

    const icons = {
      start:       'fa-solid fa-door-open',
      heritage:    'fa-solid fa-dna',
      heritageGift:'fa-solid fa-gem',
      culture:     'fa-solid fa-city',
      background:  'fa-solid fa-scroll',
      destiny:     'fa-solid fa-compass',
      class:       'fa-solid fa-chess-rook',
      abilities:   'fa-solid fa-hand-fist',
      maneuvers:   'fa-solid fa-swords',
      spells:      'fa-solid fa-wand-magic-sparkles',
      equipment:   'fa-solid fa-shield-halved',
      biography:   'fa-solid fa-book-open',
      finalize:    'fa-solid fa-circle-check'
    };
    const nonTabs = ['header', 'tabs', 'footer'];

    return parts.reduce((acc, id) => {
      if (nonTabs.includes(id) || !icons[id]) return acc;
      acc[id] = {
        id, group,
        label:    game.i18n.localize(`am.app.tab-names.${id}`),
        cssClass: this.tabGroups[group] === id ? 'active' : '',
        icon:     icons[id]
      };
      return acc;
    }, {});
  }

  /* ── render lifecycle ─────────────────────────────────── */

  async _onFirstRender(_ctx, _opts) {
    await SavedOptions.restoreFormOptions(this.element);
    DOMManager.updateTabIndicators(this.element);
  }

  async _onRender(_ctx, opts) {
    if (this.#isRendering) return;
    try {
      this.#isRendering = true;
      if (opts.parts?.length === 1 && opts.parts[0] === 'footer') return;
      await DOMManager.initialize(this.element);
      await FormValidation.checkMandatoryFields(this.element);
      DOMManager.updateTabIndicators(this.element);
      DOMManager.updateReviewTab(this.element);
      DOMManager.updateProgressBar(this.element);
    } finally {
      this.#isRendering = false;
    }
  }

  _onChangeForm(config, event) {
    super._onChangeForm(config, event);
    if (event.currentTarget) DOMManager.updateProgressBar(this.element);
  }

  async _preClose() {
    await super._preClose();
    DOMManager.cleanup();
    return true;
  }

  changeTab(name, group, opts = {}) {
    super.changeTab(name, group, opts);
    this.render(false, { parts: ['footer'] });
    DOMManager.updateTabIndicators(this.element);
    if (name === 'finalize') DOMManager.updateReviewTab(this.element);
  }

  /* ── static actions ───────────────────────────────────── */

  static async rollStat(_event, form) {
    const formula = game.settings.get(AM.ID, 'customRollFormula') || '4d6kh3';
    const idx   = form.dataset.index;
    const score = await StatRoller.rollSingleScore(formula);
    const input = document.getElementById(`ability-${idx}-score`);
    if (input) { input.value = score; input.dispatchEvent(new Event('change', { bubbles: true })); }
  }

  static async rollWealth(event) {
    event.preventDefault();
    const formula = AM.equipmentData?.wealthFormula;
    if (!formula) return;
    try {
      const { EquipmentService } = await import('../utils/equipmentService.js');
      const gold = await EquipmentService.rollWealth(formula);
      const input = document.getElementById('starting-wealth-amount');
      if (input) { input.value = gold; input.dispatchEvent(new Event('change', { bubbles: true })); }
      const display = document.getElementById('wealth-roll-result');
      if (display) display.textContent = `${gold} gp`;
    } catch (err) {
      AM.log(1, 'Wealth roll error:', err);
    }
  }

  static toggleEquipmentChoice(event, btn) {
    const group = btn.closest('.am-equipment-choice-group');
    if (!group) return;
    group.querySelectorAll('.am-equipment-option').forEach(el => el.classList.remove('selected'));
    btn.closest('.am-equipment-option')?.classList.add('selected');
    const hiddenInput = group.querySelector('input[type="hidden"]');
    if (hiddenInput) { hiddenInput.value = btn.dataset.optionIndex ?? '0'; }
  }

  static randomizeName(event) {
    event.preventDefault();
    const syllables = ['Al','Bran','Cas','Dra','El','Fae','Gil','Hed','Im','Jal',
                       'Kae','Lor','Mar','Niv','Om','Pael','Qin','Ryn','Ser','Thal',
                       'Um','Val','Wyr','Xan','Yav','Zel'];
    const pick = () => syllables[Math.floor(Math.random() * syllables.length)];
    const name = `${pick()}${pick().toLowerCase()}${pick().toLowerCase()}`;
    const input = document.getElementById('character-name');
    if (input) { input.value = name; input.dispatchEvent(new Event('input', { bubbles: true })); }
  }

  static cardSelect(_event, btn) {
    const type  = btn.dataset.type;
    const value = btn.dataset.value;
    const form  = AM.app?.element;
    if (!form || !type || !value) return;

    // Immediately update card visual state for snappy feedback
    const grid = btn.closest('.am-card-grid');
    if (grid) {
      grid.querySelectorAll('.am-card').forEach(c => c.classList.remove('am-card-selected'));
      btn.classList.add('am-card-selected');
    }

    // Sync the hidden select — this triggers DOMManager's full change pipeline
    // (description load, side-effects for heritage/class/background, tab indicators, review tab)
    const select = form.querySelector(`#${type}-dropdown`);
    if (select) {
      select.value = value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      // DOMManager#onDropdownChange runs synchronously up to its first await and overwrites
      // AM.SELECTED[type] — we add name + img back after the dispatch returns.
      const sel = AM.SELECTED[type];
      if (sel) {
        sel.name = btn.dataset.name ?? '';
        sel.img  = btn.querySelector('img')?.src ?? '';
        delete sel.browsing;
      }
    }
  }

  static clearCardSelection(_event, btn) {
    const type = btn.dataset.type;
    const sel = AM.SELECTED[type];
    if (sel) sel.browsing = true;
    AM.app?.render(false, { parts: [type] });
  }

  static #buildSelectedItem(type) {
    const sel = AM.SELECTED[type];
    if (!sel?.uuid || sel.browsing) return null;
    return { name: sel.name ?? '', img: sel.img ?? '', descriptionHtml: sel.descriptionHtml ?? '' };
  }

  static async randomizeTabContent(_event, btn) {
    const forTab = btn.dataset.for;
    const app = AM.app;
    if (!app || !forTab) return;
    const form = app.element;
    if (!form) return;

    if (forTab === 'abilities') {
      await A5eMancer.#randomizeAbilities(form);
    } else if (forTab === 'heritageGift') {
      const radios = form.querySelectorAll('.am-gift-option');
      if (radios.length > 0) {
        const pick = radios[Math.floor(Math.random() * radios.length)];
        pick.checked = true;
        pick.dispatchEvent(new Event('change', { bubbles: true }));
      }
    } else {
      // Dropdown tabs: heritage, culture, background, destiny, class
      const dd = form.querySelector(`#${forTab}-dropdown`);
      if (dd && dd.options.length > 1) {
        const idx = 1 + Math.floor(Math.random() * (dd.options.length - 1));
        dd.selectedIndex = idx;
        dd.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
  }

  static async rollDestinyTable(_event, btn) {
    const fieldName = btn.dataset.field;
    const die       = parseInt(btn.dataset.die) || 4;
    const source    = btn.dataset.source ?? 'destiny'; // 'destiny' or 'background'
    const result    = 1 + Math.floor(Math.random() * die);
    const form      = AM.app?.element;
    if (!form) return;
    const field = form.querySelector(`[name="${fieldName}"]`);
    if (!field) return;

    // Look up table from the relevant compendium item (destiny or background)
    const itemUuid = source === 'background'
      ? AM.SELECTED.background?.uuid
      : AM.SELECTED.destiny?.uuid;

    const doc = itemUuid
      ? await fromUuid(itemUuid).catch(() => null)
      : null;

    const tableText = doc
      ? A5eMancer.#extractTableEntry(doc.system?.description?.value ?? '', fieldName, result)
      : null;

    if (tableText) {
      field.value = tableText;
    } else {
      field.value = `${result} (1d${die})`;
    }
    field.dispatchEvent(new Event('input', { bubbles: true }));
  }

  /**
   * Extracts the Nth entry from a roll table in an HTML description.
   *
   * A5e destiny items have two roll tables: a d4 "Source of Motivation" and a
   * d6 "Goals" table. Rather than relying on heading keywords (which vary across
   * items), we identify tables by their entry count:
   *   – destinyMotivation: prefer the table/list closest to 4 entries
   *   – destinyGoals:      prefer the table/list closest to 6 entries
   *   – backstory:         use the first table/list found (d6, from background)
   *
   * Both <table> (numeric first column OR positional) and <ol>/<ul> are supported.
   */
  static #extractTableEntry(html, fieldName, n) {
    if (!html) return null;
    const div = document.createElement('div');
    div.innerHTML = html;

    // Gather all tables and lists with at least 2 entries, in DOM order
    const rollTables = [...div.querySelectorAll('table, ol, ul')].map(el => {
      if (el.tagName === 'TABLE') {
        const rows = [...el.querySelectorAll('tr')].filter(r => r.querySelector('td'));
        return rows.length >= 2 ? { el, count: rows.length, rows, type: 'table' } : null;
      }
      const items = [...el.querySelectorAll('li')];
      return items.length >= 2 ? { el, count: items.length, items, type: 'list' } : null;
    }).filter(Boolean);

    if (rollTables.length === 0) return null;

    // Pick the most appropriate table based on expected entry count
    const targetCount = fieldName === 'destinyGoals' ? 6
                      : fieldName === 'destinyMotivation' ? 4
                      : 6; // backstory uses d6

    // Sort candidates by how close their count is to targetCount; prefer exact match
    const sorted = [...rollTables].sort((a, b) =>
      Math.abs(a.count - targetCount) - Math.abs(b.count - targetCount)
    );

    // If two tables are equally close (e.g., both at 4 entries), prefer the one
    // that comes SECOND for goals (goals table follows motivation table in the HTML)
    let target = sorted[0];
    if (fieldName === 'destinyGoals' && rollTables.length >= 2) {
      const firstClose = rollTables.find(t => Math.abs(t.count - 4) <= 1);
      const secondClose = rollTables.filter(t => t !== firstClose)
                                    .find(t => Math.abs(t.count - 6) <= 2);
      if (secondClose) target = secondClose;
    }

    // Extract Nth entry from the chosen table
    if (target.type === 'table') {
      for (const row of target.rows) {
        const cells = row.querySelectorAll('td');
        // Numeric first column (1, 2, 3…)
        if (cells.length >= 2 && parseInt(cells[0].textContent.trim()) === n)
          return cells[1].textContent.trim();
      }
      // Fallback: positional (header row may exist, skip non-td rows already filtered)
      const row = target.rows[n - 1];
      if (row) {
        const cells = row.querySelectorAll('td');
        return cells[cells.length - 1]?.textContent.trim() ?? null;
      }
    } else {
      return target.items[n - 1]?.textContent.trim() ?? null;
    }

    return null;
  }

  static async randomizeAll(event) {
    event.preventDefault();
    const app = AM.app;
    if (!app) return;
    const form = app.element;
    if (!form) return;

    // 1. Randomize the character name
    A5eMancer.randomizeName(event);

    // 2. Randomly select each item dropdown; wait longer so async handlers
    //    (compendium fetches, partial re-renders) can finish before moving on
    const dropdownIds = ['heritage-dropdown', 'culture-dropdown', 'background-dropdown',
                         'destiny-dropdown', 'class-dropdown'];
    for (const id of dropdownIds) {
      const dd = form.querySelector(`#${id}`);
      if (!dd || dd.options.length <= 1) continue;
      const idx = 1 + Math.floor(Math.random() * (dd.options.length - 1));
      dd.selectedIndex = idx;
      dd.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise(r => setTimeout(r, 350));
    }

    // 3. Pick a random heritage gift (gifts are loaded after heritage selection)
    //    Give the heritageGift re-render extra time then grab fresh radio buttons
    await new Promise(r => setTimeout(r, 500));
    const giftRadios = app.element.querySelectorAll('.am-gift-option');
    if (giftRadios.length > 0) {
      const pick = giftRadios[Math.floor(Math.random() * giftRadios.length)];
      pick.checked = true;
      pick.dispatchEvent(new Event('change', { bubbles: true }));
    }

    // 4. Randomize ability scores based on the active method
    await A5eMancer.#randomizeAbilities(app.element);

    // 5. Roll the destiny/background narrative fields (motivation, goals, backstory)
    for (const rb of form.querySelectorAll('[data-action="rollDestinyTable"]')) {
      rb.click();
      await new Promise(r => setTimeout(r, 50));
    }

    // 6. Equipment: roll starting wealth + pick a random option in each choice group
    //    (the option buttons are wired by DOMManager click listeners, not data-action)
    form.querySelector('[data-action="rollWealth"]')?.click();
    for (const group of form.querySelectorAll('.am-equipment-choice-group')) {
      const opts = [...group.querySelectorAll('.am-equipment-option-btn')];
      if (opts.length) opts[Math.floor(Math.random() * opts.length)].click();
    }

    // 7. Random class maneuvers + spells (respecting quotas). Re-render ONLY those
    //    parts — a full render would wipe the name/ability/narrative/wealth values
    //    we just set directly in the DOM (they live in inputs, not the render context).
    await A5eMancer.#randomizeManeuvers();
    await A5eMancer.#randomizeSpells();
    await app.render(false, { parts: ['maneuvers', 'spells'] });
  }

  /** Fisher–Yates shuffle (in place); returns the array. */
  static #shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  /** Pick random valid maneuvers for the selected class (quota + allowed traditions + degree). */
  static async #randomizeManeuvers() {
    const className = A5eMancer.#getSelectedClassName();
    const info = className ? ManeuverService.getClassManeuverInfo(className, 1) : null;
    if (!info) return;

    if (!AM.allManeuversData) {
      try { AM.allManeuversData = await ManeuverService.loadAllManeuvers(); } catch { return; }
    }
    const data = AM.allManeuversData;
    if (!data) return;

    // Traditions with at least one maneuver at/under the class's max degree…
    let tradKeys = [...data.keys()].filter(key => {
      const tradMap = data.get(key);
      return tradMap && [...tradMap.entries()].some(([deg, arr]) => deg <= info.maxDegree && arr.length);
    });
    // …restricted to those the class may choose from.
    if (Array.isArray(info.allowedTraditions)) {
      tradKeys = tradKeys.filter(k => info.allowedTraditions.includes(k));
    }
    if (!tradKeys.length) return;

    const chosenTraditions = A5eMancer.#shuffle(tradKeys).slice(0, info.traditions);
    const pool = [];
    for (const t of chosenTraditions) {
      for (const [deg, arr] of data.get(t)) {
        if (deg <= info.maxDegree) pool.push(...arr.map(m => ({ uuid: m.uuid, name: m.name, tradition: t })));
      }
    }
    const picks = A5eMancer.#shuffle(pool).slice(0, info.maneuversKnown);
    AM.creationManeuvers = {
      uuids:      picks.map(p => p.uuid),
      traditions: [...new Set(picks.map(p => p.tradition))],
      names:      picks.map(p => p.name).sort()
    };
  }

  /** Pick random valid cantrips + spells for the selected class (respecting quotas). */
  static async #randomizeSpells() {
    const className = A5eMancer.#getSelectedClassName();
    const info = className ? SpellService.getClassSpellInfo(className) : null;
    if (!info) return;

    const maxLevel = info.maxLevel ?? 1;
    if (!AM.allSpellsData) {
      try { AM.allSpellsData = await SpellService.loadSpells(null, maxLevel); } catch { return; }
    }
    const data = AM.allSpellsData;
    if (!data) return;

    const cantrips = A5eMancer.#shuffle([...(data.get(0) ?? [])]).slice(0, info.cantrips ?? 0);

    const spellPool = [];
    for (let lvl = 1; lvl <= maxLevel; lvl++) spellPool.push(...(data.get(lvl) ?? []));
    A5eMancer.#shuffle(spellPool);
    // 'known' casters pick exactly spellsKnown; 'prepared' (spellsKnown = -1) get a sensible handful.
    const want = info.type === 'known' ? (info.spellsKnown ?? 0) : Math.min(spellPool.length, 4);
    const spells = spellPool.slice(0, Math.max(0, want));

    AM.creationSpells = {
      cantrips: cantrips.map(s => s.uuid),
      spells:   spells.map(s => s.uuid),
      names:    [...cantrips, ...spells].map(s => s.name).sort()
    };
  }

  static async #randomizeAbilities(form) {
    const method = form.querySelector('#roll-method')?.value
                   || StatRoller.getDiceRollingMethod();

    if (method === 'standardArray') {
      // Shuffle the standard array values and assign to each dropdown
      const values = [...StatRoller.getStandardArrayValues()];
      for (let i = values.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [values[i], values[j]] = [values[j], values[i]];
      }
      for (let i = 0; i < 6; i++) {
        const dd = form.querySelector(`#ability-${i}-dropdown`);
        if (!dd) continue;
        dd.value = String(values[i]);
        dd.dispatchEvent(new Event('change', { bubbles: true }));
      }

    } else if (method === 'manualFormula') {
      const formula = game.settings.get(AM.ID, 'customRollFormula') || '4d6kh3';
      const scores = await StatRoller.rollAllScores(formula);
      for (let i = 0; i < 6; i++) {
        const input = document.getElementById(`ability-${i}-score`);
        if (input) {
          input.value = scores[i];
          input.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }

    } else if (method === 'pointBuy') {
      const min    = AM.ABILITY_SCORES.MIN;
      const max    = AM.ABILITY_SCORES.MAX;
      const budget = StatRoller.getTotalPoints();
      const costs  = StatRoller.POINT_BUY_COSTS;
      const scores = Array(6).fill(min);
      let left = budget;
      // Randomly spend points until the budget is exhausted or no moves remain
      let attempts = 0;
      while (left > 0 && attempts < 10000) {
        attempts++;
        const i    = Math.floor(Math.random() * 6);
        const next = scores[i] + 1;
        if (next > max) continue;
        const extra = (costs[next] ?? 0) - (costs[scores[i]] ?? 0);
        if (extra <= left) { scores[i] = next; left -= extra; }
      }
      for (let i = 0; i < 6; i++) {
        const scoreEl = document.getElementById(`ability-score-${i}`);
        const inputEl = document.getElementById(`ability-${i}-input`);
        if (scoreEl) scoreEl.textContent = scores[i];
        if (inputEl) {
          inputEl.value = scores[i];
          inputEl.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
      // Update remaining-points display
      const spent     = StatRoller.calculateTotalPointsSpent(scores);
      const remaining = form.querySelector('#remaining-points');
      if (remaining) remaining.textContent = budget - spent;
    }
  }

  static async noSubmit(event) {
    if (event.target?.className?.includes('am-app-footer-cancel')) await AM.app?.close();
  }

  static async resetOptions(_event, target) {
    const form = target.ownerDocument.getElementById('a5e-mancer-app');
    await SavedOptions.resetOptions(form);
    AM.heritageGifts  = [];
    AM.equipmentData  = null;
    AM.app?.render(true);
    ui.notifications.info('am.app.optionsReset', { localize: true });
  }

  static navigatePrev(event) {
    event.preventDefault();
    const app = AM.app; if (!app) return;
    const group = 'a5e-mancer-tabs';
    const idx = TAB_ORDER.indexOf(app.tabGroups[group]);
    if (idx > 0) app.changeTab(TAB_ORDER[idx - 1], group);
  }

  static navigateNext(event) {
    event.preventDefault();
    const app = AM.app; if (!app) return;
    const group = 'a5e-mancer-tabs';
    const idx = TAB_ORDER.indexOf(app.tabGroups[group]);
    if (idx < TAB_ORDER.length - 1) app.changeTab(TAB_ORDER[idx + 1], group);
  }

  static #getSelectedClassName() {
    // Try reading from the dropdown DOM element first
    const ddEl = document.querySelector('#class-dropdown');
    const opt  = ddEl?.options[ddEl?.selectedIndex];
    if (opt?.textContent?.trim()) return opt.textContent.trim();

    // Fallback: look up the name from loaded documents by UUID
    const uuid = AM.SELECTED.class?.uuid;
    if (uuid && AM.documents?.class) {
      for (const group of AM.documents.class) {
        const doc = group.docs?.find(d => d.uuid === uuid);
        if (doc) return doc.name;
      }
    }
    return '';
  }

  /* ── HP picker (class tab) ────────────────────────────── */

  static setHpMethod(_event, btn) {
    const method = btn.dataset.method;
    if (!['max', 'avg', 'roll'].includes(method)) return;
    AM.hpChoice = { method, value: method === 'roll' ? (AM.hpChoice.value || 0) : 0 };
    AM.app?.render(false, { parts: ['class'] });
  }

  static rollHpDie() {
    const hitDie = AM.SELECTED.class?.hitDie ?? '';
    const num = parseInt(hitDie.replace('d', '')) || 0;
    if (!num) return;
    AM.hpChoice = { method: 'roll', value: 1 + Math.floor(Math.random() * num) };
    AM.app?.render(false, { parts: ['class'] });
  }

  /* ── Inline maneuver browser ──────────────────────────── */

  static filterManeuverTradition(_event, btn) {
    AM.maneuverFilter = { tradition: btn.dataset.tradition || null };
    AM.app?.render(false, { parts: ['maneuvers'] });
  }

  static toggleManeuver(_event, btn) {
    const uuid      = btn.dataset.uuid;
    const tradition = btn.dataset.tradition;
    if (!uuid) return;

    const className = A5eMancer.#getSelectedClassName();
    const info      = ManeuverService.getClassManeuverInfo(className, 1);
    if (!info) return;

    const uuids      = [...(AM.creationManeuvers?.uuids ?? [])];
    const traditions = [...(AM.creationManeuvers?.traditions ?? [])];
    const names      = [...(AM.creationManeuvers?.names ?? [])];
    const manName    = btn.dataset.name ?? '';
    const idx        = uuids.indexOf(uuid);

    if (idx >= 0) {
      uuids.splice(idx, 1);
      const ni = names.indexOf(manName);
      if (ni >= 0) names.splice(ni, 1);
      if (tradition) {
        const tradMap = AM.allManeuversData?.get(tradition);
        const stillUsing = tradMap
          ? uuids.some(u => [...tradMap.values()].flat().some(m => m.uuid === u))
          : false;
        if (!stillUsing) {
          const ti = traditions.indexOf(tradition);
          if (ti >= 0) traditions.splice(ti, 1);
        }
      }
    } else {
      if (uuids.length >= info.maneuversKnown) {
        ui.notifications.warn(game.i18n.format('am.maneuvers.slots-full', { n: info.maneuversKnown }));
        return;
      }
      if (tradition && !traditions.includes(tradition) && traditions.length >= info.traditions) {
        ui.notifications.warn(game.i18n.format('am.app.maneuvers.tradition-limit', { n: info.traditions }));
        return;
      }
      if (tradition && !traditions.includes(tradition)) traditions.push(tradition);
      uuids.push(uuid);
      if (manName) names.push(manName);
    }

    AM.creationManeuvers = { uuids, traditions, names: [...names].sort() };
    AM.app?.render(false, { parts: ['maneuvers'] });
  }

  static #buildTraditionPills(allData, selectedTraditions, activeTradition) {
    const traditions = getTraditions();
    return traditions
      .filter(t => {
        const tradMap = allData?.get(t.key);
        return tradMap && [...tradMap.values()].some(arr => arr.length > 0);
      })
      .map(t => ({
        key:   t.key,
        label: t.label,
        active: t.key === activeTradition,
        used:  selectedTraditions.includes(t.key),
        count: [...(allData.get(t.key)?.values() ?? [])].reduce((s, arr) => s + arr.length, 0)
      }));
  }

  static #filterManeuvers(allData, maxDegree, traditionFilter, selectedUuids) {
    if (!allData || !traditionFilter) return [];
    const tradMap = allData.get(traditionFilter);
    if (!tradMap) return [];
    const result = [];
    for (const [degree, maneuvers] of tradMap) {
      if (degree > maxDegree) continue;
      for (const m of maneuvers) {
        result.push({ ...m, isSelected: selectedUuids.includes(m.uuid) });
      }
    }
    return result.sort((a, b) => a.degree - b.degree || a.name.localeCompare(b.name));
  }

  /* ── Inline spell browser ─────────────────────────────── */

  static filterSpellLevel(_event, btn) {
    const raw   = btn.dataset.level;
    const level = raw === '' ? null : parseInt(raw);
    AM.spellFilter = { ...AM.spellFilter, level: isNaN(level) ? null : level };
    AM.app?.render(false, { parts: ['spells'] });
  }

  static filterSpellSchool(_event, btn) {
    AM.spellFilter = { ...AM.spellFilter, school: btn.dataset.school || null };
    AM.app?.render(false, { parts: ['spells'] });
  }

  static toggleSpell(_event, btn) {
    const uuid  = btn.dataset.uuid;
    const level = parseInt(btn.dataset.level ?? '0');
    if (!uuid) return;

    const className = A5eMancer.#getSelectedClassName();
    const info      = SpellService.getClassSpellInfo(className);
    if (!info) return;

    const isCantrip = level === 0;
    const cantrips  = [...(AM.creationSpells?.cantrips ?? [])];
    const spells    = [...(AM.creationSpells?.spells ?? [])];
    const names     = [...(AM.creationSpells?.names ?? [])];
    const spellName = btn.dataset.name ?? '';

    if (isCantrip) {
      const idx = cantrips.indexOf(uuid);
      if (idx >= 0) {
        cantrips.splice(idx, 1);
        const ni = names.indexOf(spellName); if (ni >= 0) names.splice(ni, 1);
      } else {
        if (cantrips.length >= (info.cantrips ?? 0)) {
          ui.notifications.warn(game.i18n.format('am.spells.cantrips-full', { n: info.cantrips }));
          return;
        }
        cantrips.push(uuid);
        if (spellName) names.push(spellName);
      }
    } else {
      const idx = spells.indexOf(uuid);
      if (idx >= 0) {
        spells.splice(idx, 1);
        const ni = names.indexOf(spellName); if (ni >= 0) names.splice(ni, 1);
      } else {
        if (info.type === 'known' && spells.length >= (info.spellsKnown ?? 0)) {
          ui.notifications.warn(game.i18n.format('am.spells.spells-full', { n: info.spellsKnown }));
          return;
        }
        spells.push(uuid);
        if (spellName) names.push(spellName);
      }
    }

    AM.creationSpells = { cantrips, spells, names: [...names].sort() };
    AM.app?.render(false, { parts: ['spells'] });
  }

  static #filterSpells(allData, spellInfo, filter, selectedCantrips, selectedSpells) {
    const maxLevel    = spellInfo?.maxLevel ?? 1;
    const filterLevel = filter.level ?? null;
    const filterSchool = filter.school ?? null;
    const levelsSet   = new Set();
    const schoolsMap  = new Map();
    const spells      = [];

    for (const [level, levelSpells] of allData) {
      if (level > maxLevel || levelSpells.length === 0) continue;
      levelsSet.add(level);
      for (const spell of levelSpells) {
        if (spell.school && !schoolsMap.has(spell.school))
          schoolsMap.set(spell.school, spell.schoolLabel || spell.school);
      }
    }

    for (const [level, levelSpells] of allData) {
      if (level > maxLevel) continue;
      if (filterLevel !== null && filterLevel !== level) continue;
      for (const spell of levelSpells) {
        if (filterSchool && spell.school !== filterSchool) continue;
        const isCantrip  = level === 0;
        const isSelected = isCantrip
          ? selectedCantrips.includes(spell.uuid)
          : selectedSpells.includes(spell.uuid);
        spells.push({ ...spell, isSelected, isCantrip });
      }
    }

    const levelPills = [...levelsSet].sort((a, b) => a - b).map(level => ({
      level,
      label: level === 0
        ? game.i18n.localize('am.spells.cantrip')
        : game.i18n.format('am.spells.level-n', { n: level }),
      active: filterLevel === level
    }));

    const schoolPills = [...schoolsMap.entries()]
      .sort((a, b) => a[1].localeCompare(b[1]))
      .map(([key, label]) => ({ key, label, active: filterSchool === key }));

    return { spells, levelPills, schoolPills, levelAllActive: filterLevel === null, schoolAllActive: !filterSchool };
  }

  static async formHandler(event, _form, formData) {
    if (event.submitter?.dataset.action === 'saveOptions') {
      await SavedOptions.saveOptions(formData.object);
      ui.notifications.info('am.app.optionsSaved', { localize: true });
      return null;
    }
    return ActorCreationService.createCharacter(event, formData);
  }
}
