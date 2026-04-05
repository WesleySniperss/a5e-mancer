import { AM } from '../a5e-mancer.js';

const MODULE_ID = 'a5e-mancer';

const ABILITIES = [
  { key: 'str', abbr: 'STR', label: 'Strength' },
  { key: 'dex', abbr: 'DEX', label: 'Dexterity' },
  { key: 'con', abbr: 'CON', label: 'Constitution' },
  { key: 'int', abbr: 'INT', label: 'Intelligence' },
  { key: 'wis', abbr: 'WIS', label: 'Wisdom' },
  { key: 'cha', abbr: 'CHA', label: 'Charisma' }
];

const CR_TO_PROF = {
  0: 2, 0.125: 2, 0.25: 2, 0.5: 2,
  1: 2, 2: 2, 3: 2, 4: 2,
  5: 3, 6: 3, 7: 3, 8: 3,
  9: 4, 10: 4, 11: 4, 12: 4,
  13: 5, 14: 5, 15: 5, 16: 5,
  17: 6, 18: 6, 19: 6, 20: 6,
  21: 7, 22: 7, 23: 7, 24: 7,
  25: 8, 26: 8, 27: 8, 28: 8,
  29: 9, 30: 9
};

function sign(n) { return n >= 0 ? `+${n}` : `${n}`; }

