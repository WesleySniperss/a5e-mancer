import { AM } from '../am.js';
import { LevelUpDialog } from './LevelUpDialog.js';
import { ManeuverDialog } from './ManeuverDialog.js';
import { FeatDialog } from './FeatDialog.js';
import { SpellDialog } from './SpellDialog.js';
import { SpellService } from '../utils/spellService.js';
import { PackFilter } from '../utils/packFilter.js';
import { FeatService } from '../utils/featService.js';
import { ManeuverService } from '../utils/maneuverService.js';
import { ConditionSource } from '../utils/conditionSource.js';
import { ItemRepair } from '../utils/itemRepair.js';
import { patchInPlace, snapshot } from '../utils/livePatch.js';

const MODULE_ID = 'a5e-mancer';

/* Same gradient A5e uses for multi-level condition counters */
const _SHEET_DUR_COLORS = { 1:'#919f00', 2:'#a09200', 3:'#af8300', 4:'#bd7100', 5:'#cb5c00', 6:'#d63f00', 7:'#e00006', 8:'#e00006', 9:'#e00006' };

/* ── Ability & skill config ─────────────────────────── */
const ABILITIES = [
  { key: 'str', label: 'Strength',      abbr: 'STR' },
  { key: 'dex', label: 'Dexterity',     abbr: 'DEX' },
  { key: 'con', label: 'Constitution',  abbr: 'CON' },
  { key: 'int', label: 'Intelligence',  abbr: 'INT' },
  { key: 'wis', label: 'Wisdom',        abbr: 'WIS' },
  { key: 'cha', label: 'Charisma',      abbr: 'CHA' }
];

const SKILLS = [
  { key: 'acrobatics',    label: 'Acrobatics',     ability: 'DEX' },
  { key: 'animalHandling',label: 'Animal Handling', ability: 'WIS' },
  { key: 'arcana',        label: 'Arcana',          ability: 'INT' },
  { key: 'athletics',     label: 'Athletics',       ability: 'STR' },
  { key: 'culture',       label: 'Culture ✦',       ability: 'INT' },
  { key: 'deception',     label: 'Deception',       ability: 'CHA' },
  { key: 'engineering',   label: 'Engineering ✦',   ability: 'INT' },
  { key: 'history',       label: 'History',         ability: 'INT' },
  { key: 'insight',       label: 'Insight',         ability: 'WIS' },
  { key: 'intimidation',  label: 'Intimidation',    ability: 'CHA' },
  { key: 'investigation', label: 'Investigation',   ability: 'INT' },
  { key: 'medicine',      label: 'Medicine',        ability: 'WIS' },
  { key: 'nature',        label: 'Nature',          ability: 'INT' },
  { key: 'perception',    label: 'Perception',      ability: 'WIS' },
  { key: 'performance',   label: 'Performance',     ability: 'CHA' },
  { key: 'persuasion',    label: 'Persuasion',      ability: 'CHA' },
  { key: 'religion',      label: 'Religion',        ability: 'INT' },
  { key: 'science',       label: 'Science ✦',       ability: 'INT' },
  { key: 'sleightOfHand', label: 'Sleight of Hand', ability: 'DEX' },
  { key: 'stealth',       label: 'Stealth',         ability: 'DEX' },
  { key: 'survival',      label: 'Survival',        ability: 'WIS' }
];

/* a5e skill proficiency runs 0 to 2 — see the NumberField in
   dataModels/actor/common.ts, min 0 max 2 — where 1 already means
   proficient and 2 means expertise. This sheet had dnd5e's four steps, so
   a proficient skill drew the half-filled circle and, wherever a5e did not
   supply a total of its own, took half the proficiency bonus. */
const PROF_LABELS = ['Not proficient', 'Proficient', 'Expertise'];
const PROF_MULTIPLIERS = [0, 1, 2];

/* Object types a5e has no plural label for still need a readable heading. */
/* Turns a description into a one-line subtitle. It has to undo two things
   that were showing through raw on the sheet: Foundry's enricher syntax,
   where @UUID[…]{Produce Flame} should read as just 'Produce Flame', and
   HTML entities, where &nbsp; was being printed literally because stripping
   tags leaves entities behind. */
const plainText = (html) => String(html ?? '')
  .replace(/@UUID\[[^\]]+\]\{([^}]*)\}/g, '$1')
  .replace(/@\w+\[[^\]]*\]\{([^}]*)\}/g, '$1')
  .replace(/@\w+\[([^\]]*)\]/g, '$1')
  .replace(/<[^>]*>/g, ' ')
  .replace(/&nbsp;/g, ' ')
  .replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'")
  .replace(/\s+/g, ' ')
  .trim();

const titleCase = (s) => String(s ?? '')
  .replace(/([a-z])([A-Z])/g, '$1 $2')
  .replace(/^./, c => c.toUpperCase());

/* Tidy draws proficiency with Font Awesome circles rather than glyphs; same
   three steps, same order as PROF_LABELS above. */
const PROF_ICON_CLASSES = [
  'fa-regular fa-circle',
  'fa-solid fa-circle',
  'fa-solid fa-circle-star'
];

/* A5e uses abbreviated keys in CONFIG.A5E.skills; system.skills uses long keys.
   Map long → abbreviated so rollSkillCheck's dialog path can localise properly. */
const A5E_SKILL_ABBR = {
  acrobatics: 'acr', animalHandling: 'ani', arcana: 'arc', athletics: 'ath',
  culture: 'cul', deception: 'dec', engineering: 'eng', history: 'his',
  insight: 'ins', intimidation: 'itm', investigation: 'inv', medicine: 'med',
  nature: 'nat', perception: 'prc', performance: 'prf', persuasion: 'per',
  religion: 'rel', science: 'sci', sleightOfHand: 'slt', stealth: 'ste',
  survival: 'sur'
};

