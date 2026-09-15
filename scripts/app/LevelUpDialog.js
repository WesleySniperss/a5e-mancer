import { AM } from '../am.js';
import { LevelUpService } from '../utils/levelUpService.js';
import { DocumentService } from '../utils/documentService.js';
import { ManeuverService, CLASS_MANEUVER_TABLES, getTraditions, traditionAllowed, isMagicSchool } from '../utils/maneuverService.js';
import { SpellService, CLASS_SPELL_TABLES } from '../utils/spellService.js';
import { ItemDescPanel } from '../utils/itemDescPanel.js';
import { GrantAbsorber } from '../utils/grantAbsorber.js';
import { ProficiencyLedger } from '../utils/proficiencyLedger.js';
import { MulticlassRules } from '../utils/multiclassRules.js';

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
    },
    classes: ['a5e-mancer-app', 'am-app', 'am-levelup-dialog'],
    position: { width: 680, height: 760 },
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
        ? await this.#getManeuverInfo(null, 1, { newClass: { name: newClass.name } })
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
        // A second class owes less than a first one; say so before the player
        // commits, since a5e's own window afterwards shows only what is left.
        mcProficiencies: await this.#multiclassProficiencies(newClass),
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

    const avgHP       = info.avgHP + this.#getConMod();
    const maneuverInfo = await this.#getManeuverInfo(selectedClass, newClassLevel);

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
      // The per-level hit points a5e would have written, without CON — it adds
      // CON x level separately when deriving max HP.
      store.charLevel = context.newTotalLevel;
      store.hpValue   = Math.max(1, LevelUpDialog.#hpFor(this, selectedClass.hitDie, 0));

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

  /* ── Context helpers ─────────────────────────────────────────────────── */

  #addManeuverBrowserContext(context, maneuverInfo) {
    if (!maneuverInfo?.newManeuversToLearn) return;
    context.maneuversLoaded = !!this._allManeuversData;
    if (this._allManeuversData) {
      const actorTraditions = ManeuverService.getActorTraditions?.(this.actor) ?? [];
      const allUsed = [...new Set([...actorTraditions, ...this._selectedTraditions])];
      /* Each tradition answers to its own kind: a school to the magic budget and
         degree, anything else to the combat one - and only a kind this level has
         picks left in is offered at all. */
      const kindFor = (key) => maneuverInfo.kinds?.[isMagicSchool(key) ? 'magic' : 'combat'];
      const offered = (key) => { const k = kindFor(key); return !!k?.newToLearn && traditionAllowed(key, k.allowedTraditions); };
      const degreeFor = (key) => kindFor(key)?.maxDegree ?? 0;
      context.inlineTraditions      = LevelUpDialog.#buildTraditionPills(
        this._allManeuversData, allUsed, this._maneuverFilter.tradition, offered, degreeFor);
      context.visibleManeuvers      = LevelUpDialog.#filterManeuvers(
        this._allManeuversData, degreeFor(this._maneuverFilter.tradition), this._maneuverFilter.tradition,
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
      // Expanded lists first: they decide which non-class spells the filter
      // below must let through, and the load applies the filter as it indexes.
      SpellService.collectExpandedLists(this.actor);
      const filter = casting ? SpellService.archetypeSpellFilter(casting) : casterName;
      SpellService.loadSpells(filter, spellInfo.maxLevel ?? 1).then(data => {
        if (this._spellsSource !== source) return;   // loaded for a rule no longer shown
        this._allSpellsData = data;
        this._loadingSpells = false;
        this.render(false);
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
   * Martialist, the Engineers, the Myrmidon) gave nothing; and a multiclass took
   * its degree from one class alone, so 3 fighter and 10 herald were held to
   * 2nd degree where the Adventurer's Guide gives 4th. ManeuverService.maneuverBudget
   * gathers every source; this adds the trade-ins, which free a pick of their
   * own kind.
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
      replaceable: (!newClass && newClassLevel > 1) ? ManeuverService.MANEUVER_REPLACEMENTS_PER_LEVEL : 0
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
    if (!info?.replaceable) return;
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

    context.maneuverReplaceLimit = info.replaceable;
    context.maneuverReplaceUsed  = this._replacedManeuverIds.length;
    // Opened once something is marked, so a swap in progress is never hidden
    context.showReplaceManeuver  = !!this._showReplaceManeuver || this._replacedManeuverIds.length > 0;
    context.knownManeuverList = known.map(m => ({
      id: m.id, name: m.name, img: m.img,
      degree: m.degree, traditionLabel: m.traditionLabel,
      replaced: this._replacedManeuverIds.includes(m.id)
    }));
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
    this._maneuverFilter    = { tradition: null };
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
    /* ── Right-click a maneuver/spell/feat card for its full text and costs ── */
    this._detachDescPanel?.();
    this._detachDescPanel = ItemDescPanel.attach(
      this.element,
      '.am-card[data-uuid], .am-maneuver-card[data-uuid], .am-spell-card[data-uuid], [data-lore]'
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
      if (uuids.filter(u => kindOf(picked[u]) === kind).length >= limit) {
        ui.notifications.warn(game.i18n.format('am.maneuvers.slots-full', { n: limit }));
        return;
      }
      if (tradition) {
        const actorTraditions = ManeuverService.getActorTraditions?.(dialog.actor) ?? [];
        // Schools against schools, combat traditions against combat traditions
        const allUsed = new Set([...actorTraditions, ...traditions].filter(t => kindOf(t) === kind));
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
      const limit = dialog._maneuverBudget?.replaceable ?? 0;
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
    if (btn.dataset.what === 'spell') dialog._showReplaceSpell = !dialog._showReplaceSpell;
    else                              dialog._showReplaceManeuver = !dialog._showReplaceManeuver;
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
          dialog.actor, [...dialog._selectedCantripUuids, ...dialog._selectedSpellUuids],
          { prepareRoom: SpellService.preparedRoom(dialog.actor) }
        );
      }
      await LevelUpDialog.#featureSpells(dialog.actor);
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
      // Room is read after the level is applied and the trade-ins removed: the
      // new level raises the cap, and a swapped-out prepared spell frees a place.
      await SpellService.applySpellsToActor(
        dialog.actor, [...dialog._selectedCantripUuids, ...dialog._selectedSpellUuids],
        { prepareRoom: SpellService.preparedRoom(dialog.actor) }
      );
    }

    // Magic maneuvers need nothing here: their school is a tradition, so they go
    // through the maneuver path above like every other maneuver.

    await LevelUpDialog.#featureSpells(dialog.actor);
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
      this._bonusCache = { key: cacheKey, choices };
    }
    this._bonusSpellChoices = this._bonusCache.choices;
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

  static async #featureSpells(actor) {
    const { ProseSpells } = await import('../utils/proseSpells.js');
    if (!ProseSpells.enabled) return;
    try { await ProseSpells.ensure(actor); }
    catch (err) { AM.log(1, 'Spells from features could not be added:', err); }
    const dialog = AM.levelUpDialog;
    if (dialog?.actor === actor) {
      try { await ProseSpells.applyChoices(actor, dialog._bonusSpellPicks, dialog._bonusSpellChoices); }
      catch (err) { AM.log(1, 'Chosen feature spells could not be added:', err); }
    }
  }
}
