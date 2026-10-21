import { AM } from '../am.js';
import { ConditionSource } from './conditionSource.js';

/**
 * Conditions a5e describes and leaves to the table, run for it. Asked for on
 * 2026-10-20 - four of the proposals, "and the conditions of spells when you
 * fail the save":
 *
 * - Blinded (setting autoBlindVision). a5e names the condition "blinded";
 *   Foundry's vision code looks for CONFIG.specialStatusEffects.BLIND, which is
 *   "blind" - so a blinded token went on seeing. Pointed at a5e's condition: a
 *   blinded token sees nothing, but what senses need no sight (blindsight,
 *   tremorsense) still work.
 * - Concentration (autoConcentration).
 *   - It ends when the caster is incapacitated - paralyzed, petrified,
 *     stunned, unconscious, or incapacitated itself - or dies, as a5e's own
 *     description of concentration has it.
 *   - a5e posts a concentration card when a concentrating creature's hit
 *     points drop; it also comes now when temporary hit points take it all,
 *     and its DC counts them.
 *   - The card's button rolls for the concentrating creature - a5e's rolled
 *     for the selected token, or warned when none was. A failed roll ends
 *     concentration.
 *   - When concentration ends, what the spell put on anyone ends with it.
 * - Encumbered (autoEncumbrance). On when what a character carries outweighs
 *   its capacity, by a5e's own sums (its weight track); off when it no longer
 *   does. Only the one this put on is taken off.
 * - Saves (autoSaveEffects).
 *   - A save rolled from a card's prompt that fails puts the card's effects on
 *     the creature that failed: Hold Person's Held, and its paralysis.
 *   - An effect whose spell or feature lets the creature repeat the save at
 *     the end (or the start) of each of its turns is offered that save then,
 *     and a success ends it.
 * - Rounds on a status (autoStatusRounds; asked 2026-10-21). The number put on
 *   a status - hover it in the token HUD or on the sheet and press 1-9, or 0
 *   for 10 - is the rounds it lasts, and in combat it counts itself down; at 0
 *   the status ends. See setRounds.
 *
 * Who does the work. What changes another's actor - a target's effects, a
 * caster's concentration - is done by the active GM's client. The client that
 * rolled marks its roll with what it was for. With no GM present, the client
 * that rolled does what it may.
 */
export class ConditionAutomation {

  static INCAPACITATING = new Set(['incapacitated', 'paralyzed', 'petrified', 'stunned', 'unconscious', 'dead']);
  static ABILITIES = { strength: 'str', dexterity: 'dex', constitution: 'con', intelligence: 'int', wisdom: 'wis', charisma: 'cha' };

  /** `${actorUuid}|${ability}` -> what the next save of that ability is for */
  static #pending = new Map();
  static PENDING_MS = 3 * 60 * 1000;

  static on(key) {
    try { return game.settings.get(AM.ID, key) !== false; } catch { return true; }
  }

