import { AM } from '../am.js';
import { MAGIC_MANEUVERS } from '../data/magicManeuversData.js';
import { ConditionAutomation } from './conditionAutomation.js';
import { SpellConditions } from './spellConditions.js';

/**
 * The magic maneuvers that leave a creature worse at its next save, put on
 * that creature (asked 2026-11-17, with the conditions of spells):
 *
 * - Ice: from a spell's cold damage, disadvantage on the creature's next
 *   Strength, Dexterity or Constitution save;
 * - Psychic: from psychic damage, on its next Intelligence, Wisdom or Charisma
 *   save.
 * Both until the end of the caster's next turn.
 *
 * Which creature. a5e keeps no record of whom a spell was cast at: it reads the
 * user's targets for the roll and forgets them, and its card holds the rolls
 * alone. So a spell card that deals damage keeps them (flag `struck`), noted
 * on the caster's client as it is posted. The maneuver's card, posted the same
 * way, looks back for that caster's last spell card dealing the maneuver's
 * damage type - ten minutes at most - and takes its creatures; with none, the
 * creatures targeted as the maneuver is used (flag `maneuverOn`).
 *   - One creature: it is put on that one at once, by the active GM's client
 *     (with no GM, by the caster's, on a creature it owns).
 *   - More (a cone of cold): the card has a button for each; the maneuver
 *     names one creature.
 *   - None: one button, for what is targeted (or selected) when it is pressed.
 * A button pressed again takes it off.
 *
 * What is put on: an effect named for the maneuver, its origin the maneuver,
 * that adds one disadvantage to each of those saves - a5e weighs it against
 * any advantage, and names it in its roll window. The first save of one of
 * those abilities spends it. Not `flags.a5e.effects.rollMode.*`, the keys a5e's
 * own conditions still use: a5e 1.5.1 reads them nowhere (a restrained
 * creature's Dexterity save rolled one d20).
 */
const SAVES = {
  ice:     { abilities: ['str', 'dex', 'con'], damageType: 'cold' },
  psychic: { abilities: ['int', 'wis', 'cha'], damageType: 'psychic' }
};

export class ManeuverSaves {

  static FLAG = 'maneuverSave';
  static STRUCK = 'struck';
  static CARD = 'maneuverOn';
  static ASK = 'maneuverSaveAsk';
  static LOOK_BACK_MS = 10 * 60 * 1000;

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

  /** The maneuver's key in SAVES, or null */
  static idOf(item) {
    if (!item || item.documentName !== 'Item') return null;
    const flags = item.flags?.[AM.ID] ?? {};
    const id = flags.maneuverId ?? (flags.magicManeuver ? MAGIC_MANEUVERS.find(m => m.name === item.name)?.id : null);
    return id && SAVES[id] ? id : null;
  }

  /** "Strength, Dexterity, or Constitution" */
  static abilitiesText(id) {
    const names = (SAVES[id]?.abilities ?? []).map(a => game.i18n.localize(CONFIG.A5E?.abilities?.[a] ?? a));
    return names.length > 1 ? `${names.slice(0, -1).join(', ')}, or ${names.at(-1)}` : (names[0] ?? '');
  }

