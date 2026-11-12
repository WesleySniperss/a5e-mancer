import { AM } from '../am.js';
import { AbilityWatch } from './abilityWatch.js';

/**
 * Repairs to a5e itself, each applied only while a5e still has the fault.
 *
 * Every one is checked against a5e's own code before it is applied, so an a5e
 * that has fixed the fault is left alone: the repair turns itself off.
 */
export class A5eFixes {

  static #done = new Set();

  /** At ready, and for the first character made after it. */
  static install() {
    const first = game.actors?.find?.((a) => a?.grants);
    if (first) this.grantedTraits(first);
    Hooks.on('createActor', (actor) => this.grantedTraits(actor));
    this.skillExpertise();
    this.damageBonusFormulas();
    this.paralyzedAdvantage();
    this.hudPalette();
    this.quantityConsumers();
    this.resourceEntriesWatch();
  }

  /**
   * a5e 1.4.4: preparing an actor adds its ability bonuses onto the score
   * itself (prepareCreatureDerivedData: value = value + bonuses), additive
   * effects likewise, so the work is only right on freshly initialised data.
   * Foundry says prepareData may be called more than once and should be
   * idempotent; each pass after the first added every bonus again - 13, 14,
   * 15 - until the actor's next update initialised it afresh. Reported
   * 2026-10-21: "up by 3 as soon as I log in, down when I open the sheet"
   * (opening the sheet writes to the actor). A preparation that finds the
   * actor prepared since it was last initialised starts its system data over
   * from the stored data, and the code that asked is noted in the console
   * (AbilityWatch). Only the system data: 2.93.1 reset the whole actor, items
   * and all - 33 ms a time against 4 for a preparation, measured, and the
   * user's world asks 199 times at login.
   * At init: before the world's actors are first prepared.
   */
  static idempotentPrepare() {
    const proto = CONFIG.Actor?.documentClass?.prototype;
    if (!proto || proto.prepareData?.amIdempotent) return;
    const init = proto._initialize;
    const prepare = proto.prepareData;
    if (typeof init !== 'function' || typeof prepare !== 'function') return;
    proto._initialize = function (...args) {
      this._amFresh = true;
      return init.apply(this, args);
    };
    const wrapped = function (...args) {
      if (this._amFresh === false) {
        try { AbilityWatch.noteRepeat(this); } catch { /* the reset matters, not the note */ }
        try { this.system?.reset?.(); } catch { /* prepared on top: the ability guard still holds */ }
      }
      this._amFresh = false;
      AbilityWatch.enter();
      try { return prepare.apply(this, args); }
      finally { AbilityWatch.leave(this); }
    };
    wrapped.amIdempotent = true;
    proto.prepareData = wrapped;
  }

  /**
   * The same, where a5e adds the bonuses, for preparations that do not come
   * through prepareData. The user's world (a5e 1.4.8, the Forge) still showed
   * Intelligence 21 where the stored 15 and its three increases give 18,
   * after idempotentPrepare had reset 199 repeated preparations at login: the
   * scores were prepared again some other way, and prepareData had been
   * wrapped over by something else ("fix false").
   *   - prepareBaseData puts the scores back to the stored ones: a
   *     preparation that was not preceded by an initialisation starts from
   *     what the last one left.
   *   - prepareCreatureDerivedData run again without prepareBaseData first
   *     starts from the scores it started from last time.
   * Each repeat is noted in the console with the code that asked (AbilityWatch).
   */
  static idempotentAbilities() {
    const proto = CONFIG.Actor?.documentClass?.prototype;
    const base = proto?.prepareBaseData;
    const derived = proto?.prepareCreatureDerivedData;
    if (typeof base !== 'function' || typeof derived !== 'function' || derived.amIdempotent) return;
    /* Both are preparation, called inside prepareData or without it: their
       writes are not the "written outside a5e's preparation" AbilityWatch
       looks for. */
    proto.prepareBaseData = function (...args) {
      AbilityWatch.enter();
      try {
        const abilities = this.system?.abilities;
        const stored = this._source?.system?.abilities;
        if (abilities && stored) {
          for (const [key, data] of Object.entries(abilities)) {
            const value = stored[key]?.value;
            if (data && value !== undefined && data.value !== value) data.value = value;
          }
        }
        this._amAbilitiesBefore = null;
        return base.apply(this, args);
      } finally { AbilityWatch.leave(null); }
    };
    const wrapped = function (...args) {
      AbilityWatch.enter();
      try {
        const abilities = this.system?.abilities;
        if (abilities) {
          if (this._amAbilitiesBefore) {
            for (const [key, value] of Object.entries(this._amAbilitiesBefore)) if (abilities[key]) abilities[key].value = value;
            try { AbilityWatch.noteRepeat(this); } catch { /* the scores matter, not the note */ }
          } else {
            this._amAbilitiesBefore = Object.fromEntries(Object.entries(abilities).map(([key, data]) => [key, data?.value]));
          }
        }
        return derived.apply(this, args);
      } finally { AbilityWatch.leave(null); }
    };
    wrapped.amIdempotent = true;
    proto.prepareCreatureDerivedData = wrapped;
  }

