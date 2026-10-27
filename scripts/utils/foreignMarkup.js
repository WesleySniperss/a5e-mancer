import { AM } from '../am.js';
import { NamedDocs } from './namedDocs.js';

/**
 * Markup of other systems in a5e text, made readable.
 *
 * Asked 2026-10-10: no roll formulas in descriptions - or written so we can
 * read them, without heaps of brackets. The user's world holds text brought
 * in through Plutonium and 5etools for dnd5e - [[/damage 5d10 type=fire]],
 * &Reference[condition=invisible], @spell[hellish rebuke],
 * @variantrule[Advantage|XPHB], @skill[Arcana], {@dice 1d6} - and a5e reads
 * none of it: its own enrichers are [[/check]], [[/save]], [[/condition]] and
 * [[/ref]], Foundry's [[/r]] and @UUID. So it showed as typed, brackets and
 * all, in chat cards, sheets and journals. Counted in that world: some 160
 * /damage, 220 &Reference, 500 @tag[...] - and a5e's own 5e spell pack keeps
 * 5etools' {@dice} as it came.
 *
 * Registered as Foundry text enrichers, so every enrichHTML reads them:
 *   [[/damage 5d10 type=fire]]      a roll of 5d10, labelled "5d10 fire"
 *   &Reference[condition=x], @condition[x], {@condition x}
 *                                   a5e's condition link where a5e has it
 *   @skill[Arcana], {@skill Arcana} a5e's skill check button
 *   @spell / @item / @feat / @class [Name|source|shown]
 *                                   a link to the document of that name, else the name
 *   @creature[Name|source|shown]    a link to the creature of that name, else the name
 *   any other @tag[Name|source|shown]  the name, plain
 *   {@dice 1d6}, {@damage 2d8}      a roll; {@hit 5} "+5"; {@dc 13} "DC 13"
 * And `readable(text)` puts all of it - and Foundry's and a5e's own - into
 * plain words, for the summaries drawn as text (the sheet's row snippets).
 */
export class ForeignMarkup {

  static #TAGS = 'spell|item|feat|class|subclass|background|race|species|creature|optfeature|variantrule|action|hazard|sense|status|disease|language|deity|table|object|vehicle|trap|reward|boon|cult|psionic|book|adventure|quickref|itemMastery|card|deck|filter|condition|skill|recipe|charoption|facility|bastion';

  /** Document links worth looking up, and the item type each names. */
  static #LINKED = { spell: 'spell', item: 'object', feat: 'feature', class: 'class' };