  static install() {
    Hooks.on('preCreateChatMessage', (message) => {
      try { this.#note(message); } catch (err) { AM.log(2, 'Maneuver saves: a card was not noted:', err); }
    });
    Hooks.on('createChatMessage', (message) => {
      this.#onCreated(message).catch(err => AM.log(1, 'Maneuver saves:', err));
    });
    Hooks.on('renderChatMessageHTML', (message, html) => {
      try { this.#drawRow(message, html); } catch (err) { AM.log(2, 'Maneuver saves: the card row was not drawn:', err); }
    });
    document.addEventListener('click', (event) => this.#onClick(event), true);
  }

  /* ── whom ────────────────────────────────────────────────── */

  /** What this user targets: [{ token, actor, name }] */
  static #targeted() {
    return [...(game.user?.targets ?? [])].map(t => t.document ?? null)
      .filter(d => d?.actor)
      .map(d => ({ token: d.uuid, actor: d.actor.uuid, name: d.name }));
  }

  /** What this user targets, or with none, selects */
  static #targetsNow() {
    const targeted = this.#targeted();
    if (targeted.length) return targeted;
    return (canvas?.tokens?.controlled ?? []).map(t => t.document ?? null).filter(d => d?.actor)
      .map(d => ({ token: d.uuid, actor: d.actor.uuid, name: d.name }));
  }

  static async #actorOf(creature) {
    for (const uuid of [creature?.token, creature?.actor]) {
      if (!uuid) continue;
      const doc = await fromUuid(uuid).catch(() => null);
      const actor = doc?.documentName === 'Actor' ? doc : doc?.actor;
      if (actor) return actor;
    }
    return null;
  }

  /** The caster's last spell card dealing this type of damage, within the look-back */
  static #lastSpell(actorUuid, damageType) {
    if (!actorUuid) return null;
    const now = Date.now();
    const list = game.messages?.contents ?? [];
    for (let i = list.length - 1, seen = 0; i >= 0 && seen < 80; i--, seen++) {
      const m = list[i];
      if (now - (m.timestamp ?? 0) > this.LOOK_BACK_MS) break;
      if (m.type !== 'item' || m.system?.actorId !== actorUuid) continue;
      if (!(m.system?.rollData ?? []).some(r => r?.type === 'damage' && r.damageType === damageType)) continue;
      if (this.#itemOf(m)?.type !== 'spell') continue;
      return m;
    }
    return null;
  }

  /** On the poster's client, as a card is made: who a spell struck, whom a maneuver is for */
  static #note(message) {
    if (!this.#on() || message.type !== 'item') return;
    const item = this.#itemOf(message);
    if (!item) return;
    if (item.type === 'spell') {
      if (!(message.system?.rollData ?? []).some(r => r?.type === 'damage')) return;
      const struck = this.#targeted();
      if (struck.length) message.updateSource({ [`flags.${AM.ID}.${this.STRUCK}`]: struck });
      return;
    }
    const id = this.idOf(item);
    if (!id) return;
    const from = this.#lastSpell(message.system?.actorId, SAVES[id].damageType);
    const struck = from?.flags?.[AM.ID]?.[this.STRUCK] ?? [];
    const creatures = struck.length ? struck : this.#targeted();
    message.updateSource({ [`flags.${AM.ID}.${this.CARD}`]: { id, creatures, from: from?.id ?? null } });
  }

  /* ── putting on, taking off ──────────────────────────────── */

