import { AM } from '../am.js';
import { PackFilter } from './packFilter.js';

/**
 * Spells a5e hands out in prose.
 *
 * a5e has no grant type for spells. Of roughly 5,900 grants across its packs,
 * one points at a spell; everything else that gives a spell says so in a
 * feature's text - "You learn the Guidance cantrip", a cleric archetype's spell
 * table, "you always have see invisibility prepared", "you can cast mirror
 * image once per long rest". Neither a5e nor the builder ever added any of
 * them, so a character took the feature and not the spell.
 *
 * This reads those sentences and tables and adds the spells, once each, marked
 * always prepared: they are the feature's, not part of the class's own count,
 * which is what every one of these texts says in some form.
 *
 * It reads features and feats only. A heritage, culture, background or
 * archetype repeats the text of the features it grants, and a heritage lists
 * every gift it offers - read there, a character would receive the spells of a
 * gift they did not take.
 *
 * What it will not do is guess. A sentence offering a choice ("of your choice",
 * "choose"), a conditional ("if you know"), a feature that lists alternatives
 * ("choose one of the following"), a table chosen from rather than granted (the
 * sorcerer's archetype spells) and a warlock's expanded list (added to a list,
 * not known) are reported as choices or skipped, never added wholesale.
 *
 * The parser is pure - html and a spell lookup in, grants out - so it can be
 * checked against the packs outside Foundry. `ensure` is the Foundry side and
 * records what it granted, so a spell the player deleted is not added again.
 */
export class ProseSpells {

  static FLAG = 'proseSpells';

  static get enabled() {
    try { return game.settings.get(AM.ID, 'proseSpells') !== false; }
    catch { return true; }
  }

  static #pending = new Map();

