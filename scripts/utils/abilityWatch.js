import { AM } from '../am.js';

/**
 * Every change to a character's ability scores, told to the GM in a whisper:
 * the score as written moving, an ability bonus coming or going, an effect
 * that moves a score - and the code that did it.
 *
 * Scores "growing by themselves" was reported on 2026-10-08, -20 and -21.
 * Two causes were found and fixed: grant bonuses applied a second time
 * (2.89.0, Fill In clears the copies) and a sheet field writing its total
 * into the score (2.91.0). Reported again after both, with nothing left in
 * the module's code that could be found doing it. In a5e 1.4 only a hand
 * should move the score as written - every increase is a bonus - so each
 * change now says where it came from (setting abilityWatch). Read on the
 * client that makes the change, before it is sent: that is where the stack
 * still holds the caller.
 */
export class AbilityWatch {

  static KEYS = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
  static #CHANGE = /^system\.abilities\.(str|dex|con|int|wis|cha)\.value$/;

  static on() {
    try { return game.settings.get(AM.ID, 'abilityWatch') !== false; } catch { return true; }
  }

  static install() {
    Hooks.on('preUpdateActor', (actor, changes) => this.#guard(() => this.#onUpdate(actor, changes)));
    Hooks.on('preCreateActiveEffect', (effect, data) => this.#guard(() => this.#onEffect(effect, data)));
    Hooks.on('preCreateItem', (item, data) => this.#guard(() => this.#onItem(item, data)));
  }

  static #guard(fn) {
    try { if (this.on()) fn(); } catch (err) { AM.log(2, 'Ability watch:', err); }
  }

  static #label(key) {
    return game.i18n.localize(CONFIG.A5E?.abilities?.[key] ?? key);
  }

  static #esc(s) {
    const str = String(s ?? '');
    return foundry.utils?.escapeHTML?.(str) ?? str.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /** The module and system functions on the stack, nearest first. Foundry's
      own frames between an update and its hook fill V8's default ten. */
  static #where() {
    const limit = Error.stackTraceLimit;
    Error.stackTraceLimit = 80;
    const stack = String(new Error().stack ?? '');
    Error.stackTraceLimit = limit;
    const frames = [];
    for (const line of stack.split('\n').slice(1)) {
      const m = line.trim().match(/^at (?:async )?(?:(.+?) \()?(.+?):\d+:\d+\)?$/);
      if (!m) continue;
      const [, fn, file] = m;
      const pkg = file.match(/\/(?:modules|systems)\/([^/]+)\/(?:.*\/)?([^/?]+)/);
      if (!pkg || /abilityWatch\.js/.test(pkg[2])) continue;
      frames.push(`${fn ?? 'anonymous'} (${pkg[1]}/${pkg[2]})`);
      if (frames.length >= 5) break;
    }
    return frames.join(' ← ') || 'Foundry itself (no module or system code on the stack)';
  }

  static #bonusText(bonus) {
    const abilities = [...(bonus?.context?.abilities ?? [])].map(k => this.#label(k)).join(', ') || 'no ability';
    return `${bonus?.formula ?? '?'} to ${abilities} (${bonus?.label ?? 'unnamed'})`;
  }

  static #onUpdate(actor, changes) {
    if (actor?.type !== 'character' && actor?.type !== 'npc') return;
    const data = foundry.utils.expandObject(changes ?? {});
    const lines = [];
    const abilities = foundry.utils.getProperty(data, 'system.abilities') ?? {};
    for (const key of this.KEYS) {
      const next = abilities?.[key]?.value;
      if (next === undefined) continue;
      const before = actor._source?.system?.abilities?.[key]?.value;
      if (Number(next) !== Number(before)) lines.push(`${this.#label(key)} score as written: ${before} → ${next}`);
    }
    const bonuses = foundry.utils.getProperty(data, 'system.bonuses.abilities');
    if (bonuses && typeof bonuses === 'object') {
      const had = actor._source?.system?.bonuses?.abilities ?? {};
      const Del = foundry.data?.operators?.ForcedDeletion;
      for (const [id, value] of Object.entries(bonuses)) {
        /* A key deleted: "-=id" as written, a ForcedDeletion once v14 has read it */
        const deleted = id.startsWith('-=') || (Del && value instanceof Del);
        if (deleted) {
          const gone = had[id.replace(/^-=/, '')];
          if (gone) lines.push(`Ability bonus removed: ${this.#bonusText(gone)}`);
        } else if (value && typeof value === 'object' && !had[id]) {
          lines.push(`Ability bonus added: ${this.#bonusText(value)}`);
        }
      }
    }
    if (lines.length) this.#tell(actor, lines);
  }

  static #movesScores(effectData) {
    const changes = effectData?.system?.changes ?? effectData?.changes ?? [];
    return changes.filter(c => this.#CHANGE.test(c?.key ?? ''))
      .map(c => `${this.#label(c.key.split('.')[2])} ${c.value}`);
  }

  static #onEffect(effect, data) {
    const actor = effect?.parent?.documentName === 'Actor' ? effect.parent : null;
    if (!actor) return;
    const moves = this.#movesScores(data);
    if (moves.length) this.#tell(actor, [`Effect added: ${data?.name ?? effect.name} (${moves.join(', ')})`]);
  }

  static #onItem(item, data) {
    const actor = item?.parent?.documentName === 'Actor' ? item.parent : null;
    if (!actor) return;
    const moves = (data?.effects ?? []).flatMap(e => this.#movesScores(e));
    if (moves.length) this.#tell(actor, [`Item added with an effect on scores: ${data?.name ?? item.name} (${moves.join(', ')})`]);
  }

  static #tell(actor, lines) {
    const gms = game.users?.filter(u => u.isGM).map(u => u.id) ?? [];
    if (!gms.length) return;
    const html = `<div class="am-ability-watch"><strong>${this.#esc(actor.name)}: ability scores</strong>`
      + `<ul>${lines.map(l => `<li>${this.#esc(l)}</li>`).join('')}</ul>`
      + `<p class="am-ability-watch-from">By ${this.#esc(game.user?.name)}, from: ${this.#esc(this.#where())}</p></div>`;
    ChatMessage.create({ content: html, whisper: gms, speaker: { alias: AM.NAME ?? 'A5e Mancer' } })
      .catch(err => AM.log(2, 'Ability watch note:', err));
  }
}
