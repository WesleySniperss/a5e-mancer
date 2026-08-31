import { AM } from './a5e-mancer.js';

export function registerSettings() {
  AM.log(3, 'Registering settings');

  // ---- Core ----
  game.settings.register(AM.ID, 'enable', {
    name: 'am.settings.enable.name',
    hint: 'am.settings.enable.hint',
    default: true, type: Boolean, scope: 'client', config: true, requiresReload: true
  });

  // One-time world migration marker: fill placeholder item icons with site icons
  game.settings.register(AM.ID, 'iconFillMigration', {
    scope: 'world', config: false, type: Number, default: 0
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

  // Client-scoped: the Beyond20 extension is installed per browser, so whether
  // the bridge is wanted is a per-user question, not a world setting.
  game.settings.register(AM.ID, 'enableBeyond20', {
    name: 'am.settings.beyond20.name', hint: 'am.settings.beyond20.hint',
    scope: 'client', config: true, type: Boolean, default: true, requiresReload: true
  });

  // Client-scoped to match Your Flavor itself: chat styling there is a per-user
  // choice, so whether a5e's cards join in is one too.
  game.settings.register(AM.ID, 'enableYourFlavor', {
    name: 'am.settings.your-flavor.name', hint: 'am.settings.your-flavor.hint',
    scope: 'client', config: true, type: Boolean, default: true, requiresReload: true
  });

  // Separate from the one above: this one is not about A5e at all. Foundry v14
  // dropped the #chat-log id that Your Flavor's own restyle pass looks for, so
  // on v14 nothing already in the log gets themed after a reload - for every
  // system. Kept switchable in case a future Your Flavor fixes it itself.
  game.settings.register(AM.ID, 'enableYourFlavorRestyle', {
    name: 'am.settings.your-flavor-restyle.name', hint: 'am.settings.your-flavor-restyle.hint',
    scope: 'client', config: true, type: Boolean, default: true, requiresReload: true
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

  // Pause between the six rolls when rolling the whole array at once (ms).
  game.settings.register(AM.ID, 'rollDelay', {
    scope: 'client', config: false, type: Number, default: 400
  });

  // The a5e system's own grant engine opens a selection dialog for combat
  // traditions, maneuvers and spells whenever a class item is added or its level
  // changes. Offering the same picks in our UI means the character ends up with
  // both sets. On (default) we step aside and let the system ask.
  game.settings.register(AM.ID, 'deferToSystemGrants', {
    name: 'am.settings.defer-grants.name', hint: 'am.settings.defer-grants.hint',
    scope: 'world', config: true, type: Boolean, default: true
  });

  // Since a5e's grant dialog is where the picks happen, make it a better place to
  // pick: enforce the trait allowance it states and show what each option is.
  // The a5e system ships 5e SRD conversions next to its own books (dnd5e-spells,
  // dnd5e-items, …). Reading both returned every converted spell twice.
  game.settings.register(AM.ID, 'includeDnd5ePacks', {
    name: 'am.settings.dnd5e-packs.name', hint: 'am.settings.dnd5e-packs.hint',
    scope: 'world', config: true, type: Boolean, default: false
  });

  // Magic maneuvers are homebrew, so the compendium is built on request rather
  // than appearing in every world that installs the module.
  game.settings.register(AM.ID, 'buildMagicManeuverPack', {
    name: 'am.settings.mm-pack.name', hint: 'am.settings.mm-pack.hint',
    scope: 'world', config: true, type: Boolean, default: true,
    onChange: () => {
      import('./utils/magicManeuverPack.js')
        .then(({ MagicManeuverPack }) => MagicManeuverPack.ensure({ force: true }))
        .catch(err => AM.log(1, 'Magic maneuver pack build failed:', err));
    }
  });

  // Which catalogue version the world's magic maneuver compendium was built
  // from. Hidden: it is bookkeeping, not a choice. It lives here rather than on
  // the pack because a compendium is a collection, not a document, and has no
  // flags of its own — writing one threw after the pack was already built.
  game.settings.register(AM.ID, 'magicManeuverPackVersion', {
    scope: 'world', config: false, type: Number, default: 0
  });

  game.settings.register(AM.ID, 'enhanceGrantDialog', {
    name: 'am.settings.enhance-grants.name', hint: 'am.settings.enhance-grants.hint',
    scope: 'world', config: true, type: Boolean, default: true
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