/* ═══════════════════════════════════════════════════════ */
export class A5eCharacterSheet extends ActorSheet {

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      /* Tidy's Quadrone rules are scoped to
           .tidy5e-sheet.application:where(.quadrone.actor) …
         so the root has to carry every one of those classes for the design to
         land. 'application' is what ApplicationV2 adds by itself; this is still
         a v1 ActorSheet, so we add it by hand. 'themed' + 'theme-dark' pick
         Tidy's dark palette. 'a5e-mancer-sheet' stays last so our own rules
         still have somewhere to hang. See tidy/README.md.

         'default' takes the sheet out of Carolingian UI's rule for buttons in
         old-style windows, the one rule of theirs that excludes anything:

           body.crlngn-ui .app:not(.default.sheet):not(.pokerole) form button
             { background-color; border; color; margin }

         It weighs (0,5,3), more than any of Tidy's button rules or ours, so
         every button here wore its wash — the spell-slot stars included, lit
         and spent then drawn identically. Reported, three times, as stars
         that do not work: in the world's own log each click wrote the right
         count (1 → 2 → 1 on a cleric), and nothing on the sheet changed. No
         other stylesheet in this world reads .default on a window. */
      classes: ['tidy5e-sheet', 'application', 'sheet', 'default', 'actor', 'character',
                'quadrone', 'themed', 'theme-dark', 'a5e-mancer-sheet'],
      template: `modules/${MODULE_ID}/templates/sheet/tidy-character-sheet.hbs`,
      /* Tidy's own character sheet opens at 740x810; a5e needs a little more
         width for the exertion strip and the expertise-die column. */
      width: 820,
      height: 860,
      resizable: true,
      /* Only the primary strip is a Foundry tab group. The sidebar's two tabs
         use data-sidebar-tab and are switched in activateListeners, because a
         second group nested inside .main-content would be caught by this one. */
      tabs: [{ navSelector: '.actor-tabs', contentSelector: '.main-content', initial: 'favorites' }],
      dragDrop: [{ dragSelector: '.tidy-table-row-container[data-item-id]', dropSelector: '.main-content' }]
    });
  }

  /* ── Window header ────────────────────────────────── */

  /**
   * Items on a real character are often stubs — a name and its actions, every
   * other field at its default. A spell like that shows no description, but
   * also no level, no components and no casting time, because none of them
   * were ever written. The compendium entry still has all of it.
   *
   * It sits in the title bar rather than on the sheet because it is a repair,
   * run once when a character looks empty, not a thing to reach for in play.
   */
  _getHeaderButtons() {
    const buttons = super._getHeaderButtons();
    if (this.actor.isOwner) {
      buttons.unshift({
        label: 'Fill In',
        class: 'am-repair-items',
        icon:  'fa-solid fa-book-medical',
        onclick: () => ItemRepair.run(this.actor)
      });
    }
    return buttons;
  }

  /**
   * Whose colour tints the banner: the player who owns this actor — the one
   * whose character it is, where several own it — or, for an actor no player
   * owns, whoever is looking. Returned as a reference to the custom property
   * Foundry keeps on :root for each user, so a change of colour shows without
   * a render. See "The colour under the banner" in tidy-a5e.css.
   */
  static playerColorVar(actor) {
    const players = game.users?.filter?.((u) => !u.isGM && actor?.testUserPermission?.(u, 'OWNER')) ?? [];
    const player = players.find((u) => u.character?.id === actor?.id) ?? players[0];
    return player ? `var(--user-color-${player.id}, var(--user-color))` : 'var(--user-color)';
  }

  /* The exertion bonus this sheet keeps for a corrected pool. A5e's bonuses
     are keyed by document id, so it is one: sixteen letters and digits. */
  static EXERTION_BONUS_ID = 'amSheetExertion1';

  /**
   * The update that makes an actor's exertion pool `want`.
   *
   * Where the pool is typed in (a monster, or a5e's automation off) that is the
   * field itself. Where a5e works it out — proficiency, or twice it, from the
   * classes' exertion grants, plus exertion bonuses — a stored max is read only
   * when no grant sets the pool, and is overwritten on every prepare otherwise.
   * So the difference goes into one exertion bonus of this sheet's, which a5e
   * adds on its own terms: its rest restores to it, and it is listed, labelled,
   * under Bonuses where it can be seen and removed. Back to what a5e would give,
   * the bonus is removed rather than left at 0.
   *
   * @param {Actor} actor
   * @param {HTMLInputElement|null} input  carries data-path and data-derived
   * @param {number} want
   */
  static exertionMaxUpdate(actor, input, want) {
    const path = input?.dataset?.path || 'system.attributes.exertion.max';
    if (input?.dataset?.derived !== 'true') return { [path]: want };

    const id = A5eCharacterSheet.EXERTION_BONUS_ID;
    const key = `system.bonuses.exertion.${id}`;
    const ours = Number(actor.system?.bonuses?.exertion?.[id]?.formula) || 0;
    const without = (Number(actor.system?.attributes?.exertion?.max) || 0) - ours;
    const delta = want - without;
    if (!delta) {
      const Del = foundry.data?.operators?.ForcedDeletion;
      return Del ? { [key]: new Del() } : { [`system.bonuses.exertion.-=${id}`]: null };
    }
    return { [key]: { formula: String(delta), label: 'Sheet correction', img: 'icons/svg/upgrade.svg' } };
  }

  /** Nothing should keep observing an element that has been torn down. */

  /**
   * Whether a row's star is lit: a5e's own field, or the flag this sheet
   * wrote before it used that field.
   *
   * Only the Favorites tab's rows used to carry this, so a star clicked on
   * Inventory, Magic, Martial or Features did star the item — it appeared
   * under Favorites — while the star that was clicked stayed hollow.
   */
  #starred(item) {
    return !!item?.system?.favorite || !!this._legacyFavorites?.has(item?.id);
  }

  /* ── Redrawing ────────────────────────────────────── */

  /**
   * A number changed, not the sheet.
   *
   * Foundry redraws a v1 sheet whole for every write on its actor. Measured in
   * the browser on Elbranbran (44 items), one point of damage cost 133–170ms
   * inside _render — getData, the template, 358KB of innerHTML, and every
   * listener bound again — and the canvas ticker shares that thread, which is
   * the map hanging whenever anything on the sheet is touched.
   *
   * Foundry says what changed: renderData holds the diff. Where all of it is
   * something livePatch can draw — hit points, exertion, a spell slot — the
   * elements holding those numbers are set in place and this redraw is skipped.
   * Anything else redraws as before, so a change of shape is never patched.
   *
   * force is a deliberate render: the first one, or _onSettingChange and the
   * like. It always goes through.
   *
   * What does need a redraw often comes in a burst. Taking a character from 1
   * hit point to 0, a5e removes Bloodied, adds Unconscious and Incapacitated,
   * and updates Incapacitated — one write each, a server round trip apart —
   * and each asked for its own redraw: four in 1.1 seconds, measured, ~700ms of
   * a blocked page for one click. Foundry's v1 _render also DROPS a request
   * that lands while a redraw is running, so the burst could end on a sheet
   * still showing Bloodied. Requests that follow recent activity are
   * gathered instead, and the sheet is drawn once when REDRAW_QUIET passes
   * with nothing new — see #gather.
   */
  async _render(force = false, options = {}) {
    if (!force) {
      if (this._state === this.constructor.RENDER_STATES.RENDERED) {
        try {
          const shown = patchInPlace(this, options, this.#drawn);
          if (shown) {
            this.#drawn = shown;
            this.#lastActivity = performance.now();
            return;
          }
        } catch (err) {
          /* A rule that throws must cost a redraw, not the change. */
          AM.log(1, 'Drawing an update in place failed; redrawing the sheet.', err);
        }
      }
      if (this.#gather(options)) return;
    }
    clearTimeout(this.#gathered);
    this.#gathered = null;
    this.#lastActivity = performance.now();
    /* Taken here, before super's first await, so it is the actor getData
       reads. A change landing mid-redraw is held by #gather and redrawn. Not
       taken when super is about to turn the request away (a redraw already
       running, or the window closing): the sheet would not show it. */
    const S = this.constructor.RENDER_STATES;
    if (this._state !== S.RENDERING && this._state !== S.CLOSING) this.#drawn = snapshot(this.actor);
    return super._render(force, options);
  }

  /* What the sheet on screen was drawn from — see snapshot in livePatch. */
  #drawn = null;

  /** How long a burst has to go quiet before the one redraw it gets. */
  static REDRAW_QUIET = 500;

  /* When the sheet last changed, and the redraw waiting on quiet. */
  #lastActivity = 0;
  #gathered = null;

  /**
   * Hold this render request back, to be drawn with the rest of its burst.
   *
   * Held: any request while a redraw is running, which Foundry would drop;
   * and a document's request (renderContext set) within REDRAW_QUIET of the
   * last change or while one is already held. Not held: a request the sheet
   * makes of itself — a spell book picked, a search typed — which answers a
   * click and goes at once, and the first change after a quiet spell, so a
   * single action still redraws with no delay.
   *
   * @returns {boolean} true when the request is held
   */
  #gather(options) {
    const S = this.constructor.RENDER_STATES;
    const busy = this._state === S.RENDERING;
    if (!busy && this._state !== S.RENDERED) return false;
    if (!busy && !options.renderContext) return false;
    const recent = performance.now() - this.#lastActivity < A5eCharacterSheet.REDRAW_QUIET;
    if (!busy && !recent && !this.#gathered) {
      this.#lastActivity = performance.now();
      return false;
    }
    this.#lastActivity = performance.now();
    clearTimeout(this.#gathered);
    this.#gathered = setTimeout(() => this.#flush(), A5eCharacterSheet.REDRAW_QUIET);
    return true;
  }

  /** The held redraw: after the one running, if one is; never on a closed sheet. */
  #flush() {
    const S = this.constructor.RENDER_STATES;
    if (this._state === S.RENDERING) {
      this.#gathered = setTimeout(() => this.#flush(), 50);
      return;
    }
    this.#gathered = null;
    if (this._state === S.RENDERED) this.render(false);
  }

  /* ── Data ─────────────────────────────────────────── */
  async getData() {
    const actor  = this.actor;
    const sys    = actor.system;
    const items  = actor.items.contents;
    this._legacyFavorites = new Set(actor.getFlag?.(MODULE_ID, 'favorites') ?? []);

    const profBonus = sys.attributes?.prof ?? sys.proficiencyBonus ?? this.#calcProf(actor);


    /* Abilities */
    const abilities = ABILITIES.map(({ key, label, abbr }) => {
      const d        = sys.abilities?.[key] ?? {};
      const value    = d.value ?? 10;
      const mod      = Math.floor((value - 10) / 2);
      /* a5e keeps save proficiency at system.abilities.<key>.save.proficient,
         and works the save modifier out itself at save.mod. Neither was being
         read: saveProficient and proficient are not fields on an a5e ability,
         so no save ever counted as proficient and every save came out equal
         to its check. That is why the row looked like it was not there — it
         was, showing the same six numbers again.

         The sum is kept only for data with no computed mod on it. */
      const saveData = d.save ?? {};
      const saveProf = !!(saveData.proficient ?? d.saveProficient ?? d.proficient);
      const saveMod  = Number.isFinite(saveData.mod)
        ? saveData.mod
        : (saveProf ? mod + profBonus : mod);
      const saveExpDie = saveData.expertiseDice > 0
        ? `+d${4 + (saveData.expertiseDice - 1) * 2}` : '';
      return { key, label, abbr, value, mod, modStr: sign(mod), saveMod,
               saveModStr: sign(saveMod), saveProf, saveExpDie };
    });

    /* Saving throws (for right sidebar) */
    const savingThrows = abilities.map(a => ({
      key: a.key, abbr: a.abbr, label: a.label,
      mod: a.saveMod, modStr: a.saveModStr, proficient: a.saveProf
    }));

    /* Maneuver DC. a5e works this out itself — 8 + prof + bonuses.maneuverDC
       + the better of STR and DEX — and leaves it at
       system.attributes.maneuverDC, so that figure is taken as it stands and
       the two sheets cannot disagree.

       The sum below is the fallback for data with nothing derived on it. It
       was the only path before, and it left out bonuses.maneuverDC entirely:
       a character with a bonus to the DC was shown a DC without it, on the
       very sheet whose Bonuses tab exists to explain that number. */
    const strMod = abilities.find(a => a.key === 'str')?.mod ?? 0;
    const dexMod = abilities.find(a => a.key === 'dex')?.mod ?? 0;
    const maneuverDCRaw = sys.attributes?.maneuverDC;
    const maneuverDC = Number.isFinite(maneuverDCRaw) && maneuverDCRaw > 0
      ? maneuverDCRaw
      : 8 + profBonus + Math.max(strMod, dexMod);

    /* Proficiencies — A5e stores these in various locations */
    const toArray = v => {
      if (!v) return [];
      if (v instanceof Set) return [...v];
      if (Array.isArray(v)) return v;
      if (typeof v === 'string') return v.split(',').map(s => s.trim()).filter(Boolean);
      if (typeof v === 'object') return Object.values(v).filter(Boolean);
      return [];
    };
    /* A CONFIG.A5E label, falling back to the key made readable. The keys are
       a5e's own ('fire', 'coldIron', 'charmed'), which read badly raw. */
    const label = (group, key) => {
      if (!key) return '';
      const raw = CONFIG?.A5E?.[group]?.[key];
      if (raw) return game.i18n.localize(raw);
      return String(key).replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase());
    };

    const proficiencies = {
      armor:     toArray(sys.proficiencies?.armor     ?? sys.traits?.armorProficiencies),
      weapons:   toArray(sys.proficiencies?.weapons   ?? sys.traits?.weaponProficiencies),
      tools:     toArray(sys.proficiencies?.tools     ?? sys.traits?.toolProficiencies),
      languages: toArray(sys.proficiencies?.languages ?? sys.traits?.languages ?? sys.languages),
      senses:    toArray(sys.senses ? Object.entries(sys.senses)
        .filter(([,v]) => v && v !== 0)
        .map(([k, v]) => `${k.charAt(0).toUpperCase() + k.slice(1)}: ${v} ft.`) : []),

      /* What a creature shrugs off. Both schemas keep these at system.traits
         as arrays of keys, and neither sheet here was reading any of them —
         measured against a5e’s own monster pack, 373 of its 982 creatures
         carry damage immunities and 387 carry condition immunities, and none
         of it reached the screen. On a statblock that is not a detail. */
      damageImmunities:      toArray(sys.traits?.damageImmunities).map(k => label('damageTypes', k)),
      damageResistances:     toArray(sys.traits?.damageResistances).map(k => label('damageTypes', k)),
      damageVulnerabilities: toArray(sys.traits?.damageVulnerabilities).map(k => label('damageTypes', k)),
      conditionImmunities:   toArray(sys.traits?.conditionImmunities).map(k => label('conditions', k))
    };

    /* Skills — use A5e's computed bonus where available */
    const abilMap = Object.fromEntries(abilities.map(a => [a.abbr, a.mod]));
    const skills = SKILLS.map(({ key, label, ability }) => {
      /* a5e stores skills under their ABBREVIATION — system.skills.acr, not
         system.skills.acrobatics. Reading by the long name returned nothing
         for every skill on the sheet, which is why no proficiency and no
         expertise die ever showed: the bonus fell through to a hand
         calculation and the rest came out empty.

         A5E_SKILL_ABBR already held the mapping; it was only being used to
         open the roll dialog. */
      const d       = sys.skills?.[A5E_SKILL_ABBR[key] ?? key] ?? {};
      const abilMod = abilMap[ability] ?? 0;
      const profLvl = d.proficient ?? d.proficiency ?? 0;
      const mult    = PROF_MULTIPLIERS[Math.min(profLvl, 2)] ?? 0;
      // Prefer A5e's derived total; fall back to manual computation
      const bonus   = d.total ?? d.value ?? (abilMod + Math.floor(profBonus * mult));
      const expDie  = d.expertiseDice > 0 ? `+d${4 + (d.expertiseDice - 1) * 2}` : '';
      const profLabel = PROF_LABELS[Math.min(profLvl, 2)] ?? PROF_LABELS[0];
      // Tidy prints the sign and the number in separate spans, and shows a
      // passive score in its own column, so both are precomputed here.
      return {
        key, label, ability, bonus, bonusStr: sign(bonus),
        /* a5e's own key for this skill. configureSkill is given the
           abbreviation — CONFIG.A5E.skills is keyed by it — while the rest
           of this sheet works in long names. */
        abbrKey: A5E_SKILL_ABBR[key] ?? key,
        bonusSign: bonus < 0 ? '-' : '+',
        bonusAbs: Math.abs(bonus),
        profLvl, profLabel,
        profIconClass: PROF_ICON_CLASSES[Math.min(profLvl, 2)] ?? PROF_ICON_CLASSES[0],
        expDie
      };
    });

    /* Resources */
    const hp  = sys.attributes?.hp ?? {};
    /* Exertion. A character keeps it where a5e does, system.attributes.
       exertion; its pool size is a5e's to work out from the character's
       classes, and is typed in only when there is none to work it out from
       (automationAvailable false) — ActorManueverFooter's own rule.

       A monster has nowhere in a5e to keep it: NPCDataModel.ts has no
       exertion field, so Foundry drops any write to system.attributes.
       exertion on an NPC, and a5e draws no exertion for one. Reported as:
       an NPC given maneuvers has no exertion to spend. It is kept on this
       module's flag instead, current and max, both typed in. */
    const npcExertion = actor.type === 'npc';
    const exBase = npcExertion ? `flags.${MODULE_ID}.exertion` : 'system.attributes.exertion';
    const ex  = (npcExertion ? actor.flags?.[MODULE_ID]?.exertion : sys.attributes?.exertion) ?? {};
    /* Where a5e takes the pool from what it is told, the pool is typed in.
       Where it works the pool out, the padlock opens it too: reported as
       exertion not correctable even unlocked. Stored there it would be
       overwritten on the next prepare, so that change goes in as an exertion
       bonus instead — see exertionMaxUpdate. */
    const exDerived = !npcExertion && !!actor.automationAvailable;
    const exMaxEditable = !exDerived || (actor.isOwner && !(actor.flags?.a5e?.sheetIsLocked ?? true));
    const pct01 = (v, max) => Math.round(Math.min(Math.max(v / max, 0), 1) * 100);
    const hpPct = hp.max ? pct01(hp.value ?? 0, hp.max) : 0;
    const exPct = ex.max ? pct01(ex.current ?? 0, ex.max) : 0;
    const hpColor = hpPct < 25 ? '#e05040' : hpPct < 50 ? '#e09020' : '#4a9a4a';

    const resources = {
      hp: { value: hp.value ?? 0, max: hp.max ?? 0, temp: hp.temp ?? 0, pct: hpPct, color: hpColor },
      ac: sys.attributes?.ac?.value ?? sys.attributes?.ac ?? 10,
      initiative: sign(sys.attributes?.initiative?.value ?? sys.attributes?.initiative?.mod ?? 0),
      speed: sys.attributes?.movement?.walk?.distance ?? sys.attributes?.movement?.walk ?? sys.attributes?.speed?.value ?? 30,
      exertion: { current: ex.current ?? ex.value ?? 0, max: ex.max ?? 0, pct: exPct,
                  currentPath: `${exBase}.current`, maxPath: `${exBase}.max`,
                  maxEditable: exMaxEditable, maxDerived: exDerived },
      fatigue: sys.attributes?.fatigue ?? 0,
      strife:  sys.attributes?.strife  ?? 0,
      profBonus: sign(profBonus),
      inspiration: !!(sys.attributes?.inspiration ?? sys.inspiration),
      deathSaves: sys.attributes?.death ?? null
    };

    /* Items categorised — A5e uses type='object' + system.objectType for all physical items */
    const weapons   = items.filter(i => i.type === 'object' && i.system?.objectType === 'weapon')
                            .map(i => this.#weapon(i));
    /* Every maneuver, magic ones included. Magic maneuvers had a section of their
       own once, and this filter kept them out of the list so they would not show
       twice. That section was removed on 2026-08-13 - their school is a
       tradition now, grouped here like any other - but the filter came back on
       2026-09-02 with the method it called, and from then on a caster's magic
       maneuvers were listed nowhere on the sheet. */
    const maneuvers = items.filter(i => ManeuverService.isManeuver(i)).map(i => this.#maneuver(i));
    /* Components for spells that do not carry their own. Reported as: no
       components on spells. In this world 190 of the 211 spells on actors are
       stubs — their actions and nothing else — so there were no components
       to show, on this sheet or on a5e's. 172 of them still record the
       compendium entry they came from, which has them. Read from there for
       display, cached for the session, and never written to the actor: the
       header's repair button is what fills a stub in for good. */
    this._componentsFrom = await A5eCharacterSheet.#componentsFromSource(
      items.filter((i) => i.type === 'spell'));
    const spells    = items.filter(i => i.type === 'spell').map(i => this.#spell(i));
    const features  = items.filter(i => ['feature','background','heritage','culture','destiny'].includes(i.type))
                            .map(i => this.#feature(i));
    const feats       = items.filter(i => i.type === 'feat').map(i => this.#feat(i));
    const allFeatures = [
      ...features.map(f => ({...f, type: 'feature'})),
      ...feats.map(f => ({...f, type: 'feat'}))
    ].sort((a, b) => a.name.localeCompare(b.name));

    const _srcOrder = ['Class', 'Heritage', 'Culture', 'Background', 'Destiny', 'Feat', 'Other'];
    const _fGroups = new Map(_srcOrder.map(s => [s, []]));
    for (const f of allFeatures) {
      const key = _srcOrder.includes(f.source) ? f.source : 'Other';
      _fGroups.get(key).push(f);
    }
    const featuresBySource = [..._fGroups.entries()]
      .filter(([, arr]) => arr.length > 0)
      .map(([source, items]) => ({ source, items }));

    /* What the Features tab can be filtered by. The sources are the groups
       it is already divided into, so a chip per group and nothing invented;
       drawn only when there is more than one, since one chip that selects
       everything is a button that does nothing.

       `hasActive` asks whether any feature is something you DO rather than
       something you have — a5e records that as the action's activation, and
       a feature with none is passive. */
    const featureFilters = {
      sources: featuresBySource.length > 1
        ? featuresBySource.map((g) => ({ key: g.source, label: g.source, count: g.items.length }))
        : [],
      hasActive: allFeatures.some((f) => !!f.activation)
    };

    // Custom counters — stored in actor flags
    const savedCounters = actor.getFlag(MODULE_ID, 'customCounters') ?? [{}, {}];
    const customCounters = [0, 1].map(i => {
      const s   = savedCounters[i] ?? {};
      const val = s.value ?? 0;
      const max = s.max   ?? 0;
      /* The pips are gone from the sheet — the bar says the same thing in the
         width of a bar rather than in a row of circles as long as the maximum
         is high. What the bar needs instead is the percentage. */
      return {
        name: s.name ?? '', value: val, max,
        pct: max > 0 ? pct01(val, max) : 0
      };
    });
    /* ── The lock ─────────────────────────────────────────────────────────
       a5e's sheet opens locked and puts a padlock at the top; unlocking is
       what reveals the edit, delete and configure controls, and what makes
       the fields that describe a character — rather than track it — writable.

       The state is a5e's own flag, not one of ours, so locking on their sheet
       locks this one and the other way about. Someone who does not own the
       character is locked out regardless, exactly as their code does it. */
    const unlocked = actor.isOwner && !(actor.flags?.a5e?.sheetIsLocked ?? true);

    /* ── Resources, the way a5e's core page builds them ───────────────────
       Every key under system.resources, not the four named ones this sheet
       used to read. a5e's prepareResources merges class and archetype
       resources in beside them under their own slug, so reading only
       primary..quaternary silently dropped every resource a class grants.

       max is a formula, not a number — a StringField in the schema, so a max
       of '@prof' or '2 + @abilities.con.mod' came out as 0 here and the
       tracker showed as having none. It is resolved through a5e's own
       getDeterministicBonus, the one utility they export.

       What shows follows their rule: unlocked, every generic slot appears so
       it can be named and given a maximum; locked, only the ones that have a
       maximum or that hide it. That is how a tracker for anything at all gets
       made — unlock, name a free slot, give it a max. */
    const GENERIC_RESOURCES = ['primary', 'secondary', 'tertiary', 'quaternary'];
    const rollData = actor.getRollData?.() ?? {};
    const resolveMax = (formula) => {
      const raw = formula ?? '';
      if (raw === '' || raw === null) return 0;
      const fn = game.a5e?.utils?.getDeterministicBonus;
      if (typeof fn === 'function') {
        const n = fn(String(raw), rollData);
        return Number.isFinite(n) ? n : 0;
      }
      const n = Number(raw);
      return Number.isFinite(n) ? n : 0;
    };

    /* a5e's four unnamed resource slots. Its own sheet has a switch for hiding
       them; this sheet wrote that switch and never read it, so the row kept
       them whatever the setting said. */
    /* ── What each display switch currently decides ─────────────────────
       Made ONCE, here, and read both by the checkbox in Settings and by the
       part of the sheet the switch governs.

       They were two separate expressions, and for three switches they gave
       different answers. The box said `!!flag` — unset reads as OFF — while
       the sheet said the tab or the scores were ON. So a character who had
       never touched the setting saw the maneuver tab with its box unticked:
       ticking it changed nothing on screen, and the box then looked like
       something that would not come off. That is the report.

       The defaults are a5e's, read from ActorGeneralSettingsTab.svelte and
       from where its sheet reads each flag:

         showFavoritesSection  ?? true
         showManeuverTab       ?? true   (ActorSheet.svelte: display ?? true)
         showSpellTab          ?? true
         showPassiveScores     ?? true
         showXP                ?? true   (a character only — see below)
         hideGenericResources  ?? true for an NPC, false for a character

       The two tabs used to default to "has the character any spells or
       maneuvers", on the belief that a5e writes those flags when it grants
       the first one. It does not: nothing in a5e writes them but its settings
       page, and its sheet shows both tabs until they are turned off.

       showXP was forced on for an NPC, because a5e's header always shows a
       monster's XP. But the box was drawn for an NPC too, so on a monster it
       was a box that could never be unticked. a5e does not offer it for an
       NPC at all, and neither does this now. */
    const _fl = actor.flags?.a5e ?? {};
    const _set = (v) => v !== undefined && v !== null;
    const decided = {
      showFavoritesSection: _set(_fl.showFavoritesSection) ? !!_fl.showFavoritesSection : true,
      showManeuverTab: _set(_fl.showManeuverTab) ? !!_fl.showManeuverTab : true,
      showSpellTab:    _set(_fl.showSpellTab) ? !!_fl.showSpellTab : true,
      showPassiveScores: _set(_fl.showPassiveScores) ? !!_fl.showPassiveScores : true,
      showXP: actor.type === 'npc' ? true
              : (_set(_fl.showXP) ? !!_fl.showXP : true),
      hideGenericResources: _set(_fl.hideGenericResources) ? !!_fl.hideGenericResources
                            : actor.type === 'npc',
      /* a5e offers three, not two: hidden, shown, and shown only where a
         container is carrying something. */
      showWeightColumn: [0, 1, 2].includes(Number(_fl.showWeightColumn))
                        ? Number(_fl.showWeightColumn) : 0
    };

    const hideGeneric = decided.hideGenericResources;

    const actorResources = Object.entries(sys.resources ?? {})
      .filter(([key, r]) => key !== 'classResources' && r && typeof r === 'object')
      .filter(([key]) => !(hideGeneric && GENERIC_RESOURCES.includes(key)))
      .map(([key, r]) => {
        const isClassResource = !GENERIC_RESOURCES.includes(key);
        const max   = resolveMax(r.max);
        const value = Number(r.value ?? 0) || 0;
        const show  = unlocked
          ? (!isClassResource || max !== 0 || !!r.hideMax)
          : (!!r.hideMax || max !== 0);
        return {
          key,
          isClassResource,
          label:    r.label ?? '',
          value,
          max,
          maxFormula: r.max ?? '',
          hideMax:  !!r.hideMax,
          per:      r.per ?? '',
          show,
          /* pct01, not pct: the identical helper further down is a const, and
             calling it from up here is a use before initialization — which
             threw out of getData and stopped the sheet opening at all. */
          pct: max > 0 ? pct01(value, max) : 0,
          /* Class resources are stored flat under classResources, as a bare
             number rather than an object with a value on it. */
          path: isClassResource
            ? `system.resources.classResources.${key}`
            : `system.resources.${key}.value`
        };
      })
      .filter(r => r.show);


    /* ── Interactions ─────────────────────────────────────────────────────
       a5e keeps basic actions, downtime and journey activities as items of
       their own type, grouped by interactionType. The list of groups comes
       from CONFIG so it follows a5e rather than a copy kept here. */
    const interactionTypes = CONFIG?.A5E?.interactionTypes ?? {};
    const interactionGroups = Object.entries(interactionTypes).map(([key, i18n]) => ({
      key,
      label: game.i18n.localize(i18n),
      items: items
        .filter(i => i.type === 'interaction' && (i.system?.interactionType ?? 'other') === key)
        .map(i => this.#gear(i))
    })).filter(g => g.items.length);

    /* ── Settings ─────────────────────────────────────────────────────────
       a5e's Settings tab, whose five sub-pages are flattened into sections
       here. Every switch writes the same flag or field a5e writes, so this
       sheet and its own agree about a character rather than each keeping its
       own idea of one. The defaults match a5e's: 10 for a death save, 20 for
       a critical, everything else off unless the flag says otherwise. */
    const fl = actor.flags?.a5e ?? {};
    const abilityOptions = ABILITIES.map(a => ({
      key: a.key, label: a.abbr, selected: false
    }));
    const withSelected = (sel) => abilityOptions.map(o => ({ ...o, selected: o.key === sel }));

    /* Which boxes appear, and what an unset flag reads as, are a5e's — taken
       line by line from its settings sub-pages (ActorGeneralSettingsTab,
       …InventorySettingsTab, …ManeuverSettingsTab, …SpellSettingsTab,
       …RollSettingsTab, …NpcSettingsTab), not written from memory.

       Written from memory they were wrong in two ways. Eight boxes read an
       unset flag as `!!flag`, unticked, where a5e reads it as on — so the box
       said off while a5e went on spending hit dice and running macros. And
       the character-only pages (automation, rolls, exertion, experience) were
       drawn for a monster too, where one of them — experience — was forced on
       and so could never be unticked at all.

       Two defaults come from a5e's world settings rather than a constant, as
       they do in a5e. */
    /* Said out loud when Foundry has made the sheet read-only. It disables
       every input, box and button itself (FormApplication._disableFields)
       and gives no reason, so every switch on this page just refuses to
       move — a report that has come back more than once. */
    const readOnly = this.isEditable ? null
      : (actor.pack && game.packs?.get(actor.pack)?.locked)
        ? 'This sheet is in a locked compendium, so Foundry lets nothing on it change. Import it into the world, or unlock the compendium.'
        : !actor.isOwner
          ? 'You can view this sheet but do not own it, so nothing on it can change.'
          : 'Foundry has made this sheet read-only, so nothing on it can change.';

    const isChar = actor.type === 'character';
    const worldSetting = (key, fallback) => {
      try { const v = game.settings.get('a5e', key); return v ?? fallback; } catch { return fallback; }
    };
    const tracksWeight = fl.trackInventoryWeight ?? true;

    const settings = {
      sheet: [
        /* Each box shows what the sheet is actually doing — see `decided`. */
        { path: 'flags.a5e.showFavoritesSection',          label: 'Show the Favorites section', on: decided.showFavoritesSection },
        { path: 'flags.a5e.showManeuverTab',               label: 'Show the maneuver tab',      on: decided.showManeuverTab },
        { path: 'flags.a5e.showSpellTab',                  label: 'Show the spell tab',         on: decided.showSpellTab },
        { path: 'flags.a5e.showPassiveScores',             label: 'Show passive scores',        on: decided.showPassiveScores },
        isChar && { path: 'flags.a5e.showXP',              label: 'Show experience',            on: decided.showXP },
        { path: 'flags.a5e.hideGenericResources',          label: 'Hide the generic resources', on: decided.hideGenericResources },
        /* Not on a5e's settings pages, but a flag its SpellBook reads — see
           spellGroups for what it governs. */
        { path: 'flags.a5e.showSpellSlots',                label: 'Show spell slots',           on: fl.showSpellSlots ?? true },
      ].filter(Boolean),
      automation: [
        { path: 'flags.a5e.includeAbilityModifiersForSkills', label: 'Include ability modifiers for skills', on: fl.includeAbilityModifiersForSkills ?? true },
        { path: 'flags.a5e.automatePrototypeTokenSize',    label: 'Keep the prototype token sized to the character',
          on: fl.automatePrototypeTokenSize ?? worldSetting('automatePrototypeTokenSize', true) },
        isChar && { path: 'flags.a5e.automateHitDice',       label: 'Spend hit dice automatically',        on: fl.automateHitDice ?? true },
        isChar && { path: 'flags.a5e.automateSpellResources', label: 'Spend spell resources automatically', on: fl.automateSpellResources ?? true },
        isChar && { path: 'flags.a5e.automaticallyExecuteAvailableMacros', label: 'Run item macros automatically', on: fl.automaticallyExecuteAvailableMacros ?? true }
      ].filter(Boolean),
      inventory: [
        /* a5e hides the carried figure altogether when this is off, and hides
           the three settings below it with it. */
        { path: 'flags.a5e.trackInventoryWeight', label: 'Track the weight of what is carried', on: tracksWeight },
        tracksWeight && { path: 'flags.a5e.doubleCarryCapacity', label: 'Double carrying capacity', on: fl.doubleCarryCapacity ?? false },
        tracksWeight && { path: 'flags.a5e.trackCurrencyWeight', label: 'Count coins toward that weight',
          on: !!(fl.trackCurrencyWeight ?? worldSetting('currencyWeight', false)) }
      ].filter(Boolean),
      rest: [
        isChar && { path: 'system.attributes.exertion.recoverOnRest', label: 'Exertion returns on a rest', on: !!sys.attributes?.exertion?.recoverOnRest },
        { path: 'flags.a5e.restoreSpellSlotsOnShortRest',   label: 'Spell slots return on a short rest',  on: fl.restoreSpellSlotsOnShortRest ?? false },
        { path: 'flags.a5e.restoreSpellPointsOnShortRest',  label: 'Spell points return on a short rest', on: fl.restoreSpellPointsOnShortRest ?? true }
      ].filter(Boolean),
      rolls: !isChar ? [] : [
        { path: 'flags.a5e.halflingLuck',    label: 'Halfling luck',      on: fl.halflingLuck ?? false },
        { path: 'flags.a5e.jackOfAllTrades', label: 'Jack of all trades', on: fl.jackOfAllTrades ?? false }
      ],
      /* a5e's NPC Options page: a monster only. */
      npc: isChar ? [] : [
        { path: 'flags.a5e.disableRandomizedHP', label: 'Disable randomized HP rolls', on: fl.disableRandomizedHP ?? false }
      ],
      numbers: !isChar ? [] : [
        { path: 'flags.a5e.deathSaveThreshold',        label: 'Death save threshold',   value: fl.deathSaveThreshold ?? 10 },
        { path: 'flags.a5e.criticalHitThresholdWeapon', label: 'Critical on a weapon',  value: fl.criticalHitThresholdWeapon ?? 20 },
        { path: 'flags.a5e.criticalHitThresholdSpell',  label: 'Critical on a spell',   value: fl.criticalHitThresholdSpell ?? 20 }
      ],
      choices: [
        /* `numeric` on every row, not only the one that needs it: the markup
           reads it off each, and context.mjs samples the first row of a list
           to learn its shape — so a key present on the third row alone reads
           as a key nothing supplies. */
        { path: 'system.attributes.spellcasting',   label: 'Spellcasting ability', numeric: false, options: withSelected(sys.attributes?.spellcasting) },
        tracksWeight && { path: 'flags.a5e.carryCapacityAbility', label: 'Carrying capacity from', numeric: false, options: withSelected(fl.carryCapacityAbility ?? 'str') },
        /* a5e draws this as three buttons, and stores a number. As a checkbox
           it wrote true or false over a setting that has three values, and
           could never choose the third. `numeric` tells the handler to write
           the number back, so a5e's own sheet reads the same thing. */
        { path: 'flags.a5e.showWeightColumn', label: 'Weight column', numeric: true,
          options: [
            { key: '0', label: 'Hidden',            selected: decided.showWeightColumn === 0 },
            { key: '1', label: 'Shown',             selected: decided.showWeightColumn === 1 },
            { key: '2', label: 'With containers',   selected: decided.showWeightColumn === 2 }
          ] }
      ].filter(Boolean)
    };

    /* ── Active effects, as a5e's own Effects tab lists them ──────────────
       Grouped into what is running and what is not, with conditions left out:
       a5e's page skips them too, and the Traits sidebar already shows them as
       tiles you can click. */
    const effectGroups = (() => {
      const ongoing = [], inactive = [];
      for (const e of actor.effects ?? []) {
        if (e.system?.effectType === 'condition') continue;
        const row = {
          id:         e.id,
          name:       e.name,
          img:        e.img || 'icons/svg/aura.svg',
          temporary:  !!e.isTemporary,
          suppressed: !!e.isSuppressed,
          duration:   e.duration?.label ?? ''
        };
        (e.active ? ongoing : inactive).push(row);
      }
      return [
        { key: 'ongoing',  label: 'Ongoing',  items: ongoing },
        { key: 'inactive', label: 'Inactive', items: inactive }
      ].filter(g => g.items.length);
    })();

    /* ── Global bonuses, as a5e's Bonuses tab lists them ──────────────────
       Every category comes from CONFIG.A5E.bonusTypes rather than a list of
       our own, so a category a5e adds later appears here without us knowing
       about it. The buttons call a5e's own actor methods — addBonus,
       configureBonus, duplicateBonus, deleteBonus — so a bonus made here is
       the same bonus its own sheet would make. */
    const bonusTypes = CONFIG?.A5E?.bonusTypes ?? {};
    const bonusLabels = CONFIG?.A5E?.bonusLabels ?? {};
    const bonuses = {
      /* a5e stores these as formula STRINGS, not numbers, and an unset one is
         '' rather than null — so ?? never fired and the field showed blank.
         Blank is right for an empty bonus, but a tab of blank boxes under ten
         empty headings is a tab that looks broken. */
      maneuverDC: sys.bonuses?.maneuverDC ?? '',
      spellDC:    sys.bonuses?.spellDC ?? '',
      categories: Object.entries(bonusTypes).map(([key, i18n]) => {
        const entries = sys.bonuses?.[key] ?? {};
        const fallback = bonusLabels[key]?.defaultName;
        return {
          key,
          label: game.i18n.localize(bonusLabels[key]?.sectionHeader ?? i18n),
          addLabel: game.i18n.localize(bonusLabels[key]?.addButton ?? 'Add'),
          items: Object.entries(entries).map(([id, b]) => ({
            id,
            label:   b?.label || (fallback ? game.i18n.localize(fallback) : key),
            formula: b?.formula ?? '',
            img:     b?.img || ''
          }))
        };
      })
    };
    const hasBonuses = bonuses.categories.some(c => c.items.length);

    /* The first slot with no name yet, so the strip can offer one field to
       name it in rather than two empty counters nobody asked for. */
    const freeIndex = customCounters.findIndex(c => !c.name);
    const freeCounter = { available: freeIndex !== -1, index: Math.max(0, freeIndex) };
    /* The tracker row used to be hidden when it held nothing. Exertion lives
       on it now and every character has that, so there is nothing left to
       guard and the flag is gone with the guard. */
    // All non-weapon objects go to equipment panel
    const equipment = items.filter(i => i.type === 'object' && i.system?.objectType !== 'weapon')
                            .map(i => this.#gear(i));
    const classes   = items.filter(i => i.type === 'class').map(i => this.#classItem(i));

    /* Attunement panel — all items that require attunement (any equip state) */
    const attunementItems = [
      ...weapons.filter(i => i.needsAttune).map(i => ({ ...i, itemType: 'weapon' })),
      ...equipment.filter(i => i.needsAttune).map(i => ({ ...i, itemType: 'gear' }))
    ];
    const attuneCount = attunementItems.filter(i => i.attuned).length;

    /* Maneuvers grouped by tradition */
    const maneuverGroups = this.#groupBy(maneuvers, 'tradition');
    const featsBySource  = this.#groupFeatsBySource(feats);

    /* Spells grouped by level. Filled in below with any level that has slots
       but no spell of its own — see the note there. */
    /* ── Spell books ─────────────────────────────────────────────────────
       a5e keeps spells in books — system.spellBooks on the actor, each spell
       naming its own in system.spellBook — and its Spells page shows one book
       at a time, with a strip to switch between them: drawn when unlocked, or
       when there is more than one. Unlocked, each book has a cog and a bin,
       and the strip a plus. ActorSpellsPage.svelte; so here.

       The book being looked at is remembered on the sheet, as a5e keeps it in
       its temp settings, so a redraw does not jump back to the first.

       One departure, on purpose: a spell naming no book, or a book that is
       gone, is listed under the first book. a5e files those under "none" and
       never draws that list, so they vanish from its sheet — and in the saved
       copy of this world's characters, 74 of their 92 spells name no book.
       Hiding a character's spells is not a thing to copy. */
    const bookIds = Object.keys(sys.spellBooks ?? {});
    const bookOf  = (id) => actor.spellBooks?.get?.(id) ?? sys.spellBooks?.[id] ?? {};
    const currentBook = bookIds.includes(this._spellBook) ? this._spellBook : (bookIds[0] ?? null);
    const abilityName = (key) => ABILITIES.find((a) => a.key === key)?.label ?? key;
    const spellBooks = bookIds.map((id) => {
      const b = bookOf(id);
      const dc = b.stats?.dc;
      const ability = b.stats?.ability && b.stats.ability !== 'default'
        ? b.stats.ability : (sys.attributes?.spellcasting || null);
      return {
        id, name: b.name || 'Spell Book', active: id === currentBook,
        count: spells.filter((s) => s.spellBook === id
          || (id === bookIds[0] && !bookIds.includes(s.spellBook))).length,
        tip: [dc ? `Spell save DC ${dc}` : null, ability ? abilityName(ability) : null].filter(Boolean).join(' · ') || null
      };
    });
    const spellBookNav = unlocked || bookIds.length > 1;
    const bookSpells = !currentBook ? spells : spells.filter((s) => s.spellBook === currentBook
      || (currentBook === bookIds[0] && !bookIds.includes(s.spellBook)));
    const book = currentBook ? bookOf(currentBook) : {};

    /* Moving a spell between books. a5e has no control for it — dropping a
       spell the actor already owns only re-sorts it — so a spell stays in
       whatever book it arrived in. Reported as: we must be able to keep
       spells in different books, as a5e does.

       Three ways, here: drag the spell onto a book in the strip; pick its
       book in the spell's own summary; or sort every spell that names no
       book at once. The last matters because a monster brought over from
       a5e's pack can arrive with its books and not its spells in them —
       Archfey Enchanter in this world has Innate Spellcasting and
       Spellcasting, and 42 spells that name neither — and on a5e's own
       sheet those simply do not show. */
    const unbooked = spells.filter((s) => !bookIds.includes(s.spellBook));
    const spellBookUnsorted = bookIds.length && unbooked.length ? unbooked.length : 0;
    if (bookIds.length > 1) {
      for (const s of spells) {
        s.inBook = bookIds.includes(s.spellBook);
        s.bookChoices = bookIds.map((id) => ({ id, name: bookOf(id).name || 'Spell Book', selected: id === s.spellBook }));
      }
    }

    /* The book's own resources, as a5e's spell footer shows them for the book
       being looked at: spell points and artifact charges, left and total;
       inventions, a total only. A character's total is derived, so unlocked
       it edits the override; a monster edits the total. */
    const res = sys.spellResources ?? {};
    const isCharacter = actor.type === 'character';
    const resourceRow = (key, label, hasCurrent) => ({
      key, label, hasCurrent,
      current: Number(res[key]?.current ?? 0) || 0,
      currentPath: `system.spellResources.${key}.current`,
      max: Number((isCharacter && unlocked ? res[key]?.override : res[key]?.max) ?? 0) || 0,
      maxPath: `system.spellResources.${key}.${isCharacter ? 'override' : 'max'}`
    });
    const spellBookResources = [
      (book.showArtifactCharges ?? false) && resourceRow('artifactCharges', 'Artifact charges', true),
      (book.showSpellInventions ?? false) && resourceRow('inventions', 'Spell inventions', false),
      (book.showSpellPoints ?? false) && resourceRow('points', 'Spell points', true)
    ].filter(Boolean);
    /* a5e passes the book's showSpellSlots to every level heading: off, and
       no stars or slot fields are drawn for this book. */
    const bookShowsSlots = book.showSpellSlots ?? true;

    const spellsByLevel = {};
    const byLevelThenName = (a, b) => a.level - b.level || a.name.localeCompare(b.name);
    spells.sort(byLevelThenName);           // in place, as it always was
    for (const s of bookSpells.slice().sort(byLevelThenName)) {
      const k = s.level === 0 ? 'Cantrips' : `Level ${s.level}`;
      if (!spellsByLevel[k]) spellsByLevel[k] = [];
      spellsByLevel[k].push(s);
    }

    /* Spell slots — A5e stores at system.spellResources.slots keyed by level string, uses 'current' */
    const rawSlots = sys.spellResources?.slots ?? sys.spellcasting?.slots ?? sys.spells ?? {};
    const slotRows = [1,2,3,4,5,6,7,8,9].map(l => {
      const d = rawSlots[String(l)] ?? rawSlots[`spell${l}`] ?? rawSlots[l] ?? {};
      const max      = d.max      ?? 0;
      const override = d.override ?? 0;
      const value    = d.current  ?? d.value ?? 0;
      /* Every level gets a row, slots or none: unlocked, a5e puts its two
         fields on every level heading, which is how a total is given to a
         level that has spells and no slots yet. Whether an EMPTY level gets
         a heading is decided below, from `has`. */
      const has = !!(max || override);
      /* Numbered from 1, and expended when the number is above what is
         left — a5e's own rule, from its ItemListSpellSlots component. The
         number is what the click arithmetic works on, so it is carried
         rather than the index. */
      const pips = Array.from({ length: max }, (_, i) => ({
        n: i + 1, level: l, expended: i + 1 > value
      }));
      /* Unlocked, a5e swaps the stars for two number fields: what is left,
         and how many there are. A character's total is derived from its
         classes, so the field it edits is the override; a monster has no
         classes, and edits the total itself. Both as a5e's component does. */
      const ownMax = actor.type === 'character';
      return { level: l, value, max, pips, has,
               total: ownMax ? override : max, totalField: ownMax ? 'override' : 'max',
               totalIsOverride: ownMax };
    });

    /* Keyed as the spell groups are keyed, so each level heading carries its
       own slots — and carries the stars themselves, not a count.

       There used to be a row of nine tracker cards above the spell list as
       well, each with a pair of hexagon buttons. It said the same thing a
       second time, a long way from the spells it was about, and it is gone:
       the slots for a level now sit on that level's own heading, which is
       where the eye already is when the question comes up. */
    /* a5e's "Show spell slots" switch, read as `?? true` the way its sheet
       reads it. What it governs there is narrower than its name: not whether
       a level's stars are drawn — that is the book's own showSpellSlots,
       which SpellBook.svelte passes to every heading — but whether a level
       with slots and no spells gets a heading at all while the sheet is
       locked. So it is applied below, to the headings. */
    const showSlots = actor.flags?.a5e?.showSpellSlots ?? true;
    const slotsByLevel = Object.fromEntries(slotRows.map(r => [`Level ${r.level}`, r]));
    const spellSlots = bookShowsSlots ? slotsByLevel : {};

    /* A level's slots belong to the level, not to the spells in it.

       Grouping by the spells alone meant a level with slots and no spell of
       its own had no heading — and so nowhere for its slots to appear. A
       prepared caster holding four third-level slots and no third-level spell
       prepared was shown no third-level slots at all. a5e lists the level
       either way, and so does this now: an empty level shows its heading, its
       stars, and no rows.

       Rebuilt in order rather than merged, because {{#each}} walks an object
       in insertion order and a level added afterwards would sit at the end. */
    const spellGroups = {};
    if (spellsByLevel.Cantrips) spellGroups.Cantrips = spellsByLevel.Cantrips;
    for (let l = 1; l <= 9; l++) {
      const k = `Level ${l}`;
      if (spellsByLevel[k]) spellGroups[k] = spellsByLevel[k];
      /* a5e's isSpellLevelVisible: unlocked, every level that has slots or
         an override; locked, only those with slots to spend, and only while
         the switch is on. */
      else if (slotsByLevel[k].has && (unlocked || (showSlots && slotsByLevel[k].max > 0))) spellGroups[k] = [];
    }

    /* Fatigue/Strife pip arrays */
    const fatiguePips  = Array.from({ length: 6 }, (_, i) => ({ i, active: i < resources.fatigue }));
    const strifePips   = Array.from({ length: 6 }, (_, i) => ({ i, active: i < resources.strife  }));
    const exMax        = resources.exertion.max || 0;
    const exCur        = resources.exertion.current || 0;
    const exertionPips = Array.from({ length: Math.min(exMax, 20) }, (_, i) => ({ i, active: i < exCur }));

    /* Fatigue / Strife level descriptions (A5e rules) */
    const FATIGUE_DESCS = [
      null,
      'Disadvantage on ability checks.',
      'Speed halved.',
      'Disadvantage on attack rolls and saving throws.',
      'Hit point maximum halved.',
      'Speed reduced to 5 ft.',
      'Death.'
    ];
    const STRIFE_DESCS = [
      null,
      'Disadvantage on ability checks.',
      "Can't take reactions.",
      'Disadvantage on attack rolls and saving throws.',
      'Action or bonus action — not both.',
      'Speed halved.',
      'Incapacitated.'
    ];
    const fatigueDesc = FATIGUE_DESCS[Math.min(resources.fatigue, 6)] ?? null;
    const strifeDesc  = STRIFE_DESCS[Math.min(resources.strife,  6)] ?? null;

    /* Status conditions — all defined effects + which are active on this actor */
    // A5e stores active conditions as effects with effect.conditionId; also check actor.statuses
    const activeCondIds = new Set([
      ...(actor.statuses ?? []),
      ...(actor.effects ?? [])
        .filter(e => !e.disabled && e.conditionId)
        .map(e => e.conditionId)
    ]);
    // Deduplicate by id (A5e often re-registers standard conditions),
    // preferring the entry that has a description
    const _condMap = new Map();
    for (const s of (CONFIG.statusEffects ?? [])) {
      if (!s.id || !(s.label || s.name)) continue;
      const existing = _condMap.get(s.id);
      const hasDesc  = !!(s.description || s.hint);
      if (!existing || (!_condMap.get(s.id)._hasDesc && hasDesc)) {
        _condMap.set(s.id, { ...s, _hasDesc: hasDesc });
      }
    }
    const _stripHtml = h => h.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    const _durations = actor.getFlag?.('a5e-mancer', 'durations') ?? {};
    const statusConditions = [..._condMap.values()]
      .map(s => {
        const rawDesc = s.description ? game.i18n.localize(s.description)
                      : s.hint        ? game.i18n.localize(s.hint)
                      : '';
        return {
          id:          s.id,
          label:       game.i18n.localize(s.label ?? s.name),
          icon:        s.icon ?? s.img ?? 'icons/svg/mystery-man.svg',
          description: rawDesc ? _stripHtml(rawDesc) : '',
          active:      activeCondIds.has(s.id),
          duration:    _durations[s.id] ?? null,
          durationColor: _SHEET_DUR_COLORS[_durations[s.id]] ?? null
        };
      })
      .sort((a, b) => {
        const aGen = a.id.startsWith('generic');
        const bGen = b.id.startsWith('generic');
        if (aGen !== bGen) return aGen ? 1 : -1;
        return a.label.localeCompare(b.label);
      });

    /* Currency */
    const currency = sys.currency ?? sys.wealth ?? { gp: 0, sp: 0, cp: 0, ep: 0, pp: 0 };

    /* The spell save DC a5e keeps on the actor. A spellbook may carry its own,
       which is what a spell rolls against; this is the actor-wide figure a5e
       itself falls back to, and the companion to the maneuver DC already
       shown. Hidden when there is none, so a character who casts nothing does
       not carry an empty box. */
    /* What the Settings tab actually decides on this sheet.

       These are a5e own flags and its sheet reads them to choose what to draw.
       This one wrote them and then drew everything regardless, so the switches
       looked dead. The rest of that tab — automation, crit thresholds, rest
       recovery, the spellcasting ability — is read by a5e own code and always
       worked; it simply has nothing to show here.

       The two tabs were `flag || hasItems` once, which let a flag add a tab
       and never take one away; then "the items decide until the flag is set".
       Both rested on a5e writing those flags when it grants a first spell,
       which it does not. Its sheet shows both tabs until they are switched
       off, and so does this — see `decided`. */
    const showPassives = decided.showPassiveScores;
    const showMagicTab   = decided.showSpellTab;
    const showMartialTab = decided.showManeuverTab;

    /* Three more that were written and never read. a5e reads them for its own
       sheet; on this one they did nothing at all, which is exactly the
       complaint. */
    const showFavorites  = decided.showFavoritesSection;
    const showXP         = decided.showXP;
    const hideGenericRes = decided.hideGenericResources;

    const spellDCRaw = sys.attributes?.spellDC;
    const spellDC = Number.isFinite(spellDCRaw) && spellDCRaw > 0 ? spellDCRaw : null;

    /* The figures those bonuses apply TO. a5e own page shows the bonus fields
       alone, which reads well on a sheet that carries the DCs a tab away; here
       they are repeated, because add to the spell DC means little without the
       spell DC beside it. Attached here rather than where bonuses is built,
       which is 160 lines above spellDC exists. */
    bonuses.maneuverDCValue = maneuverDC;
    bonuses.spellDCValue    = spellDC;

    /* A trait list is drawn when it holds something, or when the sheet is
       unlocked — an empty one has to be reachable, or a character with no tool
       proficiencies could never be given the first. */
    const traitSections = Object.fromEntries(
      ['senses', 'languages', 'weapons', 'armor', 'tools',
       'damageImmunities', 'damageResistances', 'damageVulnerabilities',
       'conditionImmunities'].map((k) =>
        [k, !!(proficiencies?.[k]?.length || unlocked)]));

    /* ── Passive scores ───────────────────────────────────────────────────
       Perception, Insight and Investigation — the three read without a roll
       being asked for, which is why a5e keeps them where the eye lands.

       The actor works its own passives out and stores them on the skill, so
       they are read rather than recomputed: any bonus, expertise die or
       effect that a5e counts is already in the number. The 10 + bonus sum
       that stood here agreed with it only when nothing unusual applied, and
       is kept as a fallback for data that predates the field. */
    const passiveOf = (longKey) => {
      const abbr = A5E_SKILL_ABBR[longKey] ?? longKey;
      const own  = sys.skills?.[abbr]?.passive;
      if (Number.isFinite(own)) return own;
      const s = skills.find(x => x.key === longKey);
      return 10 + (s?.bonus ?? 0);
    };

    /* Measured against the real values in Tidy's stylesheet — 13px uppercase
       labels with 0.04em tracking, 16px between chips — the three passives
       written out came to 490px of a strip that only has about 804px, and the
       whole row came to 1054px. That is why it was breaking onto a second
       line. Written short and gathered into one chip they take 228px, which
       brings the strip to 760px. */
    const passives = [
      { key: 'perception',    label: 'Perception',    abbr: 'PER', value: passiveOf('perception') },
      { key: 'insight',       label: 'Insight',       abbr: 'INS', value: passiveOf('insight') },
      { key: 'investigation', label: 'Investigation', abbr: 'INV', value: passiveOf('investigation') }
    ];
    /* Still handed out under its old name: other parts of the sheet ask. */
    const passivePerception = passives[0].value;

    /* Character overview info */
    const totalLevel = classes.reduce((n, c) => n + c.level, 0) || 1;
    const _hItem = items.find(i => i.type === 'heritage');
    const _cItem = items.find(i => i.type === 'culture');
    const _bgItem = items.find(i => i.type === 'background');
    const _dItem  = items.find(i => i.type === 'destiny');
    const charInfo = {
      totalLevel,
      heritage:   _hItem?.name   ?? sys.details?.heritage?.name   ?? '—',
      culture:    _cItem?.name   ?? sys.details?.culture?.name    ?? '—',
      background: _bgItem?.name  ?? sys.details?.background?.name ?? '—',
      destiny:    _dItem?.name   ?? sys.details?.destiny?.name    ?? null,
      // Enriched, not raw: a5e origin text embeds its traits and tables as
      // @UUID/@Embed links which render as empty shells until resolved.
      heritageDesc:   await enrichDesc(descOf(_hItem?.system),  actor),
      cultureDesc:    await enrichDesc(descOf(_cItem?.system),  actor),
      backgroundDesc: await enrichDesc(descOf(_bgItem?.system), actor),
      destinyDesc:    await enrichDesc(descOf(_dItem?.system),  actor),
    };

    /* Magic maneuvers need nothing here any more: their school is a tradition, so
       they are listed, grouped and managed by the maneuver code above. */

    /* Biography written by the creation wizard. Kept as a flag because a5e's
       details schema has no field for backstory, connections, mementos or the
       destiny table results — see ActorCreationService#applyBiography. */
    /* a5e keeps the character's own writing at system.details — the appearance
       fields, the backstory, the notes and the GM-only notes. This sheet was
       reading a flag of the mancer's instead, which only ever holds what the
       builder put there at creation. Anything typed on a5e's sheet since was
       simply not being read, which is why the tab looked empty of everything
       written by hand.

       Both are shown now: a5e's fields first, because they are the character's,
       and the mancer's creation write-ups after. */
    const det = sys.details ?? {};
    const details = {
      fields: [
        { key: 'age',       label: 'Age',        value: det.age       ?? '' },
        { key: 'gender',    label: 'Gender',     value: det.gender    ?? '' },
        { key: 'height',    label: 'Height',     value: det.height    ?? '' },
        { key: 'weight',    label: 'Weight',     value: det.weight    ?? '' },
        { key: 'eyeColor',  label: 'Eyes',       value: det.eyeColor  ?? '' },
        { key: 'hairColor', label: 'Hair',       value: det.hairColor ?? '' },
        { key: 'skinColor', label: 'Skin',       value: det.skinColor ?? '' }
      ],
      bio:   det.bio   ?? '',
      notes: det.notes ?? '',
      /* a5e’s own Notes page has an Appearance editor beside the seven short
         fields; this sheet had the fields and not the editor. */
      appearance: det.appearance ?? '',
      /* bonds, flaws, ideals and goals are in a5e’s character schema as HTML
         fields, and THIS MODULE’S BUILDER WRITES THEM — see
         ActorCreationService, which sets system.details.ideals/bonds/flaws/
         goals at creation. The sheet then read a flag of its own instead, so
         what the builder had just written was never shown again. Measured
         against the world: eleven characters carry bonds, flaws and ideals,
         and nine of them saw none of it.

         a5e’s own sheet does not surface these four either, which is worth
         being plain about: this is the one place here that shows more than
         the original does. They are its fields and its data, and a character
         built by this module has them. */
      bonds:  det.bonds  ?? '',
      flaws:  det.flaws  ?? '',
      ideals: det.ideals ?? '',
      goals:  det.goals  ?? '',
      /* Private notes are the GM's. A player owning the sheet must not see
         them, so they are not put in the context at all rather than hidden
         with a class. */
      privateNotes: game.user.isGM ? (det.privateNotes ?? '') : ''
    };
    details.hasFields = details.fields.some(f => f.value);
    /* Only a character has these; the NPC schema has bio, notes and
       privateNotes and nothing else of the kind. */
    /* Every written page twice over: as stored, for reading, and as plain
       text, for the editor.

       These are HTMLFields. The editor is a textarea, so it has to be handed
       text and not markup, and what it hands back is turned into paragraphs
       again by the detail-html handler. The two conversions are inverses, so
       opening a page and saving it unchanged stores what was already there.

       `…Shown` says whether the block is drawn at all: unlocked, every page
       is, empty or not, because an empty one has to be reachable to be
       filled in; locked, only the ones with something in them.

       That is the whole of the bug this replaces. The editor used to appear
       only while a field was EMPTY — `{{#if details.bio}}` read-only
       `{{else if unlocked}}` editor — so a page could be written once and
       never edited again, and the textarea was rendered with nothing between
       its tags anyway. It was written that way eight times, and all eight
       were wrong in the same direction. */
    const htmlToText = (html) => String(html ?? '')
      .replace(/<\s*br\s*\/?>/gi, '\n')
      .replace(/<\/\s*p\s*>\s*<\s*p[^>]*>/gi, '\n\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
      .trim();

    for (const key of ['appearance', 'bio', 'notes', 'privateNotes',
                       'ideals', 'bonds', 'flaws', 'goals']) {
      /* "[object Object]", stored as the text itself: an earlier builder wrote
         an object where a string belonged, and in this world's saved
         characters bonds, flaws and ideals hold exactly that. It says nothing,
         and on the Backstory page it was said three times. */
      if (/^\s*(<p>)?\s*\[object Object\]\s*(<\/p>)?\s*$/i.test(String(details[key] ?? ''))) details[key] = '';
      details[`${key}Text`]  = htmlToText(details[key]);
      details[`${key}Shown`] = unlocked || !!details[key];
    }

    /* The four personality fields as one list, because the template drew each
       of them by hand and none of the four had an editor once it held
       anything. */
    details.personality = [
      ['ideals', 'Ideals'], ['bonds', 'Bonds'],
      ['flaws', 'Flaws'],   ['goals', 'Goals']
    ].map(([key, label]) => ({
      key, label, path: `system.details.${key}`,
      html: details[key], text: details[`${key}Text`]
    })).filter((f) => unlocked || !!f.html);
    details.personalityShown = details.personality.length > 0;

    details.isCharacter = actor.type === 'character';
    /* a5e shows the private page for the owner of a monster and nobody else.
       That is followed, with one addition: a character that already carries
       something there is still shown it, because hiding what is written is
       worse than showing a page a5e would not have. */
    details.showPrivateNotes = (!details.isCharacter && actor.isOwner)
                            || !!details.privateNotes;
    details.hasPersonality = !!(details.bonds || details.flaws
                              || details.ideals || details.goals);

    const bioFlag = actor.getFlag(MODULE_ID, 'biography') ?? {};
    const bio = {
      backstory:   bioFlag.backstory   ?? '',
      traits:      bioFlag.traits      ?? '',
      connections: bioFlag.connections ?? '',
      mementos:    bioFlag.mementos    ?? '',
      motivation:  bioFlag.destiny?.motivation  ?? '',
      goals:       bioFlag.destiny?.goals       ?? '',
      connection:  bioFlag.destiny?.connection  ?? '',
      fulfillment: bioFlag.destiny?.fulfillment ?? '',
      inspiration: bioFlag.destiny?.inspiration ?? ''
    };
    // Rolled lore-table results, each with the heading it came from
    bio.lore = Array.isArray(bioFlag.lore) ? bioFlag.lore.filter(l => l?.text) : [];

    /* Reported as: Notes and Backstory show the same things twice.

       The builder keeps what it asked for twice on purpose: composed into
       a5e's own fields — backstory, traits, mementos, motivation, inspiration
       and the lore rolls into system.details.notes; connections into bonds;
       destiny goals and fulfilment into goals — so a5e's sheet shows them; and
       each piece verbatim on this module's flag. This sheet drew both: the
       flag as cards under Backstory, and the same text again on the Notes
       page and in Bonds and Goals.

       a5e's fields are the ones a person can edit, and edits land there, so
       they are what is shown. A flag piece is drawn only when none of a5e's
       fields already holds its text — a character made before the builder
       wrote them, or one whose notes were since rewritten. */
    const flat = (html) => htmlToText(html).replace(/\s+/g, ' ').trim().toLowerCase();
    const inNative = flat([det.bio, det.notes, det.appearance, det.bonds, det.goals,
                           det.ideals, det.flaws].join('\n'));
    const already = (html) => { const t = flat(html); return !!t && inNative.includes(t); };
    for (const key of ['backstory', 'traits', 'connections', 'mementos',
                       'motivation', 'goals', 'connection', 'fulfillment', 'inspiration']) {
      if (already(bio[key])) bio[key] = '';
    }
    bio.lore = bio.lore.filter((l) => !already(l.text));

    bio.hasDestiny = !!(bio.motivation || bio.goals || bio.connection
                        || bio.fulfillment || bio.inspiration || bio.lore.length);

    const tidy = this.#tidyContext({ sys, abilities, classes, resources, profBonus, currency,
      spellDC, spellDCBonus: resolveMax(sys.bonuses?.spellDC), attuneCount, flags: fl });
    const inventory = this.#inventory(actor, items);
    const sidebarTab = this._sidebarTab ?? 'skills';
    inventory.objectTypes = Object.entries(CONFIG?.A5E?.objectTypes ?? {})
      .map(([key, label]) => ({ key, label: game.i18n.localize(label) || titleCase(key) }))
      .sort((a, b) => a.label.localeCompare(b.label));

    /* Item descriptions arrive exactly as written, and a5e writes
       @UUID[…]{…} links, @Check[…] prompts and inline rolls into them.
       Those only become links once enrichHTML has run; until then they show
       as raw bracket soup, which is what the summary panels were doing.
       Enriched here, once, over every row object the template can reach —
       the rows are plain objects, so this edits them in place. */
    const enrichRows = async (...lists) => {
      const rows = lists.flat().filter(r => r && typeof r.desc === 'string' && r.desc);
      await Promise.all(rows.map(async (row) => {
        row.desc = await enrichDesc(row.desc, actor);
      }));
    };
    await enrichRows(
      weapons, maneuvers, spells, features, feats, allFeatures, equipment,
      /* The Actions tab arrived after this list was written and was never
         added to it, so basic actions, downtime and journey activities showed
         their @UUID[…]{…} links as raw brackets while every other tab did not. */
      interactionGroups.flatMap(g => g.items),
      inventory.groups.flatMap(g => g.items),
      inventory.groups.flatMap(g => g.items.flatMap(i => i.contents ?? []))
    );

    /* The written pages carry @UUID links, inline rolls and tables, and none of
       it renders until enrichHTML has run over it. */
    details.bio          = await enrichDesc(details.bio, actor);
    details.notes        = await enrichDesc(details.notes, actor);
    details.privateNotes = await enrichDesc(details.privateNotes, actor);
    for (const k of ['appearance', 'bonds', 'flaws', 'ideals', 'goals']) {
      details[k] = await enrichDesc(details[k], actor);
    }
    for (const k of ['backstory', 'traits', 'connections', 'mementos',
                     'motivation', 'goals', 'connection', 'fulfillment']) {
      bio[k] = await enrichDesc(bio[k], actor);
    }

    return {
      actor, system: sys, isOwner: actor.isOwner, isGM: game.user.isGM,
      tidy,
      inventory,
      sidebarTab,
      sidebarOnSkills: sidebarTab === 'skills',
      sidebarOnTraits: sidebarTab === 'traits',
      abilities, skills, resources, classes,
      savingThrows, maneuverDC, proficiencies,
      weapons, maneuvers, maneuverGroups, spells, spellGroups, spellSlots,
      spellBooks, spellBookNav, spellBookResources, spellBookUnsorted,
      features, feats, allFeatures, featuresBySource, featureFilters,
      customCounters, freeCounter,
      effectGroups, bonuses, hasBonuses, interactionGroups, settings,
      /* Which page of the Notes tab is open. a5e opens a character on
         Character Details and a monster on Notes, and remembers the choice
         for as long as the sheet is open — which matters here because
         writing in one of these fields re-renders the whole sheet, and
         without it the tab would snap back on every keystroke saved. */
      notesOn: (() => {
        const fallback = actor.type === 'character' ? 'appearance' : 'bio';
        const on = this._notesTab ?? fallback;
        return { appearance: on === 'appearance', bio: on === 'bio',
                 notes: on === 'notes', privateNotes: on === 'privateNotes' };
      })(),
      unlocked, readOnly, actorResources, equipment, currency,
      showFavorites, showXP, hideGenericRes,
      xp: sys.details?.xp?.value ?? sys.details?.xp ?? 0,
      fatiguePips, strifePips, exertionPips,
      fatigueDesc, strifeDesc, statusConditions,
      attunementItems, attuneCount, passivePerception, passives, spellDC,
      /* Prepared against the most it may hold, as a5e's spell footer counts
         them. Only for a character with a class that prepares by count. */
      spellsPrepared: (() => {
        const cap = SpellService.preparedCap(actor);
        if (cap === null) return null;
        const held = SpellService.preparedHeld(actor);
        return { held, cap, over: held > cap };
      })(),
      showPassives, showMagicTab, showMartialTab, traitSections, charInfo, bio, details,
      hasWeapons:          weapons.length        > 0,
      hasManeuvers:        maneuvers.length      > 0,
      /* A caster with slots and nothing prepared still has a list to show:
         the levels those slots belong to. spellGroups carries a heading for
         every level with slots, spells or none, so it is the thing to ask.

         This was meant to have changed when the slots became stars on the
         headings, and did not — the edit was made with a here-document whose
         failure went unnoticed, and the line stayed as it was for four
         releases. It was found by settingsdo.mjs the moment that check
         started testing every switch instead of six: with `Show spell slots`
         off and on, the page did not move. */
      /* The book being looked at, not the character: an empty second book
         says it is empty rather than drawing nothing under its tab. */
      hasSpells:           bookSpells.length > 0 || Object.keys(spellGroups).length > 0,
      hasFeatures:         features.length       > 0,
      hasEquipment:        equipment.length      > 0,
      hasCombat:           weapons.length + maneuvers.length + spells.length > 0,
      hasAttunementItems:  attunementItems.length > 0,

      // Tag items with type for partial rendering
      ...[...weapons.map(i => ({...i, isWeapon: true})),
          ...maneuvers.map(i => ({...i, isManeuver: true})),
          ...spells.map(i => ({...i, isSpell: true}))].forEach(() => {}),

      /* Favourites tab.

         It lists what the player starred and nothing else — a maneuver
         starred in Martial, a potion starred in Inventory, a skill starred
         in the sidebar. It used to also carry an "All Actions" table that
         swept up every weapon, maneuver and feature that had an action,
         which duplicated the Martial tab and put maneuvers in two places at
         once. That table is gone; nothing arrives here on its own. */
      ...(() => {
        const favoriteIds = new Set([
          ...(actor.getFlag(MODULE_ID, 'favorites') ?? []),
          ...items.filter(i => i.system?.favorite).map(i => i.id),
        ]);
        const favorites = items
          .filter(i => favoriteIds.has(i.id))
          .map(i => this.#buildActionGroup(i, favoriteIds))
          .sort((a, b) => a.name.localeCompare(b.name));
        return {
          favorites,
          hasFavorites: favorites.length > 0,
        };
      })(),

      // Spell level order for template iteration (Handlebars can't do computed keys)
      /* A level with slots and no spells is still a section to draw, so the
         list is shown whenever there is anything to show — spells or slots. */
      spellLevelOrder: ['Level 1','Level 2','Level 3','Level 4','Level 5',
                        'Level 6','Level 7','Level 8','Level 9']
    };
  }

  /* ── Tidy context ─────────────────────────────────
     Everything Tidy's Quadrone markup reads that our own context did not
     already carry. Kept in one place, and separate from the data the old
     layout used, so the two never drift into each other.

     Tidy splits every modifier into a sign and a bare number, because it
     styles them differently — hence the {sign, value} pairs throughout. */
  /* `flags` is the actor's a5e flag bag. It is handed over whole rather than
     a field at a time: this method is a hundred lines from where they are
     read, and every previous addition that needed one was written as though
     the actor were in scope here. It is not. */
  #tidyContext({ sys, abilities, classes, resources, profBonus, currency,
                 spellDC, spellDCBonus, attuneCount, flags }) {
    const split = (n) => ({ sign: n < 0 ? '-' : '+', value: Math.abs(Number(n) || 0) });
    const pct = (v, max) => (max > 0 ? Math.round(Math.min(Math.max(v / max, 0), 1) * 100) : 0);

    /* A5e keeps hit dice per die size — attributes.hitDice.d8.current — where
       dnd5e keeps a single pool, so Tidy's one meter sums them. */
    const hitDice = sys.attributes?.hitDice ?? {};
    let hdValue = 0, hdMax = 0;
    for (const die of Object.values(hitDice)) {
      hdValue += Number(die?.current ?? 0) || 0;
      hdMax   += Number(die?.total ?? die?.max ?? 0) || 0;
    }

    /* Movement and senses are printed in the subtitle. Both are stored either
       as {distance} objects or as bare numbers depending on how the actor was
       made, so read both shapes and drop anything empty. */
    const distanceOf = (v) => Number(v?.distance ?? v?.value ?? v ?? 0) || 0;
    const titleCase  = (s) => s.charAt(0).toUpperCase() + s.slice(1);
    const entries = (obj) => Object.entries(obj ?? {})
      .map(([key, raw]) => ({ key, value: distanceOf(raw) }))
      .filter((e) => e.value > 0)
      .map((e) => ({ label: titleCase(e.key), value: e.value, units: 'ft' }));

    const speeds = entries(sys.attributes?.movement);
    const senses = entries(sys.senses);

    /* Concentration in a5e is a Constitution save plus its own bonus, and is
       rolled by actor.rollConcentrationCheck rather than by a save. */
    const conMod = abilities.find((a) => a.key === 'con')?.saveMod ?? 0;
    const concBonus = Number(
      sys.bonuses?.concentration ?? sys.attributes?.concentration?.bonus ?? 0
    ) || 0;

    /* a5e's CONFIG.A5E.currencyDenominations, in the order a purse is read.
       Credits are the system's sixth denomination and sit in every actor's
       schema, but they belong to its science-fantasy material and are zero on
       an ordinary character, so they appear only when the character has some
       — money that exists is never hidden, and an empty box is never added. */
    const DENOMINATIONS = [
      { key: 'pp', label: 'Platinum' }, { key: 'gp', label: 'Gold' },
      { key: 'ep', label: 'Electrum' }, { key: 'sp', label: 'Silver' },
      { key: 'cp', label: 'Copper' },
      { key: 'cr', label: 'Credits', onlyIfHeld: true }
    ];

    return {
      pb:   split(profBonus),
      init: split(sys.attributes?.initiative?.mod ?? sys.attributes?.initiative?.value ?? 0),
      conc: split(conMod + concBonus),
      hp:   { pct: pct(resources.hp.value, resources.hp.max) },
      hd:   {
        value: hdValue, max: hdMax, pct: pct(hdValue, hdMax),
        /* a5e keeps hit dice per die size, so a single total hides which
           dice are actually left. The breakdown goes in the tooltip. */
        breakdown: Object.entries(hitDice)
          .filter(([, d]) => (Number(d?.total ?? d?.max ?? 0) || 0) > 0)
          .map(([die, d]) => `${die}: ${Number(d?.current ?? 0) || 0}/${Number(d?.total ?? d?.max ?? 0) || 0}`)
          .join(', ')
      },
      portrait: { shape: 'round' },
      /* a5e derives attunement.current itself — requiresAttunement && attuned,
         counted on the actor — and carries its own max, which a feature can
         raise above three. Reading both means this cannot drift from what the
         system sheet shows; the local count is only a fallback. */
      /* a5e's four free-text trackers — the row at the top of its own sheet
         where a player writes whatever the character needs counting: rage
         uses, charges, rations. Each has a label, a value, a max and a
         recharge period. Only the ones given a label are shown; an unnamed
         tracker is an empty slot, not a thing to display. */
      resources: ['primary', 'secondary', 'tertiary', 'quaternary']
        .map((key) => {
          const r = sys.resources?.[key] ?? {};
          const label = String(r.label ?? '').trim();
          if (!label) return null;
          const max = Number(r.max ?? 0) || 0;
          return {
            key, label,
            value: Number(r.value ?? 0) || 0,
            max,
            hideMax: !!r.hideMax || max <= 0,
            pct: max > 0 ? pct(Number(r.value ?? 0) || 0, max) : 0
          };
        })
        .filter(Boolean),

      attunement: {
        current: sys.attributes?.attunement?.current ?? null,
        max: Number(sys.attributes?.attunement?.max ?? 3) || 3,
        /* Attuned to more than the limit allows. a5e marks the offending
           rows; the footer figure says so too, rather than leaving the
           player to compare two numbers. */
        over: attuneCount > (Number(sys.attributes?.attunement?.max ?? 3) || 3)
      },
      speeds,
      senses,
      /* The header draws `Wizard 5  INT DC 15`, exactly as Tidy does, and it
         has been asking for {{this.dc}} and {{this.ability}} since the
         Quadrone rewrite. Neither was ever put here, so the DC half of that
         line has never once appeared on any character.

         The figure follows a5e's own: 8 + prof + bonuses.spellDC + the mod of
         the ability THIS class casts with. Where that is also the actor's
         spellcasting ability, a5e has already derived the same number and it
         is used as it stands, so the two sheets agree to the digit. A class
         that does not cast gets neither field, and the header shows the name
         and level alone. */
      classLine: classes.map((c) => {
        const key = c.castAbility && c.castAbility !== 'none' ? c.castAbility : null;
        const ab  = key ? abilities.find((a) => a.key === key) : null;
        if (!ab) return { name: c.name, levels: c.level, ability: null, dc: null };
        const derived = key === (sys.attributes?.spellcasting || null) ? spellDC : null;
        return {
          name: c.name, levels: c.level, ability: ab.abbr,
          dc: derived ?? (8 + profBonus + (spellDCBonus || 0) + ab.mod)
        };
      }),
      /* Whether the carried figure is drawn at all, which is what a5e's
         own switch decides. */
      trackWeight: flags?.trackInventoryWeight ?? true,
      currencies: DENOMINATIONS
        .map((d) => ({ ...d, value: Number(currency?.[d.key] ?? 0) || 0 }))
        .filter((d) => !d.onlyIfHeld || d.value > 0),
      abilities: abilities.map((a) => ({
        ...a,
        modSign:  a.mod < 0 ? '-' : '+',
        modAbs:   Math.abs(a.mod),
        saveSign: a.saveMod < 0 ? '-' : '+',
        saveAbs:  Math.abs(a.saveMod)
      }))
    };
  }

  /* ── Inventory ────────────────────────────────────
     Ported from a5e's own inventory page rather than invented here, so the
     sheet groups and hides things the way the system does:

       · objects are grouped by system.objectType, with shield and helm
         folded into armor, and anything untyped landing in 'uncategorized'
       · the order of the groups comes from CONFIG.A5E.reducerSortMap
       · an item that lives inside a container is NOT listed at the top
         level — it appears under its container
       · the Uses, Quantity and Weight columns only appear when something
         actually needs them, which is why each has its own test

     Weight is the odd one out: it has a three-state flag rather than a
     boolean, so 'nothing weighs anything' is not the only reason to hide
     it. State 0 hides it always, 1 shows it whenever anything has weight,
     2 shows it only when a container sorts by weight.

     Source: src/view/sheets/pages/ActorInventoryPage.svelte and the
     utils/view/{groupItemsByType,usesRequired,quantityRequired,
     weightRequired}.ts helpers, read out of the system's own a5e.js.map. */
  #inventory(actor, items) {
    /* Search and filters, ported from a5e's ActorInventoryPage and its
       UtilityBar. The filter state is read from — and written back to —
       a5e's own flag, `flags.a5e.filters.objects`, so filtering set here
       shows up on the system's sheet and the other way round.

       The rule a5e uses: an item is hidden if ANY of its filterable values
       is excluded; and when anything is included, an item must match at
       least one of those to show at all. */
    const search = (this._invSearch ?? '').trim().toLowerCase();
    const searchDesc = !!this._invSearchDesc;
    const active = actor.getFlag('a5e', 'filters')?.objects ?? { inclusive: [], exclusive: [] };
    const inclusive = active.inclusive ?? [];
    const exclusive = active.exclusive ?? [];

    const valuesOf = (item) => {
      const out = new Set();
      const acts = item.system?.actions;
      const list = acts instanceof Map ? [...acts.values()] : Object.values(acts ?? {});
      for (const a of list) if (a?.activation?.type) out.add(a.activation.type);
      if (item.system?.rarity) out.add(item.system.rarity);
      if (item.system?.attuned) out.add('attuned');
      if (item.system?.bulky) out.add('bulky');
      if (item.system?.equipped) out.add('equipped');
      if (item.system?.plotItem) out.add('plotItem');
      if (item.system?.requiresAttunement) out.add('requiresAttunement');
      return out;
    };

    const matches = (item) => {
      if (search) {
        const inName = item.name.toLowerCase().includes(search);
        const inDesc = searchDesc &&
          plainText(descOf(item.system)).toLowerCase().includes(search);
        if (!inName && !inDesc) return false;
      }
      if (!inclusive.length && !exclusive.length) return true;
      const values = valuesOf(item);
      for (const v of values) if (exclusive.includes(v)) return false;
      if (inclusive.length) {
        for (const v of values) if (inclusive.includes(v)) return true;
        return false;
      }
      return true;
    };

    const objects = items.filter(i => i.type === 'object' && matches(i));
    /* Column tests and carried weight look at everything, not at what
       survived the filter, so a filtered view does not change the numbers. */
    const allObjects = items.filter(i => i.type === 'object');

    /* Contents of a container are listed under it, so they are kept out of
       the top level. a5e matches on the container's uuid, not its id. */
    const topLevel = objects
      .filter(i => !i.system?.containerId)
      .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));

    const groupKey = (item) => {
      let sub = item.system?.objectType;
      if (['armor', 'shield', 'helm'].includes(sub)) sub = 'armor';
      return sub || 'uncategorized';
    };

    const labels = CONFIG?.A5E?.objectTypesPlural ?? {};
    const sortMap = CONFIG?.A5E?.reducerSortMap?.object ?? {};

    /* Seed the map in the system's own order so empty groups keep their
       place and the list does not reshuffle as items come and go. */
    const grouped = new Map(Object.keys(sortMap).map(k => [k, []]));
    for (const item of topLevel) {
      const key = groupKey(item);
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(item);
    }

    const contentsOf = (container) => objects
      .filter(i => i.system?.containerId === container.uuid)
      .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))
      .map(i => this.#gear(i));

    const groups = [...grouped.entries()]
      .filter(([, list]) => list.length > 0)
      .map(([key, list]) => ({
        key,
        label: game.i18n.localize(labels[key] ?? '') || titleCase(key),
        items: list.map(item => {
          const row = this.#gear(item);
          if (item.system?.objectType === 'container') {
            row.contents = contentsOf(item);
            row.isContainer = true;
          }
          return row;
        })
      }));

    /* Column tests, one per a5e helper. 'Uses' looks at the item and at
       every action on it, because an action can carry its own uses. */
    const actionsOf = (item) => {
      const a = item.system?.actions;
      return a instanceof Map ? [...a.values()] : Object.values(a ?? {});
    };
    const hasUses = (list) => list.some(item =>
      item?.system?.uses?.max || actionsOf(item).some(x => x?.uses?.max));

    /* Read the way a5e reads it; anything other than 0, 1 or 2 is hidden. */
    const weightFlag = [0, 1, 2].includes(Number(actor.getFlag('a5e', 'showWeightColumn')))
      ? Number(actor.getFlag('a5e', 'showWeightColumn')) : 0;
    const anythingWeighs = allObjects.some(i => i.system?.weight);
    const showWeight =
      weightFlag !== 0 && anythingWeighs && (
        weightFlag === 1 ||
        (weightFlag === 2 && allObjects.some(i =>
          i.system?.objectType === 'container' &&
          i.system?.containerSortMethod === 'weight'))
      );

    /* The sections and their labels come from CONFIG.A5E.filters.objects,
       so a system update that adds a filter adds it here too. */
    const filterSections = Object.entries(CONFIG?.A5E?.filters?.objects ?? {})
      .map(([key, section]) => ({
        key,
        label: game.i18n.localize(section.label ?? '') || titleCase(key),
        filters: Object.entries(section.filters ?? {}).map(([fk, f]) => ({
          key: fk,
          label: game.i18n.localize(f?.label ?? '') || titleCase(fk),
          state: exclusive.includes(fk) ? 'exclusive'
               : inclusive.includes(fk) ? 'inclusive' : 'neutral'
        }))
      }))
      .filter(s => s.filters.length > 0);

    return {
      search: this._invSearch ?? '',
      searchDesc,
      filterSections,
      filtersActive: inclusive.length + exclusive.length > 0,
      groups,
      showUses:   hasUses(allObjects),
      showQty:    allObjects.length > 0,
      showWeight,
      carried:    this.#carriedWeight(actor, items),
      isEmpty:    groups.length === 0
    };
  }

  /* Carried weight, ported from a5e's calculateInventoryWeight.

     Only equipped and carried things count, and only at the top level —
     what is inside a container is counted through the container, never
     twice. Supply beyond what the carrying ability allows adds 2 per point,
     and coins weigh 0.02 each when the world or the actor tracks that. */
  #carriedWeight(actor, items) {
    const sys = actor.system ?? {};
    const carryAbility = actor.getFlag('a5e', 'carryCapacityAbility') ?? 'str';
    const abilityValue = sys.abilities?.[carryAbility]?.value ?? 10;

    const itemWeight = items.reduce((acc, item) => {
      if (item.system?.containerId) return acc;          // counted via its container
      const state = item.system?.equippedState ?? 0;
      if (state !== 1 && state !== 2) return acc;         // not carried, not equipped
      const weight = parseFloat(item.system?.weight ?? 0) || 0;
      const qty    = Number(item.system?.quantity ?? 0) || 0;
      return acc + (qty ? weight * qty : weight);
    }, 0);

    const coins = Object.values(sys.currency ?? {})
      .reduce((acc, n) => acc + (Number(n) || 0), 0);
    const excessSupply = 2 * Math.abs(Math.min(abilityValue - (sys.supply ?? 0), 0));

    let trackCoins = actor.flags?.a5e?.trackCurrencyWeight;
    if (trackCoins === undefined) {
      try { trackCoins = game.settings.get('a5e', 'currencyWeight'); } catch { trackCoins = false; }
    }

    const total = itemWeight + excessSupply + (trackCoins ? coins * 0.02 : 0);
    return Math.round(total * 100) / 100;
  }

  /* Range, duration, casting time and saving throw all live on an ACTION in
     a5e, never on the item itself. Reading item.system.range and
     item.system.duration — which is what this sheet did — finds nothing,
     which is why every one of those columns was blank for spells.

     The saving throw is stored differently again: it comes from the
     action's prompts, not from its rolls, so looking for it beside the
     damage found nothing either.

     Ported from a5e's utils/summaries: getRangeLabels, getDurationLabel,
     getActivationCostLabel and getSavingThrowLabel. */
  #actionLabels(item, action) {
    const A = CONFIG?.A5E ?? {};
    const loc = (v) => (v ? game.i18n.localize(v) : '');
    const empty = { activationLabel: null, rangeLabel: null, durationLabel: null, saveLabel: null };
    if (!action) return empty;

    /* Ranges. The three named bands print their distance alongside the name;
       self, touch and five feet are names alone; anything else is a number
       with a unit. */
    const ranges = Object.values(action.ranges ?? {});
    const rangeLabel = ranges.map((r) => {
      const range = r?.range;
      if (!range) return '';
      if (['short', 'medium', 'long'].includes(range)) {
        const feet = A.distanceAbbreviations?.feet ?? 'ft';
        return `${loc(A.rangeDescriptors?.[range]) || range} (${A.rangeValues?.[range] ?? ''} ${feet})`.replace(/\s+/g, ' ');
      }
      if (['fiveFeet', 'self', 'touch'].includes(range)) return loc(A.rangeDescriptors?.[range]) || range;
      if (!r.unit) return String(range);
      return `${range} ${A.distanceAbbreviations?.[r.unit] ?? r.unit}`;
    }).filter(Boolean).join(', ') || null;

    /* Duration. A value of 0 or more than 1 takes the plural period. */
    const duration = action.duration ?? {};
    let durationLabel = null;
    if (duration.unit) {
      const n = this.#formulaToNumber(duration.value ?? '0') ?? 0;
      if (['instantaneous', 'permanent', 'special'].includes(duration.unit)) {
        durationLabel = loc(A.timePeriods?.[duration.unit]) || duration.unit;
      } else {
        const table = (n === 0 || n > 1) ? A.timePeriodsPlural : A.timePeriods;
        durationLabel = `${(n || duration.value) ?? 1} ${loc(table?.[duration.unit]) || duration.unit}`;
      }
      if (item?.type === 'spell' && item.system?.concentration) {
        durationLabel += ` (${loc('A5E.SpellConcentration') || 'Concentration'})`;
      }
      durationLabel = durationLabel.trim();
    }

    /* Casting or activation cost. */
    const activation = action.activation ?? {};
    let activationLabel = null;
    let reactionTrigger = null;
    if (activation.type) {
      if (activation.type === 'reaction') {
        const base = loc('A5E.actions.headings.activation.reaction') || 'Reaction';
        /* a5e writes the whole trigger into this label — 'Reaction (which
           you take when you are targeted by a ranged attack)'. That is a
           sentence, and in a column six characters wide it ran across its
           neighbours. The column gets the word; the trigger is kept apart
           and shown in the summary. */
        activationLabel = base;
        reactionTrigger = activation.reactionTrigger || null;
      } else if (activation.cost === 0 || activation.cost > 1) {
        activationLabel = `${activation.cost} ${loc(A.abilityActivationTypesPlural?.[activation.type]) || activation.type}`;
      } else if (['none', 'special'].includes(activation.type)) {
        activationLabel = loc(A.abilityActivationTypes?.[activation.type]) || activation.type;
      } else {
        activationLabel = `${activation.cost ?? 1} ${loc(A.abilityActivationTypes?.[activation.type]) || activation.type}`;
      }
      if (item?.type === 'spell' && item.system?.ritual) activationLabel += ' (Ritual)';
    }

    /* Saving throw, from the prompts. */
    const prompts = Object.values(action.prompts ?? {});
    const saveLabel = prompts
      .filter((p) => p?.type === 'savingThrow')
      .map((p) => {
        const ability = loc(A.abilities?.[p.ability]) || p.ability || '';
        return p.onSave ? `${ability} (${p.onSave})` : ability;
      })
      .filter(Boolean)
      .join(', ') || null;

    return { activationLabel, reactionTrigger, rangeLabel, durationLabel, saveLabel };
  }

  /* An item's description, or its actions' if it has none of its own.

     Both the item and each action carry a description field in a5e, and a
     generated spell very often has nothing at the item level — which is why
     opening a cantrip showed its actions and no text at all. */
  #itemDesc(item) {
    const own = descOf(item.system);
    if (own) return own;
    const a = item.system?.actions;
    const list = a instanceof Map ? [...a.values()] : Object.values(a ?? {});
    return list.map((x) => x?.description).filter(Boolean).join('\n') || '';
  }

  /* The action a row speaks for: the first one, which is what a5e's own
     summaries use when an item has several. */
  #primaryAction(item) {
    const a = item.system?.actions;
    const list = a instanceof Map ? [...a.values()] : Object.values(a ?? {});
    return list[0] ?? null;
  }

  /* Equipped and damaged state, drawn the way a5e draws them.

     Both are three-state, not two, which is why a single 'equipped or not'
     icon never changed: carried and not-carried looked identical. The icons
     and the active states below are a5e's own, from ItemListData.svelte:

       equipped     2 shield-alt · 1 person-carry-box · 0 tents
       damaged      0 heart      · 1 heart-crack      · 2 heart-pulse

     Active — the lit state — is 'equipped or carried' and 'damaged or
     broken' respectively, so the lit icon always means something is true
     rather than merely set. */
  #stateBadges(item) {
    const sys = item.system ?? {};
    const equipped = Number(sys.equippedState ?? 0);
    const damaged  = Number(sys.damagedState ?? 0);
    const label = (table, key, fallback) => {
      const id = CONFIG?.A5E?.[table]?.[key];
      return id ? game.i18n.localize(id) : fallback;
    };

    /* a5e marks a magic item by its RARITY, not by a flag of its own:
       system.rarity is 'mundane' for the ordinary and one of common,
       uncommon, rare, veryRare, legendary, artifact or varies for the rest.
       Of the 2141 objects in its adventuring-gear pack 782 are mundane and
       1359 are not, and nothing here read the field at all — so a Defender
       Longsword sat on the sheet looking exactly like a torch.

       Put here rather than in either item builder because all three of them
       spread this, so one edit reaches weapons, gear and favourites alike. */
    const rarity  = String(sys.rarity ?? '').trim();
    const magical = !!rarity && rarity !== 'mundane';

    return {
      rarity,
      magical,
      rarityLabel: rarity ? label('itemRarity', rarity, rarity) : '',

      equippedState: equipped,
      equipIcon: ['fa-tents', 'fa-person-carry-box', 'fa-shield-alt'][equipped] ?? 'fa-tents',
      equipLabel: label('equippedStates', equipped, ['Not carried', 'Carried', 'Equipped'][equipped] ?? 'Not carried'),
      equipActive: equipped === 1 || equipped === 2,

      damagedState: damaged,
      damagedIcon: ['fa-heart', 'fa-heart-crack', 'fa-heart-pulse'][damaged] ?? 'fa-heart',
      damagedLabel: label('damagedStates', damaged, ['Intact', 'Damaged', 'Broken'][damaged] ?? 'Intact'),
      damagedActive: damaged === 1 || damaged === 2,

      /* a5e hides the equip control for anything inside a container: what
         is in a bag is neither worn nor carried in its own right. */
      inContainer: !!sys.containerId
    };
  }

  /* ── Item builders ────────────────────────────────── */

  /* Helper: build compact one-liner summary */
  /**
   * Parse A5e action data from an item.
   * Supports both old format (action.attackBonus, action.damage[]) and
   * new format (action.rolls[] with type field).
   */
  #parseActions(item) {
    const sys = item.system ?? {};
    const actionsObj = sys.actions ?? {};

    // EmbeddedCollection has .contents; Map has .values(); plain object uses Object.values()
    const actionList = actionsObj instanceof Map
      ? [...actionsObj.values()]
      : (actionsObj.contents ?? (Array.isArray(actionsObj) ? actionsObj : Object.values(actionsObj)));
    const firstAction = actionList[0] ?? {};

    // New format: rolls[] array with typed entries
    const rolls       = Array.isArray(firstAction.rolls) ? firstAction.rolls : [];
    const attackRoll  = rolls.find(r => r.type === 'attack');
    const damageRolls = rolls.filter(r => r.type === 'damage');
    const saveRoll    = rolls.find(r => r.type === 'savingThrow');

    // Old format fallbacks: direct fields on the action object
    const oldDmgArr  = firstAction.damage ?? firstAction.damages ?? [];
    const oldDmg     = oldDmgArr[0]?.formula ?? oldDmgArr[0]?.dice ?? null;
    const oldAtkBonus = firstAction.attackBonus ?? firstAction.attack?.bonus ?? null;
    const oldSaveDC  = firstAction.save?.dc ? `Save DC ${firstAction.save.dc}` : null;
    const oldDmgType = oldDmgArr[0]?.damageType ?? null;

    const atkBonus = attackRoll?.bonus ?? oldAtkBonus ?? '';
    const dmg      = damageRolls[0]?.formula ?? oldDmg;
    const saveDC   = saveRoll?.dc ? `Save DC ${saveRoll.dc}` : oldSaveDC;

    const rawDmgType = damageRolls[0]?.damageType ?? oldDmgType;
    const dmgType    = rawDmgType
      ? rawDmgType.charAt(0).toUpperCase() + rawDmgType.slice(1)
      : null;

    return {
      firstAction,
      actionList,
      hasActions:  actionList.length > 0,
      activation:  this.#resolveActivation(firstAction, sys),
      atkBonus,
      dmg,
      dmgType,
      dmgFull:     dmg ? (dmgType ? `${dmg} ${dmgType}` : dmg) : null,
      saveDC,
    };
  }

  #weapon(item) {
    const sys = item.system;
    const { activation, atkBonus, dmg, dmgFull, saveDC } = this.#parseActions(item);
    const rng = sys.range ?? {};
    const range = rng.reach
      ? `${rng.reach} ft`
      : (rng.long ? `${rng.short ?? rng.value ?? 0}/${rng.long} ft` :
         rng.value ? `${rng.value} ${rng.units ?? 'ft'}` : null);
    const equippedState = sys.equippedState ?? 1;
    const attuned       = sys.attuned ?? false;
    const needsAttune   = sys.requiresAttunement ?? false;
    const atkBonusFmt = atkBonus !== '' && atkBonus !== null && !isNaN(Number(atkBonus))
      ? sign(Number(atkBonus)) : null;
    return {
      id: item.id, uuid: item.uuid, name: item.name, img: item.img,
      starred: this.#starred(item),
      atkBonus: atkBonusFmt,      // null → tag hidden; signed string → tag shown
      atkBonusCell: atkBonusFmt ?? '—',  // for inventory table column
      dmg: dmg ?? '—', dmgFull,
      range, saveDC,
      equipped:   equippedState === 2,
      carried:    equippedState === 1,
      notCarried: equippedState === 0,
      attuned, needsAttune,
      attuneProblem: needsAttune && !attuned,
      ...this.#stateBadges(item),
      activation,
      desc: this.#itemDesc(item),
      actions: this.#allActionsForItem(item),
    };
  }

  #maneuver(item) {
    const sys = item.system;
    const { activation, dmgFull, saveDC } = this.#parseActions(item);
    const tradition = this.#normTrad(sys.tradition ?? sys.combatTradition ?? '');
    const degree   = sys.degree ?? sys.maneuverDegree ?? 1;
    const exertion = sys.exertionCost ?? sys.cost ?? null;
    const rangeVal = sys.range?.value;
    const range    = rangeVal ? `${rangeVal} ${sys.range?.units ?? 'ft'}` : null;
    return {
      id: item.id, uuid: item.uuid, name: item.name, img: item.img,
      starred: this.#starred(item),
      tradition: tradition || 'Other',
      degree, exertion, activation,
      // Degree and exertion are the cost of a maneuver, and dnd5e has no
      // column for either, so they are shown as tags in the summary panel.
      summaryTags: [
        degree   ? `Degree ${degree}` : null,
        exertion ? `${exertion} exertion` : null,
        sys.prerequisite || null
      ].filter(Boolean),
      range, dmgFull, saveDC,
      desc: this.#itemDesc(item),
      actions: this.#allActionsForItem(item),
    };
  }

  /* Whether a spell's own data marks any component.

     Not whether the field is there: in Foundry a stub's missing components are
     filled in with the schema's defaults when it loads, so a stub reads as a
     spell with none — all three false. That is also what a spell with truly no
     components holds, 14 of a5e's 895; for one of those the source entry has
     none either and nothing is added. The one case read differently is a copy
     whose owner unticked every component the book gives it, which then shows
     the book's. */
  static #hasComponents(c) {
    return !!(c && (c.vocalized || c.seen || c.material));
  }

  /* uuid -> the source entry's components, or null where there is none. */
  static #componentSourceCache = new Map();

  /* For each spell with no components of its own and a compendium source,
     the source's components, materials and whether they are consumed.

     One request per pack, not one per spell. This first shipped reading each
     source through fromUuid, and for a compendium entry that is a trip to the
     server of its own and a whole Item built from it: a character with 49
     stubs opened its sheet only after 49 of them. The ids are gathered by pack
     and asked for together; each uuid still has its own cache entry, so a
     second render, or a second sheet sharing sources, asks for nothing. */
  static async #componentsFromSource(spells) {
    const out = new Map();
    const cache = A5eCharacterSheet.#componentSourceCache;
    const wanted = [];
    const byPack = new Map();   // pack -> Map(id -> resolve)
    for (const i of spells) {
      if (A5eCharacterSheet.#hasComponents((i._source?.system ?? i.system)?.components)) continue;
      const uuid = i._stats?.compendiumSource ?? i.flags?.core?.sourceId;
      if (!uuid) continue;
      wanted.push([i.id, uuid]);
      if (cache.has(uuid)) continue;
      const m = /^Compendium\.([^.]+\.[^.]+)\.(?:Item\.)?([^.]+)$/.exec(uuid);
      const pack = m ? game.packs?.get?.(m[1]) : null;
      if (!pack?.getDocuments) {
        /* Not a pack this world has by that name: the one-at-a-time route. */
        cache.set(uuid, (async () => {
          try { return typeof fromUuid === 'function' ? A5eCharacterSheet.#componentsOf(await fromUuid(uuid)) : null; }
          catch { return null; }
        })());
        continue;
      }
      let ids = byPack.get(pack);
      if (!ids) byPack.set(pack, ids = new Map());
      cache.set(uuid, new Promise((resolve) => ids.set(m[2], { resolve, uuid })));
    }
    for (const [pack, ids] of byPack) {
      pack.getDocuments({ _id__in: [...ids.keys()] })
        .catch(() => null)
        .then((docs) => {
          const byId = new Map((docs ?? []).map((d) => [d.id ?? d._id, d]));
          for (const [id, { resolve, uuid }] of ids) {
            /* A failed read is not remembered, so the next render tries again. */
            if (!docs) cache.delete(uuid);
            resolve(A5eCharacterSheet.#componentsOf(byId.get(id)));
          }
        });
    }
    await Promise.all(wanted.map(async ([id, uuid]) => {
      const found = await cache.get(uuid);
      if (found) out.set(id, found);
    }));
    return out;
  }

  static #componentsOf(doc) {
    const s = doc?.type === 'spell' ? doc.system : null;
    return s?.components ? { components: s.components, materials: s.materials ?? '',
                             materialsConsumed: !!s.materialsConsumed } : null;
  }

  #spell(item) {
    const sys = item.system;
    const { activation, dmgFull, saveDC } = this.#parseActions(item);
    const level    = sys.level ?? sys.spellLevel ?? 0;
    const conc     = sys.concentration ?? false;
    const action   = this.#primaryAction(item);
    const labels   = this.#actionLabels(item, action);
    const range    = labels.rangeLabel;

    const duration = labels.durationLabel;

    // School key may be in sys.schools.primary (A5e) or sys.school (legacy)
    const schoolKey   = sys.schools?.primary ?? sys.school ?? '';
    const schoolI18n  = CONFIG?.A5E?.spellSchools?.primary?.[schoolKey];
    const schoolLabel = schoolI18n
      ? game.i18n.localize(schoolI18n)
      : (schoolKey ? schoolKey.charAt(0).toUpperCase() + schoolKey.slice(1) : '');

    return {
      id: item.id, uuid: item.uuid, name: item.name, img: item.img,
      starred: this.#starred(item),
      level,
      levelLabel: level === 0 ? 'Cantrip' : `Level ${level}`,
      school: schoolKey,
      spellBook: sys.spellBook ?? '',
      summaryTags: [
        labels.reactionTrigger ? `Trigger: ${labels.reactionTrigger}` : null,
        level === 0 ? 'Cantrip' : `Level ${level}`,
        schoolLabel || null,
        conc ? 'Concentration' : null,
        sys.ritual ? 'Ritual' : null
      ].filter(Boolean),
      schoolLabel,
      ritual: sys.ritual ?? false,
      /* Components, as a5e's sheet sets them beside the name: V, S and M,
         its own abbreviations (A5E.spells.components.*Abbr), with what the
         material is in the tooltip. */
      ...(() => {
        const own = A5eCharacterSheet.#hasComponents((item._source?.system ?? item.system)?.components);
        const from = own ? null : this._componentsFrom?.get(item.id);
        const c = from?.components ?? sys.components ?? {};
        const materials = from ? from.materials : sys.materials;
        const consumed  = from ? from.materialsConsumed : sys.materialsConsumed;
        const say = (key, fallback) => {
          const v = game.i18n.localize(key);
          return v && v !== key ? v : fallback;
        };
        const list = [
          c.vocalized && { abbr: say('A5E.spells.components.vocalizedAbbr', 'V'), name: say('A5E.spells.components.vocalized', 'Vocalized') },
          c.seen      && { abbr: say('A5E.spells.components.seenAbbr', 'S'),      name: say('A5E.spells.components.seen', 'Seen') },
          c.material  && { abbr: say('A5E.spells.components.materialAbbr', 'M'),  name: say('A5E.spells.components.material', 'Material')
            + (materials ? ` (${materials}${consumed ? ', consumed' : ''})` : '') }
        ].filter(Boolean);
        return { components: list, componentsTip: list.map((x) => x.name).join(', ') };
      })(),
      concentration: conc,
      /* a5e's three states, 0 unprepared, 1 prepared, 2 always prepared, drawn
         as its own sheet draws them: a book, lit when prepared, with sparkles
         when always. This read `sys.prepared !== false`, which is true for all
         three numbers, and no template drew it at all. */
      ...(() => {
        const state = Number(sys.prepared ?? 0);
        const key   = CONFIG?.A5E?.preparedStates?.[state];
        return {
          preparable:    true,
          prepared:      state > 0,
          preparedState: state,
          /* For the row's colour, as a5e's ItemList.svelte gives it: prepared
             a5e-item--highlight, always prepared a5e-item--purple-highlight. */
          preparedOnly:   state === 1,
          alwaysPrepared: state === 2,
          preparedIcon:  state === 2 ? 'fa-book-sparkles' : 'fa-book',
          preparedLabel: key ? game.i18n.localize(key)
                             : (['Unprepared', 'Prepared', 'Always prepared'][state] ?? 'Unprepared')
        };
      })(),
      activation,
      range, duration, dmgFull,
      /* The saving throw comes from the action's prompts. saveDC, read off
         the rolls beside the damage, is only ever set for the few actions
         that carry one there, so it is the fallback rather than the source. */
      saveDC: labels.saveLabel ?? saveDC,
      castTime: labels.activationLabel,
      col: this.#spellColumns(item, action, labels),
      desc: this.#itemDesc(item),
      actions: this.#allActionsForItem(item),
    };
  }

  /* The spell table's columns, each in the fewest characters that still say
     it. Reported as: the slot stars had no room, and the columns were why —
     four of them at 7rem took 448px of a 542px table at the default width,
     so two were hidden outright and the level heading got what was left.

     Every short form is one the reader already knows: A, BA and R for the
     action economy, as dnd5e and Tidy print them; a target as how many; a
     range in feet. Concentration and ritual are a5e's own C and R, beside
     the name — see tidy-row. The long form a5e writes goes in the tooltip, word for
     word, so a short column loses nothing a hover cannot give back.

     The data shapes are the ones in a5e's spell pack, all 895 entries
     counted: activation action 656, bonusAction 80, minute 99, hour 33,
     reaction 24; ranges self, the three bands, touch, or free text; a target
     type with a quantity, or none and an area instead. */
  #spellColumns(item, action, labels) {
    const A   = CONFIG?.A5E ?? {};
    const loc = (v) => (v ? game.i18n.localize(v) : '');
    const ft  = (loc(A.distanceAbbreviations?.feet) || 'ft').replace(/\.$/, '');
    const PERIOD = { round: 'rd', turn: 'turn', second: 's', minute: 'min', hour: 'hr',
                     day: 'd', week: 'wk', month: 'mo', year: 'yr' };
    const out = {};

    /* Time. A plain action is "A", two of them "2 A"; a minute is "1 min". */
    const act  = action?.activation ?? {};
    const cost = Number(act.cost);
    const n    = Number.isFinite(cost) && cost > 0 ? cost : 1;
    const TURN = { action: 'A', bonusAction: 'BA', reaction: 'R',
                   legendaryAction: 'LA', lairAction: 'Lair', objectInteraction: 'OI' };
    if (TURN[act.type])        out.time = n > 1 ? `${n} ${TURN[act.type]}` : TURN[act.type];
    else if (PERIOD[act.type]) out.time = `${n} ${PERIOD[act.type]}`;
    else if (act.type === 'special') out.time = 'Sp';
    out.timeTip = [labels.activationLabel, labels.reactionTrigger].filter(Boolean).join(' — ') || null;

    /* Range. The bands print their distance, since that is what is measured
       on the table; free text keeps its words with feet and miles shortened. */
    const ranges = Object.values(action?.ranges ?? {});
    const r = ranges[0];
    if (r?.range !== undefined && r.range !== null && r.range !== '') {
      const v = r.range;
      if (['fiveFeet', 'short', 'medium', 'long'].includes(v)) {
        /* a5e's CONFIG.A5E.rangeValues, with its own numbers behind it in
           case a module has emptied the table. */
        const feet = A.rangeValues?.[v] ?? { fiveFeet: 5, short: 30, medium: 60, long: 120 }[v];
        out.range = `${feet} ${ft}`;
      }
      else if (v === 'self' || v === 'touch' || v === 'other') out.range = loc(A.rangeDescriptors?.[v]) || (v[0].toUpperCase() + v.slice(1));
      else if (r.unit) out.range = `${v} ${(loc(A.distanceAbbreviations?.[r.unit]) || r.unit).replace(/\.$/, '')}`;
      /* Free text, as a few dozen of a5e's spells write it: "300 feet", "1 mile",
         "30-foot radius", "100 feet above you". Where it starts with a
         distance the column shows the distance and the tooltip keeps the
         rest; where it does not ("Same plane", "Sight") the words stay, and
         the cell wraps them. */
      else {
        const text = String(v).trim();
        const lead = text.match(/^(\d[\d,]*)[\s-]*(feet|foot|ft\.?|miles?|mi\.?)\b/i);
        out.range = lead
          ? `${lead[1].replace(/,/g, '')} ${/^m/i.test(lead[2]) ? 'mi' : ft}`
          : text;
      }
      if (ranges.length > 1) out.range += '+';
    }
    out.rangeTip = labels.rangeLabel;

    /* Target: how many, or the area when there is no count to give. */
    const t = action?.target ?? {};
    const area = action?.area ?? {};
    const SIZE = { circle: 'radius', cylinder: 'radius', emanation: 'radius', sphere: 'radius',
                   cone: 'length', line: 'length', wall: 'length', cube: 'width', square: 'width' };
    const SHAPE_ICON = { circle: 'fa-circle', cylinder: 'fa-circle', emanation: 'fa-circle-dot',
                         sphere: 'fa-circle', cone: 'fa-play fa-rotate-270', line: 'fa-minus',
                         wall: 'fa-grip-lines-vertical', cube: 'fa-square', square: 'fa-square' };
    const areaSize = Number(area[SIZE[area.shape]]);
    const hasArea  = !!SIZE[area.shape] && areaSize > 0;
    const tq = t.quantity === 0 || t.quantity === '0' ? 0 : (Number(t.quantity) || 1);
    const areaTip = hasArea
      ? `${loc(A.areaTypes?.[area.shape]) || area.shape} ${areaSize} ${ft}${Number(area.quantity) > 1 ? ` × ${area.quantity}` : ''}`
      : null;
    let targetTip = null;
    if (t.type === 'self') {
      out.target = loc(A.targetTypes?.self) || 'Self';
      targetTip = out.target;
    } else if (['creature', 'object', 'creatureObject'].includes(t.type)) {
      out.target = String(tq);
      const table = tq === 1 ? A.targetTypes : A.targetTypesPlural;
      targetTip = `${tq} ${loc(table?.[t.type]) || t.type}`;
    } else if (t.type === 'other') {
      out.target = t.otherText || loc(A.targetTypes?.other) || 'Other';
      targetTip = out.target;
    }
    if (hasArea && (!out.target || out.target === (loc(A.targetTypes?.self) || 'Self'))) {
      out.target = `${areaSize}`;
      out.targetIcon = `fa-solid ${SHAPE_ICON[area.shape]}`;
    }
    out.targetTip = [targetTip, areaTip].filter(Boolean).join(', ') || null;

    /* Duration. Concentration is not repeated here: it is the C beside the
       name, which stays when this column is hidden for width. */
    const d = action?.duration ?? {};
    const LASTING = { instantaneous: 'Inst', permanent: 'Perm', special: 'Sp' };
    if (LASTING[d.unit]) out.dur = LASTING[d.unit];
    else if (PERIOD[d.unit]) {
      const v = this.#formulaToNumber(d.value ?? '0') ?? 0;
      out.dur = `${(v || d.value) ?? 1} ${PERIOD[d.unit]}`;
    }
    out.durTip = labels.durationLabel;

    /* Roll: the ability a save is made with, or that it is an attack. */
    const prompts = Object.values(action?.prompts ?? {});
    const save    = prompts.find((p) => p?.type === 'savingThrow');
    const rolls   = Object.values(action?.rolls ?? {});
    if (save?.ability) {
      out.roll = (loc(A.abilityAbbreviations?.[save.ability]) || save.ability).toUpperCase();
      out.rollTip = `${loc('A5E.rollLabels.savingThrows.title') || 'Saving Throw'}: ${labels.saveLabel ?? out.roll}`;
    } else if (rolls.some((x) => x?.type === 'attack')) {
      out.roll = 'Atk';
      out.rollTip = 'Spell attack';
    }
    return out;
  }

  #feature(item) {
    const sys = item.system ?? {};
    const { actionList, hasActions, activation, atkBonus, dmgFull, saveDC } = this.#parseActions(item);
    const rangeVal = sys.range?.value;
    const range    = rangeVal ? `${rangeVal} ${sys.range?.units ?? 'ft'}` : null;

    // For purely descriptive features (no combat props), show a text snippet
    const rawDesc  = this.#itemDesc(item);
    const hasCombatProps = !!(dmgFull || range || saveDC);
    const shortDesc = !hasCombatProps && rawDesc
      ? plainText(rawDesc).slice(0, 90)
      : null;

    return {
      id: item.id, uuid: item.uuid, name: item.name, img: item.img,
      starred: this.#starred(item),
      type: item.type,
      featureType: sys.featureType ?? (item.type !== 'feature' ? item.type : 'other'),
      source: ({ class:'Class', heritage:'Heritage', culture:'Culture', background:'Background',
                 destiny:'Destiny', feat:'Feat', naturalWeapon:'Heritage',
                 boon:'Other', knack:'Other', paragon:'Other' })[sys.featureType ?? item.type]
              ?? item.type.charAt(0).toUpperCase() + item.type.slice(1),
      desc: rawDesc,
      activation,
      hasActions,
      isAbility: true,
      atkBonus: atkBonus ? sign(Number(atkBonus)) : null,
      dmgFull, range, saveDC, shortDesc,
      actions: this.#allActionsForItem(item),
    };
  }

  #feat(item) {
    const sys = item.system;
    // Determine source: Heritage feat, Background feat, General feat, etc.
    const source = sys.featType ?? sys.category ?? sys.source?.book ?? 'General';
    const prereq = sys.prerequisites?.value ?? sys.prerequisite ?? '';
    return {
      id: item.id, uuid: item.uuid, name: item.name, img: item.img,
      starred: this.#starred(item),
      source: this.#normFeatSource(source),
      prereq,
      desc: this.#itemDesc(item)
    };
  }

  #normFeatSource(raw) {
    if (!raw) return 'General';
    const s = String(raw).toLowerCase();
    if (s.includes('heritage')) return 'Heritage';
    if (s.includes('background')) return 'Background';
    if (s.includes('class')) return 'Class';
    if (s.includes('destiny')) return 'Destiny';
    return 'General';
  }

  #groupFeatsBySource(feats) {
    const groups = { General: [], Heritage: [], Background: [], Class: [], Destiny: [], Other: [] };
    for (const f of feats) {
      const key = groups[f.source] ? f.source : 'Other';
      groups[key].push(f);
    }
    return groups;
  }

  #gear(item) {
    const sys = item.system ?? {};
    const equippedState = sys.equippedState ?? 1;
    const attuned       = sys.attuned ?? false;
    const needsAttune   = sys.requiresAttunement ?? false;
    return {
      id: item.id, uuid: item.uuid, name: item.name, img: item.img,
      starred: this.#starred(item),
      qty:    sys.quantity ?? 1,
      weight: sys.weight?.value ?? sys.weight ?? 0,
      equipped:     equippedState === 2,
      carried:      equippedState === 1,
      notCarried:   equippedState === 0,
      attuned, needsAttune,
      attuneProblem: needsAttune && !attuned,
      ...this.#stateBadges(item),
      desc: this.#itemDesc(item),
    };
  }

  #classItem(item) {
    return {
      id: item.id, uuid: item.uuid, name: item.name, img: item.img,
      starred: this.#starred(item),
      // A5e stores these as system.classLevels and system.hp.hitDiceSize — the
      // 5e-style paths below are fallbacks for imported data. Reading only those
      // meant every class showed as level 1, which also made the header's total
      // level and anything derived from it wrong.
      level:  item.system?.classLevels ?? item.system?.levels ?? item.system?.level ?? 1,
      hitDie: item.system?.hp?.hitDiceSize
              ?? item.system?.hitDice?.denomination
              ?? item.system?.hitDie
              ?? 8,
      /* Every a5e class carries system.spellcasting.ability, holding the
         ability it casts with — 'none' for the ones that do not cast. It is
         what the header line needs to show a save DC per class, the way Tidy
         shows one. */
      castAbility: (item.system?.spellcasting?.ability?.value
                    || item.system?.spellcasting?.ability?.base || 'none')
    };
  }

  /* ── Drag support ────────────────────────────────── */
  /* ── Drag and drop ────────────────────────────────
     Ported from a5e's own ActorSheet. The part that matters is the first
     branch of _onDropItem: when the item is already on this actor the drop
     has to SORT it. Foundry's default creates instead, which is why
     dragging a row duplicated the item rather than moving it — we had no
     drop handling at all, so the default was all there was.

     Containers are a5e's own idea and it already knows the move:
     Item#updateContainer takes the target's uuid, lifts the item out of
     whichever container it was in and puts it in the new one. Dropping
     anywhere that is not a container passes '' and takes it out.

     Source: src/documents/sheets/ActorSheet.svelte.ts, read out of the
     system's own a5e.js.map. */
  _onDragStart(event) {
    const row = event.currentTarget.closest('[data-item-id]');
    const item = row ? this.actor.items.get(row.dataset.itemId) : null;
    if (!item) return super._onDragStart(event);

    /* toDragData is the shape Foundry expects. The old code sent the whole
       item data alongside it, which is exactly what pushes the default
       handler into creating a new item instead of moving this one. */
    const dragData = item.toDragData();

    /* An action row carries its own id, so one action can be dragged out
       on its own rather than the whole item. */
    const actionId = row.dataset.actionId;
    if (actionId && actionId !== 'default') dragData.actionId = actionId;

    event.dataTransfer.setData('text/plain', JSON.stringify(dragData));
  }

  /* Where the pointer let go, and what that means for containers. */
  async #dropTargetOptions(event, item) {
    const target = event.target?.closest?.('[data-document-uuid]');
    const targetUuid = target?.dataset?.documentUuid;
    const targetItem = targetUuid ? await fromUuid(targetUuid).catch(() => null) : null;

    const droppedOnContainer = targetItem?.system?.objectType === 'container';
    /* Dropped on a container: into it. Dropped on something that lives in a
       container: into that same container, beside it. Otherwise: nowhere. */
    const containerUuid = droppedOnContainer
      ? targetUuid
      : (targetItem?.system?.containerId || '');
    const isMovingOut = !!item?.system?.containerId && !containerUuid;

    return {
      containerUuid,
      changesContainer: (!!containerUuid && containerUuid !== item?.system?.containerId) || isMovingOut
    };
  }

  async _onDropItem(event, data) {
    if (!this.actor.isOwner) return false;

    const item = await Item.implementation.fromDropData(data);
    if (!item) return false;

    /* A spell dropped on a book in the Magic tab's strip goes into that book:
       one of the actor's own is moved there, one from elsewhere is added
       there. a5e's drop has no such target; see "Moving a spell between
       books" in getData. */
    const bookDrop = event?.target?.closest?.('[data-book-drop]')?.dataset?.bookDrop;
    if (item.type === 'spell' && bookDrop && Object.keys(this.actor.system?.spellBooks ?? {}).includes(bookDrop)) {
      if (item.parent?.uuid === this.actor.uuid) {
        if (item.system?.spellBook !== bookDrop) await item.update({ 'system.spellBook': bookDrop });
        return item;
      }
      this._spellBook = bookDrop;
      return this.#onDropSpell(item);
    }

    const options = await this.#dropTargetOptions(event, item);

    /* Already ours and not changing container: reorder, do not duplicate. */
    if (item.parent?.uuid === this.actor.uuid && !options.changesContainer) {
      return this._onSortItem(event, item.toObject());
    }

    if (item.type === 'object') {
      if (item.parent?.id === this.actor.id) {
        await item.updateContainer?.(options.containerUuid);
        return item;
      }
      const source = item.toObject();
      foundry.utils.setProperty(source, 'system.containerId', options.containerUuid);
      const created = (await this.actor.createEmbeddedDocuments('Item', [source]))?.[0];
      await created?.updateContainer?.(options.containerUuid);
      return created;
    }

    /* Spells and destinies have branches of their own in a5e's drop, and this
       one had ported neither. A spell went on to Foundry's plain create, which
       a5e refuses — SpellItemA5e._preCreate: "You must select a spell book to
       create a spell." — because nothing had said which book it belongs in. */
    if (item.type === 'spell')   return this.#onDropSpell(item);
    if (item.type === 'destiny') return this.#onDropDestiny(item);

    return super._onDropItem(event, data);
  }

  /* a5e's #onDropSpell. Dropped on Inventory, a spell becomes a Spell Scroll
     of it; anywhere else it goes into a spell book, through that book's own
     addSpell, which is what writes system.spellBook.

     a5e picks the book the sheet is showing, or the actor's first. This sheet
     shows one list for all of them, so it is the first — the one a5e gives
     every character, and the one the spell dialogs here add to. */
  async #onDropSpell(item) {
    const actor = this.actor;
    const tab = this._tabs?.[0]?.active;

    if (tab === 'inventory') {
      const level = item.system?.level ?? 0;
      const table = CONFIG.A5E?.scrollData?.[level];
      if (!table) return null;
      const { attackBonus, cost, craftingComponent, saveDC, rarity } = table;

      const actionList = item.actions?.values ? [...item.actions.values()]
                       : Object.values(item.system?.actions ?? {});
      const actions = {};
      for (const original of actionList) {
        const action = foundry.utils.deepClone(original?.toObject?.() ?? original);
        for (const prompt of Object.values(action.prompts ?? {})) {
          if (prompt.type !== 'savingThrow') continue;
          prompt.saveDC = { ...(prompt.saveDC ?? {}), type: 'custom', bonus: saveDC };
        }
        for (const roll of Object.values(action.rolls ?? {})) {
          if (roll.type === 'attack') { roll.ability = 'none'; roll.bonus = String(attackBonus); }
          delete roll.scaling;
        }
        action.consumers = { [foundry.utils.randomID()]: { itemId: '', quantity: 1, type: 'quantity' } };
        actions[foundry.utils.randomID()] = action;
      }

      const [scroll] = await actor.createEmbeddedDocuments('Item', [{
        name: `Spell Scroll (${item.name})`,
        img: 'icons/sundries/scrolls/scroll-writing-brown-gold.webp',
        type: 'object',
        system: {
          actions,
          craftingComponents: craftingComponent,
          description: item.system?.description,
          price: { value: cost?.value, denomination: cost?.denomination, special: '' },
          objectType: 'consumable',
          rarity
        }
      }]) ?? [];
      if (!scroll) return null;

      /* The scroll spends itself: each consumer points at the scroll. */
      const update = {};
      for (const [actionId, action] of Object.entries(scroll.system?.actions ?? {})) {
        for (const consumerId of Object.keys(action?.consumers ?? {}))
          update[`system.actions.${actionId}.consumers.${consumerId}.itemId`] = scroll.id;
      }
      if (Object.keys(update).length) await scroll.update(update);
      return scroll;
    }

    /* The book the Magic tab is showing, as a5e drops into its current book;
       the first when none has been picked or the picked one is gone. */
    const bookIds = Object.keys(actor.system?.spellBooks ?? {});
    const bookId = bookIds.includes(this._spellBook) ? this._spellBook
                 : (actor.spellBooks?.first?.()?._id ?? bookIds[0]);
    const book = bookId ? actor.spellBooks?.get?.(bookId) : null;
    if (!book) {
      ui.notifications.warn(`${actor.name} has no spell book to put ${item.name} in. a5e makes one when a class that casts is added.`);
      return null;
    }
    return book.addSpell(item);
  }

  /* a5e's #onDropDestiny: a character only, and the destiny brings its
     source of inspiration and its inspiration feature with it. */
  async #onDropDestiny(item) {
    const actor = this.actor;
    if (actor.type !== 'character') {
      ui.notifications.warn('Destiny documents can only be added to Characters.');
      return null;
    }
    await actor.setFlag('a5e', 'destinyFulfilled', false);
    const features = (await Promise.all(
      [item.system?.sourceOfInspiration, item.system?.inspirationFeature]
        .filter(Boolean).map((uuid) => fromUuid(uuid).catch(() => null))
    )).filter(Boolean);
    return actor.createEmbeddedDocuments('Item', [item.toObject(), ...features.map((f) => f.toObject())]);
  }

  /* ── Listeners ────────────────────────────────────── */
  activateListeners(html) {
    super.activateListeners(html);
    const el = html?.jquery ? html[0] : html;

    /* The player's colour under the banner. On the window, not the form: the
       root is what paints it, and a custom property only reaches down. */
    (el?.closest?.('.a5e-mancer-sheet') ?? this.element?.[0])?.style?.setProperty(
      '--am-player-color', A5eCharacterSheet.playerColorVar(this.actor));

    /* ── Roll listeners (work for all viewers, not just owners) ── */

    /* Ability left-click → A5e roll dialog; right-click → instant roll */
    el.querySelectorAll('[data-action="ability-check"]').forEach(b => {
      b.addEventListener('contextmenu', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const id    = b.dataset.ability;
        const label = b.dataset.label ?? `${id} Check`;
        try {
          if      (typeof this.actor.rollAbilityCheck === 'function') await this.actor.rollAbilityCheck(id, { skipRollDialog: true });
          else if (typeof this.actor.rollAbility      === 'function') await this.actor.rollAbility(id);
          else throw new Error('no-method');
        } catch(err) {
          console.warn('a5e-mancer | rollAbilityCheck fallback:', err.message);
          const mod = parseInt(b.dataset.mod) || 0;
          await this.#roll(`1d20 + ${mod}`, label);
        }
      });
      b.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const id    = b.dataset.ability;
        const label = b.dataset.label ?? `${id} Check`;
        if (typeof this.actor.rollAbilityCheck !== 'function') {
          const mod = parseInt(b.dataset.mod) || 0;
          await this.#roll(`1d20 + ${mod}`, label);
          return;
        }
        try {
          await this.actor.rollAbilityCheck(id, { skipRollDialog: false });
        } catch(_nativeErr) {
          console.error('a5e-mancer | native ability check dialog failed, using fallback:', _nativeErr);
          try {
            const rollMode = await A5eCharacterSheet.#rollModeDialog(label);
            if (rollMode != null)
              await this.actor.rollAbilityCheck(id, { skipRollDialog: true, rollMode });
          } catch { /* dialog cancelled */ }
        }
      });
    });

    /* Saving throw left-click → A5e roll dialog; right-click → instant roll.

       Unlocked, a left click toggles save proficiency instead of rolling. That
       is what a5e own sheet does — see handleSaveClick in AbilityScore.svelte —
       and it is the only way it offers to set a save, which is why the saves
       looked uneditable with the padlock open. The cog beside the score opens
       the same field in a dialog; this is the quick way. */
    el.querySelectorAll('[data-action="saving-throw"]').forEach(b => {
      b.addEventListener('click', async (e) => {
        const locked = !this.actor.isOwner
          || (this.actor.flags?.a5e?.sheetIsLocked ?? true);
        if (locked) return;                         // locked: the roller below handles it
        e.preventDefault();
        e.stopPropagation();
        const key = b.dataset.ability;
        const now = this.actor.system?.abilities?.[key]?.save?.proficient ?? false;
        await this.actor.update({
          [`system.abilities.${key}.save.proficient`]: !now
        });
      }, true);                                     // capture, to pre-empt the roller
      b.addEventListener('contextmenu', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const id    = b.dataset.ability;
        const label = b.dataset.label ?? `${id} Save`;
        try {
          if      (typeof this.actor.rollSavingThrow === 'function') await this.actor.rollSavingThrow(id, { skipRollDialog: true });
          else if (typeof this.actor.rollAbilitySave === 'function') await this.actor.rollAbilitySave(id);
          else throw new Error('no-method');
        } catch(err) {
          console.warn('a5e-mancer | rollSavingThrow fallback:', err.message);
          const mod = parseInt(b.dataset.mod) || 0;
          await this.#roll(`1d20 + ${mod}`, label);
        }
      });
      b.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const id    = b.dataset.ability;
        const label = b.dataset.label ?? `${id.toUpperCase()} Save`;
        if (typeof this.actor.rollSavingThrow !== 'function') {
          const mod = parseInt(b.dataset.mod) || 0;
          await this.#roll(`1d20 + ${mod}`, label);
          return;
        }
        // Try the native A5e dialog first; fall back to a simple roll-mode picker if it fails
        try {
          await this.actor.rollSavingThrow(id, { skipRollDialog: false });
        } catch(_nativeErr) {
          console.error('a5e-mancer | native save dialog failed, using fallback:', _nativeErr);
          try {
            const rollMode = await A5eCharacterSheet.#rollModeDialog(label);
            if (rollMode != null)
              await this.actor.rollSavingThrow(id, { skipRollDialog: true, rollMode });
          } catch { /* dialog cancelled */ }
        }
      });
    });

    /* Skill left-click → A5e roll dialog */
    el.querySelectorAll('[data-action="skill-check"]').forEach(b => {
      b.addEventListener('contextmenu', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const longKey = b.dataset.skill;
        const label   = b.dataset.label ?? longKey;
        try {
          if      (typeof this.actor.rollSkillCheck === 'function') await this.actor.rollSkillCheck(longKey, { skipRollDialog: true });
          else if (typeof this.actor.rollSkill      === 'function') await this.actor.rollSkill(longKey);
          else throw new Error('no-method');
        } catch(err) {
          console.warn('a5e-mancer | rollSkillCheck click fallback:', err.message);
          const bonus = parseInt(b.dataset.bonus) || 0;
          await this.#roll(`1d20 + ${bonus}`, label);
        }
      });
    });

    /* Skill right-click → instant roll, no dialog (uses the abbreviated key,
       which is what CONFIG.A5E.skills is keyed by) */
    el.querySelectorAll('[data-action="skill-check"]').forEach(b => {
      b.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const longKey  = b.dataset.skill;
        const abbrKey  = A5E_SKILL_ABBR[longKey] ?? longKey;
        try {
          if      (typeof this.actor.rollSkillCheck === 'function') await this.actor.rollSkillCheck(abbrKey, { skipRollDialog: false });
          else if (typeof this.actor.rollSkill      === 'function') await this.actor.rollSkill(abbrKey);
          else throw new Error('no-method');
        } catch(err) {
          console.warn('a5e-mancer | rollSkillCheck contextmenu fallback:', err.message);
          const bonus = parseInt(b.dataset.bonus) || 0;
          await this.#roll(`1d20 + ${bonus}`, b.dataset.label ?? longKey);
        }
      });
    });

    /* The item image used to carry its own activation handler. It now sits
       INSIDE the use button, which carries data-action="item-use", so a
       click on the icon fired both and activated the item twice. Removed;
       the use button below handles the whole target. */

    /* ── The lock ───────────────────────────────────────────────────────
       a5e's own flag, so the two sheets share one lock rather than each
       keeping its own.

       Bound HERE, above the edit-only guard, and not below it where it used
       to sit. isEditable is options.editable AND isOwner, and Foundry also
       clears it for anything in a locked compendium — so on an NPC it is
       false far more often than on a character: an unlinked token, a monster
       opened out of a compendium, a sheet a player may look at but does not
       own. Below the guard the button was drawn with nothing bound to it,
       and clicking it did nothing, silently, which is how it was reported.

       The lock is not an editing control — it decides what the viewer is
       SHOWN. Ownership is what the write needs, and that is checked in the
       handler, where it belongs. */
    el.querySelector('[data-action="toggle-lock"]')?.addEventListener('click', async (e) => {
      e.preventDefault();
      if (!this.actor.isOwner) return;
      const locked = this.actor.getFlag('a5e', 'sheetIsLocked') ?? true;
      await this.actor.setFlag('a5e', 'sheetIsLocked', !locked);
    });

    /* ── Switching between pages of the sheet ───────────────────────────
       The sidebar's Skills/Traits strip and the Notes tab's own strip. Both
       are bound HERE, above the edit-only guard, because neither edits
       anything: they choose which part of the sheet the viewer is looking
       at. Below the guard, a sheet that is not editable — a monster from a
       compendium, a character a player may read but does not own — drew both
       strips and bound neither, and clicking a page did nothing at all. The
       padlock was the same mistake and was found first.

       Both remember the choice on the sheet, because writing anything on
       this page re-renders the whole of it, and without that the page would
       snap back on every save. */
    /* The Notes tab's own pages, switched exactly as the sidebar's are.
       Remembered on the sheet for the same reason: typing in one of these
       fields saves and re-renders, and without this the page would snap
       back every time. */
    /* Which spell book the Magic tab shows. Viewing, not editing, so above
       the guard; remembered on the sheet, as a5e keeps it in temp settings. */
    el.querySelectorAll('[data-action="spellbook-pick"]').forEach(b =>
      b.addEventListener('click', (e) => {
        e.preventDefault();
        if (this._spellBook === b.dataset.book) return;
        this._spellBook = b.dataset.book;
        this.render(false);
      })
    );

    /* A book lights while something is dragged over it, so a drop onto it is
       a thing one can see is about to happen. The drop itself goes through
       Foundry's DragDrop to _onDropItem, which reads data-book-drop. */
    el.querySelectorAll('[data-book-drop]').forEach(pill => {
      pill.addEventListener('dragover', () => pill.classList.add('am-drop-over'));
      for (const type of ['dragleave', 'drop'])
        pill.addEventListener(type, () => pill.classList.remove('am-drop-over'));
    });

    el.querySelectorAll('a[data-notes-tab]').forEach(node =>
      node.addEventListener('click', (e) => {
        e.preventDefault();
        const wanted = node.dataset.notesTab;
        this._notesTab = wanted;
        el.querySelectorAll('a[data-notes-tab]').forEach(a =>
          a.classList.toggle('active', a.dataset.notesTab === wanted));
        el.querySelectorAll('div[data-notes-tab]').forEach(p =>
          p.classList.toggle('active', p.dataset.notesTab === wanted));
      })
    );

    el.querySelectorAll('[data-sidebar-tab]').forEach(node => {
      if (node.tagName !== 'A') return;
      node.addEventListener('click', (e) => {
        e.preventDefault();
        const wanted = node.dataset.sidebarTab;
        /* Remembered on the sheet, because switching a condition updates the
           actor and the whole sheet re-renders — without this the sidebar
           snapped back to Skills every time a condition was clicked. */
        this._sidebarTab = wanted;
        el.querySelectorAll('a[data-sidebar-tab]').forEach(a =>
          a.classList.toggle('active', a.dataset.sidebarTab === wanted));
        el.querySelectorAll('div[data-sidebar-tab]').forEach(p =>
          p.classList.toggle('active', p.dataset.sidebarTab === wanted));
      });
    });

    if (!this.isEditable) return;

    /* ── Edit-only listeners below ── */

    /* Item equip toggle — delegate to the system's own 3-state cycle
       (stashed → carried → equipped) so its rules apply: only one armor +
       one underarmor may be equipped, max two shields, with the system's
       own warnings. Raw updates bypassed all of that. */
    /* The damaged state cycles the same way the equipped one does, and a5e
       has its own method for it too. */
    el.querySelectorAll('[data-action="item-damaged"]').forEach(b =>
      b.addEventListener('click', async (e) => {
        e.stopPropagation();
        const item = this.actor.items.get(b.dataset.id);
        if (!item) return;
        if (typeof item.toggleDamagedState === 'function') {
          await item.toggleDamagedState();
        } else {
          const cur = Number(item.system?.damagedState ?? 0);
          await item.update({ 'system.damagedState': (cur + 1) % 3 });
        }
      })
    );

    el.querySelectorAll('[data-action="item-equip"]').forEach(b =>
      b.addEventListener('click', async () => {
        const item = this.actor.items.get(b.dataset.id);
        if (!item) return;
        if (typeof item.toggleEquippedState === 'function') {
          await item.toggleEquippedState();
        } else {
          const cur = item.system?.equippedState ?? 1;
          await item.update({ 'system.equippedState': (cur + 1) % 3 });
        }
      })
    );

    /* A spell's prepared state cycles 0 → 1 → 2, a5e's togglePrepared. */
    el.querySelectorAll('[data-action="item-prepare"]').forEach(b =>
      b.addEventListener('click', async (e) => {
        e.stopPropagation();
        const item = this.actor.items.get(b.dataset.id);
        if (!item) return;
        if (typeof item.togglePrepared === 'function') {
          await item.togglePrepared();
        } else {
          const cur = Number(item.system?.prepared ?? 0);
          await item.update({ 'system.prepared': (cur + 1) % 3 });
        }
      })
    );

    /* Item attunement toggle — system method, like the original sheet */
    el.querySelectorAll('[data-action="item-attune"]').forEach(b =>
      b.addEventListener('click', async () => {
        const item = this.actor.items.get(b.dataset.id);
        if (!item) return;
        if (typeof item.toggleAttunement === 'function') await item.toggleAttunement();
        else await item.update({ 'system.attuned': !(item.system?.attuned ?? false) });
      })
    );

    el.querySelectorAll('[data-action="attunement"]').forEach(b =>
      b.addEventListener('click', (e) => { e.preventDefault(); this.#openAttunement(); }));

    /* Damaged-state cycle (intact → damaged → broken), as on the original sheet */
    /* The damaged-state cycle is bound above, against `item-damaged`, which
       is what the row draws. A second copy spelled `item-damage` stood here
       and had never matched anything. */

    /* Use button — skip dialog, just roll with defaults */
    /* Using an item, and using one named action on it.

       Left click asks: a5e's activation dialog, where advantage, bonuses and
       what gets consumed are chosen. Right click skips it and rolls straight
       away. Same arrangement as the ability, save and skill rolls above, so
       the whole sheet behaves one way.

       Both selectors share the handler; they differ only in whether an
       action id is passed, and 'default' means the item's implicit action. */
    const activateItem = (actionIdOf, skipRollDialog) => async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const b = e.currentTarget;
      const item = this.actor.items.get(b.dataset.id);
      if (!item) return;
      try {
        if (typeof item.activate === 'function') {
          await item.activate(actionIdOf(b), { skipRollDialog });
          return;
        }
        if (typeof item.use  === 'function') { await item.use({ configureDialog: !skipRollDialog }); return; }
        if (typeof item.roll === 'function') { await item.roll(); return; }
        item.sheet.render(true);
      } catch (err) {
        AM.log(2, 'item activation:', err);
        item.sheet.render(true);
      }
    };

    for (const [selector, actionIdOf] of [
      ['[data-action="item-use"]',        () => null],
      ['[data-action="item-action-use"]', (b) => (b.dataset.actionId !== 'default' ? b.dataset.actionId : null)]
    ]) {
      el.querySelectorAll(selector).forEach(b => {
        b.addEventListener('click',       activateItem(actionIdOf, false));
        b.addEventListener('contextmenu', activateItem(actionIdOf, true));
      });
    }

    /* Star / favorite toggle */
    /* a5e keeps a favourite on the item, at system.favorite, and its own sheet
       reads it there. This wrote only a flag of the module, so a star put on
       here never showed on a5e own sheet and one put on there was read but
       could not be taken off. It writes the item field now.

       The old flag is still read when the sheet is built, so stars set before
       this are not lost; unstarring clears both. */
    el.querySelectorAll('[data-action="item-star"]').forEach(b =>
      b.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id   = b.dataset.id;
        const item = this.actor.items.get(id);
        if (!item) return;

        const legacy = new Set(this.actor.getFlag(MODULE_ID, 'favorites') ?? []);
        const starred = !!item.system?.favorite || legacy.has(id);

        await item.update({ 'system.favorite': !starred }).catch(err =>
          AM.log(2, `Could not star ${item.name}:`, err));

        if (legacy.has(id) === starred && legacy.size) {
          legacy.delete(id);
          await this.actor.setFlag(MODULE_ID, 'favorites', [...legacy]);
        }
      })
    );


    /* Use a specific named action on an item */


    /* Item uses input (current uses tracker on parent row) */
    el.querySelectorAll('[data-action="item-uses"]').forEach(inp =>
      inp.addEventListener('change', async (e) => {
        const item = this.actor.items.get(inp.dataset.id);
        const val  = parseInt(e.target.value);
        if (item && !isNaN(val))
          await item.update({ 'system.uses.current': val })
            .catch(() => item.update({ 'system.uses.value': val }));
      })
    );

    /* Item name click — open item sheet */
    /* Clicking a row's name expands its summary — the description and the
       item's own actions — the way Tidy does it. The pencil in the actions
       column still opens the item sheet. */
    el.querySelectorAll('.item-name').forEach(name =>
      name.addEventListener('click', (e) => {
        e.preventDefault();
        const container = name.closest('.tidy-table-row-container');
        const summary = container?.querySelector(':scope > .expandable');
        if (!summary) return;
        const open = summary.classList.toggle('expanded');
        container.querySelector('.row-detail-expand-indicator')
          ?.classList.toggle('collapsed', !open);
        container.querySelector('.row-detail-expand-indicator')
          ?.classList.toggle('expanded', open);
        container.querySelector('.tidy-table-row')?.classList.toggle('expanded', open);
      })
    );

    /* Right-click any item row → open the item.

       It used to activate the item instead. For anything with no actions
       defined, a5e's activate() falls back to posting the description, so a
       right-click meant to look something up threw it into chat — while the
       chat button beside it opened a window. The two had ended up the wrong
       way round.

       This is what a5e's own row does on a right-click: configureItem, which
       is its way of opening the item's sheet. Using an item stays where it
       was, on the icon and the use button. */
    el.querySelectorAll('.tidy-table-row-container[data-item-id]').forEach(row =>
      row.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const item = this.actor.items.get(row.dataset.itemId);
        if (!item) return;
        try {
          if (typeof item.configureItem === 'function') { item.configureItem(); return; }
          item.sheet.render(true);
        } catch (err) {
          AM.log(2, 'Could not open the item on right-click:', err);
          item.sheet.render(true);
        }
      })
    );

    /* Send an item's description to chat.

       The three methods this used to try — toChat, toMessage, roll — are dnd5e
       names. An a5e item has none of them, so every click fell through to the
       last line and opened the item's sheet. The button said Send to Chat and
       opened a window instead, which is half of why this and the right-click
       looked swapped.

       shareItemDescription is a5e's own, and is what its code calls when an
       item with no actions is used. The old names stay as a fallback for an
       imported dnd5e item. */
    el.querySelectorAll('[data-action="item-chat"]').forEach(b =>
      b.addEventListener('click', async () => {
        const item = this.actor.items.get(b.dataset.id);
        if (!item) return;
        try {
          if (typeof item.shareItemDescription === 'function') {
            await item.shareItemDescription(null, {});
            return;
          }
          if (typeof item.toChat    === 'function') { await item.toChat();    return; }
          if (typeof item.toMessage === 'function') { await item.toMessage(); return; }
        } catch (err) {
          AM.log(2, `Could not send ${item.name} to chat:`, err);
        }
        ui.notifications.warn(`${AM.NAME}: ${item.name} has no description to send.`);
      })
    );

    /* Item edit */
    el.querySelectorAll('[data-action="item-edit"]').forEach(b =>
      b.addEventListener('click', () => this.actor.items.get(b.dataset.id)?.sheet.render(true))
    );

    /* Item delete */
    el.querySelectorAll('[data-action="item-delete"]').forEach(b =>
      b.addEventListener('click', async () => {
        const item = this.actor.items.get(b.dataset.id);
        if (!item) return;
        if (await foundry.applications.api.DialogV2.confirm({
          window: { title: 'Delete' },
          content: `<p>Delete <b>${foundry.utils?.escapeHTML?.(item.name) ?? item.name}</b>?</p>`,
        })) await item.delete();
      })
    );

    /* HP inputs */
    /* Hit points are the one figure people change by an amount rather than to
       a number: you take 7, you get 4 back. So the field reads a sign.

         +4   heal 4
         -7   take 7
          12  set to 12

       This replaces the two buttons that stood beside the bar, each of which
       opened a dialog to ask for a number. Two clicks and a prompt to spend a
       hit die’s worth of healing was too much ceremony for the commonest edit
       on the sheet, and one of the two was reported as doing nothing at all.

       The arithmetic is a5e’s, not ours: applyDamage and applyHealing are
       methods on its actor, and they already know that temporary hit points
       absorb damage first and that healing stops at the maximum. Doing it by
       hand here would be a second opinion about the same rules. */
    el.querySelector('#am-hp-current')?.addEventListener('change', async (e) => {
      const raw = String(e.target.value ?? '').trim();
      const rel = raw.match(/^([+-])\s*(\d+)$/);
      try {
        if (rel) {
          const n = Number(rel[2]);
          if (!n) return;
          if (rel[1] === '+') {
            if (typeof this.actor.applyHealing === 'function') await this.actor.applyHealing(n);
            else await this.#hpFallback(n);
          } else {
            if (typeof this.actor.applyDamage === 'function') await this.actor.applyDamage(n);
            else await this.#hpFallback(-n);
          }
          return;
        }
        const abs = parseInt(raw);
        if (isNaN(abs)) return;
        await this.actor.update({ 'system.attributes.hp.value': Math.max(0, abs) });
      } catch (err) {
        AM.log(1, 'Could not change hit points:', err);
        ui.notifications.warn(err.message ?? 'The sheet could not change hit points.');
      }
    });
    /* a5e DERIVES hp.max and never stores it: a character carries baseMax,
       bonus and temp, and the actor computes max = baseMax + bonus, or
       maxHP + CON + bonus when automation is on. Writing hp.max was rejected
       by the data model, so the maximum could not be edited at all.

       What is editable is baseMax, so the typed figure has the bonus taken
       off before it is stored. With automation on the maximum also folds in
       Constitution and hit dice, so the field will settle on the computed
       value rather than the typed one — which is the truth, and visible,
       rather than a silent no-op. */
    this.#bindNumericInput(el, '#am-hp-max', v => ({
      'system.attributes.hp.baseMax':
        Math.max(0, v - (Number(this.actor.system?.attributes?.hp?.bonus ?? 0) || 0))
    }));
    this.#bindNumericInput(el, '#am-hp-temp',    v => ({ 'system.attributes.hp.temp': v }));

    /* Exertion */
    /* a5e's exertion is a SchemaField of current, max and recoverOnRest —
       there is no `value`. Writing one alongside `current` made the data
       model reject the WHOLE update, so exertion could never be changed;
       the catch below swallowed the complaint, so nothing said why. */
    /* The path is on the input: a character's lives in system, a monster's
       in this module's flag — see exertion in getData. */
    this.#bindNumericInput(el, '#am-exertion-current',
      v => ({ [el.querySelector('#am-exertion-current')?.dataset.path
              || 'system.attributes.exertion.current']: Math.max(0, v) }));
    this.#bindNumericInput(el, '#am-exertion-max',
      v => A5eCharacterSheet.exertionMaxUpdate(this.actor, el.querySelector('#am-exertion-max'), Math.max(0, v)));

    /* AC / Initiative / Speed */
    [
      ['#am-ac-input',         'system.attributes.ac.value'],
      ['#am-initiative-input', 'system.attributes.initiative.value'],
      ['#am-speed-input',      'system.attributes.movement.walk.distance']
    ].forEach(([sel, path]) => this.#bindNumericInput(el, sel, v => ({ [path]: v })));

    /* Ability score inputs */
    el.querySelectorAll('.am-ability-score').forEach(inp =>
      inp.addEventListener('change', async (e) => {
        const val = parseInt(e.target.value);
        if (!isNaN(val)) await this.actor.update({ [`system.abilities.${inp.dataset.ability}.value`]: val });
      })
    );

    /* Inspiration toggle */
    /* Heal / Damage — the two buttons under the HP bar. They were drawn from the
       first version of this sheet and never wired to anything, so pressing them
       did nothing at all. Damage goes through temporary hit points first, which
       is the part worth automating; healing never exceeds max. */

    el.querySelector('[data-action="toggle-inspiration"]')?.addEventListener('click', async () => {
      const cur  = this.actor.system.attributes?.inspiration ?? this.actor.system.inspiration;
      const path = this.actor.system.attributes?.inspiration !== undefined
        ? 'system.attributes.inspiration' : 'system.inspiration';
      await this.actor.update({ [path]: !cur });
    });

    /* The fatigue/strife pip row is gone — the bar replaced it, and
       cycle-fatigue / cycle-strife carry the click now. The handler that
       set a track by clicking one pip went with the markup. */

    /* ── helper: activate a condition (no toggle, just enable) ─────────────── */
    const _activateCond = async (id) => {
      // Item-applied conditions count as already on. Looking only at the
      // actor's own effects meant a condition a spell was applying was read as
      // off, and a duplicate was created on top of it.
      const existing = ConditionSource.find(this.actor, id);
      if (existing) return; // already active
      if (typeof this.actor.toggleStatusEffect === 'function') {
        try { await this.actor.toggleStatusEffect(id, { active: true }); return; } catch {}
      }
      const def = (CONFIG.statusEffects ?? []).find(s => s.id === id);
      if (!def) return;
      await ActiveEffect.create({
        name:     game.i18n.localize(def.label ?? def.name ?? id),
        icon:     def.icon ?? def.img ?? 'icons/svg/mystery-man.svg',
        statuses: [id],
        flags:    { a5e: { conditionId: id } }
      }, { parent: this.actor });
    };

    /* ── helper: clear duration flag for a condition ────────────────────────── */
    const _clearDuration = async (id) => {
      const durs = foundry.utils.deepClone(this.actor.getFlag?.('a5e-mancer', 'durations') ?? {});
      if (durs[id] === undefined) return;
      delete durs[id];
      await this.actor.setFlag('a5e-mancer', 'durations', durs);
    };

    /* Status condition toggles */
    el.querySelectorAll('[data-action="toggle-condition"]').forEach(btn =>
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        if (!id) return;

        // Clear every source of the condition, not just the actor's own effect.
        // a5e also applies an item's effect when it is typed 'passive' — and
        // `system.effectType` defaults to 'passive' — so a spell sitting in the
        // spellbook can hold a condition on. Those reach `actor.statuses`, which
        // is what paints this button as on, but they are not in `actor.effects`.
        // Searching there alone read the condition as off and created a second
        // one, so clicking to switch a condition off switched another on and the
        // pile could never be cleared.
        const sources = ConditionSource.findAll(this.actor, id);
        if (sources.length) {
          const { disabled } = await ConditionSource.clear(this.actor, id);
          await _clearDuration(id);
          // An item's effect is switched off on the item, not deleted — say so,
          // otherwise the condition looks like it came back on its own next time
          // the item is re-enabled.
          for (const item of disabled) {
            ui.notifications.info(game.i18n.format('am.sheet.condition-from-item', {
              condition: btn.dataset.label || id, item: item.name
            }));
          }
          return;
        }

        // Try Foundry v11+ native toggle first (works for standard status effects)
        if (typeof this.actor.toggleStatusEffect === 'function') {
          try {
            await this.actor.toggleStatusEffect(id, { active: true });
            return;
          } catch(e) { /* fall through to manual create */ }
        }

        // Manual create with conditionId for A5e
        const def = (CONFIG.statusEffects ?? []).find(s => s.id === id);
        if (!def) return;
        const effectData = {
          name:   game.i18n.localize(def.label ?? def.name ?? id),
          icon:   def.icon ?? def.img ?? 'icons/svg/mystery-man.svg',
          statuses: [id],
          flags: { a5e: { conditionId: id } },
        };
        await ActiveEffect.create(effectData, { parent: this.actor });
      })
    );

    /* ── Duration tracking: hover status button + press 1–9 ─────────────── */
    if (this._condKeydownHandler) {
      window.removeEventListener('keydown', this._condKeydownHandler);
      this._condKeydownHandler = null;
    }
    let _hoveredCondBtn = null;
    el.querySelectorAll('[data-action="toggle-condition"]').forEach(btn => {
      btn.addEventListener('mouseenter', () => { _hoveredCondBtn = btn; });
      btn.addEventListener('mouseleave', () => { if (_hoveredCondBtn === btn) _hoveredCondBtn = null; });
    });
    this._condKeydownHandler = async (ev) => {
      if (!_hoveredCondBtn) return;
      const n = parseInt(ev.key);
      if (isNaN(n) || n < 1 || n > 9) return;
      ev.preventDefault();
      const id      = _hoveredCondBtn.dataset.id;
      /* The active state lives on the tile, not on the button inside it —
         it used to be a class on the button itself, and testing for that
         after the markup changed meant isActive was always false, so a repeat
         of the same digit never cleared the counter. */
      const isActive = !!_hoveredCondBtn.closest('.condition')?.classList.contains('active');
      const durs    = foundry.utils.deepClone(this.actor.getFlag?.('a5e-mancer', 'durations') ?? {});
      if (!isActive) await _activateCond(id);
      // Same digit on already-active condition with same number → clear duration
      if (isActive && durs[id] === n) {
        delete durs[id];
      } else {
        durs[id] = n;
      }
      await this.actor.setFlag('a5e-mancer', 'durations', durs);
    };
    window.addEventListener('keydown', this._condKeydownHandler);

    /* Condition description popover — click icon to show desc in panel */
    /* The panel is moved to <body>. position:fixed is measured against the
       nearest ancestor carrying a transform, not against the window, and the
       sheet has such ancestors — so left over inside the sheet the pointer
       coordinates would be wrong and .window-content overflow:hidden could
       clip it. Every render builds a fresh panel, so the previous one is
       taken away first, and close() takes the last one away for good. */
    this._condPanel?.remove();
    const condDescPanel = el.querySelector('.am-cs-cond-desc-panel');
    if (condDescPanel) {
      condDescPanel.classList.add('am-cond-popover');
      document.body.appendChild(condDescPanel);
      this._condPanel = condDescPanel;
      const hidePanel = () => { condDescPanel.style.display = 'none'; };

      el.querySelectorAll('[data-action="toggle-condition"]').forEach(btn => {
        btn.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          const desc  = btn.dataset.description;
          const label = btn.dataset.label;
          if (!desc) return;
          condDescPanel.innerHTML = `<strong>${label}</strong><p>${desc}</p>`;

          /* The panel used to sit at the foot of the sidebar, which is far
             from wherever the pointer was and easy to miss entirely. It is
             positioned by the pointer instead. Measured while hidden so the
             size is the real one, then pulled back inside the window if it
             would run off an edge — and flipped above the pointer rather
             than squashed when there is no room below. */
          condDescPanel.style.visibility = 'hidden';
          condDescPanel.style.display = '';
          const rect = condDescPanel.getBoundingClientRect();
          const pad = 8;
          let x = e.clientX + 12;
          let y = e.clientY + 12;
          if (x + rect.width + pad > window.innerWidth) x = window.innerWidth - rect.width - pad;
          if (y + rect.height + pad > window.innerHeight) y = e.clientY - rect.height - 12;
          condDescPanel.style.left = `${Math.max(pad, x)}px`;
          condDescPanel.style.top  = `${Math.max(pad, y)}px`;
          condDescPanel.style.visibility = '';
        });
      });

      condDescPanel.addEventListener('click', hidePanel);
      /* Anywhere else on the sheet, and Escape, close it too — a popover
         that only closes by being clicked is a popover people leave open. */
      el.addEventListener('mousedown', (e) => {
        if (!condDescPanel.contains(e.target)) hidePanel();
      });
      if (this._condEscHandler) window.removeEventListener('keydown', this._condEscHandler);
      this._condEscHandler = (e) => { if (e.key === 'Escape') hidePanel(); };
      window.addEventListener('keydown', this._condEscHandler);
    }

    /* Spell slots are spent with the hexagon pair, slot-dec / slot-inc,
       bound further down. A pip row was here first; it is drawn on neither
       sheet any more. */

    /* Item quantity */
    el.querySelectorAll('[data-action="item-qty"]').forEach(inp =>
      inp.addEventListener('change', async (e) => {
        const item = this.actor.items.get(inp.dataset.id);
        if (item) await item.update({ 'system.quantity': parseInt(e.target.value) || 1 });
      })
    );


    /* Exertion is spent and regained with the pair of buttons on the bar,
       data-action="exertion-step", bound just above. The pip row they
       replaced is drawn on neither sheet. */

    /* Feat picker */
    el.querySelector('[data-action="open-feat-picker"]')?.addEventListener('click', () => {
      this.#openFeatPicker();
    });

    /* The feat tab's own search, source-filter buttons and collapse arrows
       stood here. All three addressed .am-feat-item and its children, markup
       the Quadrone rewrite replaced; nothing draws any of it, so all three
       were bound to nothing. The search that IS drawn is #am-feature-search,
       handled further down. */

    /* ── Making the header responsive, the way Tidy makes it responsive ──

       Tidy's abilities row has three layouts, and its own Svelte component
       chooses between them from the sheet's width — AbilitiesContainer.svelte.
       We render the markup but not that component, so the class was never
       applied and the row never adapted: widen the sheet and the space simply
       sat there, narrow it and everything held its size while the portrait,
       which has a floor, took up proportionally more.

       This is their arithmetic, not an approximation of it. The thresholds are
       the numbers CharacterSheet.svelte passes in — 3.5rem per ability to
       collapse, 4rem to shrink, 20.5rem of everything else — and the widths
       are in rem against Foundry's own font size, as theirs are. */
    const applyAbilityLayout = () => {
      /* Nothing about a layout hint is worth failing a render over. This runs
         from activateListeners, and a throw there aborts _render — which is
         exactly what happened: game.settings.get('core', 'fontSize') is not a
         registered setting in this Foundry, it threw, and the whole sheet
         stopped rendering. Every change in that release looked as though it had
         done nothing, because none of it was reached. */
      try {
        const box = el.querySelector('.abilities-container');
        if (!box) return;

        /* The root font size, read from the document rather than asked of a
           setting that may not exist. It is also the truer number: it is what
           the browser actually resolves a rem to, whatever set it. */
        const fontPx =
          parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;

        const widthRems = (this.position?.width ?? el.clientWidth ?? 0) / fontPx;
        if (!widthRems) return;

        const n = 6;                                 // a5e has the same six
        const collapsedRems = n * 3.5 + 20.5;
        const smallerRems   = n * 4   + 20.5;
        box.classList.toggle('abilities-size-compact', widthRems < collapsedRems);
        box.classList.toggle('abilities-size-small',
          widthRems >= collapsedRems && widthRems < smallerRems);
      } catch (err) {
        AM.log(2, 'Could not size the abilities row:', err);
      }
    };
    applyAbilityLayout();

    /* Watching the element rather than only the resize handle: the sheet is
       also resized by Foundry restoring a saved position, and by the user
       changing the interface font, neither of which is a drag. */
    this._abilityLayoutObserver?.disconnect();
    if (typeof ResizeObserver === 'function') {
      this._abilityLayoutObserver = new ResizeObserver(() => applyAbilityLayout());
      this._abilityLayoutObserver.observe(el);
    }

    /* ── Configuring an ability or a skill ──────────────────────────────
       These are a5e's own dialogs, reached through its own actor methods, so
       the window that opens here is the window its sheet opens: proficiency,
       expertise dice and bonuses, all written back where a5e reads them.
       They only exist while unlocked, which is where the template puts
       them. */
    el.querySelectorAll('[data-action="ability-config"]').forEach(b =>
      b.addEventListener('click', (e) => {
        e.preventDefault();
        this.actor.configureAbilityScore?.({ abilityKey: b.dataset.ability });
      }));

    /* The appearance fields, written straight to a5e's own paths. */
    el.querySelectorAll('[data-action="detail-field"]').forEach(inp =>
      inp.addEventListener('change', async (e) => {
        await this.actor.update({
          [`system.details.${e.target.dataset.key}`]: e.target.value
        });
      }));

    /* Appearance, ideals, bonds, flaws and goals are HTMLFields on a5e’s
       character, so what goes in has to be markup rather than the raw lines
       typed into a textarea — otherwise the paragraph breaks are lost the
       moment a5e’s own editor opens the same field. The path is given whole
       on the element, because these are not all under one prefix. */
    el.querySelectorAll('[data-action="detail-html"]').forEach(inp =>
      inp.addEventListener('change', async (e) => {
        const raw = String(e.target.value ?? '').trim();
        const html = raw
          ? raw.split(/\n{2,}/).map(p => `<p>${p.trim().split(/\n/).join('<br>')}</p>`).join('')
          : '';
        await this.actor.update({ [e.target.dataset.path]: html });
      }));

    /* The trait lists in the sidebar. Every one of these is a dialog a5e
       already has on the actor, so what opens is its own window writing its
       own fields — no second editor of ours keeping a parallel idea of which
       languages a character speaks. */
    const TRAIT_DIALOGS = {
      senses:    'configureSenses',
      languages: 'configureLanguages',
      weapons:   'configureWeaponProficiencies',
      armor:     'configureArmorProficiencies',
      tools:     'configureToolProficiencies',
      /* a5e names these exactly so on the actor — its own sheet opens the
         same four windows. */
      damageImmunities:      'configureDamageImmunities',
      damageResistances:     'configureDamageResistances',
      damageVulnerabilities: 'configureDamageVulnerabilities',
      conditionImmunities:   'configureConditionImmunities'
    };

    el.querySelectorAll('[data-action="trait-config"]').forEach(b =>
      b.addEventListener('click', (e) => {
        e.preventDefault();
        const method = TRAIT_DIALOGS[b.dataset.trait];
        if (method && typeof this.actor[method] === 'function') this.actor[method]();
        else AM.log(2, `No a5e dialog for the ${b.dataset.trait} traits`);
      }));

    el.querySelectorAll('[data-action="skill-config"]').forEach(b =>
      b.addEventListener('click', (e) => {
        e.preventDefault();
        this.actor.configureSkill?.({ skillKey: b.dataset.skillKey });
      }));


    /* ── Resources ──────────────────────────────────────────────────────
       The figure is always writable; the label, the maximum and the rest of
       the configuration only while unlocked, which is what the template
       renders. Paths differ for class resources — see the context. */
    /* ── A number changed, not the sheet ─────────────────────────────────
       Every tracker wrote with actor.update and let Foundry redraw the whole
       sheet. Measured on the characters in this world, one redraw is 10–17ms
       of JavaScript producing 126–585KB of HTML, which the browser then has to
       parse and lay out against 2.1MB of Tidy’s CSS. A frame at 60fps is
       16.7ms. That is the stutter when a tracker is nudged — and the custom
       counters were paying it twice, once for the flag write and again for an
       explicit render call after it.

       Spending a point does not change the shape of the sheet, so it does not
       need one drawn. The write is made with render: false and the two things
       that actually change are set in place: the figure, and the length of its
       bar. The figure is read back off the actor rather than assumed, so a
       value the system clamps still shows the truth. */
    const paintMeter = (node) => {
      const meter = node?.closest?.('.am-tracker-meter, .meter');
      if (!meter) return;
      const label  = meter.querySelector('.label') ?? meter;
      const cur    = Number(label.querySelector('input:not(.max)')?.value ?? 0) || 0;
      const maxEl  = label.querySelector('.max');
      const max    = Number(maxEl?.value ?? maxEl?.textContent ?? 0) || 0;
      const pct    = max > 0 ? Math.min(100, Math.max(0, (cur / max) * 100)) : 0;
      meter.style.setProperty('--bar-percentage', `${pct}%`);
    };

    const writeNumber = async (path, value, node) => {
      await this.actor.update({ [path]: value }, { render: false });
      const real = Number(foundry.utils.getProperty(this.actor, path) ?? value);
      if (node && 'value' in node) node.value = Number.isFinite(real) ? real : value;
      paintMeter(node);
    };

    /* The figure belonging to a button: the one in the same chip. */
    const figureFor = (btn, selector) =>
      btn.closest('.am-tracker, .am-counter, .am-a5e-stat')?.querySelector(selector) ?? null;

    el.querySelectorAll('[data-action="resource-value"]').forEach(inp =>
      inp.addEventListener('change', async (e) => {
        const v = parseInt(e.target.value);
        if (isNaN(v)) return;
        await writeNumber(e.target.dataset.path, Math.max(0, v), e.target);
      }));

    el.querySelectorAll('[data-action="resource-step"]').forEach(b =>
      b.addEventListener('click', async (e) => {
        e.preventDefault();
        const path  = b.dataset.path;
        const delta = Number(b.dataset.delta) || 0;
        const max   = b.dataset.max === '' ? null : Number(b.dataset.max);
        const now   = Number(foundry.utils.getProperty(this.actor, path) ?? 0) || 0;
        let next = now + delta;
        if (next < 0) next = 0;
        if (max !== null && Number.isFinite(max) && max > 0 && next > max) next = max;
        if (next === now) return;
        await writeNumber(path, next, figureFor(b, '[data-action="resource-value"]'));
      }));

    el.querySelectorAll('[data-action="resource-field"]').forEach(inp =>
      inp.addEventListener('change', async (e) => {
        const t = e.target;
        const value = t.type === 'checkbox' ? t.checked : t.value;
        await this.actor.update({
          [`system.resources.${t.dataset.resource}.${t.dataset.field}`]: value
        });
      }));

    /* ── Settings ───────────────────────────────────────────────────────
       One handler for the lot, keyed by the path on the element. The paths
       are a5e's own — flags.a5e.* and two system fields — so a switch thrown
       here is the same switch its sheet throws. */
    const writeSetting = async (path, value) => {
      if (!path) return;
      await this.actor.update({ [path]: value });
    };

    /* stopPropagation: the sheet is a v1 form, and a change bubbling up to it
       is picked up by Foundry's own form handling as well as by this one.
       These inputs carry no name and belong to nothing it would submit, so
       it is kept here rather than left to two handlers to settle between
       them. */
    el.querySelectorAll('[data-action="setting-toggle"]').forEach(inp =>
      inp.addEventListener('change', (e) => {
        e.stopPropagation();
        writeSetting(e.target.dataset.path, e.target.checked);
      }));

    el.querySelectorAll('[data-action="setting-number"]').forEach(inp =>
      inp.addEventListener('change', (e) => {
        const v = parseInt(e.target.value);
        if (!isNaN(v)) writeSetting(e.target.dataset.path, v);
      }));

    el.querySelectorAll('[data-action="setting-choice"]').forEach(sel =>
      sel.addEventListener('change', (e) => {
        e.stopPropagation();
        /* A setting a5e stores as a number is written back as one; its own
           sheet compares it against numbers and would show nothing chosen. */
        const raw = e.target.value;
        const value = e.target.dataset.numeric ? Number(raw) : raw;
        writeSetting(e.target.dataset.path, value);
      }));

    /* ── Effects ────────────────────────────────────────────────────────
       Everything here is a5e's own document API, so an effect toggled from
       this sheet behaves exactly as one toggled from theirs. */
    const effectFrom = (el2) => this.actor.effects.get(el2.dataset.id);

    el.querySelectorAll('[data-action="effect-toggle"]').forEach(b =>
      b.addEventListener('click', async (e) => {
        e.preventDefault();
        const fx = effectFrom(b);
        if (!fx) return;
        /* a5e adds toggleActiveState, which knows about suppression; plain
           Foundry only has the disabled flag. Prefer theirs, fall back. */
        if (typeof fx.toggleActiveState === 'function') await fx.toggleActiveState();
        else await fx.update({ disabled: !fx.disabled });
      })
    );

    el.querySelectorAll('[data-action="effect-edit"]').forEach(b =>
      b.addEventListener('click', (e) => { e.preventDefault(); effectFrom(b)?.sheet?.render(true); })
    );

    el.querySelectorAll('[data-action="effect-delete"]').forEach(b =>
      b.addEventListener('click', async (e) => {
        e.preventDefault();
        const fx = effectFrom(b);
        if (!fx) return;
        /* Deleting is asked for. deleteDialog is Foundry's own prompt, which
           is the one a player already recognises from every other sheet. */
        if (typeof fx.deleteDialog === 'function') await fx.deleteDialog();
        else await fx.delete();
      })
    );

    el.querySelector('[data-action="effect-add"]')?.addEventListener('click', async (e) => {
      e.preventDefault();
      /* The same document a5e's own add button makes — see createActiveEffect. */
      await this.actor.createEmbeddedDocuments('ActiveEffect', [{
        name:   game.i18n.localize('A5E.effects.new'),
        img:    'icons/svg/aura.svg',
        origin: this.actor.uuid
      }]);
    });

    /* Filtering in the browser rather than through a re-render: an effect list
       is short, and re-rendering would take the focus out of the field on
       every keystroke. */
    el.querySelector('[data-action="fx-search"]')?.addEventListener('input', (e) => {
      const q = e.target.value.trim().toLowerCase();
      el.querySelectorAll('.am-fx-row').forEach(row => {
        const name = (row.dataset.name ?? '').toLowerCase();
        row.classList.toggle('am-hidden', !!q && !name.includes(q));
      });
      /* A group whose every row is filtered out should go too, or the page is
         left with headings standing over nothing. */
      el.querySelectorAll('.am-fx-table').forEach(table => {
        const rows = [...table.querySelectorAll('.am-fx-row')];
        table.classList.toggle('am-hidden', rows.length > 0 &&
          rows.every(r => r.classList.contains('am-hidden')));
      });
    });

    /* ── Bonuses ────────────────────────────────────────────────────────
       a5e's actor carries all four of these; this sheet only presses them. */
    el.querySelectorAll('[data-action="bonus-add"]').forEach(b =>
      b.addEventListener('click', (e) => { e.preventDefault(); this.actor.addBonus?.(b.dataset.type); })
    );
    el.querySelectorAll('[data-action="bonus-configure"]').forEach(b =>
      b.addEventListener('click', (e) => {
        e.preventDefault();
        this.actor.configureBonus?.(b.dataset.id, b.dataset.type);
      })
    );
    el.querySelectorAll('[data-action="bonus-duplicate"]').forEach(b =>
      b.addEventListener('click', (e) => {
        e.preventDefault();
        this.actor.duplicateBonus?.(b.dataset.id, b.dataset.type);
      })
    );
    el.querySelectorAll('[data-action="bonus-delete"]').forEach(b =>
      b.addEventListener('click', async (e) => {
        e.preventDefault();
        const ok = await foundry.applications.api.DialogV2.confirm({
          window: { title: 'Delete bonus' },
          content: `<p>Delete <strong>${ItemRepair.esc(b.dataset.label ?? 'this bonus')}</strong>?</p>`
        }).catch(() => false);
        if (ok) await this.actor.deleteBonus?.(b.dataset.id, b.dataset.type);
      })
    );

    /* system.bonuses.maneuverDC and .spellDC are StringFields in a5e — they
       hold a FORMULA, which is why "@prof + 1" is a legal entry. This was
       parsing the field to an integer and writing a number, so a formula typed
       here became 0 and a5e read a number where its own sheet writes a string.
       Written as typed now, trimmed, which is what its own field does. */
    el.querySelectorAll('[data-action="bonus-dc"]').forEach(inp =>
      inp.addEventListener('change', async (e) => {
        await this.actor.update({
          [`system.bonuses.${e.target.dataset.key}`]: String(e.target.value ?? '').trim()
        });
      })
    );

    /* Custom counters */
    const saveCounter = async (index) => {
      const counters = this.actor.getFlag(MODULE_ID, 'customCounters') ?? [{}, {}];
      const name  = el.querySelector(`[data-action="counter-name"][data-index="${index}"]`)?.value ?? '';
      const value = parseInt(el.querySelector(`[data-action="counter-val"][data-index="${index}"]`)?.value) || 0;
      const max   = parseInt(el.querySelector(`[data-action="counter-max"][data-index="${index}"]`)?.value) || 0;
      counters[index] = { name, value, max };
      /* setFlag redraws; update with render: false does not. The figures are
         already on screen — the player typed them. */
      await this.actor.update(
        { [`flags.${MODULE_ID}.customCounters`]: counters }, { render: false });
    };

    /* Redrawn on rename because naming an empty slot is what turns the
       placeholder field into a counter — without this it saves and nothing
       visibly happens. */
    el.querySelectorAll('[data-action="counter-name"]').forEach(inp =>
      inp.addEventListener('change', async () => {
        await saveCounter(parseInt(inp.dataset.index));
        this.render(false);
      })
    );
    el.querySelectorAll('[data-action="counter-val"]').forEach(inp =>
      inp.addEventListener('change', async () => {
        await saveCounter(parseInt(inp.dataset.index));
        paintMeter(inp);
      })
    );
    el.querySelectorAll('[data-action="counter-max"]').forEach(inp =>
      inp.addEventListener('change', async () => {
        await saveCounter(parseInt(inp.dataset.index));
        paintMeter(inp);
      })
    );
    el.querySelectorAll('[data-action="counter-inc"]').forEach(btn =>
      btn.addEventListener('click', async () => {
        const idx  = parseInt(btn.dataset.index);
        const inp  = el.querySelector(`[data-action="counter-val"][data-index="${idx}"]`);
        const maxEl = el.querySelector(`[data-action="counter-max"][data-index="${idx}"]`);
        const max  = parseInt(maxEl?.value) || Infinity;
        const cur  = parseInt(inp?.value) || 0;
        if (inp && cur < max) { inp.value = cur + 1; await saveCounter(idx); paintMeter(inp); }
      })
    );
    el.querySelectorAll('[data-action="counter-dec"]').forEach(btn =>
      btn.addEventListener('click', async () => {
        const idx = parseInt(btn.dataset.index);
        const inp = el.querySelector(`[data-action="counter-val"][data-index="${idx}"]`);
        const cur = parseInt(inp?.value) || 0;
        if (inp && cur > 0) { inp.value = cur - 1; await saveCounter(idx); paintMeter(inp); }
      })
    );
    /* The pip row is gone from the sheet — the bar replaced it — so the
       handler that set a counter by clicking one went with it. */

    /* ── The Features tab: a search and two filters ─────────────────────

       One function, because the three have to compose: choosing a source
       and then typing must narrow what the source left, not start again.
       Each is applied in turn to every row, and a section whose every row
       is hidden goes with them — or the tab is left with headings standing
       over nothing.

       All of it in the DOM, not by re-rendering. This tab is the biggest on
       the sheet — ninety rows on the heaviest character here, more than half
       the page — and redrawing it to hide eighty of them is what made the
       inventory search stutter before it was changed for the same reason.

       The choice is remembered on the sheet, because writing anything to the
       actor redraws the page and would otherwise clear it.

       The search itself used to filter `.am-feat-item`, markup the Quadrone
       rewrite had already replaced, so typing in it did nothing at all. */
    const featureTab = el.querySelector('.tidy-tab.features');
    if (featureTab) {
      const applyFeatureFilters = () => {
        const q      = (this._featSearch ?? '').trim().toLowerCase();
        const source = this._featSource ?? null;
        const active = !!this._featActive;

        /* Only the tables that are a source group, and only the rows that
           belong to one directly.

           A row can hold a table of its own — an item whose actions are
           listed under it — and those inner tables carry no section key. The
           first version of this walked every .tidy-table, read the inner
           ones' missing key as 'not the chosen source', and hid their rows:
           choosing Class showed one row where the group holds two, and the
           one that vanished was a feature's own action. Hiding a row hides
           what is nested inside it anyway, so only the outer rows are
           touched. */
        const sections = [...featureTab.querySelectorAll('.tidy-table[data-tidy-section-key]')];
        for (const section of sections) {
          const key = section.dataset.tidySectionKey ?? '';
          const sectionOut = !!source && key !== source;

          const own = [...section.querySelectorAll('.tidy-table-row-container')]
            .filter((row) => row.parentElement?.closest?.('.tidy-table-row-container') == null);

          let shown = 0;
          for (const row of own) {
            const name = (row.querySelector('.item-name')?.textContent ?? '').toLowerCase();
            const hide = sectionOut
              || (!!q && !name.includes(q))
              || (active && !row.dataset.activation);
            row.classList.toggle('am-hidden', hide);
            if (!hide) shown++;
          }
          section.classList.toggle('am-hidden', shown === 0);
        }
      };

      el.querySelector('#am-feature-search')?.addEventListener('input', (e) => {
        this._featSearch = e.target.value;
        applyFeatureFilters();
      });

      /* A chip is a toggle: pressing the one already chosen clears it, the
         way the spell window's level and school buttons behave. */
      el.querySelectorAll('[data-feat-source]').forEach(chip =>
        chip.addEventListener('click', (e) => {
          e.preventDefault();
          const want = chip.dataset.featSource;
          this._featSource = this._featSource === want ? null : want;
          el.querySelectorAll('[data-feat-source]').forEach(c =>
            c.classList.toggle('am-active', c.dataset.featSource === this._featSource));
          applyFeatureFilters();
        })
      );

      el.querySelector('[data-feat-active]')?.addEventListener('click', (e) => {
        e.preventDefault();
        this._featActive = !this._featActive;
        e.currentTarget.classList.toggle('am-active', this._featActive);
        applyFeatureFilters();
      });

      /* A redraw brings back every row; the choice outlived it, so it is
         applied again — and the controls are put back in the state it left. */
      if (this._featSearch) {
        const box = el.querySelector('#am-feature-search');
        if (box) box.value = this._featSearch;
      }
      el.querySelectorAll('[data-feat-source]').forEach(c =>
        c.classList.toggle('am-active', c.dataset.featSource === this._featSource));
      el.querySelector('[data-feat-active]')?.classList.toggle('am-active', !!this._featActive);
      if (this._featSearch || this._featSource || this._featActive) applyFeatureFilters();
    }

    /* Currency */
    el.querySelectorAll('[data-action="currency-edit"]').forEach(inp =>
      inp.addEventListener('change', async (e) => {
        /* data-denom, which is what the template writes. This read
           dataset.currency, so every coin edit updated
           system.currency.undefined — a field a5e's schema drops without a
           word, leaving the coin to snap back on the next render. */
        const key = inp.dataset.denom;
        if (!key) return;
        const val = Math.max(0, parseInt(e.target.value) || 0);
        await this.actor.update({ [`system.currency.${key}`]: val });
      })
    );

    /* Short / Long rest */
    /* a5e has no shortRest or longRest. The method is triggerRest, and called
       with no options it opens the system's own dialog — which is where the
       rest type is chosen and hit dice are spent and rolled. The two buttons
       here called methods that do not exist, so `?.()` returned undefined and
       nothing happened beyond a notice claiming it had. */
    /* Two things open the rest dialog now: the header button and the hit-dice
       meter, since hit dice are spent there. querySelector would have bound
       only the first and left the meter dead. */
    el.querySelectorAll('[data-action="rest"]').forEach(node =>
      node.addEventListener('click', async (e) => {
        e.preventDefault();
        if (typeof this.actor.triggerRest === 'function') {
          await this.actor.triggerRest();
          return;
        }
        ui.notifications.warn('This version of the a5e system has no rest dialog.');
      })
    );

    /* Level Up */
    el.querySelector('[data-action="level-up"]')?.addEventListener('click', () =>
      AM.openLevelUp(this.actor)
    );

    /* Manage maneuvers — the dialog derives slots, degree and tradition caps from
       the character's class tables. GMs get an unlock toggle inside it. */
    el.querySelector('[data-action="manage-maneuvers"]')?.addEventListener('click', () =>
      new ManeuverDialog(this.actor, { manage: true }).render(true)
    );

    /* Manage spells. Spell level cap follows the caster's class level; a5e has no
       bundled spells-known-per-level table, so the count itself stays free-form. */
    el.querySelector('[data-action="manage-spells"]')?.addEventListener('click', () => {
      const classes = this.actor.items.filter(i => i.type === 'class');
      const lvlOf = (i) =>
        i.system?.classLevels ?? i.system?.levels ?? i.system?.level ?? 1;

      /* Which class's spell list to open on.

         The module's own CLASS_SPELL_TABLES knows nine classes — the vanilla
         ones. a5e itself knows seventeen spell lists, psion, psyknight,
         wielder, witch, esper and the four elementalists among them. Asking
         only the module meant every one of those characters fell through to
         an empty class name, and an empty name means no filter at all: the
         window opened on every spell in every compendium, untitled. Asking
         the system first gives them their real list.

         An unknown class still costs nothing. classSpellListKey returns ''
         for one, and spellAllowsClass reads that as 'do not hide anything' —
         so an Illrigger, which is on nobody's spell list, gets the same
         unfiltered window it got before, now at least under its own name. */
      const casterClass =
           classes.find(i => SpellService.classSpellListKey(i.name))
        ?? classes.find(i => SpellService.isSpellcaster(i.name))
        ?? classes.slice().sort((a, b) => lvlOf(b) - lvlOf(a))[0];

      const casterLevel = casterClass
        ? lvlOf(casterClass)
        : (classes.reduce((n, i) => n + lvlOf(i), 0) || 1);
      new SpellDialog(this.actor, {
        manage:           true,
        className:        casterClass?.name ?? '',
        cantripsToChoose: -1,
        spellsToChoose:   -1,
        maxSpellLevel:    Math.max(1, Math.min(9, Math.ceil(casterLevel / 2))),
        /* Into the book the Magic tab is showing, not always the first. */
        spellBookId:      this._spellBook ?? null
      }).render(true);
    });


    /* Biography textareas — auto-save on blur */
    el.querySelectorAll('[data-path]').forEach(textarea =>
      textarea.addEventListener('blur', async (e) => {
        await this.actor.update({ [e.target.dataset.path]: e.target.value });
      })
    );

    /* ══ Tidy layout controls ═══════════════════════════════════════════
       Behaviour Tidy implements in Svelte and we have to supply ourselves,
       because we render its markup from Handlebars. Each one is written
       against Tidy's own classes so the animations and states it styles
       are the ones that actually appear. */

    /* Rolling one half of an action. The item's icon still activates the
       whole thing through a5e, dialog and all; these two are for when only
       the attack or only the damage is wanted, which is most of what a
       second click is ever for.

       They roll the figure the row is showing rather than going back
       through the system, because that figure is already the resolved one —
       ability, proficiency and bonus worked out in #parseRollsFromAction. */
    el.querySelectorAll('[data-action="roll-attack"]').forEach(b =>
      b.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const bonus = String(b.dataset.bonus ?? '').trim();
        const formula = bonus ? `1d20 ${bonus.startsWith('-') ? '- ' + bonus.slice(1) : '+ ' + bonus.replace(/^\+/, '')}` : '1d20';
        await this.#roll(formula, `${b.dataset.label ?? 'Attack'} — to hit`);
      })
    );

    el.querySelectorAll('[data-action="roll-damage"]').forEach(b =>
      b.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const formula = String(b.dataset.formula ?? '').trim();
        if (!formula) return;
        await this.#roll(formula, `${b.dataset.label ?? 'Damage'} — damage`);
      })
    );

    /* The trackers, and exertion, are counters: type a figure, or step it
       with the buttons beside it. Stepping is what these are used for in
       play, and a bare input made that a chore. */
    const stepCounter = (path, delta) => async (e) => {
      e.preventDefault();
      const el2 = e.currentTarget;
      const max = el2.dataset.max === '' ? null : Number(el2.dataset.max);
      const now = Number(foundry.utils.getProperty(this.actor, path) ?? 0) || 0;
      let next = now + delta;
      if (next < 0) next = 0;
      if (max !== null && Number.isFinite(max) && max > 0 && next > max) next = max;
      if (next === now) return;
      await writeNumber(path, next,
        el2.closest('.am-tracker, .am-a5e-stat')?.querySelector('input.am-tracker-value'));
    };

    /* The resource handlers that stood here read data-resource and always wrote
       system.resources.<key>.value. They have moved up beside the lock, where
       they read data-path instead — a class resource is stored flat under
       classResources and has no .value to write to. Two sets of handlers were
       binding to the same buttons for a moment; this is the older one. */

    el.querySelectorAll('[data-action="exertion-step"]').forEach(b =>
      b.addEventListener('click', stepCounter(b.dataset.path || 'system.attributes.exertion.current',
        Number(b.dataset.delta) || 0)));

    /* ══ Inventory utility bar ═════════════════════════════════════════
       Search, filters, sort and add — a5e's UtilityBar, rebuilt against our
       markup. Filters live in a5e's own flag so the two sheets agree. */

    const invSearch = el.querySelector('[data-action="inv-search"]');
    if (invSearch) {
      /* Filtered in the DOM, the way the features and effects searches are.

         This used to re-render on a 250 ms pause. One redraw of this sheet is
         measured at 16 ms on average and 25 at the worst, and it builds
         between 320 and 555 kB of markup — every row of every tab, not just
         the inventory — which the browser then parses and lays out. Doing
         that four times a second while somebody types is what the stutter
         was.

         Searching descriptions is the exception and still re-renders: the
         text is not in the page, so there is nothing in the DOM to match it
         against. It is off by default and toggled deliberately, so the cost
         lands where somebody asked for it. */
      const filterInv = () => {
        const q = invSearch.value.trim().toLowerCase();
        const tab = el.querySelector('.tidy-tab.inventory');
        if (!tab) return;
        for (const row of tab.querySelectorAll('.tidy-table-row-container')) {
          const name = (row.querySelector('.item-name')?.textContent ?? '').toLowerCase();
          row.classList.toggle('am-hidden', !!q && !name.includes(q));
        }
        /* A section whose every row is filtered out goes with them, or the
           tab is left with headings standing over nothing. */
        for (const table of tab.querySelectorAll('.tidy-table')) {
          const rows = [...table.querySelectorAll('.tidy-table-row-container')];
          table.classList.toggle('am-hidden', rows.length > 0 &&
            rows.every(r => r.classList.contains('am-hidden')));
        }
      };

      let timer = null;
      invSearch.addEventListener('input', () => {
        this._invSearch = invSearch.value;
        if (!this._invSearchDesc) { filterInv(); return; }
        clearTimeout(timer);
        timer = setTimeout(() => this.render(false), 250);
      });
      /* The field keeps its text across a redraw, so the rows have to be
         filtered again to match it. */
      if (invSearch.value) filterInv();
    }

    el.querySelector('[data-action="inv-search-desc"]')?.addEventListener('click', (e) => {
      e.preventDefault();
      this._invSearchDesc = !this._invSearchDesc;
      this.render(false);
    });

    el.querySelector('[data-action="inv-filters"]')?.addEventListener('click', (e) => {
      e.preventDefault();
      el.querySelector('.am-filter-panel')?.toggleAttribute('hidden');
    });

    /* Each filter cycles neutral → include → exclude → neutral. */
    el.querySelectorAll('[data-action="inv-filter"]').forEach(b =>
      b.addEventListener('click', async (e) => {
        e.preventDefault();
        const key = b.dataset.filter;
        const f = this.actor.getFlag('a5e', 'filters') ?? {};
        const cur = f.objects ?? { inclusive: [], exclusive: [] };
        const inc = new Set(cur.inclusive ?? []);
        const exc = new Set(cur.exclusive ?? []);
        if (inc.has(key)) { inc.delete(key); exc.add(key); }
        else if (exc.has(key)) { exc.delete(key); }
        else { inc.add(key); }
        await this.actor.setFlag('a5e', 'filters', {
          ...f, objects: { inclusive: [...inc], exclusive: [...exc] }
        });
      })
    );

    el.querySelector('[data-action="inv-filters-clear"]')?.addEventListener('click', async (e) => {
      e.preventDefault();
      const f = this.actor.getFlag('a5e', 'filters') ?? {};
      await this.actor.setFlag('a5e', 'filters', {
        ...f, objects: { inclusive: [], exclusive: [] }
      });
    });

    /* Alphabetical sort. a5e does this by rewriting each item's sort value,
       which is what keeps the order after a reload. */
    el.querySelectorAll('[data-action="inv-sort"]').forEach(b =>
      b.addEventListener('click', async (e) => {
        e.preventDefault();
        const desc = b.dataset.dir === 'desc';
        const objects = this.actor.items.filter(i => i.type === 'object');
        const sorted = [...objects].sort((a, z) =>
          desc ? z.name.localeCompare(a.name) : a.name.localeCompare(z.name));
        await this.actor.updateEmbeddedDocuments('Item',
          sorted.map((item, i) => ({ _id: item.id, sort: (i + 1) * 100000 })));
      })
    );

    /* Add an object of a chosen subtype, the way a5e's plus menu does. */
    el.querySelector('[data-action="inv-add"]')?.addEventListener('change', async (e) => {
      const objectType = e.currentTarget.value;
      if (!objectType) return;
      e.currentTarget.value = '';
      const label = game.i18n.localize(CONFIG?.A5E?.objectTypes?.[objectType] ?? '') || 'Object';
      await this.actor.createEmbeddedDocuments('Item', [{
        name: game.i18n.format('DOCUMENT.New', { type: label }),
        type: 'object',
        system: { objectType }
      }]);
    });

    /* Hit points read as a label and edit as inputs, which is how Tidy does
       it — the bar is too small to hold three live fields and still be
       legible. Clicking the label (or the temp badge) swaps them, and
       leaving the block puts the label back. */
    const hpMeter = el.querySelector('.hit-points');
    const hpLabel = hpMeter?.querySelector('.label');
    const hpEdit  = hpMeter?.querySelector('.am-hp-edit');
    if (hpLabel && hpEdit) {
      const showEditor = (show) => {
        hpLabel.hidden = show;
        hpEdit.hidden = !show;
        /* Selected, so what is typed replaces the figure rather than being
           appended to it. */
        if (show) { const first = hpEdit.querySelector('input'); first?.focus(); first?.select?.(); }
      };
      el.querySelectorAll('[data-action="hp-edit"]').forEach(b =>
        b.addEventListener('click', (e) => { e.preventDefault(); showEditor(true); }));
      hpEdit.addEventListener('focusout', () => {
        /* focusout fires before focus lands on the next element, so wait a
           tick before deciding the block has really been left. */
        setTimeout(() => { if (!hpEdit.contains(document.activeElement)) showEditor(false); }, 0);
      });
    }

    /* Sidebar collapse. Tidy stores this per tab as a user preference; we
       keep it for the life of the sheet, which is the part that shows. */
    el.querySelector('.sidebar-toggle')?.addEventListener('click', (e) => {
      e.preventDefault();
      const sidebar = el.querySelector('.sidebar');
      if (!sidebar) return;
      const expanded = sidebar.classList.toggle('expanded');
      const icons = e.currentTarget.querySelectorAll('i');
      if (icons.length === 2) {
        icons[0].className = expanded ? 'fa-solid fa-caret-left' : 'fa-solid fa-sidebar';
        icons[1].className = expanded ? 'fa-solid fa-sidebar-flip' : 'fa-solid fa-caret-right';
      }
    });

    /* The sidebar's own Skills/Traits strip. Not a Foundry tab group — see
       the note in defaultOptions for why it cannot be one. */


    /* Collapsing an item table. Tidy toggles .expanded on the wrapper and on
       the chevron; the height animation is entirely CSS, so setting the two
       classes is the whole job. */
    el.querySelectorAll('.tidy-table-header-row.toggleable').forEach(header => {
      header.addEventListener('click', (e) => {
        /* .am-slots too, not only its buttons: a click that falls in the gap
           between two stars would otherwise fold the list away, which to the
           person aiming at a star reads as the star doing the wrong thing. */
        if (e.target.closest('button, a, input, .am-slots')) return;
        const section = header.closest('.tidy-table');
        const wrapper = section?.querySelector('.expandable');
        const chevron = header.querySelector('.expand-button');
        if (!wrapper) return;
        const expanded = wrapper.classList.toggle('expanded');
        chevron?.classList.toggle('expanded', expanded);
        chevron?.classList.toggle('collapsed', !expanded);
      });
    });

    /* Fatigue and strife. A5e's two tracks run 0-7 and replace exhaustion,
       so they take the control Tidy gives exhaustion: click steps up,
       right-click steps down, both wrapping at the ends. */
    const cycleTrack = (path, max) => async (e, down) => {
      e.preventDefault();
      const current = Number(foundry.utils.getProperty(this.actor, path) ?? 0) || 0;
      const next = down
        ? (current <= 0 ? max : current - 1)
        : (current >= max ? 0 : current + 1);
      await this.actor.update({ [path]: next });
    };
    for (const [action, path] of [
      ['cycle-fatigue', 'system.attributes.fatigue'],
      ['cycle-strife',  'system.attributes.strife']
    ]) {
      const step = cycleTrack(path, 7);
      el.querySelectorAll(`[data-action="${action}"]`).forEach(btn => {
        btn.addEventListener('click', (e) => step(e, false));
        btn.addEventListener('contextmenu', (e) => step(e, true));
      });
    }

    /* Spell slots, as stars on the level's own heading.

       The arithmetic is a5e's, taken from its ItemListSpellSlots component so
       the two sheets behave identically: slot n is expended when n is above
       what is left; clicking a star that is still lit spends down to just
       below it (current = n - 1), and clicking a spent one recovers up to and
       including it (current = n). One click therefore both spends and
       restores, depending on which star it lands on, and clicking the lowest
       lit star empties the level. */
    el.querySelectorAll('[data-action="slot-pip"]').forEach(b =>
      b.addEventListener('click', async (e) => {
        e.preventDefault();
        /* The stars sit in the section heading, and the heading collapses the
           table when it is clicked. That handler already steps aside for a
           button, so this is belt and braces — but a star that both spends a
           slot and folds the list away would be indistinguishable from one
           that does not work, and it is one line. */
        e.stopPropagation();
        const level = b.dataset.level;
        const n     = Number(b.dataset.n);
        const slots = this.actor.system?.spellResources?.slots?.[level];
        if (!slots || !Number.isFinite(n)) return;
        const now  = Number(slots.current ?? 0) || 0;
        const next = n <= now ? n - 1 : n;
        if (next === now) return;

        /* Drawn at once, as a5e's reactive store draws it, and put back —
           with the reason — if the write fails or does not stick. Reported
           as: the stars neither spend nor restore. Clicked in a real browser
           with this script bound, they write exactly what a5e writes; what
           goes wrong in a world is then something between the click and the
           saved document, and the sheet should say what, not stay silent. */
        const levelStars = [...el.querySelectorAll('[data-action="slot-pip"]')]
          .filter((s) => s.dataset.level === level);
        const paint = (value) => levelStars.forEach((s) =>
          s.classList.toggle('am-slot-spent', Number(s.dataset.n) > value));
        paint(next);
        try {
          await this.actor.update({ [`system.spellResources.slots.${level}.current`]: next });
        } catch (err) {
          paint(now);
          AM.log(1, `Level ${level} spell slots could not be changed:`, err);
          ui.notifications.error(`Level ${level} spell slots could not be changed: ${err?.message ?? err}`);
          return;
        }
        const saved = Number(this.actor.system?.spellResources?.slots?.[level]?.current);
        if (Number.isFinite(saved) && saved !== next) {
          paint(saved);
          ui.notifications.warn(`Level ${level} spell slots: ${next} was sent, but the actor kept ${saved}.`);
        }
      })
    );

    /* Unlocked, the stars give way to a5e's two fields: slots left, and the
       total — the override on a character, whose total is otherwise derived
       from its classes, and the total itself on a monster. The field names
       come from the context, which decided that once. Neither input carries
       a name, so the form's own submit leaves them alone. */
    /* Spell books, through a5e's own SpellBookManager: add() writes a new
       book with its schema's defaults and returns its id, remove() deletes
       the book and every spell in it. As on a5e's page, a new book is shown
       at once and its settings opened. */
    el.querySelector('[data-action="spellbook-add"]')?.addEventListener('click', async (e) => {
      e.preventDefault();
      if (typeof this.actor.spellBooks?.add !== 'function') return;
      const id = await this.actor.spellBooks.add({});
      if (!id) return;
      this._spellBook = id;
      this.#configureSpellBook(id);
    });

    el.querySelectorAll('[data-action="spellbook-config"]').forEach(b =>
      b.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.#configureSpellBook(b.dataset.book);
      })
    );

    el.querySelectorAll('[data-action="spellbook-delete"]').forEach(b =>
      b.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const id = b.dataset.book;
        const book = this.actor.spellBooks?.get?.(id);
        if (!book) return;
        const esc = (s) => foundry.utils.escapeHTML(String(s ?? ''));
        const count = this.actor.items.filter(i => i.type === 'spell' && i.system?.spellBook === id).length;
        /* a5e's delete takes the spells in the book with it, so the question
           says so. */
        const ok = await foundry.applications.api.DialogV2.confirm({
          window: { title: 'Delete spell book' },
          content: `<p>Delete <strong>${esc(book.name)}</strong>${count
            ? ` and the ${count} spell${count === 1 ? '' : 's'} in it` : ''}? This cannot be undone.</p>`,
          rejectClose: false
        });
        if (!ok) return;
        if (this._spellBook === id) this._spellBook = null;
        await this.actor.spellBooks.remove(id);
      })
    );

    /* A spell's book, picked in its summary. */
    el.querySelectorAll('[data-action="spell-move-book"]').forEach(sel =>
      sel.addEventListener('change', async (e) => {
        e.stopPropagation();
        const item = this.actor.items.get(sel.dataset.id);
        const to = sel.value;
        if (!item || !to || !Object.keys(this.actor.system?.spellBooks ?? {}).includes(to)) return;
        await item.update({ 'system.spellBook': to });
      })
    );

    el.querySelector('[data-action="spellbook-sort"]')?.addEventListener('click', (e) => {
      e.preventDefault();
      this.#sortUnbookedSpells();
    });

    /* A book's resources: spell points, inventions, artifact charges. */
    el.querySelectorAll('[data-action="spell-resource"]').forEach(inp =>
      inp.addEventListener('change', async (e) => {
        e.stopPropagation();
        const path = inp.dataset.path;
        if (!/^system\.spellResources\.(points|inventions|artifactCharges)\.(current|max|override)$/.test(path)) return;
        await this.actor.update({ [path]: Math.max(0, Math.floor(Number(inp.value) || 0)) });
      })
    );

    el.querySelectorAll('[data-action="slot-field"]').forEach(inp =>
      inp.addEventListener('change', async (e) => {
        e.stopPropagation();
        const { level, field } = inp.dataset;
        if (!['current', 'override', 'max'].includes(field)) return;
        const value = Math.max(0, Math.floor(Number(inp.value) || 0));
        await this.actor.update({ [`system.spellResources.slots.${level}.${field}`]: value });
      })
    );

    /* Initiative and concentration, which the old header had no buttons for. */
    el.querySelector('[data-action="roll-initiative"]')?.addEventListener('click', async (e) => {
      e.preventDefault();
      if (typeof this.actor.rollInitiative === 'function') {
        await this.actor.rollInitiative({ createCombatants: true });
      }
    });

    el.querySelector('[data-action="concentration-check"]')?.addEventListener('click', async (e) => {
      e.preventDefault();
      /* a5e rolls this itself; fall back to a Constitution save if the system
         ever renames the method, so the button is never simply dead. */
      if (typeof this.actor.rollConcentrationCheck === 'function') {
        await this.actor.rollConcentrationCheck();
      } else if (typeof this.actor.rollSavingThrow === 'function') {
        await this.actor.rollSavingThrow('con');
      }
    });
  }

  /* ── Private helpers ──────────────────────────────── */

  #actCostLabel(activation) {
    return { action: 'A', bonus: 'B', reaction: 'R', other: '' }[activation] ?? 'A';
  }

  /* a5e stores damage and attack formulas with roll-data references, so a
     mace reads "1d8 + @str.mod" until it is resolved against the actor.
     Printed as written, that is what the sheet showed.

     Foundry does the substitution; the tidying afterwards is only so the
     result reads as a person would write it — no "+ -2", no dangling
     "+ 0" from an ability the formula names but the actor has nothing in. */
  #resolveFormula(formula) {
    if (formula === null || formula === undefined || formula === '') return formula;
    let out = String(formula);
    try {
      const rollData = this.actor?.getRollData?.() ?? {};
      out = Roll.replaceFormulaData(out, rollData, { missing: '0', warn: false });
    } catch (err) {
      AM.log(2, 'formula resolve:', err);
      return String(formula);
    }
    out = this.#simplifyArithmetic(out);

    return out
      .replace(/\+\s*-\s*/g, '- ')
      .replace(/\s*\+\s*0(?![\d.])/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /* Works out the arithmetic left behind once roll data has been
     substituted, without touching the dice.

     A scaling cantrip is written as something like
     '(floor((@details.level+1)/6)+1)d10', and substituting the level turns
     that into '(floor((1+1)/6)+1)d10' — correct, unreadable, and too long
     for the column. Reduced innermost-first it becomes '1d10'.

     Only groups that are pure arithmetic are touched: the test rejects any
     letter, so '1d10' is never mistaken for something to evaluate. */
  #simplifyArithmetic(formula) {
    const SAFE = /^[\d\s+\-*/().]+$/;
    const FN = /\b(floor|ceil|round|abs)\(([^()]*)\)/;
    const evalSafe = (expr) => Function('"use strict"; return (' + expr + ');')();

    let out = String(formula);
    /* Bounded rather than while(true): a formula this loop cannot reduce
       should be left alone, not spun on. */
    for (let pass = 0; pass < 24; pass++) {
      let changed = false;

      out = out.replace(FN, (whole, name, inner) => {
        if (!SAFE.test(inner)) return whole;
        try { const v = Math[name](evalSafe(inner)); changed = true; return String(v); }
        catch { return whole; }
      });

      out = out.replace(/\(([^()]+)\)/, (whole, inner) => {
        if (!SAFE.test(inner)) return whole;
        try { const v = evalSafe(inner); changed = true; return String(v); }
        catch { return whole; }
      });

      if (!changed) break;
    }
    return out;
  }

  /* A whole formula for a number: an attack bonus is usually written as
     something like "@mod + @prof", so it has to be worked out rather than
     read. Number() alone gives NaN and the column came out empty. */
  #formulaToNumber(formula) {
    const resolved = this.#resolveFormula(formula);
    if (resolved === '' || resolved === null || resolved === undefined) return null;
    const direct = Number(resolved);
    if (Number.isFinite(direct)) return direct;
    try {
      const value = Roll.safeEval(resolved);
      return Number.isFinite(value) ? value : null;
    } catch {
      return null;
    }
  }

  /* Which ability an attack uses, ported from a5e's getAttackAbility.
     'default' is not a value but a rule: melee weapons use Strength unless
     the weapon is finesse, in which case whichever of Strength and
     Dexterity is higher; ranged weapons use Dexterity unless thrown, same
     tie-break; spell attacks use the spellcasting ability. */
  #attackAbility(item, attack) {
    const sys = this.actor.system ?? {};
    const mod = (k) => sys.abilities?.[k]?.mod
      ?? Math.floor(((sys.abilities?.[k]?.value ?? 10) - 10) / 2);
    const spellAbility = () => sys.spellcasting?.ability
      ?? sys.attributes?.spellcasting
      ?? item?.system?.ability
      ?? 'int';

    const ability = attack?.ability;
    if (ability === 'spellcasting') return spellAbility();
    if (ability && ability !== 'default') return ability;

    const type  = attack?.attackType || 'meleeWeaponAttack';
    const props = item?.system?.weaponProperties ?? [];
    const better = () => (mod('dex') > mod('str') ? 'dex' : 'str');

    if (type === 'meleeSpellAttack' || type === 'rangedSpellAttack') return spellAbility();
    if (type === 'meleeWeaponAttack') return props.includes('finesse') ? better() : 'str';
    if (type === 'rangedWeaponAttack') return props.includes('thrown') ? better() : 'dex';
    return 'str';
  }

  #parseRollsFromAction(action, item) {
    /* a5e declares rolls as a RecordField — an object keyed by roll id, not
       an array (see ActionDataModel.rolls). Testing Array.isArray on it was
       always false, so every attack bonus and damage formula on the sheet
       came out empty. Accept all three shapes the data can take. */
    const rolls = Array.isArray(action?.rolls) ? action.rolls
      : action?.rolls instanceof Map ? [...action.rolls.values()]
      : Object.values(action?.rolls ?? {});
    const attackRoll  = rolls.find(r => r.type === 'attack');
    const damageRolls = rolls.filter(r => r.type === 'damage');
    const saveRoll    = rolls.find(r => r.type === 'savingThrow');
    const oldDmgArr   = action?.damage ?? action?.damages ?? [];
    const oldDmg      = oldDmgArr[0]?.formula ?? oldDmgArr[0]?.dice ?? null;
    const oldAtkBonus = action?.attackBonus ?? action?.attack?.bonus ?? null;
    const oldSaveDC   = action?.save?.dc ? `DC ${action.save.dc}` : null;
    const oldDmgType  = oldDmgArr[0]?.damageType ?? null;
    const atkRaw      = attackRoll?.bonus ?? oldAtkBonus ?? '';
    const dmg         = this.#resolveFormula(damageRolls[0]?.formula ?? oldDmg);
    const saveDCRaw   = saveRoll?.dc ?? saveRoll?.saveDC ?? null;
    const saveDC      = saveDCRaw ? `DC ${saveDCRaw}` : oldSaveDC;
    const rawType     = damageRolls[0]?.damageType ?? oldDmgType;
    const dmgType     = rawType ? rawType.charAt(0).toUpperCase() + rawType.slice(1) : null;
    /* The stored bonus is only the EXTRA on top; a5e works the shown
       number out from the ability, proficiency and that extra. Reading the
       field alone left the column empty, because it is usually ''. */
    let atkBonus = null;
    if (attackRoll) {
      const sys = this.actor.system ?? {};
      const key = this.#attackAbility(item, attackRoll);
      const abilityMod = sys.abilities?.[key]?.mod
        ?? Math.floor(((sys.abilities?.[key]?.value ?? 10) - 10) / 2);
      const profBonus = sys.attributes?.prof ?? sys.proficiencyBonus ?? this.#calcProf(this.actor);
      const extra = this.#formulaToNumber(attackRoll.bonus) ?? 0;
      const proficient = attackRoll.proficient !== false;
      atkBonus = sign(abilityMod + (proficient ? profBonus : 0) + extra);
    } else if (atkRaw !== '') {
      const n = this.#formulaToNumber(atkRaw);
      atkBonus = n === null ? null : sign(n);
    }
    return { atkBonus, dmg, dmgFull: dmg ? (dmgType ? `${dmg} ${dmgType}` : dmg) : null, dmgType, saveDC };
  }

  #allActionsForItem(item) {
    const sys        = item.system ?? {};
    const actionsObj = sys.actions ?? {};
    let entries;
    if (actionsObj instanceof Map) {
      entries = [...actionsObj.entries()];
    } else if (actionsObj?.contents?.length) {
      entries = actionsObj.contents.map(a => [a.id ?? a._id ?? foundry.utils.randomID(), a]);
    } else if (Array.isArray(actionsObj)) {
      entries = actionsObj.map((a, i) => [a.id ?? String(i), a]);
    } else {
      entries = Object.entries(actionsObj);
    }
    if (!entries.length) {
      const activation = this.#resolveActivation({}, sys);
      return [{ actionId: 'default', itemId: item.id, name: item.name, img: item.img,
                activation, activationLabel: this.#actCostLabel(activation),
                ...this.#parseRollsFromAction({}, item) }];
    }
    return entries.map(([actionId, action]) => {
      const activation = this.#resolveActivation(action, action);
      return { actionId, itemId: item.id,
               name: action.name || item.name,
               /* Actions carry no art of their own in a5e, so they show the
                  item's, which is what a5e's own cards do. */
               img: action.img || item.img,
               /* Rendered as an escaped one-line subtitle, so it is reduced to
                  text here: printed as-is it showed its own <p> tags and any
                  @UUID[…] link it contained, unresolved. */
               desc: plainText(action.description || '').slice(0, 120),
               activation, activationLabel: this.#actCostLabel(activation),
               ...this.#parseRollsFromAction(action, item) };
    });
  }

  #buildActionGroup(item, favoriteIds) {
    const sys           = item.system ?? {};
    const uses          = sys.uses ?? {};
    const isEquippable  = item.type === 'object';
    const equippedState = isEquippable ? (sys.equippedState ?? 1) : null;
    const starred       = favoriteIds.has(item.id) || !!(sys.favorite);
    const actions       = this.#allActionsForItem(item);
    const primary       = actions[0] ?? {};
    return {
      id: item.id, uuid: item.uuid, name: item.name, img: item.img,
      starred: this.#starred(item),
      type: item.type,
      isEquippable,
      equipped:   equippedState === 2,
      carried:    equippedState === 1,
      notCarried: equippedState === 0,
      ...this.#stateBadges(item),
      attuned:    sys.attuned ?? false,
      needsAttune: sys.requiresAttunement ?? false,
      starred,
      qty:  isEquippable ? (sys.quantity ?? 1) : null,
      uses: { current: uses.current ?? uses.value ?? null,
               max: uses.max ?? null, hasUses: !!(uses.max > 0) },
      actions,
      /* An item with a single action would otherwise draw a second row that
         only repeats its own name — allActionsForItem falls back to the item
         name when an action has none. So the row shows the first action's
         numbers itself, and the separate rows appear only where there is
         genuinely more than one thing to choose between. */
      multiAction: actions.length > 1,
      atkBonus:        primary.atkBonus ?? null,
      dmgFull:         primary.dmgFull ?? null,
      saveDC:          primary.saveDC ?? null,
      activationLabel: primary.activationLabel ?? null,
      desc: this.#itemDesc(item),
    };
  }

  #calcProf(actor) {
    // Same a5e path as #classItem; without classLevels every class counted as 1,
    // so the fallback proficiency bonus was too low above 4th level.
    const lvl = actor.items.filter(i => i.type === 'class')
      .reduce((n, i) => n + (i.system?.classLevels ?? i.system?.levels ?? i.system?.level ?? 1), 0) || 1;
    return Math.ceil(1 + lvl / 4);
  }

  #groupBy(arr, key) {
    const map = {};
    for (const item of arr) {
      const k = item[key] || 'Other';
      if (!map[k]) map[k] = [];
      map[k].push(item);
    }
    return map;
  }

  /**
   * Normalise activation type to one of: 'action' | 'bonus' | 'reaction' | 'other'
   * A5e stores it in action.activation.type with values like:
   * 'action', 'bonusAction', 'reaction', 'free', 'legendary', 'lair', 'utility', 'special'
   */
  #resolveActivation(actionData, sys) {
    const raw = (
      actionData?.activation?.type ??
      sys?.activation?.type ??
      ''
    ).toLowerCase();

    if (raw === 'bonusaction' || raw === 'bonus') return 'bonus';
    if (raw === 'reaction') return 'reaction';
    if (raw === 'free' || raw === 'utility' || raw === 'special' ||
        raw === 'legendary' || raw === 'lair' || raw === 'passive' || raw === 'none') return 'other';
    return 'action'; // 'action', '', or anything else → main action
  }

  /**
   * Everything on this character that can be attuned, in one window, with the
   * attuned ones marked and either state a click away.
   *
   * The figure in the inventory footer says how many of how many, and the
   * sidebar's Traits tab lists them as pills — but a pill row is a poor place
   * to choose from when a character carries a dozen, and neither says which
   * items COULD be attuned without being.
   *
   * The set is a5e's: an item can be attuned exactly when it requires
   * attunement. Toggling goes through a5e's own item.toggleAttunement, so
   * whatever rules it applies are applied here too, and the character sheet
   * behind this window redraws itself when the item changes.
   */
  async #openAttunement() {
    const actor = this.actor;
    const max = Number(actor.system?.attributes?.attunement?.max ?? 3) || 3;

    const rowsFor = () => actor.items.contents
      .filter((i) => i.system?.requiresAttunement)
      .sort((a, b) => Number(!!b.system?.attuned) - Number(!!a.system?.attuned)
                   || a.name.localeCompare(b.name));

    const esc = (s) => String(s ?? '').replace(/[&<>"]/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

    const rarityOf = (i) => {
      const key = i.system?.rarity ?? '';
      const label = CONFIG?.A5E?.itemRarity?.[key];
      return key ? (label ? game.i18n.localize(label) : key) : '';
    };

    const drawRow = (i) => {
      const on = !!i.system?.attuned;
      return `
      <button type="button" class="am-att-row${on ? ' am-att-on' : ''}" data-id="${i.id}">
        <img src="${esc(i.img)}" width="28" height="28" alt="" />
        <span class="am-att-name">${esc(i.name)}</span>
        <span class="am-att-rarity">${esc(rarityOf(i))}</span>
        <i class="am-att-sun ${on ? 'fa-solid fa-sun' : 'fa-regular fa-sun'}"></i>
      </button>`;
    };

    const items = rowsFor();
    if (!items.length) {
      ui.notifications.info(game.i18n.localize('am.sheet.nothing-to-attune'));
      return;
    }

    const content = `
      <style>
        .am-att-wrap { display:flex; flex-direction:column; gap:0.5rem; }
        .am-att-count { display:flex; align-items:baseline; gap:0.4rem; font-size:0.85rem; }
        .am-att-count b { font-size:1.1rem; font-variant-numeric:tabular-nums; }
        .am-att-count.am-over { color:#d05c5c; }
        .am-att-note { font-size:0.75rem; opacity:0.7; }
        .am-att-list { display:flex; flex-direction:column; gap:0.2rem; max-height:26rem; overflow-y:auto; }
        .am-att-row { display:flex; align-items:center; gap:0.5rem; width:100%; text-align:start;
          padding:0.3rem 0.45rem; border:1px solid rgba(255,255,255,0.08); border-radius:4px;
          background:rgba(255,255,255,0.02); cursor:pointer; font-size:0.85rem; }
        .am-att-row:hover { background:rgba(200,160,32,0.12); }
        .am-att-row img { border:none; border-radius:3px; flex:0 0 auto; }
        .am-att-name { flex:1; font-weight:600; }
        .am-att-rarity { font-size:0.72rem; opacity:0.55; white-space:nowrap; }
        .am-att-sun { width:1rem; text-align:center; opacity:0.35; }
        .am-att-on { border-color:rgba(200,160,32,0.55); background:rgba(200,160,32,0.1); }
        .am-att-on .am-att-sun { opacity:1; color:#c8a84a; }
      </style>
      <div class="am-att-wrap">
        <div class="am-att-count"><b class="am-att-n"></b><span>attuned</span></div>
        <p class="am-att-note">Every item on this character that can be attuned. Click one to attune or release it.</p>
        <div class="am-att-list">${items.map(drawRow).join('')}</div>
      </div>`;

    foundry.applications.api.DialogV2.wait({
      window: { title: game.i18n.localize('am.sheet.attunement') },
      content,
      position: { width: 460, height: 560 },
      rejectClose: false,
      buttons: [{ action: 'close', label: 'Close', default: true }],
      render: (_event, dialog) => {
        const root = dialog.element;

        /* The count is redrawn from the actor rather than counted in the
           window, so it agrees with the sheet even when something else
           changes an item while this is open. */
        const repaint = () => {
          const now = actor.items.contents.filter((i) => i.system?.attuned).length;
          const box = root.querySelector('.am-att-count');
          const n = root.querySelector('.am-att-n');
          if (n) n.textContent = `${now} / ${max}`;
          box?.classList.toggle('am-over', now > max);
          for (const row of root.querySelectorAll('.am-att-row')) {
            const on = !!actor.items.get(row.dataset.id)?.system?.attuned;
            row.classList.toggle('am-att-on', on);
            const sun = row.querySelector('.am-att-sun');
            if (sun) sun.className = `am-att-sun ${on ? 'fa-solid fa-sun' : 'fa-regular fa-sun'}`;
          }
        };
        repaint();

        for (const row of root.querySelectorAll('.am-att-row')) {
          row.addEventListener('click', async (e) => {
            e.preventDefault();
            const item = actor.items.get(row.dataset.id);
            if (!item) return;
            /* a5e's own, so its rules apply here as they do on its sheet. */
            if (typeof item.toggleAttunement === 'function') await item.toggleAttunement();
            else await item.update({ 'system.attuned': !(item.system?.attuned ?? false) });
            repaint();
          });
        }
      }
    });
  }

  /* Every spell that names no book of this actor's, filed at once.

     Where the actor came from a5e's compendium, a spell goes into the book
     that compendium's copy of the actor keeps it in — matched by name, since
     the ids of embedded items change on import, and only into a book this
     actor still has. Everything else goes into the book on screen. The
     question says how many go which way before anything is written. */
  async #sortUnbookedSpells() {
    const actor = this.actor;
    const ids = Object.keys(actor.system?.spellBooks ?? {});
    if (!ids.length) return;
    const loose = actor.items.filter((i) => i.type === 'spell' && !ids.includes(i.system?.spellBook));
    if (!loose.length) return;

    const fromPack = new Map();
    const origin = actor._stats?.compendiumSource ?? actor.flags?.core?.sourceId ?? null;
    if (origin) {
      try {
        const source = await fromUuid(origin);
        for (const it of source?.items ?? []) {
          if (it.type === 'spell' && ids.includes(it.system?.spellBook)) fromPack.set(it.name.toLowerCase(), it.system.spellBook);
        }
      } catch (err) {
        AM.log(2, `Could not read ${origin} to sort spells into books:`, err);
      }
    }

    const here = ids.includes(this._spellBook) ? this._spellBook : ids[0];
    const bookName = (id) => (actor.spellBooks?.get?.(id) ?? actor.system.spellBooks[id])?.name || 'Spell Book';
    const updates = loose.map((i) => ({ _id: i.id, 'system.spellBook': fromPack.get(i.name.toLowerCase()) ?? here }));
    const counts = new Map();
    for (const u of updates) counts.set(u['system.spellBook'], (counts.get(u['system.spellBook']) ?? 0) + 1);
    const matched = loose.filter((i) => fromPack.has(i.name.toLowerCase())).length;
    const esc = (s) => foundry.utils.escapeHTML(String(s ?? ''));

    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: 'Sort spells into books' },
      content: `<p>${loose.length} spell${loose.length === 1 ? '' : 's'} name${loose.length === 1 ? 's' : ''} no spell book.`
        + (matched ? ` ${matched} go${matched === 1 ? 'es' : ''} where a5e\u2019s compendium keeps ${matched === 1 ? 'it' : 'them'}.` : '')
        + `</p><ul>${[...counts].map(([id, n]) => `<li><strong>${esc(bookName(id))}</strong>: ${n}</li>`).join('')}</ul>`,
      rejectClose: false
    });
    if (!ok) return;
    await actor.updateEmbeddedDocuments('Item', updates);
  }

  /* a5e's SpellBookConfig: the book's name, the ability its spells cast with,
     which resources it shows, and whether its spells skip their consumers.
     Each field writes system.spellBooks.<id>.<field> the moment it changes,
     as a5e's does, so there is nothing to save. */
  #configureSpellBook(id) {
    const actor = this.actor;
    const book = actor.spellBooks?.get?.(id) ?? actor.system?.spellBooks?.[id];
    if (!book) return;
    const esc = (s) => foundry.utils.escapeHTML(String(s ?? ''));
    const ability = book.ability ?? 'default';
    const abilities = [['default', 'Sheet default'],
      ...ABILITIES.map((a) => [a.key, a.label])];
    const boxes = [
      ['showArtifactCharges', 'Show artifact charges', book.showArtifactCharges ?? false],
      ['showSpellInventions', 'Show spell inventions', book.showSpellInventions ?? false],
      ['showSpellPoints',     'Show spell points',     book.showSpellPoints ?? false],
      ['showSpellSlots',      'Show spell slots',      book.showSpellSlots ?? true],
      ['disableSpellConsumers', 'Disable spell consumers', book.disableSpellConsumers ?? false]
    ];
    const content = `
      <div class="am-book-config" style="display:flex;flex-direction:column;gap:0.6rem">
        <label style="display:flex;flex-direction:column;gap:0.2rem">
          <span>Spell book name</span>
          <input type="text" data-field="name" value="${esc(book.name)}" spellcheck="false" />
        </label>
        <label style="display:flex;flex-direction:column;gap:0.2rem">
          <span>Spellcasting ability</span>
          <select data-field="ability">${abilities.map(([k, l]) =>
            `<option value="${esc(k)}"${k === ability ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>
          <small style="opacity:0.7">Spells in this book use this ability for their attack rolls and save DCs in place of the sheet default.</small>
        </label>
        ${boxes.map(([k, l, on]) => `
          <label style="display:flex;align-items:center;gap:0.4rem">
            <input type="checkbox" data-field="${k}"${on ? ' checked' : ''} /> <span>${esc(l)}</span>
          </label>`).join('')}
        <small style="opacity:0.7">Disabling spell consumers ignores spell slot and spell point costs by default — for ritual books and the like.</small>
      </div>`;

    foundry.applications.api.DialogV2.wait({
      window: { title: 'Configure Spell Book' },
      content,
      position: { width: 420 },
      rejectClose: false,
      buttons: [{ action: 'close', label: 'Close', default: true }],
      render: (_event, dialog) => {
        for (const input of dialog.element.querySelectorAll('[data-field]')) {
          input.addEventListener('change', async () => {
            const field = input.dataset.field;
            const value = input.type === 'checkbox' ? input.checked : input.value;
            await actor.update({ [`system.spellBooks.${id}.${field}`]: value });
          });
        }
      }
    });
  }

  #openFeatPicker() {
    /* The level-up's feat picker in a window of its own - filters, orders,
       pages, the prerequisite on each card, right-click for the text. This was
       a plain dialog with a name search over a column of rows. See FeatDialog. */
    new FeatDialog(this.actor).render({ force: true });
  }

  #normTrad(raw) {
    /* The system's own label first. The keys are camelCase (adamantMountain) and
       the magic schools are transliterations (probiy, stykhia), so capitalising
       the key gave "AdamantMountain" and "Probiy" where the book says Adamant
       Mountain and Breach. registerMagicSchools puts the schools in the same
       table. */
    const label = CONFIG?.A5E?.maneuverTraditions?.[raw];
    if (label) return game.i18n.localize(label);
    return raw.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }

  /**
   * Fallback advantage/normal/disadvantage picker (v14 DialogV2), used only when
   * the system's own roll dialog throws. Resolves to a CONFIG.A5E.ROLL_MODE value,
   * or null if dismissed. DialogV2 button `icon` is a class string, not HTML.
   */
  static #rollModeDialog(title) {
    const RM = CONFIG.A5E.ROLL_MODE;
    return foundry.applications.api.DialogV2.wait({
      window: { title },
      content: '',
      rejectClose: false,
      buttons: [
        { action: 'dis',  label: 'Disadvantage', icon: 'fa-solid fa-angles-down', callback: () => RM.DISADVANTAGE },
        { action: 'norm', label: 'Normal',       icon: 'fa-solid fa-dice-d20', default: true, callback: () => RM.NORMAL },
        { action: 'adv',  label: 'Advantage',    icon: 'fa-solid fa-angles-up', callback: () => RM.ADVANTAGE },
      ],
    });
  }

  async #roll(formula, label) {
    const roll = new Roll(formula, this.actor.getRollData?.() ?? {});
    await roll.evaluate();
    roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor: this.actor }), flavor: label });
  }

  /**
   * Hit points by hand, for a system that has no applyDamage/applyHealing.
   * a5e has both, so this is a floor rather than a path anyone should take:
   * it knows only that temporary hit points go first and that nothing goes
   * below zero or above the maximum.
   */
  async #hpFallback(delta) {
    const hp    = this.actor.system?.attributes?.hp ?? {};
    const max   = Number(hp.max ?? hp.baseMax ?? 0) || 0;
    let   value = Number(hp.value ?? 0) || 0;
    let   temp  = Number(hp.temp ?? 0) || 0;

    if (delta >= 0) {
      value = max ? Math.min(max, value + delta) : value + delta;
    } else {
      const amount   = -delta;
      const fromTemp = Math.min(temp, amount);
      temp  -= fromTemp;
      value  = Math.max(0, value - (amount - fromTemp));
    }
    await this.actor.update({ 'system.attributes.hp.value': value,
                              'system.attributes.hp.temp':  temp });
  }

  #bindNumericInput(el, selector, pathFn) {
    const inp = el.querySelector(selector);
    if (!inp) return;
    inp.addEventListener('change', async (e) => {
      const val = parseInt(e.target.value);
      if (isNaN(val)) return;
      try {
        await this.actor.update(pathFn(val));
      } catch (err) {
        /* This used to be `.catch(() => {})`. A field the data model does
           not have makes it reject the whole update, and swallowing that
           left a control that looked fine and did nothing — which is how
           the exertion bug survived. Say so instead. */
        AM.log(1, `Could not update ${Object.keys(pathFn(val)).join(', ')}:`, err);
        ui.notifications.warn(err.message ?? 'The sheet could not save that value.');
        e.target.value = foundry.utils.getProperty(this.actor, Object.keys(pathFn(val))[0]) ?? '';
      }
    });
  }

  /**
   * Everything this sheet leaves outside its own element.
   *
   * There were two close() methods in this class, three thousand lines apart.
   * JavaScript does not complain about that — the later one simply replaces
   * the earlier — so the ResizeObserver the first one disconnected was never
   * disconnected at all. Every sheet opened and closed left one behind, still
   * firing its layout callback against an element no longer in the document.
   * It parses, it runs, and it shows up only as a session that gets slower the
   * longer it goes on. tools/checks/dupmembers.mjs looks for this now.
   */
  async close(options = {}) {
    this._abilityLayoutObserver?.disconnect();
    this._abilityLayoutObserver = null;
    this._condPanel?.remove();
    this._condPanel = null;
    if (this._condEscHandler) {
      window.removeEventListener('keydown', this._condEscHandler);
      this._condEscHandler = null;
    }
    if (this._condKeydownHandler) {
      window.removeEventListener('keydown', this._condKeydownHandler);
      this._condKeydownHandler = null;
    }
    return super.close(options);
  }
}

function sign(n) { return n >= 0 ? `+${n}` : `${n}`; }

/**
 * Read an item description regardless of which shape it is stored in.
 *
 * A5e declares `description` as a plain HTMLField, so `system.description` IS the
 * string — there is no `.value`. Reading only `.value` returned undefined for every
 * compendium item, which is why the origin panels showed empty cards. Older/imported
 * data and some 5e-derived items do use `{ value }`, so both are accepted.
 */
function descOf(sys) {
  const d = sys?.description;
  if (typeof d === 'string') return d;
  return d?.value ?? '';
}

/**
 * Resolve @UUID / @Embed links and inline rolls in a description. A5e origin text
 * embeds its trait and table entries this way; unenriched they render as empty
 * shells, which is what the "empty tables" in the overview were.
 */
async function enrichDesc(html, actor) {
  if (!html) return '';
  try {
    const TE = foundry.applications?.ux?.TextEditor?.implementation ?? TextEditor;
    return await TE.enrichHTML(html, { async: true, relativeTo: actor, rollData: actor?.getRollData?.() ?? {} });
  } catch {
    return html;
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   The NPC sheet lives here, beside the class it extends.

   It had a module of its own, which is the natural place for it and the wrong
   one. A class that extends one from another module is only safe while every
   file involved is the version that was built together; a browser holding one
   of them cached and the other fresh leaves the parent in the temporal dead
   zone, and the module dies at load before a single sheet is registered. That
   does not look like a bug in a sheet. It looks like a sheet that will not
   open at all.

   Fixing the import cycle removed the cause. Putting the two in one module
   removes the possibility: there is no order in which a module can be half of
   itself. A5eNPCSheet.js re-exports from here, so module.json and any stale
   manifest that still lists it keep working.
   ══════════════════════════════════════════════════════════════════════════ */
/**
 * The NPC sheet, in the same clothes as the character sheet.
 *
 * The old one was a statblock reader of its own: three hundred lines that
 * guessed at a5e's data paths with a chain of `??` fallbacks, most of which
 * a5e has never used. It read system.traits.dr, system.details.type,
 * system.attributes.legact — none of which exist. What it showed was whatever
 * the last fallback in each chain happened to return.
 *
 * This one does what a5e itself does. a5e has a single ActorSheet for both
 * kinds of actor and adapts it, and when the character sheet here was fed a
 * real monster out of a5e's pack — an Adult Red Dragon, 21 items — it built
 * its context and rendered without a single failure: six abilities, twenty-one
 * skills, fifteen features, six maneuvers, an inventory. There was never a
 * second sheet's worth of work here. So this is that sheet, subclassed, with
 * the parts a monster does not have replaced by the parts it does.
 *
 * What changes: the subtitle, which carries creature type, size, terrain and
 * challenge rating where a character carries classes and level; and the first
 * tab, which is the statblock — every action the monster has, grouped the way
 * the book groups them.
 */
export class A5eNPCSheet extends A5eCharacterSheet {

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      /* Same Tidy classes as the character sheet, with `npc` in place of
         `character`. Tidy scopes a handful of its own rules to
         :where(.quadrone.actor):where(.npc) — the vitals block chiefly — so the
         class earns its place rather than just naming the thing. */
      /* 'default': see the character sheet — Carolingian UI's button rule. */
      classes: ['tidy5e-sheet', 'application', 'sheet', 'default', 'actor', 'npc',
                'quadrone', 'themed', 'theme-dark',
                'a5e-mancer-sheet', 'a5e-mancer-npc-sheet'],
      template: `modules/${MODULE_ID}/templates/sheet/npc-sheet.hbs`,
      /* 760 was a guess that a monster needs less room than a character. It
         does not: the tab strip carries the same tabs less two, and at 760 it
         wrapped under the sidebar button. Same width as the character sheet,
         and a little shorter, since a monster has no tracker row. */
      width: 820,
      height: 780,
      /* Favorites, as the character sheet opens on — the strip is the same one
         now, and an `initial` naming a tab that no longer exists would leave
         the sheet opening on nothing. */
      tabs: [{ navSelector: '.actor-tabs', contentSelector: '.main-content',
               initial: 'favorites' }],
      dragDrop: [{ dragSelector: '.tidy-table-row-container[data-item-id]',
                   dropSelector: '.main-content' }]
    });
  }

  /* ── Context ──────────────────────────────────────── */

  async getData() {
    const data  = await super.getData();
    const actor = this.actor;
    const sys   = actor.system ?? {};

    data.npc       = this.#npcHeader(sys);
    /* The statblock tab is gone — the NPC strip is the character sheet’s now,
       and building a context nothing renders is work done on every redraw for
       nobody. #statblock stays: it groups a monster’s actions the way the book
       does, and bringing the tab back is one line here and one in the
       generator. */
    return data;
  }

  /**
   * What stands where a character's class and level stand.
   *
   * Every path here was read off a5e's own monster pack rather than guessed:
   * details.creatureTypes is an array, details.cr a number, traits.size a
   * lowercase key, and the languages a monster speaks live under
   * proficiencies.languages, not under traits.
   */
  #npcHeader(sys) {
    const det = sys.details ?? {};
    const cr  = Number(det.cr ?? 0);

    const types = (Array.isArray(det.creatureTypes) ? det.creatureTypes : [])
      .map(t => this.#label('creatureTypes', t));
    const terrain = (Array.isArray(det.terrain) ? det.terrain : [])
      .map(t => this.#label('terrainTypes', t));

    /* The tags a5e keeps as flags of their own rather than as a creature type. */
    const tags = [];
    if (det.elite)   tags.push(game.i18n.localize('am.npc.elite'));
    if (det.isSwarm) tags.push(game.i18n.localize('am.npc.swarm'));
    if (det.isSquad) tags.push(game.i18n.localize('am.npc.squad'));

    return {
      cr:       A5eNPCSheet.crLabel(cr),
      crRaw:    cr,
      xp:       det.xp?.value ?? det.xp ?? A5eNPCSheet.crToXP(cr),
      size:     this.#label('actorSizes', sys.traits?.size ?? ''),
      types,
      typeLine: types.join(', '),
      terrain,
      tags,
      /* One line under the name, the way the book prints it:
         "Huge dragon, elite · mountains". */
      subtitle: [
        [this.#label('actorSizes', sys.traits?.size ?? ''), types.join(' ')]
          .filter(Boolean).join(' '),
        tags.join(', ')
      ].filter(Boolean).join(', '),
      languages: (sys.proficiencies?.languages ?? [])
        .map(l => this.#label('languages', l)).join(', ')
    };
  }

  /**
   * The statblock: every action the monster can take, grouped as the book
   * groups them.
   *
   * The grouping key is the action's own activation type, which is where a5e
   * actually records it — measured across the monster pack, 8426 actions,
   * 504 bonus actions, 356 reactions, 455 legendary. The old sheet looked for
   * the word "legendary" in the item's NAME, which found the ones that say so
   * and missed the 455 that simply are.
   *
   * An item can hold several actions, and a monster's often does — a bite that
   * is an action and a recharge breath that is not. Each action is listed
   * under its own heading, under the item's name, so the sheet says what the
   * book says.
   */
  #statblock() {
    const GROUPS = [
      { key: 'action',          label: 'am.npc.actions',           icon: 'fa-hand-fist' },
      { key: 'bonusAction',     label: 'am.npc.bonus-actions',     icon: 'fa-bolt' },
      { key: 'reaction',        label: 'am.npc.reactions',         icon: 'fa-reply' },
      { key: 'legendaryAction', label: 'am.npc.legendary-actions', icon: 'fa-crown' },
      { key: 'special',         label: 'am.npc.special',           icon: 'fa-star' },
      { key: 'passive',         label: 'am.npc.traits',            icon: 'fa-scroll' }
    ];
    const bucket = new Map(GROUPS.map(g => [g.key, []]));

    for (const item of this.actor.items) {
      /* Maneuvers are not in the statblock. a5e's monsters carry a great many —
         5892 across its pack, against 6132 features — and folded in among the
         actions they bury the handful of things the creature actually does in a
         round. They keep their own tab, which is where a monster's maneuvers
         were always going to be looked for. */
      if (!['feature', 'object', 'spell'].includes(item.type)) continue;

      const actions = Object.entries(item.system?.actions ?? {});

      /* No action at all is a trait: the monster simply has it. 2353 of the
         items in a5e's pack are these, and the old sheet filed most of them
         under Actions. */
      if (!actions.length) {
        if (item.type === 'feature') bucket.get('passive').push(this.#entry(item));
        continue;
      }

      for (const [actionId, action] of actions) {
        const type = action?.activation?.type || '';
        /* 'minute', 'hour', 'none' and blank are not statblock headings. They
           are things the monster does outside a round, which the book prints
           among its traits. */
        const key = bucket.has(type) ? type
                  : (type === 'special' ? 'special' : 'passive');
        bucket.get(key).push(this.#entry(item, actionId, action));
      }
    }

    return GROUPS
      .map(g => ({ ...g, entries: bucket.get(g.key) }))
      .filter(g => g.entries.length);
  }

  /** One statblock line. Carries what the row template and the roll handlers need. */
  #entry(item, actionId = null, action = null) {
    const uses = action?.uses ?? item.system?.uses ?? null;
    const recharge = action?.uses?.recharge ?? item.system?.uses?.recharge ?? null;
    return {
      id:        item.id,
      uuid:      item.uuid,
      actionId,
      name:      action?.name || item.name,
      itemName:  item.name,
      /* Named separately only when the action is not simply the item. */
      subName:   action?.name && action.name !== item.name ? item.name : '',
      img:       item.img,
      type:      item.type,
      cost:      action?.activation?.cost ?? null,
      trigger:   action?.activation?.reactionTrigger ?? '',
      recharge:  recharge?.formula ? `${recharge.formula}` : '',
      uses:      (uses && (uses.max || uses.value)) ? uses : null,
      description: item.system?.description ?? ''
    };
  }

  /** A CONFIG.A5E label, falling back to the key itself made readable. */
  #label(group, key) {
    if (!key) return '';
    const raw = CONFIG.A5E?.[group]?.[key];
    if (raw) return game.i18n.localize(raw);
    return String(key).replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase());
  }

  /* ── Static helpers ───────────────────────────────── */

  /** "1/8", "1/4", "1/2" and otherwise the number, as the book prints it. */
  static crLabel(cr) {
    if (cr === 0.125) return '1/8';
    if (cr === 0.25)  return '1/4';
    if (cr === 0.5)   return '1/2';
    return String(cr ?? 0);
  }

  /** The standard XP-by-CR table, for monsters whose XP was never written down. */
  static crToXP(cr) {
    const TABLE = {
      0: 10, 0.125: 25, 0.25: 50, 0.5: 100,
      1: 200, 2: 450, 3: 700, 4: 1100, 5: 1800, 6: 2300, 7: 2900, 8: 3900,
      9: 5000, 10: 5900, 11: 7200, 12: 8400, 13: 10000, 14: 11500, 15: 13000,
      16: 15000, 17: 18000, 18: 20000, 19: 22000, 20: 25000, 21: 33000,
      22: 41000, 23: 50000, 24: 62000, 25: 75000, 26: 90000, 27: 105000,
      28: 120000, 29: 135000, 30: 155000
    };
    return TABLE[cr] ?? 0;
  }

  /* ── Listeners ────────────────────────────────────── */

  activateListeners(html) {
    super.activateListeners(html);

    /* Foundry's v1 ActorSheet hands this a jQuery object, and a jQuery object
       has no querySelectorAll. The character sheet converts on its first line;
       this override did not, and threw a TypeError on EVERY render of every
       NPC sheet — after super had bound its listeners, and before Foundry had
       finished rendering. Everything _render does after that point, the
       window's own size and position included, never happened. */
    /* Nothing of its own left to bind. The statblock tab's use button went
       when that tab was replaced by Favorites, and everything else this sheet
       does is the character sheet's, bound by the call above.

       The conversion stays, and so does the guard, because the next thing
       added here will need both — and the last one that forgot the first threw
       a TypeError on every render for as long as this class existed. */
    const el = html?.jquery ? html[0] : html;
    void el;
  }
}
