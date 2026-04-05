import { AM } from '../a5e-mancer.js';
import {
  ActorCreationService, CharacterArtPicker, DOMManager,
  EquipmentService, FormValidation, SavedOptions, StatRoller,
  ManeuverService, CLASS_MANEUVER_TABLES
} from '../utils/index.js';
import { ManeuverDialog } from './ManeuverDialog.js';
import { SpellDialog } from './SpellDialog.js';
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
      toggleEquipmentChoice:  A5eMancer.toggleEquipmentChoice,
      openManeuverPicker:     A5eMancer.openManeuverPicker,
      openSpellPicker:        A5eMancer.openSpellPicker
    },
    classes: ['am-app'],
    position: { height: 'auto', width: 'auto', top: 100 },
    window: {
      icon: 'fa-solid fa-hat-wizard',
      resizable: false,
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
          const cls = AM.SELECTED.class?.uuid
            ? (() => { const dd = null; return AM.SELECTED.class; })()
            : null;
          const className = A5eMancer.#getSelectedClassName();
          const _maneuverInfo = className ? ManeuverService.getClassManeuverInfo(className, 1) : null;
          console.warn('a5e-mancer DEBUG maneuvers |',
            'AM.SELECTED.class:', JSON.stringify(AM.SELECTED.class),
            '| className:', JSON.stringify(className),
            '| maneuverInfo:', JSON.stringify(_maneuverInfo),
            '| CLASS_MANEUVER_TABLES keys:', Object.keys(CLASS_MANEUVER_TABLES));
          context.classSelected    = !!AM.SELECTED.class?.uuid;
          context.maneuverInfo     = className
            ? ManeuverService.getClassManeuverInfo(className, 1)
            : null;
          context.selectedManeuverUuids  = AM.creationManeuvers?.uuids ?? [];
          context.selectedTraditions     = AM.creationManeuvers?.traditions ?? [];
          context.selectedManeuverNames  = AM.creationManeuvers?.names ?? [];
          break;
        }

        case 'spells': {
          const className = A5eMancer.#getSelectedClassName();
          context.classSelected      = !!AM.SELECTED.class?.uuid;
          context.spellInfo          = className
            ? SpellService.getClassSpellInfo(className)
            : null;
          context.selectedCantripUuids = AM.creationSpells?.cantrips ?? [];
          context.selectedSpellUuids   = AM.creationSpells?.spells ?? [];
          context.selectedCantripCount = (AM.creationSpells?.cantrips ?? []).length;
          context.selectedSpellCount   = (AM.creationSpells?.spells ?? []).length;
          context.selectedSpellNames   = AM.creationSpells?.names ?? [];
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
          context.abilities       = StatRoller.buildAbilitiesContext();
          context.standardArray   = StatRoller.getStandardArrayValues();
          context.totalPoints     = StatRoller.getTotalPoints();
          context.pointsSpent     = StatRoller.calculateTotalPointsSpent(
            context.abilities.map(() => AM.ABILITY_SCORES.DEFAULT)
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
      start:       'fa-solid fa-play-circle',
      heritage:    'fa-solid fa-dna',
      heritageGift:'fa-solid fa-gift',
      culture:     'fa-solid fa-landmark',
      background:  'fa-solid fa-scroll',
      destiny:     'fa-solid fa-star',
      class:       'fa-solid fa-chess-rook',
      abilities:   'fa-solid fa-fist-raised',
      maneuvers:   'fa-solid fa-swords',
      spells:      'fa-solid fa-sparkles',
      equipment:   'fa-solid fa-shield-halved',
      biography:   'fa-solid fa-book-open',
      finalize:    'fa-solid fa-flag-checkered'
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

  static async openManeuverPicker(_event, _btn) {
    const app = AM.app;
    if (!app) return;
    const className = A5eMancer.#getSelectedClassName();
    const info = ManeuverService.getClassManeuverInfo(className, 1);
    if (!info) return;

    const traditions = AM.creationManeuvers?.traditions ?? [];
    new ManeuverDialog(null, {
      slotsAvailable:    info.maneuversKnown,
      maxDegree:         info.maxDegree,
      allowedTraditions: traditions,
      onConfirm: async (uuids, newTraditions) => {
        // Fetch names for preview
        const names = [];
        for (const uuid of uuids) {
          try { const i = await fromUuid(uuid); if (i) names.push(i.name); } catch {}
        }
        names.sort((a, b) => a.localeCompare(b));
        AM.creationManeuvers = { uuids, traditions: newTraditions, names };
        app.render(false, { parts: ['maneuvers'] });
      }
    }).render(true);
  }

  static async openSpellPicker(_event, _btn) {
    const app = AM.app;
    if (!app) return;
    const className = A5eMancer.#getSelectedClassName();
    const info = SpellService.getClassSpellInfo(className);
    if (!info) return;

    new SpellDialog(null, {
      className,
      cantripsToChoose: info.cantrips ?? 0,
      spellsToChoose:   info.spellsKnown ?? 0,
      maxSpellLevel:    info.maxLevel ?? 1,
      onConfirm: async (cantripUuids, spellUuids) => {
        const names = [];
        for (const uuid of [...cantripUuids, ...spellUuids]) {
          try { const i = await fromUuid(uuid); if (i) names.push(i.name); } catch {}
        }
        names.sort((a, b) => a.localeCompare(b));
        AM.creationSpells = { cantrips: cantripUuids, spells: spellUuids, names };
        app.render(false, { parts: ['spells'] });
      }
    }).render(true);
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
