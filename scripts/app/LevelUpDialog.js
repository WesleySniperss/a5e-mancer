import { AM } from '../am.js';
import { LevelUpService } from '../utils/levelUpService.js';
import { DocumentService } from '../utils/documentService.js';
import { ManeuverService, CLASS_MANEUVER_TABLES, getTraditions, traditionAllowed, isMagicSchool, traditionLoreHtml } from '../utils/maneuverService.js';
import { SpellService, CLASS_SPELL_TABLES } from '../utils/spellService.js';
import { ItemDescPanel } from '../utils/itemDescPanel.js';
import { GrantAbsorber } from '../utils/grantAbsorber.js';
import { ProficiencyLedger } from '../utils/proficiencyLedger.js';
import { MulticlassRules } from '../utils/multiclassRules.js';
import { LevelDownService } from '../utils/levelDownService.js';
import { LevelHistory } from '../utils/levelHistory.js';
import { PackFilter } from '../utils/packFilter.js';

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class LevelUpDialog extends HandlebarsApplicationMixin(ApplicationV2) {

  constructor(actor, options = {}) {
    super(options);
    this.actor = actor;

    /* Each window opens on the level being taken: the plan of the levels ahead
       closed, the levels had folded. Left open from the last window, the plan
       sat under every level-up after it - "very confusing" (2026-10-08). */
    AM.buildFuture = false;
    AM.buildPastCollapsed ??= true;

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
    // { uuid, value } — the multiclass proficiency preview for the chosen class
    this._mcProficiencies   = null;

    // Shared maneuver/spell selection state
    this._selectedManeuverUuids = [];
    this._selectedTraditions    = [];
    this._selectedManeuverTraditions = {};
    this._selectedCantripUuids  = [];
    this._selectedSpellUuids    = [];

    // Items being swapped out this level. Each one frees a pick, and the item is
    // removed from the actor when the level-up is applied.
    this._replacedManeuverIds = [];
    this._replacedSpellIds    = [];
    this._bonusSpellPicks     = {};
    this._bonusSpellChoices   = [];

    // Inline browser state
    this._maneuverFilter   = { combat: null, magic: null };
    this._spellFilter      = { level: null, school: null };
    this._allManeuversData = null;
    this._allSpellsData    = null;
    this._loadingManeuvers = false;
    this._loadingSpells    = false;

    // Level-down mode: which class, down to what, and the picks to remove with it
    this._downClassId = null;
    this._downTarget  = null;
    this._downKey     = null;     // the class:target the picks below were made for
    this._downRemove  = new Set();
    this._downBackup  = true;
    this._downPlan    = null;
    // Down to a character level instead of one class: from the level list
    this._downCharTarget = null;  // the character level to come down to
    this._downRebuild    = false; // and then take the levels again, one by one
    this._buildFocus     = null;  // the level the build overview was opened on
    this._buildScroll    = null;  // where to scroll once it is drawn: a level, 'future' or 'top'
    this._upTo           = null;  // level-up mode: keep going to this level

    /* A run of levels in progress - a rebuild from the level list, or "up to
       level N" - picks this level's class itself. See #continueQueue. */
    const queue = AM.levelQueue;
    if (queue?.actorId === actor.id) {
      const at = LevelUpService.getTotalLevel(actor) + 1;
      const step = queue.order?.find(o => o.charLevel === at) ?? null;
      const found = LevelUpDialog.#queueClass(actor, step, queue);
      if (found) this._selectedClassId = found;
      else if (step) {
        // The class this level went to is off the character now: taken again as a new class
        this._mode = 'multiclass';
        this._queueClassUuid = step.classUuid ?? null;
        this._queueClassName = step.className ?? null;
      }
    }
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
      luToggleBonusSpell:        LevelUpDialog.luToggleBonusSpell,
      toggleGrantOption:         LevelUpDialog.luToggleGrantOption,
      luToggleReplace:           LevelUpDialog.luToggleReplace,
      luReplaceManeuver:         LevelUpDialog.luReplaceManeuver,
      luReplaceSpell:            LevelUpDialog.luReplaceSpell,
      luSelectArchetype:         LevelUpDialog.luSelectArchetype,
      luSetAsiMode:              LevelUpDialog.luSetAsiMode,
      luSelectFeat:              LevelUpDialog.luSelectFeat,
      luToggleFeatEligible:      LevelUpDialog.luToggleFeatEligible,
      luToggleFeatMyClass:       LevelUpDialog.luToggleFeatMyClass,
      luToggleFeatUngated:       LevelUpDialog.luToggleFeatUngated,
      luFeatSort:                LevelUpDialog.luFeatSort,
      luFeatPage:                LevelUpDialog.luFeatPage,
      luDownToggle:              LevelUpDialog.luDownToggle,
      luApplyLevelDown:          LevelUpDialog.luApplyLevelDown,
      luShowLevel:               LevelUpDialog.luShowLevel,
      luShowBuild:               LevelUpDialog.luShowBuild,
      luToggleFuture:            LevelUpDialog.luToggleFuture,
      luTogglePast:              LevelUpDialog.luTogglePast,
      luResetPlan:               LevelUpDialog.luResetPlan,
      luLevelUpNow:              LevelUpDialog.luLevelUpNow,
      luShowNext:                LevelUpDialog.luShowNext,
      luRebuildFrom:             LevelUpDialog.luRebuildFrom,
      luRemoveAbove:             LevelUpDialog.luRemoveAbove,
      luStopQueue:               LevelUpDialog.luStopQueue,
    },
    classes: ['a5e-mancer-app', 'am-app', 'am-levelup-dialog'],
    position: { width: 880, height: 780 },
    window: { icon: 'fa-solid fa-arrow-up', resizable: true, minimizable: false }
  };

  static PARTS = {
    main: {
      template:   'modules/a5e-mancer/templates/level-up.hbs',
      scrollable: ['', '.am-description-panel']
    }
  };

  /**
   * Keep the dialog where the player left it.
   *
   * Every pick re-renders the one part, and this dialog scrolls on
   * `.window-content` — the window chrome, outside the part — so `scrollable`
   * cannot reach it. Replacing the part's contents collapses that container's
   * scrollHeight for an instant, the browser clamps scrollTop to 0, and the
   * dialog snaps back to the top on each click.
   */
  static #SCROLLERS = '.am-card-grid, .am-description-panel, .am-inline-description, .am-replace-list';

  _preSyncPartState(partId, newElement, priorElement, state) {
    super._preSyncPartState(partId, newElement, priorElement, state);
    state.amWindowScroll = this.element?.querySelector('.window-content')?.scrollTop ?? 0;
    // The inner grids scroll independently of the window — picking a spell reset
    // the grid to the top even when the window itself had not moved.
    state.amScroll = [...priorElement.querySelectorAll(LevelUpDialog.#SCROLLERS)]
      .map(el => el.scrollTop);
  }

  _syncPartState(partId, newElement, priorElement, state) {
    super._syncPartState(partId, newElement, priorElement, state);
    const top  = state.amWindowScroll;
    const tops = state.amScroll;
    if (!top && !tops?.some(Boolean)) return;
    // After layout, or the height being restored into does not exist yet
    requestAnimationFrame(() => {
      const content = this.element?.querySelector('.window-content');
      if (content && top) content.scrollTop = top;
      const els = this.element?.querySelectorAll(LevelUpDialog.#SCROLLERS) ?? [];
      els.forEach((el, i) => { if (tops?.[i]) el.scrollTop = tops[i]; });
    });
  }

  get title() {
    return game.i18n.format('am.levelup.title', { name: this.actor.name });
  }

  /**
   * Every mode's context, with the level list beside it: the character's
   * levels as Level Up Gateway's builder lists them, and the next one.
   */
  async _prepareContext(options) {
    const context = await this.#modeContext(options);
    const levels = LevelHistory.levels(this.actor);
    const total = levels.length;
    const viewing = this._mode === 'build' ? this._buildFocus : null;
    const downTo = this._mode === 'leveldown' && this._downCharTarget !== null ? this._downCharTarget : null;
    context.levelList = levels.map(l => ({
      ...l,
      label: `${LevelHistory.ordinal(l.classLevel)} ${l.className}`,
      active: l.charLevel === viewing,
      // On its way out in the level-down being previewed
      going: downTo !== null && l.charLevel > downTo
    }));
    context.levelNext = { charLevel: total + 1, active: ['levelup', 'multiclass'].includes(this._mode) };
    const queue = AM.levelQueue;
    if (queue?.actorId === this.actor.id && ['levelup', 'multiclass'].includes(this._mode)) {
      context.levelQueue = { at: total + 1, until: queue.until, rebuild: !!queue.rebuild };
      // The levels still to come in this run, under the one being taken
      const named = this.actor.items.get(queue.classId)?.name ?? '';
      context.levelQueued = [];
      for (let n = total + 2; n <= queue.until; n++) {
        const step = queue.order?.find(o => o.charLevel === n);
        context.levelQueued.push({ charLevel: n, label: step?.className ?? named });
      }
    }
    return context;
  }

  async #modeContext(_options) {
    const classes = LevelUpService.getActorClasses(this.actor);
    const total   = LevelUpService.getTotalLevel(this.actor);

    if (!this._selectedClassId && classes.length) {
      this._selectedClassId = classes[0].id;
    }

    if (this._mode === 'leveldown') return this.#levelDownContext(classes);
    if (this._mode === 'build') return this.#buildContext(classes);

    /* ── Multiclass mode ─────────────────────────────────────────────── */
    if (this._mode === 'multiclass') {
      if (!this._compendiumClasses) {
        this._compendiumClasses = await LevelUpService.getCompendiumClasses();
      }

      const existingNames = new Set(classes.map(c => c.name.toLowerCase()));
      const availableClasses = this._compendiumClasses
        .filter(c => !existingNames.has(c.name.toLowerCase()))
        .map(c => ({ ...c, prereqs: LevelUpService.checkPrerequisites(this.actor, c.name) }));

      if ((this._queueClassUuid || this._queueClassName) && !this._newClassUuid) {
        const want = this._queueClassUuid ? PackFilter.normalizeSource(this._queueClassUuid) : null;
        this._newClassUuid = (want && availableClasses.find(c => PackFilter.normalizeSource(c.uuid) === want)?.uuid)
          || availableClasses.find(c => c.name === this._queueClassName)?.uuid
          || null;
        this._queueClassUuid = this._queueClassName = null;
      }
      const newClass = this._newClassUuid
        ? (availableClasses.find(c => c.uuid === this._newClassUuid) ?? null)
        : null;

      if (newClass) this._newClassHitDie = newClass.hitDie;

      const newTotalLevel = total + 1;
      const maneuverInfo = newClass
        ? await this.#getManeuverInfo(null, 1, { newClass: { name: newClass.name } })
        : null;
      const spellInfo = newClass
        ? (CLASS_SPELL_TABLES[newClass.name.toLowerCase()] ?? await SpellService.loadClassSpellInfo(newClass.uuid))
        : null;
      const avgHP = Math.ceil((newClass?.hitDie ?? 8) / 2) + 1 + this.#getConMod();

      // "Take levels up to", from the new class's 1st level on - see the level-up page
      if (!(this._upTo > newTotalLevel)) this._upTo = newTotalLevel;
      const upToOptions = [];
      if (newClass && (!AM.levelQueue || AM.levelQueue.actorId !== this.actor.id)) {
        for (let n = newTotalLevel; n <= 20; n++) upToOptions.push({ value: n, selected: n === this._upTo, only: n === newTotalLevel });
      }
      const upToPathList = upToOptions.length ? this.#upToPath(newTotalLevel, newClass.uuid) : [];

      const context = {
        actor:                this.actor,
        classes,
        mode:                 'multiclass',
        availableClasses,
        newClass,
        newTotalLevel,
        upToOptions,
        upToNote:             LevelUpDialog.#upToNote(newTotalLevel, this._upTo, upToPathList),
        upToPath:             JSON.stringify(upToPathList),
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
        // A second class owes less than a first one; say so before the player
        // commits, since a5e's own window afterwards shows only what is left.
        mcProficiencies: await this.#multiclassProficiencies(newClass),
      };

      this.#addManeuverBrowserContext(context, maneuverInfo);
      this.#addSpellBrowserContext(context, spellInfo);
      /* The new class's grants, asked here as at any other level - trimmed to
         a second class's share first. Without this a5e's window opened for
         every new class and this page offered nothing to pick. */
      if (newClass) {
        await this.#addLevelGrantContext(context, null, 1, { multiclass: newClass });
        await this.#addBonusSpellContext(context, { id: `mc:${newClass.uuid}`, name: newClass.name }, 1, newTotalLevel);
      } else {
        AM.levelUpGrants = null;
      }
      const cards = this.#levelCards();
      const showAhead = !!AM.buildFuture && !!newClass && newTotalLevel < 20;
      let ahead = null;
      if (showAhead) {
        const counters = new Map(classes.map(c => [c.id, c.level]));
        counters.set(newClass.uuid, 1);                          // its 1st level, being taken
        ahead = await this.#aheadCards({ from: newTotalLevel + 1, counters, defaultKey: newClass.uuid });
      }
      context.levelCards = {
        past: cards.past, reading: cards.reading, collapsed: !!AM.buildPastCollapsed,
        ahead: ahead?.cards ?? [], planOptions: ahead?.options ?? null, planned: !!ahead?.planned,
        showFuture: showAhead, loading: !!ahead?.loading, atCap: newTotalLevel >= 20,
        noAhead: !newClass
      };
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
    // The slowest read of the window, started first so the steps below run beside it
    this.#warmGrantTree(selectedClass, newClassLevel, newTotalLevel);
    const maneuverInfo = await this.#getManeuverInfo(selectedClass, newClassLevel);

    // The class's knack, features and ASI/feat are granted by a5e itself when the
    // level changes, so we only surface a heads-up that its dialog will appear.
    // It also asks for combat traditions (a 'trait' grant) — but NOT for maneuver
    // or spell items: a5e has no grant type that hands those out, which is why
    // both pickers below stay in this dialog.
    const grantsFeatures  = true;
    const classKey        = (selectedClass?.name ?? '').toLowerCase();
    const grantsTraditions = !!CLASS_MANEUVER_TABLES[classKey];

    /* "Take levels up to": the levels this run can still reach, this one
       first - "just this one". Asked 2026-10-03 "what is the point of
       picking a level here?": the tooltip was the only place that said, so
       the line under it now says what the pick will do. */
    if (!(this._upTo > newTotalLevel)) this._upTo = newTotalLevel;
    const upToOptions = [];
    if (!AM.levelQueue || AM.levelQueue.actorId !== this.actor.id) {
      for (let n = newTotalLevel; n <= 20; n++) upToOptions.push({ value: n, selected: n === this._upTo, only: n === newTotalLevel });
    }
    const upToPathList = upToOptions.length ? this.#upToPath(newTotalLevel, selectedClass?.id) : [];
    const upToNote = LevelUpDialog.#upToNote(newTotalLevel, this._upTo, upToPathList);
    const upToPath = JSON.stringify(upToPathList);

    const context = {
      actor:                this.actor,
      classes,
      mode:                 'levelup',
      selectedClass,
      newClassLevel,
      newTotalLevel,
      upToOptions,
      upToNote,
      upToPath,
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

    this.#maneuverReplacementContext(context, selectedClass, newClassLevel);
    // Rebuilt below for the class now selected; a class with no spells must not
    // inherit the quota of the one selected before it.
    this._spellInfo = null;
    this._spellCasting = null;

    // A caster gets the spell browser on every level-up, not only when a swap is
    // in play. It used to open solely off spellReplaceLimit, so a wizard gaining
    // a level had nowhere to learn anything — the one thing levelling a caster is
    // mostly for.
    //
    // The count is left open rather than quota'd: a5e ships no spells-known-per-
    // level table, and inventing one would be worse than trusting the player,
    // which is what the sheet's Manage Spells already does.
    let classInfo = null;
    if (!context.spellInfo) {
      /* The static table, then the class item - not getClassSpellInfo, whose
         fallback is whatever class was looked up last. For a class that casts
         nothing that fallback was usually another class's info, so a rogue
         could open a spell section with a witch's numbers and an empty list. */
      classInfo = CLASS_SPELL_TABLES[(selectedClass?.name ?? '').toLowerCase()] ?? null;

      // A caster the tables do not name got no spell section at all, because
      // this whole block is gated on `info`. CLASS_SPELL_TABLES lists eight
      // classes; the compendium here holds thirty, among them the witch, the
      // elementalist, the psion, the wielder and the esper. Creation already
      // falls back to reading `casterType` off the class item — level-up never
      // did, so those classes levelled with nowhere to learn anything.
      //
      // Asking the item is not a guess: the class states its own caster type.
      // `requireSpellsAtFirst: false` because the level-1 rule that suppresses
      // a half caster's tab at creation must not suppress it at 5th.
      if (!classInfo && selectedClass?.id) {
        const item = this.actor.items.get(selectedClass.id);
        if (item) {
          classInfo = await SpellService.loadClassSpellInfo(item.uuid, { requireSpellsAtFirst: false });
          if (classInfo) AM.log(3, `${selectedClass.name}: spell info read from the class item`);
        }
      }
    }

    /* A class with no magic of its own can still be given some by its
       archetype - a5e's tertiary casters. Owned, or picked in this dialog at
       the level that brings it. */
    const casting = (!context.spellInfo && !classInfo)
      ? await this.#archetypeCasting(selectedClass, newClassLevel)
      : null;

    // The swap is the class's rule, or the archetype's - and nothing for a class
    // that casts neither way, whatever a stray table said.
    this.#spellReplacementContext(context, selectedClass, newClassLevel,
      casting ? ((casting.replaceable && newClassLevel > casting.fromLevel) ? 1 : 0)
              : (classInfo ? SpellService.replaceableOnLevelUp(selectedClass?.name ?? '') : 0));

    if (!context.spellInfo) {
      if (classInfo) {
        // What this level actually brings. a5e ships no spells-known table, so
        // it comes from SpellService.SPELLS_KNOWN; a class that learns nothing
        // at level-up (a cleric or druid prepares from the whole list) gets an
        // open count rather than an invented quota.
        const owed = SpellService.newAtLevel(selectedClass?.name ?? '', newClassLevel);
        context.spellInfo = {
          ...classInfo,
          maxLevel:    SpellService.maxSpellLevelFor?.(selectedClass?.name ?? '', newClassLevel) ?? classInfo.maxLevel,
          spellsKnown: LevelUpDialog.#spellsOwed(this, selectedClass?.name ?? '', newClassLevel, owed),
          cantrips:    owed?.cantrips ?? -1,
          // What a prepared caster can actually hold at this level, from the
          // class rules. Shown instead of an open count, so "how many do I get"
          // has an answer for a cleric too.
          prepared:    SpellService.preparedCount(this.actor, selectedClass?.name ?? '', newClassLevel)
        };
        context.spellFreeform = !context.spellReplaceLimit;
        // Kept for the click handlers, so what they enforce is what is shown
        this._spellInfo = context.spellInfo;
        this.#addSpellBrowserContext(context, context.spellInfo);
      } else if (casting) {
        /* The archetype's own table: what this level adds to its Cantrips
           Known and Spells Known, its slot columns for the highest level, and
           a picker limited to its list or its schools. */
        const n = newClassLevel;
        /* No Spells Known column: the sentence's number at the level the
           feature arrives, and an open count after it (-1) rather than a guess. */
        const spells = casting.known
          ? Math.max(0, (casting.known[n] ?? 0) - (casting.known[n - 1] ?? 0))
          : (n === casting.fromLevel && casting.firstSpells ? casting.firstSpells : -1);
        const owed = {
          cantrips: Math.max(0, (casting.cantrips?.[n] ?? 0) - (casting.cantrips?.[n - 1] ?? 0)),
          spells
        };
        context.spellInfo = {
          type:        'known',
          cantrips:    owed.cantrips,
          spellsKnown: LevelUpDialog.#spellsOwed(this, selectedClass?.name ?? '', n, owed),
          maxLevel:    casting.slotMax?.[n] || 1,
          prepared:    null,
          archetype:   casting.archetype
        };
        context.spellFreeform = !context.spellReplaceLimit;
        this._spellInfo = context.spellInfo;
        this._spellCasting = casting;
        this.#addSpellBrowserContext(context, context.spellInfo);
      }
    }

    /* No section, nothing to pick: an archetype deselected, or switched for one
       that casts nothing, must not leave its picks behind to be applied. */
    if (!context.spellInfo) {
      this._selectedCantripUuids = [];
      this._selectedSpellUuids   = [];
      this._spellsSource         = null;
    }
    context.selectedCantripCount = this._selectedCantripUuids.length;
    context.selectedSpellCount   = this._selectedSpellUuids.length;

    this.#addManeuverBrowserContext(context, maneuverInfo);
    await this.#addLevelGrantContext(context, selectedClass, newClassLevel);
    await this.#addBonusSpellContext(context, selectedClass, newClassLevel, newTotalLevel);

    /* The levels the character has, above the one being taken, and the levels
       ahead under it on a button. What this level brings is that class's own
       entry for it, shown even when a5e will be the one to ask the choices. */
    const showAhead = !!AM.buildFuture && newTotalLevel < 20 && !!selectedClass;
    const cards = this.#levelCards();
    let ahead = null;
    if (showAhead) {
      const counters = new Map(classes.map(c => [c.id, c.level]));
      counters.set(selectedClass.id, newClassLevel);            // the level being taken
      ahead = await this.#aheadCards({ from: newTotalLevel + 1, counters, defaultKey: selectedClass.id });
    }
    context.levelCards = {
      past: cards.past,
      ahead: ahead?.cards ?? [],
      planOptions: ahead?.options ?? null,
      planned: !!ahead?.planned,
      reading: cards.reading,
      showFuture: showAhead,
      loading: !!ahead?.loading,
      collapsed: !!AM.buildPastCollapsed,
      atCap: newTotalLevel >= 20
    };
    context.newLevelPlan = cards.plans.get(selectedClass?.id)?.find(x => x.classLevel === newClassLevel) ?? null;
    return context;
  }

  /**
   * Level-down mode: what goes with the levels taken off, and the picks to
   * keep or remove. Two ways in:
   *   - the Lower Level button: one class, down to a level picked here;
   *   - the level list: the character down to a character level, every class
   *     with a level above it lowered - "remove the levels above this one", or
   *     a rebuild, which then takes those levels again one by one.
   * What a5e removes by itself is listed; the picks it knows nothing about -
   * maneuvers, spells, a feat taken for an ASI - are rows to keep or remove,
   * the plan's suggestion ticked. See LevelDownService.
   */
  async #levelDownContext(classes) {
    const base = { actor: this.actor, classes, mode: 'leveldown', multiclass: classes.length > 1 };
    const L = (k, data) => (data ? game.i18n.format(`am.leveldown.${k}`, data) : game.i18n.localize(`am.leveldown.${k}`));
    const byLevel = this._downCharTarget !== null;
    const plans = [];
    const targets = [];

    if (byLevel) {
      const at = LevelHistory.classLevelsAt(this.actor, this._downCharTarget);
      for (const c of classes) {
        const t = at.get(c.id) ?? 0;
        if (t >= c.level) continue;
        const plan = await LevelDownService.plan(this.actor, c.id, t);
        if (plan) plans.push(plan);
      }
    } else {
      if (!this._downClassId || !classes.some(c => c.id === this._downClassId)) {
        // The highest class: the one a level-down most likely means
        this._downClassId = [...classes].sort((a, b) => b.level - a.level)[0]?.id ?? null;
      }
      const cls = classes.find(c => c.id === this._downClassId);
      const minTarget = classes.length > 1 ? 0 : 1;
      if (cls && cls.level > minTarget) {
        if (this._downTarget === null || this._downTarget >= cls.level || this._downTarget < minTarget) {
          this._downTarget = cls.level - 1;
        }
        const plan = await LevelDownService.plan(this.actor, cls.id, this._downTarget);
        if (plan) plans.push(plan);
        for (let n = cls.level - 1; n >= minTarget; n--) {
          targets.push({ value: n, label: n === 0 ? L('remove-class') : L('level-n', { n }), selected: n === plan?.target });
        }
      }
    }
    this._downPlans = plans;
    this._downPlan = plans[0] ?? null;
    if (!plans.length) return { ...base, down: null, downNothing: true };

    // Picks across every plan, each item once: two caster classes see the same book
    const groupsOf = (p) => [...(p.picks.maneuvers ?? []), ...(p.picks.spells ?? []), p.picks.feats].filter(Boolean);
    const key = (byLevel ? `L${this._downCharTarget}:` : '') + plans.map(p => `${p.classId}:${p.target}`).join('|');
    if (this._downKey !== key) {
      this._downKey = key;
      this._downRemove = new Set(plans.flatMap(p => groupsOf(p).flatMap(g => g.selected)));
    }
    // A forced one goes whatever was clicked
    for (const p of plans) for (const g of groupsOf(p)) for (const id of g.forced) this._downRemove.add(id);

    const shown = new Set();
    const groups = [];
    for (const p of plans) {
      for (const g of groupsOf(p)) {
        const items = g.items.filter(i => !shown.has(i.id));
        items.forEach(i => shown.add(i.id));
        if (!items.length) continue;
        const removing = items.filter(i => this._downRemove.has(i.id)).length;
        // One line: the count, what the levels gave of it, what is now out of reach
        const notes = [];
        if (g.allowed !== null && g.allowed !== undefined) notes.push(L('known-at', { have: g.total, n: g.allowed, level: p.target }));
        if (g.gave) notes.push(L('levels-gave', { n: g.gave }));
        if (Number.isFinite(g.maxDegree)) notes.push(L('max-degree', { n: g.maxDegree }));
        if (Number.isFinite(g.maxLevel) && g.key !== 'cantrips') notes.push(L('max-spell-level', { n: g.maxLevel }));
        if (g.key === 'feats' && g.asiLost) notes.push(L('asi-lost', { n: g.asiLost }));
        groups.push({
          key: g.key,
          title: plans.length > 1 ? `${L(`group-${g.key}`)} · ${p.className}` : L(`group-${g.key}`),
          note: notes.join(' '),
          removing,
          // Fewer marked than the levels gave: the badge says so, nothing blocks it
          short: Number.isFinite(g.gave) && removing < g.gave,
          items: items.map(i => ({ ...i, removing: this._downRemove.has(i.id) }))
        });
      }
    }

    const first = plans[0];
    const charBefore = first.charBefore;
    const charAfter = byLevel ? this._downCharTarget : first.charAfter;
    const hpBefore = first.hp.before;
    const hpAfter = Math.max(1, hpBefore - plans.reduce((n, p) => n + p.hp.loss, 0));
    let submit;
    if (byLevel && this._downRebuild) submit = L('submit-rebuild', { n: charAfter + 1 });
    else if (byLevel) submit = L('submit-above', { n: charAfter });
    else submit = first.removesClass ? L('submit-remove', { cls: first.className }) : L('submit-lower', { n: first.target });

    return {
      ...base,
      down: {
        byLevel,
        rebuild: byLevel && this._downRebuild,
        charTarget: this._downCharTarget,
        rebuildFrom: charAfter + 1,
        charBefore, charAfter,
        // single-class mode: its pickers
        className: first.className, current: first.current, target: first.target,
        removesClass: first.removesClass,
        classes: classes.map(c => ({ id: c.id, name: c.name, level: c.level, selected: c.id === first.classId })),
        targets,
        sections: plans.map(p => ({
          classId: p.classId, className: p.className, current: p.current, target: p.target,
          removesClass: p.removesClass, features: p.features, benefits: p.benefits,
          guardArchetype: p.guardArchetype, archetype: p.archetype,
          empty: !p.features.length && !p.benefits.length
        })),
        groups,
        backup: this._downBackup,
        hp: { before: hpBefore, after: hpAfter },
        hpDrop: hpBefore !== hpAfter,
        submit
      }
    };
  }

  /**
   * The whole build, as D&D Beyond lists a class's levels: every level the
   * character has and what it gave, all at once - the page it replaces took a
   * click for every level - and, at the press of the button under them, the
   * levels still ahead with the features and choices they will bring, to plan
   * the build or just to see what is coming (asked 2026-10-03). The levels
   * ahead are read from the compendium the first time, in the background;
   * the window does not wait for them.
   */
  async #buildContext(classes) {
    const total = LevelHistory.levels(this.actor).length;
    const showFuture = !!AM.buildFuture && total < 20 && classes.length > 0;
    const cards = this.#levelCards();
    const ahead = showFuture
      ? await this.#aheadCards({
          from: total + 1,
          counters: new Map(classes.map(c => [c.id, c.level])),
          defaultKey: [...classes].sort((x, y) => y.level - x.level)[0].id,
          nextButton: true })
      : null;
    return {
      actor: this.actor, classes, mode: 'build', multiclass: classes.length > 1,
      build: {
        levels: [...cards.past.map(p => ({ ...p, focus: p.charLevel === this._buildFocus })), ...(ahead?.cards ?? [])],
        planOptions: ahead?.options ?? null,
        planned: !!ahead?.planned,
        showFuture,
        reading: cards.reading,
        loading: !!ahead?.loading,
        atCap: total >= 20
      }
    };
  }

  /**
   * The levels the character has, each from its class's definition and the
   * records (LevelHistory.mergeLevel). Shared by the build page and the
   * level-up page, which shows them above the level being taken (asked
   * 2026-10-03: "the level-up shows only the hit points"). Until a class's
   * definition is read the records alone are shown.
   */
  #levelCards() {
    const levels = LevelHistory.levels(this.actor);
    const total = levels.length;
    const owned = LevelHistory.ownedKeys(this.actor);
    const plans = new Map();
    let reading = false;
    for (const id of new Set(levels.map(l => l.classId))) {
      const plan = this.#planOf(id, total);
      if (plan) plans.set(id, plan);
      else reading = true;
    }
    const past = levels.map(l => {
      const def = plans.get(l.classId)?.find(x => x.classLevel === l.classLevel) ?? null;
      const m = LevelHistory.mergeLevel(LevelHistory.summary(this.actor, l.charLevel), def, owned);
      return {
        ...m,
        features: m.gained,
        canRebuild: !m.isFirst,
        canRemoveAbove: !m.isLast,
        empty: !m.gained.length && !m.origins.length && !m.picks.length && !m.benefits.length
               && !(m.choices ?? []).length && !(m.notes ?? []).length
      };
    });
    return { past, plans, total, reading };
  }

  /* ── Planning the levels ahead ──────────────────────────────────────── */

  /**
   * The class planned for each level ahead, per character: character level
   * -> a class item id, or a compendium class's uuid for a class not taken
   * yet. Asked 2026-10-03 for multiclass planning: "let me choose which
   * class a level goes to, not only the one being levelled". Kept for the
   * session; nothing is written to the character.
   */
  static #buildPlans = new Map();

  #plan() {
    const all = LevelUpDialog.#buildPlans;
    if (!all.has(this.actor.id)) all.set(this.actor.id, new Map());
    return all.get(this.actor.id);
  }

  /** A planned compendium class the character has taken since, as its class item. */
  #resolveKey(key) {
    if (!String(key ?? '').startsWith('Compendium.')) return key;
    const want = PackFilter.normalizeSource(key);
    const name = this.#className(key);
    const owned = this.actor.items.find(i => i.type === 'class'
      && (PackFilter.normalizeSource(i._stats?.compendiumSource ?? i.flags?.core?.sourceId ?? '') === want
          || (name && i.name === name)));
    return owned?.id ?? key;
  }

  /**
   * The levels ahead, each going to the class planned for it. A level with
   * nothing planned follows the one before it, so picking a class for one
   * level sends the rest of the way that class too, and a few picks make a
   * mixed build: 5th Gambler, 6th to 8th Illrigger. Each class counts its own
   * levels; a new class starts at its 1st, with its multiclass prerequisite
   * checked there.
   *
   * @param {object} o
   * @param {number} o.from              the first character level ahead
   * @param {Map<string, number>} o.counters  each class's level before `from`
   * @param {string} o.defaultKey        where the first level goes when nothing is planned
   * @param {boolean} [o.nextButton]     the first card offers to level up now (build page)
   */
  /** A planned class's name: the character's class, or the compendium's (its index entry). */
  #className(key) {
    const fresh = String(key ?? '').startsWith('Compendium.');
    if (!fresh) return this.actor.items.get(key)?.name ?? '?';
    const listed = (this._compendiumClasses ?? []).find(c => c.uuid === key)?.name;
    if (listed) return listed;
    try { return fromUuidSync(key)?.name ?? '?'; } catch { return '?'; }
  }

  /**
   * The class each level from `from` to `to` goes to: the one picked for it
   * in the plan, else the one before it, starting from `defaultKey`.
   */
  #planKeys({ from, to, defaultKey }) {
    const plan = this.#plan();
    const valid = (key) => !!key && (String(key).startsWith('Compendium.') || !!this.actor.items.get(key));
    const start = this.#resolveKey(defaultKey);
    const keys = [];
    let prev = start;
    for (let L = from; L <= to; L++) {
      let key = this.#resolveKey(plan.get(L) ?? prev);
      if (!valid(key)) key = start;                    // a class removed since it was planned
      keys.push({ L, key, planned: plan.has(L) });
      prev = key;
    }
    return keys;
  }

  /**
   * The same levels as steps of a run (AM.levelQueue.order), as the rebuild
   * writes them: a class of the character's by its id, a class not taken yet
   * by its compendium uuid - the run opens Add New Class with it picked.
   */
  #planSteps(o) {
    return this.#planKeys(o).map(({ L, key }) => {
      const fresh = String(key).startsWith('Compendium.');
      const item = fresh ? null : this.actor.items.get(key);
      return {
        charLevel: L,
        classId: fresh ? null : key,
        classUuid: fresh ? key : (item?._stats?.compendiumSource ?? item?.flags?.core?.sourceId ?? null),
        className: this.#className(key)
      };
    });
  }

  async #aheadCards({ from, counters, defaultKey, nextButton = false }) {
    if (!this._compendiumClasses) {
      try { this._compendiumClasses = await LevelUpService.getCompendiumClasses(); }
      catch { this._compendiumClasses = []; }
    }
    const total = LevelHistory.levels(this.actor).length;
    const plan = this.#plan();
    const owned = this.actor.items.filter(i => i.type === 'class');
    const ownedNames = new Set(owned.map(c => c.name.toLowerCase()));
    const nameOf = (key) => this.#className(key);
    const options = {
      owned: owned.map(c => ({ key: c.id, name: c.name })),
      fresh: this._compendiumClasses.filter(c => !ownedNames.has(c.name.toLowerCase()))
        .map(c => ({ key: c.uuid, name: c.name, meets: LevelUpService.checkPrerequisites(this.actor, c.name).meets }))
    };
    const level = new Map(counters);
    const cards = [];
    let loading = false;
    for (const { L, key, planned } of this.#planKeys({ from, to: 20, defaultKey })) {
      const n = (level.get(key) ?? 0) + 1;
      level.set(key, n);
      const levels = this.#planOf(key, total);
      if (!levels) loading = true;
      const def = levels?.find(x => x.classLevel === n) ?? null;
      const fresh = String(key).startsWith('Compendium.');
      const prereq = fresh && n === 1 ? LevelUpService.checkPrerequisites(this.actor, nameOf(key)) : null;
      cards.push({
        features: def?.features ?? [],
        choices: def?.choices ?? [],
        benefits: (def?.benefits ?? []).map(text => ({ source: '', text })),
        notes: def?.notes ?? [],
        charLevel: L, classLevel: n, className: nameOf(key),
        title: `${LevelHistory.ordinal(n)} Level ${nameOf(key)}`,
        future: true,
        planKey: key, classId: key,
        planned,
        firstFuture: L === from,
        isNext: nextButton && L === from,
        pending: !levels,
        prereqFail: prereq && !prereq.meets ? prereq.missingText : '',
        empty: !!levels && !def?.features?.length && !def?.choices?.length && !def?.benefits?.length && !def?.notes?.length
      });
    }
    return { cards, loading, options, planned: plan.size > 0 };
  }

  /**
   * A class's levels as the class defines them (LevelHistory.classLevels),
   * read in the background. Kept for the session per character and class -
   * names, pictures and uuids, a few kilobytes - so the next window has them
   * at once. Returns null while they are being read; every window waiting on
   * them draws again when they arrive.
   *
   * Not started while the window is building its first page: the level-up
   * reads its own level's features then, and the server answers one pack
   * read at a time. _onRender starts what the first page asked for.
   */
  static #plans = new Map();

  #planOf(classId, total) {
    // A class item of the character's, or a compendium class's uuid (a class planned, not taken)
    const fresh = String(classId ?? '').startsWith('Compendium.');
    const cls = fresh ? null : this.actor.items.get(classId);
    if (!fresh && !cls) return null;
    const plans = LevelUpDialog.#plans;
    const slot = `${this.actor.id}|${classId}`;
    // Anything that changes what the class gives at a level: its level, the character's, the archetype
    const key = fresh ? `new|${total}` : `${cls.system?.classLevels}|${total}|${cls.archetype?.id ?? ''}`;
    const hit = plans.get(slot);
    const redraw = () => {
      if (this.rendered && ['build', 'levelup', 'multiclass'].includes(this._mode)) this.render(false);
    };
    if (hit?.key === key) {
      if (hit.levels) return hit.levels;
      if (!this._planWaits?.has(slot)) {
        (this._planWaits ??= new Set()).add(slot);
        hit.promise.then(() => { this._planWaits?.delete(slot); redraw(); });
      }
      return null;
    }
    if (!this.rendered) {
      (this._plansToStart ??= new Map()).set(classId, total);
      return null;
    }
    plans.delete(slot);
    const entry = { key, levels: null, promise: null };
    entry.promise = (fresh ? LevelHistory.newClassLevels(this.actor, classId) : LevelHistory.classLevels(this.actor, classId))
      .catch(err => { AM.log(1, 'Build: the class levels could not be read', err); return []; })
      .then(levels => { if (plans.get(slot) === entry) entry.levels = levels; });
    plans.set(slot, entry);
    while (plans.size > 24) plans.delete(plans.keys().next().value);
    (this._planWaits ??= new Set()).add(slot);
    entry.promise.then(() => { this._planWaits?.delete(slot); redraw(); });
    return null;
  }

  /** What the first page asked for and #planOf held back: read it now. */
  #startPlans() {
    const pending = this._plansToStart;
    if (!pending?.size) return;
    this._plansToStart = null;
    for (const [classId, total] of pending) this.#planOf(classId, total);
  }

  /**
   * What "take levels up to" will do, as a line under it - the levels and the
   * class each goes to, as planned: "6–7 Illrigger, 8–11 Wizard (new class)".
   * Empty for just this level.
   * @param {number} current  the level being taken
   * @param {number} upTo     the last level of the run
   * @param {Array<{L: number, name: string, fresh: boolean}>} path  every level after `current`
   */
  static #upToNote(current, upTo, path) {
    if (!(upTo > current)) return '';
    const runs = [];
    for (const step of path ?? []) {
      if (step.L > upTo) break;
      const name = step.fresh ? game.i18n.format('am.levels.path-new', { cls: step.name }) : step.name;
      const last = runs.at(-1);
      if (last && last.name === name && last.to === step.L - 1) last.to = step.L;
      else runs.push({ name, from: step.L, to: step.L });
    }
    const text = runs.map(r => `${r.from === r.to ? r.from : `${r.from}–${r.to}`} ${r.name}`).join(', ');
    return game.i18n.format(upTo === current + 1 ? 'am.levels.up-to-note-one' : 'am.levels.up-to-note', { path: text });
  }

  /** The levels after the one being taken, each with its planned class, for the note. */
  #upToPath(current, defaultKey) {
    if (!defaultKey) return [];
    return this.#planSteps({ from: current + 1, to: 20, defaultKey })
      .map(st => ({ L: st.charLevel, name: st.className, fresh: !st.classId }));
  }

  /**
   * Start reading the level's grant tree (GrantAbsorber.prefetchTree) without
   * waiting for it. Each read of a5e's class-features pack costs the server
   * about a second, and the maneuver and spell steps before
   * #addLevelGrantContext have reads of their own; side by side they overlap.
   * The key is #addLevelGrantContext's absorbKey, so it waits on this one.
   */
  #warmGrantTree(selectedClass, newLevel, newTotal) {
    const classItem = selectedClass ? this.actor.items.get(selectedClass.id) : null;
    if (!classItem || !AM.deferToSystemGrants) return;
    const archLevel = LevelUpService.archetypeLevelOf(classItem);
    const ownedArch = archLevel && newLevel > archLevel ? GrantAbsorber.archetypeOf(this.actor, classItem) : null;
    const key = `${classItem.id}|${newLevel}|${newTotal}|${ownedArch?.id ?? ''}`;
    if (this._warm?.key === key) return;
    this._warm = { key, done: GrantAbsorber.prefetchTree([classItem, ownedArch], { charLevel: newTotal, clsLevel: newLevel })
      .catch(err => AM.log(2, 'Level grant prefetch failed:', err)) };
  }

  /**
   * The grants this level brings — features, knack, ASI/feat — asked here so
   * a5e's window never opens. Only engages when every grant can be accounted
   * for; otherwise AM.levelUpGrants stays null and a5e handles it as before.
   */
  async #addLevelGrantContext(context, selectedClass, newLevel, { multiclass = null } = {}) {
    AM.levelUpGrants = null;
    if (!AM.deferToSystemGrants || (!selectedClass && !multiclass)) return;

    // A new class is not on the character yet: its trimmed data, as a document
    const classItem = multiclass ? await this.#multiclassSource(multiclass.uuid)
                                 : this.actor.items.get(selectedClass.id);
    if (!classItem) return;
    const hitDie = (selectedClass ?? multiclass)?.hitDie;

    try {
      // a5e gates 'character' grants on total level and the rest on class level,
      // so both have to be passed — not one number standing in for both.
      const lv = { charLevel: context.newTotalLevel, clsLevel: newLevel };

      // Past the archetype level, the archetype is on the character and its
      // grants arrive with the class's. Taking the level over means answering
      // for those too, so if any of them cannot be listed the whole level goes
      // back to a5e, whose window asks for both.
      const archLevel = LevelUpService.archetypeLevelOf(classItem);
      const ownedArch = archLevel && newLevel > archLevel
        ? GrantAbsorber.archetypeOf(this.actor, classItem)
        : null;

      // Also cached: canAbsorb walks the same tree to reach its verdict, and the
      // verdict cannot change while the dialog is open.
      const absorbKey = `${classItem.id}|${newLevel}|${context.newTotalLevel}|${ownedArch?.id ?? ''}`;
      if (this._absorbCache?.key !== absorbKey) {
        // The documents both walks below read, a tier at a time - see prefetchTree.
        // Usually already under way from #warmGrantTree.
        await (this._warm?.key === absorbKey ? this._warm.done : GrantAbsorber.prefetchTree([classItem, ownedArch], lv));
        let ok = await GrantAbsorber.canAbsorb(classItem, lv);
        if (ok && ownedArch && !await GrantAbsorber.canAbsorb(ownedArch, lv)) {
          AM.log(3, `${ownedArch.name} level ${newLevel}: archetype grants left to a5e`);
          ok = false;
        }
        this._absorbCache = { key: absorbKey, ok };
      }
      if (!this._absorbCache.ok) {
        AM.log(3, `${classItem.name} level ${newLevel}: grants left to a5e`);
        return;
      }
      // The whole tree at this level. Knacks and the like are feature grants on
      // the features a class grants, so the top level alone showed none of them.
      //
      // Cached, because _prepareContext runs on every click and this walk reads
      // a document and enriches its HTML for every option it finds — a class
      // with knacks is dozens of reads, repeated for each pick the player made.
      // The key covers everything the walk depends on.
      // The picks are part of the key: choosing an option brings its own
      // contents into the tree, so a cache keyed on the level alone would keep
      // showing the tree from before the choice was made.
      const choices = this._levelChoices ?? {};
      const picksKey = LevelUpDialog.#picksKey(choices);
      const cacheKey = `${classItem.id}|${newLevel}|${context.newTotalLevel}|${picksKey}`;
      let tree = this._treeCache?.key === cacheKey ? this._treeCache.tree : null;
      if (!tree) {
        tree = await GrantAbsorber.describeTreeForLevel(classItem, lv, choices);
        this._treeCache = { key: cacheKey, tree };
      }
      const store = {
        absorb:   true,
        level:    newLevel,
        lv,
        grants:   tree.grants,
        features: tree.features,
        choices:  this._levelChoices ?? {}
      };
      if (multiclass) {
        store.multiclass = true;
        store.classUuid  = multiclass.uuid;
        const opts = classItem.system?.spellcasting?.ability?.options ?? [];
        store.spellcastingAbility = opts[0] ?? classItem.system?.spellcasting?.ability?.base ?? '';
      }
      // The per-level hit points a5e would have written, without CON — it adds
      // CON x level separately when deriving max HP.
      store.charLevel = context.newTotalLevel;
      store.hpValue   = Math.max(1, LevelUpDialog.#hpFor(this, hitDie, 0));

      // The archetype level. a5e asks for this at the end of its grant routine,
      // so suppressing that routine without asking here would let the level pass
      // with no archetype at all.
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

        // An archetype brings grants of its own, and applyArchetype used to run
        // them with no choices at all — so anything it offered was decided by
        // taking the base set and saying nothing. Ask here instead.
        if (store.archetypeUuid) {
          // Keyed on the picks as well as the uuid. Choosing an option brings
          // its own nested grants into the archetype's tree, and a cache keyed
          // on the uuid alone would keep serving the tree from before the pick.
          const archPicks = LevelUpDialog.#choicesWithPrefix(store.choices, LevelUpDialog.#ARCH_PREFIX);
          const archKey   = `${store.archetypeUuid}|${LevelUpDialog.#picksKey(archPicks)}`;
          if (this._archCache?.key !== archKey) {
            this._archCache = { key: archKey,
                                models: await LevelUpDialog.#archetypeGrantModels(store.archetypeUuid, lv, archPicks) };
          }
          const picked = this._archCache.models;
          store.archetypeGrants   = picked.grants;
          store.archetypeFeatures = picked.features;
          store.grants   = [...store.grants,   ...picked.grants];
          store.features = [...store.features, ...picked.features];
          context.archetypeAbsorbed = picked.absorbed;
        }
      } else if (ownedArch) {
        // Every later level. An archetype hands out features every few levels
        // and plenty of them ask something — a Knight's second fighting style
        // at 10th, a Psalmist's hymn at 6th, every Trooper archetype at 7th —
        // and these were applied without asking, taking the base set of each.
        // 74 of a5e's 303 archetypes have such a choice. Same prefix and cache
        // as the archetype level, so answers are filed and handed back alike.
        const archPicks = LevelUpDialog.#choicesWithPrefix(store.choices, LevelUpDialog.#ARCH_PREFIX);
        const archKey   = `owned|${ownedArch.id}|${newLevel}|${context.newTotalLevel}|`
                        + LevelUpDialog.#picksKey(archPicks);
        if (this._archCache?.key !== archKey) {
          const tree = await GrantAbsorber.describeTreeForLevel(ownedArch, lv, archPicks);
          const tag  = (g) => ({ ...g, id: `${LevelUpDialog.#ARCH_PREFIX}${g.id}`, fromArchetype: true });
          this._archCache = { key: archKey,
                              models: { grants: tree.grants.map(tag), features: tree.features.map(tag) } };
        }
        const picked = this._archCache.models;
        store.archetypeOwned = ownedArch.id;
        store.grants   = [...store.grants,   ...picked.grants];
        store.features = [...store.features, ...picked.features];
      }

      AM.levelUpGrants = store;
      this._levelChoices = store.choices;

      const withState = (g) => {
        const picked = store.choices[g.id] ?? [];
        // At a level-up the actor exists, so what they already have counts too —
        // not just what the rest of this level is granting.
        const held = ProficiencyLedger.held(this.actor, g, { id: g.id });
        return {
          ...g,
          grantType: 'levelup',
          options:   (g.options ?? []).map(o => ({
            ...o,
            selected:  picked.includes(o.key),
            duplicate: !picked.includes(o.key) && held.has(o.key)
          })),
          chosen:    picked.length,
          complete:  picked.length >= g.total
        };
      };
      // Same rule as the builder: only blocks with something to pick or to
      // report, so the heading never stands over an empty section.
      const shows = (g) => g.options.length > 0 || g.baseLabels.length > 0;

      // The ability points this level brings are pulled out of the ordinary grant
      // list: a5e states them as two one-point `ability` grants and says nothing
      // about the feat you may take instead, so the choice has to be offered here.
      const asiIds = store.grants
        .filter(g => g.type === 'ability' && !g.fromArchetype && !g.fromFeat)
        .map(g => g.id);
      store.asiIds = asiIds;

      const asiGrants = store.grants.filter(g => asiIds.includes(g.id));
      const rest      = store.grants.filter(g => !asiIds.includes(g.id));

      // A feat's own grants belong beside the feat that brings them, not in a
      // separate section further down the page.
      context.bgGrants   = rest.filter(g => !g.fromFeat).map(withState).filter(shows);
      context.bgFeatures = store.features.filter(g => !g.fromFeat).map(withState).filter(shows);
      context.hasBgGrants = context.bgGrants.length > 0 || context.bgFeatures.length > 0;

      if (asiGrants.length) await this.#addAsiContext(context, store, asiGrants, withState, lv);

      context.featGrants   = rest.filter(g => g.fromFeat).map(withState).filter(shows);
      context.featFeatures = store.features.filter(g => g.fromFeat).map(withState).filter(shows);
      context.hasFeatGrants = context.featGrants.length > 0 || context.featFeatures.length > 0;

      // Whether a5e will open its window at all — which is not the same question
      // as whether this level happens to offer a choice.
      context.grantsAbsorbed = true;
    } catch (err) {
      AM.log(1, 'Could not read level-up grants — a5e will handle this level:', err);
      AM.levelUpGrants = null;
      context.grantsAbsorbed = false;
    }
  }

  /**
   * The class a multiclass level adds, as the document it will be: trimmed to
   * a second class's share (LevelUpService.multiclassData) and prepared, so
   * its grants read like any class's. Kept per uuid while the window is open.
   */
  async #multiclassSource(uuid) {
    if (this._mcSource?.uuid === uuid) return this._mcSource.doc;
    const doc = await fromUuid(uuid);
    if (!doc) return null;
    const { data } = LevelUpService.multiclassData(doc, uuid, { log: false });
    const ItemClass = CONFIG.Item.documentClass;
    const temp = new ItemClass(foundry.utils.deepClone(data));
    this._mcSource = { uuid, doc: temp };
    return temp;
  }

  /* ── Context helpers ─────────────────────────────────────────────────── */

  #addManeuverBrowserContext(context, maneuverInfo) {
    if (!maneuverInfo?.newManeuversToLearn) return;
    context.maneuversLoaded = !!this._allManeuversData;
    if (this._allManeuversData) {
      /* A section per kind this level teaches: combat maneuvers from combat
         traditions, magic ones from the schools - each with its own count,
         degree, limit and filter. One picker for both called the schools
         combat traditions and let a click in one kind close the other's list. */
      const kindOf = (key) => (isMagicSchool(key) ? 'magic' : 'combat');
      const open = LevelUpDialog.#openTraditions(this);
      const knownKeys = ManeuverService.getActorManeuverKeys(this.actor);
      context.maneuverSections = maneuverInfo.kindList.map(({ kind, selected, sources }) => {
        const k = maneuverInfo.kinds[kind];
        const opened = open.filter(t => kindOf(t) === kind);
        const full = opened.length >= k.traditionLimit;
        const filter = this._maneuverFilter?.[kind] ?? null;
        const allowed = (key) => kindOf(key) === kind && traditionAllowed(key, k.allowedTraditions);
        /* A tradition past the limit is still shown and can be browsed - a
           pick from it is what is refused - so it is marked, not hidden. */
        const pills = LevelUpDialog.#buildTraditionPills(this._allManeuversData, opened, filter, allowed, k.maxDegree)
          .map(p => ({ ...p, lore: traditionLoreHtml(p.key), locked: full && !opened.includes(p.key) }));
        const locked = filter && full && !opened.includes(filter);
        return {
          kind,
          magic: kind === 'magic',
          title: game.i18n.localize(kind === 'magic' ? 'am.maneuvers.section-title-magic' : 'am.maneuvers.section-title'),
          traditionsLabel: game.i18n.localize(kind === 'magic' ? 'am.maneuvers.schools-label' : 'am.maneuvers.traditions-open-label'),
          sources,
          newToLearn: k.newToLearn,
          selected,
          maxDegree: k.maxDegree,
          degreeUnlocked: k.maxDegree > k.prevMaxDegree ? k.maxDegree : null,
          traditionsOpen: opened.length,
          traditionLimit: k.traditionLimit,
          pills,
          filterTradition: filter,
          visibleManeuvers: filter
            ? LevelUpDialog.#filterManeuvers(this._allManeuversData, k.maxDegree, filter, this._selectedManeuverUuids, knownKeys)
                .map(m => ({ ...m, blocked: locked && !m.isSelected }))
            : []
        };
      });
    } else if (!this._loadingManeuvers) {
      this._loadingManeuvers = true;
      ManeuverService.loadAllManeuvers().then(data => {
        this._allManeuversData = data;
        this._loadingManeuvers = false;
        this.render(false);
      });
    }
  }

  /**
   * The archetype spellcasting that applies to this level, or null: the
   * character's own archetype for the class, or the one picked in this dialog,
   * once the class level reaches the feature that brings it.
   */
  async #archetypeCasting(cls, newClassLevel) {
    if (!cls?.id) return null;
    const classItem = this.actor.items.get(cls.id);
    let doc = classItem ? GrantAbsorber.archetypeOf(this.actor, classItem) : null;
    if (!doc && this._archetypeUuid) {
      try { doc = await fromUuid(this._archetypeUuid); } catch { doc = null; }
    }
    const casting = doc ? await SpellService.archetypeCasting(doc) : null;
    return casting && newClassLevel >= casting.fromLevel ? casting : null;
  }

  #addSpellBrowserContext(context, spellInfo) {
    if (!spellInfo) return;

    /* What the list was loaded for. A class's list, or an archetype's rule -
       and picking a different archetype in this dialog changes the rule, so the
       spells loaded for the last one, and anything picked from them, go. */
    const casterName = this._mode === 'multiclass'
      ? ((this._compendiumClasses ?? []).find(c => c.uuid === this._newClassUuid)?.name ?? '')
      : (LevelUpService.getActorClasses(this.actor)
           .find(c => c.id === this._selectedClassId)?.name ?? '');
    const casting = this._mode === 'multiclass' ? null : this._spellCasting;
    const source = casting
      ? `archetype:${casting.archetype}:${spellInfo.maxLevel ?? 1}`
      : `class:${casterName}:${spellInfo.maxLevel ?? 1}`;
    if (this._spellsSource !== source) {
      if (this._spellsSource) {
        this._selectedCantripUuids = [];
        this._selectedSpellUuids   = [];
      }
      this._spellsSource  = source;
      this._allSpellsData = null;
      this._loadingSpells = false;
    }
    /* What this dialog's own picks add to the list - the archetype taken here,
       a patron's expanded list, an oath's schools - is not on the actor yet.
       A change reloads the list; unlike a change of rule, it keeps the picks. */
    const grants = AM.levelUpGrants;
    const expandedKey = `${this._archetypeUuid ?? ''}|${JSON.stringify(grants?.absorb ? (grants.choices ?? {}) : {})}`;
    if (this._spellsExpandedKey !== expandedKey) {
      this._spellsExpandedKey = expandedKey;
      if (this._allSpellsData) { this._allSpellsData = null; this._loadingSpells = false; }
    }

    context.spellsLoaded = !!this._allSpellsData;
    if (this._allSpellsData) {
      /* The spells this level's own features hand out count as known too: a
         wizard taken as a second class gets Prestidigitation from its
         Spellcasting feature, and picking it in the list as well made two. */
      const known = SpellService.getActorSpellKeys(this.actor);
      for (const name of this._featureSpellNames ?? []) known.add(name);
      const result = LevelUpDialog.#filterSpells(this._allSpellsData, spellInfo, this._spellFilter, this._selectedCantripUuids, this._selectedSpellUuids,
        known);
      context.visibleSpells        = result.spells;
      context.spellLevelPills      = result.levelPills;
      context.spellSchoolPills     = result.schoolPills;
      context.spellLevelAllActive  = result.levelAllActive;
      context.spellSchoolAllActive = result.schoolAllActive;
    } else if (!this._loadingSpells) {
      this._loadingSpells = true;
      // Restrict to the caster's own spell list — a null class shows every spell
      // in every compendium, which is what made "all schools" available.
      // Expanded lists first: they decide which non-class spells the filter
      // below must let through, and the load applies the filter as it indexes.
      const filter = casting ? SpellService.archetypeSpellFilter(casting) : casterName;
      const key = expandedKey;
      const load = async () => {
        const { ProseSpells } = await import('../utils/proseSpells.js');
        const chosen = grants?.absorb ? await ProseSpells.docsFromGrantModels(grants.features, grants.choices) : [];
        await SpellService.collectExpandedLists([...this.actor.items, ...chosen]);
        return SpellService.loadSpells(filter, spellInfo.maxLevel ?? 1);
      };
      load().then(data => {
        if (this._spellsSource !== source) return;   // loaded for a rule no longer shown
        this._loadingSpells = false;
        // picks changed while it loaded: load again for what is chosen now
        if (this._spellsExpandedKey !== key) { this.render(false); return; }
        this._allSpellsData = data;
        this.render(false);
      }).catch(err => {
        AM.log(1, 'The level-up spell list could not be loaded:', err);
        this._loadingSpells = false;
      });
    }
  }

  /**
   * What this level lets the character learn, combat and magic maneuvers apart.
   *
   * This read one table, the levelled class's, and nothing else. So a
   * Spellguard wizard - combat maneuvers from its archetype at 2nd, magic ones
   * from the class at 3rd - was offered its magic maneuvers and never a combat
   * one; an archetype that gives maneuvers to a class with none (Steel Blooded,
   * Martialist, the Engineers, the Myrmidon) gave nothing. ManeuverService.
   * maneuverBudget gathers every source - a combat pick by the rules of the
   * class being levelled, see there; this adds the trade-ins, which free a pick
   * of their own kind.
   */
  async #getManeuverInfo(cls, newClassLevel, { newClass = null } = {}) {
    this._maneuverBudget = null;
    if (!cls && !newClass) return null;
    const budget = await ManeuverService.maneuverBudget(this.actor, newClass
      ? { newClass }
      : { classId: cls.id, newLevel: newClassLevel, archetypeUuid: this._archetypeUuid ?? null });

    const kindOf = (tradition) => (isMagicSchool(tradition) ? 'magic' : 'combat');
    const replaced = { combat: 0, magic: 0 };
    for (const id of this._replacedManeuverIds) {
      const item = this.actor.items.get(id);
      replaced[kindOf(item?.system?.tradition ?? item?.system?.combatTradition ?? '')]++;
    }

    const kinds = {};
    for (const [kind, k] of Object.entries(budget.kinds)) {
      // A kind this class does not learn is not reopened by a level in another class
      if (!k.levelling) continue;
      kinds[kind] = { ...k, newToLearn: k.gained + replaced[kind] };
    }
    const list = Object.entries(kinds).map(([kind, k]) => ({ kind, ...k }));
    if (!list.length) return null;

    const selectedOf = (kind) => Object.entries(this._selectedManeuverTraditions ?? {})
      .filter(([uuid, t]) => this._selectedManeuverUuids.includes(uuid) && kindOf(t) === kind).length;
    const open = list.filter(k => k.newToLearn > 0);
    const unlocked = list.filter(k => k.maxDegree > k.prevMaxDegree).map(k => k.maxDegree);
    const info = {
      kinds,
      kindList: open.map(k => ({
        kind: k.kind,
        label: game.i18n.localize(`am.maneuvers.kind-${k.kind}`),
        selected: selectedOf(k.kind),
        newToLearn: k.newToLearn,
        maxDegree: k.maxDegree,
        sources: k.sources.join(', ')
      })),
      multipleKinds: open.length > 1,
      gained: list.reduce((n, k) => n + k.gained, 0),
      newManeuversToLearn: list.reduce((n, k) => n + k.newToLearn, 0),
      maneuversKnown: list.reduce((n, k) => n + k.known, 0),
      maxDegree: Math.max(...list.map(k => k.maxDegree)),
      degreeUnlocked: unlocked.length ? Math.max(...unlocked) : null,
      traditions: list.reduce((n, k) => n + k.traditionLimit, 0),
      hasManeuvers: true,
      /* A trade-in per kind: magic maneuvers are on top of combat ones, so a
         Spellguard wizard's level may swap one of each rather than one of
         either. #maneuverReplacementContext counts the kinds with something
         to trade. */
      replaceablePerKind: (!newClass && newClassLevel > 1) ? ManeuverService.MANEUVER_REPLACEMENTS_PER_LEVEL : 0
    };
    this._maneuverBudget = info;
    return info;
  }

  /**
   * Known maneuvers offered for replacement, plus how many may still be swapped.
   * a5e allows one per class level gained.
   */
  #maneuverReplacementContext(context, cls, newClassLevel) {
    if (!cls || newClassLevel <= 1) return;
    const info = this._maneuverBudget;
    if (!info?.replaceablePerKind) return;
    const teaches = new Set(Object.keys(info.kinds ?? {}));

    // Only the ones the player chose. A maneuver handed out by a class feature is
    // part of that feature, not a pick, so trading it away would quietly delete a
    // class ability and leave the grant that produced it pointing at nothing.
    // Basic maneuvers — Overrun, Grapple, Disarm, Grab On, Shove, Knockdown —
    // are degree 0 with no tradition and belong to every character always. They
    // were never a pick, so trading one away is not a thing that can happen.
    const known = ManeuverService.getActorManeuvers(this.actor)
      .filter(m => !m.basic && !ManeuverService.isGrantedManeuver(this.actor, m.id))
      // A wizard levelling trades a magic maneuver, not the fighter's it also knows
      .filter(m => teaches.has(isMagicSchool(m.tradition) ? 'magic' : 'combat'));
    if (!known.length) return;

    /* A list per kind, each with its own count: a magic maneuver is traded
       for a magic one and a combat maneuver for a combat one. */
    const kindOf = (t) => (isMagicSchool(t) ? 'magic' : 'combat');
    const kindOfItem = (id) => {
      const it = this.actor.items.get(id);
      return kindOf(it?.system?.tradition ?? it?.system?.combatTradition ?? '');
    };
    const shown = this._showReplaceManeuver ?? {};
    context.maneuverReplaceSections = ['combat', 'magic'].map(kind => {
      const list = known.filter(m => kindOf(m.tradition) === kind);
      if (!list.length) return null;
      const used = this._replacedManeuverIds.filter(id => kindOfItem(id) === kind).length;
      return {
        kind,
        title: game.i18n.localize(kind === 'magic' ? 'am.levelup.replace-magic-title' : 'am.levelup.replace-maneuver-title'),
        used,
        limit: info.replaceablePerKind,
        // Opened once something is marked, so a swap in progress is never hidden
        show: !!shown[kind] || used > 0,
        list: list.map(m => ({
          id: m.id, uuid: this.actor.items.get(m.id)?.uuid ?? '', name: m.name, img: m.img,
          degree: m.degree, traditionLabel: m.traditionLabel,
          replaced: this._replacedManeuverIds.includes(m.id)
        }))
      };
    }).filter(Boolean);
    context.maneuverReplaceLimit = info.replaceablePerKind * context.maneuverReplaceSections.length;
  }

  /**
   * Known spells offered for replacement — known casters only.
   * @param {number} limit  swaps this level allows, by the class's rule or its archetype's
   */
  #spellReplacementContext(context, cls, newClassLevel, limit) {
    this._spellReplaceLimit = 0;
    if (!cls || newClassLevel <= 1) return;
    if (!limit) return;
    this._spellReplaceLimit = limit;

    const known = SpellService.getActorSpells(this.actor).filter(s => s.level > 0);
    if (!known.length) return;

    context.spellReplaceLimit = limit;
    context.spellReplaceUsed  = this._replacedSpellIds.length;
    context.showReplaceSpell  = !!this._showReplaceSpell || this._replacedSpellIds.length > 0;
    context.knownSpellList = known.map(s => ({
      id: s.id, name: s.name, img: s.img, level: s.level,
      replaced: this._replacedSpellIds.includes(s.id)
    }));
  }

  /**
   * The shorter proficiency list a class hands over as a SECOND class.
   *
   * Read off the compendium item itself rather than the rules table, so what is
   * shown is what will actually be created. The dialog re-renders on every
   * keystroke and radio click, so the answer is cached per class — this is the
   * only compendium read in the multiclass branch.
   */
  async #multiclassProficiencies(newClass) {
    if (!newClass?.uuid) return null;
    if (this._mcProficiencies?.uuid === newClass.uuid) return this._mcProficiencies.value;

    // Unreadable item: say nothing about the lists rather than imply they are
    // empty. The trim still runs on submit — this is only what is shown.
    const blank = {
      known: !!MulticlassRules.spec(newClass.name),
      lines: [], lost: [], lostEquipment: false, hasLosses: false,
    };

    let value;
    try {
      const doc = await fromUuid(newClass.uuid);
      value = doc ? MulticlassRules.preview(doc.toObject()) : blank;
    } catch (err) {
      AM.log(2, `Could not read ${newClass.name} to preview its multiclass proficiencies:`, err);
      value = blank;
    }

    this._mcProficiencies = { uuid: newClass.uuid, value };
    return value;
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
    this._selectedManeuverTraditions = {};
    this._selectedCantripUuids  = [];
    this._selectedSpellUuids    = [];
    this._replacedManeuverIds   = [];
    this._replacedSpellIds      = [];
    this._bonusSpellPicks       = {};
    this._allManeuversData  = null;
    this._allSpellsData     = null;
    this._spellsSource      = null;
    this._loadingManeuvers  = false;
    this._loadingSpells     = false;
    this._maneuverFilter    = { combat: null, magic: null };
    this._spellFilter       = { level: null, school: null };
    // Grant picks belong to one class at one level — switching either invalidates them
    this._levelChoices      = {};
    this._archetypeUuid     = null;
    this._treeCache = this._absorbCache = this._archCache = this._featCache = null;
    this._asiMode           = 'ability';
    this._featUuid          = null;
    this._featSearch        = '';
    this._featOnlyEligible  = false;
    this._featSort          = 'name';
    this._featSortDir       = 'asc';
    this._featMyClassOnly   = false;
    this._featUngatedOnly   = false;
    this._archetypeSkipped  = false;
    AM.levelUpGrants        = null;
  }

  /* ── Private static browser helpers ─────────────────────────────────── */

  static #buildTraditionPills(allData, usedTraditions, activeTradition,
                              allowedTraditions = null, maxDegree = Infinity) {
    // Either may be given per tradition, now that a school and a combat tradition
    // can sit in one picker under different rules.
    const allowed  = typeof allowedTraditions === 'function' ? allowedTraditions : (key) => traditionAllowed(key, allowedTraditions);
    const degreeOf = typeof maxDegree === 'function' ? maxDegree : () => maxDegree;
    const reachable = (key) => {
      const tradMap = allData?.get(key);
      if (!tradMap) return 0;
      let n = 0;
      for (const [degree, arr] of tradMap) if (degree <= degreeOf(key)) n += arr.length;
      return n;
    };

    return getTraditions()
      // Restrict to the traditions this class may choose from (null = any).
      .filter(t => allowed(t.key))
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

  /**
   * Traditions and schools open to this character now: those the proficiency
   * list records, the school of every magic maneuver already known - a school
   * is open once a maneuver from it is known, whether or not the list caught
   * it, so a level could otherwise open two more each time - and those this
   * level's picks are opening. Combat traditions are a5e's own grants and the
   * list holds them; a maneuver a feat handed out from another tradition does
   * not take a slot.
   */
  static #openTraditions(dialog) {
    const known = ManeuverService.getActorManeuvers(dialog.actor)
      .filter(m => !m.basic && isMagicSchool(m.tradition)).map(m => m.tradition);
    return [...new Set([
      ...(ManeuverService.getActorTraditions?.(dialog.actor) ?? []),
      ...known,
      ...LevelUpDialog.#grantedTraditions(dialog),
      ...(dialog._selectedTraditions ?? [])
    ])];
  }

  /**
   * The traditions this level's grants hand over: the fixed ones, and those
   * picked in the grant step above (a class's Combat Maneuvers feature asks
   * for them). Open to the maneuver step as much as the ones already had -
   * counted in one step and not the other, a rogue could take two traditions
   * in the grant and maneuvers from two more below it (found 2026-10-09).
   */
  static #grantedTraditions(dialog) {
    const store = AM.levelUpGrants;
    if (!store?.absorb) return [];
    // The answers of another class than the one being taken are not this level's
    if (dialog._mode === 'multiclass' ? store.classUuid !== dialog._newClassUuid : !!store.multiclass) return [];
    const out = [];
    for (const m of [...(store.grants ?? []), ...(store.features ?? [])]) {
      const tradition = (m?.type === 'proficiency' && m.proficiencyType === 'tradition')
        || (m?.type === 'trait' && m.traitType === 'maneuverTraditions');
      if (tradition) out.push(...(m.base ?? []), ...(store.choices?.[m.id] ?? []));
    }
    return out;
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

  static #filterSpells(allData, spellInfo, filter, selectedCantrips, selectedSpells, knownKeys = new Set()) {
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
        // Already on the character - in the spellbook or known - so it is not
        // taken a second time by accident
        const alreadyKnown = !isSelected && SpellService.isKnownSpell(knownKeys, spell);
        spells.push({ ...spell, isSelected, isCantrip, alreadyKnown });
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
    // The class definitions the first page asked for, now that it is drawn
    setTimeout(() => this.#startPlans(), 0);

    /* ── Right-click a maneuver/spell/feat card for its full text and costs ── */
    this._detachDescPanel?.();
    this._detachDescPanel = ItemDescPanel.attach(
      this.element,
      '.am-card[data-uuid], .am-maneuver-card[data-uuid], .am-spell-card[data-uuid], .am-replace-row[data-uuid], .lu-build-chip[data-uuid], [data-lore]'
    );

    /* ── Feat search ── */
    const featSearch = this.element.querySelector('.am-feat-search');
    if (featSearch) {
      featSearch.addEventListener('input', (e) => {
        this._featSearch = e.target.value ?? '';
        this._featPage = 0;
        this._featSearchFocused = true;
        this.render(false);
      });
      // The re-render replaces the field being typed into
      if (this._featSearchFocused) {
        featSearch.focus();
        featSearch.setSelectionRange(featSearch.value.length, featSearch.value.length);
      }
    }

    /* ── Mode toggle ──
       Scoped to its own section: the ASI toggle reuses these classes for the
       same look, and an unscoped selector made picking "feat" switch the whole
       dialog to multiclass mode and wipe every selection. */
    this.element.querySelectorAll('.lu-mode-section .lu-mode-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const newMode = btn.dataset.mode;
        if (newMode === this._mode && this._downCharTarget === null) return;
        this._mode      = newMode;
        this._downCharTarget = null;
        this._downRebuild    = false;
        this._rolledHP  = null;
        this.#resetSelections();
        await this.render(true);
      });
    });

    /* ── The build: whose levels ahead, and where to scroll to ── */
    this.element.querySelectorAll('.lu-plan-class').forEach(sel => sel.addEventListener('change', () => {
      const level = Number(sel.dataset.level);
      if (!level) return;
      this.#plan().set(level, sel.value);
      this.render(false);
    }));
    if (['build', 'levelup'].includes(this._mode) && this._buildScroll !== null) {
      const where = this._buildScroll;
      this._buildScroll = null;
      // After the part's own scroll restore (#syncPartState runs on the next frame)
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const content = this.element?.querySelector('.window-content');
        const target = where === 'future' ? this.element?.querySelector('.lu-build-divider, .lu-build-more')
          : (typeof where === 'number' ? this.element?.querySelector(`#lu-build-L${where}`) : null);
        if (target) target.scrollIntoView({ block: 'start' });
        else if (where === 'top' && content) content.scrollTop = 0;
      }));
    }

    /* ── Level-up mode: keep going to a later level ── */
    this.element.querySelector('#lu-up-to')?.addEventListener('change', (e) => {
      this._upTo = Number(e.target.value) || null;
      // What the pick will do, said in place - no redraw for it
      const note = this.element.querySelector('.lu-up-to-note');
      if (note) {
        let path = [];
        try { path = JSON.parse(note.dataset.path || '[]'); } catch { path = []; }
        note.textContent = LevelUpDialog.#upToNote(Number(note.dataset.from), this._upTo, path);
      }
    });

    /* ── Level-down mode: class, level, backup ── */
    this.element.querySelector('#lu-down-class-select')?.addEventListener('change', async (e) => {
      this._downClassId = e.target.value;
      this._downTarget  = null;
      await this.render(true);
    });
    this.element.querySelector('#lu-down-target')?.addEventListener('change', async (e) => {
      this._downTarget = Number(e.target.value);
      await this.render(true);
    });
    this.element.querySelector('#lu-down-backup')?.addEventListener('change', (e) => {
      this._downBackup = !!e.target.checked;
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
    const tradition = btn.dataset.tradition || null;
    const kind = btn.dataset.kind || (isMagicSchool(tradition) ? 'magic' : 'combat');
    const current = dialog._maneuverFilter?.[kind] ?? null;
    dialog._maneuverFilter = { ...(dialog._maneuverFilter ?? {}), [kind]: current === tradition ? null : tradition };
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

    /* The limits the section was drawn with, for this maneuver's kind. These
       were worked out again here from the class table alone - so a trade-in
       never freed a pick (the gain was all it counted), a wizard's combat
       traditions used up its magic schools, and an archetype's maneuvers had
       no limit to be checked against at all. */
    const kindOf = (t) => (isMagicSchool(t) ? 'magic' : 'combat');
    const kind = kindOf(tradition);
    const k = dialog._maneuverBudget?.kinds?.[kind];
    const limit = k?.newToLearn ?? 0;
    const totalTraditionLimit = k?.traditionLimit ?? 0;
    const picked = dialog._selectedManeuverTraditions ??= {};

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
      /* Only from the traditions the levelled class allows - the list drawn
         above already holds nothing else, but the click is what must not let
         one through. */
      if (tradition && !traditionAllowed(tradition, k?.allowedTraditions)) {
        ui.notifications.warn(game.i18n.localize('am.grants.tradition-not-allowed'));
        return;
      }
      if (uuids.filter(u => kindOf(picked[u]) === kind).length >= limit) {
        ui.notifications.warn(game.i18n.format('am.maneuvers.slots-full', { n: limit }));
        return;
      }
      if (tradition) {
        const actorTraditions = ManeuverService.getActorTraditions?.(dialog.actor) ?? [];
        // Schools against schools, combat traditions against combat traditions -
        // and one a known maneuver comes from is open, recorded or not
        const allUsed = new Set(LevelUpDialog.#openTraditions(dialog).filter(t => kindOf(t) === kind));
        if (!allUsed.has(tradition) && allUsed.size >= totalTraditionLimit) {
          ui.notifications.warn(game.i18n.format('am.app.maneuvers.tradition-limit', { n: totalTraditionLimit }));
          return;
        }
        if (!traditions.includes(tradition) && !actorTraditions.includes(tradition)) {
          traditions.push(tradition);
        }
      }
      uuids.push(uuid);
      picked[uuid] = tradition;
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

  /**
   * The spell allowance in force, whichever mode the dialog is in.
   *
   * Multiclass reads the class being taken; a level-up reads the class being
   * levelled, with an open-ended count because a5e has no spells-known table.
   */
  static #spellInfoFor(dialog) {
    if (dialog._mode === 'multiclass') {
      const cls = (dialog._compendiumClasses ?? []).find(c => c.uuid === dialog._newClassUuid);
      return cls ? (CLASS_SPELL_TABLES[cls.name.toLowerCase()] ?? null) : null;
    }
    /* Exactly what the section displayed at its last render. This used to be
       worked out a second time here, through getClassSpellInfo - which knows
       eight classes and falls back to whichever class was last looked up - so
       for every other caster the click enforced a different number from the
       one on screen, or none. */
    return dialog._spellInfo ?? null;
  }

  /**
   * How many spells of 1st level or higher this level-up may add.
   *
   *   - a caster who learns spells: what the table adds at this level
   *   - a caster who prepares from the whole list: what the preparation count
   *     grows by - a cleric or druid one a level, a herald one every other
   *     level. This was open-ended, so any number could be taken at once.
   *   - either way, plus one for each known spell marked to be replaced, since
   *     swapping one out has to leave room to take its replacement. It did not,
   *     so at a level that adds nothing - a sorcerer's 12th - marking a spell
   *     only deleted it.
   *
   * -1 means the count is unknown (a class with no table), which leaves it open.
   */
  static #spellsOwed(dialog, className, newClassLevel, owed) {
    let n = owed?.spells ?? -1;
    if (owed && owed.spells === null) {
      const now    = SpellService.preparedCount(dialog.actor, className, newClassLevel);
      const before = SpellService.preparedCount(dialog.actor, className, newClassLevel - 1);
      n = (now !== null && before !== null) ? Math.max(0, now - before) : -1;
    }
    return n < 0 ? n : n + (dialog._replacedSpellIds?.length ?? 0);
  }

  static luToggleSpell(_event, btn) {
    const dialog = AM.levelUpDialog;
    if (!dialog) return;

    const uuid  = btn.dataset.uuid;
    const level = parseInt(btn.dataset.level ?? '0');
    if (!uuid) return;

    // This was written when the spell browser existed only in multiclass mode:
    // it looked up the class being multiclassed INTO and returned if there was
    // none. In level-up mode there never is, so every click on a spell was
    // dropped on the first line — the card highlighted on hover and then did
    // nothing.
    const spellInfo = LevelUpDialog.#spellInfoFor(dialog);
    if (!spellInfo) return;

    const isCantrip = level === 0;
    const cantrips  = [...dialog._selectedCantripUuids];
    const spells    = [...dialog._selectedSpellUuids];
    if (btn.dataset.known === 'true' && !cantrips.includes(uuid) && !spells.includes(uuid)) {
      ui.notifications.warn(game.i18n.localize('am.spells.already-known'));
      return;
    }

    if (isCantrip) {
      const idx = cantrips.indexOf(uuid);
      if (idx >= 0) {
        cantrips.splice(idx, 1);
      } else {
        // Same open-ended rule as spells: -1 means the level-up does not know
        // how many are owed, so it does not stand in the way.
        const cap = spellInfo.cantrips ?? 0;
        if (cap >= 0 && cantrips.length >= cap) {
          ui.notifications.warn(game.i18n.format('am.spells.cantrips-full', { n: cap }));
          return;
        }
        cantrips.push(uuid);
      }
    } else {
      const idx = spells.indexOf(uuid);
      if (idx >= 0) {
        spells.splice(idx, 1);
      } else {
        // spellsKnown -1 means open-ended, which is what a level-up uses: a5e
        // ships no spells-known-per-level table. Comparing against it directly
        // would refuse the very first pick.
        // The cap applies whenever there is one, whatever the caster type: a
        // wizard is "prepared" but still adds a fixed number to the book each
        // level, and gating on type meant that number was never enforced.
        const cap = spellInfo.spellsKnown ?? 0;
        if (cap >= 0 && spells.length >= cap) {
          ui.notifications.warn(game.i18n.format('am.spells.spells-full', { n: cap }));
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
      /* The freed pick is gone - give back the most recent maneuver chosen of
         the same kind, and only as many as that kind is now over by. */
      const kindOf = (t) => (isMagicSchool(t) ? 'magic' : 'combat');
      const item = dialog.actor.items.get(id);
      const kind = kindOf(item?.system?.tradition ?? item?.system?.combatTradition ?? '');
      const stillMarked = list.filter(x => {
        const it = dialog.actor.items.get(x);
        return kindOf(it?.system?.tradition ?? it?.system?.combatTradition ?? '') === kind;
      }).length;
      const budget = (dialog._maneuverBudget?.kinds?.[kind]?.gained ?? 0) + stillMarked;
      const picked = dialog._selectedManeuverTraditions ?? {};
      const ofKind = () => dialog._selectedManeuverUuids.filter(u => kindOf(picked[u]) === kind);
      while (ofKind().length > budget) {
        const last = ofKind().pop();
        dialog._selectedManeuverUuids = dialog._selectedManeuverUuids.filter(u => u !== last);
        delete picked[last];
      }
    } else {
      // One of each kind, not one in all - see replaceablePerKind
      const kindOf = (t) => (isMagicSchool(t) ? 'magic' : 'combat');
      const kindOfItem = (x) => {
        const it = dialog.actor.items.get(x);
        return kindOf(it?.system?.tradition ?? it?.system?.combatTradition ?? '');
      };
      const limit = dialog._maneuverBudget?.replaceablePerKind ?? 0;
      const kind = kindOfItem(id);
      if (list.filter(x => kindOfItem(x) === kind).length >= limit) {
        ui.notifications.warn(game.i18n.format('am.levelup.replace-limit-kind',
          { n: limit, kind: game.i18n.localize(`am.maneuvers.kind-${kind}`) }));
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
      /* Taking a mark back takes back the pick it made room for - that pick
         only. This trimmed the selection down to the number of marks left,
         which assumed every picked spell was a replacement, so unmarking one
         also threw away the spells the level itself had given. */
      const cap = dialog._spellInfo?.spellsKnown ?? -1;
      if (cap >= 0) {
        while (dialog._selectedSpellUuids.length > Math.max(0, cap - 1)) dialog._selectedSpellUuids.pop();
      }
    } else {
      // The number the section was drawn with - an archetype's swap as much as a class's
      const limit = dialog._spellReplaceLimit ?? 0;
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
      LevelUpDialog.#dropChoices(dialog, LevelUpDialog.#ARCH_PREFIX);
    } else if (btn?.dataset.uuid) {
      dialog._archetypeUuid = dialog._archetypeUuid === btn.dataset.uuid ? null : btn.dataset.uuid;
      if (dialog._archetypeUuid) dialog._archetypeSkipped = false;
      LevelUpDialog.#dropChoices(dialog, LevelUpDialog.#ARCH_PREFIX);
    } else {
      return;
    }
    dialog.render(false);
  }

  /**
   * The "ability score increase OR a feat" choice.
   *
   * a5e carries only the two ability grants, so the alternative is ours to offer.
   * Choosing the feat marks those grants skipped rather than deleting them, which
   * keeps a5e's own record of the level intact.
   */
  async #addAsiContext(context, store, asiGrants, withState, lv) {
    store.asiMode = this._asiMode ?? 'ability';
    store.featUuid = this._featUuid ?? null;

    context.hasAsi     = true;
    context.asiMode    = store.asiMode;
    context.asiGrants  = asiGrants.map(withState);
    context.asiPoints  = asiGrants.reduce((n, g) => n + (g.total || 0), 0);
    context.asiChosen  = asiGrants.reduce((n, g) => n + (store.choices[g.id]?.length ?? 0), 0);

    if (store.asiMode !== 'feat') return;

    try {
      const { FeatService } = await import('../utils/featService.js');
      // Defaults to the ones the character qualifies for: 600-odd entries, most
      // of them unreachable, is not a list anyone can use.
      this._featOnlyEligible ??= true;

      const feats = await FeatService.optionsFor(this.actor, {
        search:       this._featSearch ?? '',
        onlyEligible: !!this._featOnlyEligible,
        sort:         this._featSort ?? 'name',
        dir:          this._featSortDir ?? 'asc',
        onlyMyClass:  !!this._featMyClassOnly,
        onlyUngated:  !!this._featUngatedOnly
      });

      const PAGE = 40;
      const pages = Math.max(1, Math.ceil(feats.length / PAGE));
      const page  = Math.min(Math.max(0, this._featPage ?? 0), pages - 1);
      this._featPage = page;

      context.featSearch       = this._featSearch ?? '';
      context.featOnlyEligible = !!this._featOnlyEligible;
      context.featMyClassOnly  = !!this._featMyClassOnly;
      context.featUngatedOnly  = !!this._featUngatedOnly;
      context.featUnchecked    = feats.unchecked ?? 0;
      context.featSortDir      = this._featSortDir ?? 'asc';
      /* Built here rather than in the template so the labels and the active
         mark come from one place — FeatService owns what the orders are. */
      context.featSorts = Object.entries(FeatService.SORTS).map(([key, s]) => ({
        key, label: s.label, active: (this._featSort ?? 'name') === key
      }));
      context.featTotal        = feats.length;
      context.featPage         = page + 1;
      context.featPages        = pages;
      context.featHasPrev      = page > 0;
      context.featHasNext      = page < pages - 1;

      // Descriptions are not loaded here: the shared panel fetches on right-click,
      // which is the gesture used everywhere else and costs nothing until asked.
      const slice = feats.slice(page * PAGE, page * PAGE + PAGE);
      context.feats = slice.map(f => ({ ...f, selected: f.uuid === store.featUuid }));

      // A feat brings grants of its own — 265 of the 625 in the packs do, and
      // 163 of those are the "+1 to one of these three abilities" that comes
      // alongside it. They were being applied with the class's choices object,
      // which never holds the feat's keys, so every one of them silently took
      // its base set. Ask for them here, under a prefix of their own.
      if (store.featUuid) {
        const featPicks = LevelUpDialog.#choicesWithPrefix(store.choices, LevelUpDialog.#FEAT_PREFIX);
        const featKey   = `${store.featUuid}|${LevelUpDialog.#picksKey(featPicks)}`;
        if (this._featCache?.key !== featKey) {
          this._featCache = { key: featKey,
                              models: await LevelUpDialog.#featGrantModels(store.featUuid, lv, featPicks) };
        }
        const picked = this._featCache.models;
        store.grants   = [...store.grants,   ...picked.grants];
        store.features = [...store.features, ...picked.features];
        context.featAbsorbed = picked.absorbed;
      }
      context.featChosen = feats.find(f => f.uuid === store.featUuid) ?? null;
    } catch (err) {
      AM.log(1, 'Could not load feats:', err);
      context.featError = true;
    }
  }

  /**
   * The archetype's own grants, as picker models.
   *
   * Ids are prefixed so they cannot collide with the class's grant ids — both
   * sets share one choices bucket, and the record keys are only unique within
   * their own item. The prefix is stripped again in #archetypeChoicesFrom.
   *
   * If the archetype has anything the builder cannot model, nothing is returned
   * and `absorbed` is false: the level-up then says plainly that a5e will ask,
   * rather than quietly dropping the choice as before.
   */
  static async #archetypeGrantModels(uuid, lv, choices = {}) {
    const empty = { grants: [], features: [], absorbed: false };
    try {
      const doc = await fromUuid(uuid);
      if (!doc) return empty;
      if (!await GrantAbsorber.canAbsorb(doc, lv)) {
        AM.log(2, `Archetype ${doc.name}: grants left to a5e`);
        return empty;
      }
      const tag  = (g) => ({ ...g, id: `${LevelUpDialog.#ARCH_PREFIX}${g.id}`, fromArchetype: true });
      // The archetype's nested grants matter as much as a class's — this is where
      // an archetype's own knack- or specialisation-style choices live.
      const tree = await GrantAbsorber.describeTree(doc, lv, { choices });
      return {
        grants:   tree.grants.map(tag),
        features: tree.features.map(tag),
        absorbed: true
      };
    } catch (err) {
      AM.log(2, 'Could not read archetype grants:', err);
      return empty;
    }
  }

  static #ARCH_PREFIX = 'arch:';
  static #FEAT_PREFIX = 'feat:';

  /**
   * The chosen feat's own grants, as picker models.
   *
   * Same shape and same reason as the archetype: they share one choices bucket
   * with the class's grants, and record keys are only unique inside their own
   * item, so each source needs a prefix of its own.
   */
  static async #featGrantModels(uuid, lv, choices = {}) {
    const empty = { grants: [], features: [], absorbed: false };
    try {
      const doc = await fromUuid(uuid);
      if (!doc) return empty;
      if (!await GrantAbsorber.canAbsorb(doc, lv)) {
        AM.log(2, `Feat ${doc.name}: grants left to a5e`);
        return empty;
      }
      const tag  = (g) => ({ ...g, id: `${LevelUpDialog.#FEAT_PREFIX}${g.id}`, fromFeat: true });
      const tree = await GrantAbsorber.describeTree(doc, lv, { choices });
      return {
        grants:   tree.grants.map(tag),
        features: tree.features.map(tag),
        absorbed: true
      };
    } catch (err) {
      AM.log(2, 'Could not read the feat grants:', err);
      return empty;
    }
  }

  /**
   * A cache key for a set of picks. Any cache holding a described tree must
   * include this: choosing an option pulls that option's own nested grants into
   * the tree, so a key that ignores the picks serves the pre-choice tree back.
   */
  static #picksKey(choices) {
    return Object.entries(choices ?? {})
      .map(([k, v]) => `${k}=${(v ?? []).join(',')}`)
      .sort()
      .join(';');
  }

  /** Drop picks belonging to a source that is no longer selected. */
  static #dropChoices(dialog, prefix) {
    for (const id of Object.keys(dialog._levelChoices ?? {})) {
      if (id.startsWith(prefix)) delete dialog._levelChoices[id];
    }
  }

  /** Split the level's choices out by the source that owns them. */
  static #choicesWithPrefix(choices, prefix) {
    const out = {};
    for (const [id, picked] of Object.entries(choices ?? {})) {
      if (!id.startsWith(prefix)) continue;
      out[id.slice(prefix.length)] = picked;
    }
    return out;
  }

  static archetypeChoicesFrom(choices = {}) {
    return LevelUpDialog.#choicesWithPrefix(choices, LevelUpDialog.#ARCH_PREFIX);
  }

  static featChoicesFrom(choices = {}) {
    return LevelUpDialog.#choicesWithPrefix(choices, LevelUpDialog.#FEAT_PREFIX);
  }

  /* ── ASI or feat ────────────────────────────────────────────────────── */

  static luSetAsiMode(_event, btn) {
    const dialog = AM.levelUpDialog;
    const mode   = btn.dataset.mode;
    if (!dialog || !['ability', 'feat'].includes(mode)) return;
    dialog._asiMode = mode;
    // Switching away drops the other side's answer, so a stale pick from the
    // mode you abandoned cannot be applied alongside the one you kept.
    if (mode === 'feat') {
      for (const id of AM.levelUpGrants?.asiIds ?? []) delete AM.levelUpGrants.choices[id];
    } else {
      dialog._featUuid = null;
    }
    dialog.render(false);
  }

  static luSelectFeat(_event, btn) {
    const dialog = AM.levelUpDialog;
    if (!dialog) return;
    const uuid = btn.dataset.uuid;
    dialog._featUuid = dialog._featUuid === uuid ? null : uuid;
    LevelUpDialog.#dropChoices(dialog, LevelUpDialog.#FEAT_PREFIX);
    dialog.render(false);
  }

  static luToggleFeatEligible() {
    const dialog = AM.levelUpDialog;
    if (!dialog) return;
    dialog._featOnlyEligible = !dialog._featOnlyEligible;
    dialog._featPage = 0;               // the list just changed length
    dialog.render(false);
  }

  static luToggleFeatMyClass() {
    const dialog = AM.levelUpDialog;
    if (!dialog) return;
    dialog._featMyClassOnly = !dialog._featMyClassOnly;
    dialog._featPage = 0;
    dialog.render(false);
  }

  static luToggleFeatUngated() {
    const dialog = AM.levelUpDialog;
    if (!dialog) return;
    dialog._featUngatedOnly = !dialog._featUngatedOnly;
    dialog._featPage = 0;
    dialog.render(false);
  }

  /* Clicking the order already in force reverses it, the way the maneuver
     picker’s sort buttons behave. */
  static luFeatSort(_event, btn) {
    const dialog = AM.levelUpDialog;
    if (!dialog) return;
    const key = btn.dataset.sort;
    if (!key) return;
    if (dialog._featSort === key) {
      dialog._featSortDir = dialog._featSortDir === 'asc' ? 'desc' : 'asc';
    } else {
      dialog._featSort    = key;
      dialog._featSortDir = 'asc';
    }
    dialog._featPage = 0;
    dialog.render(false);
  }

  static luFeatPage(_event, btn) {
    const dialog = AM.levelUpDialog;
    if (!dialog) return;
    dialog._featPage = Math.max(0, (dialog._featPage ?? 0) + Number(btn.dataset.dir ?? 0));
    dialog.render(false);
  }

  /** Open or close the trade-in list. Collapsed by default — see the template. */
  static luToggleReplace(_event, btn) {
    const dialog = AM.levelUpDialog;
    if (!dialog) return;
    if (btn.dataset.what === 'spell') {
      dialog._showReplaceSpell = !dialog._showReplaceSpell;
    } else {
      const kind = btn.dataset.kind || 'combat';
      const shown = dialog._showReplaceManeuver ?? {};
      dialog._showReplaceManeuver = { ...shown, [kind]: !shown[kind] };
    }
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
      // Already held — from this level's other grants or from the character.
      // Taking it again gains nothing and burns the choice.
      if (ProficiencyLedger.blocks(dialog.actor, model, key, { id: grantId })) {
        ui.notifications.warn(game.i18n.localize('am.grants.duplicate-warn'));
        return;
      }
      picked.push(key);
    }
    store.choices[grantId] = picked;
    dialog._levelChoices = store.choices;
    dialog.render(false);
  }

  /* ── Static actions: level down ─────────────────────────────────────── */

  /** Keep or remove one pick. What the new level cannot have stays removed. */
  static luDownToggle(_event, btn) {
    const dialog = AM.levelUpDialog;
    const id = btn?.dataset?.itemId;
    if (!dialog || !id || btn.dataset.forced === 'true') return;
    if (dialog._downRemove.has(id)) dialog._downRemove.delete(id);
    else dialog._downRemove.add(id);
    dialog.render(false);
  }

  /**
   * Lower the class, or the character to a level. Not the form's submit: a
   * level-down asks first, and a "no" has to leave this window open, which a
   * submit handler cannot. A rebuild then opens the level-up for the first of
   * the levels taken off, and #continueQueue takes it from there.
   */
  static async luApplyLevelDown(_event, btn) {
    const dialog = AM.levelUpDialog;
    const plans = dialog?._downPlans ?? [];
    if (!dialog || !plans.length || dialog._downBusy) return;
    const actor = dialog.actor;
    const byLevel = dialog._downCharTarget !== null;
    const rebuild = byLevel && dialog._downRebuild;
    const remove = [...dialog._downRemove];
    const L = (k, data) => (data ? game.i18n.format(`am.leveldown.${k}`, data) : game.i18n.localize(`am.leveldown.${k}`));
    const esc = (v) => foundry.utils.escapeHTML?.(String(v)) ?? String(v);

    const first = plans[0];
    const charBefore = first.charBefore;
    const charAfter = byLevel ? dialog._downCharTarget : first.charAfter;
    let lead;
    if (rebuild) lead = L('confirm-rebuild', { from: charAfter + 1, to: charBefore });
    else if (byLevel) lead = L('confirm-above', { n: charAfter });
    else if (first.removesClass) lead = L('confirm-remove', { cls: esc(first.className), from: first.current });
    else lead = L('confirm-lower', { cls: esc(first.className), from: first.current, to: first.target });
    const planned = new Set(plans.flatMap(p => p.removeIds));
    const count = plans.reduce((n, p) => n + p.features.length, 0) + remove.filter(id => !planned.has(id)).length;
    const content = [
      `<p>${lead}</p>`,
      `<p>${L('confirm-level', { from: charBefore, to: charAfter })}</p>`,
      count ? `<p>${L('confirm-items', { n: count })}</p>` : '',
      `<p><strong>${dialog._downBackup ? L('confirm-backup') : L('confirm-final')}</strong></p>`
    ].join('');
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: L(rebuild ? 'confirm-title-rebuild' : 'confirm-title'), icon: 'fa-solid fa-arrow-down' },
      content, rejectClose: false, modal: true
    });
    if (!ok) return;

    // Read before anything changes: the levels are renumbered as they go
    const order = rebuild
      ? LevelHistory.levels(actor).filter(l => l.charLevel > charAfter)
          .map(l => ({ charLevel: l.charLevel, classId: l.classId, classUuid: l.classUuid, className: l.className }))
      : null;
    const targets = byLevel ? LevelHistory.classLevelsAt(actor, charAfter) : null;

    dialog._downBusy = true;
    if (btn) btn.disabled = true;
    let done = true;
    try {
      if (byLevel) {
        let backup = dialog._downBackup;
        for (const cls of actor.items.filter(i => i.type === 'class')) {
          const to = targets.get(cls.id) ?? 0;
          const plan = await LevelDownService.plan(actor, cls.id, to);
          if (!plan || plan.target !== to) continue;
          const okOne = await LevelDownService.apply(actor, plan, { remove: remove.filter(id => actor.items.get(id)), backup });
          backup = false;
          if (!okOne) { done = false; break; }
        }
      } else {
        done = await LevelDownService.apply(actor, first, { remove, backup: dialog._downBackup });
      }
    } catch (err) {
      done = false;
      AM.log(1, 'Level down failed:', err);
      ui.notifications.error(L('failed'));
    } finally {
      dialog._downBusy = false;
    }

    if (done) {
      AM.levelUpDialog = null;
      AM.levelUpGrants = null;
      await dialog.close();
      if (rebuild && order?.length) {
        AM.levelQueue = { actorId: actor.id, until: charBefore, rebuild: true, order };
        ui.notifications.info(game.i18n.format('am.levels.rebuild-start', { from: charAfter + 1, to: charBefore }));
        setTimeout(() => AM.openLevelUp(actor), 300);
      }
    } else {
      if (btn) btn.disabled = false;
      dialog._downKey = null;
      dialog.render(true);
    }
  }

  /* ── Static actions: the level list ─────────────────────────────────── */

  /** A level in the list: the whole build, at that level. */
  static luShowLevel(_event, btn) {
    const dialog = AM.levelUpDialog;
    const level = Number(btn?.dataset?.level);
    if (!dialog || !level) return;
    if (['levelup', 'multiclass'].includes(dialog._mode)) dialog.#resetSelections();
    dialog._mode = 'build';
    dialog._buildFocus = level;
    dialog._buildScroll = level;
    dialog._downCharTarget = null;
    dialog._downRebuild = false;
    dialog.render(true);
  }

  /** The list's heading: the whole build, from the top. */
  static luShowBuild(_event, _btn) {
    const dialog = AM.levelUpDialog;
    if (!dialog) return;
    if (['levelup', 'multiclass'].includes(dialog._mode)) dialog.#resetSelections();
    dialog._mode = 'build';
    dialog._buildFocus = null;
    dialog._buildScroll = 'top';
    dialog._downCharTarget = null;
    dialog._downRebuild = false;
    dialog.render(true);
  }

  /** Show or hide the levels ahead. Remembered for the session. */
  static luToggleFuture(_event, _btn) {
    const dialog = AM.levelUpDialog;
    if (!dialog) return;
    AM.buildFuture = !AM.buildFuture;
    if (AM.buildFuture) dialog._buildScroll = 'future';
    dialog.render(false);
  }

  /** Fold or open the levels had on the level-up page. Remembered for the session. */
  static luTogglePast(_event, _btn) {
    const dialog = AM.levelUpDialog;
    if (!dialog) return;
    AM.buildPastCollapsed = !AM.buildPastCollapsed;
    dialog.render(false);
  }

  /** Forget the classes planned for the levels ahead. */
  static luResetPlan(_event, _btn) {
    const dialog = AM.levelUpDialog;
    if (!dialog) return;
    LevelUpDialog.#buildPlans.delete(dialog.actor.id);
    dialog.render(false);
  }

  /** The next level, from the levels ahead: the level-up for that class. */
  static luLevelUpNow(_event, btn) {
    const dialog = AM.levelUpDialog;
    if (!dialog) return;
    const id = btn?.dataset?.classId;
    // A class planned and not taken: the new class page, with it picked
    if (String(id ?? '').startsWith('Compendium.')) {
      dialog._mode = 'multiclass';
      dialog._downCharTarget = null;
      dialog._downRebuild = false;
      dialog.#resetSelections();
      dialog._newClassUuid = id;
      dialog.render(true);
      return;
    }
    dialog._mode = 'levelup';
    if (id && dialog.actor.items.get(id)) dialog._selectedClassId = id;
    dialog._downCharTarget = null;
    dialog._downRebuild = false;
    dialog.#resetSelections();
    dialog.render(true);
  }

  /** The next level: the level-up itself. */
  static luShowNext(_event, _btn) {
    const dialog = AM.levelUpDialog;
    if (!dialog || ['levelup', 'multiclass'].includes(dialog._mode)) return;
    dialog._mode = 'levelup';
    dialog._downCharTarget = null;
    dialog._downRebuild = false;
    dialog.#resetSelections();
    dialog.render(true);
  }

  /** Take this level and every one above it off, then take them again one by one. */
  static luRebuildFrom(_event, btn) {
    const dialog = AM.levelUpDialog;
    const level = Number(btn?.dataset?.level);
    if (!dialog || !(level > 1)) return;
    dialog._mode = 'leveldown';
    dialog._downCharTarget = level - 1;
    dialog._downRebuild = true;
    dialog._downKey = null;
    dialog.render(true);
  }

  /** Take every level above this one off. */
  static luRemoveAbove(_event, btn) {
    const dialog = AM.levelUpDialog;
    const level = Number(btn?.dataset?.level);
    if (!dialog || !level) return;
    dialog._mode = 'leveldown';
    dialog._downCharTarget = level;
    dialog._downRebuild = false;
    dialog._downKey = null;
    dialog.render(true);
  }

  /** End a run of levels here; this level is still taken as normal. */
  static luStopQueue(_event, _btn) {
    const dialog = AM.levelUpDialog;
    AM.levelQueue = null;
    dialog?.render(true);
  }

  /**
   * The class a run of levels takes at this step: the one it went to before,
   * by id while it is on the character, then by compendium source or name -
   * a class the rebuild took off and has already taken again has a new id.
   * @returns {string|null} a class item id, or null for a class not on the character
   */
  static #queueClass(actor, step, queue) {
    const classes = actor.items.filter(i => i.type === 'class');
    // A step names its own class; only a run without steps keeps to queue.classId
    const id = step ? step.classId : (queue?.classId ?? null);
    if (id && actor.items.get(id)) return id;
    if (step?.classUuid) {
      const want = PackFilter.normalizeSource(step.classUuid);
      const bySource = classes.find(c => PackFilter.normalizeSource(c._stats?.compendiumSource ?? c.flags?.core?.sourceId ?? '') === want);
      if (bySource) return bySource.id;
    }
    if (step?.className) {
      const byName = classes.find(c => c.name === step.className);
      if (byName) return byName.id;
    }
    return step ? null : (classes[0]?.id ?? null);
  }

  /**
   * After a level-up: the next level of a run, or its end. The window that
   * just submitted closes itself; the next one opens once it has.
   */
  static async #continueQueue(actor) {
    const queue = AM.levelQueue;
    if (!queue || queue.actorId !== actor.id) return;
    const total = LevelUpService.getTotalLevel(actor);
    if (total >= queue.until) {
      AM.levelQueue = null;
      ui.notifications.info(game.i18n.format(queue.rebuild ? 'am.levels.rebuilt' : 'am.levels.reached', { n: total }));
      return;
    }
    setTimeout(() => AM.openLevelUp(actor), 300);
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
    AM.levelQueue = null;      // nor carry on a run of levels the player walked away from
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
    /* Closed without taking the level - the header's ✕ as much as Cancel - ends
       a run of levels. Left standing, it waited for the next time anyone
       levelled this character and took that over. A submit closes with
       `submitted`, and #continueQueue carries the run on from there. */
    if (!options?.submitted && AM.levelQueue?.actorId === this.actor?.id) AM.levelQueue = null;
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
    // Lowering has its own button; Enter in a field must not level up instead
    if (dialog._mode === 'leveldown' || dialog._mode === 'build') {
      AM.levelUpDialog = dialog;
      throw new Error(game.i18n.localize(dialog._mode === 'build' ? 'am.levels.pick-next' : 'am.leveldown.use-button'));
    }

    /* The level's answers are built as the page draws, and a class's grant tree
       takes seconds to read on a slow server. Submitted before the draw that
       builds them finished, they were missing and the level went to a5e's
       window instead. Built here when missing, or when they belong to another
       class than the one being taken. */
    const store = AM.levelUpGrants;
    const stale = !store
      || (dialog._mode === 'multiclass' ? store.classUuid !== dialog._newClassUuid : !!store.multiclass);
    if (stale && AM.deferToSystemGrants && (dialog._mode === 'levelup' || dialog._mode === 'multiclass')) {
      try { await dialog._prepareContext({}); }
      catch (err) { AM.log(2, 'Level-up answers could not be rebuilt before applying:', err); }
    }

    /* What this level-up adds is recorded on it, so lowering the level later
       knows which maneuvers, spells and feat came with which level. */
    const itemsBefore = new Set(dialog.actor.items.map(i => i.id));
    const totalBefore = LevelUpService.getTotalLevel(dialog.actor);

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
        dialog.actor, dialog._newClassUuid, hpGained, AM.levelUpGrants
      );
      if (!success) return;

      // A run started from the new class page, as from the level-up page
      if (AM.levelQueue?.actorId !== dialog.actor.id && dialog._upTo > totalBefore + 1) {
        AM.levelQueue = { actorId: dialog.actor.id, until: dialog._upTo, classId: null, rebuild: false,
          order: dialog.#planSteps({ from: totalBefore + 2, to: dialog._upTo, defaultKey: dialog._newClassUuid }) };
      }

      if (dialog._selectedManeuverUuids.length || dialog._selectedTraditions.length) {
        await ManeuverService.applyManeuversToActor(
          dialog.actor, dialog._selectedManeuverUuids, dialog._selectedTraditions,
          { spellPoints: !!dialog._maneuverBudget?.kinds?.combat?.spellPoints }
        );
      }
      if (dialog._selectedCantripUuids.length || dialog._selectedSpellUuids.length) {
        await SpellService.applySpellsToActor(
          dialog.actor, [...dialog._selectedCantripUuids, ...dialog._selectedSpellUuids],
          { prepareRoom: SpellService.preparedRoom(dialog.actor) }
        );
      }
      await LevelUpDialog.#featureSpells(dialog);
      const added = dialog.actor.items.find(i => i.type === 'class' && !itemsBefore.has(i.id));
      if (added) {
        await LevelDownService.recordLevelUp(dialog.actor, itemsBefore,
          { classId: added.id, classLevel: 1, charLevel: totalBefore + 1 });
      }
      await LevelUpDialog.#continueQueue(dialog.actor);
      return;
    }

    /* ── Normal level-up submit ── */
    const classes = LevelUpService.getActorClasses(dialog.actor);
    const cls     = classes.find(c => c.id === dialog._selectedClassId) ?? classes[0];
    if (!cls) return;


    const hpGained = dialog.#systemOwnsHp()
      ? 0
      : Math.max(1, LevelUpDialog.#hpFor(dialog, cls.hitDie, conMod));

    /* "Take levels up to N": this level starts a run, each next level going to
       the class planned for it in the levels ahead - a new class included,
       which the run opens on Add New Class (asked 2026-10-03). */
    if (AM.levelQueue?.actorId === dialog.actor.id) AM.levelQueue.classId = cls.id;
    else if (dialog._upTo > totalBefore + 1) {
      AM.levelQueue = { actorId: dialog.actor.id, until: dialog._upTo, classId: cls.id, rebuild: false,
        order: dialog.#planSteps({ from: totalBefore + 2, to: dialog._upTo, defaultKey: cls.id }) };
    }

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
        dialog.actor, dialog._selectedManeuverUuids, dialog._selectedTraditions,
        // Eldritch Maneuvers and the like: picks spend spell points
        { spellPoints: !!dialog._maneuverBudget?.kinds?.combat?.spellPoints }
      );
    }
    if (dialog._selectedCantripUuids.length || dialog._selectedSpellUuids.length) {
      // Room is read after the level is applied and the trade-ins removed: the
      // new level raises the cap, and a swapped-out prepared spell frees a place.
      await SpellService.applySpellsToActor(
        dialog.actor, [...dialog._selectedCantripUuids, ...dialog._selectedSpellUuids],
        { prepareRoom: SpellService.preparedRoom(dialog.actor) }
      );
    }

    // Magic maneuvers need nothing here: their school is a tradition, so they go
    // through the maneuver path above like every other maneuver.

    await LevelUpDialog.#featureSpells(dialog);
    await LevelDownService.recordLevelUp(dialog.actor, itemsBefore,
      { classId: cls.id, classLevel: cls.level + 1, charLevel: totalBefore + 1 });
    await LevelUpDialog.#continueQueue(dialog.actor);
  }

  /**
   * Spells this level's features, and the ones already held, now owe - a
   * domain's next row, "at 5th level you learn ...". After everything else,
   * so the features gained this level are on the actor to be read.
   */
  /**
   * Spell choices this level owes: a sorcerer archetype's next pick, and any
   * feature gained at this level that offers named spells to choose from.
   * Features gained now are read from this level's grant tree - they are not
   * on the actor until the level is applied.
   */
  async #addBonusSpellContext(context, cls, newClassLevel, newTotalLevel) {
    this._bonusSpellChoices = [];
    const { ProseSpells } = await import('../utils/proseSpells.js');
    if (!ProseSpells.enabled || !cls) return;

    const classItem = this.actor.items.get(cls.id);
    const classKey = String(classItem?.system?.slug || cls.name).toLowerCase().replace(/[^a-z]/g, '');
    const next = { classKey, classLevel: newClassLevel, charLevel: newTotalLevel };
    const grants = AM.levelUpGrants;
    const newDocs = grants?.absorb ? await ProseSpells.docsFromGrantModels(grants.features, grants.choices) : [];

    const cacheKey = `${cls.id}|${newClassLevel}|${newTotalLevel}|${newDocs.map(d => d.uuid).sort().join(',')}`;
    if (this._bonusCache?.key !== cacheKey) {
      const lookup = await ProseSpells.lookup();
      const owned = this.actor.items.filter(i => ProseSpells.TYPES.has(i.type))
        .map(doc => ({ doc, isNew: false, level: ProseSpells.levelFor(this.actor, doc, next) }));
      const gained = newDocs.map(doc => ({ doc, isNew: true, level: ProseSpells.levelFor(this.actor, doc, next) }));
      const choices = ProseSpells.owedChoices([...owned, ...gained], lookup, {
        done:  new Set(this.actor.getFlag(AM.ID, ProseSpells.FLAG) ?? []),
        known: new Set(this.actor.items.filter(i => i.type === 'spell').map(i => i.name.toLowerCase()))
      });
      /* The ones features give outright at the new level, for the spell list to
         mark known - every feature's, not only the new ones': a culture's
         Darkness from 3rd level was still offered at 3rd, and picked as well
         it came twice (reported 2026-10-09). */
      const auto = new Set();
      for (const { doc, level } of [...owned, ...gained]) {
        const html = typeof doc.system?.description === 'string' ? doc.system.description : (doc.system?.description?.value ?? '');
        for (const g of ProseSpells.parse(html, lookup, { classKey: ProseSpells.classKeyOf(doc), name: doc.name }).auto) {
          if (!g.atLevel || g.atLevel <= level) auto.add(String(g.name).toLowerCase());
        }
      }
      this._bonusCache = { key: cacheKey, choices, auto };
    }
    this._bonusSpellChoices = this._bonusCache.choices;
    const autoNames = this._bonusCache.auto ?? new Set();
    if ([...autoNames].join('|') !== [...(this._featureSpellNames ?? [])].join('|')) {
      this._featureSpellNames = autoNames;
      // A pick of one of them is dropped: the feature gives it anyway
      const drop = (list) => list.filter(u => !autoNames.has(String(this._allSpellsData ? [...this._allSpellsData.values()].flat().find(sp => sp.uuid === u)?.name ?? '' : '').toLowerCase()));
      this._selectedCantripUuids = drop(this._selectedCantripUuids);
      this._selectedSpellUuids   = drop(this._selectedSpellUuids);
    }
    context.bonusSpellChoices = ProseSpells.decorate(this._bonusSpellChoices, this._bonusSpellPicks, 'luToggleBonusSpell');
  }

  static async luToggleBonusSpell(_event, btn) {
    const dialog = AM.levelUpDialog;
    if (!dialog) return;
    const { ProseSpells } = await import('../utils/proseSpells.js');
    if (ProseSpells.toggle(dialog._bonusSpellPicks, dialog._bonusSpellChoices, btn.dataset.choice, btn.dataset.uuid)) {
      dialog.render(false);
    }
  }

  /* The dialog is handed in, not looked up: formHandler clears AM.levelUpDialog
     before it applies anything, so reading it back here found nothing and every
     spell picked in the dialog was dropped. */
  static async #featureSpells(dialog) {
    const actor = dialog?.actor;
    if (!actor) return;
    const { ProseSpells } = await import('../utils/proseSpells.js');
    if (!ProseSpells.enabled) return;
    try { await ProseSpells.ensure(actor); }
    catch (err) { AM.log(1, 'Spells from features could not be added:', err); }
    try { await ProseSpells.applyChoices(actor, dialog._bonusSpellPicks ?? {}, dialog._bonusSpellChoices ?? []); }
    catch (err) { AM.log(1, 'Chosen feature spells could not be added:', err); }
  }
}