  static #TYPES = ['acid', 'bludgeoning', 'cold', 'fire', 'force', 'lightning', 'necrotic', 'piercing',
    'poison', 'psychic', 'radiant', 'slashing', 'thunder', 'healing', 'temphp', 'temporary'];

  /* ── registration ─────────────────────────────────────── */

  static register() {
    const enrichers = CONFIG.TextEditor?.enrichers;
    if (!Array.isArray(enrichers) || enrichers.some(e => e?.amForeign)) return;
    const tags = this.#TAGS;
    enrichers.push(
      { amForeign: true, pattern: /\[\[\/damage\s+([^\]]*)\]\](?:\{([^}]*)\})?/gi,
        enricher: (m, o) => this.#damage(m[1], m[2], o) },
      { amForeign: true, pattern: /&Reference\[([^\]]+)\](?:\{([^}]*)\})?/gi,
        enricher: (m, o) => this.#condition(this.#referenceKey(m[1]), m[2], o) },
      { amForeign: true, pattern: new RegExp(`@(${tags})\\[([^\\]]+)\\](?:\\{([^}]*)\\})?`, 'g'),
        enricher: (m, o) => this.#tag(m[1], m[2], m[3], o) },
      { amForeign: true, pattern: /\{@(\w+)\s+([^{}]*)\}/g,
        enricher: (m, o) => this.#fiveTools(m[1], m[2], o) }
    );
    AM.log(3, 'Text enrichers for dnd5e and 5etools markup registered');
  }

  /* ── enrichers ────────────────────────────────────────── */

  static #span(text, cls = 'am-ref') {
    const span = document.createElement('span');
    span.className = cls;
    span.textContent = text;
    return span;
  }

  /** Foundry's or a5e's own markup, enriched by them: the element it makes. */
  static async #via(markup, options, fallback) {
    try {
      const TE = foundry.applications?.ux?.TextEditor?.implementation ?? globalThis.TextEditor;
      const html = await TE.enrichHTML(markup, { ...(options ?? {}), async: true });
      const box = document.createElement('div');
      box.innerHTML = html;
      const el = box.firstElementChild;
      if (el && box.childElementCount === 1 && !box.textContent.includes('[[')) return el;
    } catch (err) { AM.log(2, `Markup ${markup} could not be read:`, err); }
    return this.#span(fallback);
  }

  /** dnd5e's damage arguments: "5d10 type=fire", "2d6 fire & 1d4 cold", "formula=1d6 type=fire average". */
  static parseDamage(args) {
    const parts = String(args ?? '').split(/\s*&\s*/).map(part => {
      const words = part.trim().split(/\s+/).filter(Boolean);
      let formula = '', type = '';
      for (const w of words) {
        const [k, v] = w.includes('=') ? w.split('=') : [null, w];
        if (k === 'formula') formula += (formula ? ' ' : '') + v;
        else if (k === 'type') type = v.replace(/[/|]/g, ' or ');
        else if (k) continue;                                     // average=true, extended...
        else if (this.#TYPES.includes(v.toLowerCase())) type = v.toLowerCase();
        else if (!/^(average|extended|attack)$/i.test(v)) formula += (formula ? ' ' : '') + v;
      }
      return { formula: formula.trim(), type };
    }).filter(p => p.formula);
    return {
      formula: parts.map(p => p.formula).join(' + '),
      label: parts.map(p => [p.formula, p.type].filter(Boolean).join(' ')).join(' + ')
    };
  }

  static async #damage(args, shown, options) {
    const { formula, label } = this.parseDamage(args);
    const text = shown || label || String(args ?? '').trim();
    if (!formula) return this.#span(text);
    return this.#via(`[[/r ${formula}]]{${text}}`, options, text);
  }

  /** &Reference[condition=prone], &Reference[prone apply=false] -> prone */
  static #referenceKey(args) {
    const words = String(args ?? '').trim().split(/\s+/);
    const first = words[0] ?? '';
    return (first.includes('=') ? first.split('=')[1] : first).toLowerCase();
  }

  /** a5e's condition link for a condition's key ("poisoned"), for links that name one. */
  static conditionElement(key, shown, options) {
    return this.#condition(key, shown, options);
  }

  static async #condition(key, shown, options) {
    const id = String(key ?? '').trim().toLowerCase();
    const text = shown || id;
    if (id && CONFIG.A5E?.conditions?.[id]) return this.#via(`[[/condition id=${id}]]`, options, text);
    return this.#span(text);
  }

  static #skillKey(name) {
    const want = String(name ?? '').trim().toLowerCase();
    for (const [key, label] of Object.entries(CONFIG.A5E?.skills ?? {})) {
      const text = typeof label === 'string' ? game.i18n.localize(label) : (label?.label ? game.i18n.localize(label.label) : '');
      if (key === want || text.toLowerCase() === want) return key;
    }
    return null;
  }

  static async #tag(tag, args, shown, options) {
    const parts = String(args ?? '').split('|').map(s => s.trim());
    const name = parts[0] ?? '';
    const text = shown || parts[2] || name;
    const t = tag.toLowerCase();
    if (t === 'condition') return this.#condition(name, text, options);
    if (t === 'skill') {
      const key = this.#skillKey(name);
      // Labelled with the skill alone: a5e's own label adds "Check", and the text goes on "check"
      return key ? this.#via(`[[/check skill=${key} label="${text.replace(/"/g, '')}"]]`, options, text) : this.#span(text);
    }
    // a5e's own packs win a name (namedDocs.js): @spell[Fireball|XPHB] is a5e's Fireball
    const type = this.#LINKED[t];
    const uuid = t === 'creature' ? NamedDocs.uuidOf('Actor', name, { plural: true })
      : type ? NamedDocs.uuidOf('Item', name, { type }) : null;
    return uuid ? this.#via(`@UUID[${uuid}]{${text}}`, options, text) : this.#span(text);
  }

  static async #fiveTools(tag, args, options) {
    const t = tag.toLowerCase();
    const parts = String(args ?? '').split('|').map(s => s.trim());
    const first = parts[0] ?? '';
    if (t === 'dice' || t === 'damage' || t === 'scaledice' || t === 'scaledamage') {
      const formula = t.startsWith('scale') ? (parts[2] ?? first) : first;
      return Roll.validate(formula) ? this.#via(`[[/r ${formula}]]{${parts[t.startsWith('scale') ? 3 : 1] || formula}}`, options, formula) : this.#span(formula);
    }
    if (t === 'hit') return this.#span(`${Number(first) >= 0 ? '+' : ''}${first}`);
    if (t === 'dc') return this.#span(`DC ${first}`);
    if (t === 'b' || t === 'bold') { const b = document.createElement('strong'); b.textContent = first; return b; }
    if (t === 'i' || t === 'italic') { const i = document.createElement('em'); i.textContent = first; return i; }
    // {@spell fireball|XPHB|Fireball} reads as @spell[fireball|XPHB|Fireball]
    return this.#tag(t, args, null, options);
  }

  /* ── plain words ──────────────────────────────────────── */

  /** "@spellcasting.mod" -> "spellcasting mod", "@abilities.str.mod" -> "str mod" */
  static #words(formula) {
    return String(formula ?? '').replace(/@([\w.\-]+)/g, (_, path) => {
      const bits = path.split('.').filter(b => !['abilities', 'attributes', 'system', 'details', 'classResources'].includes(b));
      return bits.slice(-2).join(' ').replace(/-/g, ' ');
    }).replace(/\s+/g, ' ').trim();
  }

  /**
   * Text with every kind of markup - Foundry's, a5e's, dnd5e's, 5etools' -
   * turned into the words it stands for. HTML is left for the caller to strip.
   */
  static readable(text) {
    const ability = (a) => (a ? a.charAt(0).toUpperCase() + a.slice(1, 3) : '');
    return String(text ?? '')
      .replace(/@Embed\[[^\]]*\](\{[^}]*\})?/g, '')
      .replace(/@UUID\[([^\]]+)\]\{([^}]*)\}/g, '$2')
      .replace(/@UUID\[([^\]]+)\]/g, (_, uuid) => { try { return fromUuidSync(uuid)?.name ?? ''; } catch { return ''; } })
      .replace(/\[\[\/damage\s+([^\]]*)\]\](?:\{([^}]*)\})?/gi, (_, args, shown) => shown || this.parseDamage(args).label)
      .replace(/\[\[\/condition\s+id=([\w-]+)([^\]]*)\]\](?:\{([^}]*)\})?/gi, (_, id, args, shown) => shown || args.match(/label="([^"]*)"/i)?.[1] || id)
      .replace(/\[\[\/save\s+([^\]]*)\]\](?:\{([^}]*)\})?/gi, (_, args, shown) => {
        if (shown) return shown;
        const dc = args.match(/dc=(\d+)/i)?.[1], ab = args.match(/ability=(\w+)/i)?.[1];
        return [dc ? `DC ${dc}` : '', ability(ab), 'save'].filter(Boolean).join(' ');
      })
      .replace(/\[\[\/check\s+([^\]]*)\]\](?:\{([^}]*)\})?/gi, (_, args, shown) => {
        if (shown) return shown;
        const label = args.match(/label="([^"]*)"/i)?.[1];
        if (label) return label;
        const skill = args.match(/skill=(\w+)/i)?.[1], ab = args.match(/ability=(\w+)/i)?.[1];
        const skillName = skill && CONFIG.A5E?.skills?.[skill] ? game.i18n.localize(CONFIG.A5E.skills[skill]) : skill;
        return [skillName || ability(ab), 'check'].filter(Boolean).join(' ');
      })
      .replace(/\[\[\/ref\s+([^\]]*)\]\](?:\{([^}]*)\})?/gi, (_, args, shown) => shown || (args.match(/(?:id|name)=(\S+)/i)?.[1] ?? args))
      .replace(/\[\[\/r(?:oll)?\s*([^\]]*)\]\](?:\{([^}]*)\})?/gi, (_, f, shown) => shown || this.#words(f))
      .replace(/\[\[([^\]]+)\]\](?:\{([^}]*)\})?/g, (_, f, shown) => shown || this.#words(f))
      .replace(/&Reference\[([^\]]+)\](?:\{([^}]*)\})?/gi, (_, args, shown) => shown || this.#referenceKey(args))
      .replace(new RegExp(`@(?:${this.#TAGS})\\[([^\\]]+)\\](?:\\{([^}]*)\\})?`, 'g'), (_, args, shown) => {
        const p = args.split('|').map(s => s.trim());
        return shown || p[2] || p[0];
      })
      .replace(/\{@(\w+)\s+([^{}]*)\}/g, (_, tag, args) => {
        const p = args.split('|').map(s => s.trim());
        if (tag === 'hit') return `${Number(p[0]) >= 0 ? '+' : ''}${p[0]}`;
        if (tag === 'dc') return `DC ${p[0]}`;
        if (tag === 'scaledice' || tag === 'scaledamage') return p[3] || p[2] || p[0];
        if (tag === 'dice' || tag === 'damage') return p[1] || p[0];
        return p[2] || p[0];
      });
  }
}
