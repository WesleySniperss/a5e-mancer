import { AM } from '../a5e-mancer.js';
import { LevelUpService } from '../utils/levelUpService.js';
import { DocumentService } from '../utils/documentService.js';
import { ManeuverService, CLASS_MANEUVER_TABLES, getTraditions } from '../utils/maneuverService.js';
import { SpellService, CLASS_SPELL_TABLES } from '../utils/spellService.js';
import { ItemDescPanel } from '../utils/itemDescPanel.js';
import { GrantAbsorber } from '../utils/grantAbsorber.js';
import { MagicManeuverService } from '../utils/magicManeuverService.js';
import { MagicManeuvers } from '../data/magicManeuvers.js';

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

    // Multiclass mode state
    this._newClassUuid      = null;
    this._newClassHitDie    = 8;
    this._compendiumClasses = null;

    // Shared maneuver/spell selection state
    this._selectedManeuverUuids = [];
    this._selectedTraditions    = [];
    this._selectedCantripUuids  = [];
    this._selectedSpellUuids    = [];

    // Items being swapped out this level. Each one frees a pick, and the item is
    // removed from the actor when the level-up is applied.
    this._replacedManeuverIds = [];
    this._replacedSpellIds    = [];

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
      luCancel:                  LevelUpDialog.luCancel,
      rollHP:                    LevelUpDialog.rollHP,
      luFilterManeuverTradition: LevelUpDialog.luFilterManeuverTradition,
      luToggleManeuver:          LevelUpDialog.luToggleManeuver,
      luFilterSpellLevel:        LevelUpDialog.luFilterSpellLevel,
      luFilterSpellSchool:       LevelUpDialog.luFilterSpellSchool,
      luToggleSpell:             LevelUpDialog.luToggleSpell,
      toggleGrantOption:         LevelUpDialog.luToggleGrantOption,
      luReplaceManeuver:         LevelUpDialog.luReplaceManeuver,
      luReplaceSpell:            LevelUpDialog.luReplaceSpell,
      luSelectArchetype:         LevelUpDialog.luSelectArchetype,
      luToggleMMSchool:          LevelUpDialog.luToggleMMSchool,
      luToggleMagicManeuver:     LevelUpDialog.luToggleMagicManeuver,
    },
    classes: ['am-app', 'am-levelup-dialog'],
    position: { width: 680, height: 760 },
    window: { icon: 'fa-solid fa-arrow-up', resizable: true, minimizable: false }
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
        deferHp:              this.#systemOwnsHp(),
        hpMethod:             this._hpMethod,
        avgHP,
        rolledHP:             this._rolledHP !== null ? this._rolledHP + this.#getConMod() : null,
        manualHP:             this._manualHP,
        conMod:               this.#getConMod(),
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
      // Multiclassing counts too — the table is keyed on character level, and the
      // new class may be the one that qualifies the character in the first place.
      this.#magicManeuverContext(context, newTotalLevel, newClass?.name ?? '');
      return context;
    }

    /* ── Level-up mode ───────────────────────────────────────────────── */
    const selectedClass = classes.find(c => c.id === this._selectedClassId) ?? classes[0];
    const newClassLevel = selectedClass ? selectedClass.level + 1 : 1;
    const newTotalLevel = total + 1;
    const info = selectedClass
      ? LevelUpService.getLevelUpInfo(selectedClass, newClassLevel, newTotalLevel)
      : { gainsASI: false, gainsKnack: false, avgHP: 5, hitDie: 8 };

    const avgHP       = info.avgHP + this.#getConMod();
    const maneuverInfo = this.#getManeuverInfo(selectedClass, newClassLevel, newTotalLevel);

    // The class's knack, features and ASI/feat are granted by a5e itself when the
    // level changes, so we only surface a heads-up that its dialog will appear.
    // It also asks for combat traditions (a 'trait' grant) — but NOT for maneuver
    // or spell items: a5e has no grant type that hands those out, which is why
    // both pickers below stay in this dialog.
    const grantsFeatures  = true;
    const classKey        = (selectedClass?.name ?? '').toLowerCase();
    const grantsTraditions = !!CLASS_MANEUVER_TABLES[classKey];

    const context = {
      actor:                this.actor,
      classes,
      mode:                 'levelup',
      selectedClass,
      newClassLevel,
      newTotalLevel,
      info,
      grantsFeatures,
      grantsTraditions,
      deferHp:              this.#systemOwnsHp(),
      hpMethod:             this._hpMethod,
      avgHP,
      rolledHP:             this._rolledHP !== null ? this._rolledHP + this.#getConMod() : null,
      manualHP:             this._manualHP,
      conMod:               this.#getConMod(),
      multiclass:           classes.length > 1,
      maneuverInfo,
      selectedManeuverCount: this._selectedManeuverUuids.length,
      selectedTraditions:    this._selectedTraditions,
      availableClasses: [],
      newClass: null,
    };

    this.#magicManeuverContext(context, newTotalLevel);
    this.#maneuverReplacementContext(context, selectedClass, newClassLevel);
    this.#spellReplacementContext(context, selectedClass, newClassLevel);

    // A known caster may swap a spell even on a level that grants none, so the
    // spell browser has to open whenever there is a replacement in play.
    if (context.spellReplaceLimit && !context.spellInfo) {
      const info = SpellService.getClassSpellInfo(selectedClass?.name ?? '');
      if (info) {
        context.spellInfo = { ...info, spellsKnown: this._replacedSpellIds.length };
        this.#addSpellBrowserContext(context, context.spellInfo);
      }
    }
    context.selectedCantripCount = this._selectedCantripUuids.length;
    context.selectedSpellCount   = this._selectedSpellUuids.length;

    this.#addManeuverBrowserContext(context, maneuverInfo);
    await this.#addLevelGrantContext(context, selectedClass, newClassLevel);
    return context;
  }

  /**
   * The grants this level brings — features, knack, ASI/feat — asked here so
   * a5e's window never opens. Only engages when every grant can be accounted
   * for; otherwise AM.levelUpGrants stays null and a5e handles it as before.
   */
  async #addLevelGrantContext(context, selectedClass, newLevel) {
    AM.levelUpGrants = null;
    if (!AM.deferToSystemGrants || !selectedClass) return;

    const classItem = this.actor.items.get(selectedClass.id);
    if (!classItem) return;

    try {
      // a5e gates 'character' grants on total level and the rest on class level,
      // so both have to be passed — not one number standing in for both.
      const lv = { charLevel: context.newTotalLevel, clsLevel: newLevel };

      if (!await GrantAbsorber.canAbsorb(classItem, lv)) {
        AM.log(3, `${classItem.name} level ${newLevel}: grants left to a5e`);
        return;
      }
      const store = {
        absorb:   true,
        level:    newLevel,
        lv,
        grants:   GrantAbsorber.describeForLevel(classItem, lv),
        features: await GrantAbsorber.describeFeaturesForLevel(classItem, lv),
        choices:  this._levelChoices ?? {}
      };
      // The per-level hit points a5e would have written, without CON — it adds
      // CON x level separately when deriving max HP.
      store.charLevel = context.newTotalLevel;
      store.hpValue   = Math.max(1, LevelUpDialog.#hpFor(this, selectedClass.hitDie, 0));

      // The archetype level. a5e asks for this at the end of its grant routine,
      // so suppressing that routine without asking here would let the level pass
      // with no archetype at all.
      const archLevel = LevelUpService.archetypeLevelOf(classItem);
      if (archLevel && newLevel === archLevel) {
        store.archetypeLevel = true;
        store.archetypes = await LevelUpService.getArchetypesForClass(classItem);
        store.archetypeUuid = this._archetypeUuid ?? null;

        context.archetypeChoices = store.archetypes.map(a => ({
          ...a, selected: a.uuid === store.archetypeUuid
        }));
        // Optional: playing without one is a legitimate choice, so this only
        // reads as unanswered until the player has said either way.
        context.archetypeUnset  = store.archetypes.length > 0
                                  && !store.archetypeUuid && !this._archetypeSkipped;
        context.archetypeSkipped = !!this._archetypeSkipped;
        context.archetypeName   = store.archetypes.find(a => a.uuid === store.archetypeUuid)?.name ?? '';
      }

      AM.levelUpGrants = store;
      this._levelChoices = store.choices;

      const withState = (g) => {
        const picked = store.choices[g.id] ?? [];
        return {
          ...g,
          grantType: 'levelup',
          options:   g.options.map(o => ({ ...o, selected: picked.includes(o.key) })),
          chosen:    picked.length,
          complete:  picked.length >= g.total
        };
      };
      context.bgGrants   = store.grants.map(withState);
      context.bgFeatures = store.features.map(withState)
        .filter(f => f.total > 0 || f.baseLabels.length);
      context.hasBgGrants = context.bgGrants.length > 0 || context.bgFeatures.length > 0;
    } catch (err) {
      AM.log(1, 'Could not read level-up grants — a5e will handle this level:', err);
      AM.levelUpGrants = null;
    }
  }

  /* ── Context helpers ─────────────────────────────────────────────────── */

  #addManeuverBrowserContext(context, maneuverInfo) {
    if (!maneuverInfo?.newManeuversToLearn) return;
    context.maneuversLoaded = !!this._allManeuversData;
    if (this._allManeuversData) {
      const actorTraditions = ManeuverService.getActorTraditions?.(this.actor) ?? [];
      const allUsed = [...new Set([...actorTraditions, ...this._selectedTraditions])];
      context.inlineTraditions      = LevelUpDialog.#buildTraditionPills(
        this._allManeuversData, allUsed, this._maneuverFilter.tradition,
        maneuverInfo.allowedTraditions, maneuverInfo.maxDegree);
      context.visibleManeuvers      = LevelUpDialog.#filterManeuvers(
        this._allManeuversData, maneuverInfo.maxDegree, this._maneuverFilter.tradition,
        this._selectedManeuverUuids, ManeuverService.getActorManeuverKeys(this.actor)
      );
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
      // Restrict to the caster's own spell list — a null class shows every spell
      // in every compendium, which is what made "all schools" available.
      const casterName = this._mode === 'multiclass'
        ? ((this._compendiumClasses ?? []).find(c => c.uuid === this._newClassUuid)?.name ?? '')
        : (LevelUpService.getActorClasses(this.actor)
             .find(c => c.id === this._selectedClassId)?.name ?? '');
      SpellService.loadSpells(casterName, spellInfo.maxLevel ?? 1).then(data => {
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
    const gained             = Math.max(0, info.maneuversKnown - prevInfo.maneuversKnown);
    const degreeUnlocked     = info.maxDegree > prevInfo.maxDegree ? info.maxDegree : null;

    // Each maneuver swapped out frees one pick on top of the level's gain. This
    // is what makes levels that grant nothing new still worth opening: the class
    // may still let one known maneuver be traded for another.
    const replaced = this._replacedManeuverIds.length;
    const newManeuversToLearn = gained + replaced;

    return {
      ...info,
      gained,
      newManeuversToLearn,
      degreeUnlocked,
      hasManeuvers: info.maneuversKnown > 0
    };
  }

  /**
   * Magic maneuvers owed at the new character level.
   *
   * The owed counts are entitlement minus what is held, not the difference
   * between two levels, so a character who missed a threshold is offered the
   * backlog rather than losing it.
   */
  #magicManeuverContext(context, newTotalLevel, incomingClass = '') {
    if (!MagicManeuverService.isEligible(this.actor, incomingClass)) return;

    const pending = MagicManeuverService.pendingAt(this.actor, newTotalLevel);
    if (!pending.schoolsOwed && !pending.maneuversOwed) return;

    // Schools first: a maneuver cannot be learned until its school is open, so
    // the picks made here feed the list below within the same dialog.
    const chosenSchools = this._mmSchools ?? [];
    const chosenIds     = this._mmManeuvers ?? [];
    const openNow       = [...pending.openSchools, ...chosenSchools];

    context.mmSchoolsOwed   = Math.max(0, pending.schoolsOwed - chosenSchools.length);
    context.mmManeuversOwed = Math.max(0, pending.maneuversOwed - chosenIds.length);
    context.mmMaxDegree     = pending.maxDegree;
    context.mmExertion      = MagicManeuverService.exertionPool(this.actor);
    context.mmSaveDC        = MagicManeuverService.saveDC(this.actor);

    context.mmSchools = MagicManeuverService.schoolOptions(this.actor, newTotalLevel)
      .map(s => ({
        ...s,
        open:      s.open || chosenSchools.includes(s.key),
        chosen:    chosenSchools.includes(s.key),
        available: s.available && context.mmSchoolsOwed > 0 && !chosenSchools.includes(s.key)
      }));

    context.mmGroups = MagicManeuverService
      .maneuverOptions(this.actor, newTotalLevel, chosenIds)
      .map(g => ({
        ...g,
        open: g.open || chosenSchools.includes(g.key),
        maneuvers: g.maneuvers.map(m => ({
          ...m,
          // Schools opened a moment ago count immediately
          canLearn: m.canLearn
            || (m.reason === 'school-not-open' && chosenSchools.includes(m.school)
                && m.degree <= pending.maxDegree && context.mmManeuversOwed > 0)
        }))
      }))
      .filter(g => g.open);

    context.hasMagicManeuvers = true;
  }

  /**
   * Known maneuvers offered for replacement, plus how many may still be swapped.
   * a5e allows one per class level gained.
   */
  #maneuverReplacementContext(context, cls, newClassLevel) {
    if (!cls || newClassLevel <= 1) return;
    const info = ManeuverService.getClassManeuverInfo(cls.name, newClassLevel);
    if (!info?.replaceable) return;

    const known = ManeuverService.getActorManeuvers(this.actor);
    if (!known.length) return;

    context.maneuverReplaceLimit = info.replaceable;
    context.maneuverReplaceUsed  = this._replacedManeuverIds.length;
    context.knownManeuverList = known.map(m => ({
      id: m.id, name: m.name, img: m.img,
      degree: m.degree, traditionLabel: m.traditionLabel,
      replaced: this._replacedManeuverIds.includes(m.id)
    }));
  }

  /** Known spells offered for replacement — known casters only. */
  #spellReplacementContext(context, cls, newClassLevel) {
    if (!cls || newClassLevel <= 1) return;
    const limit = SpellService.replaceableOnLevelUp(cls.name);
    if (!limit) return;

    const known = SpellService.getActorSpells(this.actor).filter(s => s.level > 0);
    if (!known.length) return;

    context.spellReplaceLimit = limit;
    context.spellReplaceUsed  = this._replacedSpellIds.length;
    context.knownSpellList = known.map(s => ({
      id: s.id, name: s.name, img: s.img, level: s.level,
      replaced: this._replacedSpellIds.includes(s.id)
    }));
  }

  #getConMod() {
    const con = this.actor.system?.abilities?.con?.value ?? 10;
    return Math.floor((con - 10) / 2);
  }

  /**
   * True when a5e owns the character's hit points, so asking here is pointless.
   *
   * With class HP automation on — the default for any actor that has a class item —
   * Actor#prepareHitPoints derives hp.max from the sum of each class item's
   * system.hp.levels plus CON x level. Writing hp.max/baseMax ourselves is
   * discarded on the next data prep; a5e's grant dialog sets the real value via
   * system.hp.levels.<charLevel>.
   */
  #systemOwnsHp() {
    if (!AM.deferToSystemGrants) return false;
    // When we absorb the level's grants, a5e's routine never runs, so the level's
    // hit points are ours to ask for and write.
    if (AM.levelUpGrants?.absorb) return false;
    return this.actor.classAutomationFlags?.hitPoints
           ?? (Object.keys(this.actor.classes ?? {}).length > 0);
  }

  #resetSelections() {
    this._selectedManeuverUuids = [];
    this._selectedTraditions    = [];
    this._selectedCantripUuids  = [];
    this._selectedSpellUuids    = [];
    this._replacedManeuverIds   = [];
    this._replacedSpellIds      = [];
    this._allManeuversData  = null;
    this._allSpellsData     = null;
    this._loadingManeuvers  = false;
    this._loadingSpells     = false;
    this._maneuverFilter    = { tradition: null };
    this._spellFilter       = { level: null, school: null };
    // Grant picks belong to one class at one level — switching either invalidates them
    this._levelChoices      = {};
    this._archetypeUuid     = null;
    this._archetypeSkipped  = false;
    this._mmSchools         = [];
    this._mmManeuvers       = [];
    AM.levelUpGrants        = null;
  }

  /* ── Private static browser helpers ─────────────────────────────────── */

  static #buildTraditionPills(allData, usedTraditions, activeTradition,
                              allowedTraditions = null, maxDegree = Infinity) {
    const reachable = (key) => {
      const tradMap = allData?.get(key);
      if (!tradMap) return 0;
      let n = 0;
      for (const [degree, arr] of tradMap) if (degree <= maxDegree) n += arr.length;
      return n;
    };

    return getTraditions()
      // Restrict to the traditions this class may choose from (null = any).
      .filter(t => !allowedTraditions || allowedTraditions.includes(t.key))
      // Drop traditions whose maneuvers all sit above the degree this level
      // allows — the pill opened an empty list.
      .filter(t => reachable(t.key) > 0)
      .map(t => ({
        key:    t.key,
        label:  t.label,
        active: t.key === activeTradition,
        used:   usedTraditions.includes(t.key),
      }));
  }

  static #filterManeuvers(allData, maxDegree, traditionFilter, selectedUuids, knownKeys = new Set()) {
    if (!allData || !traditionFilter) return [];
    const tradMap = allData.get(traditionFilter);
    if (!tradMap) return [];
    const result = [];
    for (const [degree, maneuvers] of tradMap) {
      if (degree > maxDegree) continue;
      for (const m of maneuvers) {
        result.push({
          ...m,
          isSelected:   selectedUuids.includes(m.uuid),
          alreadyKnown: ManeuverService.isKnown(knownKeys, m)
        });
      }
    }
    // Known ones sink to the bottom so the pickable ones are what you see first
    return result.sort((a, b) =>
      (a.alreadyKnown === b.alreadyKnown ? 0 : a.alreadyKnown ? 1 : -1)
      || a.degree - b.degree
      || a.name.localeCompare(b.name));
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
    /* ── Right-click a maneuver/spell card for its full text and costs ── */
    this._detachDescPanel?.();
    this._detachDescPanel = ItemDescPanel.attach(this.element);

    /* ── Mode toggle ── */
    this.element.querySelectorAll('.lu-mode-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const newMode = btn.dataset.mode;
        if (newMode === this._mode) return;
        this._mode      = newMode;
        this._rolledHP  = null;
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

    // Never let an already-known maneuver be picked again
    if (btn.dataset.known === 'true' || ManeuverService.getActorManeuverKeys(dialog.actor).has(uuid)) {
      ui.notifications.warn(game.i18n.localize('am.maneuvers.already-known'));
      return;
    }

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

  /**
   * Mark a known maneuver to be traded in. Each one frees a pick in the browser
   * above; unmarking it takes that pick back, dropping the newest selection if
   * the player had already spent it.
   */
  static luReplaceManeuver(_event, btn) {
    const dialog = AM.levelUpDialog;
    const id = btn?.dataset.itemId;
    if (!dialog || !id) return;

    const list = dialog._replacedManeuverIds;
    const at = list.indexOf(id);

    if (at >= 0) {
      list.splice(at, 1);
      // The freed pick is gone — give back the most recent maneuver chosen
      const cls = LevelUpService.getActorClasses(dialog.actor)
        .find(c => c.id === dialog._selectedClassId);
      const info = cls ? ManeuverService.getClassManeuverInfo(cls.name, cls.level + 1) : null;
      const prev = cls ? ManeuverService.getClassManeuverInfo(cls.name, cls.level) : null;
      const budget = Math.max(0, (info?.maneuversKnown ?? 0) - (prev?.maneuversKnown ?? 0)) + list.length;
      while (dialog._selectedManeuverUuids.length > budget) dialog._selectedManeuverUuids.pop();
    } else {
      const cls = LevelUpService.getActorClasses(dialog.actor)
        .find(c => c.id === dialog._selectedClassId);
      const limit = cls
        ? (ManeuverService.getClassManeuverInfo(cls.name, cls.level + 1)?.replaceable ?? 0)
        : 0;
      if (list.length >= limit) {
        ui.notifications.warn(game.i18n.format('am.levelup.replace-limit', { n: limit }));
        return;
      }
      list.push(id);
    }
    dialog.render(false);
  }

  /** Same for a known spell — known casters may trade one per level. */
  static luReplaceSpell(_event, btn) {
    const dialog = AM.levelUpDialog;
    const id = btn?.dataset.itemId;
    if (!dialog || !id) return;

    const list = dialog._replacedSpellIds;
    const at = list.indexOf(id);

    if (at >= 0) {
      list.splice(at, 1);
      while (dialog._selectedSpellUuids.length > list.length) dialog._selectedSpellUuids.pop();
    } else {
      const cls = LevelUpService.getActorClasses(dialog.actor)
        .find(c => c.id === dialog._selectedClassId);
      const limit = SpellService.replaceableOnLevelUp(cls?.name ?? '');
      if (list.length >= limit) {
        ui.notifications.warn(game.i18n.format('am.levelup.replace-limit', { n: limit }));
        return;
      }
      list.push(id);
    }
    dialog.render(false);
  }

  /**
   * Choose the class's archetype, at the level the class allows it — or
   * deliberately go without one, which A5e permits and some tables prefer.
   */
  static luSelectArchetype(_event, btn) {
    const dialog = AM.levelUpDialog;
    if (!dialog) return;

    if (btn?.dataset.skip !== undefined) {
      dialog._archetypeSkipped = !dialog._archetypeSkipped;
      if (dialog._archetypeSkipped) dialog._archetypeUuid = null;
    } else if (btn?.dataset.uuid) {
      dialog._archetypeUuid = dialog._archetypeUuid === btn.dataset.uuid ? null : btn.dataset.uuid;
      if (dialog._archetypeUuid) dialog._archetypeSkipped = false;
    } else {
      return;
    }
    dialog.render(false);
  }

  /** Open a school with one of this level's school slots. */
  static luToggleMMSchool(_event, btn) {
    const dialog = AM.levelUpDialog;
    const key = btn?.dataset.school;
    if (!dialog || !key) return;

    dialog._mmSchools ??= [];
    const at = dialog._mmSchools.indexOf(key);
    if (at >= 0) {
      dialog._mmSchools.splice(at, 1);
      // Maneuvers picked from that school are no longer legal
      const gone = new Set(MagicManeuvers.bySchool(key).map(m => m.id));
      dialog._mmManeuvers = (dialog._mmManeuvers ?? []).filter(id => !gone.has(id));
    } else {
      dialog._mmSchools.push(key);
    }
    dialog.render(false);
  }

  /** Learn one of this level's maneuvers. */
  static luToggleMagicManeuver(_event, btn) {
    const dialog = AM.levelUpDialog;
    const id = btn?.dataset.maneuverId;
    if (!dialog || !id) return;

    dialog._mmManeuvers ??= [];
    const at = dialog._mmManeuvers.indexOf(id);
    if (at >= 0) {
      dialog._mmManeuvers.splice(at, 1);
      dialog.render(false);
      return;
    }

    // Re-check against the rules rather than trusting the rendered button
    const level = LevelUpService.getTotalLevel(dialog.actor) + 1;
    const pending = MagicManeuverService.pendingAt(dialog.actor, level);
    if (dialog._mmManeuvers.length >= pending.maneuversOwed) {
      ui.notifications.warn(game.i18n.format('am.mm.no-slots', { n: pending.maneuversOwed }));
      return;
    }
    const check = MagicManeuvers.canLearn(MagicManeuvers.byId(id), {
      level,
      openSchools: [...pending.openSchools, ...(dialog._mmSchools ?? [])],
      knownIds:    [...pending.knownIds, ...dialog._mmManeuvers]
    });
    if (!check.ok) {
      ui.notifications.warn(game.i18n.localize(`am.mm.reason.${check.reason}`));
      return;
    }
    dialog._mmManeuvers.push(id);
    dialog.render(false);
  }

  /** Pick or unpick one option of this level's grants. */
  static luToggleGrantOption(_event, btn) {
    const dialog = AM.levelUpDialog;
    const store  = AM.levelUpGrants;
    if (!dialog || !store?.absorb) return;

    const grantId = btn.dataset.grantId;
    const key     = btn.dataset.key;
    if (!grantId || !key) return;

    const model = [...store.grants, ...store.features].find(g => g.id === grantId);
    if (!model) return;

    const picked = [...(store.choices[grantId] ?? [])];
    const at = picked.indexOf(key);
    if (at >= 0) {
      picked.splice(at, 1);
    } else {
      if (picked.length >= model.total) {
        ui.notifications.warn(game.i18n.format('am.grants.limit-reached', { n: model.total, label: model.label }));
        return;
      }
      picked.push(key);
    }
    store.choices[grantId] = picked;
    dialog._levelChoices = store.choices;
    dialog.render(false);
  }

  /* ── Static action: cancel ──────────────────────────────────────────── */

  /**
   * Close without applying anything. The button must be type="button": an invalid
   * type (the old type="cancel") is treated as "submit" by browsers and would run
   * the form handler — i.e. Cancel would actually apply the level-up.
   */
  static luCancel(_event, _btn) {
    const dialog = AM.levelUpDialog;
    AM.levelUpDialog = null;
    AM.levelUpGrants = null;   // nothing was applied; don't leak picks to the next run
    dialog?.close();
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

  async _preClose(options) {
    this._detachDescPanel?.();
    this._detachDescPanel = null;
    return super._preClose?.(options);
  }

  /** HP for one level from the chosen method. Only used when a5e isn't doing it. */
  static #hpFor(dialog, hitDie, conMod) {
    switch (dialog._hpMethod) {
      case 'roll':   return (dialog._rolledHP ?? 1) + conMod;
      case 'max':    return hitDie + conMod;
      case 'manual': return dialog._manualHP ?? 0;
      case 'average':
      default:       return Math.ceil(hitDie / 2) + 1 + conMod;
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

      // 0 = leave HP alone; a5e's grant dialog writes system.hp.levels itself
      const hpGained = dialog.#systemOwnsHp()
        ? 0
        : Math.max(1, LevelUpDialog.#hpFor(dialog, dialog._newClassHitDie, conMod));

      const success = await LevelUpService.applyMulticlass(
        dialog.actor, dialog._newClassUuid, hpGained
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
      if (dialog._mmSchools?.length || dialog._mmManeuvers?.length) {
        await MagicManeuverService.apply(dialog.actor, {
          schools:   dialog._mmSchools ?? [],
          maneuvers: dialog._mmManeuvers ?? []
        });
      }
      return;
    }

    /* ── Normal level-up submit ── */
    const classes = LevelUpService.getActorClasses(dialog.actor);
    const cls     = classes.find(c => c.id === dialog._selectedClassId) ?? classes[0];
    if (!cls) return;


    const hpGained = dialog.#systemOwnsHp()
      ? 0
      : Math.max(1, LevelUpDialog.#hpFor(dialog, cls.hitDie, conMod));

    await LevelUpService.applyLevelUp(
      dialog.actor, cls.id, hpGained
    );

    // Trade-ins go first, so the replacement never trips the duplicate check
    // against the item it is replacing.
    const traded = [...dialog._replacedManeuverIds, ...dialog._replacedSpellIds]
      .filter(id => dialog.actor.items.get(id));
    if (traded.length) {
      try {
        await dialog.actor.deleteEmbeddedDocuments('Item', traded);
        AM.log(3, `Replaced ${traded.length} known item(s) on level up`);
      } catch (err) {
        AM.log(1, 'Could not remove the replaced items:', err);
      }
    }

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

    // Magic maneuvers. Applied after the level so the entitlement is read at the
    // new level; the service validates the picks again rather than trusting them.
    if (dialog._mmSchools?.length || dialog._mmManeuvers?.length) {
      await MagicManeuverService.apply(dialog.actor, {
        schools:   dialog._mmSchools ?? [],
        maneuvers: dialog._mmManeuvers ?? []
      });
    }
  }
}
