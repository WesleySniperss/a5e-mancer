import { AM } from '../a5e-mancer.js';
import { LevelUpDialog } from './LevelUpDialog.js';
import { ManeuverDialog } from './ManeuverDialog.js';
import { SpellDialog } from './SpellDialog.js';

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

const PROF_ICONS = ['○', '◑', '●', '◉'];

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
      classes: ['a5e-mancer-sheet', 'sheet', 'actor'],
      template: `modules/${MODULE_ID}/templates/sheet/character-sheet.hbs`,
      width: 960,
      height: 740,
      resizable: true,
      tabs: [{ navSelector: '.am-cs-tabs', contentSelector: '.am-cs-tabcontent', initial: 'favorites' }],
      dragDrop: [{ dragSelector: '.am-item-row', dropSelector: '.am-cs-tabcontent' }]
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
      const mult    = [0, 0.5, 1, 2][Math.min(profLvl, 3)] ?? 0;
      // Prefer A5e's derived total; fall back to manual computation
      const bonus   = d.total ?? d.value ?? (abilMod + Math.floor(profBonus * mult));
      const expDie  = d.expertiseDice > 0 ? `+d${4 + (d.expertiseDice - 1) * 2}` : '';
      const profIcon = PROF_ICONS[Math.min(profLvl, 3)];
      return { key, label, ability, bonus, bonusStr: sign(bonus), profLvl, profIcon, expDie };
    });

    /* Resources */
    const hp  = sys.attributes?.hp ?? {};
    const ex  = sys.attributes?.exertion ?? {};
    const hpPct = hp.max ? Math.round(Math.clamped((hp.value ?? 0) / hp.max, 0, 1) * 100) : 0;
    const exPct = ex.max ? Math.round(Math.clamped((ex.current ?? 0) / ex.max, 0, 1) * 100) : 0;
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
    const maneuvers = items.filter(i => i.type === 'maneuver').map(i => this.#maneuver(i));
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
      heritageDesc:   _hItem?.system?.description?.value   ?? '',
      cultureDesc:    _cItem?.system?.description?.value   ?? '',
      backgroundDesc: _bgItem?.system?.description?.value  ?? '',
      destinyDesc:    _dItem?.system?.description?.value   ?? '',
    };

    return {
      actor, system: sys, isOwner: actor.isOwner, isGM: game.user.isGM,
      abilities, skills, resources, classes,
      savingThrows, maneuverDC, proficiencies,
      weapons, maneuvers, maneuverGroups, spells, spellGroups, slotRows,
      features, feats, allFeatures, featuresBySource, customCounters, equipment, currency,
      fatiguePips, strifePips, exertionPips,
      fatigueDesc, strifeDesc, statusConditions,
      attunementItems, attuneCount, passivePerception, charInfo,
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

      // Actions tab — grouped by item (parent + child actions) + favorites
      ...(() => {
        const favoriteIds = new Set([
          ...(actor.getFlag(MODULE_ID, 'favorites') ?? []),
          ...items.filter(i => i.system?.favorite).map(i => i.id),
        ]);
        const actionItems = items.filter(i => {
          if (i.type === 'object' && i.system?.objectType === 'weapon') return true;
          if (i.type === 'maneuver') return true;
          if (i.type === 'feature') {
            const a = i.system?.actions ?? {};
            const len = a instanceof Map ? a.size
              : (a.contents?.length ?? Object.keys(a).length);
            return len > 0;
          }
          return false;
        });
        const actionGroups = actionItems.map(i => this.#buildActionGroup(i, favoriteIds));
        return {
          actionGroups,
          favorites: actionGroups.filter(g => g.starred),
          hasActions: actionGroups.length > 0,
        };
      })(),

      // Spell level order for template iteration (Handlebars can't do computed keys)
      spellLevelOrder: ['Level 1','Level 2','Level 3','Level 4','Level 5',
                        'Level 6','Level 7','Level 8','Level 9']
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
      id: item.id, name: item.name, img: item.img,
      atkBonus: atkBonusFmt,      // null → tag hidden; signed string → tag shown
      atkBonusCell: atkBonusFmt ?? '—',  // for inventory table column
      dmg: dmg ?? '—', dmgFull,
      range, saveDC,
      equippedState,
      equipped:   equippedState === 2,
      carried:    equippedState === 1,
      notCarried: equippedState === 0,
      attuned, needsAttune,
      attuneProblem: needsAttune && !attuned,
      activation,
      desc: sys.description?.value ?? '',
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
      id: item.id, name: item.name, img: item.img,
      tradition: tradition || 'Other',
      degree, exertion, activation,
      range, dmgFull, saveDC,
      desc: sys.description?.value ?? '',
    };
  }

  #spell(item) {
    const sys = item.system;
    const { activation, dmgFull, saveDC } = this.#parseActions(item);
    const level    = sys.level ?? sys.spellLevel ?? 0;
    const range    = sys.range?.value ? `${sys.range.value} ${sys.range.units ?? ''}`.trim() : null;
    const conc     = sys.concentration ?? false;

    // Duration: e.g. "1 minute", "1 hour", "instantaneous"
    const dur = sys.duration ?? {};
    const duration = dur.value
      ? `${dur.value} ${dur.units ?? ''}`.trim()
      : (dur.units && dur.units !== 'instantaneous' && dur.units !== 'special' ? dur.units : null);

    // School key may be in sys.schools.primary (A5e) or sys.school (legacy)
    const schoolKey   = sys.schools?.primary ?? sys.school ?? '';
    const schoolI18n  = CONFIG?.A5E?.spellSchools?.primary?.[schoolKey];
    const schoolLabel = schoolI18n
      ? game.i18n.localize(schoolI18n)
      : (schoolKey ? schoolKey.charAt(0).toUpperCase() + schoolKey.slice(1) : '');

    return {
      id: item.id, name: item.name, img: item.img,
      level,
      levelLabel: level === 0 ? 'Cantrip' : `Level ${level}`,
      school: schoolKey,
      schoolLabel,
      ritual: sys.ritual ?? false,
      concentration: conc,
      prepared: sys.prepared !== false,
      activation,
      range, duration, dmgFull, saveDC,
      desc: sys.description?.value ?? '',
    };
  }

  #feature(item) {
    const sys = item.system ?? {};
    const { actionList, hasActions, activation, atkBonus, dmgFull, saveDC } = this.#parseActions(item);
    const rangeVal = sys.range?.value;
    const range    = rangeVal ? `${rangeVal} ${sys.range?.units ?? 'ft'}` : null;

    // For purely descriptive features (no combat props), show a text snippet
    const rawDesc  = sys.description?.value ?? '';
    const hasCombatProps = !!(dmgFull || range || saveDC);
    const shortDesc = !hasCombatProps && rawDesc
      ? rawDesc.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 90)
      : null;

    return {
      id: item.id, name: item.name, img: item.img,
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
    };
  }

  #feat(item) {
    const sys = item.system;
    // Determine source: Heritage feat, Background feat, General feat, etc.
    const source = sys.featType ?? sys.category ?? sys.source?.book ?? 'General';
    const prereq = sys.prerequisites?.value ?? sys.prerequisite ?? '';
    return {
      id: item.id, name: item.name, img: item.img,
      source: this.#normFeatSource(source),
      prereq,
      desc: sys.description?.value ?? ''
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
      id: item.id, name: item.name, img: item.img,
      qty:    sys.quantity ?? 1,
      weight: sys.weight?.value ?? sys.weight ?? 0,
      equippedState,
      equipped:     equippedState === 2,
      carried:      equippedState === 1,
      notCarried:   equippedState === 0,
      attuned, needsAttune,
      attuneProblem: needsAttune && !attuned,
    };
  }

  #classItem(item) {
    return {
      id: item.id, name: item.name, img: item.img,
      level: item.system?.levels ?? item.system?.level ?? 1,
      hitDie: item.system?.hitDice?.denomination ?? item.system?.hitDie ?? 8
    };
  }

  /* ── Drag support ────────────────────────────────── */
  _onDragStart(event) {
    const row = event.currentTarget.closest('[data-item-id]');
    if (!row) return super._onDragStart(event);
    const item = this.actor.items.get(row.dataset.itemId);
    if (!item) return super._onDragStart(event);
    event.dataTransfer.setData('text/plain', JSON.stringify({
      type: 'Item',
      uuid: item.uuid,
      actorId: this.actor.id,
      data: item.toObject()
    }));
  }

  /* ── Listeners ────────────────────────────────────── */
  activateListeners(html) {
    super.activateListeners(html);
    const el = html instanceof jQuery ? html[0] : html;

    /* ── Roll listeners (work for all viewers, not just owners) ── */

    /* Ability left-click → instant roll; right-click → system dialog */
    el.querySelectorAll('[data-action="ability-check"]').forEach(b => {
      b.addEventListener('click', async (e) => {
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
      b.addEventListener('contextmenu', async (e) => {
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
            const rollMode = await Dialog.wait({
              title: label,
              content: '',
              buttons: {
                dis:  { icon: '<i class="fa-solid fa-angles-down"></i>', label: 'Disadvantage', callback: () => CONFIG.A5E.ROLL_MODE.DISADVANTAGE },
                norm: { icon: '<i class="fa-solid fa-dice-d20"></i>',   label: 'Normal',       callback: () => CONFIG.A5E.ROLL_MODE.NORMAL },
                adv:  { icon: '<i class="fa-solid fa-angles-up"></i>',  label: 'Advantage',    callback: () => CONFIG.A5E.ROLL_MODE.ADVANTAGE }
              },
              default: 'norm'
            });
            if (rollMode != null)
              await this.actor.rollAbilityCheck(id, { skipRollDialog: true, rollMode });
          } catch { /* dialog cancelled */ }
        }
      });
    });

    /* Saving throw left-click → instant roll; right-click → system dialog */
    el.querySelectorAll('[data-action="saving-throw"]').forEach(b => {
      b.addEventListener('click', async (e) => {
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
      b.addEventListener('contextmenu', async (e) => {
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
            const rollMode = await Dialog.wait({
              title: label,
              content: '',
              buttons: {
                dis:  { icon: '<i class="fa-solid fa-angles-down"></i>',  label: 'Disadvantage', callback: () => CONFIG.A5E.ROLL_MODE.DISADVANTAGE },
                norm: { icon: '<i class="fa-solid fa-dice-d20"></i>',    label: 'Normal',       callback: () => CONFIG.A5E.ROLL_MODE.NORMAL },
                adv:  { icon: '<i class="fa-solid fa-angles-up"></i>',   label: 'Advantage',    callback: () => CONFIG.A5E.ROLL_MODE.ADVANTAGE }
              },
              default: 'norm'
            });
            if (rollMode != null)
              await this.actor.rollSavingThrow(id, { skipRollDialog: true, rollMode });
          } catch { /* dialog cancelled */ }
        }
      });
    });

    /* Skill left-click → instant roll (no dialog) */
    el.querySelectorAll('[data-action="skill-check"]').forEach(b => {
      b.addEventListener('click', async (e) => {
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

    /* Skill right-click → system dialog (uses abbreviated key for CONFIG.A5E.skills lookup) */
    el.querySelectorAll('[data-action="skill-check"]').forEach(b => {
      b.addEventListener('contextmenu', async (e) => {
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

    /* Item image click → A5e activation dialog (with adv/disadv/bonus selection) */
    el.querySelectorAll('.am-item-row[data-item-id] .am-cs-ico').forEach(img => {
      img.style.cursor = 'pointer';
      img.addEventListener('click', async (e) => {
        e.stopPropagation();
        const row  = img.closest('[data-item-id]');
        const item = row ? this.actor.items.get(row.dataset.itemId) : null;
        if (!item) return;
        try {
          if (typeof item.activate === 'function') await item.activate();
          else item.sheet.render(true);
        } catch(err) { AM.log(2, 'img activate error:', err); }
      });
    });

    if (!this.isEditable) return;

    /* ── Edit-only listeners below ── */

    /* Item equip toggle — A5e equippedState: 0=notCarried,1=carried,2=equipped */
    el.querySelectorAll('[data-action="item-equip"]').forEach(b =>
      b.addEventListener('click', async () => {
        const item = this.actor.items.get(b.dataset.id);
        if (!item) return;
        const cur  = item.system?.equippedState ?? 1;
        // Toggle between carried(1) and equipped(2); skip notCarried
        const next = cur === 2 ? 1 : 2;
        await item.update({ 'system.equippedState': next });
      })
    );

    /* Item attunement toggle */
    el.querySelectorAll('[data-action="item-attune"]').forEach(b =>
      b.addEventListener('click', async () => {
        const item = this.actor.items.get(b.dataset.id);
        if (!item) return;
        await item.update({ 'system.attuned': !(item.system?.attuned ?? false) });
      })
    );

    /* Use button — skip dialog, just roll with defaults */
    el.querySelectorAll('[data-action="item-use"]').forEach(b =>
      b.addEventListener('click', async (e) => {
        e.stopPropagation();
        const item = this.actor.items.get(b.dataset.id);
        if (!item) return;
        try {
          if (typeof item.activate === 'function') { await item.activate(null, { skipRollDialog: true }); return; }
          if (typeof item.use      === 'function') { await item.use({ configureDialog: false });          return; }
          if (typeof item.roll     === 'function') { await item.roll();                                   return; }
          item.sheet.render(true);
        } catch(err) {
          AM.log(2, 'item-use error:', err);
          item.sheet.render(true);
        }
      })
    );

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
    el.querySelectorAll('[data-action="item-action-use"]').forEach(b =>
      b.addEventListener('click', async (e) => {
        e.stopPropagation();
        const item     = this.actor.items.get(b.dataset.id);
        const actionId = b.dataset.actionId;
        if (!item) return;
        try {
          if (typeof item.activate === 'function') {
            await item.activate(actionId !== 'default' ? actionId : null, { skipRollDialog: true });
            return;
          }
          if (typeof item.use  === 'function') { await item.use({ configureDialog: false }); return; }
          if (typeof item.roll === 'function') { await item.roll(); return; }
          item.sheet.render(true);
        } catch(err) { AM.log(2, 'item-action-use:', err); item.sheet.render(true); }
      })
    );

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
    el.querySelectorAll('.am-item-name').forEach(span =>
      span.addEventListener('click', () => {
        const row  = span.closest('[data-item-id]');
        const id   = row?.dataset?.itemId;
        const item = id ? this.actor.items.get(id) : null;
        item?.sheet?.render(true);
      })
    );

    /* Right-click any item row → A5e activation dialog (with adv/disadv modifiers) */
    el.querySelectorAll('.am-item-row[data-item-id]').forEach(row =>
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
        if (await Dialog.confirm({ title: 'Delete', content: `<p>Delete <b>${item.name}</b>?</p>` }))
          await item.delete();
      })
    );

    /* HP inputs */
    this.#bindNumericInput(el, '#am-hp-current', v => ({ 'system.attributes.hp.value': v }));
    this.#bindNumericInput(el, '#am-hp-max',     v => ({ 'system.attributes.hp.max': v }));
    this.#bindNumericInput(el, '#am-hp-temp',    v => ({ 'system.attributes.hp.temp': v }));

    /* Exertion */
    this.#bindNumericInput(el, '#am-exertion-current', v => ({
      'system.attributes.exertion.current': v,
      'system.attributes.exertion.value': v   // fallback path
    }));

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
      const existing = this.actor.effects.find(e =>
        (e.conditionId === id) || (e.statuses?.has(id)) ||
        (e.getFlag?.('core', 'statusId') === id)
      );
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

        // Find existing effect by conditionId (A5e) OR statuses set (Foundry standard)
        const existing = this.actor.effects.find(e =>
          (e.conditionId === id) ||
          (e.statuses?.has(id)) ||
          (e.getFlag?.('core', 'statusId') === id)
        );

        if (existing) {
          await existing.delete();
          await _clearDuration(id);
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
      const isActive = _hoveredCondBtn.classList.contains('am-cs-status-active');
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
    const condDescPanel = el.querySelector('.am-cs-cond-desc-panel');
    if (condDescPanel) {
      el.querySelectorAll('[data-action="toggle-condition"]').forEach(btn => {
        btn.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          const desc  = btn.dataset.description;
          const label = btn.dataset.label;
          if (!desc) return;
          condDescPanel.innerHTML = `<strong>${label}</strong><p>${desc}</p>`;
          condDescPanel.style.display = '';
        });
      });
      condDescPanel.addEventListener('click', () => {
        condDescPanel.style.display = 'none';
      });
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
          const name = item.querySelector('.am-item-name')?.textContent?.toLowerCase() ?? '';
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
        const name = item.querySelector('.am-item-name')?.textContent?.toLowerCase() ?? '';
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
    el.querySelector('[data-action="short-rest"]')?.addEventListener('click', () =>
      this.actor.shortRest?.() ?? ui.notifications.info('Short rest taken.')
    );
    el.querySelector('[data-action="long-rest"]')?.addEventListener('click', () =>
      this.actor.longRest?.() ?? ui.notifications.info('Long rest taken.')
    );

    /* Level Up */
    el.querySelector('[data-action="level-up"]')?.addEventListener('click', () =>
      AM.openLevelUp(this.actor)
    );

    /* Manage maneuvers */
    el.querySelector('[data-action="manage-maneuvers"]')?.addEventListener('click', () =>
      new ManeuverDialog(this.actor, { slotsAvailable: -1 }).render(true)
    );

    /* Manage spells */
    el.querySelector('[data-action="manage-spells"]')?.addEventListener('click', () =>
      new SpellDialog(this.actor, { cantripsToChoose: -1, spellsToChoose: -1 }).render(true)
    );

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
  }

  /* ── Private helpers ──────────────────────────────── */

  #actCostLabel(activation) {
    return { action: 'A', bonus: 'B', reaction: 'R', other: '' }[activation] ?? 'A';
  }

  #parseRollsFromAction(action) {
    const rolls       = Array.isArray(action?.rolls) ? action.rolls : [];
    const attackRoll  = rolls.find(r => r.type === 'attack');
    const damageRolls = rolls.filter(r => r.type === 'damage');
    const saveRoll    = rolls.find(r => r.type === 'savingThrow');
    const oldDmgArr   = action?.damage ?? action?.damages ?? [];
    const oldDmg      = oldDmgArr[0]?.formula ?? oldDmgArr[0]?.dice ?? null;
    const oldAtkBonus = action?.attackBonus ?? action?.attack?.bonus ?? null;
    const oldSaveDC   = action?.save?.dc ? `DC ${action.save.dc}` : null;
    const oldDmgType  = oldDmgArr[0]?.damageType ?? null;
    const atkRaw      = attackRoll?.bonus ?? oldAtkBonus ?? '';
    const dmg         = damageRolls[0]?.formula ?? oldDmg;
    const saveDC      = saveRoll?.dc ? `DC ${saveRoll.dc}` : oldSaveDC;
    const rawType     = damageRolls[0]?.damageType ?? oldDmgType;
    const dmgType     = rawType ? rawType.charAt(0).toUpperCase() + rawType.slice(1) : null;
    const atkBonus    = atkRaw !== '' && !isNaN(Number(atkRaw)) ? sign(Number(atkRaw)) : null;
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
      return [{ actionId: 'default', itemId: item.id, name: item.name,
                activation, activationLabel: this.#actCostLabel(activation),
                ...this.#parseRollsFromAction({}) }];
    }
    return entries.map(([actionId, action]) => {
      const activation = this.#resolveActivation(action, action);
      return { actionId, itemId: item.id,
               name: action.name || item.name,
               activation, activationLabel: this.#actCostLabel(activation),
               ...this.#parseRollsFromAction(action) };
    });
  }

  #buildActionGroup(item, favoriteIds) {
    const sys           = item.system ?? {};
    const uses          = sys.uses ?? {};
    const isEquippable  = item.type === 'object';
    const equippedState = isEquippable ? (sys.equippedState ?? 1) : null;
    const starred       = favoriteIds.has(item.id) || !!(sys.favorite);
    return {
      id: item.id, name: item.name, img: item.img,
      type: item.type,
      isEquippable,
      equippedState,
      equipped:   equippedState === 2,
      carried:    equippedState === 1,
      notCarried: equippedState === 0,
      attuned:    sys.attuned ?? false,
      needsAttune: sys.requiresAttunement ?? false,
      starred,
      qty:  isEquippable ? (sys.quantity ?? 1) : null,
      uses: { current: uses.current ?? uses.value ?? null,
               max: uses.max ?? null, hasUses: !!(uses.max > 0) },
      actions: this.#allActionsForItem(item),
      desc: sys.description?.value ?? '',
    };
  }

  #calcProf(actor) {
    const lvl = actor.items.filter(i => i.type === 'class')
      .reduce((n, i) => n + (i.system?.levels ?? i.system?.level ?? 1), 0) || 1;
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
    const packs  = game.packs.filter(p => p.metadata.type === 'Item');
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

    const d = new Dialog({
      title: 'Add Feat',
      content,
      buttons: { close: { label: 'Close' } },
      default: 'close',
      render: (html) => {
        // Search
        html.find('.am-fp-search').on('input', function() {
          const q = this.value.toLowerCase();
          html.find('.am-feat-picker-row').each(function() {
            const name = $(this).find('.am-fp-name').text().toLowerCase();
            $(this).toggle(name.includes(q));
          });
        });
        // Add button
        html.find('.am-fp-add-btn').on('click', async function() {
          const uuid = $(this).data('uuid');
          try {
            const item = await fromUuid(uuid);
            if (item) {
              await Item.create(item.toObject(), { parent: this.actor });
              $(this).text('✓ Added').addClass('am-added');
            }
          } catch (err) {
            ui.notifications.error('Could not add feat: ' + err.message);
          }
        }.bind(this));
      }
    }, { width: 480, height: 540 });
    d.render(true);
  }

  #normTrad(raw) {
    return raw.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
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
      if (!isNaN(val)) await this.actor.update(pathFn(val)).catch(() => {});
    });
  }

  async close(options = {}) {
    if (this._condKeydownHandler) {
      window.removeEventListener('keydown', this._condKeydownHandler);
      this._condKeydownHandler = null;
    }
    return super.close(options);
  }
}

function sign(n) { return n >= 0 ? `+${n}` : `${n}`; }
