import { AM } from '../am.js';
import { SPELL_CONDITIONS } from '../data/spellConditions.js';

/**
 * The conditions a spell puts on, with the time its text gives them (asked for
 * 2026-11-15: "conditions should come from their spells, and their time come
 * off right").
 *
 * a5e gives a spell's condition only where the spell carries an effect with
 * that status; for about a hundred spells it carries none (data/spellConditions
 * says which, and when, and for how long). Three ways a condition comes:
 *
 * - The spell's save, rolled from its card, fails (or passes, for Slow's
 *   rattled): ConditionAutomation puts on the card's own effects, and this the
 *   conditions of the table for that outcome (forSave, give).
 * - The card's row of conditions: one button for each condition the spell
 *   gives - its table's and its own effects' - put on the creatures the user
 *   targets (or, with none targeted, selects). For what no save decides: a hit,
 *   a hit point total, a roll on a table, the caster's choice.
 * - A condition named in the card's text: a5e's link toggled the bare status
 *   on the selected tokens, with no time and no spell behind it. Inside a
 *   spell's card it does what the row's button does.
 *
 * What is put on is the condition itself (the status's own id, so the token
 * HUD takes it off with a click), its origin the spell - when concentration
 * ends, it ends; a save the spell allows at the end of a turn is offered - and
 * its time as v14 counts it: rounds from the caster's turn, or "until the end
 * of its next turn" bound to that creature's own turn.
 *
 * A creature the user does not own is the GM's to change: the request goes in
 * the chat note, flagged, and the active GM's client puts it on.
 */
export class SpellConditions {

  static FLAG = 'spellCondition';
  static ASK = 'putOn';

  static key(name) {
    return String(name ?? '').toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim();
  }

  /** The table's entry for a spell, or null */
  static of(item) {
    if (!item || item.documentName !== 'Item' || item.type !== 'spell') return null;
    return SPELL_CONDITIONS[this.key(item.name)] ?? null;
  }

  /** Whether a failed save puts the spell's own effects on the creature (not Holy Aura's blessing) */
  static ownEffectsCount(item) {
    return this.of(item)?.own !== false;
  }

  /** What an outcome of the spell's save puts on: [[status, lasts]] */
  static forSave(item, passed) {
    return (this.of(item)?.give ?? [])
      .filter(([, when]) => when === 'save' || when === (passed ? 'pass' : 'fail'))
      .map(([status, , lasts]) => [status, lasts]);
  }

  /** The time the table gives a status of this spell (undefined: it says nothing of it) */
  static lastsOf(item, status) {
    const entry = this.of(item);
    if (!entry) return undefined;
    if (entry.fix && status in entry.fix) return entry.fix[status];
    return entry.give?.find(([s]) => s === status)?.[2];
  }