  /** Whether this client does what everyone's client heard about */
  static #acts(message) {
    if (game.users.activeGM) return game.user.isActiveGM;
    return message.author?.id === game.user.id;
  }

  static #ours(actor, id, item = null) {
    return actor.effects.filter(e => e.flags?.[AM.ID]?.[this.FLAG]?.id === id && (!item || e.origin === item.uuid));
  }

  /** The disadvantage on a creature; one it has already from this maneuver is put on afresh */
  static async give(item, id, actor) {
    const def = SAVES[id];
    if (!def || !actor) return false;
    const old = this.#ours(actor, id);
    if (old.length) await actor.deleteEmbeddedDocuments('ActiveEffect', old.map(e => e.id));
    const data = {
      name: item?.name ?? id,
      img: item?.img ?? 'icons/svg/downgrade.svg',
      origin: item?.uuid ?? null,
      description: `<p>Disadvantage on its next ${this.#esc(this.abilitiesText(id))} saving throw, until the end of the caster's next turn.</p>`,
      showIcon: CONST.ACTIVE_EFFECT_SHOW_ICON?.ALWAYS ?? 2,
      system: { changes: def.abilities.map(a => ({ key: `system.abilities.${a}.save.rollMode`, type: 'add', value: -1, phase: 'initial' })) },
      flags: { [AM.ID]: { [this.FLAG]: { id, abilities: def.abilities, caster: item?.actor?.uuid ?? null } } }
    };
    const time = SpellConditions.timing('yoursEnd', item, actor);
    if (time) {
      data.duration = time.duration;
      data.start = time.start;
    }
    await actor.createEmbeddedDocuments('ActiveEffect', [data]);
    return true;
  }

  /** On if it is not there, off if it is: true for on */
  static async toggle(item, id, actor) {
    const ours = this.#ours(actor, id, item);
    if (ours.length) {
      await actor.deleteEmbeddedDocuments('ActiveEffect', ours.map(e => e.id));
      return false;
    }
    return this.give(item, id, actor);
  }

  static async #post(item, html, extra = {}) {
    return ChatMessage.create({
      content: `<p class="am-condition-note"><strong>${this.#esc(item?.name ?? '')}</strong>: ${html}</p>`,
      speaker: ChatMessage.getSpeaker({ actor: item?.actor ?? null }),
      style: CONST.CHAT_MESSAGE_STYLES.OTHER,
      ...extra
    });
  }

  static #onText(id, names) {
    return `${names.map(n => this.#esc(n)).join(', ')} ${names.length > 1 ? 'have' : 'has'} disadvantage on the next ${this.#esc(this.abilitiesText(id))} save, until the end of the caster's next turn.`;
  }

  static async #onCreated(message) {
    if (!this.#on()) return;
    if (message.system?.rollType === 'savingThrow') return this.#spend(message);
    const ask = message.flags?.[AM.ID]?.[this.ASK];
    if (ask) return this.#onAsked(ask);
    const card = message.flags?.[AM.ID]?.[this.CARD];
    if (!card || card.creatures?.length !== 1 || !this.#acts(message)) return;
    const item = this.#itemOf(message) ?? await fromUuid(message.system?.itemId).catch(() => null);
    const actor = await this.#actorOf(card.creatures[0]);
    if (!item || !actor) return;
    if (!actor.isOwner) {
      ui.notifications.warn(game.i18n.format('am.spellConditions.noGM', { names: actor.name }));
      return;
    }
    if (await this.give(item, card.id, actor)) await this.#post(item, this.#onText(card.id, [actor.name]));
  }

  /** A save of one of its abilities, rolled: the disadvantage is spent */
  static async #spend(message) {
    if (!this.#acts(message)) return;
    const actor = await fromUuid(message.system?.actorId).catch(() => null);
    if (!actor?.effects) return;
    /* With ?.: a browser that kept last version's conditionAutomation.js (the Forge) has no such method */
    const ability = ConditionAutomation.saveAbility?.(message);
    if (!ability) return;
    const spent = actor.effects.filter(e => (e.flags?.[AM.ID]?.[this.FLAG]?.abilities ?? []).includes(ability));
    if (!spent.length) return;
    await actor.deleteEmbeddedDocuments('ActiveEffect', spent.map(e => e.id));
    const name = game.i18n.localize(CONFIG.A5E?.abilities?.[ability] ?? ability);
    await ChatMessage.create({
      content: `<p class="am-condition-note">${this.#esc(actor.name)} made its ${this.#esc(name)} save with disadvantage: ${spent.map(e => `<strong>${this.#esc(e.name)}</strong>`).join(', ')} spent.</p>`,
      speaker: ChatMessage.getSpeaker({ actor }),
      style: CONST.CHAT_MESSAGE_STYLES.OTHER
    });
  }

  /* ── the card ────────────────────────────────────────────── */

  static #drawRow(message, html) {
    if (!this.#on() || !(html instanceof HTMLElement)) return;
    const card = message.flags?.[AM.ID]?.[this.CARD];
    if (!card || !SAVES[card.id]) return;
    html.querySelector(':scope .am-maneuver-saves')?.remove();
    const tip = `${this.abilitiesText(card.id)}, until the end of the caster's next turn. Pressed again, it comes off.`;
    const buttons = (card.creatures ?? []).length
      ? card.creatures.map(c => `<button type="button" class="am-spell-condition am-maneuver-save" data-am-token="${this.#esc(c.token ?? '')}"`
          + ` data-am-actor="${this.#esc(c.actor ?? '')}" data-tooltip="${this.#esc(tip)}"><span>${this.#esc(c.name)}</span></button>`)
      : [`<button type="button" class="am-spell-condition am-maneuver-save" data-tooltip="${this.#esc(tip)}"><span>${this.#esc(game.i18n.localize('am.maneuverSaves.targets'))}</span></button>`];
    const row = document.createElement('div');
    row.className = 'am-spell-conditions am-maneuver-saves';
    row.innerHTML = `<span class="am-spell-conditions__label">${this.#esc(game.i18n.localize('am.maneuverSaves.label'))}</span>${buttons.join('')}`;
    const body = html.querySelector('.a5e-chat-card__body');
    if (body?.parentElement) body.after(row);
    else (html.querySelector('.message-content') ?? html).append(row);
  }

  static #onClick(event) {
    const button = event.target instanceof Element ? event.target.closest('.am-maneuver-save') : null;
    if (!button || !this.#on()) return;
    const message = game.messages.get(button.closest('[data-message-id]')?.dataset.messageId);
    const card = message?.flags?.[AM.ID]?.[this.CARD];
    const item = this.#itemOf(message);
    if (!card || !item) return;
    event.preventDefault();
    event.stopPropagation();
    const creature = button.dataset.amToken || button.dataset.amActor
      ? { token: button.dataset.amToken || null, actor: button.dataset.amActor || null } : null;
    this.#pressed(item, card.id, creature).catch(err => {
      AM.log(1, 'Maneuver saves: could not put it on:', err);
      ui.notifications.error(`${AM.NAME}: ${err?.message ?? err}`);
    });
  }

  /** A button: on (or off) the creature it names, or what is targeted now */
  static async #pressed(item, id, creature) {
    const actors = [];
    for (const c of creature ? [creature] : this.#targetsNow()) {
      const actor = await this.#actorOf(c);
      if (actor && !actors.some(a => a.uuid === actor.uuid)) actors.push(actor);
    }
    if (!actors.length) {
      ui.notifications.warn(game.i18n.localize('am.spellConditions.noTargets'));
      return;
    }
    const mine = actors.filter(a => a.isOwner);
    const theirs = actors.filter(a => !a.isOwner);
    if (theirs.length && !game.users.activeGM) {
      ui.notifications.warn(game.i18n.format('am.spellConditions.noGM', { names: theirs.map(a => a.name).join(', ') }));
    }
    const on = [], off = [];
    for (const actor of mine) ((await this.toggle(item, id, actor)) ? on : off).push(actor.name);
    const asked = game.users.activeGM ? theirs : [];
    const parts = [];
    if (on.length || asked.length) parts.push(this.#onText(id, [...on, ...asked.map(a => a.name)]));
    if (off.length) parts.push(`taken off ${off.map(n => this.#esc(n)).join(', ')}.`);
    if (!parts.length) return;
    await this.#post(item, parts.join(' '),
      asked.length ? { flags: { [AM.ID]: { [this.ASK]: { item: item.uuid, id, actors: asked.map(a => a.uuid) } } } } : {});
  }

  /** On the active GM's client: a player's press, for creatures not theirs */
  static async #onAsked(ask) {
    if (!game.user.isActiveGM) return;
    const item = await fromUuid(ask.item).catch(() => null);
    if (!item || !SAVES[ask.id]) return;
    const off = [];
    for (const uuid of ask.actors ?? []) {
      const actor = await this.#actorOf({ actor: uuid });
      if (actor && !(await this.toggle(item, ask.id, actor))) off.push(actor.name);
    }
    if (off.length) await this.#post(item, `taken off ${off.map(n => this.#esc(n)).join(', ')}.`);
  }
}
