import { AM } from '../a5e-mancer.js';
import { LevelUpDialog } from './LevelUpDialog.js';
import { ManeuverDialog } from './ManeuverDialog.js';
import { SpellDialog } from './SpellDialog.js';

const MODULE_ID = 'a5e-mancer';

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

/* ═══════════════════════════════════════════════════════ */
export class A5eCharacterSheet extends ActorSheet {

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ['a5e-mancer-sheet', 'sheet', 'actor'],
      template: `modules/${MODULE_ID}/templates/sheet/character-sheet.hbs`,
      width: 820,
      height: 700,
      resizable: true,
      tabs: [{ navSelector: '.am-sheet-tabs', contentSelector: '.am-sheet-body', initial: 'actions' }],
      dragDrop: [{ dragSelector: '.am-item-row', dropSelector: '.am-sheet-body' }]
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
      const d       = sys.abilities?.[key] ?? {};
      const value   = d.value ?? 10;
      const mod     = Math.floor((value - 10) / 2);
      const saveMod = d.save ?? mod;
      const saveProf = !!(d.saveProficient ?? d.proficient);
      return { key, label, abbr, value, mod, modStr: sign(mod), saveMod, saveModeStr: sign(saveMod), saveProf };
    });

    /* Skills */
    const abilMap = Object.fromEntries(abilities.map(a => [a.abbr, a.mod]));
    const skills = SKILLS.map(({ key, label, ability }) => {
      const d       = sys.skills?.[key] ?? {};
      const abilMod = abilMap[ability] ?? 0;
      const profLvl = d.proficient ?? d.proficiency ?? 0;
      const mult    = [0, 0.5, 1, 2][Math.min(profLvl, 3)] ?? 0;
      const bonus   = abilMod + Math.floor(profBonus * mult);
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

    /* Items categorised */
    const weapons   = items.filter(i => i.type === 'weapon').map(i => this.#weapon(i));
    const maneuvers = items.filter(i => i.type === 'maneuver').map(i => this.#maneuver(i));
    const spells    = items.filter(i => i.type === 'spell').map(i => this.#spell(i));
    const features  = items.filter(i => ['feature','feat','background','heritage','culture','destiny'].includes(i.type))
                            .map(i => this.#feature(i));
    const feats       = items.filter(i => i.type === 'feat').map(i => this.#feat(i));
    const allFeatures = [
      ...features.map(f => ({...f, type: 'feature'})),
      ...feats.map(f => ({...f, type: 'feat'}))
    ].sort((a, b) => a.name.localeCompare(b.name));

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
    const equipment = items.filter(i => ['equipment','tool','consumable','backpack','loot','object'].includes(i.type))
                            .map(i => this.#gear(i));
    const classes   = items.filter(i => i.type === 'class').map(i => this.#classItem(i));

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

    /* Spell slots */
    const rawSlots = sys.spellcasting?.slots ?? sys.spells ?? {};
    const slotRows = [1,2,3,4,5,6,7,8,9].map(l => {
      const d = rawSlots[`spell${l}`] ?? rawSlots[l] ?? {};
      const max   = d.max   ?? 0;
      const value = d.value ?? 0;
      if (!max) return null;
      // Build array of pip states
      const pips = Array.from({ length: max }, (_, i) => ({ index: i, used: i >= value, level: l }));
      return { level: l, value, max, pips };
    }).filter(Boolean);

    /* Fatigue/Strife pip arrays */
    const fatiguePips  = Array.from({ length: 6 }, (_, i) => ({ i, active: i < resources.fatigue }));
    const strifePips   = Array.from({ length: 6 }, (_, i) => ({ i, active: i < resources.strife  }));
    const exMax        = resources.exertion.max || 0;
    const exCur        = resources.exertion.current || 0;
    const exertionPips = Array.from({ length: Math.min(exMax, 20) }, (_, i) => ({ i, active: i < exCur }));

    /* Currency */
    const currency = sys.currency ?? sys.wealth ?? { gp: 0, sp: 0, cp: 0, ep: 0, pp: 0 };

    /* Passive perception */
    const percSkill = skills.find(s => s.key === 'perception');
    const passivePerception = 10 + (percSkill?.bonus ?? 0);

    /* Character overview info */
    const totalLevel = classes.reduce((n, c) => n + c.level, 0) || 1;
    const charInfo = {
      totalLevel,
      heritage:   items.find(i => i.type === 'heritage')?.name   ?? sys.details?.heritage?.name   ?? '—',
      culture:    items.find(i => i.type === 'culture')?.name    ?? sys.details?.culture?.name    ?? '—',
      background: items.find(i => i.type === 'background')?.name ?? sys.details?.background?.name ?? '—',
      destiny:    items.find(i => i.type === 'destiny')?.name    ?? sys.details?.destiny?.name    ?? null
    };

    return {
      actor, system: sys, isOwner: actor.isOwner, isGM: game.user.isGM,
      abilities, skills, resources, classes,
      weapons, maneuvers, maneuverGroups, spells, spellGroups, slotRows,
      features, feats, allFeatures, customCounters, equipment, currency,
      fatiguePips, strifePips, exertionPips,
      passivePerception, charInfo,
      hasWeapons:   weapons.length   > 0,
      hasManeuvers: maneuvers.length > 0,
      hasSpells:    spells.length    > 0,
      hasFeatures:  features.length  > 0,
      hasEquipment: equipment.length > 0,
      hasCombat:    weapons.length + maneuvers.length + spells.length > 0,

      // Tag items with type for partial rendering
      ...[...weapons.map(i => ({...i, isWeapon: true})),
          ...maneuvers.map(i => ({...i, isManeuver: true})),
          ...spells.map(i => ({...i, isSpell: true}))].forEach(() => {}),

      // Actions tab — grouped by activation type
      // Includes: weapons, maneuvers, AND spells (cantrips use action by default)
      actionsGroup: [
        ...weapons.map(i => ({...i, isWeapon: true})).filter(i => i.activation === 'action'),
        ...maneuvers.map(i => ({...i, isManeuver: true})).filter(i => i.activation === 'action'),
        ...spells.map(i => ({...i, isSpell: true})).filter(i =>
          i.activation === 'action' && (i.level === 0 || i.prepared !== false)
        )
      ],
      bonusActions: [
        ...weapons.map(i => ({...i, isWeapon: true})).filter(i => i.activation === 'bonus'),
        ...maneuvers.map(i => ({...i, isManeuver: true})).filter(i => i.activation === 'bonus'),
        ...spells.map(i => ({...i, isSpell: true})).filter(i => i.activation === 'bonus')
      ],
      reactions: [
        ...weapons.map(i => ({...i, isWeapon: true})).filter(i => i.activation === 'reaction'),
        ...maneuvers.map(i => ({...i, isManeuver: true})).filter(i => i.activation === 'reaction'),
        ...spells.map(i => ({...i, isSpell: true})).filter(i => i.activation === 'reaction')
      ],

      // Spell level order for template iteration (Handlebars can't do computed keys)
      spellLevelOrder: ['Level 1','Level 2','Level 3','Level 4','Level 5',
                        'Level 6','Level 7','Level 8','Level 9']
    };
  }

  /* ── Item builders ────────────────────────────────── */
  #weapon(item) {
    const sys = item.system;
    const actions = sys.actions ? Object.values(sys.actions) : [];
    const firstAction = actions[0] ?? {};
    const atkBonus = firstAction.attackBonus ?? '';
    const dmg = firstAction.damage?.[0] ? `${firstAction.damage[0].formula}` : '—';
    const activation = this.#resolveActivation(firstAction, sys);
    return {
      id: item.id, name: item.name, img: item.img,
      atkBonus: atkBonus ? sign(atkBonus) : '—', dmg,
      equipped: sys.equipped ?? false,
      activation,
      properties: sys.properties
        ? [...(sys.properties instanceof Set ? sys.properties : Object.keys(sys.properties))]
        : []
    };
  }

  #maneuver(item) {
    const sys = item.system;
    const tradition = this.#normTrad(sys.tradition ?? sys.combatTradition ?? '');
    const actions = sys.actions ? Object.values(sys.actions) : [];
    const activation = this.#resolveActivation(actions[0] ?? {}, sys);
    return {
      id: item.id, name: item.name, img: item.img,
      tradition: tradition || 'Other',
      degree: sys.degree ?? sys.maneuverDegree ?? 1,
      exertion: sys.exertionCost ?? sys.cost ?? null,
      activation,
      desc: sys.description?.value ?? ''
    };
  }

  #spell(item) {
    const sys = item.system;
    const actions = sys.actions ? Object.values(sys.actions) : [];
    const activation = this.#resolveActivation(actions[0] ?? {}, sys);
    const level = sys.level ?? sys.spellLevel ?? 0;
    return {
      id: item.id, name: item.name, img: item.img,
      level,
      levelLabel: level === 0 ? 'Cantrip' : `Level ${level}`,
      school: sys.school ?? '',
      ritual: sys.ritual ?? false,
      concentration: sys.concentration ?? false,
      prepared: sys.prepared !== false,
      activation,
      castingTime: sys.castingTime ?? sys.activation?.type ?? '',
      range: sys.range?.value ? `${sys.range.value} ${sys.range.units ?? ''}`.trim() : '',
      desc: sys.description?.value ?? ''
    };
  }

  #feature(item) {
    return {
      id: item.id, name: item.name, img: item.img,
      type: item.type, source: item.type.charAt(0).toUpperCase() + item.type.slice(1),
      desc: item.system?.description?.value ?? ''
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
    return {
      id: item.id, name: item.name, img: item.img,
      qty: item.system?.quantity ?? 1,
      weight: item.system?.weight?.value ?? item.system?.weight ?? 0,
      equipped: item.system?.equipped ?? false
    };
  }

  #classItem(item) {
    return {
      id: item.id, name: item.name, img: item.img,
      level: item.system?.levels ?? item.system?.level ?? 1,
      hitDie: item.system?.hitDice?.denomination ?? item.system?.hitDie ?? 8
    };
  }

  /* ── Listeners ────────────────────────────────────── */
  activateListeners(html) {
    super.activateListeners(html);
    if (!this.isEditable) return;
    const el = html instanceof jQuery ? html[0] : html;

    /* Ability rolls */
    el.querySelectorAll('[data-action="ability-check"]').forEach(b =>
      b.addEventListener('click', () => {
        const id = b.dataset.ability;
        try { this.actor.rollAbilityCheck?.(id) ?? this.actor.rollAbility?.(id); }
        catch { this.#roll(`1d20 + @abilities.${id}.mod`, b.dataset.label ?? id); }
      })
    );

    /* Save rolls */
    el.querySelectorAll('[data-action="saving-throw"]').forEach(b =>
      b.addEventListener('click', () => {
        const id = b.dataset.ability;
        try { this.actor.rollSavingThrow?.(id) ?? this.actor.rollAbilitySave?.(id); }
        catch { this.#roll(`1d20 + @abilities.${id}.save`, `${id} Save`); }
      })
    );

    /* Skill rolls */
    el.querySelectorAll('[data-action="skill-check"]').forEach(b =>
      b.addEventListener('click', () => {
        const id = b.dataset.skill;
        try { this.actor.rollSkill?.(id); }
        catch { this.#roll('1d20', b.dataset.label ?? id); }
      })
    );

    /* Item use */
    el.querySelectorAll('[data-action="item-use"]').forEach(b =>
      b.addEventListener('click', () => {
        const item = this.actor.items.get(b.dataset.id);
        item?.use?.() ?? item?.roll?.();
      })
    );

    /* Item chat */
    el.querySelectorAll('[data-action="item-chat"]').forEach(b =>
      b.addEventListener('click', () => {
        const item = this.actor.items.get(b.dataset.id);
        item?.toChat?.() ?? item?.roll?.();
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

    /* Spell slot pips */
    el.querySelectorAll('[data-action="slot-pip"]').forEach(pip =>
      pip.addEventListener('click', async () => {
        const lvl  = parseInt(pip.dataset.level);
        const idx  = parseInt(pip.dataset.index);
        const cur  = parseInt(pip.dataset.current);
        const next = idx === cur - 1 ? idx : idx + 1;
        await this.actor.update({ [`system.spellcasting.slots.spell${lvl}.value`]: next })
          .catch(() => this.actor.update({ [`system.spells.spell${lvl}.value`]: next }));
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
      new ManeuverDialog(this.actor, { slotsAvailable: 0 }).render(true)
    );

    /* Manage spells */
    el.querySelector('[data-action="manage-spells"]')?.addEventListener('click', () =>
      new SpellDialog(this.actor, { slotsAvailable: 0 }).render(true)
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
   * a5e stores activation in actions[id].activation.type OR system.activation.type
   */
  #resolveActivation(actionData, sys) {
    const raw = (
      actionData?.activation?.type ??
      actionData?.activationType ??
      sys?.activation?.type ??
      sys?.activationType ??
      ''
    ).toLowerCase();

    if (raw.includes('bonus'))    return 'bonus';
    if (raw.includes('reaction')) return 'reaction';
    if (raw.includes('action') || raw === 'standard' || raw === '') return 'action';
    return 'other';
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
}

function sign(n) { return n >= 0 ? `+${n}` : `${n}`; }