  static #status(id) {
    return (CONFIG.statusEffects ?? []).find(s => s.id === id) ?? null;
  }

  static label(id) {
    const s = this.#status(id);
    return s ? game.i18n.localize(s.name ?? s.label ?? id) : id;
  }

  /* ── time ────────────────────────────────────────────────── */

  /** The spell's own duration, as the table writes times */
  static spellLasts(item) {
    for (const action of Object.values(item?.system?.actions ?? {})) {
      const value = Number(action?.duration?.value);
      const unit = String(action?.duration?.unit ?? '');
      if (!Number.isFinite(value) || value <= 0) continue;
      if (/^round/.test(unit)) return value;
      if (/^minute/.test(unit)) return `${value}m`;
      if (/^hour/.test(unit)) return `${value}h`;
      if (/^day/.test(unit)) return `${value}d`;
      if (/^turn/.test(unit)) return 'yours';
    }
    return null;
  }

  /**
   * The encounter running for these creatures. Not game.combat alone: that is
   * the encounter of the scene on view, and with none on view (no canvas) it
   * was null - the condition kept no turn of its caster, and core counted
   * "until the caster's next turn" from the creature's own.
   */
  /* Only one these creatures are in: an encounter elsewhere (another table's,
     one left running) gave its own rounds to their effects - Hold Person read
     7 rounds left the moment it was cast (the release run of 2.99.3). */
  static #combatFor(...actors) {
    const running = [game.combat, game.combats?.active, ...(game.combats ?? [])].filter(c => c?.started);
    return running.find(c => actors.some(a => a && c.getCombatantsByActor?.(a)?.length)) ?? null;
  }

  static #combatantOf(combat, actor) {
    if (!combat?.started || !actor) return null;
    return combat.getCombatantsByActor?.(actor)?.[0] ?? null;
  }

  /**
   * v14's duration and start for a condition that lasts `lasts`. Core ends an
   * effect at its expiry event on the turn of its start's combatant, once the
   * duration has run: the caster's turn for rounds and minutes, the creature's
   * own for "its next turn". "Until the end of its next turn" said on its own
   * turn is the turn after this one: a round, not a turn.
   * @returns {{duration: object, start: object}|null}  null: no time, it lasts until ended
   */
  static timing(lasts, item, target) {
    if (lasts === 'spell') lasts = this.spellLasts(item);
    if (lasts === null || lasts === undefined) return null;
    const Effect = CONFIG.ActiveEffect?.documentClass;
    const caster = item?.actor ?? null;
    const combat = this.#combatFor(caster, target);
    const start = (combat ? Effect?.getEffectStart?.(combat) : Effect?.getEffectStart?.()) ?? { time: game.time?.worldTime ?? 0 };
    const startOf = (who) => {
      const c = this.#combatantOf(combat, who);
      return { ...start, ...(c ? { combatant: c.id } : {}) };
    };
    const turnOf = (who, expiry) => {
      const c = this.#combatantOf(combat, who);
      const ownTurn = !!c && combat?.combatant?.id === c.id;
      const units = expiry === 'turnEnd' && ownTurn ? 'rounds' : 'turns';
      return { duration: { value: 1, units, expiry }, start: startOf(who) };
    };
    switch (lasts) {
      case 'next': return turnOf(target, 'turnEnd');
      case 'nextStart': return turnOf(target, 'turnStart');
      case 'yours': return turnOf(caster, 'turnStart');
      case 'yoursEnd': return turnOf(caster, 'turnEnd');
    }
    if (typeof lasts === 'number') return { duration: { value: lasts, units: 'rounds', expiry: 'turnStart' }, start: startOf(caster) };
    const m = /^(\d+)([mhd])$/.exec(String(lasts));
    if (m) {
      const seconds = Number(m[1]) * { m: 60, h: 3600, d: 86400 }[m[2]];
      return { duration: { value: seconds, units: 'seconds', expiry: 'turnStart' }, start: startOf(caster) };
    }
    return null;
  }

  /** "until the end of its next turn" - for notes and tooltips */
  static describe(lasts, item) {
    if (lasts === 'spell') lasts = this.spellLasts(item) ?? null;
    switch (lasts) {
      case 'next': return 'until the end of its next turn';
      case 'nextStart': return 'until the start of its next turn';
      case 'yours': return "until the start of the caster's next turn";
      case 'yoursEnd': return "until the end of the caster's next turn";
      case null: case undefined: return 'until it is ended';
    }
    if (typeof lasts === 'number') return `for ${lasts} round${lasts === 1 ? '' : 's'}`;
    const m = /^(\d+)([mhd])$/.exec(String(lasts));
    if (m) {
      const word = { m: 'minute', h: 'hour', d: 'day' }[m[2]];
      return `for ${m[1]} ${word}${m[1] === '1' ? '' : 's'}`;
    }
    return '';
  }

  /* ── putting on ──────────────────────────────────────────── */

  /**
   * The condition on a creature, from a spell. Nothing doubled: a creature
   * that has it already keeps what it has.
   * @returns {Promise<boolean>} whether it was put on
   */
  static async give(target, item, status, lasts) {
    if (!target || !this.#status(status)) return false;
    if (target.statuses?.has?.(status)) return false;
    const Effect = CONFIG.ActiveEffect.documentClass;
    const made = await Effect.fromStatusEffect(status);
    const data = made.toObject();
    data.name = item?.name ? `${data.name} (${item.name})` : data.name;
    data.origin = item?.uuid ?? null;
    data.system = { ...(data.system ?? {}), effectType: 'condition' };
    data.flags = foundry.utils.mergeObject(data.flags ?? {}, { [AM.ID]: { [this.FLAG]: { spell: item?.name ?? null, lasts: lasts ?? null } } });
    const time = this.timing(lasts, item, target);
    if (time) {
      data.duration = { ...(data.duration ?? {}), ...time.duration };
      data.start = time.start;
    }
    try {
      await Effect.create(data, { parent: target, keepId: true });
      return true;
    } catch (err) {
      if (/already exists/i.test(String(err?.message ?? err))) return false;
      throw err;
    }
  }

  /**
   * One of the spell's own effects on a creature, as a5e would transfer it - its
   * origin the spell; one already there is turned back on, not doubled. A
   * status it carries with no time gets the time the table gives it.
   */
  static async copyEffect(target, effect, item) {
    if (!target || !effect || effect.system?.applyToSelf) return false;
    const already = target.effects.find(e => effect.equals?.(e));
    if (already) {
      if (already.disabled) await already.update({ disabled: false });
      return true;
    }
    const data = foundry.utils.deepClone(effect.toObject());
    delete data._id;
    data.origin = effect.parent?.uuid ?? data.origin;
    /* Its time counted in the encounter these creatures are in, not only the one on view */
    const combat = this.#combatFor(item?.actor, target);
    if (combat && !data.start?.combat) data.start = CONFIG.ActiveEffect.documentClass.getEffectStart?.(combat) ?? data.start;
    if (data.duration?.value == null) {
      for (const status of data.statuses ?? []) {
        const time = this.timing(this.lastsOf(item, status), item, target);
        if (!time) continue;
        data.duration = { ...(data.duration ?? {}), ...time.duration };
        data.start = time.start;
        break;
      }
    }
    await target.createEmbeddedDocuments('ActiveEffect', [data]);
    return true;
  }

  /** The conditions a spell's card offers: [{status, lasts?, effect?}] - the table's and its own effects' */
  static offered(item) {
    const out = [];
    const seen = new Set();
    if (this.ownEffectsCount(item)) {
      for (const effect of item?.effects ?? []) {
        if (effect.system?.applyToSelf) continue;
        const statuses = [...(effect.statuses ?? [])].filter(s => this.#status(s));
        if (!statuses.length) continue;
        out.push({ status: statuses[0], statuses, effect: effect.uuid, name: effect.name });
        statuses.forEach(s => seen.add(s));
      }
    }
    for (const [status, , lasts] of this.of(item)?.give ?? []) {
      if (seen.has(status) || !this.#status(status)) continue;
      seen.add(status);
      out.push({ status, statuses: [status], lasts });
    }
    return out;
  }

  /* ── the card ────────────────────────────────────────────── */

  static #on() {
    try { return game.settings.get(AM.ID, 'autoSaveEffects') !== false; } catch { return true; }
  }

  static #esc(s) {
    const str = String(s ?? '');
    return foundry.utils?.escapeHTML?.(str) ?? str.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  static #itemOf(message) {
    if (message?.type !== 'item') return null;
    const uuid = message.system?.itemId;
    if (!uuid) return null;
    try { return fromUuidSync(uuid) ?? null; } catch { return null; }
  }

  static install() {
    Hooks.on('renderChatMessageHTML', (message, html) => {
      try { this.#drawRow(message, html); } catch (err) { AM.log(2, 'Spell conditions: the card row was not drawn:', err); }
    });
    Hooks.on('createChatMessage', (message) => {
      this.#onAsked(message).catch(err => AM.log(1, 'Spell conditions: a request was not carried out:', err));
    });
    document.addEventListener('click', (event) => this.#onClick(event), true);
  }

  static #drawRow(message, html) {
    if (!this.#on() || !(html instanceof HTMLElement)) return;
    const item = this.#itemOf(message);
    if (!item || item.type !== 'spell') return;
    const offered = this.offered(item);
    if (!offered.length) return;
    html.querySelector(':scope .am-spell-conditions')?.remove();
    const row = document.createElement('div');
    row.className = 'am-spell-conditions';
    row.innerHTML = `<span class="am-spell-conditions__label">${this.#esc(game.i18n.localize('am.spellConditions.label'))}</span>`
      + offered.map(o => {
        const label = o.statuses.map(s => this.label(s)).join(', ');
        const img = this.#status(o.status)?.img ?? '';
        const tip = o.effect ? `${o.name}` : `${label}, ${this.describe(o.lasts, item)}`;
        return `<button type="button" class="am-spell-condition" data-am-condition="${this.#esc(o.status)}"`
          + `${o.effect ? ` data-am-effect="${this.#esc(o.effect)}"` : ''} data-tooltip="${this.#esc(tip)}">`
          + `${img ? `<img src="${this.#esc(img)}" alt="">` : ''}<span>${this.#esc(label)}</span></button>`;
      }).join('');
    const body = html.querySelector('.a5e-chat-card__body');
    if (body?.parentElement) body.after(row);
    else (html.querySelector('.message-content') ?? html).append(row);
  }

  static #onClick(event) {
    const target = event.target;
    if (!(target instanceof Element) || !this.#on()) return;
    const chip = target.closest('.am-spell-condition[data-am-condition]');
    const link = chip ? null : target.closest('.a5e-enricher--effect');
    if (!chip && !link) return;
    const messageId = target.closest('[data-message-id]')?.dataset.messageId;
    const message = messageId ? game.messages.get(messageId) : null;
    const item = this.#itemOf(message);
    if (!item || item.type !== 'spell') return;
    let status, effect = null;
    if (chip) {
      status = chip.dataset.amCondition;
      effect = chip.dataset.amEffect || null;
    } else {
      if (link.dataset.enricherType !== 'condition') return;
      status = link.dataset.id ?? null;
      if (!status) return;
      /* the spell's own effect for that status, when it has one: its time and its changes */
      effect = this.offered(item).find(o => o.effect && o.statuses.includes(status))?.effect ?? null;
    }
    if (!this.#status(status)) return;
    event.preventDefault();
    event.stopPropagation();
    this.putOn(item, status, effect).catch(err => {
      AM.log(1, 'Spell conditions: could not put a condition on:', err);
      ui.notifications.error(`${AM.NAME}: ${err?.message ?? err}`);
    });
  }

  /** The creatures a click is for: the user's targets, or, with none, the selected tokens */
  static #targets() {
    const fromTargets = [...(game.user?.targets ?? [])].map(t => t.document?.actor ?? t.actor).filter(Boolean);
    if (fromTargets.length) return fromTargets;
    return (canvas?.tokens?.controlled ?? []).map(t => t.document?.actor ?? t.actor).filter(Boolean);
  }

  /**
   * The condition on the targets: the user's own creatures here and now, the
   * rest by the GM. A creature that has it from this spell already has it
   * taken off - the button undoes itself.
   */
  static async putOn(item, status, effectUuid = null) {
    const targets = [...new Map(this.#targets().map(a => [a.uuid, a])).values()];
    if (!targets.length) {
      ui.notifications.warn(game.i18n.localize('am.spellConditions.noTargets'));
      return;
    }
    const mine = targets.filter(a => a.isOwner);
    const theirs = targets.filter(a => !a.isOwner);
    if (theirs.length && !game.users.activeGM) {
      ui.notifications.warn(game.i18n.format('am.spellConditions.noGM', { names: theirs.map(a => a.name).join(', ') }));
    }
    const done = await this.apply(item, status, effectUuid, mine);
    const asked = game.users.activeGM ? theirs : [];
    if (!done.on.length && !done.off.length && !asked.length) {
      if (done.had.length) ui.notifications.info(game.i18n.format('am.spellConditions.already', { names: done.had.join(', '), condition: this.label(status) }));
      return;
    }
    await this.#post(item, status, effectUuid, done, asked);
  }

  /** On these creatures, here: what came on, what came off, who had it already */
  static async apply(item, status, effectUuid, actors) {
    const done = { on: [], off: [], had: [] };
    const effect = effectUuid ? await fromUuid(effectUuid).catch(() => null) : null;
    for (const actor of actors) {
      const ours = actor.effects.filter(e => e.origin === item.uuid && e.statuses?.has?.(status));
      if (ours.length) {
        await actor.deleteEmbeddedDocuments('ActiveEffect', ours.map(e => e.id));
        done.off.push(actor.name);
        continue;
      }
      if (actor.statuses?.has?.(status)) { done.had.push(actor.name); continue; }
      const put = effect ? await this.copyEffect(actor, effect, item) : await this.give(actor, item, status, this.lastsOf(item, status));
      (put ? done.on : done.had).push(actor.name);
    }
    return done;
  }

  static async #post(item, status, effectUuid, done, asked) {
    const condition = this.#esc(this.label(status));
    const lasts = effectUuid ? null : this.lastsOf(item, status);
    const parts = [];
    const names = [...done.on, ...asked.map(a => a.name)];
    if (names.length) parts.push(`${condition} on ${names.map(n => this.#esc(n)).join(', ')}${effectUuid ? '' : ` (${this.#esc(this.describe(lasts, item))})`}`);
    if (done.off.length) parts.push(`${condition} taken off ${done.off.map(n => this.#esc(n)).join(', ')}`);
    await ChatMessage.create({
      content: `<p class="am-condition-note"><strong>${this.#esc(item.name)}</strong>: ${parts.join('; ')}.</p>`,
      speaker: ChatMessage.getSpeaker({ actor: item.actor ?? null }),
      style: CONST.CHAT_MESSAGE_STYLES.OTHER,
      ...(asked.length ? { flags: { [AM.ID]: { [this.ASK]: { item: item.uuid, status, effect: effectUuid, targets: asked.map(a => a.uuid) } } } } : {})
    });
  }

  /** On the active GM's client: a player's request for creatures not theirs */
  static async #onAsked(message) {
    const ask = message.flags?.[AM.ID]?.[this.ASK];
    if (!ask || !game.user.isActiveGM || !this.#on()) return;
    const item = await fromUuid(ask.item).catch(() => null);
    if (!item) return;
    const actors = [];
    for (const uuid of ask.targets ?? []) {
      const doc = await fromUuid(uuid).catch(() => null);
      const actor = doc?.documentName === 'Actor' ? doc : doc?.actor;
      if (actor) actors.push(actor);
    }
    const done = await this.apply(item, ask.status, ask.effect ?? null, actors);
    if (done.off.length || done.had.length) {
      const condition = this.#esc(this.label(ask.status));
      const bits = [];
      if (done.off.length) bits.push(`${condition} taken off ${done.off.map(n => this.#esc(n)).join(', ')}`);
      if (done.had.length) bits.push(`${done.had.map(n => this.#esc(n)).join(', ')} had it already`);
      await ChatMessage.create({
        content: `<p class="am-condition-note"><strong>${this.#esc(item.name)}</strong>: ${bits.join('; ')}.</p>`,
        speaker: ChatMessage.getSpeaker({ actor: item.actor ?? null }),
        style: CONST.CHAT_MESSAGE_STYLES.OTHER
      });
    }
  }
}
