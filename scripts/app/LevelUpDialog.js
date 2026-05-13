import { AM } from '../a5e-mancer.js';
import { LevelUpService } from '../utils/levelUpService.js';
import { DocumentService } from '../utils/documentService.js';
import { ManeuverService, CLASS_MANEUVER_TABLES, getTraditions } from '../utils/maneuverService.js';
import { SpellService, CLASS_SPELL_TABLES } from '../utils/spellService.js';

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class LevelUpDialog extends HandlebarsApplicationMixin(ApplicationV2) {

  constructor(actor, options = {}) {
    super(options);
    this.actor = actor;

    // Levelup mode state
    this._mode            = 'levelup';
    this._hpMethod        = 'average';
    this._selectedClassId = null;
    this._manualHP        = null;
    this._rolledHP        = null;
    this._featUuid        = null;
    this._knackUuid       = null;
    this._feats           = [];
    this._knacks          = [];

    // Multiclass mode state
    this._newClassUuid      = null;
    this._newClassHitDie    = 8;
    this._compendiumClasses = null;

    // Shared maneuver/spell selection state
    this._selectedManeuverUuids = [];
    this._selectedTraditions    = [];
    this._selectedCantripUuids  = [];
    this._selectedSpellUuids    = [];

    // Inline browser state
    this._maneuverFilter   = { tradition: null };
    this._spellFilter      = { level: null, school: null };
    this._allManeuversData = null;
    this._allSpellsData    = null;
    this._loadingManeuvers = false;
    this._loadingSpells    = false;
  }

  static DEFAULT_OPTIONS = {
    id: 'a5e-level-up',
    tag: 'form',
    form: { handler: LevelUpDialog.formHandler, closeOnSubmit: true, submitOnChange: false },
    actions: {
      rollHP:                    LevelUpDialog.rollHP,
      luFilterManeuverTradition: LevelUpDialog.luFilterManeuverTradition,
      luToggleManeuver:          LevelUpDialog.luToggleManeuver,
      luFilterSpellLevel:        LevelUpDialog.luFilterSpellLevel,
      luFilterSpellSchool:       LevelUpDialog.luFilterSpellSchool,
      luToggleSpell:             LevelUpDialog.luToggleSpell,
    },
    classes: ['am-app', 'am-levelup-dialog'],
    position: { width: 540, height: 'auto' },
    window: { icon: 'fa-solid fa-arrow-up', resizable: false, minimizable: false }
  };

  static PARTS = {
    main: { template: 'modules/a5e-mancer/templates/level-up.hbs' }
  };

  get title() {
    return game.i18n.format('am.levelup.title', { name: this.actor.name });
  }

  async _prepareContext(_options) {
    const classes = LevelUpService.getActorClasses(this.actor);
    const total   = LevelUpService.getTotalLevel(this.actor);

    if (!this._selectedClassId && classes.length) {
      this._selectedClassId = classes[0].id;
    }

    /* ── Multiclass mode ─────────────────────────────────────────────── */
    if (this._mode === 'multiclass') {
      if (!this._compendiumClasses) {
        this._compendiumClasses = await LevelUpService.getCompendiumClasses();
      }

      const existingNames = new Set(classes.map(c => c.name.toLowerCase()));
      const availableClasses = this._compendiumClasses
        .filter(c => !existingNames.has(c.name.toLowerCase()))
        .map(c => ({ ...c, prereqs: LevelUpService.checkPrerequisites(this.actor, c.name) }));

      const newClass = this._newClassUuid
        ? (availableClasses.find(c => c.uuid === this._newClassUuid) ?? null)
        : null;

      if (newClass) this._newClassHitDie = newClass.hitDie;

      const newTotalLevel = total + 1;
      const maneuverInfo = newClass
        ? this.#getManeuverInfo({ name: newClass.name }, 1, newTotalLevel)
        : null;
      const spellInfo = newClass
        ? (CLASS_SPELL_TABLES[newClass.name.toLowerCase()] ?? await SpellService.loadClassSpellInfo(newClass.uuid))
        : null;
      const avgHP = Math.ceil((newClass?.hitDie ?? 8) / 2) + 1 + this.#getConMod();

      const context = {
        actor:                this.actor,
        classes,
        mode:                 'multiclass',
        availableClasses,
        newClass,
        newTotalLevel,
        hpMethod:             this._hpMethod,
        avgHP,
        rolledHP:             this._rolledHP !== null ? this._rolledHP + this.#getConMod() : null,
        manualHP:             this._manualHP,
        conMod:               this.#getConMod(),
        knacks:               this._knacks,
        info:                 { gainsASI: false, gainsKnack: false },
        maneuverInfo,
        selectedManeuverCount: this._selectedManeuverUuids.length,
        selectedTraditions:    this._selectedTraditions,
        spellInfo,
        selectedCantripCount:  this._selectedCantripUuids.length,
        selectedSpellCount:    this._selectedCantripUuids.length + this._selectedSpellUuids.length,
        selectedClass: null,
        newClassLevel: 1,
        feats: [],
        multiclass: true,
      };

      this.#addManeuverBrowserContext(context, maneuverInfo);
      this.#addSpellBrowserContext(context, spellInfo);
      return context;
    }

    /* ── Level-up mode ───────────────────────────────────────────────── */
    const selectedClass = classes.find(c => c.id === this._selectedClassId) ?? classes[0];
    const newClassLevel = selectedClass ? selectedClass.level + 1 : 1;
    const newTotalLevel = total + 1;
    const info = selectedClass
      ? LevelUpService.getLevelUpInfo(selectedClass, newClassLevel, newTotalLevel)
      : { gainsASI: false, gainsKnack: false, avgHP: 5, hitDie: 8 };

    if (info.gainsASI && !this._feats.length)   this._feats  = await LevelUpService.getFeats();
    if (info.gainsKnack && !this._knacks.length) this._knacks = await LevelUpService.getExplorationKnacks(selectedClass?.name ?? null);

    const avgHP       = info.avgHP + this.#getConMod();
    const maneuverInfo = this.#getManeuverInfo(selectedClass, newClassLevel, newTotalLevel);

    const classKey   = selectedClass?.name?.toLowerCase().replace(/\s*\(.*\)\s*/, '').trim();
    const knackLabel = (classKey && CONFIG.A5E?.knackTypes?.[classKey])
      ? CONFIG.A5E.knackTypes[classKey]
      : game.i18n.localize('am.levelup.knack-title');

    const context = {
      actor:                this.actor,
      classes,
      mode:                 'levelup',
      selectedClass,
      newClassLevel,
      newTotalLevel,
      info,
      hpMethod:             this._hpMethod,
      avgHP,
      rolledHP:             this._rolledHP !== null ? this._rolledHP + this.#getConMod() : null,
      manualHP:             this._manualHP,
      feats:                this._feats,
      knacks:               this._knacks,
      knackLabel,
      conMod:               this.#getConMod(),
      multiclass:           classes.length > 1,
      maneuverInfo,
      selectedManeuverCount: this._selectedManeuverUuids.length,
      selectedTraditions:    this._selectedTraditions,
      availableClasses: [],
      newClass: null,
    };

    this.#addManeuverBrowserContext(context, maneuverInfo);
    return context;
  }

  /* ── Context helpers ─────────────────────────────────────────────────── */

  #addManeuverBrowserContext(context, maneuverInfo) {
    if (!maneuverInfo?.newManeuversToLearn) return;
    context.maneuversLoaded = !!this._allManeuversData;
    if (this._allManeuversData) {
      const actorTraditions = ManeuverService.getActorTraditions?.(this.actor) ?? [];
      const allUsed = [...new Set([...actorTraditions, ...this._selectedTraditions])];
      context.inlineTraditions      = LevelUpDialog.#buildTraditionPills(this._allManeuversData, allUsed, this._maneuverFilter.tradition);
      context.visibleManeuvers      = LevelUpDialog.#filterManeuvers(this._allManeuversData, maneuverInfo.maxDegree, this._maneuverFilter.tradition, this._selectedManeuverUuids);
      context.maneuverFilterTradition = this._maneuverFilter.tradition ?? '';
    } else if (!this._loadingManeuvers) {
      this._loadingManeuvers = true;
      ManeuverService.loadAllManeuvers().then(data => {
        this._allManeuversData = data;
        this._loadingManeuvers = false;
        this.render(false);
      });
    }
  }

  #addSpellBrowserContext(context, spellInfo) {
    if (!spellInfo) return;
    context.spellsLoaded = !!this._allSpellsData;
    if (this._allSpellsData) {
      const result = LevelUpDialog.#filterSpells(this._allSpellsData, spellInfo, this._spellFilter, this._selectedCantripUuids, this._selectedSpellUuids);
      context.visibleSpells        = result.spells;
      context.spellLevelPills      = result.levelPills;
      context.spellSchoolPills     = result.schoolPills;
      context.spellLevelAllActive  = result.levelAllActive;
      context.spellSchoolAllActive = result.schoolAllActive;
    } else if (!this._loadingSpells) {
      this._loadingSpells = true;
      SpellService.loadSpells(null, spellInfo.maxLevel ?? 1).then(data => {
        this._allSpellsData = data;
        this._loadingSpells = false;
        this.render(false);
      });
    }
  }

  #getManeuverInfo(cls, newClassLevel, newTotalLevel) {
    if (!cls) return null;
    const info = ManeuverService.getClassManeuverInfo(cls.name, newClassLevel);
    if (!info || info.maneuversKnown === 0) return null;

    const prevInfo = ManeuverService.getClassManeuverInfo(cls.name, newClassLevel - 1) ?? { maneuversKnown: 0, maxDegree: 0 };
    const newManeuversToLearn = Math.max(0, info.maneuversKnown - prevInfo.maneuversKnown);
    const degreeUnlocked      = info.maxDegree > prevInfo.maxDegree ? info.maxDegree : null;

    return { ...info, newManeuversToLearn, degreeUnlocked, hasManeuvers: info.maneuversKnown > 0 };
  }

  #getConMod() {
    const con = this.actor.system?.abilities?.con?.value ?? 10;
    return Math.floor((con - 10) / 2);
  }

  #resetSelections() {
    this._selectedManeuverUuids = [];
    this._selectedTraditions    = [];
    this._selectedCantripUuids  = [];
    this._selectedSpellUuids    = [];
    this._allManeuversData  = null;
    this._allSpellsData     = null;
    this._loadingManeuvers  = false;
    this._loadingSpells     = false;
    this._maneuverFilter    = { tradition: null };
    this._spellFilter       = { level: null, school: null };
  }

  /* ── Private static browser helpers ─────────────────────────────────── */

  static #buildTraditionPills(allData, usedTraditions, activeTradition) {
    return getTraditions()
      .filter(t => {
        const tradMap = allData?.get(t.key);
        return tradMap && [...tradMap.values()].some(arr => arr.length > 0);
      })
      .map(t => ({
        key:    t.key,
        label:  t.label,
        active: t.key === activeTradition,
        used:   usedTraditions.includes(t.key),
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

  static #filterSpells(allData, spellInfo, filter, selectedCantrips, selectedSpells) {
    const maxLevel     = spellInfo?.maxLevel ?? 1;
    const filterLevel  = filter.level ?? null;
    const filterSchool = filter.school ?? null;
    const levelsSet    = new Set();
    const schoolsMap   = new Map();
    const spells       = [];

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
        const isSelected = isCantrip ? selectedCantrips.includes(spell.uuid) : selectedSpells.includes(spell.uuid);
        spells.push({ ...spell, isSelected, isCantrip });
      }
    }

    const levelPills = [...levelsSet].sort((a, b) => a - b).map(level => ({
      level,
      label:  level === 0 ? game.i18n.localize('am.spells.cantrip') : game.i18n.format('am.spells.level-n', { n: level }),
      active: filterLevel === level
    }));
    const schoolPills = [...schoolsMap.entries()]
      .sort((a, b) => a[1].localeCompare(b[1]))
      .map(([key, label]) => ({ key, label, active: filterSchool === key }));

    return { spells, levelPills, schoolPills, levelAllActive: filterLevel === null, schoolAllActive: !filterSchool };
  }

  /* ── render lifecycle ────────────────────────────────────────────────── */

  async _onRender(_ctx, _opts) {
    /* ── Mode toggle ── */
    this.element.querySelectorAll('.lu-mode-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const newMode = btn.dataset.mode;
        if (newMode === this._mode) return;
        this._mode      = newMode;
        this._rolledHP  = null;
        this._featUuid  = null;
        this._knackUuid = null;
        this.#resetSelections();
        await this.render(true);
      });
    });

    /* ── Existing class selector (levelup mode) ── */
    const classSelect = this.element.querySelector('#lu-class-select');
    if (classSelect) {
      classSelect.addEventListener('change', async (e) => {
        this._selectedClassId = e.target.value;
        this._rolledHP = null;
        this._feats    = [];
        this._knacks   = [];
        this.#resetSelections();
        await this.render(true);
      });
    }

    /* ── New class selector (multiclass mode) ── */
    const newClassSelect = this.element.querySelector('#lu-new-class-select');
    if (newClassSelect) {
      newClassSelect.addEventListener('change', async (e) => {
        this._newClassUuid = e.target.value || null;
        this._rolledHP     = null;
        this._hpMethod     = 'average';
        this.#resetSelections();
        await this.render(true);
      });
    }

    /* ── HP method radio ── */
    this.element.querySelectorAll('[name="hp-method"]').forEach(radio => {
      radio.addEventListener('change', (e) => {
        this._hpMethod = e.target.value;
        this.render(false);
      });
    });

    /* ── Manual HP input ── */
    const manualInput = this.element.querySelector('#lu-manual-hp');
    if (manualInput) {
      manualInput.addEventListener('input', (e) => {
        this._manualHP = parseInt(e.target.value) || 0;
      });
    }

    /* ── Feat selector ── */
    const featSelect = this.element.querySelector('#lu-feat-select');
    if (featSelect) {
      featSelect.addEventListener('change', async (e) => {
        this._featUuid = e.target.value || null;
        const panel = this.element.querySelector('#lu-feat-description');
        if (panel) {
          panel.innerHTML = this._featUuid
            ? (await DocumentService.getEnrichedDescription(this._featUuid) || '')
            : '';
        }
      });
    }

    /* ── Knack selector ── */
    const knackSelect = this.element.querySelector('#lu-knack-select');
    if (knackSelect) {
      knackSelect.addEventListener('change', async (e) => {
        this._knackUuid = e.target.value || null;
        const panel = this.element.querySelector('#lu-knack-description');
        if (panel) {
          panel.innerHTML = this._knackUuid
            ? (await DocumentService.getEnrichedDescription(this._knackUuid) || '')
            : '';
        }
      });
    }

    /* ── Inline card description hover ── */
    if (!this._descCache) this._descCache = new Map();
    const inlineHintHtml = `<p class="am-hint">${game.i18n.localize('am.app.hover-for-description')}</p>`;
    for (const grid of this.element.querySelectorAll('.am-inline-card-grid')) {
      const panel = grid.closest('.lu-section')?.querySelector('.am-inline-description');
      if (!panel) continue;
      if (!panel.innerHTML.trim()) panel.innerHTML = inlineHintHtml;

      grid.addEventListener('mouseover', async (e) => {
        const card = e.target.closest('.am-card[data-uuid]');
        if (!card) return;
        const uuid = card.dataset.uuid;
        if (this._descCache.has(uuid)) {
          panel.innerHTML = this._descCache.get(uuid);
        } else {
          panel.innerHTML = `<p class="am-loading"><i class="fas fa-spinner fa-spin"></i></p>`;
          const html = await DocumentService.getEnrichedDescription(uuid);
          const content = html || `<p class="am-hint">${game.i18n.localize('am.app.no-description')}</p>`;
          this._descCache.set(uuid, content);
          if (panel.isConnected) panel.innerHTML = content;
        }
      });
      grid.addEventListener('mouseleave', () => { panel.innerHTML = inlineHintHtml; });
    }
  }

  /* ── Static action: maneuver browser ────────────────────────────────── */

  static luFilterManeuverTradition(_event, btn) {
    const dialog = AM.levelUpDialog;
    if (!dialog) return;
    dialog._maneuverFilter = { tradition: btn.dataset.tradition || null };
    dialog.render(false);
  }

  static luToggleManeuver(_event, btn) {
    const dialog = AM.levelUpDialog;
    if (!dialog) return;

    const uuid      = btn.dataset.uuid;
    const tradition = btn.dataset.tradition;
    if (!uuid) return;

    // Resolve slot limit and tradition limit from current class context
    let limit = 0;
    let totalTraditionLimit = 0;
    const classes = LevelUpService.getActorClasses(dialog.actor);

    if (dialog._mode === 'multiclass') {
      const newClass = (dialog._compendiumClasses ?? []).find(c => c.uuid === dialog._newClassUuid);
      if (!newClass) return;
      const info = ManeuverService.getClassManeuverInfo(newClass.name, 1);
      if (!info) return;
      limit = info.maneuversKnown;
      totalTraditionLimit = info.traditions;
    } else {
      const cls = classes.find(c => c.id === dialog._selectedClassId) ?? classes[0];
      if (!cls) return;
      const newLevel = cls.level + 1;
      const curr = ManeuverService.getClassManeuverInfo(cls.name, newLevel);
      const prev = ManeuverService.getClassManeuverInfo(cls.name, newLevel - 1) ?? { maneuversKnown: 0 };
      if (!curr) return;
      limit = Math.max(0, curr.maneuversKnown - prev.maneuversKnown);
      totalTraditionLimit = curr.traditions;
    }

    const uuids      = [...dialog._selectedManeuverUuids];
    const traditions = [...dialog._selectedTraditions];
    const idx = uuids.indexOf(uuid);

    if (idx >= 0) {
      // Deselect
      uuids.splice(idx, 1);
      if (tradition) {
        const tradMap = dialog._allManeuversData?.get(tradition);
        const stillUsing = tradMap
          ? uuids.some(u => [...tradMap.values()].flat().some(m => m.uuid === u))
          : false;
        if (!stillUsing) {
          const actorTraditions = ManeuverService.getActorTraditions?.(dialog.actor) ?? [];
          if (!actorTraditions.includes(tradition)) {
            const ti = traditions.indexOf(tradition);
            if (ti >= 0) traditions.splice(ti, 1);
          }
        }
      }
    } else {
      // Select
      if (uuids.length >= limit) {
        ui.notifications.warn(game.i18n.format('am.maneuvers.slots-full', { n: limit }));
        return;
      }
      if (tradition) {
        const actorTraditions = ManeuverService.getActorTraditions?.(dialog.actor) ?? [];
        const allUsed = new Set([...actorTraditions, ...traditions]);
        if (!allUsed.has(tradition) && allUsed.size >= totalTraditionLimit) {
          ui.notifications.warn(game.i18n.format('am.app.maneuvers.tradition-limit', { n: totalTraditionLimit }));
          return;
        }
        if (!traditions.includes(tradition) && !actorTraditions.includes(tradition)) {
          traditions.push(tradition);
        }
      }
      uuids.push(uuid);
    }

    dialog._selectedManeuverUuids = uuids;
    dialog._selectedTraditions    = traditions;
    dialog.render(false);
  }

  /* ── Static action: spell browser ───────────────────────────────────── */

  static luFilterSpellLevel(_event, btn) {
    const dialog = AM.levelUpDialog;
    if (!dialog) return;
    const raw   = btn.dataset.level;
    const level = raw === '' ? null : parseInt(raw);
    dialog._spellFilter = { ...dialog._spellFilter, level: isNaN(level) ? null : level };
    dialog.render(false);
  }

  static luFilterSpellSchool(_event, btn) {
    const dialog = AM.levelUpDialog;
    if (!dialog) return;
    dialog._spellFilter = { ...dialog._spellFilter, school: btn.dataset.school || null };
    dialog.render(false);
  }

  static luToggleSpell(_event, btn) {
    const dialog = AM.levelUpDialog;
    if (!dialog) return;

    const uuid  = btn.dataset.uuid;
    const level = parseInt(btn.dataset.level ?? '0');
    if (!uuid) return;

    const newClass = (dialog._compendiumClasses ?? []).find(c => c.uuid === dialog._newClassUuid);
    if (!newClass) return;
    const spellInfo = CLASS_SPELL_TABLES[newClass.name.toLowerCase()];
    if (!spellInfo) return;

    const isCantrip = level === 0;
    const cantrips  = [...dialog._selectedCantripUuids];
    const spells    = [...dialog._selectedSpellUuids];

    if (isCantrip) {
      const idx = cantrips.indexOf(uuid);
      if (idx >= 0) {
        cantrips.splice(idx, 1);
      } else {
        if (cantrips.length >= (spellInfo.cantrips ?? 0)) {
          ui.notifications.warn(game.i18n.format('am.spells.cantrips-full', { n: spellInfo.cantrips }));
          return;
        }
        cantrips.push(uuid);
      }
    } else {
      const idx = spells.indexOf(uuid);
      if (idx >= 0) {
        spells.splice(idx, 1);
      } else {
        if (spellInfo.type === 'known' && spells.length >= (spellInfo.spellsKnown ?? 0)) {
          ui.notifications.warn(game.i18n.format('am.spells.spells-full', { n: spellInfo.spellsKnown }));
          return;
        }
        spells.push(uuid);
      }
    }

    dialog._selectedCantripUuids = cantrips;
    dialog._selectedSpellUuids   = spells;
    dialog.render(false);
  }

  /* ── Static actions: HP ─────────────────────────────────────────────── */

  static async rollHP(_event, _btn) {
    const dialog = AM.levelUpDialog;
    if (!dialog) return;

    let hitDie;
    if (dialog._mode === 'multiclass') {
      hitDie = dialog._newClassHitDie;
    } else {
      const classes = LevelUpService.getActorClasses(dialog.actor);
      const cls = classes.find(c => c.id === dialog._selectedClassId) ?? classes[0];
      if (!cls) return;
      hitDie = cls.hitDie;
    }

    const roll = new Roll(`1d${hitDie}`);
    await roll.evaluate();

    if (game.modules.get('dice-so-nice')?.active) {
      try { await game.dice3d?.showForRoll(roll, game.user, true); } catch {}
    }

    dialog._rolledHP = roll.total;
    dialog._hpMethod = 'roll';
    await dialog.render(false);

    const resultEl = dialog.element.querySelector('#lu-roll-result');
    if (resultEl) {
      const conMod = dialog.#getConMod();
      resultEl.textContent = `${roll.total} + ${conMod} CON = ${roll.total + conMod} HP`;
    }
  }

  /* ── Form handler ───────────────────────────────────────────────────── */

  static async formHandler(_event, _form, _formData) {
    const dialog = AM.levelUpDialog;
    if (!dialog) return;
    AM.levelUpDialog = null;

    const conMod = dialog.#getConMod();

    /* ── Multiclass submit ── */
    if (dialog._mode === 'multiclass') {
      if (!dialog._newClassUuid) {
        AM.levelUpDialog = dialog;
        ui.notifications.warn(game.i18n.localize('am.levelup.multiclass-no-class'));
        return;
      }

      const hitDie = dialog._newClassHitDie;
      let hpGained = 0;
      switch (dialog._hpMethod) {
        case 'average': hpGained = Math.ceil(hitDie / 2) + 1 + conMod; break;
        case 'roll':    hpGained = (dialog._rolledHP ?? 1) + conMod;    break;
        case 'max':     hpGained = hitDie + conMod;                      break;
        case 'manual':  hpGained = dialog._manualHP ?? 0;                break;
      }
      hpGained = Math.max(1, hpGained);

      const success = await LevelUpService.applyMulticlass(
        dialog.actor, dialog._newClassUuid, hpGained, dialog._knackUuid
      );
      if (!success) return;

      if (dialog._selectedManeuverUuids.length || dialog._selectedTraditions.length) {
        await ManeuverService.applyManeuversToActor(
          dialog.actor, dialog._selectedManeuverUuids, dialog._selectedTraditions
        );
      }
      if (dialog._selectedCantripUuids.length || dialog._selectedSpellUuids.length) {
        await SpellService.applySpellsToActor(
          dialog.actor, [...dialog._selectedCantripUuids, ...dialog._selectedSpellUuids]
        );
      }
      return;
    }

    /* ── Normal level-up submit ── */
    const classes = LevelUpService.getActorClasses(dialog.actor);
    const cls     = classes.find(c => c.id === dialog._selectedClassId) ?? classes[0];
    if (!cls) return;

    let hpGained = 0;
    switch (dialog._hpMethod) {
      case 'average': hpGained = Math.ceil(cls.hitDie / 2) + 1 + conMod; break;
      case 'roll':    hpGained = (dialog._rolledHP ?? 1) + conMod;        break;
      case 'max':     hpGained = cls.hitDie + conMod;                      break;
      case 'manual':  hpGained = dialog._manualHP ?? 0;                    break;
    }
    hpGained = Math.max(1, hpGained);

    await LevelUpService.applyLevelUp(
      dialog.actor, cls.id, hpGained, dialog._featUuid, dialog._knackUuid
    );

    if (dialog._selectedManeuverUuids.length || dialog._selectedTraditions.length) {
      await ManeuverService.applyManeuversToActor(
        dialog.actor, dialog._selectedManeuverUuids, dialog._selectedTraditions
      );
    }
  }
}