export class A5eNPCSheet extends ActorSheet {

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ['a5e-mancer-npc-sheet', 'sheet', 'actor'],
      template: `modules/${MODULE_ID}/templates/sheet/npc-sheet.hbs`,
      width: 640,
      height: 600,
      resizable: true,
      tabs: [{ navSelector: '.am-npc-tabs', contentSelector: '.am-npc-body', initial: 'actions' }],
      dragDrop: [{ dragSelector: '.am-item-row', dropSelector: '.am-npc-body' }]
    });
  }

  async getData() {
    const actor = this.actor;
    const sys   = actor.system;
    const items = actor.items.contents;

    /* CR and proficiency */
    const cr      = sys.details?.cr ?? sys.details?.challengeRating ?? 0;
    const crStr   = cr === 0.125 ? '1/8' : cr === 0.25 ? '1/4' : cr === 0.5 ? '1/2' : String(cr);
    const profBonus = sys.attributes?.prof ?? CR_TO_PROF[cr] ?? 2;

    /* Abilities */
    const abilities = ABILITIES.map(({ key, abbr, label }) => {
      const d   = sys.abilities?.[key] ?? {};
      const val = d.value ?? 10;
      const mod = Math.floor((val - 10) / 2);
      const save = d.save ?? mod;
      const saveProf = !!(d.saveProficient ?? d.proficient);
      return { key, abbr, label, val, mod, modStr: sign(mod), save, saveStr: sign(save), saveProf };
    });

    /* HP */
    const hp    = sys.attributes?.hp ?? {};
    const hpPct = hp.max ? Math.round(Math.clamped((hp.value ?? 0) / hp.max, 0, 1) * 100) : 0;
    const hpColor = hpPct < 25 ? '#e05040' : hpPct < 50 ? '#e09020' : '#4a9a4a';

    /* Speed strings */
    const movement = sys.attributes?.movement ?? {};
    const speeds = [];
    const speedMap = {
      walk: '', swim: 'swim', fly: 'fly', burrow: 'burrow', climb: 'climb'
    };
    for (const [type, label] of Object.entries(speedMap)) {
      const val = movement[type]?.distance ?? movement[type];
      if (val) speeds.push(label ? `${label} ${val} ft` : `${val} ft`);
    }

    /* Senses */
    const senses = sys.attributes?.senses ?? sys.senses ?? {};
    const senseList = [];
    for (const [k, v] of Object.entries(senses)) {
      if (v && typeof v === 'object' && v.distance) senseList.push(`${k} ${v.distance} ft`);
      else if (typeof v === 'number' && v > 0) senseList.push(`${k} ${v} ft`);
    }
    const pp = 10 + Math.floor(((sys.abilities?.wis?.value ?? 10) - 10) / 2);
    senseList.push(`passive Perception ${pp}`);

    /* Resistances/immunities */
    const dmgResist  = this.#joinTraits(sys.traits?.damageResistances ?? sys.traits?.dr ?? []);
    const dmgImmune  = this.#joinTraits(sys.traits?.damageImmunities  ?? sys.traits?.di ?? []);
    const condImmune = this.#joinTraits(sys.traits?.conditionImmunities ?? sys.traits?.ci ?? []);

    /* Items grouped */
    // A5e stores action data in system.actions (object), not system.actionType
    const isActionItem = (i) =>
      i.type === 'weapon' || i.type === 'maneuver' ||
      (i.type === 'feature' && (i.system?.actionType || Object.keys(i.system?.actions ?? {}).length > 0));

    const actions    = items.filter(isActionItem).map(i => this.#action(i, profBonus, abilities));
    const features   = items.filter(i => i.type === 'feature' && !isActionItem(i)).map(i => this.#feature(i));
    const legendaries = items.filter(i => i.type === 'feature' && (i.name.toLowerCase().includes('legendary') || i.system?.legendary)).map(i => this.#feature(i));
    const lairActions = items.filter(i => i.type === 'feature' && i.name.toLowerCase().includes('lair')).map(i => this.#feature(i));

    /* Legendary / lair resources */
    const legendaryActions = sys.resources?.legact ?? sys.attributes?.legact ?? null;
    const legendaryResist  = sys.resources?.legres ?? sys.attributes?.legres ?? null;

    /* Conditions */
    const activeEffects = actor.effects.filter(e => !e.disabled).map(e => ({
      id: e.id, label: e.name ?? e.label, icon: e.icon
    }));

    /* NPC details */
    const details = {
      type:      sys.details?.type?.value ?? sys.details?.creatureType ?? sys.details?.type ?? '',
      size:      sys.traits?.size ?? sys.details?.size ?? '',
      alignment: sys.details?.alignment ?? '',
      cr:        crStr,
      xp:        sys.details?.xp?.value ?? sys.details?.xp ?? this.#crToXP(cr),
      language:  this.#joinTraits(sys.traits?.languages?.value ?? sys.traits?.languages ?? sys.details?.languages ?? []),
      source:    sys.details?.source ?? ''
    };

    /* Group actions by type for template */
    const actionGroups = [
      { type: 'action',    label: 'Actions',         items: actions.filter(a => a.activation === 'action') },
      { type: 'bonus',     label: 'Bonus Actions',   items: actions.filter(a => a.activation === 'bonus') },
      { type: 'reaction',  label: 'Reactions',       items: actions.filter(a => a.activation === 'reaction') },
      { type: 'legendary', label: 'Legendary Actions', items: actions.filter(a => a.activation === 'legendary') },
      { type: 'lair',      label: 'Lair Actions',    items: actions.filter(a => a.activation === 'lair') }
    ];

    /* Legendary action pips */
    const legActRaw = sys.resources?.legact ?? sys.attributes?.legact ?? null;
    const legendaryActionsData = legActRaw ? {
      value: legActRaw.value ?? legActRaw.current ?? 0,
      max:   legActRaw.max ?? 3,
      pips:  Array.from({ length: legActRaw.max ?? 3 }, (_, i) => ({
        i, on: i < (legActRaw.value ?? legActRaw.current ?? 0)
      }))
    } : null;

    return {
      actor, system: sys,
      isOwner: actor.isOwner, isGM: game.user.isGM,
      abilities, cr: crStr, profBonus,
      hp: { value: hp.value ?? 0, max: hp.max ?? 0, temp: hp.temp ?? 0, formula: hp.formula ?? '', pct: hpPct, color: hpColor },
      ac:    sys.attributes?.ac?.value ?? sys.attributes?.ac ?? 10,
      speed: speeds.join(', ') || '30 ft',
      senses: senseList.join(', '),
      dmgResist, dmgImmune, condImmune,
      actions, features, legendaries, lairActions,
      legendaryActions: legendaryActionsData, legendaryResist, actionGroups,
      activeEffects, details,
      hasActions:    actions.length > 0,
      hasFeatures:   features.length > 0,
      hasLegendary:  legendaries.length > 0,
      hasLair:       lairActions.length > 0,
      hasConditions: activeEffects.length > 0
    };
  }

  /* ── Item builders ──────────────────────────────── */
  #action(item, profBonus, abilities) {
    const sys     = item.system;
    const actions = sys.actions ? Object.values(sys.actions) : [];
    const first   = actions[0] ?? {};

    // Attack bonus
    const atkType  = first.attack?.type ?? '';
    const isSpell  = atkType.includes('spell') || atkType.includes('magic');
    const atkAbil  = first.attack?.ability ?? (isSpell ? 'int' : 'str');
    const abilMod  = abilities.find(a => a.key === atkAbil)?.mod ?? 0;
    const atkBonus = (first.attackBonus ?? 0) + abilMod + profBonus;

    // Damage
    const dmgParts = (first.damage ?? [])
      .map(d => d.formula ? `${d.formula}${d.type ? ` ${d.type}` : ''}` : '')
      .filter(Boolean);

    // Range
    const range = first.range?.value
      ? `${first.range.value}${first.range.long ? `/${first.range.long}` : ''} ft`
      : (first.reach ? `${first.reach} ft` : '');

    // Activation — A5e stores this in actions[id].activation.type or system.activation.type
    const actType = (first.activation?.type ?? sys.activation?.type ?? sys.actionType ?? 'action').toLowerCase();
    const activation = actType.includes('bonus') ? 'bonus'
      : actType.includes('reaction') ? 'reaction'
      : actType.includes('legendary') ? 'legendary'
      : actType.includes('lair') ? 'lair'
      : 'action';

    return {
      id: item.id, name: item.name, img: item.img,
      isAttack: !!first.attack || item.type === 'weapon',
      atkBonus: sign(atkBonus),
      dmg: dmgParts.join(' + ') || '—',
      range, activation,
      desc: sys.description?.value ?? ''
    };
  }

  #feature(item) {
    return {
      id: item.id, name: item.name, img: item.img,
      desc: item.system?.description?.value ?? '',
      recharge: item.system?.recharge?.value ?? null
    };
  }

  /* ── Listeners ──────────────────────────────────── */
  activateListeners(html) {
    super.activateListeners(html);
    if (!this.isEditable) return;
    const el = html instanceof jQuery ? html[0] : html;

    /* Ability rolls */
    el.querySelectorAll('[data-action="ability-check"]').forEach(b =>
      b.addEventListener('click', () => {
        try { this.actor.rollAbilityCheck?.(b.dataset.ability); }
        catch { this.#roll(`1d20${b.dataset.mod}`, b.dataset.label); }
      })
    );

    /* Save rolls */
    el.querySelectorAll('[data-action="saving-throw"]').forEach(b =>
      b.addEventListener('click', () => {
        try { this.actor.rollSavingThrow?.(b.dataset.ability); }
        catch { this.#roll(`1d20${b.dataset.save}`, `${b.dataset.ability.toUpperCase()} Save`); }
      })
    );

    /* Item use */
    el.querySelectorAll('[data-action="item-use"]').forEach(b =>
      b.addEventListener('click', () => {
        const item = this.actor.items.get(b.dataset.id);
        item?.use?.() ?? item?.roll?.();
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
        if (item && await Dialog.confirm({ title: 'Delete', content: `<p>Delete <b>${item.name}</b>?</p>` }))
          await item.delete();
      })
    );

    /* HP */
    el.querySelector('#npc-hp-cur')?.addEventListener('change', async e => {
      const v = parseInt(e.target.value);
      if (!isNaN(v)) await this.actor.update({ 'system.attributes.hp.value': v });
    });
    el.querySelector('#npc-hp-max')?.addEventListener('change', async e => {
      const v = parseInt(e.target.value);
      if (!isNaN(v)) await this.actor.update({ 'system.attributes.hp.max': v });
    });
    el.querySelector('#npc-hp-temp')?.addEventListener('change', async e => {
      await this.actor.update({ 'system.attributes.hp.temp': parseInt(e.target.value) || 0 });
    });

    /* AC */
    el.querySelector('#npc-ac')?.addEventListener('change', async e => {
      await this.actor.update({ 'system.attributes.ac.value': parseInt(e.target.value) });
    });

    /* Feature collapse */
    el.querySelectorAll('.npc-feat-toggle').forEach(btn =>
      btn.addEventListener('click', () => {
        const body = btn.closest('.npc-feat-item')?.querySelector('.npc-feat-body');
        body?.classList.toggle('am-hidden');
        btn.textContent = body?.classList.contains('am-hidden') ? '▸' : '▾';
      })
    );

    /* Legendary action counter */
    el.querySelectorAll('[data-action="leg-pip"]').forEach(pip =>
      pip.addEventListener('click', async () => {
        const cur  = parseInt(pip.dataset.current);
        const idx  = parseInt(pip.dataset.index);
        const next = idx + 1 === cur ? idx : idx + 1;
        await this.actor.update({ 'system.resources.legact.value': next })
          .catch(() => this.actor.update({ 'system.attributes.legact.value': next }));
      })
    );

    /* Short/Long rest */
    el.querySelector('[data-action="short-rest"]')?.addEventListener('click', () => this.actor.shortRest?.());
    el.querySelector('[data-action="long-rest"]')?.addEventListener('click',  () => this.actor.longRest?.());
  }

  /* ── Private ────────────────────────────────────── */
  #joinTraits(val) {
    if (!val) return '';
    if (Array.isArray(val)) return val.join(', ');
    if (typeof val === 'object' && val.value) return Array.isArray(val.value) ? val.value.join(', ') : val.value;
    return String(val);
  }

  #crToXP(cr) {
    const table = { 0:10, 0.125:25, 0.25:50, 0.5:100, 1:200, 2:450, 3:700, 4:1100, 5:1800, 6:2300, 7:2900, 8:3900, 9:5000, 10:5900, 11:7200, 12:8400, 13:10000, 14:11500, 15:13000, 16:15000, 17:18000, 18:20000, 19:22000, 20:25000, 21:33000, 22:41000, 23:50000, 24:62000, 25:75000, 26:90000, 27:105000, 28:120000, 29:135000, 30:155000 };
    return table[cr] ?? 0;
  }

  async #roll(formula, label) {
    const roll = new Roll(formula, this.actor.getRollData?.() ?? {});
    await roll.evaluate();
    roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor: this.actor }), flavor: label });
  }
}
