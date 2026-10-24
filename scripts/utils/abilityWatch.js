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
    // Once the world is up, and once its scene is drawn: what each client shows, against its data
    Hooks.once('ready', () => setTimeout(() => this.#guard(() => this.checkDrift('after loading')), 5000));
    Hooks.once('canvasReady', () => setTimeout(() => this.#guard(() => this.checkDrift('after the scene was drawn')), 5000));
  }

  /* ── scores written outside preparation ──────────────────── */

  static #depth = 0;

  /** How many preparations are running now (0 outside them). */
  static get preparing() { return this.#depth; }

  /** A5eFixes.idempotentPrepare: an actor is being prepared. */
  static enter() { this.#depth++; }

  /** And no longer: its scores are watched until the next preparation. */
  static leave(actor) {
    this.#depth = Math.max(0, this.#depth - 1);
    try { this.trap(actor); } catch { /* a watch, nothing more */ }
  }

  /**
   * After a character is prepared, a write to an ability score anywhere but a
   * preparation is told to the GM with the code that made it. a5e itself
   * writes them only while preparing; the user's world still showed scores
   * three points over its data after every repeated preparation had been made
   * harmless (2.93.2), so something writes them directly. The write itself
   * goes through.
   */
  static trap(actor) {
    if (actor?.type !== 'character' || !this.on()) return;
    for (const [key, data] of Object.entries(actor.system?.abilities ?? {})) {
      if (!data || typeof data !== 'object') continue;
      const desc = Object.getOwnPropertyDescriptor(data, 'value');
      if (!desc || desc.get || !desc.configurable) continue;
      let value = desc.value;
      Object.defineProperty(data, 'value', {
        configurable: true, enumerable: true,
        get: () => value,
        set: (next) => {
          if (next !== value && this.#depth === 0) this.#noteWrite(actor, key, value, next);
          value = next;
        }
      });
    }
  }

  static #writes = new Map();   // the code that wrote -> { lines: Set, count, told }
  static #writeTimer = null;

  static #noteWrite(actor, key, from, to) {
    const where = this.where(/abilityWatch\.js/);
    const entry = this.#writes.get(where) ?? { lines: new Set(), count: 0, told: 0 };
    entry.lines.add(`${actor.name}: ${this.#label(key)} ${from} → ${to}`);
    entry.count++;
    this.#writes.set(where, entry);
    clearTimeout(this.#writeTimer);
    this.#writeTimer = setTimeout(() => this.#tellWrites(), 3000);
  }

  static #tellWrites() {
    if (!game.ready) { Hooks.once('ready', () => this.#tellWrites()); return; }
    const gms = game.users?.filter(u => u.isGM).map(u => u.id) ?? [];
    const fresh = [...this.#writes].filter(([, e]) => e.count > e.told);
    if (!gms.length || !fresh.length) return;
    const items = fresh.map(([where, e]) => {
      e.told = e.count;
      const lines = [...e.lines];
      return `<li>${this.#esc(lines.slice(0, 6).join('; '))}${lines.length > 6 ? ` and ${lines.length - 6} more` : ''} - from: ${this.#esc(where)}</li>`;
    }).join('');
    ChatMessage.create({
      whisper: gms, speaker: { alias: AM.NAME ?? 'A5e Mancer' },
      content: `<div class="am-ability-watch"><strong>Ability scores written outside a5e's preparation</strong><ul>${items}</ul></div>`
    }).catch(err => AM.log(2, 'Ability watch note:', err));
  }

  /* ── what a client shows against its data ────────────────── */

  /**
   * Each character's scores as this client shows them, against a copy
   * prepared afresh from its data; one that differs is prepared again from
   * its data, and the GM is told. Once after loading and once after the
   * scene is drawn - where the user's world showed scores three points high.
   * About 10 ms a character.
   */
  static checkDrift(when) {
    const drifted = [];
    for (const actor of game.actors?.filter(a => a.type === 'character') ?? []) {
      const shown = this.KEYS.map(k => actor.system?.abilities?.[k]?.value);
      let fresh;
      try { fresh = actor.clone({}, { keepId: true }); } catch { continue; }
      const truth = this.KEYS.map(k => fresh.system?.abilities?.[k]?.value);
      const off = this.KEYS.filter((k, i) => shown[i] !== truth[i]).map((k) => `${this.#label(k)} ${shown[this.KEYS.indexOf(k)]} (its data gives ${truth[this.KEYS.indexOf(k)]})`);
      if (!off.length) continue;
      drifted.push(`${actor.name}: ${off.join(', ')}`);
      try { actor.reset(); } catch { /* shown as it was */ }
    }
    if (!drifted.length) return;
    const gms = game.users?.filter(u => u.isGM).map(u => u.id) ?? [];
    if (!gms.length) return;
    ChatMessage.create({
      whisper: gms, speaker: { alias: AM.NAME ?? 'A5e Mancer' },
      content: `<div class="am-ability-watch"><strong>Ability scores off ${this.#esc(when)} on ${this.#esc(game.user?.name)}'s screen - put right</strong>`
        + `<ul>${drifted.slice(0, 12).map(d => `<li>${this.#esc(d)}</li>`).join('')}</ul></div>`
    }).catch(err => AM.log(2, 'Ability watch note:', err));
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
  static where(skip = /abilityWatch\.js/) {
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
      if (!pkg || skip.test(pkg[2])) continue;
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
      + `<p class="am-ability-watch-from">By ${this.#esc(game.user?.name)}, from: ${this.#esc(this.where())}</p></div>`;
    ChatMessage.create({ content: html, whisper: gms, speaker: { alias: AM.NAME ?? 'A5e Mancer' } })
      .catch(err => AM.log(2, 'Ability watch note:', err));
  }

  /* ── an actor prepared again without starting over ───────── */

  static #repeats = new Map();   // the code that asked -> { actors: Set, count }
  static #repeatTimer = null;

  /**
   * Noted by A5eFixes.idempotentPrepare, which also puts the scores right.
   * Gathered and logged once a few seconds later - at load there may be
   * dozens - and only what is new after that.
   *
   * In the console, not the chat. It was a GM whisper while the cause was
   * sought; found (Geano's Phantom Performance, and the user's world prepares
   * every actor twice at load), and made harmless by the guards, it came at
   * every load and every swap saying the same thing: "every time the same
   * message about preparing actors" (2026-10-24).
   */
  static noteRepeat(actor) {
    if (!this.on()) return;
    const from = this.where(/abilityWatch\.js|a5eFixes\.js/);   // not the wrapper that noticed it
    const entry = this.#repeats.get(from) ?? { actors: new Set(), count: 0, told: 0 };
    entry.actors.add(actor?.name ?? '?');
    entry.count++;
    this.#repeats.set(from, entry);
    clearTimeout(this.#repeatTimer);
    this.#repeatTimer = setTimeout(() => this.#logRepeats(), 4000);
  }

  static #logRepeats() {
    const fresh = [...this.#repeats].filter(([, e]) => e.count > e.told);
    for (const [from, e] of fresh) {
      const names = [...e.actors];
      e.told = e.count;
      AM.log(3, `Actors prepared again without starting over, prepared from their stored data instead: `
        + `${names.slice(0, 6).join(', ')}${names.length > 6 ? ` and ${names.length - 6} more` : ''} - ${e.count}×, from: ${from}`);
    }
  }
}
