import { AM } from '../a5e-mancer.js';
import { LevelUpDialog } from './LevelUpDialog.js';
import { ManeuverDialog } from './ManeuverDialog.js';
import { SpellDialog } from './SpellDialog.js';
import { SpellService } from '../utils/spellService.js';
import { PackFilter } from '../utils/packFilter.js';
import { ManeuverService } from '../utils/maneuverService.js';
import { ConditionSource } from '../utils/conditionSource.js';

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
         still have somewhere to hang. See tidy/README.md. */
      classes: ['tidy5e-sheet', 'application', 'sheet', 'actor', 'character',
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

  /* ── Data ─────────────────────────────────────────── */
  async getData() {
    const actor  = this.actor;
    const sys    = actor.system;
    const items  = actor.items.contents;

    const profBonus = sys.attributes?.prof ?? sys.proficiencyBonus ?? this.#calcProf(actor);


    /* Abilities */
    const abilities = ABILITIES.map(({ key, label, abbr }) => {
      const d        = sys.abilities?.[key] ?? {};
      const value    = d.value ?? 10;
      const mod      = Math.floor((value - 10) / 2);
      const saveProf = !!(d.saveProficient ?? d.proficient);
      const saveMod  = saveProf ? mod + profBonus : mod;
      return { key, label, abbr, value, mod, modStr: sign(mod), saveMod, saveModStr: sign(saveMod), saveProf };
    });

    /* Saving throws (for right sidebar) */
    const savingThrows = abilities.map(a => ({
      key: a.key, abbr: a.abbr, label: a.label,
      mod: a.saveMod, modStr: a.saveModStr, proficient: a.saveProf
    }));

    /* Maneuver DC: 8 + prof + highest of STR/DEX mod */
    const strMod = abilities.find(a => a.key === 'str')?.mod ?? 0;
    const dexMod = abilities.find(a => a.key === 'dex')?.mod ?? 0;
    const maneuverDC = 8 + profBonus + Math.max(strMod, dexMod);

    /* Proficiencies — A5e stores these in various locations */
    const toArray = v => {
      if (!v) return [];
      if (v instanceof Set) return [...v];
      if (Array.isArray(v)) return v;
      if (typeof v === 'string') return v.split(',').map(s => s.trim()).filter(Boolean);
      if (typeof v === 'object') return Object.values(v).filter(Boolean);
      return [];
    };
    const proficiencies = {
      armor:     toArray(sys.proficiencies?.armor     ?? sys.traits?.armorProficiencies),
      weapons:   toArray(sys.proficiencies?.weapons   ?? sys.traits?.weaponProficiencies),
      tools:     toArray(sys.proficiencies?.tools     ?? sys.traits?.toolProficiencies),
      languages: toArray(sys.proficiencies?.languages ?? sys.traits?.languages ?? sys.languages),
      senses:    toArray(sys.senses ? Object.entries(sys.senses)
        .filter(([,v]) => v && v !== 0)
        .map(([k, v]) => `${k.charAt(0).toUpperCase() + k.slice(1)}: ${v} ft.`) : [])
    };

    /* Skills — use A5e's computed bonus where available */
    const abilMap = Object.fromEntries(abilities.map(a => [a.abbr, a.mod]));
    const skills = SKILLS.map(({ key, label, ability }) => {
      const d       = sys.skills?.[key] ?? {};
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
        bonusSign: bonus < 0 ? '-' : '+',
        bonusAbs: Math.abs(bonus),
        profLvl, profLabel,
        profIconClass: PROF_ICON_CLASSES[Math.min(profLvl, 2)] ?? PROF_ICON_CLASSES[0],
        expDie
      };
    });

    /* Resources */
    const hp  = sys.attributes?.hp ?? {};
    const ex  = sys.attributes?.exertion ?? {};
    const pct01 = (v, max) => Math.round(Math.min(Math.max(v / max, 0), 1) * 100);
    const hpPct = hp.max ? pct01(hp.value ?? 0, hp.max) : 0;
    const exPct = ex.max ? pct01(ex.current ?? 0, ex.max) : 0;
    const hpColor = hpPct < 25 ? '#e05040' : hpPct < 50 ? '#e09020' : '#4a9a4a';

    const resources = {
      hp: { value: hp.value ?? 0, max: hp.max ?? 0, temp: hp.temp ?? 0, pct: hpPct, color: hpColor },
      ac: sys.attributes?.ac?.value ?? sys.attributes?.ac ?? 10,
      initiative: sign(sys.attributes?.initiative?.value ?? sys.attributes?.initiative?.mod ?? 0),
      speed: sys.attributes?.movement?.walk?.distance ?? sys.attributes?.movement?.walk ?? sys.attributes?.speed?.value ?? 30,
      exertion: { current: ex.current ?? ex.value ?? 0, max: ex.max ?? 0, pct: exPct },
      fatigue: sys.attributes?.fatigue ?? 0,
      strife:  sys.attributes?.strife  ?? 0,
      profBonus: sign(profBonus),
      inspiration: !!(sys.attributes?.inspiration ?? sys.inspiration),
      deathSaves: sys.attributes?.death ?? null
    };

    /* Items categorised — A5e uses type='object' + system.objectType for all physical items */
    const weapons   = items.filter(i => i.type === 'object' && i.system?.objectType === 'weapon')
                            .map(i => this.#weapon(i));
    // Magic maneuvers are maneuver items as well, but they have their own
    // section further down; listing them here too would show each one twice.
    const maneuvers = items.filter(i => ManeuverService.isCombatManeuver(i)).map(i => this.#maneuver(i));
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

    // Custom counters — stored in actor flags
    const savedCounters = actor.getFlag(MODULE_ID, 'customCounters') ?? [{}, {}];
    const customCounters = [0, 1].map(i => {
      const s   = savedCounters[i] ?? {};
      const val = s.value ?? 0;
      const max = s.max   ?? 0;
      const pips = max > 0
        ? Array.from({ length: Math.min(max, 20) }, (_, j) => ({ i: j, on: j < val }))
        : [];
      return { name: s.name ?? '', value: val, max, pips };
    });
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

    /* Spells grouped by level */
    const spellGroups = {};
    for (const s of spells.sort((a, b) => a.level - b.level || a.name.localeCompare(b.name))) {
      const k = s.level === 0 ? 'Cantrips' : `Level ${s.level}`;
      if (!spellGroups[k]) spellGroups[k] = [];
      spellGroups[k].push(s);
    }

    /* Spell slots — A5e stores at system.spellResources.slots keyed by level string, uses 'current' */
    const rawSlots = sys.spellResources?.slots ?? sys.spellcasting?.slots ?? sys.spells ?? {};
    const slotRows = [1,2,3,4,5,6,7,8,9].map(l => {
      const d = rawSlots[String(l)] ?? rawSlots[`spell${l}`] ?? rawSlots[l] ?? {};
      const max   = d.max     ?? 0;
      const value = d.current ?? d.value ?? 0;
      if (!max) return null;
      const pips = Array.from({ length: max }, (_, i) => ({ index: i, used: i >= value, level: l }));
      return { level: l, value, max, pips };
    }).filter(Boolean);

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

    /* Passive perception */
    const percSkill = skills.find(s => s.key === 'perception');
    const passivePerception = 10 + (percSkill?.bonus ?? 0);

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
    bio.hasDestiny = !!(bio.motivation || bio.goals || bio.connection
                        || bio.fulfillment || bio.inspiration || bio.lore.length);

    const tidy = this.#tidyContext({ sys, abilities, classes, resources, profBonus, currency });
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
      inventory.groups.flatMap(g => g.items),
      inventory.groups.flatMap(g => g.items.flatMap(i => i.contents ?? []))
    );

    return {
      actor, system: sys, isOwner: actor.isOwner, isGM: game.user.isGM,
      tidy,
      inventory,
      sidebarTab,
      sidebarOnSkills: sidebarTab === 'skills',
      sidebarOnTraits: sidebarTab === 'traits',
      abilities, skills, resources, classes,
      savingThrows, maneuverDC, proficiencies,
      weapons, maneuvers, maneuverGroups, spells, spellGroups, slotRows,
      features, feats, allFeatures, featuresBySource, customCounters, equipment, currency,
      fatiguePips, strifePips, exertionPips,
      fatigueDesc, strifeDesc, statusConditions,
      attunementItems, attuneCount, passivePerception, charInfo, bio,
      hasWeapons:          weapons.length        > 0,
      hasManeuvers:        maneuvers.length      > 0,
      hasSpells:           spells.length         > 0,
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
  #tidyContext({ sys, abilities, classes, resources, profBonus, currency }) {
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

    const DENOMINATIONS = [
      { key: 'pp', label: 'Platinum' }, { key: 'gp', label: 'Gold' },
      { key: 'ep', label: 'Electrum' }, { key: 'sp', label: 'Silver' },
      { key: 'cp', label: 'Copper' }
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
      speeds,
      senses,
      classLine: classes.map((c) => ({ name: c.name, levels: c.level })),
      currencies: DENOMINATIONS.map((d) => ({ ...d, value: currency?.[d.key] ?? 0 })),
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

    const weightFlag = Number(actor.getFlag('a5e', 'showWeightColumn') ?? 0);
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

    return {
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
  #summary(...parts) { return parts.filter(Boolean).join(' · '); }

  #actLabel(activation) {
    return { action: 'Action', bonus: 'Bonus Action', reaction: 'Reaction' }[activation] ?? 'Action';
  }

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

  #spell(item) {
    const sys = item.system;
    const { activation, dmgFull, saveDC } = this.#parseActions(item);
    const level    = sys.level ?? sys.spellLevel ?? 0;
    const conc     = sys.concentration ?? false;
    const labels   = this.#actionLabels(item, this.#primaryAction(item));
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
      level,
      levelLabel: level === 0 ? 'Cantrip' : `Level ${level}`,
      school: schoolKey,
      summaryTags: [
        labels.reactionTrigger ? `Trigger: ${labels.reactionTrigger}` : null,
        level === 0 ? 'Cantrip' : `Level ${level}`,
        schoolLabel || null,
        conc ? 'Concentration' : null,
        sys.ritual ? 'Ritual' : null
      ].filter(Boolean),
      schoolLabel,
      ritual: sys.ritual ?? false,
      concentration: conc,
      prepared: sys.prepared !== false,
      activation,
      range, duration, dmgFull,
      /* The saving throw comes from the action's prompts. saveDC, read off
         the rolls beside the damage, is only ever set for the few actions
         that carry one there, so it is the fallback rather than the source. */
      saveDC: labels.saveLabel ?? saveDC,
      castTime: labels.activationLabel,
      desc: this.#itemDesc(item),
      actions: this.#allActionsForItem(item),
    };
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
      // A5e stores these as system.classLevels and system.hp.hitDiceSize — the
      // 5e-style paths below are fallbacks for imported data. Reading only those
      // meant every class showed as level 1, which also made the header's total
      // level and anything derived from it wrong.
      level:  item.system?.classLevels ?? item.system?.levels ?? item.system?.level ?? 1,
      hitDie: item.system?.hp?.hitDiceSize
              ?? item.system?.hitDice?.denomination
              ?? item.system?.hitDie
              ?? 8
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

    return super._onDropItem(event, data);
  }

  /* ── Listeners ────────────────────────────────────── */
  activateListeners(html) {
    super.activateListeners(html);
    const el = html?.jquery ? html[0] : html;

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

    /* Saving throw left-click → A5e roll dialog; right-click → instant roll */
    el.querySelectorAll('[data-action="saving-throw"]').forEach(b => {
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

    /* Item attunement toggle — system method, like the original sheet */
    el.querySelectorAll('[data-action="item-attune"]').forEach(b =>
      b.addEventListener('click', async () => {
        const item = this.actor.items.get(b.dataset.id);
        if (!item) return;
        if (typeof item.toggleAttunement === 'function') await item.toggleAttunement();
        else await item.update({ 'system.attuned': !(item.system?.attuned ?? false) });
      })
    );

    /* Damaged-state cycle (intact → damaged → broken), as on the original sheet */
    el.querySelectorAll('[data-action="item-damage"]').forEach(b =>
      b.addEventListener('click', async () => {
        const item = this.actor.items.get(b.dataset.id);
        if (!item) return;
        if (typeof item.toggleDamagedState === 'function') await item.toggleDamagedState();
        else await item.update({ 'system.damagedState': ((item.system?.damagedState ?? 0) + 1) % 3 });
      })
    );

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
    el.querySelectorAll('[data-action="item-star"]').forEach(b =>
      b.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id  = b.dataset.id;
        const cur = new Set(this.actor.getFlag(MODULE_ID, 'favorites') ?? []);
        if (cur.has(id)) cur.delete(id); else cur.add(id);
        await this.actor.setFlag(MODULE_ID, 'favorites', [...cur]);
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

    /* Right-click any item row → A5e activation dialog (with adv/disadv modifiers) */
    el.querySelectorAll('.tidy-table-row-container[data-item-id]').forEach(row =>
      row.addEventListener('contextmenu', async (e) => {
        e.preventDefault();
        const item = this.actor.items.get(row.dataset.itemId);
        if (!item) return;
        try {
          if (typeof item.activate === 'function') { await item.activate(); return; }
          if (typeof item.use      === 'function') { await item.use();      return; }
          item.sheet.render(true);
        } catch(err) {
          AM.log(2, 'contextmenu activate error:', err);
          item.sheet.render(true);
        }
      })
    );

    /* Item chat */
    el.querySelectorAll('[data-action="item-chat"]').forEach(b =>
      b.addEventListener('click', () => {
        const item = this.actor.items.get(b.dataset.id);
        if (!item) return;
        if (typeof item.toChat   === 'function') { item.toChat();   return; }
        if (typeof item.toMessage=== 'function') { item.toMessage();return; }
        if (typeof item.roll     === 'function') { item.roll();     return; }
        item.sheet.render(true);
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
          content: `<p>Delete <b>${item.name}</b>?</p>`,
        })) await item.delete();
      })
    );

    /* HP inputs */
    this.#bindNumericInput(el, '#am-hp-current', v => ({ 'system.attributes.hp.value': v }));
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
    this.#bindNumericInput(el, '#am-exertion-current',
      v => ({ 'system.attributes.exertion.current': v }));

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
    for (const [action, sign] of [['heal-hp', 1], ['damage-hp', -1]]) {
      el.querySelector(`[data-action="${action}"]`)?.addEventListener('click', async () => {
        const amount = await A5eCharacterSheet.#askAmount(
          game.i18n.localize(sign > 0 ? 'am.sheet.heal-title' : 'am.sheet.damage-title'));
        if (!amount) return;

        const hp = this.actor.system?.attributes?.hp ?? {};
        const max = Number(hp.max ?? 0);
        let value = Number(hp.value ?? 0);
        let temp  = Number(hp.temp ?? 0);

        if (sign > 0) {
          value = Math.min(max || value + amount, value + amount);
        } else {
          const fromTemp = Math.min(temp, amount);
          temp  -= fromTemp;
          value  = Math.max(0, value - (amount - fromTemp));
        }
        await this.actor.update({
          'system.attributes.hp.value': value,
          'system.attributes.hp.temp':  temp
        });
      });
    }

    el.querySelector('[data-action="toggle-inspiration"]')?.addEventListener('click', async () => {
      const cur  = this.actor.system.attributes?.inspiration ?? this.actor.system.inspiration;
      const path = this.actor.system.attributes?.inspiration !== undefined
        ? 'system.attributes.inspiration' : 'system.inspiration';
      await this.actor.update({ [path]: !cur });
    });

    /* Fatigue / Strife pips */
    el.querySelectorAll('[data-action="condition-pip"]').forEach(pip =>
      pip.addEventListener('click', async () => {
        const type    = pip.dataset.type;
        const idx     = parseInt(pip.dataset.index);
        const current = parseInt(pip.dataset.current);
        const newVal  = idx + 1 === current ? idx : idx + 1;
        await this.actor.update({ [`system.attributes.${type}`]: newVal });
      })
    );

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

    /* Spell slot pips */
    el.querySelectorAll('[data-action="slot-pip"]').forEach(pip =>
      pip.addEventListener('click', async () => {
        const lvl  = parseInt(pip.dataset.level);
        const idx  = parseInt(pip.dataset.index);
        const cur  = parseInt(pip.dataset.current);
        const next = idx === cur - 1 ? idx : idx + 1;
        await this.actor.update({ [`system.spellResources.slots.${lvl}.current`]: next })
          .catch(() => this.actor.update({ [`system.spellcasting.slots.spell${lvl}.value`]: next }));
      })
    );

    /* Item quantity */
    el.querySelectorAll('[data-action="item-qty"]').forEach(inp =>
      inp.addEventListener('change', async (e) => {
        const item = this.actor.items.get(inp.dataset.id);
        if (item) await item.update({ 'system.quantity': parseInt(e.target.value) || 1 });
      })
    );

    /* Exertion tab input */
    el.querySelector('[data-action="exertion-tab-input"]')?.addEventListener('change', async (e) => {
      const val = parseInt(e.target.value);
      if (!isNaN(val)) {
        // Sync resource bar input too
        const barInput = el.querySelector('#am-exertion-current');
        if (barInput) barInput.value = val;
        await this.actor.update({ 'system.attributes.exertion.current': val })
          .catch(() => this.actor.update({ 'system.attributes.exertion.value': val }));
      }
    });

    /* Exertion pip clicks */
    el.querySelectorAll('[data-action="exertion-pip"]').forEach(pip =>
      pip.addEventListener('click', async () => {
        const idx = parseInt(pip.dataset.index);
        const cur = parseInt(pip.dataset.current);
        const next = idx + 1 === cur ? idx : idx + 1;
        const barInput = el.querySelector('#am-exertion-current');
        if (barInput) barInput.value = next;
        const tabInput = el.querySelector('[data-action="exertion-tab-input"]');
        if (tabInput) tabInput.value = next;
        await this.actor.update({ 'system.attributes.exertion.current': next })
          .catch(() => this.actor.update({ 'system.attributes.exertion.value': next }));
      })
    );

    /* Feat picker */
    el.querySelector('[data-action="open-feat-picker"]')?.addEventListener('click', () => {
      this.#openFeatPicker();
    });

    /* Feat search filter */
    const featSearch = el.querySelector('#am-feat-search');
    if (featSearch) {
      featSearch.addEventListener('input', (e) => {
        const q = e.target.value.toLowerCase();
        el.querySelectorAll('.am-feat-item').forEach(item => {
          const name = item.querySelector('.item-name')?.textContent?.toLowerCase() ?? '';
          item.style.display = name.includes(q) ? '' : 'none';
        });
      });
    }

    /* Feat source filter buttons */
    el.querySelectorAll('.am-feat-filter').forEach(btn => {
      btn.addEventListener('click', () => {
        el.querySelectorAll('.am-feat-filter').forEach(b => b.classList.remove('am-feat-filter-active'));
        btn.classList.add('am-feat-filter-active');
        const filter = btn.dataset.filter;
        el.querySelectorAll('.am-feat-item').forEach(item => {
          item.style.display = filter === 'all' || item.dataset.featSource === filter ? '' : 'none';
        });
      });
    });

    /* Feat collapse toggle */
    el.querySelectorAll('.am-feat-toggle').forEach(btn =>
      btn.addEventListener('click', () => {
        const body = btn.closest('.am-feat-item')?.querySelector('.am-feat-body');
        if (body) body.classList.toggle('am-hidden');
        btn.textContent = body?.classList.contains('am-hidden') ? '▸' : '▾';
      })
    );

    /* Custom counters */
    const saveCounter = async (index) => {
      const counters = this.actor.getFlag(MODULE_ID, 'customCounters') ?? [{}, {}];
      const name  = el.querySelector(`[data-action="counter-name"][data-index="${index}"]`)?.value ?? '';
      const value = parseInt(el.querySelector(`[data-action="counter-val"][data-index="${index}"]`)?.value) || 0;
      const max   = parseInt(el.querySelector(`[data-action="counter-max"][data-index="${index}"]`)?.value) || 0;
      counters[index] = { name, value, max };
      await this.actor.setFlag(MODULE_ID, 'customCounters', counters);
    };

    el.querySelectorAll('[data-action="counter-name"]').forEach(inp =>
      inp.addEventListener('change', () => saveCounter(parseInt(inp.dataset.index)))
    );
    el.querySelectorAll('[data-action="counter-val"]').forEach(inp =>
      inp.addEventListener('change', async () => {
        const idx = parseInt(inp.dataset.index);
        await saveCounter(idx);
        this.render(false);
      })
    );
    el.querySelectorAll('[data-action="counter-max"]').forEach(inp =>
      inp.addEventListener('change', async () => {
        const idx = parseInt(inp.dataset.index);
        await saveCounter(idx);
        this.render(false);
      })
    );
    el.querySelectorAll('[data-action="counter-inc"]').forEach(btn =>
      btn.addEventListener('click', async () => {
        const idx  = parseInt(btn.dataset.index);
        const inp  = el.querySelector(`[data-action="counter-val"][data-index="${idx}"]`);
        const maxEl = el.querySelector(`[data-action="counter-max"][data-index="${idx}"]`);
        const max  = parseInt(maxEl?.value) || Infinity;
        const cur  = parseInt(inp?.value) || 0;
        if (inp && cur < max) { inp.value = cur + 1; await saveCounter(idx); this.render(false); }
      })
    );
    el.querySelectorAll('[data-action="counter-dec"]').forEach(btn =>
      btn.addEventListener('click', async () => {
        const idx = parseInt(btn.dataset.index);
        const inp = el.querySelector(`[data-action="counter-val"][data-index="${idx}"]`);
        const cur = parseInt(inp?.value) || 0;
        if (inp && cur > 0) { inp.value = cur - 1; await saveCounter(idx); this.render(false); }
      })
    );
    el.querySelectorAll('[data-action="counter-pip"]').forEach(pip =>
      pip.addEventListener('click', async () => {
        const ctr = parseInt(pip.dataset.counter);
        const i   = parseInt(pip.dataset.i);
        const valInp = el.querySelector(`[data-action="counter-val"][data-index="${ctr}"]`);
        const cur = parseInt(valInp?.value) || 0;
        const next = i + 1 === cur ? i : i + 1;
        if (valInp) { valInp.value = next; await saveCounter(ctr); this.render(false); }
      })
    );

    /* Feature/feat search */
    el.querySelector('#am-feature-search')?.addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase();
      el.querySelectorAll('.am-feat-item').forEach(item => {
        const name = item.querySelector('.item-name')?.textContent?.toLowerCase() ?? '';
        item.style.display = name.includes(q) ? '' : 'none';
      });
    });

    /* Feature/feat type filter */
    el.querySelectorAll('.am-feat-filter').forEach(btn => {
      btn.addEventListener('click', () => {
        el.querySelectorAll('.am-feat-filter').forEach(b => b.classList.remove('am-feat-filter-active'));
        btn.classList.add('am-feat-filter-active');
        const filter = btn.dataset.filter;
        el.querySelectorAll('.am-feat-item').forEach(item => {
          item.style.display = filter === 'all' || item.dataset.itemType === filter ? '' : 'none';
        });
      });
    });

    /* Feature collapse */
    el.querySelectorAll('.am-feat-toggle').forEach(btn =>
      btn.addEventListener('click', () => {
        const body = btn.closest('.am-feat-item')?.querySelector('.am-feat-body');
        if (body) body.classList.toggle('am-hidden');
        btn.textContent = body?.classList.contains('am-hidden') ? '▸' : '▾';
      })
    );

    /* Currency */
    el.querySelectorAll('[data-action="currency-edit"]').forEach(inp =>
      inp.addEventListener('change', async (e) => {
        const key = inp.dataset.currency;
        const val = parseInt(e.target.value) || 0;
        await this.actor.update({ [`system.currency.${key}`]: val })
          .catch(() => this.actor.update({ [`system.wealth.${key}`]: val }));
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
      new ManeuverDialog(this.actor).render(true)
    );

    /* Manage spells. Spell level cap follows the caster's class level; a5e has no
       bundled spells-known-per-level table, so the count itself stays free-form. */
    el.querySelector('[data-action="manage-spells"]')?.addEventListener('click', () => {
      const casterClass = this.actor.items.find(i =>
        i.type === 'class' && SpellService.isSpellcaster(i.name)
      );
      const casterLevel = casterClass
        ? (casterClass.system?.classLevels ?? casterClass.system?.levels ?? casterClass.system?.level ?? 1)
        : (this.actor.items.filter(i => i.type === 'class')
             .reduce((n, i) => n + (i.system?.classLevels ?? i.system?.levels ?? i.system?.level ?? 1), 0) || 1);
      new SpellDialog(this.actor, {
        manage:           true,
        className:        casterClass?.name ?? '',
        cantripsToChoose: -1,
        spellsToChoose:   -1,
        maxSpellLevel:    Math.max(1, Math.min(9, Math.ceil(casterLevel / 2)))
      }).render(true);
    });

    /* Feature collapse */
    el.querySelectorAll('.am-feature-toggle').forEach(btn =>
      btn.addEventListener('click', () => {
        const body = btn.closest('.am-feature-item')?.querySelector('.am-feature-body');
        if (body) body.classList.toggle('am-hidden');
        btn.textContent = body?.classList.contains('am-hidden') ? '▸' : '▾';
      })
    );

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

    /* ══ Inventory utility bar ═════════════════════════════════════════
       Search, filters, sort and add — a5e's UtilityBar, rebuilt against our
       markup. Filters live in a5e's own flag so the two sheets agree. */

    const invSearch = el.querySelector('[data-action="inv-search"]');
    if (invSearch) {
      /* Re-render on a pause rather than per keystroke: each render rebuilds
         every row, and doing that on every letter makes typing stutter. */
      let timer = null;
      invSearch.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          this._invSearch = invSearch.value;
          this.render(false);
        }, 250);
      });
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
        if (show) hpEdit.querySelector('input')?.focus();
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

    /* Collapsing an item table. Tidy toggles .expanded on the wrapper and on
       the chevron; the height animation is entirely CSS, so setting the two
       classes is the whole job. */
    el.querySelectorAll('.tidy-table-header-row.toggleable').forEach(header => {
      header.addEventListener('click', (e) => {
        if (e.target.closest('button, a, input')) return;
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

    /* Spell slots. Tidy spends and restores with a pair of hexagon buttons
       rather than with pips; a5e keeps the count at .current. */
    const stepSlot = (delta) => async (e) => {
      e.preventDefault();
      const level = e.currentTarget.dataset.level;
      const slots = this.actor.system?.spellResources?.slots?.[level];
      if (!slots) return;
      const max = Number(slots.max ?? 0) || 0;
      const now = Number(slots.current ?? 0) || 0;
      const next = Math.min(Math.max(now + delta, 0), max);
      if (next === now) return;
      await this.actor.update({ [`system.spellResources.slots.${level}.current`]: next });
    };
    el.querySelectorAll('[data-action="slot-dec"]').forEach(b =>
      b.addEventListener('click', stepSlot(-1)));
    el.querySelectorAll('[data-action="slot-inc"]').forEach(b =>
      b.addEventListener('click', stepSlot(1)));

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

  async #openFeatPicker() {
    // Build a searchable dialog from compendium feats
    const packs  = PackFilter.itemPacks();
    const feats  = [];

    for (const pack of packs) {
      try {
        const index = await pack.getIndex({ fields: ['name', 'type', 'img', 'system'] });
        for (const e of index) {
          if (e.type !== 'feat') continue;
          feats.push({
            uuid: `Compendium.${pack.collection}.${e._id}`,
            name: e.name,
            img:  e.img,
            pack: pack.metadata.label,
            prereq: e.system?.prerequisites?.value ?? e.system?.prerequisite ?? ''
          });
        }
      } catch {}
    }

    if (!feats.length) {
      ui.notifications.warn('No feat compendiums found. Make sure your a5e compendiums are enabled.');
      return;
    }

    feats.sort((a, b) => a.name.localeCompare(b.name));

    // Build dialog HTML
    const rows = feats.map(f => `
      <div class="am-feat-picker-row" data-uuid="${f.uuid}">
        <img src="${f.img}" width="24" height="24" style="border:none;border-radius:3px;float:none;margin:0" />
        <span class="am-fp-name">${f.name}</span>
        ${f.prereq ? `<span class="am-fp-req" title="Prerequisite">${f.prereq}</span>` : ''}
        <span class="am-fp-pack">${f.pack}</span>
        <button type="button" class="am-fp-add-btn" data-uuid="${f.uuid}">Add</button>
      </div>
    `).join('');

    const content = `
      <style>
        .am-feat-picker-wrap { display:flex; flex-direction:column; gap:0.4rem; }
        .am-fp-search { width:100%; padding:0.3rem 0.5rem; font-size:0.9rem; border:1px solid #ccc; border-radius:3px; }
        .am-feat-picker-list { max-height:360px; overflow-y:auto; display:flex; flex-direction:column; gap:0.15rem; }
        .am-feat-picker-row { display:flex; align-items:center; gap:0.4rem; padding:0.2rem 0.3rem; border-radius:3px; border:1px solid #eee; font-size:0.84rem; }
        .am-feat-picker-row:hover { background:rgba(200,160,32,0.07); }
        .am-fp-name { flex:1; font-weight:bold; }
        .am-fp-req { font-size:0.72rem; opacity:0.6; }
        .am-fp-pack { font-size:0.7rem; opacity:0.45; margin-inline-start:auto; white-space:nowrap; }
        .am-fp-add-btn { font-size:0.72rem; padding:0.1rem 0.5rem; border:1px solid #c8a020; border-radius:2px; background:rgba(200,160,32,0.12); cursor:pointer; color:#5a3a00; white-space:nowrap; }
        .am-fp-add-btn:hover { background:rgba(200,160,32,0.3); }
        .am-fp-add-btn.am-added { background:#2a7a2a; border-color:#2a7a2a; color:white; pointer-events:none; }
      </style>
      <div class="am-feat-picker-wrap">
        <input type="text" class="am-fp-search" placeholder="Search feats…" />
        <div class="am-feat-picker-list">${rows}</div>
      </div>
    `;

    const actor = this.actor;
    foundry.applications.api.DialogV2.wait({
      window: { title: 'Add Feat' },
      content,
      position: { width: 480, height: 540 },
      rejectClose: false,
      buttons: [{ action: 'close', label: 'Close', default: true }],
      // v14 DialogV2: render(event, dialog); dialog.element is the root HTMLElement.
      render: (_event, dialog) => {
        const root = dialog.element;

        const search = root.querySelector('.am-fp-search');
        search?.addEventListener('input', () => {
          const q = search.value.toLowerCase();
          root.querySelectorAll('.am-feat-picker-row').forEach(row => {
            const name = row.querySelector('.am-fp-name')?.textContent.toLowerCase() ?? '';
            row.style.display = name.includes(q) ? '' : 'none';
          });
        });

        root.querySelectorAll('.am-fp-add-btn').forEach(btn => {
          btn.addEventListener('click', async () => {
            try {
              const item = await fromUuid(btn.dataset.uuid);
              if (item) {
                await Item.create(item.toObject(), { parent: actor });
                btn.textContent = '✓ Added';
                btn.classList.add('am-added');
              }
            } catch (err) {
              ui.notifications.error('Could not add feat: ' + err.message);
            }
          });
        });
      },
    });
  }

  #normTrad(raw) {
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
   * Ask for a positive whole number. Used by the Heal and Damage buttons, which
   * need one value and nothing else.
   */
  static async #askAmount(title) {
    try {
      const html = `<input type="number" name="amount" min="1" step="1" autofocus
                      style="width:100%" placeholder="0">`;
      const result = await foundry.applications.api.DialogV2.prompt({
        window: { title },
        content: html,
        ok: { label: game.i18n.localize('am.sheet.apply'),
              callback: (_e, btn) => btn.form.elements.amount.value }
      });
      const n = Math.floor(Number(result));
      return Number.isFinite(n) && n > 0 ? n : 0;
    } catch {
      return 0;                       // dismissed
    }
  }

  async close(options = {}) {
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
