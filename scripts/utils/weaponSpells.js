import { AM } from '../am.js';

/**
 * Spells cast with a weapon attack, rolled with the weapon in one window.
 *
 * Asked 2026-10-09: Booming Blade and spells like it should roll together with
 * the weapon, as on D&D Beyond; then "why only Booming Blade - there are more,
 * like Arcing Blow"; then "can it roll in one window, not in ten"; then "the
 * spell must still be rollable on its own, without the weapon". So one window
 * of this module's asks everything - the weapon (only those that fit, the
 * equipped first, or none: the spell alone), the roll mode, and what a hit
 * adds: the spell's own damage and the character's damage bonuses that a5e's
 * attack window offers (Sneak Attack) - and the rest rolls without a5e's
 * windows:
 *
 *   - a cantrip with no save and no healing (Arcing Blow, Thunderstrike,
 *     Smoking Weapon, Righteous Strike, Trick Shot, Booming Blade...): its
 *     damage goes into the weapon's roll as a damage bonus, scaled for the
 *     character's level the way a5e scales it - one card, the attack, the
 *     weapon's damage and the spell's, doubled together on a critical hit.
 *     The spell's own card, its text, comes first, for what a hit does
 *     besides damage.
 *   - a levelled spell, or one with a save or healing (Detonating Shot,
 *     Cupid's Arrow, Withering Attack): the weapon's card, then the spell's -
 *     its damage, its save and its slot, at its own level.
 *
 * Right-click rolls the default at once: the first weapon, a normal roll, what
 * is ticked by default.
 *
 * Which spells: those whose text makes a weapon attack part of the casting -
 * "as part of the action (used) to cast this spell, make an attack with your
 * melee weapon / a ranged weapon attack", "make a melee attack with a weapon",
 * 2024's "brandish the weapon used in the spell's casting". The text is the
 * item's, or - a copy on a character often has none, only its actions - its
 * compendium entry's; with neither, the name (#KNOWN). On 2026-10-09 the
 * same Arcing Blow worked on one character and not on another: the other's
 * copy had no text at all. A spell attack made "with" a weapon (Sufferer's
 * Strike) is the spell's, its bonus not the weapon's, and left alone; so are
 * Altered Strike, Air Wave and Dimensional Rend, whose own attack a5e rolls.
 */
export class WeaponSpells {

