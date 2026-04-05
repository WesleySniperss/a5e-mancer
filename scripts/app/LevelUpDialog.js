import { AM } from '../a5e-mancer.js';
import { LevelUpService } from '../utils/levelUpService.js';
import { DocumentService } from '../utils/documentService.js';
import { ManeuverService, CLASS_MANEUVER_TABLES } from '../utils/maneuverService.js';
import { ManeuverDialog } from './ManeuverDialog.js';

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Level Up dialog for a5e characters.
 * Opens as a standalone ApplicationV2 window.
 */
export class LevelUpDialog extends HandlebarsApplicationMixin(ApplicationV2) {

  constructor(actor, options = {}) {
    super(options);
    this.actor = actor;
    this._hpMethod = 'average';
    this._selectedClassId = null;
    this._manualHP = null;
    this._rolledHP = null;
    this._featUuid = null;
    this._knackUuid = null;
    this._feats = [];
    this._knacks = [];
    this._selectedManeuverUuids = [];
    this._selectedTraditions    = [];
    this._maneuverInfo          = null;
  }

  static DEFAULT_OPTIONS = {
    id: 'a5e-level-up',
    tag: 'form',
    form: { handler: LevelUpDialog.formHandler, closeOnSubmit: true, submitOnChange: false },
    actions: {
      rollHP:        LevelUpDialog.rollHP,
      selectHPMethod: LevelUpDialog.selectHPMethod
    },
    classes: ['am-app', 'am-levelup-dialog'],
    position: { width: 520, height: 'auto' },
    window: { icon: 'fa-solid fa-arrow-up', resizable: false, minimizable: false }
  };

  static PARTS = {
    main: { template: 'modules/a5e-mancer/templates/level-up.hbs' }
  };

  get title() {
    return game.i18n.format('am.levelup.title', { name: this.actor.name });
  }

  async _prepareContext(_options) {
    const classes  = LevelUpService.getActorClasses(this.actor);
    const total    = LevelUpService.getTotalLevel(this.actor);

    // Default to first class
    if (!this._selectedClassId && classes.length) {
      this._selectedClassId = classes[0].id;
    }

    const selectedClass = classes.find(c => c.id === this._selectedClassId) ?? classes[0];
    const newClassLevel = selectedClass ? selectedClass.level + 1 : 1;
    const newTotalLevel = total + 1;
    const info = selectedClass
      ? LevelUpService.getLevelUpInfo(selectedClass, newClassLevel, newTotalLevel)
      : { gainsASI: false, gainsKnack: false, avgHP: 5, hitDie: 8 };

    // Load feats/knacks if needed (lazy)
    if (info.gainsASI && !this._feats.length) {
      this._feats = await LevelUpService.getFeats();
    }
    if (info.gainsKnack && !this._knacks.length) {
      this._knacks = await LevelUpService.getExplorationKnacks();
    }

    const avgHP = info.avgHP + this.#getConMod();

    return {
      actor:         this.actor,
      classes,
      selectedClass,
      newClassLevel,
      newTotalLevel,
      info,
      hpMethod:      this._hpMethod,
      avgHP,
      rolledHP:      this._rolledHP !== null ? this._rolledHP + this.#getConMod() : null,
      manualHP:      this._manualHP,
      feats:         this._feats,
      knacks:        this._knacks,
      conMod:        this.#getConMod(),
      multiclass:    classes.length > 1 || newTotalLevel === 1,
      maneuverInfo:  this.#getManeuverInfo(selectedClass, newClassLevel, newTotalLevel),
      selectedManeuverCount: this._selectedManeuverUuids.length,
      selectedTraditions:    this._selectedTraditions
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
    // Class selector
    const classSelect = this.element.querySelector('#lu-class-select');
    if (classSelect) {
      classSelect.addEventListener('change', async (e) => {
        this._selectedClassId = e.target.value;
        this._rolledHP = null;
        await this.render(true);
      });
    }

    // HP method radio
    this.element.querySelectorAll('[name="hp-method"]').forEach(radio => {
      radio.addEventListener('change', (e) => {
        this._hpMethod = e.target.value;
        this.render(false);
      });
    });

    // Manual HP input
    const manualInput = this.element.querySelector('#lu-manual-hp');
    if (manualInput) {
      manualInput.addEventListener('input', (e) => {
        this._manualHP = parseInt(e.target.value) || 0;
      });
    }

    // Feat/knack selectors
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

    // Maneuver picker button
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

  static async rollHP(_event, _btn) {
    const dialog = AM.levelUpDialog;
    if (!dialog) return;

    const classes = LevelUpService.getActorClasses(dialog.actor);
    const cls = classes.find(c => c.id === dialog._selectedClassId) ?? classes[0];
    if (!cls) return;

    const roll = new Roll(`1d${cls.hitDie}`);
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
      const total  = roll.total + conMod;
      resultEl.textContent = `${roll.total} + ${conMod} CON = ${total} HP`;
    }
  }

  static async formHandler(_event, _form, formData) {
    const dialog = AM.levelUpDialog;
    if (!dialog) return;

    const classes    = LevelUpService.getActorClasses(dialog.actor);
    const cls        = classes.find(c => c.id === dialog._selectedClassId) ?? classes[0];
    if (!cls) return;

    // Calculate HP gained
    const conMod = dialog.#getConMod();
    let hpGained = 0;
    switch (dialog._hpMethod) {
      case 'average': hpGained = Math.ceil(cls.hitDie / 2) + 1 + conMod; break;
      case 'roll':    hpGained = (dialog._rolledHP ?? 1) + conMod; break;
      case 'max':     hpGained = cls.hitDie + conMod; break;
      case 'manual':  hpGained = dialog._manualHP ?? 0; break;
    }
    hpGained = Math.max(1, hpGained); // minimum 1 HP

    await LevelUpService.applyLevelUp(
      dialog.actor,
      cls.id,
      hpGained,
      dialog._featUuid,
      dialog._knackUuid
    );

    // Apply selected maneuvers
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
