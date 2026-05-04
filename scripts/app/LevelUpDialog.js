import { AM } from '../a5e-mancer.js';
import { LevelUpService } from '../utils/levelUpService.js';
import { DocumentService } from '../utils/documentService.js';
import { ManeuverService, CLASS_MANEUVER_TABLES } from '../utils/maneuverService.js';
import { ManeuverDialog } from './ManeuverDialog.js';

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class LevelUpDialog extends HandlebarsApplicationMixin(ApplicationV2) {

  constructor(actor, options = {}) {
    super(options);
    this.actor = actor;

    // Levelup mode state
    this._mode            = 'levelup'; // 'levelup' | 'multiclass'
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
    this._compendiumClasses = null; // null = not yet loaded

    // Shared
    this._selectedManeuverUuids = [];
    this._selectedTraditions    = [];
    this._maneuverInfo          = null;
  }

  static DEFAULT_OPTIONS = {
    id: 'a5e-level-up',
    tag: 'form',
    form: { handler: LevelUpDialog.formHandler, closeOnSubmit: true, submitOnChange: false },
    actions: {
      rollHP:         LevelUpDialog.rollHP,
      selectHPMethod: LevelUpDialog.selectHPMethod
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

    /* ── Multiclass mode ───────────────────────────────────────────────── */
    if (this._mode === 'multiclass') {
      // Lazy-load available classes
      if (!this._compendiumClasses) {
        this._compendiumClasses = await LevelUpService.getCompendiumClasses();
      }

      const existingNames = new Set(classes.map(c => c.name.toLowerCase()));
      const availableClasses = this._compendiumClasses
        .filter(c => !existingNames.has(c.name.toLowerCase()))
        .map(c => ({
          ...c,
          prereqs: LevelUpService.checkPrerequisites(this.actor, c.name),
        }));

      const newClass = this._newClassUuid
        ? (availableClasses.find(c => c.uuid === this._newClassUuid) ?? null)
        : null;

      if (newClass) this._newClassHitDie = newClass.hitDie;

      const newTotalLevel = total + 1;
      const gainsKnack    = newTotalLevel >= 2 && newTotalLevel % 2 === 0;

      if (gainsKnack && !this._knacks.length) {
        this._knacks = await LevelUpService.getExplorationKnacks();
      }

      const maneuverInfo = newClass
        ? this.#getManeuverInfo({ name: newClass.name }, 1, newTotalLevel)
        : null;

      const avgHP = Math.ceil((newClass?.hitDie ?? 8) / 2) + 1 + this.#getConMod();

      return {
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
        info:                 { gainsASI: false, gainsKnack },
        maneuverInfo,
        selectedManeuverCount: this._selectedManeuverUuids.length,
        selectedTraditions:    this._selectedTraditions,
        // Unused in multiclass mode but kept for template safety
        selectedClass: null,
        newClassLevel: 1,
        feats: [],
        multiclass: true,
      };
    }

    /* ── Level-up mode (existing class) ───────────────────────────────── */
    const selectedClass = classes.find(c => c.id === this._selectedClassId) ?? classes[0];
    const newClassLevel = selectedClass ? selectedClass.level + 1 : 1;
    const newTotalLevel = total + 1;
    const info = selectedClass
      ? LevelUpService.getLevelUpInfo(selectedClass, newClassLevel, newTotalLevel)
      : { gainsASI: false, gainsKnack: false, avgHP: 5, hitDie: 8 };

    if (info.gainsASI && !this._feats.length) {
      this._feats = await LevelUpService.getFeats();
    }
    if (info.gainsKnack && !this._knacks.length) {
      this._knacks = await LevelUpService.getExplorationKnacks();
    }

    const avgHP = info.avgHP + this.#getConMod();

    return {
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
      conMod:               this.#getConMod(),
      multiclass:           classes.length > 1,
      maneuverInfo:         this.#getManeuverInfo(selectedClass, newClassLevel, newTotalLevel),
      selectedManeuverCount: this._selectedManeuverUuids.length,
      selectedTraditions:    this._selectedTraditions,
      availableClasses: [],
      newClass: null,
    };
  }

  #getManeuverInfo(cls, newClassLevel, newTotalLevel) {
    if (!cls) return null;
    const info = ManeuverService.getClassManeuverInfo(cls.name, newClassLevel);
    if (!info || info.maneuversKnown === 0) return null;

    const prevInfo = ManeuverService.getClassManeuverInfo(cls.name, newClassLevel - 1) ?? { maneuversKnown: 0, maxDegree: 0 };
    const newManeuversToLearn = Math.max(0, info.maneuversKnown - prevInfo.maneuversKnown);
    const degreeUnlocked      = info.maxDegree > prevInfo.maxDegree ? info.maxDegree : null;

    return {
      ...info,
      newManeuversToLearn,
      degreeUnlocked,
      hasManeuvers: info.maneuversKnown > 0
    };
  }

  #getConMod() {
    const con = this.actor.system?.abilities?.con?.value ?? 10;
    return Math.floor((con - 10) / 2);
  }

  async _onRender(ctx, opts) {
    /* ── Mode toggle ─────────────────────────────────────────────────── */
    this.element.querySelectorAll('.lu-mode-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const newMode = btn.dataset.mode;
        if (newMode === this._mode) return;
        this._mode      = newMode;
        this._rolledHP  = null;
        this._featUuid  = null;
        this._knackUuid = null;
        this._selectedManeuverUuids = [];
        this._selectedTraditions    = [];
        await this.render(true);
      });
    });

    /* ── Existing class selector (levelup mode) ──────────────────────── */
    const classSelect = this.element.querySelector('#lu-class-select');
    if (classSelect) {
      classSelect.addEventListener('change', async (e) => {
        this._selectedClassId = e.target.value;
        this._rolledHP = null;
        this._feats    = [];
        this._knacks   = [];
        await this.render(true);
      });
    }

    /* ── New class selector (multiclass mode) ────────────────────────── */
    const newClassSelect = this.element.querySelector('#lu-new-class-select');
    if (newClassSelect) {
      newClassSelect.addEventListener('change', async (e) => {
        this._newClassUuid = e.target.value || null;
        this._rolledHP     = null;
        this._hpMethod     = 'average';
        this._selectedManeuverUuids = [];
        this._selectedTraditions    = [];
        await this.render(true);
      });
    }

    /* ── HP method radio ─────────────────────────────────────────────── */
    this.element.querySelectorAll('[name="hp-method"]').forEach(radio => {
      radio.addEventListener('change', (e) => {
        this._hpMethod = e.target.value;
        this.render(false);
      });
    });

    /* ── Manual HP input ─────────────────────────────────────────────── */
    const manualInput = this.element.querySelector('#lu-manual-hp');
    if (manualInput) {
      manualInput.addEventListener('input', (e) => {
        this._manualHP = parseInt(e.target.value) || 0;
      });
    }

    /* ── Feat selector ───────────────────────────────────────────────── */
    const featSelect = this.element.querySelector('#lu-feat-select');
    if (featSelect) {
      featSelect.addEventListener('change', async (e) => {
        this._featUuid = e.target.value || null;
        const panel = this.element.querySelector('#lu-feat-description');
        if (panel) {
          if (this._featUuid) {
            panel.innerHTML = `<p class="am-loading"><i class="fas fa-spinner fa-spin"></i></p>`;
            panel.innerHTML = await DocumentService.getEnrichedDescription(this._featUuid) || '';
          } else {
            panel.innerHTML = '';
          }
        }
      });
    }

    /* ── Knack selector ──────────────────────────────────────────────── */
    const knackSelect = this.element.querySelector('#lu-knack-select');
    if (knackSelect) {
      knackSelect.addEventListener('change', async (e) => {
        this._knackUuid = e.target.value || null;
        const panel = this.element.querySelector('#lu-knack-description');
        if (panel) {
          if (this._knackUuid) {
            panel.innerHTML = `<p class="am-loading"><i class="fas fa-spinner fa-spin"></i></p>`;
            panel.innerHTML = await DocumentService.getEnrichedDescription(this._knackUuid) || '';
          } else {
            panel.innerHTML = '';
          }
        }
      });
    }

    /* ── Maneuver picker ─────────────────────────────────────────────── */
    this.element.querySelector('.lu-open-maneuvers')?.addEventListener('click', async () => {
      const ctx  = await this._prepareContext({});
      const info = ctx.maneuverInfo;
      if (!info) return;

      new ManeuverDialog(this.actor, {
        slotsAvailable:    info.newManeuversToLearn,
        maxDegree:         info.maxDegree,
        allowedTraditions: [...this._selectedTraditions, ...ManeuverService.getActorTraditions(this.actor)],
        onConfirm: (uuids, traditions) => {
          this._selectedManeuverUuids = uuids;
          this._selectedTraditions    = traditions;
          this.render(false);
        }
      }).render(true);
    });
  }

  /* ── Static actions ───────────────────────────────────────────────────── */

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

  static async formHandler(_event, _form, _formData) {
    const dialog = AM.levelUpDialog;
    if (!dialog) return;

    const conMod = dialog.#getConMod();

    /* ── Multiclass submit ────────────────────────────────────────────── */
    if (dialog._mode === 'multiclass') {
      if (!dialog._newClassUuid) {
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

      await LevelUpService.applyMulticlass(
        dialog.actor,
        dialog._newClassUuid,
        hpGained,
        dialog._knackUuid
      );

      if (dialog._selectedManeuverUuids.length || dialog._selectedTraditions.length) {
        await ManeuverService.applyManeuversToActor(
          dialog.actor,
          dialog._selectedManeuverUuids,
          dialog._selectedTraditions
        );
      }

      AM.levelUpDialog = null;
      return;
    }

    /* ── Normal level-up submit ───────────────────────────────────────── */
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
      dialog.actor,
      cls.id,
      hpGained,
      dialog._featUuid,
      dialog._knackUuid
    );

    if (dialog._selectedManeuverUuids.length || dialog._selectedTraditions.length) {
      await ManeuverService.applyManeuversToActor(
        dialog.actor,
        dialog._selectedManeuverUuids,
        dialog._selectedTraditions
      );
    }

    AM.levelUpDialog = null;
  }
}