  static #PATTERNS = [
    /as part of the (?:\w+ )?action (?:used )?to cast this spell,? (?:you (?:must )?)?make an? (?:(melee|ranged) )?(?:weapon )?attack/i,
    /make an? (melee|ranged) attack with a weapon/i,
    /brandish the weapon used in the spell'?s casting and make an? (melee|ranged) attack/i
  ];

  /** By name, for a copy that has no text and no source to read it from. */
  static #KNOWN = {
    'booming blade': 'melee', 'green-flame blade': 'melee', 'green flame blade': 'melee',
    'arcing blow': 'melee', 'thunderstrike': 'melee', 'smoking weapon': 'melee', 'withering attack': 'melee',
    'righteous strike': 'any',
    'trick shot': 'ranged', 'flare shot': 'ranged', 'rope shot': 'ranged', 'detonating shot': 'ranged',
    "calatyr's explosive conflagration": 'ranged', "cupid's arrow": 'ranged', 'biting arrow': 'ranged'
  };

  /** Damage a5e records for a hit that comes later, not with this one: left unticked. */
  static #LATER = /\b(move[sd]?|moving|willingly|if the target|start of|end of|ongoing|later|again|leaps?|secondary)\b/i;

  static #plain(html) {
    return String(html ?? '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&rsquo;|’/g, "'").replace(/\s+/g, ' ').trim();
  }

  /** The spell's text: its own, or its compendium entry's when the copy has none. */
  static #text(item) {
    const own = this.#plain(typeof item?.system?.description === 'string' ? item.system.description : item?.system?.description?.value);
    if (own) return own;
    const source = item?._stats?.compendiumSource ?? item?.flags?.core?.sourceId;
    if (!source) return '';
    try {
      const entry = fromUuidSync(source);
      const d = entry?.system?.description;
      return this.#plain(typeof d === 'string' ? d : d?.value);
    } catch { return ''; }
  }

  /** 'melee', 'ranged' or 'any' - or null for a spell not cast with a weapon attack. */
  static kindOf(item) {
    if (item?.type !== 'spell') return null;
    const text = this.#text(item);
    for (const re of this.#PATTERNS) {
      const m = re.exec(text);
      if (!m) continue;
      if (m[1]) return m[1].toLowerCase();
      // "make an attack with your melee weapon": the kind is further on in the sentence
      const end = text.indexOf('.', m.index);
      const sentence = text.slice(m.index, end < 0 ? undefined : end);
      return (sentence.match(/\b(melee|ranged)\b/i)?.[1] ?? 'any').toLowerCase();
    }
    return this.#KNOWN[String(item.name ?? '').toLowerCase().replace(/’/g, "'").trim()] ?? null;
  }

  /** The character's weapon attacks of a kind - [{ item, actionId, label, attackType }], the equipped first. */
  static attacksFor(actor, kind) {
    const want = kind === 'ranged' ? ['rangedWeaponAttack']
      : kind === 'melee' ? ['meleeWeaponAttack'] : ['meleeWeaponAttack', 'rangedWeaponAttack'];
    const out = [];
    for (const item of actor?.items ?? []) {
      if (item.type !== 'object' || item.system?.objectType !== 'weapon') continue;
      for (const [actionId, action] of Object.entries(item.system?.actions ?? {})) {
        const attack = Object.values(action?.rolls ?? {}).find(r => r?.type === 'attack' && want.includes(r.attackType));
        if (!attack) continue;
        out.push({
          item, actionId, attackType: attack.attackType,
          label: action?.name && action.name !== item.name ? action.name : item.name,
          equipped: Number(item.system?.equippedState ?? 0)
        });
      }
    }
    return out.sort((a, b) => (b.equipped - a.equipped) || a.label.localeCompare(b.label));
  }

  /** The spell's action to use: the one asked for, else the first that rolls damage, else the first. */
  static #spellAction(spell, actionId) {
    if (actionId && spell.actions?.get?.(actionId)) return actionId;
    const entries = Object.entries(spell.system?.actions ?? {});
    return (entries.find(([, a]) => Object.values(a?.rolls ?? {}).some(r => r?.type === 'damage')) ?? entries[0])?.[0] ?? null;
  }

  /** Does the spell's damage go into the weapon's roll, or roll on a card of its own? */
  static #merges(spell, actionId) {
    if (Number(spell.system?.level ?? 0) > 0) return false;
    const action = spell.system?.actions?.[actionId];
    if (!action) return true;
    if (Object.keys(action.prompts ?? {}).length) return false;
    return !Object.values(action.rolls ?? {}).some(r => r?.type === 'healing');
  }

  /** A roll's formula as written: its die and its formula. */
  static #baseFormula(roll) {
    let formula = '';
    try { formula = roll.getFormula?.() ?? ''; } catch { formula = ''; }
    if (!formula) {
      const die = roll.die ?? {};
      const dice = die.number && die.denom ? `${die.number}d${die.denom}` : '';
      formula = [dice, roll.formula ?? ''].filter(Boolean).join(' + ');
    }
    return formula;
  }

  /**
   * A cantrip damage roll's formula at the character's level - a5e's own
   * scaling (RollPreparationManager, mode "cantrip"), with the actor's roll
   * data for the spell filled in, since the weapon's roll knows nothing of
   * the spell (@spellcasting.mod is the spell book's ability).
   */
  static #formulaOf(actor, spell, roll) {
    let formula = this.#baseFormula(roll);
    const level = Number(actor?.levels?.character ?? actor?.system?.details?.level ?? actor?.system?.attributes?.casterLevel ?? 0) || 0;
    if (roll.scaling?.mode === 'cantrip' && level >= 5) {
      try {
        const die = roll.die ?? {}, cfg = roll.scaling.config ?? {};
        const step = { number: Number(cfg.number) || 0, faces: Number(cfg.denom) || 0, cap: cfg.cap };
        const tier = level >= 17 ? 3 : level >= 11 ? 2 : 1;
        const sides = CONFIG.A5E.DICE_SIDES, map = CONFIG.A5E.DICE_SIDES_MAP;
        const at = sides.indexOf(die.denom || 0);
        const term = new foundry.dice.terms.Die({
          number: (die.number ?? 0) + tier * step.number,
          faces: map[Math.clamp(tier * step.faces + at, 1, step.cap ?? 5)] ?? 0,
          modifiers: [...(die.modifiers ?? [])]
        }).formula;
        const parts = [];
        // a5e keeps a die of none ("0d4") in its formula; it rolls nothing, so it is left out
        if (!/^0d/.test(term)) parts.push(term);
        if ((roll.formula ?? '').length) parts.push(roll.formula);
        const extra = new Roll(cfg.value || '');
        if (extra.terms?.length) parts.push(extra.alter(tier, 0, { multiplyNumeric: true }).formula);
        const scaled = parts.join('+');
        if (scaled && Roll.validate(scaled)) formula = scaled;
      } catch (err) { AM.log(2, `${spell.name}: its damage could not be scaled -`, err); }
    }
    try { formula = Roll.replaceFormulaData(formula, actor.getRollData?.(spell) ?? spell.getRollData?.() ?? {}, { missing: '0' }); }
    catch { /* as it is */ }
    return formula;
  }

  /**
   * Is this damage for later - "if the target willingly moves... 1d8 thunder"?
   * Said by the roll's name, or by the sentence of the text its dice stand in.
   */
  static #isLater(name, base, text) {
    if (this.#LATER.test(name ?? '')) return true;
    const dice = String(base ?? '').match(/\d+d\d+/g) ?? [];
    if (!dice.length || !text) return false;
    return text.split(/(?<=[.!?])\s+/).some(s => dice.some(d => s.includes(d)) && /\b(moves?|moved|moving|willingly)\b/i.test(s));
  }

  /** The spell's damage rolls a hit adds: [{ key, label, formula, damageType, later }] */
  static #spellDamage(actor, spell, actionId) {
    const out = [];
    const action = spell.actions?.get?.(actionId);
    const byType = action?.getRollsByType?.() ?? {};
    const rolls = (byType.damage ?? []).map(r => (Array.isArray(r) ? r[1] : r)).filter(Boolean);
    const raw = Object.values(spell.system?.actions?.[actionId]?.rolls ?? {}).filter(r => r?.type === 'damage');
    const text = this.#text(spell);
    (rolls.length ? rolls : raw).forEach((roll, i) => {
      const formula = this.#formulaOf(actor, spell, roll);
      if (!formula || /^\s*0\s*$/.test(formula) || !Roll.validate(formula)) return;
      const name = roll.label || roll.name || '';
      const type = CONFIG.A5E?.damageTypes?.[roll.damageType] ? game.i18n.localize(CONFIG.A5E.damageTypes[roll.damageType]) : (roll.damageType ?? '');
      out.push({
        key: `spell:${i}`, label: [spell.name, name].filter(Boolean).join(': '), formula,
        damageType: roll.damageType ?? '', typeLabel: type, later: this.#isLater(name, this.#baseFormula(roll), text)
      });
    });
    return out;
  }

  /** The character's damage bonuses a5e's attack window offers this weapon: [[id, bonus]] */
  static #bonusesFor(actor, { item, actionId, attackType }) {
    const bm = actor?.BonusesManager;
    try {
      const rolls = item.actions?.get?.(actionId)?.getRollsByType?.() ?? {};
      const list = bm?._prepareGlobalDamageBonuses?.(item, rolls);
      if (Array.isArray(list)) return list;
    } catch { /* read below */ }
    return Object.entries(actor?.system?.bonuses?.damage ?? {}).filter(([, b]) => {
      const types = b?.context?.attackTypes ?? [];
      return b?.formula && (!types.length || types.includes(attackType));
    });
  }

  /**
   * Can the spell be cast at its own level without asking - a slot of that
   * level left, or spell points? a5e's no-window cast takes the slot of the
   * spell's level; with none left, its own window shows what there is and
   * lets the player decide.
   */
  static #canPay(actor, spell, actionId) {
    const level = Number(spell.system?.level ?? 0) || 0;
    if (!level) return true;
    const consumers = Object.values(spell.system?.actions?.[actionId]?.consumers ?? {});
    if (!consumers.some(c => c?.type === 'spell')) return true;
    const res = actor.system?.spellResources ?? {};
    if (Number(res.slots?.[level]?.current) > 0) return true;
    return Number(res.points?.current) > 0;
  }

  /**
   * Cast a weapon spell from the sheet.
   * @returns {Promise<boolean>} whether anything was rolled
   */
  static async cast(actor, spell, spellActionId = null, { skipRollDialog = false } = {}) {
    const kind = this.kindOf(spell);
    const actionId = this.#spellAction(spell, spellActionId);
    const alone = async () => {
      await spell.activate(actionId, { skipRollDialog: this.#canPay(actor, spell, actionId) });
      return true;
    };
    const attacks = this.attacksFor(actor, kind);
    if (!attacks.length) {
      ui.notifications.info(`${AM.NAME}: ${actor.name} has no ${kind === 'any' ? '' : `${kind} `}weapon for ${spell.name} - the spell is rolled on its own.`);
      return alone();
    }
    const merge = this.#merges(spell, actionId);
    const spellDamage = merge ? this.#spellDamage(actor, spell, actionId) : [];
    const bonuses = this.#bonusesFor(actor, attacks[0]);

    let choice;
    if (skipRollDialog) {
      choice = {
        attack: attacks[0], rollMode: CONFIG.A5E.ROLL_MODE.NORMAL,
        spell: spellDamage.filter(d => !d.later),
        bonuses: new Set(bonuses.filter(([, b]) => b?.default ?? true).map(([id]) => id))
      };
    } else {
      choice = await this.#ask(spell, kind, attacks, spellDamage, bonuses, merge);
      if (!choice) return false;
    }
    if (!choice.attack) return alone();

    if (merge) await spell.shareItemDescription?.(null, {});
    const rolled = await this.#rollWeapon(actor, choice, bonuses);
    if (!rolled) return false;
    if (!merge) await spell.activate(actionId, { skipRollDialog: this.#canPay(actor, spell, actionId) });
    return true;
  }

  /** The one window. Resolves to the choices - attack null for the spell alone - or null. */
  static async #ask(spell, kind, attacks, spellDamage, bonuses, merge) {
    const esc = (s) => foundry.utils.escapeHTML(String(s ?? ''));
    const MODES = CONFIG.A5E.ROLL_MODE;
    const weaponPills = [
      ...attacks.map((a, i) => `<label class="am-filter-pill${i === 0 ? ' am-pill-active' : ''}"><input type="radio" name="weapon" value="${i}"${i === 0 ? ' checked' : ''}>${esc(a.label)}</label>`),
      `<label class="am-filter-pill am-wspell-alone"><input type="radio" name="weapon" value="none">No weapon - the spell alone</label>`
    ].join('');
    const modePills = [['normal', MODES.NORMAL, 'Normal'], ['advantage', MODES.ADVANTAGE, 'Advantage'], ['disadvantage', MODES.DISADVANTAGE, 'Disadvantage']]
      .map(([, value, label], i) => `<label class="am-filter-pill${i === 0 ? ' am-pill-active' : ''}"><input type="radio" name="mode" value="${value}"${i === 0 ? ' checked' : ''}>${label}</label>`).join('');
    const damageRows = [
      ...spellDamage.map(d => `<label class="am-wspell-dmg"><input type="checkbox" name="spell" value="${esc(d.key)}"${d.later ? '' : ' checked'}>
        <span>${esc(d.label)}</span><span class="am-hint">${esc(d.formula)}${d.typeLabel ? ` ${esc(d.typeLabel)}` : ''}${d.later ? ' - comes later, not with the hit' : ''}</span></label>`),
      ...bonuses.map(([id, b]) => `<label class="am-wspell-dmg"><input type="checkbox" name="bonus" value="${esc(id)}"${(b?.default ?? true) ? ' checked' : ''}>
        <span>${esc(b?.label || b?.defaultLabel || 'Damage bonus')}</span><span class="am-hint">${esc(b?.formula ?? '')}</span></label>`)
    ].join('');
    const what = kind === 'any' ? 'a weapon' : `a ${kind} weapon`;
    const how = merge
      ? `The weapon's attack and damage roll together with the spell's damage, in one card.`
      : `The weapon's attack and damage roll first, then the spell, at its own level.`;

    const content = `<div class="am-wspell">
      <p class="am-hint">${esc(spell.name)} is cast with ${what} attack. ${how} Without a weapon, the spell rolls on its own.</p>
      <h4>Weapon</h4><div class="am-filter-pills" data-group="weapon">${weaponPills}</div>
      <div class="am-wspell-with">
        <h4>Roll</h4><div class="am-filter-pills" data-group="mode">${modePills}</div>
        ${damageRows ? `<h4>On a hit</h4><div class="am-wspell-dmgs">${damageRows}</div>` : ''}
      </div>
    </div>`;

    const result = await foundry.applications.api.DialogV2.wait({
      window: { title: spell.name, icon: kind === 'ranged' ? 'fa-solid fa-bow-arrow' : 'fa-solid fa-sword' },
      position: { width: 440 },
      content,
      buttons: [
        { action: 'roll', label: 'Roll', icon: 'fa-solid fa-dice-d20', default: true,
          callback: (_event, button) => {
            const form = button.form;
            const value = (name) => form.querySelector(`input[name="${name}"]:checked`)?.value;
            const all = (name) => [...form.querySelectorAll(`input[name="${name}"]:checked`)].map(i => i.value);
            const weapon = value('weapon') ?? '0';
            const spellKeys = new Set(all('spell'));
            return {
              attack: weapon === 'none' ? null : (attacks[Number(weapon)] ?? attacks[0]),
              rollMode: Number(value('mode') ?? MODES.NORMAL),
              spell: spellDamage.filter(d => spellKeys.has(d.key)),
              bonuses: new Set(all('bonus'))
            };
          } }
      ],
      render: (_event, dialog) => {
        const root = dialog.element ?? dialog;
        const withWeapon = root.querySelector('.am-wspell-with');
        root.querySelectorAll('.am-wspell .am-filter-pills').forEach(group => group.addEventListener('change', () => {
          group.querySelectorAll('label').forEach(l => l.classList.toggle('am-pill-active', !!l.querySelector('input:checked')));
          // Without a weapon there is no attack to set up
          if (group.dataset.group === 'weapon' && withWeapon) {
            withWeapon.hidden = group.querySelector('input:checked')?.value === 'none';
          }
        }));
      },
      rejectClose: false
    }).catch(() => null);
    return result && typeof result === 'object' ? result : null;
  }

  /**
   * Roll the weapon without a5e's window: the spell's damage put among the
   * character's damage bonuses for this one roll, and the bonuses ticked or
   * not as asked - a5e reads both as the roll is set up, at once, so they are
   * put back right after. Resolves once the weapon's card is in the chat.
   */
  static async #rollWeapon(actor, { attack, rollMode, spell, bonuses: chosen }, offered) {
    const { item, actionId } = attack;
    const live = actor.system?.bonuses?.damage;
    const added = [], defaults = new Map();
    if (live && typeof live === 'object') {
      spell.forEach((d, i) => {
        const id = `amWeaponSpell${i}`.padEnd(16, '0').slice(0, 16);
        /* No attack type in its context: a5e reads the roll's attack type
           wrongly there (rolls grouped as objects, read as [id, roll] pairs)
           and takes every attack for a melee one, so a ranged-only bonus
           never applies. This one is for this roll alone anyway. */
        live[id] = {
          label: d.label, formula: d.formula, damageType: d.damageType, img: '', default: true,
          context: { attackTypes: [], damageTypes: [], spellLevels: [], isCritBonus: false }
        };
        added.push(id);
      });
      for (const [id] of offered) {
        if (!live[id]) continue;
        defaults.set(id, live[id].default);
        live[id].default = chosen.has(id);
      }
    }
    const card = new Promise((resolve) => {
      let done = false;
      const finish = (ok) => { if (done) return; done = true; Hooks.off('createChatMessage', hook); clearTimeout(limit); resolve(ok); };
      const hook = (message) => { if (message?.system?.itemId === item.uuid) finish(true); };
      Hooks.on('createChatMessage', hook);
      const limit = setTimeout(() => finish(false), 60 * 1000);
    });
    try {
      item.activate(actionId, { skipRollDialog: true, rollMode });
    } catch (err) {
      AM.log(1, `${item.name} could not be rolled:`, err);
    } finally {
      if (live) {
        for (const id of added) delete live[id];
        for (const [id, value] of defaults) if (live[id]) live[id].default = value;
      }
    }
    return card;
  }
}
