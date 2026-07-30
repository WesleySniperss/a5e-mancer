import { AM } from '../a5e-mancer.js';

/**
 * Bridge between the Beyond20 browser extension and the a5e system.
 *
 * Beyond20 injects a page script into the Foundry tab. That script renders its
 * own chat cards and pushes character state back into the world through two DOM
 * CustomEvents. Both write paths were written for dnd5e and neither lands
 * correctly on a5e:
 *
 *   Beyond20_UpdateHP          writes system.attributes.hp.max, but a5e derives
 *                              max from baseMax + bonus during data preparation,
 *                              so the value is overwritten again immediately.
 *
 *   Beyond20_UpdateConditions  pushes icon paths into Token#effects - an API
 *                              removed in Foundry v11 - and only when the
 *                              optional "beyond20" Foundry module is installed.
 *                              A5e also has no Exhaustion condition; it tracks
 *                              Fatigue as a number instead.
 *
 * Beyond20's own listeners still run and we cannot unregister them, but on a5e
 * their writes are inert, so we just apply the correct ones alongside.
 *
 * The rolls themselves need no translation: Beyond20 evaluates dice with
 * Foundry's own Roll class and posts a plain chat message, which a5e leaves
 * alone (its renderChatMessageHTML hook only claims its own card types). What
 * was missing there is the stylesheet - see styles/beyond20.css.
 */
export class Beyond20Service {

  /** Conditions D&D Beyond can report. We only ever add or remove these, so a
   *  condition the GM applied by hand is never cleared behind their back. */
  static DDB_CONDITIONS = [
    'blinded', 'charmed', 'deafened', 'frightened', 'grappled',
    'incapacitated', 'invisible', 'paralyzed', 'petrified', 'poisoned',
    'prone', 'restrained', 'stunned', 'unconscious'
  ];

  /** A5e's Fatigue track runs 0-7 (D&D Beyond's Exhaustion only goes to 6). */
  static FATIGUE_MAX = 7;

  static _listeners = [];
  static _renderHook = null;

  static get enabled() {
    try { return game.settings.get(AM.ID, 'enableBeyond20') !== false; }
    catch { return false; }
  }

  static init() {
    this.disconnect();
    if (!this.enabled) {
      AM.log(3, 'Beyond20 bridge disabled by setting');
      return;
    }

    this._listen('Beyond20_UpdateHP', (name, current, total, temp) =>
      this._onUpdateHP(name, current, total, temp));

    this._listen('Beyond20_UpdateConditions', (_request, name, conditions, exhaustion) =>
      this._onUpdateConditions(name, conditions, exhaustion));

    // Repair Beyond20's chat cards as they render (see _repairCards). v13+ passes
    // a native element to renderChatMessageHTML.
    this._renderHook = Hooks.on('renderChatMessageHTML', (_msg, html) => {
      try { this._repairCards(html?.jquery ? html[0] : html); }
      catch (err) { AM.log(1, 'Beyond20 bridge: card repair failed', err); }
    });
    // Cards already on screen (rendered before we installed) need one pass too.
    try { this._repairCards(document); } catch { /* pre-canvas, ignore */ }

    AM.log(3, 'Beyond20 bridge installed',
      game.beyond20?.loaded ? '(extension detected)' : '(extension not loaded yet)');
  }

  /** Beyond20 dispatches CustomEvents on `document` with an array `detail`. */
  static _listen(eventName, handler) {
    const wrapped = (event) => {
      try { handler(...(event.detail || [])); }
      catch (err) { AM.log(1, `Beyond20 bridge: ${eventName} failed`, err); }
    };
    document.addEventListener(eventName, wrapped, false);
    this._listeners.push([eventName, wrapped]);
  }

  static disconnect() {
    for (const [eventName, handler] of this._listeners)
      document.removeEventListener(eventName, handler, false);
    this._listeners = [];
    if (this._renderHook !== null) {
      Hooks.off('renderChatMessageHTML', this._renderHook);
      this._renderHook = null;
    }
  }

  /* ============================================================
     Chat card repair
     ============================================================ */