  /**
   * Catch features that arrive by any road - a5e's own grant window for an
   * origin the builder did not take over, a feat dropped on the sheet - and a
   * class level gained outside the level-up dialog, which can bring a domain's
   * next row. Only on the client that made the change, or every connected
   * player would add the same spell. Coalesced per actor: a grant creates its
   * features in one batch.
   */
  static installHooks() {
    const schedule = (actor, userId) => {
      if (!this.enabled || userId !== game.user?.id || actor?.type !== 'character') return;
      clearTimeout(this.#pending.get(actor.id));
      this.#pending.set(actor.id, setTimeout(() => {
        this.#pending.delete(actor.id);
        this.ensure(actor).catch(err => AM.log(1, 'Spells from features could not be added:', err));
      }, 750));
    };
    Hooks.on('createItem', (item, _options, userId) => {
      if (this.TYPES.has(item.type)) schedule(item.parent, userId);
    });
    Hooks.on('updateItem', (item, changes, _options, userId) => {
      if (item.type === 'class' && foundry.utils.hasProperty(changes, 'system.classLevels')) schedule(item.parent, userId);
    });
  }

  /** Item types whose own text is read. See the class note. */
  static TYPES = new Set(['feature', 'feat']);

  /* ── the spell lookup ─────────────────────────────────── */

  static #lookup = null;

  static async lookup() {
    if (this.#lookup) return this.#lookup;
    const entries = [];
    const packs = PackFilter.itemPacks()
      .sort((a, b) => (a.metadata?.packageType === 'system' ? 0 : 1) - (b.metadata?.packageType === 'system' ? 0 : 1));
    for (const pack of packs) {
      let index;
      try { index = await pack.getIndex(); } catch { continue; }
      for (const e of index) {
        if (e.type !== 'spell') continue;
        entries.push({ id: e._id, name: e.name, img: e.img ?? '', uuid: `Compendium.${pack.collection}.Item.${e._id}` });
      }
    }
    this.#lookup = this.buildLookup(entries);
    return this.#lookup;
  }

  /**
   * @param {{id, name, uuid}[]} entries  the first of a name wins
   */
  static buildLookup(entries) {
    const byId = new Map(), byName = new Map();
    for (const e of entries) {
      if (!byId.has(e.id)) byId.set(e.id, e);
      const key = this.norm(e.name);
      if (key && !byName.has(key)) byName.set(key, e);
    }
    // Longest first, so "create or destroy water" is tried before "create"
    const names = [...byName.keys()].sort((a, b) => b.length - a.length);
    return { byId, byName, names };
  }

  static norm(s) {
    return String(s ?? '').toLowerCase().replace(/[’`]/g, "'")
      .replace(/[^a-z0-9'/ -]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  static #plain(html) {
    return String(html ?? '')
      .replace(/@UUID\[[^\]]*\]\{([^}]*)\}/g, '$1')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ').replace(/&rsquo;|&#39;/g, "'").replace(/&amp;/g, '&')
      .replace(/\s+/g, ' ').trim();
  }

  /* ── finding spell names ──────────────────────────────── */

  /** Spells linked or italicised: exact, whatever the sentence says around them. */
  static #marked(html, lookup) {
    const found = new Map();
    for (const m of String(html).matchAll(/@UUID\[Compendium\.[^\]]*?\.(?:Item\.)?([A-Za-z0-9]{16})\]/g)) {
      const s = lookup.byId.get(m[1]);
      if (s) found.set(s.id, s);
    }
    for (const m of String(html).matchAll(/<(?:em|i)>([^<]{2,60})<\/(?:em|i)>/g)) {
      const s = lookup.byName.get(this.norm(m[1]));
      if (!s) continue;
      // "the necromancy, affliction ... or scrying schools" names schools, not the spell Scrying
      const after = this.#plain(String(html).slice(m.index + m[0].length, m.index + m[0].length + 160));
      if (/^[^.]{0,60}\bschools?\b/i.test(after)) continue;
      found.set(s.id, s);
    }
    return found;
  }

  /**
   * Names written plainly after the verb that grants them - "you learn the
   * dancing lights and minor illusion cantrips", "you always have speak with
   * dead prepared", "you can cast create or destroy water once". Matched as a
   * prefix of what follows the verb, longest name first, so a list joined by
   * "and" is read name by name and ordinary words after it are not.
   */
  static #afterVerbs(text, lookup) {
    const found = new Map();
    const t = this.norm(text);
    for (const m of t.matchAll(/\b(?:learn|learns|know|gain|cast|have|has)\s+/g)) {
      let rest = t.slice(m.index + m[0].length);
      for (let guard = 0; guard < 8; guard++) {
        /* Not "a" or "an": "cast a divination spell" names a kind of spell,
           not the spell Divination. */
        rest = rest.replace(/^(?:the|spell|spells|cantrip|cantrips|power|powers|bonus)\s+/, '');
        const name = lookup.names.find(n => {
          if (!rest.startsWith(n)) return false;
          const after = rest.slice(n.length);
          // A name glued to the next word is a typo in the data only for long names
          if (after && /^[a-z]/.test(after)) return n.length >= 12;
          /* What follows has to read as the end of a spell's name. "gain
             resistance to that damage type" is not the spell Resistance. */
          const next = after.trim().split(' ')[0] ?? '';
          return !next || this.#AFTER_NAME.has(next);
        });
        if (!name) break;
        const s = lookup.byName.get(name);
        found.set(s.id, s);
        rest = rest.slice(name.length).replace(/^\S*\s*/, (w) => /^[a-z]/.test(w) ? '' : w).trim();
        const sep = /^(?:and|as|cantrips?|spells?|powers?)\s+/.exec(rest);
        if (!sep) break;
        rest = rest.slice(sep[0].length);
      }
    }
    return found;
  }

  static #AFTER_NAME = new Set(['cantrip', 'cantrips', 'spell', 'spells', 'power', 'powers', 'prepared', 'and', 'as', 'once', 'twice',
    'at', 'without', 'on', 'using', 'with', 'a', 'an', 'the', 'in', 'for', 'from', 'by', 'through', 'upon', 'if',
    'each', 'is', 'which', 'but', 'when', 'then', 'or', 'rare', 'ritual']);

  static #spellsInSentence(html, lookup) {
    const found = this.#marked(html, lookup);
    for (const [id, s] of this.#afterVerbs(this.#plain(html), lookup)) found.set(id, s);
    // "the X cantrip" / "the X spell", written anywhere in the sentence
    for (const m of this.#plain(html).matchAll(/\bthe ([A-Za-z][A-Za-z'’\/ -]{1,50}?) (?:cantrips?|spells?|powers?)\b/g)) {
      const s = lookup.byName.get(this.norm(m[1]));
      if (s) found.set(s.id, s);
    }
    return [...found.values()];
  }

  /**
   * A table cell's spells. Linked ones are taken as they are; otherwise the
   * cell has to be made of spell names - most of its words consumed by them -
   * or it is a feature name that happens to contain one ("Light Step").
   */
  static #cellSpells(html, lookup) {
    const marked = this.#marked(html, lookup);
    if (marked.size) return [...marked.values()];
    const words = this.norm(this.#plain(html)).split(' ').filter(w => w && !['and', 'or'].includes(w));
    if (!words.length) return [];
    const found = new Map();
    let consumed = 0;
    for (let i = 0; i < words.length;) {
      const rest = words.slice(i).join(' ');
      const name = lookup.names.find(n => rest === n || rest.startsWith(n + ' '));
      if (name) {
        const s = lookup.byName.get(name);
        found.set(s.id, s);
        const span = name.split(' ').length;
        consumed += span; i += span;
      } else i++;
    }
    return consumed / words.length >= 0.8 ? [...found.values()] : [];
  }

  /**
   * Level gates in a sentence, with where each one starts.
   *
   * Only the shape that states a character's level: "At 5th level, you learn",
   * "once you reach 3rd level, you can cast", "a 3rd-level druid". "Cast
   * counterspell at 3rd level" and "prepared at 5th level" are spell levels,
   * and read as gates they held a feature's spells back for levels.
   */
  static #gates(text) {
    const out = [];
    const re = /\b(?:at|starting at|beginning at|once you reach|when you reach|upon reaching|once you are at least an?|when you are an?) (?:(\d{1,2})(?:st|nd|rd|th)[- ]level|level (\d{1,2}))\b(?=\s*(?:,|you\b|[a-z]+\s+you\b))/gi;
    for (const m of text.matchAll(re)) out.push({ at: m.index, level: Number(m[1] ?? m[2]) });
    return out;
  }

  /** The gate nearest before a spell's name, or the sentence's first if the name is not found. */
  static #gateFor(text, gates, name) {
    if (!gates.length) return 0;
    const at = text.toLowerCase().indexOf(String(name).toLowerCase());
    if (at < 0) return gates[0].level;
    const before = gates.filter(g => g.at <= at);
    return before.length ? before[before.length - 1].level : 0;
  }

  /**
   * Spell tables written as lines instead of a <table>: "Artificer Level - Spell
   * <br>3rd - Grease Fog Cloud<br>5th - Heat Metal Levitate", or a paragraph a
   * row ("<p>3rd: Shield, Winter's Bite</p>", "<p>2nd Level: Color Spray</p>").
   * Two such lines or more, each naming spells, become a table with the level
   * in its first cell, in place; anything else is left as it was.
   */
  static #linesToTable(src, lookup) {
    const ROW = /^\s*(?:<(?:strong|em|b|i)>\s*)*(\d{1,2})(?:st|nd|rd|th)?(?:[\s-]*level)?\s*(?:<\/(?:strong|em|b|i)>\s*)*\s*[-–—:|]\s*([\s\S]+?)\s*$/i;
    const pieces = String(src).split(/(<br\s*\/?>|<\/?p[^>]*>)/i);
    const rows = [];
    pieces.forEach((piece, i) => {
      if (i % 2) return;                                   // a separator
      const m = ROW.exec(piece);
      if (!m) return;
      const lvl = Number(m[1]);
      if (!(lvl >= 1 && lvl <= 20)) return;
      const cells = m[2].split(/,\s*|\s+and\s+/);
      const spells = this.#marked(m[2], lookup).size ? [...this.#marked(m[2], lookup).values()] : cells.flatMap(c => this.#cellSpells(c, lookup));
      if (spells.length) rows.push({ i, lvl, html: m[2], n: spells.length });
    });
    // an archetype's table names one to three spells a row; a class list by level names ten
    if (rows.length < 2 || rows.some(r => r.n > 4)) return src;
    const table = `<table>${rows.map(r => `<tr><td>${r.lvl}</td><td>${r.html}</td></tr>`).join('')}</table>`;
    const drop = new Set(rows.map(r => r.i));
    const first = rows[0].i;
    return pieces.map((p, i) => (i === first ? table : drop.has(i) ? '' : p)).join('');
  }

  /**
   * Spells a sentence offers one of: "the Telekinesis or Telepathy power", "the
   * Dancing Lights, Light, or Produce Flame cantrip", "either Thaumaturgy or
   * Spare the Dying". Only names joined by "or" count - "you learn the Sleep
   * spell, or another bard spell if you already know it" grants Sleep.
   */
  static #joinedByOr(text, spells) {
    if (spells.length < 2) return false;
    const t = this.norm(text);
    const names = spells.map(s => this.norm(s.name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    return names.some(a => names.some(b => a !== b
      && new RegExp(`\\b${a},? or (?:the )?${b}\\b`).test(t)));
  }

  /** Classes that reach spell level N at class level 2N - 1. */
  static #FULL_CASTERS = new Set(['bard', 'cleric', 'druid', 'sorcerer', 'wizard', 'warlock', 'witch', 'psion']);

  /* ── parsing ──────────────────────────────────────────── */

  /**
   * @param {string} html
   * @param {object} lookup  from buildLookup
   * @param {object} [ctx]
   * @param {string} [ctx.classKey]  the class the feature belongs to
   * @param {string} [ctx.name]      the feature's name
   * @returns {{ auto: {uuid, name, kind, atLevel}[], choices: object[], skipped: string[] }}
   *   kind: learn | prepared | innate | table
   */
  static parse(html, lookup, { classKey = '', name = '' } = {}) {
    const out = { auto: [], choices: [], skipped: [] };
    let src = String(html ?? '');
    if (!/spell|cantrip|\bpowers?\b|prepared|\bcast\b/i.test(src)) return out;

    /* A feature that lays out alternatives - one of which the character has,
       recorded nowhere this can read - grants none of what follows. What comes
       before still counts: Searing Revelation gives its cantrips and only then
       says "choose one of the following". */
    const alt = /\b(?:choose|select|gain|receive) one of the following\b|\bgrants? you one of the following\b|\bchoose one of these\b/i.exec(src);
    if (alt) {
      src = src.slice(0, alt.index);
      out.skipped.push('alternatives');
    }
    /* A table written as lines: "3rd - Grease Fog Cloud<br>5th - ...", "<p>2nd Level: A, B</p>".
       Made a table here so the table rules below read it. */
    src = this.#linesToTable(src, lookup);
    const outside = this.#plain(src.replace(/<table[\s\S]*?<\/table>/gi, ' '));
    const levelTables = (src.match(/<table[\s\S]*?<\/table>/gi) ?? [])
      .filter(t => (t.match(/<tr[\s\S]*?<\/tr>/gi) ?? []).some(r => {
        const cells = [...r.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(m => m[1]);
        const lvl = parseInt(this.#plain(cells[0] ?? '').replace(/[^\d]/g, ''), 10);
        return cells.length >= 2 && lvl >= 1 && lvl <= 20;
      })).length;

    /* Tables of spells by level */
    for (const table of src.match(/<table[\s\S]*?<\/table>/gi) ?? []) {
      const rows = (table.match(/<tr[\s\S]*?<\/tr>/gi) ?? []).map(r =>
        [...r.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(m => m[1]));
      const header = this.#plain(rows[0]?.join(' ') ?? '').toLowerCase();
      const levelRows = [];
      for (const cells of rows) {
        if (cells.length < 2) continue;
        const lvl = parseInt(this.#plain(cells[0]).replace(/[^\d]/g, ''), 10);
        if (!(lvl >= 1 && lvl <= 20)) continue;
        const spells = cells.slice(1).flatMap(c => this.#cellSpells(c, lookup));
        if (spells.length) levelRows.push({ atLevel: lvl, spells });
      }
      if (!levelRows.length) continue;
      const nums = levelRows.map(r => r.atLevel);
      const bySpellLevel = (/spell level/.test(header) && !/(?:class|character|[a-z]+) level\b/.test(header.replace(/spell level/g, '')))
        || (nums.length >= 3 && nums.every((n, i) => n === i + 1));
      if (bySpellLevel && this.#FULL_CASTERS.has(classKey)) for (const r of levelRows) r.atLevel = Math.min(2 * r.atLevel - 1, 20);

      /* The order matters. A table chosen from says so ("choose one spell from the
         3rd-level row"), whatever its header; spells added to a spellbook are the
         character's; only then is a "Spell Level" table or an "expanded" one a
         list added to, not known. */
      if (classKey === 'sorcerer' || /choose (?:one|an additional) spell from/i.test(outside)) {
        out.choices.push({ kind: 'rowChoice', rows: levelRows.map(r => ({ atLevel: r.atLevel, options: r.spells })) });
        continue;
      }
      const toSpellbook = /\b(?:add|copy|write|inscribe)s?\b[^.]*\b(?:to|in|into) your spellbook\b/i.test(outside);
      /* Not "count as artificer spells for you": an artificer's archetype table
         says that of spells it grants, always prepared. A warlock's list is
         known by its name. */
      if (!toSpellbook && (/expanded spell/i.test(name) || /spell level/.test(header) || /expanded spell/i.test(outside))) {
        out.skipped.push('expanded list');                  // added to a list, not known
        continue;
      }
      /* "Your archetype spells are selected from one of several lists": skipped
         only where the lists are all here. The Elemental Priest's chosen list
         repeats the sentence above the one table the player took. */
      if (levelTables > 1 && /one of several lists|choose (?:one|a) (?:list|of the following lists)/i.test(outside)) {
        out.skipped.push('choice of lists');
        continue;
      }
      for (const r of levelRows) {
        for (const s of r.spells) out.auto.push({ uuid: s.uuid, name: s.name, kind: 'table', atLevel: r.atLevel, text: `table row ${r.atLevel}` });
      }
    }

    /* Sentences outside tables */
    const blocks = src.replace(/<table[\s\S]*?<\/table>/gi, ' ').split(/<\/(?:p|li|h\d)>|<br\s*\/?>/i);
    for (const block of blocks) {
      for (const sentence of block.split(/(?<=[.!?])\s+(?=[A-Z<@])/)) {
        const text = this.#plain(sentence);
        if (!text || !/spell|cantrip|prepared|\bcast\b|\bpowers?\b/i.test(text)) continue;

        // Alternatives under labels ("Unmoored: You can cast ...")
        const label = /^([A-Z][\w'’ -]{1,24}):\s/.exec(text);
        if (label && !/^(?:Cantrips|Spells)\b/i.test(text)) {
          // "Twisted Affliction (Fettered)" has all five lines; its name says which is its own
          const own = /\(([^)]+)\)\s*$/.exec(name)?.[1];
          if (!own || own.toLowerCase() !== label[1].trim().toLowerCase()) {
            if (this.#spellsInSentence(sentence, lookup).length) out.skipped.push(`labelled alternative: ${text.slice(0, 40)}`);
            continue;
          }
        }
        if (/\bif you (?:already )?know the\b|^if you know\b|\bif you have the\b/i.test(text)) continue;
        // "If you chose Scholar of the Old Ways, you learn ...", "If you hold such an item, you can cast ..."
        if (/^if\b/i.test(text)) continue;
        // "when you cast Ceremony ..., you can do so without material components" changes a cast; it grants none
        if (/\bwhen(?:ever)? you cast\b/i.test(text) && !/\byou (?:learn|know|can cast|may cast|always have)\b/i.test(text)) continue;
        // The effect of a spell, not the spell: "the benefits of a Death Ward spell", "replicate the See Invisibility spell"
        if (/\bbenefits? of\b|\breplicat|\beffects? of (?:a|an|the)\b|\bas if (?:you|it) (?:had )?cast|\bsame (?:effect|way) as\b/i.test(text)) continue;
        // "an expertise die on saves against spells ... (such as Command)" names examples, not grants
        if (/\b(?:saving throws?|saves?|checks?) against\b/i.test(text) && !/\byou (?:\w+ ){0,2}?(?:learn|know)\b|\bcan cast\b|\bprepared\b/i.test(text)) continue;
        // "Your spellcasting ability for these spells is your choice of ..." chooses no spell
        if (/spellcasting (?:ability|modifier)/i.test(text) && !/\byou (?:learn|know|gain|can cast)\b/i.test(text)) continue;

        /* "when you choose this archetype" says when, not that anything is chosen */
        const asked = text.replace(/\bwhen you (?:choose|select|pick|take|adopt) (?:this|your|the) [\w'’ -]{0,30}?(?:archetype|school|tradition|path|patron|domain|circle|oath|college|specialty|focus|calling|order|way)\b/gi, '');
        /* A choice of spells, not any "choose": "choose two cantrips", "choose a
           spell from ...". "Cast Alter Self at will, only choosing the Amphibious
           option ... instead of being able to choose a different one" chooses
           the spell's option and grants the spell. */
        const isChoice = /\bof your choice\b|\byour choice of\b|\bone of the following\b|\bchosen from\b/i.test(asked)
          || /\bchoose (?:(?:one|two|three|four|five|six|an?|any|up to \w+)\s+)?(?:[\w-]+\s+)?(?:spells?|cantrips?|powers?)\b|\bchoose\b[^.]*\bfrom (?:the|among|your|a|an)\b|\bchoose (?:either|between|one of)\b/i.test(asked);
        const isInnate = /\bcast\b/i.test(text)
          && /\bonce\b|without (?:expending|using|spending|needing)|without (?:a|any) spell slots?|\bat will\b|per (?:long|short) rest|a number of times|between (?:long|short) rests|\bas (?:a )?rituals?\b|\bspend \d+ [\w ]{1,20}? points? to cast\b/i.test(text);
        const isAlways = /\b(?:always|permanently) (?:have|has)\b[^.]*\bprepared\b|\balways prepared\b/i.test(text);
        const isLearn  = (/\byou (?:\w+ ){0,3}?(?:learn|know|gain)\b/i.test(text) && /\bcantrips?\b|\bspells?\b|\bpowers?\b/i.test(text))
          // "you add the Find Familiar spell to your spellbook / to your list of known spells"
          || /\badds?\b[^.]*\bto (?:your spellbook|(?:your|the) list of known [\w ]{0,20}spells|your spells known)\b/i.test(text);
        if (!isChoice && !isInnate && !isAlways && !isLearn) continue;

        const spells = this.#spellsInSentence(sentence, lookup);
        const gates = this.#gates(text);
        const atLevel = gates[0]?.level ?? 0;

        /* "You learn A or B" is picked once; "you can cast A or B once per rest"
           is picked at each casting, so both are the character's to cast. */
        if (isChoice || ((isLearn || !isInnate) && this.#joinedByOr(text, spells))) {
          const count = /\bthree\b/i.test(text) ? 3 : /\btwo\b/i.test(text) ? 2 : 1;
          const cantrip = /\bcantrips?\b/i.test(text) && !/\bspells?\b/i.test(text);
          out.choices.push({ kind: 'pick', count, cantrip, options: spells, atLevel, text });
          continue;
        }
        if (!spells.length) continue;
        const kind = isAlways ? 'prepared' : isInnate ? 'innate' : 'learn';
        for (const s of spells) out.auto.push({ uuid: s.uuid, name: s.name, kind, atLevel: this.#gateFor(text, gates, s.name), text });
      }
    }

    // One entry per spell; the earliest gate wins
    const seen = new Map();
    for (const a of out.auto) {
      const prev = seen.get(a.uuid);
      if (!prev || (a.atLevel || 0) < (prev.atLevel || 0)) seen.set(a.uuid, a);
    }
    out.auto = [...seen.values()];
    return out;
  }

  /* ── on an actor ──────────────────────────────────────── */

  static classKeyOf(item) {
    return String(item?.system?.classes ?? '').toLowerCase().replace(/[^a-z]/g, '');
  }

  /**
   * The level a feature's "at Nth level" counts against: its class's, or the
   * character's.
   *
   * @param {object} [next]  the levels about to be reached, for a level-up that
   *   has not been applied yet: { classKey, classLevel, charLevel }
   */
  static levelFor(actor, item, next = null) {
    const classes = (actor?.items?.filter ? actor.items.filter(i => i.type === 'class') : []);
    const charLevel = next?.charLevel
      ?? (classes.reduce((n, c) => n + (Number(c.system?.classLevels) || 0), 0) || 1);
    const key = this.classKeyOf(item);
    if (!key) return charLevel;
    if (next?.classKey && next.classKey === key) return next.classLevel;
    const cls = classes.find(c => String(c.system?.slug || c.name).toLowerCase().replace(/[^a-z]/g, '') === key);
    return cls ? (Number(cls.system?.classLevels) || 1) : charLevel;
  }

  static #sourceOf(doc) {
    return doc?._stats?.compendiumSource || doc?.uuid || doc?.name || '';
  }

  /**
   * Spell choices owed now.
   *
   *   - a sorcerer's archetype spells: one pick at each level the table names
   *     (1st, 3rd, 5th, 7th, 9th), from the rows up to that level
   *   - a feature that offers named spells to choose from ("two bonus cantrips
   *     of your choice from Celestial Burst, Guidance, Light, and Sacred Flame"),
   *     once, when the feature is gained
   *
   * A choice "from the wizard spell list" names no options and is not offered
   * here; the class's own spell picker covers its list.
   *
   * @param {{doc, isNew: boolean, level: number}[]} sources
   * @param {object} lookup
   * @param {object} [opts]
   * @param {Set<string>} [opts.done]   keys already answered - the actor flag
   * @param {Set<string>} [opts.known]  lower-case names of spells already held
   * @returns {{key, source, count, cantrip, options: {uuid, name, img}[]}[]}
   */
  static owedChoices(sources, lookup, { done = new Set(), known = new Set() } = {}) {
    const out = [];
    const seenKeys = new Set();
    for (const { doc, isNew, level } of sources) {
      if (!doc) continue;
      const html = typeof doc.system?.description === 'string'
        ? doc.system.description : (doc.system?.description?.value ?? '');
      const source = this.#sourceOf(doc);
      const { choices } = this.parse(html, lookup, { classKey: this.classKeyOf(doc), name: doc.name });
      choices.forEach((c, i) => {
        let key, count, options, cantrip = false;
        if (c.kind === 'rowChoice') {
          if (!c.rows.some(r => r.atLevel === level)) return;       // picks come at the table's own levels
          key = `row::${source}::${level}`;
          count = 1;
          options = c.rows.filter(r => r.atLevel <= level).flatMap(r => r.options);
        } else if (c.kind === 'pick') {
          if (!isNew || (c.atLevel && c.atLevel > level)) return;
          if (c.options.length <= c.count) return;                   // nothing to choose between
          key = `pick::${source}::${i}`;
          count = c.count;
          cantrip = c.cantrip;
          options = c.options;
        } else return;
        if (done.has(key) || seenKeys.has(key)) return;
        seenKeys.add(key);
        const unique = [...new Map(options.map(o => [o.uuid, o])).values()]
          .filter(o => !known.has(String(o.name).toLowerCase()));
        if (!unique.length) return;
        out.push({ key, source: doc.name, count: Math.min(count, unique.length), cantrip, options: unique });
      });
    }
    return out;
  }

  /** Choices shaped for the picker, with what has been picked marked. */
  static decorate(choices, picks = {}, action = '') {
    return choices.map(c => {
      const picked = picks[c.key] ?? [];
      return {
        ...c, action,
        chosen: picked.length,
        complete: picked.length >= c.count,
        options: c.options.map(o => ({ ...o, selected: picked.includes(o.uuid) }))
      };
    });
  }

  /** Toggle one option of one choice, within its count. @returns {boolean} changed */
  static toggle(picks, choices, key, uuid) {
    const choice = choices.find(c => c.key === key);
    if (!choice || !choice.options.some(o => o.uuid === uuid)) return false;
    const list = [...(picks[key] ?? [])];
    const at = list.indexOf(uuid);
    if (at >= 0) list.splice(at, 1);
    else {
      if (list.length >= choice.count) {
        ui.notifications?.warn(game.i18n.format('am.spells.bonus-full', { n: choice.count, source: choice.source }));
        return false;
      }
      list.push(uuid);
    }
    picks[key] = list;
    return true;
  }

  /**
   * Add the picked spells and record the choices as answered.
   * @param {object} picks    { [key]: uuid[] }
   * @param {object[]} choices  the choices the picks were made against
   */
  static async applyChoices(actor, picks, choices) {
    const chosen = choices.filter(c => (picks?.[c.key] ?? []).length);
    if (!chosen.length) return [];
    const from = new Map();
    for (const c of chosen) for (const u of picks[c.key].slice(0, c.count)) from.set(u, c.source);
    const { SpellService } = await import('./spellService.js');
    await SpellService.applySpellsToActor(actor, [...from.keys()], {
      prepared: 2,
      flags: (uuid) => ({ grantedBy: from.get(uuid) ?? '' })
    });
    const done = new Set(actor.getFlag?.(AM.ID, this.FLAG) ?? []);
    for (const c of chosen) done.add(c.key);
    await actor.setFlag?.(AM.ID, this.FLAG, [...done]);
    return [...from.keys()];
  }

  /**
   * The documents a set of grant models hands out: every base feature, and
   * the options picked. Read from the builder's and the level-up's grant trees.
   */
  static async docsFromGrantModels(models, choices = {}) {
    const uuids = new Set();
    for (const m of models ?? []) {
      for (const u of m.baseUuids ?? []) uuids.add(u);
      for (const u of choices?.[m.id] ?? []) if (typeof u === 'string' && u.startsWith('Compendium.')) uuids.add(u);
    }
    const docs = [];
    for (const u of uuids) {
      try { const d = await fromUuid(u); if (d && this.TYPES.has(d.type)) docs.push(d); } catch { /* unreadable: skipped */ }
    }
    return docs;
  }

  /**
   * Add every spell the actor's features owe it by now and have not given it.
   * @returns {Promise<string[]>} names of the spells added
   */
  static async ensure(actor) {
    if (!actor?.items) return [];
    const lookup = await this.lookup();
    const granted = new Set(actor.getFlag?.(AM.ID, this.FLAG) ?? []);
    const have = new Set(actor.items.filter(i => i.type === 'spell').map(i => i.name.toLowerCase()));

    const toAdd = [];
    const keys = [];
    for (const item of actor.items) {
      if (!this.TYPES.has(item.type)) continue;
      const html = typeof item.system?.description === 'string'
        ? item.system.description : (item.system?.description?.value ?? '');
      const { auto } = this.parse(html, lookup, { classKey: this.classKeyOf(item), name: item.name });
      if (!auto.length) continue;
      const level = this.levelFor(actor, item);
      const source = item._stats?.compendiumSource || item.name;
      for (const g of auto) {
        if (g.atLevel && g.atLevel > level) continue;
        const key = `${source}::${g.name}`;
        if (granted.has(key)) continue;
        keys.push(key);
        if (have.has(g.name.toLowerCase())) continue;
        have.add(g.name.toLowerCase());
        toAdd.push({ ...g, from: item.name, source });
      }
    }
    if (!keys.length) return [];

    /* Recorded as given only once it is on the actor: a spell whose compendium
       could not be read this time is tried again next time, not lost for good. */
    let failed = new Set();
    if (toAdd.length) {
      const { SpellService } = await import('./spellService.js');
      const held = new Set(await SpellService.applySpellsToActor(actor, toAdd.map(g => g.uuid), {
        prepared: 2,
        flags: (uuid) => ({ grantedBy: toAdd.find(g => g.uuid === uuid)?.from ?? '' })
      }) ?? toAdd.map(g => g.uuid));
      failed = new Set(toAdd.filter(g => !held.has(g.uuid)).map(g => `${g.source}::${g.name}`));
      const made = toAdd.filter(g => held.has(g.uuid));
      if (made.length) AM.log(3, `Spells from features: ${made.map(g => `${g.name} (${g.from})`).join(', ')}`);
      if (failed.size) AM.log(2, `Spells from features not added, to be tried again: ${[...failed].join(', ')}`);
    }
    await actor.setFlag?.(AM.ID, this.FLAG, [...granted, ...keys.filter(k => !failed.has(k))]);
    return toAdd.filter(g => !failed.has(`${g.source}::${g.name}`)).map(g => g.name);
  }
}
