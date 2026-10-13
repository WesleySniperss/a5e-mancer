import { AM } from '../am.js';

/**
 * What an item's chat card says about it: range, target, area, components.
 *
 * Reported 2026-10-12: cards rolled from the sheet show no exact range, no
 * radius and no components. Two reasons, both a5e's:
 *   - most spells on the user's characters are stubs - in their world 190 of
 *     213 have no description, 199 no components, 38 actions with no range,
 *     and Lightning Bolt and Cone of Cold have no area - so a5e's card, built
 *     from the item, has nothing to say. The sheet shows these from the
 *     compendium entry the stub came from; the card did not.
 *   - an action's card never lists components: a5e passes hideSpellComponents
 *     and builds an action card's summary from the action alone.
 *
 * So the card is completed as it is created (preCreateChatMessage), from the
 * item and, where the item has nothing, from its compendium entry - read
 * before the item is used (activate / shareItemDescription are wrapped to
 * fetch it once and keep it), so the hook, which cannot wait, has it. The
 * card's damage line reads as dice and numbers - "1d4 + 3 piercing", not
 * "1d4 + @finesse.mod[Piercing]". Nothing is written to the item: the
 * sheet's Fill In does that for good (ItemRepair).
 */
export class CardSummary {

  static #docs = new Map();      // source uuid -> document (or null)
  static #pending = new Map();   // source uuid -> Promise
  static #texts = new Map();     // `${uuid}|${actorId}` -> enriched description

  static sourceOf(item) {
    return item?._stats?.compendiumSource ?? item?.flags?.core?.sourceId ?? '';
  }

