import { AM } from './a5e-mancer.js';

export function registerSettings() {
  AM.log(3, 'Registering settings');

  // ---- Core ----
  game.settings.register(AM.ID, 'enable', {
    name: 'am.settings.enable.name',
    hint: 'am.settings.enable.hint',
    default: true, type: Boolean, scope: 'client', config: true, requiresReload: true
  });

  game.settings.register(AM.ID, 'loggingLevel', {
    name: 'am.settings.logger.name', hint: 'am.settings.logger.hint',
    scope: 'client', config: true, type: String,
    choices: { 0: 'am.settings.logger.off', 1: 'am.settings.logger.errors', 2: 'am.settings.logger.warnings', 3: 'am.settings.logger.verbose' },
    default: '2'
  });

  game.settings.register(AM.ID, 'enableNavigationButtons', {
    name: 'am.settings.nav-buttons.name', hint: 'am.settings.nav-buttons.hint',
    scope: 'world', config: true, type: Boolean, default: true
  });

  game.settings.register(AM.ID, 'enablePlayerCustomization', {
    name: 'am.settings.player-customization.name', hint: 'am.settings.player-customization.hint',
    scope: 'world', config: true, type: Boolean, default: true
  });

  game.settings.register(AM.ID, 'enableTokenCustomization', {
    name: 'am.settings.token-customization.name', hint: 'am.settings.token-customization.hint',
    scope: 'world', config: true, type: Boolean, default: false
  });

  game.settings.register(AM.ID, 'enableRandomize', {
    name: 'am.settings.randomize.name', hint: 'am.settings.randomize.hint',
    scope: 'world', config: true, type: Boolean, default: true
  });

  // ---- Ability scores ----
  game.settings.register(AM.ID, 'abilityScoreDefault', {
    name: 'am.settings.ability-scores.default.name', hint: 'am.settings.ability-scores.default.hint',
    scope: 'world', config: true, type: Number, default: 8
  });

  game.settings.register(AM.ID, 'abilityScoreMin', {
    name: 'am.settings.ability-scores.min.name', hint: 'am.settings.ability-scores.min.hint',
    scope: 'world', config: true, type: Number, default: 8
  });

  game.settings.register(AM.ID, 'abilityScoreMax', {
    name: 'am.settings.ability-scores.max.name', hint: 'am.settings.ability-scores.max.hint',
    scope: 'world', config: true, type: Number, default: 15
  });

  // ---- Dice rolling ----
  game.settings.register(AM.ID, 'diceRollingMethod', {
    scope: 'client', config: false, type: String, default: 'standardArray'
  });

  game.settings.register(AM.ID, 'allowedMethods', {
    scope: 'world', config: false, type: Object,
    default: { standardArray: true, pointBuy: true, manual: true }
  });

  game.settings.register(AM.ID, 'customRollFormula', {
    name: 'am.settings.roll-formula.name', hint: 'am.settings.roll-formula.hint',
    scope: 'world', config: true, type: String, default: '4d6kh3'
  });

  game.settings.register(AM.ID, 'customStandardArray', {
    scope: 'world', config: false, type: String, default: '15,14,13,12,10,8'
  });

  game.settings.register(AM.ID, 'pointBuyTotal', {
    name: 'am.settings.point-buy.name', hint: 'am.settings.point-buy.hint',
    scope: 'world', config: true, type: Number, default: 27
  });

  game.settings.register(AM.ID, 'chainedRolls', {
    name: 'am.settings.chained-rolls.name', hint: 'am.settings.chained-rolls.hint',
    scope: 'world', config: true, type: Boolean, default: false
  });

  // ---- Compendium packs (per document type) ----
  for (const type of ['heritage', 'culture', 'background', 'destiny', 'class']) {
    game.settings.register(AM.ID, `${type}Packs`, {
      scope: 'world', config: false, type: Array, default: []
    });
  }

  // ---- Biography options ----
  game.settings.register(AM.ID, 'alignments', {
    name: 'am.settings.alignments.name', hint: 'am.settings.alignments.hint',
    scope: 'world', config: true, type: String,
    default: 'Lawful Good,Neutral Good,Chaotic Good,Lawful Neutral,True Neutral,Chaotic Neutral,Lawful Evil,Neutral Evil,Chaotic Evil'
  });

  game.settings.register(AM.ID, 'enableAlignmentFaithInputs', {
    name: 'am.settings.alignment-faith-inputs.name', hint: 'am.settings.alignment-faith-inputs.hint',
    scope: 'world', config: true, type: Boolean, default: false
  });

  // ---- Saved character options ----
  game.settings.register(AM.ID, 'savedOptions', {
    scope: 'client', config: false, type: Object, default: {}
  });

  AM.log(3, 'Settings registered');
}