  /**
   * D&D Beyond avatar URLs are routinely blocked/broken inside Foundry, and
   * Foundry's chat enrichment mangles the <img> into visible text
   * (…&auto=webp" title="…" width="37" height="37">) that squishes the card. We
   * don't want the portrait at all, so we strip the avatar element and the text
   * debris it leaves behind. (styles/beyond20.css also hides every image in a
   * Beyond20 card, so nothing can flash before this runs.)
   *
   * @param {ParentNode} root  A message element, the chat log, or `document`.
   */
  static _repairCards(root) {
    if (!root?.querySelectorAll) return;
    for (const card of root.querySelectorAll('.beyond20-message')) {
      const header = card.querySelector('.beyond20-header');
      if (header) this._repairHeader(header);
      this._wireDamageControls(card);
    }
  }

  static _repairHeader(header) {
    // Drop the avatar entirely.
    header.querySelector('img.beyond20-character-avatar')?.remove();

    // Remove enrichment debris: any non-whitespace bare text node directly under
    // the header. Beyond20 only ever puts <img>/<details>/<span> here, so bare
    // text is always the leaked tail of the mangled avatar <img>.
    for (const node of [...header.childNodes])
      if (node.nodeType === 3 /* TEXT_NODE */ && node.textContent.trim()) node.remove();
  }

  /* ============================================================
     Apply damage / healing to selected tokens

     Beyond20 rolls damage but has no way to spend it on a target. These controls
     hook each damage/healing line up to the a5e system's own Actor#applyDamage /
     Actor#applyHealing, using the same target resolution the system's damage card
     uses: the controlled tokens, or the user's assigned character as a fallback.
     Reusing those methods means temp HP, the Fatigue-safe clamping, cascading
     scrolling numbers and the a5e.actorDamaged/Healed hooks all behave natively.
     ============================================================ */

  static _wireDamageControls(card) {
    if (!card || card.dataset.a5eMancerDmg) return;
    card.dataset.a5eMancerDmg = '1';

    // Attach controls to the FINAL total(s) only — not to every sub-total line.
    for (const line of this._finalDamageLines(card)) {
      const amount = this._readAmount(line);
      if (amount !== null) line.appendChild(this._damageButtons(amount));
    }
    for (const line of this._finalHealingLines(card)) {
      const amount = this._readAmount(line);
      if (amount !== null) line.appendChild(this._healButtons(amount));
    }
  }

  /** True if a line represents healing rather than damage. Beyond20 tags per-roll
   *  healing lines with .beyond20-healing but labels the healing *total* "Healing"
   *  / "Temp HP" with no class, so check both. */
  static _isHealing(el) {
    if (el.classList.contains('beyond20-healing')) return true;
    const label = el.querySelector('b')?.textContent ?? '';
    return /heal|temp\s*hp|temporary/i.test(label);
  }

  /**
   * The single damage total a player would actually apply. Beyond20's layers, in
   * order of preference:
   *   1. a "Combined" grand total (regular + critical [+ conditional]) — the one
   *      the screenshot shows as "Combined: 60";
   *   2. the regular damage total(s) (multi-component hit, no crit to combine);
   *   3. the primary per-roll damage line (single-component hit renders no totals).
   */
  static _finalDamageLines(card) {
    let d = [...card.querySelectorAll('.beyond20-combined-damage')];

    if (!d.length) d = [...card.querySelectorAll('.beyond20-total-damage')].filter(el =>
      !el.classList.contains('beyond20-critical-damage') &&
      !el.classList.contains('beyond20-conditional-total'));

    if (!d.length) {
      const rolls = [...card.querySelectorAll('.beyond20-roll-damage')].filter(el =>
        !el.classList.contains('beyond20-conditional-damage'));
      // Prefer the line flagged as the roll's total; else the first damage line.
      const primary = rolls.find(el => el.querySelector('.beyond20-roll-total')) ?? rolls[0];
      d = primary ? [primary] : [];
    }

    return d.filter(el => !this._isHealing(el));
  }

  /** Healing total(s), preferred over per-roll healing breakdown lines. */
  static _finalHealingLines(card) {
    const totals = [...card.querySelectorAll('.beyond20-total-damage')].filter(el => this._isHealing(el));
    if (totals.length) return totals;
    return [...card.querySelectorAll('.beyond20-roll-damage')].filter(el => this._isHealing(el));
  }