  static #esc(s) {
    const str = String(s ?? '');
    return foundry.utils?.escapeHTML?.(str) ?? str.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /** Whether this client acts on something everyone's client heard about. */
  static #mine(userId) {
    if (game.users.activeGM) return game.user.isActiveGM;
    return userId === game.user.id;
  }

  /* ── install ─────────────────────────────────────────────── */

  /** At init: a5e has set its document classes; the world is not prepared yet. */
  static install() {
    this.#wrapActor();
    Hooks.once('setup', () => this.#blindVision());
    Hooks.on('preCreateChatMessage', (msg) => this.#markSave(msg));
    Hooks.on('createChatMessage', (msg) => this.#onSaveRolled(msg));
    Hooks.on('createActiveEffect', (effect, options, userId) => this.#onEffectOn(effect, userId));
    Hooks.on('updateActiveEffect', (effect, changes, options, userId) => {
      if (changes.disabled === false) this.#onEffectOn(effect, userId);
    });
    Hooks.on('deleteActiveEffect', (effect, options, userId) => this.#onEffectOff(effect, userId));
    Hooks.on('combatTurnChange', (combat, previous, current) => {
      this.#onTurn(combat, previous, current);
      this.#countRounds(combat);
    });
    for (const hook of ['createItem', 'updateItem', 'deleteItem']) {
      Hooks.on(hook, (item, ...rest) => this.#encumbranceSoon(item?.parent, rest.at(-1)));
    }
    Hooks.on('updateActor', (actor, changes, options, userId) => {
      if (foundry.utils.hasProperty(changes, 'system.abilities') || foundry.utils.hasProperty(changes, 'system.traits')
          || foundry.utils.hasProperty(changes, 'system.currency') || foundry.utils.hasProperty(changes, 'system.supply')
          || foundry.utils.hasProperty(changes, 'flags.a5e')) this.#encumbranceSoon(actor, userId);
    });
    document.addEventListener('click', (event) => this.#onClick(event), true);
  }

  /* ── 1. blinded ──────────────────────────────────────────── */

  static #blindVision() {
    if (!this.on('autoBlindVision')) return;
    if (CONFIG.A5E?.conditions?.blinded && CONFIG.specialStatusEffects) CONFIG.specialStatusEffects.BLIND = 'blinded';
  }

  /* ── wrapping a5e's actor ────────────────────────────────── */

  static #wrapActor() {
    const proto = CONFIG.Actor?.documentClass?.prototype;
    if (!proto || proto.rollSavingThrow?.amConditions) return;

    /* A save that was cancelled in its dialog is no longer pending: the next
       save of that ability, for something else, must not be read as this one. */
    const roll = proto.rollSavingThrow;
    if (roll) {
      const wrapped = async function (ability, options = {}) {
        const result = await roll.call(this, ability, options);
        if (result === null || result === undefined) ConditionAutomation.#pending.delete(`${this.uuid}|${ability}`);
        return result;
      };
      wrapped.amConditions = true;
      proto.rollSavingThrow = wrapped;
    }

    /* The damage a concentration check is for: a5e counts only what hit points
       lost - nothing at all when temporary hit points took it - and asks for
       no check then. The whole of it, temporary hit points included. */
    const pre = proto._preUpdateCreature;
    const card = proto.createConcentrationCheckCard;
    if (pre && card) {
      proto._preUpdateCreature = async function (changes, options, user) {
        if (!ConditionAutomation.on('autoConcentration')) return pre.call(this, changes, options, user);
        const hp = this.system?.attributes?.hp ?? {};
        const value = Number(foundry.utils.getProperty(changes, 'system.attributes.hp.value') ?? hp.value) || 0;
        const temp = Number(foundry.utils.getProperty(changes, 'system.attributes.hp.temp') ?? hp.temp) || 0;
        const taken = (Number(hp.value) || 0) + (Number(hp.temp) || 0) - value - temp;
        this._amDamage = taken > 0 ? taken : 0;
        this._amCardPosted = false;
        try {
          return await pre.call(this, changes, options, user);
        } finally {
          if (this._amDamage > 0 && !this._amCardPosted && this.statuses?.has('concentration')) card.call(this, this._amDamage);
          this._amDamage = 0;
        }
      };
      proto.createConcentrationCheckCard = function (damage) {
        this._amCardPosted = true;
        return card.call(this, Math.max(Number(damage) || 0, this._amDamage || 0));
      };
    }
  }

  /* ── clicks ──────────────────────────────────────────────── */

  static #onClick(event) {
    const target = event.target;
    if (!(target instanceof Element)) return;

    /* A concentration card's roll: for the creature concentrating, as a
       concentration save, with its DC remembered. */
    const enricher = target.closest('.a5e-enricher--roll');
    if (enricher && this.on('autoConcentration') && enricher.dataset.enricherType === 'save' && enricher.dataset.type === 'concentration') {
      const message = game.messages.get(enricher.closest('[data-message-id]')?.dataset.messageId);
      const actor = message ? ChatMessage.getSpeakerActor(message.speaker) : null;
      if (actor?.isOwner) {
        event.stopPropagation();
        event.preventDefault();
        const dc = Number(enricher.dataset.dc) || null;
        this.expectSave(actor, 'con', { kind: 'concentration', dc });
        actor.rollSavingThrow('con', { saveType: 'concentration', ...(dc ? { dc } : {}) });
        return;
      }
    }

    /* A card's saving throw prompt: a5e rolls it for the selected tokens. What
       it was - DC, and the effects that follow a failure - is remembered for
       each of them; their rolls carry it to the GM. */
    const prompt = target.closest('button.save-prompt');
    if (prompt && this.on('autoSaveEffects')) {
      const message = game.messages.get(prompt.closest('[data-message-id]')?.dataset.messageId);
      const save = message ? this.#promptOf(message, prompt) : null;
      if (save) {
        for (const token of canvas?.tokens?.controlled ?? []) {
          const actor = token.document?.actor;
          if (actor) this.expectSave(actor, save.ability, { kind: 'prompt', ...save, messageId: message.id });
        }
      }
      return;
    }

    /* The button of an end-of-turn save prompt */
    const repeat = target.closest('[data-am-save-ends]');
    if (repeat) {
      event.preventDefault();
      const effect = fromUuidSync(repeat.dataset.amSaveEnds);
      const actor = effect?.parent?.documentName === 'Actor' ? effect.parent : null;
      if (!effect || !actor) { ui.notifications.info(`${AM.NAME}: that effect has already ended.`); return; }
      if (!actor.isOwner) { ui.notifications.warn(`${AM.NAME}: ${actor.name} is not yours to roll for.`); return; }
      const ability = repeat.dataset.ability, dc = Number(repeat.dataset.dc) || null;
      this.expectSave(actor, ability, { kind: 'saveEnds', effectUuid: effect.uuid, dc, effectName: effect.name });
      actor.rollSavingThrow(ability, dc ? { dc } : {});
    }
  }

  /** The saving throw a card's prompt button stands for, from the card's own data. */
  static #promptOf(message, button) {
    if (message.type !== 'item') return null;
    const title = button.querySelector('.title')?.textContent ?? button.textContent ?? '';
    const saves = (message.system?.prompts ?? []).filter(p => p?.type === 'savingThrow' && p.ability);
    if (!saves.length || button.querySelector('.icon-wrapper--effect') || /apply effect/i.test(button.textContent ?? '')) return null;
    const label = (k) => String(game.i18n.localize(CONFIG.A5E?.abilities?.[k] ?? k));
    const prompt = saves.find(p => title.includes(label(p.ability))) ?? (saves.length === 1 ? saves[0] : null);
    if (!prompt) return null;
    const dc = Number(prompt.dc ?? title.match(/\(DC\s*(\d+)\)/i)?.[1]) || null;
    if (!dc) return null;
    return {
      ability: prompt.ability,
      dc,
      effects: [...(message.system?.effects ?? [])],
      itemUuid: message.system?.itemId ?? null,
      onSave: prompt.onSave ?? ''
    };
  }

  /** What the next save of this ability by this actor is for. */
  static expectSave(actor, ability, context) {
    const now = Date.now();
    for (const [key, ctx] of this.#pending) if (now - ctx.at > this.PENDING_MS) this.#pending.delete(key);
    this.#pending.set(`${actor.uuid}|${ability}`, { ...context, ability, at: now });
  }

  /* ── marking a roll, reading it ──────────────────────────── */

  /**
   * The ability a save's message is for. a5e's message does not say it: its
   * label names it ("Wisdom Saving Throw"), a concentration save's only says
   * "Concentration Check". A label read no way: the one save this actor has
   * waiting.
   */
  static #abilityOf(message, actorUuid) {
    const data = message.system?.rollData?.[0] ?? {};
    if (data.saveType === 'death') return null;
    if (data.ability) return data.ability;
    if (data.saveType === 'concentration') return 'con';
    const label = String(data.label ?? '');
    const names = Object.entries(CONFIG.A5E?.abilities ?? {}).map(([key, name]) => [key, game.i18n.localize(name)]);
    const exact = names.find(([, name]) => label === game.i18n.format('A5E.rollLabels.prompts.savingThrow', { ability: name }));
    if (exact) return exact[0];
    const named = names.filter(([, name]) => name && label.includes(name));
    if (named.length === 1) return named[0][0];
    const waiting = [...this.#pending.keys()].filter(k => k.startsWith(`${actorUuid}|`));
    return waiting.length === 1 ? waiting[0].slice(actorUuid.length + 1) : null;
  }

  /** On the rolling client: what a save is for goes with its message. */
  static #markSave(message) {
    if (message.system?.rollType !== 'savingThrow') return;
    const actorUuid = message.system?.actorId;
    if (!actorUuid) return;
    const ability = this.#abilityOf(message, actorUuid);
    if (!ability) return;
    const key = `${actorUuid}|${ability}`;
    const ctx = this.#pending.get(key);
    if (!ctx || Date.now() - ctx.at > this.PENDING_MS) return;
    this.#pending.delete(key);
    const { at, ...save } = ctx;
    message.updateSource({ [`flags.${AM.ID}.save`]: save });
  }

  /** On the GM's client: a marked save, against its DC. */
  static async #onSaveRolled(message) {
    const save = message.flags?.[AM.ID]?.save;
    if (!save || !this.#mine(message.author?.id)) return;
    const total = Number(message.rolls?.[0]?.total);
    if (!Number.isFinite(total) || !save.dc) return;
    const actor = await fromUuid(message.system?.actorId).catch(() => null);
    if (!actor) return;
    const passed = total >= save.dc;
    try {
      if (save.kind === 'concentration') {
        if (!passed && actor.statuses?.has('concentration')) {
          await actor.toggleStatusEffect('concentration', { active: false });
          await this.#note(actor, `${this.#esc(actor.name)} loses concentration (${total} against DC ${save.dc}).`);
        }
      } else if (save.kind === 'prompt') {
        if (!passed && this.on('autoSaveEffects')) await this.#applyEffects(actor, save, total);
      } else if (save.kind === 'saveEnds') {
        if (passed) {
          const effect = await fromUuid(save.effectUuid).catch(() => null);
          if (effect) {
            await effect.delete();
            await this.#note(actor, `${this.#esc(actor.name)} shakes off ${this.#esc(effect.name)} (${total} against DC ${save.dc}).`);
          }
        }
      }
    } catch (err) {
      AM.log(1, 'Condition automation failed on a save:', err);
    }
  }

  /** A failed save's effects on the creature that failed it. */
  static async #applyEffects(actor, save, total) {
    const applied = [];
    for (const uuid of save.effects ?? []) {
      const effect = await fromUuid(uuid).catch(() => null);
      if (!effect || effect.system?.applyToSelf) continue;
      /* a5e's own transfer: the effect as the item holds it, its origin the
         item - and one already there is turned back on, not doubled. */
      const already = actor.effects.find(e => effect.equals?.(e));
      if (already) { if (already.disabled) await already.update({ disabled: false }); applied.push(effect.name); continue; }
      const data = foundry.utils.deepClone(effect.toObject());
      delete data._id;
      data.origin = effect.parent?.uuid ?? data.origin;
      await actor.createEmbeddedDocuments('ActiveEffect', [data]);
      applied.push(effect.name);
    }
    if (applied.length) {
      const ability = game.i18n.localize(CONFIG.A5E?.abilities?.[save.ability] ?? save.ability);
      await this.#note(actor, `${this.#esc(actor.name)} fails the ${this.#esc(ability)} save (${total} against DC ${save.dc}): ${applied.map(n => this.#esc(n)).join(', ')}.`);
    }
  }

  static async #note(actor, html) {
    return ChatMessage.create({
      content: `<p class="am-condition-note">${html}</p>`,
      speaker: ChatMessage.getSpeaker({ actor }),
      style: CONST.CHAT_MESSAGE_STYLES.OTHER
    });
  }

  /* ── concentration and effects coming and going ──────────── */

  static #actorOf(effect) {
    const parent = effect?.parent;
    if (parent?.documentName === 'Actor') return parent;
    if (parent?.documentName === 'Item' && parent.parent?.documentName === 'Actor') return parent.parent;
    return null;
  }

  /** Incapacitated or dead: concentration ends. */
  static async #onEffectOn(effect, userId) {
    if (!this.on('autoConcentration') || !this.#mine(userId)) return;
    const statuses = [...(effect?.statuses ?? [])];
    if (!statuses.some(s => this.INCAPACITATING.has(s))) return;
    const actor = this.#actorOf(effect);
    if (!actor?.statuses?.has('concentration')) return;
    try {
      await actor.toggleStatusEffect('concentration', { active: false });
      const why = statuses.find(s => this.INCAPACITATING.has(s));
      await this.#note(actor, `${this.#esc(actor.name)} loses concentration: ${this.#esc(game.i18n.localize(CONFIG.A5E?.conditions?.[why] ?? why))}.`);
    } catch (err) {
      AM.log(1, 'Could not end concentration:', err);
    }
  }

  /**
   * Concentration ended: the spell's effects end with it - on every creature
   * it reached, the caster included. a5e gives a concentration its spell as
   * origin, and every effect it transfers the same. Effects only just made are
   * spared: casting the spell again ends the old concentration a moment after
   * the new cast has put its own effects on.
   */
  static async #onEffectOff(effect, userId) {
    if (!effect?.statuses?.has?.('concentration') || !effect.origin) return;
    if (!this.on('autoConcentration') || !this.#mine(userId)) return;
    const origin = effect.origin;
    const cutoff = Date.now() - 1500;
    const actors = new Set(game.actors);
    for (const scene of new Set([game.scenes?.active, canvas?.scene].filter(Boolean))) {
      for (const token of scene.tokens) if (token.actor && !token.actorLink) actors.add(token.actor);
    }
    let ended = 0;
    for (const actor of actors) {
      const gone = actor.effects.filter(e => e.origin === origin && !e.statuses?.has('concentration')
        && (e._stats?.createdTime ?? 0) < cutoff).map(e => e.id);
      if (!gone.length) continue;
      try { await actor.deleteEmbeddedDocuments('ActiveEffect', gone); ended += gone.length; } catch (err) { AM.log(2, `Could not end ${origin} on ${actor.name}:`, err); }
    }
    if (ended) {
      const spell = fromUuidSync(origin);
      const caster = this.#actorOf(effect);
      await this.#note(caster ?? null, `${this.#esc(spell?.name ?? 'The spell')} ends: concentration is over (${ended} effect${ended === 1 ? '' : 's'} removed).`);
    }
  }

  /* ── saves at the end (or start) of a turn ───────────────── */

  /**
   * "At the end of each of its turns, the target can repeat the saving throw,
   * ending the spell on a success": the turn it comes at, and the ability when
   * the sentence names one. Only sentences that end something on a success -
   * Phantasmal Killer's "makes a Wisdom saving throw or takes 4d10" is a new
   * harm each turn, not a way out.
   */
  static repeatSave(html) {
    const text = String(html ?? '').replace(/@UUID\[[^\]]*\]\{([^}]*)\}/g, '$1').replace(/\[\[[^\]]*?label="([^"]*)"[^\]]*\]\]/g, '$1')
      .replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/[’‘]/g, "'").replace(/\s+/g, ' ');
    for (const sentence of text.split(/(?<=\.)\s+/)) {
      const turn = sentence.match(/\b(?:at the )?(end|start) of each of (?:its|their|your|the (?:target|creature)'?s?|the [a-z]+ creature'?s?) turns?\b/i);
      if (!turn) continue;
      const save = sentence.match(/\bsav(?:ing throw|e)\b/i);
      if (!save) continue;
      const after = sentence.slice(save.index);
      if (!/\b(ending|ends?\b|to end|on a success|returning)/i.test(after)) continue;
      const named = sentence.match(/\b(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma)\b/i)?.[1];
      return { timing: turn[1].toLowerCase(), ability: named ? this.ABILITIES[named.toLowerCase()] : null };
    }
    return null;
  }

  /** The save an effect's origin asks for, and its DC: from the item's last card. */
  static #saveFor(item) {
    const text = typeof item?.system?.description === 'string' ? item.system.description : '';
    const repeat = this.repeatSave(text);
    if (!repeat) return null;
    let ability = repeat.ability, dc = null;
    for (const message of [...game.messages].reverse()) {
      if (message.type !== 'item' || message.system?.itemId !== item.uuid) continue;
      const prompt = (message.system?.prompts ?? []).find(p => p?.type === 'savingThrow' && (!ability || p.ability === ability));
      if (!prompt) continue;
      ability ??= prompt.ability;
      dc = Number(prompt.dc) || null;
      break;
    }
    if (!ability) {
      const action = [...(item.actions?.values?.() ?? [])].find(a => Object.values(a?.prompts ?? {}).some(p => p?.type === 'savingThrow'));
      ability = Object.values(action?.prompts ?? {}).find(p => p?.type === 'savingThrow')?.ability ?? null;
    }
    return ability ? { ...repeat, ability, dc } : null;
  }

  static async #onTurn(combat, previous, current) {
    if (!this.on('autoSaveEffects') || !game.user.isActiveGM) return;
    const ended = previous?.combatantId ? combat.combatants.get(previous.combatantId) : null;
    const started = current?.combatantId ? combat.combatants.get(current.combatantId) : null;
    if (ended && ended !== started) await this.#offerSaves(ended.actor, 'end');
    if (started) await this.#offerSaves(started.actor, 'start');
  }

  static async #offerSaves(actor, timing) {
    if (!actor) return;
    for (const effect of actor.effects) {
      if (effect.disabled || !effect.origin) continue;
      const item = await fromUuid(effect.origin).catch(() => null);
      if (!item || item.documentName !== 'Item') continue;
      // put on by the creature's own item (a spell's effect on its caster): the repeat save is a target's
      if (item.parent === actor || item.parent?.uuid === actor.uuid) continue;
      const save = this.#saveFor(item);
      if (!save || save.timing !== timing) continue;
      const ability = game.i18n.localize(CONFIG.A5E?.abilities?.[save.ability] ?? save.ability);
      const dcText = save.dc ? ` DC ${save.dc}` : '';
      await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor }),
        style: CONST.CHAT_MESSAGE_STYLES.OTHER,
        content: `<div class="am-save-ends"><p>${this.#esc(actor.name)} can try to end <strong>${this.#esc(effect.name)}</strong>`
          + ` (${this.#esc(item.name)}): ${this.#esc(ability)} saving throw${dcText}.</p>`
          + `<button type="button" data-am-save-ends="${effect.uuid}" data-ability="${save.ability}" data-dc="${save.dc ?? ''}">`
          + `<i class="fa-solid fa-dice-d20"></i> ${this.#esc(ability)} save${dcText}</button></div>`
      });
    }
  }

  /* ── rounds on a status ──────────────────────────────────── */

  /** Conditions whose number is a level a5e keeps (fatigue and the like), not rounds. */
  static LEVELLED = new Set(['corruption', 'fatigue', 'exhaustion', 'inebriated', 'strife']);

  /**
   * The rounds a key pressed over a status asks for: 1-9 as typed, 0 for 10
   * (a minute). Null for any other key, a key held down - its repeat would
   * take off the count it just set - one with Ctrl, Alt or Meta (Alt+digit is
   * core's macro page), and one typed into a field.
   */
  static roundsFromKey(ev) {
    if (ev.repeat || ev.ctrlKey || ev.altKey || ev.metaKey) return null;
    const target = ev.target;
    if (target instanceof Element && (target.isContentEditable || target.closest('input, textarea, select'))) return null;
    if (!/^[0-9]$/.test(ev.key ?? '')) return null;
    return ev.key === '0' ? 10 : Number(ev.key);
  }

  /**
   * Put rounds on a status, or take them off (n empty).
   *
   * A round is the rules' round: from the moment the number is set to the
   * same point of the initiative order a round later - the start of the turn
   * of whoever's turn it was. Stunned for 1 round, set on the fighter's turn,
   * holds through everyone else's turn and ends as the fighter's next one
   * begins. Set outside combat, the count starts with the next combat the
   * actor is in. Nothing counts outside combat.
   *
   * On the actor: flags.a5e-mancer.durations.<status> is the rounds left - the
   * number the token HUD, the effects panel and the sheet show - and
   * durationStart.<status> where the count started, {n, combat, round,
   * combatant, turn}.
   */
  static async setRounds(actor, id, n) {
    if (!actor || !id) return;
    if (!n) return this.clearRounds(actor, [id]);
    await actor.update({
      [`flags.${AM.ID}.durations.${id}`]: n,
      [`flags.${AM.ID}.durationStart.${id}`]: this.#mark(this.#combatOf(actor), n)
    });
  }

  /**
   * Take the rounds off these statuses. Deleted by key: a flag object written
   * back without one keeps it, which is why a number never went away before
   * 2.92.0 - not with its status, not with its digit pressed again.
   */
  static async clearRounds(actor, ids) {
    const flags = actor?.flags?.[AM.ID] ?? {};
    const update = {};
    for (const id of ids) {
      if (flags.durations && id in flags.durations) update[`flags.${AM.ID}.durations.-=${id}`] = null;
      if (flags.durationStart && id in flags.durationStart) update[`flags.${AM.ID}.durationStart.-=${id}`] = null;
    }
    if (Object.keys(update).length) await actor.update(update, { amRounds: true });
  }

  /** Where a count starts: this point of the combat, or nowhere yet. */
  static #mark(combat, n) {
    if (!combat?.started) return { n, combat: null };
    return { n, combat: combat.id, round: combat.round, combatant: combat.combatant?.id ?? null, turn: combat.turn ?? 0 };
  }

  /** The started combat the actor is in, the active one first. */
  static #combatOf(actor) {
    const fights = (combat) => !!combat?.started
      && combat.combatants.some(c => c.actor && (c.actor === actor || c.actor.uuid === actor.uuid));
    const active = game.combats?.active;
    return fights(active) ? active : (game.combats?.find(fights) ?? null);
  }

  /** Rounds gone since the count started: one each time the order comes back to where it was. */
  static #roundsGone(start, combat) {
    const at = combat.turns.findIndex(t => t.id === start.combatant);
    const where = at >= 0 ? at : (Number(start.turn) || 0);
    return (combat.round - start.round) - ((combat.turn ?? 0) < where ? 1 : 0);
  }

  /**
   * At every turn of a combat, the rounds left on its combatants' statuses.
   * Worked out from where each count started, so a turn taken back gives the
   * round back. A number whose status has gone is taken off; one from another
   * combat, or set outside any, starts counting here from what it shows.
   */
  static async #countRounds(combat) {
    if (!this.on('autoStatusRounds') || !game.user.isActiveGM || !combat?.started) return;
    const seen = new Set();
    for (const combatant of combat.combatants) {
      const actor = combatant.actor;
      if (!actor || seen.has(actor.uuid)) continue;
      seen.add(actor.uuid);
      const flags = actor.flags?.[AM.ID] ?? {};
      const left = flags.durations ?? {};
      if (!Object.keys(left).length) continue;
      const starts = flags.durationStart ?? {};
      const update = {}, ended = [], gone = [];
      for (const [id, value] of Object.entries(left)) {
        if (this.LEVELLED.has(id)) continue;
        if (!ConditionSource.find(actor, id)) { gone.push(id); continue; }
        const shown = Number(value);
        if (!Number.isFinite(shown) || shown <= 0) continue;
        const start = starts[id];
        if (!start || start.combat !== combat.id) {
          update[`flags.${AM.ID}.durationStart.${id}`] = this.#mark(combat, shown);
          continue;
        }
        const now = Math.min(Number(start.n), Number(start.n) - this.#roundsGone(start, combat));
        if (now <= 0) ended.push(id);
        else if (now !== shown) update[`flags.${AM.ID}.durations.${id}`] = now;
      }
      try {
        if (Object.keys(update).length) await actor.update(update, { amRounds: true });
        for (const id of ended) await ConditionSource.clear(actor, id);
        if (ended.length || gone.length) await this.clearRounds(actor, [...ended, ...gone]);
        if (ended.length) {
          const names = ended.map(id => this.#esc(game.i18n.localize(CONFIG.statusEffects?.find(s => s.id === id)?.name ?? id)));
          await this.#note(actor, `${names.join(', ')} on ${this.#esc(actor.name)} ${ended.length === 1 ? 'ends' : 'end'}: the rounds are up.`);
        }
      } catch (err) {
        AM.log(1, `Could not count down the rounds on ${actor.name}:`, err);
      }
    }
  }

  /* ── encumbered ──────────────────────────────────────────── */

  static #encumbranceTimers = new Map();

  static #encumbranceSoon(actor, userId) {
    if (!actor || actor.documentName !== 'Actor' || actor.type !== 'character') return;
    if (userId !== game.user.id || !actor.isOwner || !this.on('autoEncumbrance')) return;
    clearTimeout(this.#encumbranceTimers.get(actor.uuid));
    this.#encumbranceTimers.set(actor.uuid, setTimeout(() => {
      this.#encumbranceTimers.delete(actor.uuid);
      this.encumbrance(actor).catch(err => AM.log(2, 'Encumbrance:', err));
    }, 250));
  }

  /** a5e's carrying capacity: the ability (Strength unless set), times size, times 15. */
  static capacity(actor) {
    const ability = actor.getFlag?.('a5e', 'carryCapacityAbility') || 'str';
    const score = Number(actor.system?.abilities?.[ability]?.value) || 0;
    const size = actor.system?.traits?.size || 'med';
    const mult = CONFIG.A5E?.carryCapacityMultiplier?.[size] ?? 1;
    return score * mult * (actor.flags?.a5e?.doubleCarryCapacity ? 2 : 1) * 15;
  }

  /** a5e's inventory weight, as its weight track sums it. */
  static carried(actor) {
    const S = CONFIG.A5E?.EQUIPPED_STATES ?? { EQUIPPED: 2, CARRIED: 1 };
    const items = [...actor.items];
    let total = 0;
    for (const item of items) {
      const containerId = item.system?.containerId;
      if (containerId) continue;   // inside a container, whether or not it is found: a5e counts the container
      if (![S.EQUIPPED, S.CARRIED].includes(item.system?.equippedState)) continue;
      const weight = parseFloat(item.weight ?? item.system?.weight ?? 0) || 0;
      const quantity = item.system?.quantity;
      total += quantity ? weight * quantity : weight;
    }
    const ability = actor.getFlag?.('a5e', 'carryCapacityAbility') ?? 'str';
    const score = Number(actor.system?.abilities?.[ability]?.value) || 0;
    const supply = 2 * Math.abs(Math.min(score - (actor.system?.supply ?? 0), 0));
    let coins = 0;
    try {
      if (actor.flags?.a5e?.trackCurrencyWeight ?? game.settings.get('a5e', 'currencyWeight')) {
        coins = Object.values(actor.system?.currency ?? {}).reduce((n, v) => n + (Number(v) || 0), 0) * 0.02;
      }
    } catch { /* no such setting */ }
    return total + supply + coins;
  }

  static async encumbrance(actor) {
    const status = CONFIG.statusEffects?.find(s => s.id === 'encumbered');
    if (!status) return;
    const over = this.carried(actor) > this.capacity(actor);
    const current = status._id ? actor.effects.get(status._id) : actor.effects.find(e => e.statuses?.has('encumbered'));
    if (over && !actor.statuses?.has('encumbered')) {
      await actor.toggleStatusEffect('encumbered', { active: true, updates: { [`flags.${AM.ID}.auto`]: true } });
    } else if (!over && current?.getFlag?.(AM.ID, 'auto')) {
      await current.delete();
    }
  }
}
