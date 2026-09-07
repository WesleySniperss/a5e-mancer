/*
 * The module’s shared state, its constants and its logger.
 *
 * This lived in a5e-mancer.js, which is also the module’s entry point. All 32
 * files that use AM therefore imported from the entry point, and the entry
 * point imported them back: thirty-two import cycles, every one of them
 * resolved only by the order the files happened to be reached in.
 *
 * That held for as long as nothing needed another module’s value at the moment
 * its own body ran. Then the NPC sheet came to extend the character sheet, and
 * a class that extends something needs it initialised right there — which the
 * cycle could not promise. Loaded in module.json’s declared order it threw
 * "Cannot access 'A5eCharacterSheet' before initialization" before a single
 * hook ran.
 *
 * So AM lives here and imports nothing: the two modules it needs at run time
 * it imports inside the methods that need them. A leaf cannot be part of a
 * cycle. a5e-mancer.js re-exports it, so the old import path still resolves.
 */
export class AM {
  static ID   = 'a5e-mancer';
  static NAME = 'A5e Mancer';

  static documents         = {};
  static heritageGifts     = [];
  static equipmentData     = null;
  static creationManeuvers = null;
  static creationSpells    = null;
  static allManeuversData  = null;   // Map<tradition, Map<degree, maneuver[]>>
  static allSpellsData     = null;   // Map<level, spell[]>
  static maneuverDescMap   = new Map();
  static spellDescMap      = new Map();
  static maneuverFilter    = { tradition: null };
  static spellFilter       = { level: null, school: null };
  static hpChoice          = { method: 'max', value: 0 };
  // Six rolled scores waiting to be assigned to abilities (manual/roll method).
  // null = not rolled yet, so the tab shows the per-ability roll buttons instead.
  static rolledPool        = null;
  // Grants for the level being gained, asked in the level-up dialog
  static levelUpGrants     = null;
  // Grant picks made in our UI instead of a5e's window, keyed by item type
  // (heritage, culture, background, destiny). Each entry:
  // { absorb: bool, grants: [uiModel], features: [uiModel], choices: { grantId: key[] } }
  static itemGrants        = {};
  // Roll tables found in the destiny/background descriptions, and what was rolled.
  // { destiny: [table], background: [table] } and { 'destiny.0': 'text', … }
  // Mixed heritage: a5e lets you take your gift from a heritage other than the
  // one you chose, with the Narrator's approval. Only the gift — everything else
  // stays with the heritage itself. { enabled, sourceUuid, sourceName, giftUuid }
  static mixedHeritage     = { enabled: false, sourceUuid: '', sourceName: '', giftUuid: '' };
  // Spells a heritage/culture hands out in its text rather than through a grant
  // — a5e has no grant type for spells. { heritage: {name, rows:[{level,count}]} }
  static originSpells      = {};
  // The class's archetype, when the class picks one at 1st level (cleric's
  // Divine Domain and its like). { level, options: [{name,uuid,img}], uuid }
  static archetypes        = { level: 0, options: [], uuid: null };
  static loreTables        = {};
  static loreRolls         = {};
  static app               = null;
  static levelUpDialog     = null;

  static SELECTED = {
    heritage:    { value: '', id: '', uuid: '' },
    heritageGift:{ name: '', uuid: '' },
    culture:     { value: '', id: '', uuid: '' },
    background:  { value: '', id: '', uuid: '' },
    destiny:     { value: '', id: '', uuid: '' },
    class:       { value: '', id: '', uuid: '' }
  };

  static ABILITY_SCORES = { DEFAULT: 8, MIN: 8, MAX: 15 };
  static LOG_LEVEL      = 0;

  static init() {
    this.LOG_LEVEL = parseInt(game.settings.get(this.ID, 'loggingLevel') ?? 0);
    this.ABILITY_SCORES = {
      DEFAULT: game.settings.get(this.ID, 'abilityScoreDefault') || 8,
      MIN:     game.settings.get(this.ID, 'abilityScoreMin')     || 8,
      MAX:     game.settings.get(this.ID, 'abilityScoreMax')     || 15
    };
  }

  /**
   * True when the a5e system's own grant dialog is the authority on combat
   * traditions, maneuvers and spells — so our pickers must stay out of the way
   * or the character gets both sets of picks.
   */
  static get deferToSystemGrants() {
    try { return !!game.settings.get(this.ID, 'deferToSystemGrants'); }
    catch { return true; }
  }

  static log(level, ...args) {
    if (this.LOG_LEVEL === 0 || level > this.LOG_LEVEL) return;
    const p = `${this.ID} |`;
    if (level === 1) console.error(p, ...args);
    else if (level === 2) console.warn(p, ...args);
    else console.debug(p, ...args);
  }

  /* Imported where it is used rather than at the top of the file. AM is what
     every other module imports, so anything AM imports statically is imported
     by everything — which is how this file became the hub of thirty-two
     import cycles. */
  static async openLevelUp(actor) {
    const { LevelUpDialog } = await import('./app/LevelUpDialog.js');
    if (this.levelUpDialog) this.levelUpDialog.close();
    this.levelUpDialog = new LevelUpDialog(actor);
    this.levelUpDialog.render(true);
  }

  /**
   * Put back what a character's items are missing, from the compendium entries
   * they came from. Exposed here as well as on the sheet so it can be reached
   * from a5e's own sheet, a macro or the console — the stubs are not this
   * sheet's problem, they are the character's.
   */
  static async repairItems(actor, options = {}) {
    const { ItemRepair } = await import('./utils/itemRepair.js');
    return ItemRepair.run(actor, options);
  }
}