  /** Pull the rolled total off a damage line. Beyond20 always renders the total in
   *  a .beyond20-roll-value span; the formula and per-die results live in a hidden
   *  tooltip, so read the span directly rather than the line's textContent (which
   *  would include those hidden numbers). */
  static _readAmount(line) {
    const el = line.querySelector('.beyond20-roll-value');
    const text = (el?.textContent ?? '').trim();
    let n = parseFloat(text);
    if (!Number.isFinite(n)) {
      // No total span (unusual layout): fall back to the label text only, i.e. the
      // bit before the tooltip, and take its last number.
      const label = line.querySelector('b')?.nextSibling?.textContent ?? '';
      const m = label.match(/-?\d+(?:\.\d+)?/g);
      n = m?.length ? parseFloat(m[m.length - 1]) : NaN;
    }
    return Number.isFinite(n) ? n : null;
  }

  static _damageButtons(amount) {
    const group = this._group();
    group.append(
      this._btn(`<i class="fa-solid fa-heart-crack"></i>`, `Apply ${amount} damage`,
        () => this._apply(amount, {})),
      this._btn('½', `Apply ${Math.floor(amount / 2)} damage (half)`,
        () => this._apply(amount, { multiplier: 0.5 })),
      this._btn('×2', `Apply ${amount * 2} damage (double)`,
        () => this._apply(amount, { multiplier: 2 })),
      this._btn(`<i class="fa-solid fa-heart-circle-plus"></i>`, `Heal ${amount}`,
        () => this._apply(amount, { heal: true }))
    );
    return group;
  }

  static _healButtons(amount) {
    const group = this._group();
    group.append(
      this._btn(`<i class="fa-solid fa-heart-circle-plus"></i>`, `Heal ${amount}`,
        () => this._apply(amount, { heal: true })),
      this._btn(`<i class="fa-solid fa-heart-circle-bolt"></i>`, `Grant ${amount} temporary HP`,
        () => this._apply(amount, { heal: true, temp: true }))
    );
    return group;
  }

  static _group() {
    const span = document.createElement('span');
    span.className = 'a5e-mancer-apply';
    return span;
  }