  static #descOf(sys) {
    const d = sys?.description;
    return typeof d === 'string' ? d : (d?.value ?? '');
  }

  static #hasText(html) {
    return String(html ?? '').replace(/<[^>]*>/g, '').replace(/&[a-z]+;/gi, ' ').trim().length > 0;
  }

  /** Does this item lack something its compendium entry may have? */
  static #lacking(item) {
    if (!item || !this.sourceOf(item)) return false;
    if (!this.#hasText(this.#descOf(item.system))) return true;
    if (item.type === 'spell' && !Object.values(item.system?.components ?? {}).some(Boolean)) return true;
    return Object.values(item.system?.actions ?? {}).some(a => !Object.keys(a?.ranges ?? {}).length || !a?.target?.type);
  }

  /** Is everything the card may need already at hand? */
  static ready(item) {
    if (!this.#lacking(item)) return true;
    const uuid = this.sourceOf(item);
    return this.#docs.has(uuid) && (!item.actor || this.#texts.has(`${uuid}|${item.actor.id}`) || !this.#docs.get(uuid));
  }

  /** Read the item's compendium entry, once, and its description enriched for the item's actor. */
  static async warm(item) {
    if (!this.#lacking(item)) return null;
    const uuid = this.sourceOf(item);
    if (!this.#pending.has(uuid)) {
      this.#pending.set(uuid, (async () => {
        let doc = null;
        try { doc = await fromUuid(uuid); } catch { doc = null; }
        this.#docs.set(uuid, doc ?? null);
        return doc;
      })());
    }
    const doc = await this.#pending.get(uuid);
    const key = `${uuid}|${item.actor?.id ?? ''}`;
    if (doc && !this.#texts.has(key)) {
      const html = this.#descOf(doc.system);
      let text = '';
      if (this.#hasText(html)) {
        try {
          const TE = foundry.applications?.ux?.TextEditor?.implementation ?? globalThis.TextEditor;
          text = await TE.enrichHTML(html, { secrets: false, relativeTo: item, rollData: item.actor?.getRollData?.(item) ?? {} });
        } catch { text = html; }
      }
      this.#texts.set(key, text);
    }
    return doc;
  }

  /* ── labels, as a5e writes them (utils/summaries) ─────── */

  static #t(key, data) {
    try { return data ? game.i18n.format(key, data) : game.i18n.localize(key); } catch { return ''; }
  }

  static rangeLabel(action) {
    const ranges = action?.ranges;
    if (!ranges || !Object.keys(ranges).length) return '';
    const { distanceAbbreviations: abbr = {}, rangeValues: values = {}, rangeDescriptors: desc = {} } = CONFIG.A5E ?? {};
    const say = (k) => this.#t(desc[k] ?? k) || k;
    return Object.values(ranges).map(({ range, unit }) => {
      if (['short', 'medium', 'long'].includes(range)) return `${say(range)} (${values[range]} ${this.#t(abbr.feet ?? 'ft.')})`;
      if (['fiveFeet', 'self', 'touch'].includes(range)) return say(range);
      return unit ? `${range} ${this.#t(abbr[unit] ?? unit)}` : String(range ?? '');
    }).filter(Boolean).join(', ');
  }

  static #positive(v) {
    const n = typeof v === 'string' ? parseInt(v, 10) : Number(v);
    return n > 0;
  }

  static areaLabel(action) {
    const a = action?.area;
    if (!a?.shape || (a.quantity ?? 1) <= 0) return '';
    const s = a.shape;
    if ((s === 'cone' || s === 'wall') && !this.#positive(a.length)) return '';
    if ((s === 'cube' || s === 'square') && !this.#positive(a.width)) return '';
    if (['circle', 'cylinder', 'emanation', 'sphere'].includes(s) && !this.#positive(a.radius)) return '';
    if (s === 'line' && (!this.#positive(a.length) || !this.#positive(a.width ?? 5))) return '';
    const L = (k, d) => this.#t(`A5E.area.${k}`, d);
    let text = '';
    if (s === 'circle') text = L('circleSpecific', { radius: a.radius });
    else if (s === 'cone') text = L('coneSpecific', { length: a.length });
    else if (s === 'cube') text = L('cubeSpecific', { width: a.width });
    else if (s === 'cylinder' && a.height) text = L('cylinderSpecific', { height: a.height, radius: a.radius });
    else if (s === 'cylinder') text = L('cylinderSpecificNoHeight', { radius: a.radius });
    else if (s === 'emanation') text = L('emanationSpecific', { radius: a.radius });
    else if (s === 'line') text = L('lineSpecific', { width: a.width ?? 5, length: a.length });
    else if (s === 'sphere') text = L('sphereSpecific', { radius: a.radius });
    else if (s === 'square') text = L('squareSpecific', { width: a.width });
    else if (s === 'wall' && a.height && a.width) text = L('wallSpecific', { height: a.height, length: a.length, width: a.width });
    else if (s === 'wall' && a.height) text = L('wallSpecificNoWidth', { height: a.height, length: a.length });
    else if (s === 'wall' && a.width) text = L('wallSpecificNoHeight', { length: a.length, width: a.width });
    else if (s === 'wall') text = L('wallSpecificNoWidthOrHeight', { length: a.length });
    if (text && a.quantity > 1) text += ` (× ${a.quantity})`;
    return text;
  }

  static targetLabel(action) {
    const t = action?.target;
    if (!t?.type || t.type === 'none') return '';
    const C = CONFIG.A5E ?? {};
    let how = '';
    if (t.heard && !t.seen) how = ` (${this.#t('A5E.targets.heard')})`;
    else if (t.seen && !t.heard) how = ` (${this.#t('A5E.targets.seen')})`;
    else if (t.heard && t.seen) how = ` (${this.#t('A5E.targets.heard')} or ${this.#t('A5E.targets.seen')})`;
    if (t.type === 'self') return this.#t('A5E.targets.self');
    if (t.type === 'other') return (t.otherText || this.#t('A5E.targets.other')) + how;
    // a5e writes "0 Creatures" for a quantity of 0 in its data (Fire Bolt): one is what the spell means
    const plural = Number(t.quantity) > 1;
    const word = plural ? C.targetTypesPlural?.[t.type] : C.targetTypes?.[t.type];
    return `${plural ? t.quantity : 1} ${this.#t(word ?? t.type)}${how}`;
  }

  static componentsLabel(item) {
    const comps = item?.system?.components ?? {};
    const abbr = CONFIG.A5E?.spellComponentAbbreviations ?? {};
    const list = Object.entries(comps).filter(([, on]) => on).map(([k]) => this.#t(abbr[k] ?? k)).join(', ');
    const materials = typeof item?.system?.materials === 'string' ? item.system.materials.trim() : '';
    return list && materials ? `${list} (${materials})` : list;
  }

  /**
   * A formula in dice and numbers: roll data put in, flavour tags taken out,
   * the numbers added up - "1d4 + @finesse.mod[Piercing]" with a +3 Dex is
   * "1d4 + 3". Anything it cannot reduce safely is returned with only the
   * data filled in.
   */
  static readableFormula(formula, rollData = {}) {
    let text = String(formula ?? '').trim();
    if (!text) return '';
    try { text = Roll.replaceFormulaData(text, rollData, { missing: '0' }); } catch { /* as it is */ }
    text = text.replace(/\[[^\]]*\]/g, '').replace(/\s+/g, ' ').trim();
    try {
      const roll = new Roll(text);
      const terms = roll.terms;
      const dice = [];
      let constant = 0, sign = 1, plain = true;
      for (const term of terms) {
        const name = term.constructor?.name;
        if (name === 'OperatorTerm') {
          if (term.operator === '+') sign = 1;
          else if (term.operator === '-') sign = -1;
          else { plain = false; break; }
        } else if (name === 'NumericTerm') {
          constant += sign * Number(term.number);
        } else if (term instanceof foundry.dice.terms.DiceTerm) {
          dice.push((sign < 0 ? '- ' : (dice.length ? '+ ' : '')) + term.formula);
        } else { plain = false; break; }
      }
      if (!plain) return text;
      const head = dice.join(' ');
      if (!head) return String(constant);
      return constant ? `${head} ${constant > 0 ? '+' : '-'} ${Math.abs(constant)}` : head;
    } catch { return text; }
  }

  /** a5e's damage line ("1d4 + @finesse.mod[Piercing], 1d6[Fire]") in plain dice and types. */
  static damageLabel(text, rollData) {
    const parts = [];
    let depth = 0, current = '';
    for (const ch of String(text ?? '')) {
      if (ch === '[' || ch === '(') depth++;
      if (ch === ']' || ch === ')') depth--;
      if (ch === ',' && depth === 0) { parts.push(current); current = ''; continue; }
      current += ch;
    }
    if (current.trim()) parts.push(current);
    return parts.map(p => {
      const m = p.trim().match(/^(.*)\[([^\]]*)\]\s*$/);
      const formula = m ? m[1] : p;
      const type = m ? m[2].trim() : '';
      const dice = this.readableFormula(formula, rollData);
      const word = type && type !== 'undefined' ? (this.#t(type) || type).toLowerCase() : '';
      return [dice, word].filter(Boolean).join(' ');
    }).filter(Boolean).join(', ');
  }

  /* ── the card ─────────────────────────────────────────── */

  /** The compendium entry's action matching the item's: same id, same name, or the only one. */
  static #matchAction(source, own, actionId) {
    const actions = source?.system?.actions ?? {};
    if (actionId && actions[actionId]) return actions[actionId];
    const list = Object.values(actions);
    if (own?.name) { const byName = list.find(a => a?.name === own.name); if (byName) return byName; }
    return list.length === 1 ? list[0] : (list[0] ?? null);
  }

  static complete(message) {
    const sys = message?.system ?? {};
    if (!sys.itemId || message.type !== 'item') return;
    let item = null;
    try { item = fromUuidSync(sys.itemId); } catch { item = null; }
    if (!item?.system) return;
    const uuid = this.sourceOf(item);
    const source = uuid ? (this.#docs.get(uuid) ?? null) : null;
    const summary = { ...(sys.summaryData && typeof sys.summaryData === 'object' ? sys.summaryData : {}) };
    const changes = {};
    const own = sys.actionId ? item.system.actions?.[sys.actionId] : null;
    const theirs = source ? this.#matchAction(source, own, sys.actionId) : null;

    if (own || theirs) {
      if (!summary.ranges) summary.ranges = this.rangeLabel(own) || this.rangeLabel(theirs);
      if (!summary.targets) summary.targets = this.targetLabel(own) || this.targetLabel(theirs);
      if (!summary.area) summary.area = this.areaLabel(own) || this.areaLabel(theirs);
    }
    if (item.type === 'spell' && !summary.spellComponents) {
      summary.spellComponents = this.componentsLabel(item) || this.componentsLabel(source);
    }
    const rollData = item.actor?.getRollData?.(item) ?? {};
    if (summary.damage) summary.damage = this.damageLabel(summary.damage, rollData);
    if (summary.attackRoll) summary.attackRoll = this.readableFormula(summary.attackRoll, rollData);

    // The text, for a stub that has none - as it would have read with it
    if (source && !this.#hasText(sys.itemDescription) && !this.#hasText(this.#descOf(item.system))) {
      const text = this.#texts.get(`${uuid}|${item.actor?.id ?? ''}`);
      if (text) changes['system.itemDescription'] = text;
    }
    message.updateSource({ 'system.summaryData': summary, ...changes });
  }

  static install() {
    if (this.installed) return;
    this.installed = true;
    Hooks.on('preCreateChatMessage', (message) => {
      try { CardSummary.complete(message); }
      catch (err) { AM.log(2, 'Card summary could not be completed:', err); }
    });
    Hooks.once('ready', () => this.#wrap());
  }

  /**
   * activate and shareItemDescription, wherever a5e defines them for each
   * item type. CONFIG.Item.documentClass is a5e's base class, and the items
   * are of its subclasses - SpellItemA5e, ObjectItemA5e - whose activate is
   * ItemA5e's: wrapped on the base class, activate went round the wrapper.
   * So each type's nearest owner of the method is found from an item of that
   * type made in memory, and wrapped once.
   */
  static #wrap() {
    const Cls = CONFIG.Item?.documentClass;
    const done = new Set();
    for (const type of Object.keys(CONFIG.Item?.dataModels ?? {})) {
      let probe = null;
      try { probe = new Cls({ name: 'probe', type }); } catch { continue; }
      for (const name of ['activate', 'shareItemDescription']) {
        let owner = Object.getPrototypeOf(probe);
        while (owner && !Object.prototype.hasOwnProperty.call(owner, name)) owner = Object.getPrototypeOf(owner);
        if (!owner || done.has(owner[name])) continue;
        const original = owner[name];
        if (typeof original !== 'function') continue;
        /* Straight through when nothing needs reading - an item's activate
           sets its roll up at once, and WeaponSpells counts on that. */
        const wrapped = function (...args) {
          if (CardSummary.ready(this)) return original.apply(this, args);
          return CardSummary.warm(this).catch(() => null).then(() => original.apply(this, args));
        };
        owner[name] = wrapped;
        done.add(original); done.add(wrapped);
      }
    }
    AM.log(3, `Card summaries: ${done.size / 2} item method(s) read their compendium entry first`);
  }
}