  /**
   * An effect phase applied once a preparation, as Foundry's own
   * applyActiveEffects allows. Core v14 refuses a phase already applied in
   * this data-preparation cycle ("has already completed and cannot be run
   * again"); a5e 1.4 replaces the method without that test, and applies the
   * changes again on top of themselves - an effect adding to a score adds a
   * second time whenever anything calls prepareEmbeddedDocuments or
   * applyActiveEffects again outside a whole preparation, which performance
   * modules do. Reported 2026-10-24, after every other repeat had been made
   * harmless: scores still read high for a moment on a sheet opened at once,
   * and were put right a little later. With the test back they never go up.
   * a5e's prepareBaseData clears the phases (_clearData), so each whole
   * preparation applies each phase once, as before. Off once a5e tests it.
   * At init, before the world's actors are first prepared.
   */
  static effectPhaseOnce() {
    const proto = CONFIG.Actor?.documentClass?.prototype;
    const apply = proto?.applyActiveEffects;
    if (typeof apply !== 'function' || apply.amPhaseOnce) return;
    if (/_completedActiveEffectPhases\.has\(/.test(String(apply))) return;
    const wrapped = function (phase, ...args) {
      if (typeof phase === 'string' && this._completedActiveEffectPhases?.has?.(phase)) {
        AM.log(3, `${this.name}: effect phase "${phase}" already applied in this preparation, not applied again`);
        return undefined;
      }
      return apply.call(this, phase, ...args);
    };
    wrapped.amPhaseOnce = true;
    proto.applyActiveEffects = wrapped;
  }

  /**
   * A combatant skipped by "next round" before it ever had a turn. a5e's
   * Encounter#_onEndTurn reads combatant.flags.a5e, which only a first turn
   * writes, and the TypeError stops all the events of that turn change: no
   * recharges, no effect ending, no combatTurnChange on the GM's client. Found
   * 2026-10-31, where it left the rounds on the statuses standing still. Such a
   * combatant gets what a5e means for it: it did not go this round, so its turn
   * ends. Off once a5e guards it.
   * At init.
   */
  static skippedTurnEnd() {
    const proto = CONFIG.Combat?.documentClass?.prototype;
    const end = proto?._onEndTurn;
    if (typeof end !== 'function' || end.amSkippedTurn) return;
    if (/flags\??\.a5e\?\.|flags\.a5e\s*\?\?/.test(String(end))) return;
    const wrapped = function (combatant, context) {
      if (context?.skipped && combatant && !combatant.flags?.a5e && this.started) {
        return combatant.onEndTurn?.({ round: context.round });
      }
      return end.call(this, combatant, context);
    };
    wrapped.amSkippedTurn = true;
    proto._onEndTurn = wrapped;
  }

  /**
   * The token HUD's status palette, taken down before the next one stays.
   * a5e 1.4 mounts its Svelte palette on every render of the HUD
   * (renderTokenHUDA5E: `hud._svelteComponent = mount(…)`) and unmounts only
   * the last one, when the HUD closes. Every render in between leaves a whole
   * palette alive - its 86 buttons, their listeners, its effects - and in a
   * fight the HUD renders two or three times a turn: a combatant written to,
   * the token written to, Combat Booster opening it for whoever's turn it is.
   * Measured 2026-11-10 on the user's modules: 306 DOM nodes and 143 listeners
   * more per turn, never released, the nodes the same with this module off.
   *
   * Svelte's unmount is inside a5e's bundle, and a5e's own _onClose is the one
   * place that calls it. So the palette left behind is handed to that method,
   * with the parent's _onClose (which would unbind the HUD) stood in for
   * during the call. Wherever a5e's _onClose no longer reads this way, nothing
   * is done; and once a5e takes the old palette down itself, taking it down
   * again here does nothing (Svelte ignores a component it no longer holds).
   * At ready: after a5e's own hook, which has to have mounted the new one.
   */
  static hudPalette() {
    if (this.#done.has('hudPalette')) return;
    this.#done.add('hudPalette');
    const kept = new WeakMap();   // HUD -> the palette a5e mounted at its last render
    let fault = null;             // decided at the first render: can a palette be taken down at all
    const decide = (hud) => {
      const proto = Object.getPrototypeOf(hud);
      const close = Object.hasOwn(proto, '_onClose') ? proto._onClose : null;
      if (typeof close !== 'function' || !/unmount\(\s*this\._svelteComponent\s*\)/.test(String(close))) return false;
      return { proto, close };
    };
    const takeDown = (palette) => {
      const base = Object.getPrototypeOf(fault.proto);
      const own = Object.getOwnPropertyDescriptor(base, '_onClose');
      Object.defineProperty(base, '_onClose', { value() {}, configurable: true, writable: true });
      try { fault.close.call({ _svelteComponent: palette }); }
      finally {
        if (own) Object.defineProperty(base, '_onClose', own);
        else delete base._onClose;
      }
    };
    Hooks.on('renderTokenHUDA5e', (hud) => {
      try {
        fault ??= decide(hud);
        if (!fault) return;
        const fresh = hud._svelteComponent ?? null;
        const old = kept.get(hud) ?? null;
        if (fresh) kept.set(hud, fresh); else kept.delete(hud);
        if (old && old !== fresh) takeDown(old);
      } catch (err) { AM.log(1, 'The token HUD\'s old palette could not be taken down:', err); }
    });
    // a5e's _onClose has unmounted the last one itself
    Hooks.on('closeTokenHUDA5e', (hud) => kept.delete(hud));
  }

  /**
   * An actor's effect starts when it is made. Foundry's
   * ActiveEffect#_preCreate records when (the world time, and the combat,
   * round and turn), and that start is what its duration counts down from
   * and what lets Foundry end it. a5e 1.4 overrides _preCreate and calls
   * Foundry's without awaiting it, so the start is set a moment after the
   * effect has gone to the server, or not at all: of four effects a spell's
   * card might put on, two came without one (found 2026-10-29). Those never
   * counted down and never ended, and showed no rounds. Set here, before the
   * effect is sent; an effect that already states its start keeps it.
   * At init.
   */
  static effectStart() {
    const proto = CONFIG.ActiveEffect?.documentClass?.prototype;
    const pre = proto?._preCreate;
    if (typeof pre !== 'function' || pre.amEffectStart) return;
    if (/await\s+super\._preCreate\(/.test(String(pre))) return;
    const wrapped = async function (data, options, user) {
      const allowed = await pre.call(this, data, options, user);
      if (allowed === false) return false;
      if (this.parent instanceof Actor && !this._source.start) {
        const start = this.constructor.getEffectStart?.();
        if (start) this.updateSource({ start });
      }
      return allowed;
    };
    wrapped.amEffectStart = true;
    proto._preCreate = wrapped;
  }

  /**
   * a5e 1.5.0 renamed its rolls in passing. Its build gives each roll class a
   * one-letter name, the same for all three - BaseRoll, D20Roll and
   * DamageRoll were all "e" in 1.4 and are all "_" in 1.5.0 - and a chat
   * message stores the name of its rolls' class, which Foundry looks up when
   * it reads the message. Every roll stored under 1.4 is now "Unable to
   * recreate e instance from provided data": the card keeps its text and
   * loses its rolls (no damage to apply from it, no total for a module to
   * read), with an error in the console for each one at every load - 260 in
   * a copy of the user's world. Found 2026-11-11.
   * The old name is given back: a class called "e" that is a5e's BaseRoll,
   * which is what 1.4 itself made of all three when it read them (the first
   * class of that name). An a5e that still has the name is left alone.
   * At init: the world's messages are read before setup.
   */
  static oldRollNames() {
    if (this.#done.has('oldRollNames')) return;
    this.#done.add('oldRollNames');
    const rolls = CONFIG.Dice?.rolls;
    const D20Roll = game.a5e?.dice?.D20Roll;
    const BaseRoll = typeof D20Roll === 'function' ? Object.getPrototypeOf(D20Roll) : null;
    if (!Array.isArray(rolls) || typeof BaseRoll !== 'function' || !(BaseRoll.prototype instanceof Roll)) return;
    if (rolls.some((cls) => cls?.name === 'e')) return;
    const named = { e: class extends BaseRoll {} };
    rolls.push(named.e);
    AM.log(3, 'a5e fix: rolls stored under a5e 1.4 are read again');
  }

  /**
   * A chat card whose item is gone did not draw. a5e 1.5's ItemCard reads the
   * name of the message's item, and the message's `item` is fromUuidSync of
   * the card's itemId - nothing once the item is gone. That is every attack
   * of a monster whose token was deleted after the fight (its items live on
   * the token), and every card of a deleted item or character: 166 of the
   * 742 item cards in the test world's log. Each came up blank, with
   * "Cannot read properties of undefined (reading 'name')" from a5e, at every
   * load of the log. Found 2026-11-12.
   * While such a card is drawn, the message answers with a stand-in named for
   * the card's action, which is what the card shows as its title. Outside the
   * drawing the message answers as a5e has it, so nothing else that asks for
   * a message's item - a click on the card, another module - is told of an
   * item that is not there.
   * At init: the log is drawn after setup, with the documents a5e sets at init.
   */
  static goneItemCards() {
    if (this.#done.has('goneItemCards')) return;
    const Message = CONFIG.ChatMessage?.documentClass;
    if (!Message?.prototype || typeof Message.prototype.renderHTML !== 'function') return;
    let owner = Message.prototype;
    while (owner && !Object.getOwnPropertyDescriptor(owner, 'item')) owner = Object.getPrototypeOf(owner);
    const own = owner && Object.getOwnPropertyDescriptor(owner, 'item');
    if (typeof own?.get !== 'function') return;                // not a5e's message class
    this.#done.add('goneItemCards');
    const drawing = new Set();
    Object.defineProperty(owner, 'item', {
      ...own,
      get() {
        const item = own.get.call(this);
        if (item || !drawing.has(this) || !this.system?.itemId) return item;
        return { name: this.system.actionName || this.system.actorName || '', type: '', img: this.system.img ?? '', system: {}, actions: new Map(), flags: {} };
      }
    });
    const render = Message.prototype.renderHTML;
    Message.prototype.renderHTML = async function (...args) {
      drawing.add(this);
      try { return await render.apply(this, args); }
      finally { drawing.delete(this); }
    };
    AM.log(3, 'a5e fix: chat cards whose item is gone are drawn');
  }

  /**
   * a5e 1.5.0 keeps class resources on the character, each a resource of its
   * own (system.resources.<slug>, from the class's resource grants), and
   * rewrote every formula that read them: @classResources.sneak-attack is
   * now @resource.sneak-attack. What that names in a roll's data is the
   * resource itself, an object, and Foundry writes an object into a formula
   * as its JSON - "((@resource.sneak-attack)d6)" is "Unresolved StringTerm
   * ... requested for evaluation", and the attack it is added to does not
   * roll. Sneak Attack, Martial Arts, Divine Smite, Bardic Inspiration and
   * fifty more of a5e's features read their figure this way (its packs,
   * counted 2026-11-11).
   * 1.4 put the class table's figure there, worked out where it could be and
   * left as dice where it could not. A resource asked for whole gives the
   * same again: a "uses" resource its maximum, a counter its count, a dice
   * resource its die. @resource.x.value and the other fields read as before.
   * An a5e that gives its resources a figure of its own is left alone.
   * a5e 1.5.1 puts a figure in the roll data itself (getRollData on each
   * resource), but works a "uses" maximum out with no roll data at all: a
   * class table's formula - round(@classes.rogue.level/2), @prof,
   * max(@wis.mod,1) - cannot be, and goes into the roll as it is written, its
   * @ references unread, so Sneak Attack still did not roll. Such a figure is
   * worked out here with the actor's own data.
   * At init: before anything is rolled.
   */
  static resourceFormulas() {
    if (this.#done.has('resourceFormulas')) return;
    this.#done.add('resourceFormulas');
    const proto = CONFIG.Actor?.documentClass?.prototype;
    const original = proto?.getRollData;
    if (typeof original !== 'function') return;
    const Model = foundry.abstract.DataModel;
    const seen = new WeakSet();
    const busy = new Set();
    /* The figure; `this` is the resource. */
    function figure() {
      const key = this.slug || this.name || '';
      if (busy.has(key)) return '0';
      busy.add(key);
      try {
        if (this.type === 'counter') return String(Number(this.value) || 0);
        if (this.type === 'dice' && typeof this.getFormula === 'function') return String(this.getFormula(1));
        const raw = String(this.max ?? '').trim();
        if (!raw) return String(Number(this.value) || 0);
        const actor = this.parent instanceof Actor ? this.parent : (this.getNearestDocument?.() ?? null);
        const data = actor?.getRollData?.() ?? {};
        try {
          const n = game.a5e?.utils?.getDeterministicBonus?.(raw, data, { strict: true });
          if (n !== null && n !== undefined && n !== '' && Number.isFinite(Number(n))) return String(n);
        } catch { /* dice: kept as dice, as 1.4 kept them */ }
        return Roll.replaceFormulaData(raw, data, { missing: '0' }).trim() || '0';
      } catch { return '0'; }
      finally { busy.delete(key); }
    }
    /* 1.5.1: a figure left as a formula with references in it */
    const worked = (formula, data) => {
      try {
        const n = game.a5e?.utils?.getDeterministicBonus?.(formula, data, { strict: true });
        if (n !== null && n !== undefined && n !== '' && Number.isFinite(Number(n))) return Number(n);
      } catch { /* dice: kept as dice */ }
      return Roll.replaceFormulaData(formula, data, { missing: '0' }).trim() || '0';
    };
    proto.getRollData = function getRollData(...args) {
      const data = original.apply(this, args);
      try {
        for (const [slug, resource] of Object.entries(data?.resource ?? {})) {
          if (typeof resource === 'string' && resource.includes('@')) {
            data.resource[slug] = worked(resource, data);
            continue;
          }
          if (!(resource instanceof Model)) continue;
          const kind = Object.getPrototypeOf(resource);
          if (seen.has(kind)) continue;
          seen.add(kind);
          if (Object.hasOwn(kind, 'toString')) continue;
          Object.defineProperty(kind, 'toString', { value: figure, configurable: true, writable: true });
          AM.log(3, `a5e fix: a ${resource.type ?? 'named'} resource read whole in a formula gives its figure`);
        }
      } catch { /* the roll data as a5e made it */ }
      return data;
    };
  }

  /**
   * a5e 1.5.0: a resource a class grants is only prepared data until its
   * entry is stored, and a value written to a resource with no stored entry
   * is dropped without a word - by a5e's own consumers and rests as much as
   * by any sheet. a5e stores the entry when its grant window applies the
   * grant; its packs ship every one of those grants marked as applied
   * already (all 132, from its own migration script), so a builder that
   * leaves applied grants alone never stores them, and its migration of 1.4
   * characters stored only the resources a character had once spent. A
   * Berserker made or migrated under 1.5.0 shows Rage 0/2 and can neither
   * spend nor regain it. Found 2026-11-11.
   * The entry is stored, full - what 1.4 showed for a resource never spent -
   * for every granted resource that has none: at ready on the GM's client,
   * when an item with a resource grant is added (by whoever added it), and
   * by Fill In.
   * @returns {Promise<string[]>} the names of the resources stored
   */
  static async resourceEntries(actor) {
    if (!actor?.isOwner || !foundry.utils.isNewerVersion(game.system?.version ?? '0', '1.4.999')) return [];
    const grants = actor.grants?.byType?.('resource') ?? [];
    if (!grants.length) return [];
    const stored = actor._source?.system?.resources ?? {};
    if ('classResources' in stored) return [];   // not migrated yet
    const update = {}, names = [];
    let data = null;
    for (const grant of grants) {
      const slug = grant.config?.slug || grant.name?.slugify?.({ strict: true }) || '';
      const key = `system.resources.${slug}`;
      if (!slug || slug in stored || key in update) continue;
      const type = grant.config?.type || 'uses';
      let value = 0;
      if (type !== 'counter') {
        data ??= actor.getRollData();
        try {
          value = Number(game.a5e?.utils?.getDeterministicBonus?.(String(actor.system?.resources?.[slug]?.max ?? ''), data, { strict: true })) || 0;
        } catch { value = 0; }
      }
      update[key] = { name: grant.name || slug, slug, type, value: Math.max(0, value) };
      names.push(grant.name || slug);
    }
    if (!names.length) return [];
    await actor.update(update);
    AM.log(3, `${actor.name}: class resources stored - ${names.join(', ')}`);
    return names;
  }

  /** resourceEntries for the world at ready, and for each item that brings a resource grant. */
  static resourceEntriesWatch() {
    if (this.#done.has('resourceEntries')) return;
    this.#done.add('resourceEntries');
    if (!foundry.utils.isNewerVersion(game.system?.version ?? '0', '1.4.999')) return;
    const waiting = new Map();
    const later = (actor) => {
      if (!actor || waiting.has(actor.uuid)) return;
      waiting.set(actor.uuid, setTimeout(() => {
        waiting.delete(actor.uuid);
        this.resourceEntries(actor).catch((err) => AM.log(2, `Class resources of ${actor.name}:`, err));
      }, 400));
    };
    const brings = (item) => Object.values(item?._source?.system?.grants ?? {}).some((g) => (g?.type ?? g?.grantType) === 'resource');
    Hooks.on('createItem', (item, _options, userId) => {
      if (userId === game.user.id && item.parent instanceof Actor && brings(item)) later(item.parent);
    });
    if (!game.user?.isGM || game.users?.activeGM?.id !== game.user.id) return;
    for (const actor of game.actors ?? []) {
      if (actor.items.some(brings)) later(actor);
    }
  }

  /**
   * a5e 1.4.10 and 1.5.0: an action's quantity consumer - a potion drunk, a
   * kit's uses kept as its quantity - spends nothing. getConsumersByType files
   * it under hitDice (`quantity: grouped.hitDice?.at(0)`, a line copied from
   * the one above), so what a5e consumes never includes it. a5e's own issue
   * #714, open since 2026-11-09. Put right only while the line is wrong.
   * At ready.
   */
  static quantityConsumers() {
    if (this.#done.has('quantityConsumers')) return;
    this.#done.add('quantityConsumers');
    let model = null;
    for (const data of Object.values(CONFIG.Item?.dataModels ?? {})) {
      const field = data?.schema?.fields?.actions;
      const cls = field?.element?.model ?? field?.model ?? null;
      if (typeof cls?.prototype?.getConsumersByType === 'function') { model = cls; break; }
    }
    const proto = model?.prototype;
    const original = proto?.getConsumersByType;
    if (typeof original !== 'function') return;
    if (!/quantity\s*:\s*[\w$]+\.hitDice\b/.test(String(original))) return;
    proto.getConsumersByType = function getConsumersByType(...args) {
      const grouped = original.apply(this, args);
      try {
        if (grouped && typeof grouped === 'object') {
          grouped.quantity = Object.values(this.consumers ?? {}).find((c) => c?.type === 'quantity') ?? null;
        }
      } catch { /* a5e's answer */ }
      return grouped;
    };
    AM.log(3, 'a5e fix: quantity consumers spend what they name');
  }

  /**
   * Attack rolls against a paralyzed creature have advantage - a5e's own
   * description says so - but its automation gives them disadvantage:
   * conditionChanges.paralyzed grants rollMode.attack.all -1, where blinded,
   * stunned, restrained and unconscious all grant +1. Found 2026-10-20.
   * Put right in place: a5e's condition manager holds this very array and
   * builds each new paralyzed effect from it.
   */
  static paralyzedAdvantage() {
    const change = (CONFIG.A5E?.conditionChanges?.paralyzed ?? [])
      .find?.((c) => c?.key === 'flags.a5e.effects.grants.rollMode.attack.all');
    if (!change || Number(change.value) !== -1) return;
    change.value = 1;
    AM.log(3, 'a5e fix: attacks against a paralyzed creature have advantage');
  }

  /**
   * A dice term wrapped whole in parentheses - "((@classResources.sneak-attack)d6)",
   * the form a5e's packs give Sneak Attack, Backstab, Improved Backstab,
   * Ideologue and Legbreaker - with the outer pair taken off. Anything else is
   * returned as it is.
   */
  static simplifyDiceFormula(formula) {
    const text = String(formula ?? '').trim();
    if (!text.startsWith('(') || !text.endsWith(')')) return formula;
    let depth = 0;
    for (let i = 0; i < text.length; i++) {
      if (text[i] === '(') depth++;
      else if (text[i] === ')') {
        depth--;
        if (depth === 0 && i < text.length - 1) return formula;    // the first pair closes early
      }
    }
    const inner = text.slice(1, -1).trim();
    return /^\(.*\)\s*d\s*\d+[a-z0-9]*$/i.test(inner) ? inner : formula;
  }

  /**
   * a5e 1.4 (1.4.1 - 1.4.4 at least): a damage bonus whose formula is a dice
   * term wrapped whole in parentheses stops the attack it is added to. a5e
   * builds every damage roll's critical twin at once, cloning the bonus term
   * after its inner roll has been evaluated, and Foundry refuses to evaluate it
   * again ("The Roll has already been evaluated and is now immutable") - so the
   * attack never reaches the chat. Reported 2026-10-08: "with Sneak Attack
   * ticked the attack does not roll". Without the outer pair the same dice are
   * a plain dice term, and the roll and its critical work: "(1)d6[Sneak Attack]".
   *
   * Taken off in three places: in memory as every client prepares an actor,
   * so the attack rolls whatever is stored and whoever rolls it; where a5e or
   * this module writes such a bonus; and in what is stored - once at load on
   * the GM's client, and by the sheet's Fill In for one character. The memory
   * one does not wait for either: reported again 2026-10-09, "the attack still
   * does not roll", after a release that fixed only what is stored.
   */
  static damageBonusFormulas() {
    if (this.#done.has('damageBonusFormulas')) return;
    this.#done.add('damageBonusFormulas');
    const fix = (bonus) => {
      if (!bonus || typeof bonus !== 'object' || typeof bonus.formula !== 'string') return;
      const simple = this.simplifyDiceFormula(bonus.formula);
      if (simple !== bonus.formula) bonus.formula = simple;
    };
    const DAMAGE = /^system\.bonuses\.damage\.[^.]+$/;
    const FORMULA = /^system\.bonuses\.damage\.[^.]+\.formula$/;
    Hooks.on('preUpdateActor', (_actor, changes) => {
      for (const [key, value] of Object.entries(changes ?? {})) {
        if (DAMAGE.test(key)) fix(value);
        else if (FORMULA.test(key) && typeof value === 'string') changes[key] = this.simplifyDiceFormula(value);
      }
      for (const bonus of Object.values(changes?.system?.bonuses?.damage ?? {})) fix(bonus);
    });

    // In memory: the prepared bonuses, which a5e's BonusesManager reads to roll
    const proto = CONFIG.Actor?.documentClass?.prototype;
    const prepare = proto?.prepareBaseData;
    if (typeof prepare === 'function') {
      proto.prepareBaseData = function prepareBaseData(...args) {
        const result = prepare.apply(this, args);
        try { for (const bonus of Object.values(this.system?.bonuses?.damage ?? {})) fix(bonus); }
        catch { /* the stored formula stands */ }
        return result;
      };
      for (const actor of game.actors ?? []) {
        for (const bonus of Object.values(actor.system?.bonuses?.damage ?? {})) fix(bonus);
      }
    }

    if (!game.user?.isGM) return;
    for (const actor of game.actors ?? []) {
      this.storeDamageFormulas(actor).catch((err) => AM.log(2, `Damage bonus formulas of ${actor.name}:`, err));
    }
  }

  /**
   * One character's stored damage bonuses in the plain form - read from the
   * stored data, as the prepared copy is plain already.
   * @returns {Promise<string[]>} the names of the bonuses put right
   */
  static async storeDamageFormulas(actor) {
    const update = {}, names = [];
    for (const [id, bonus] of Object.entries(actor?._source?.system?.bonuses?.damage ?? {})) {
      const simple = this.simplifyDiceFormula(bonus?.formula);
      if (simple === bonus?.formula) continue;
      update[`system.bonuses.damage.${id}.formula`] = simple;
      names.push(bonus?.label || 'damage bonus');
    }
    if (names.length) await actor.update(update);
    return names;
  }

  /**
   * a5e 1.4.0 - 1.4.1: a skill's expertise dice from grants are read off
   * `grant.expertiseDiceData` (1.3's record) in prepareSkills, so no expertise
   * die grant counted at all - Loot Runner's Athletics, Famous, Hawkeye,
   * Widely Learned (found 2026-10-07). a5e 1.4.2 reads the 1.4 record
   * (`applied`); this adds the same, only where prepareSkills still has the
   * old read, and redraws the characters prepared before it.
   */
  static skillExpertise() {
    if (this.#done.has('skillExpertise')) return;
    this.#done.add('skillExpertise');
    const proto = CONFIG.Actor?.documentClass?.prototype;
    const original = proto?.prepareSkills;
    if (typeof original !== 'function' || !String(original).includes('expertiseDiceData')) return;
    proto.prepareSkills = function prepareSkills(...args) {
      const result = original.apply(this, args);
      try {
        const grants = this.grants?.byType?.('expertiseDice')
          ?.filter((g) => g?.applied?.isApplied && g.applied.expertiseType === 'skill') ?? [];
        if (grants.length) {
          for (const [key, skill] of Object.entries(this.system?.skills ?? {})) {
            const add = grants.reduce((n, g) => n + ((g.applied.selected ?? []).includes(key) ? (Number(g.applied.expertiseCount) || 1) : 0), 0);
            if (add) skill.expertiseDice = Math.min(5, Math.max(0, (Number(skill.expertiseDice) || 0) + add));
          }
        }
      } catch { /* leave a5e's figure */ }
      return result;
    };
    for (const actor of game.actors ?? []) {
      if (actor.type === 'character') { try { actor.reset(); } catch { /* next prepare */ } }
    }
    AM.log(3, 'a5e fix applied: skill expertise dice from 1.4 grant records');
  }

  /**
   * a5e 1.4.0 - 1.4.4 (at least): ActorGrantsManager#getGrantedTraits reads
   * `grant.traitData`, a field of 1.3's actor grant records that 1.4's item
   * grants do not have (its own source marks the method "TODO - Needs
   * fixing"). It runs when the languages, resistances, immunities or
   * vulnerabilities window draws its "Granted by" tooltips, and throws as soon
   * as the character has any applied trait grant - a culture's languages are
   * one - so the window never opens. Reported 2026-10-06: "the languages cog
   * does not work", on this module's sheet and a5e's alike.
   *
   * The replacement reads what 1.4 records instead: the applied trait type and
   * the traits selected, on the grant's own item.
   */
  static grantedTraits(actor) {
    if (this.#done.has('grantedTraits')) return;
    const manager = actor?.grants;
    const proto = manager && Object.getPrototypeOf(manager);
    const original = proto?.getGrantedTraits;
    if (typeof original !== 'function') return;
    this.#done.add('grantedTraits');
    if (!String(original).includes('traitData')) return;      // a5e's own works

    proto.getGrantedTraits = function getGrantedTraits(type) {
      const out = {};
      const grants = typeof this.byAppliedType === 'function'
        ? this.byAppliedType('trait')
        : [...this.values()].filter((g) => g?.applied?.grantType === 'trait');
      for (const grant of grants) {
        const applied = grant?.applied ?? {};
        const traitType = applied.traitType || grant?.config?.traits?.traitType || '';
        if (traitType !== type) continue;
        out[grant.fullId ?? grant.id] = {
          itemId: grant.item?.uuid ?? '',
          traits: [...(applied.selected ?? [])]
        };
      }
      return out;
    };
    AM.log(3, 'a5e fix applied: ActorGrantsManager#getGrantedTraits reads 1.4 grant records');
  }
}