  static _btn(inner, tooltip, onClick) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'a5e-mancer-apply__btn';
    b.dataset.tooltip = tooltip;
    b.setAttribute('aria-label', tooltip);
    b.innerHTML = inner;
    b.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      onClick();
    });
    return b;
  }

  /**
   * Apply an amount to the resolved targets via the a5e system's own methods.
   * @param {number} amount
   * @param {{multiplier?: number, heal?: boolean, temp?: boolean}} opts
   */
  static async _apply(amount, { multiplier = 1, heal = false, temp = false } = {}) {
    const actors = this._applyTargets();
    if (!actors.length) {
      ui.notifications.warn('Beyond20: select a token (or assign a character) to apply this to.');
      return;
    }
    for (const actor of actors) {
      try {
        if (heal) {
          if (typeof actor.applyHealing !== 'function') continue;
          await actor.applyHealing(Math.floor(amount), temp ? 'temporaryHealing' : 'healing');
        } else {
          if (typeof actor.applyDamage !== 'function') continue;
          await actor.applyDamage(Math.floor(amount * multiplier), null);
        }
      } catch (err) {
        AM.log(1, `Beyond20 bridge: apply to ${actor?.name} failed`, err);
      }
    }
  }

  /** Same resolution as the a5e damage card: controlled tokens, else the user's
   *  assigned character. */
  static _applyTargets() {
    const controlled = canvas?.tokens?.controlled ?? [];
    if (controlled.length) return controlled.map(t => t.actor).filter(Boolean);
    const own = game.user?.character;
    return own ? [own] : [];
  }

  /* ============================================================
     Hit points
     ============================================================ */

  static async _onUpdateHP(name, current, total, temp) {
    const actors = this._findActors(name);
    if (!actors.length) {
      AM.log(3, `Beyond20 bridge: no owned actor named "${name}" for HP update`);
      return;
    }

    for (const actor of actors) {
      const update = this._buildHPUpdate(actor, current, total, temp);
      if (!update) continue;
      AM.log(3, `Beyond20 bridge: HP ${current}+${temp}/${total} -> ${actor.name}`);
      await actor.update(update);
    }
  }

  static _buildHPUpdate(actor, current, total, temp) {
    const hp = actor.system?.attributes?.hp;
    if (!hp) return null;

    const update = {
      'system.attributes.hp.value': Number(current) || 0,
      'system.attributes.hp.temp': Number(temp) || 0
    };

    if (hp.baseMax !== undefined) {
      // a5e: max = baseMax + (evaluated bonus formula). `bonus` is a StringField
      // holding a formula, so read the contribution back off the prepared data
      // instead of trying to evaluate it - that way the resulting max matches
      // the number D&D Beyond sent rather than overshooting by the bonus.
      const bonusAmount = (Number(hp.max) || 0) - (Number(hp.baseMax) || 0);
      update['system.attributes.hp.baseMax'] = (Number(total) || 0) - bonusAmount;
    } else {
      update['system.attributes.hp.max'] = Number(total) || 0;
    }
    return update;
  }

  /* ============================================================
     Conditions
     ============================================================ */

  static async _onUpdateConditions(name, conditions, exhaustion) {
    const actors = this._findActors(name);
    if (!actors.length) {
      AM.log(3, `Beyond20 bridge: no owned actor named "${name}" for conditions`);
      return;
    }
    for (const actor of actors)
      await this._applyToActor(actor, conditions || [], Number(exhaustion) || 0);
  }

  static async _applyToActor(actor, conditions, exhaustion) {
    const wanted = new Set();
    for (const condition of conditions) {
      const id = this._resolveStatusId(condition);
      if (id) wanted.add(id);
      else AM.log(2, `Beyond20 bridge: no a5e condition matches "${condition}"`);
    }

    // A5e replaces Exhaustion with the Fatigue track.
    const fatigue = Math.max(0, Math.min(this.FATIGUE_MAX, exhaustion));
    if (actor.system?.attributes?.fatigue !== undefined &&
        actor.system.attributes.fatigue !== fatigue) {
      AM.log(3, `Beyond20 bridge: fatigue ${fatigue} -> ${actor.name}`);
      await actor.update({ 'system.attributes.fatigue': fatigue });
    }

    // Only reconcile the conditions D&D Beyond actually reports on.
    const managed = new Set();
    for (const condition of this.DDB_CONDITIONS) {
      const id = this._resolveStatusId(condition);
      if (id) managed.add(id);
    }

    const active = new Set(actor.statuses ?? []);
    for (const id of wanted)
      if (!active.has(id)) await this._toggleStatus(actor, id, true);
    for (const id of managed)
      if (active.has(id) && !wanted.has(id)) await this._toggleStatus(actor, id, false);
  }

  /** Map a D&D Beyond condition name onto an a5e status effect id. */
  static _resolveStatusId(conditionName) {
    const name = String(conditionName || '').toLowerCase().trim();
    if (!name) return null;

    const effects = CONFIG.statusEffects || [];
    const byId = effects.find(e => String(e.id || '').toLowerCase() === name);
    if (byId) return byId.id;

    const byLabel = effects.find(e => {
      const label = game.i18n.localize(e.name || e.label || '');
      return label.toLowerCase().trim() === name;
    });
    return byLabel?.id ?? null;
  }

  static async _toggleStatus(actor, statusId, active) {
    try {
      AM.log(3, `Beyond20 bridge: ${active ? '+' : '-'}${statusId} on ${actor.name}`);
      await actor.toggleStatusEffect(statusId, { active });
    } catch (err) {
      AM.log(1, `Beyond20 bridge: could not toggle "${statusId}"`, err);
    }
  }

  /* ============================================================
     Actor lookup
     ============================================================ */

  /**
   * Beyond20 identifies the target by display name only. Match world actors
   * first, then any token on the canvas carrying that name - D&D Beyond
   * monsters are usually unlinked tokens with no world actor of their own.
   * Deduplicated by uuid, because a synthetic token actor shares the `id` of
   * the actor it was created from.
   */
  static _findActors(name) {
    const wanted = String(name || '').toLowerCase().trim();
    if (!wanted) return [];

    const found = new Map();
    const add = (actor) => {
      if (actor?.isOwner && !found.has(actor.uuid)) found.set(actor.uuid, actor);
    };

    for (const actor of game.actors)
      if (actor.name?.toLowerCase().trim() === wanted) add(actor);

    for (const token of canvas?.tokens?.placeables ?? [])
      if (token.name?.toLowerCase().trim() === wanted) add(token.actor);

    return [...found.values()];
  }
}
