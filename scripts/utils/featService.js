import { AM } from '../am.js';
import { PackFilter } from './packFilter.js';
import { applyItemIcon } from '../data/a5eIcons.js';

/**
 * Feats, for the "ability score increase OR a feat" choice a5e gives at 4th, 8th,
 * 12th, 16th and 19th level.
 *
 * a5e does not model that choice as a grant: the class carries two `ability`
 * grants of one point each and nothing else, so taking a feat instead is a rules
 * option the system leaves to the player. That is why the level-up only ever
 * offered the two points — there was nothing in the data to read.
 *
 * A feat is an item of type `feature` with `system.featureType === 'feat'`. It is
 * NOT the `feat` document type, which the packs do not use.
 */
export class FeatService {

  static #cache = null;

  /** Every feat in the enabled item compendiums. Cached for the session. */
  static async loadAll({ force = false } = {}) {
    if (this.#cache && !force) return this.#cache;

    const out = [];
    const seen = new Set();
    for (const pack of PackFilter.itemPacks()) {
      try {
        /* Through PackFilter, not pack.getIndex directly. Asking Foundry to
           fold system fields into an index it has already built throws on
           a5e’s packs, and this catch swallowed that and skipped the pack —
           every pack, so the picker offered no feats at all. PackFilter now
           checks that the index it hands back really carries the system data,
           and reads the documents when it does not. Measured against the real
           packs: 0 feats before, 625 after. */
        // The fields read below - a5e's own feature index already carries them
        const index = await PackFilter.indexOf(pack,
          ['name', 'type', 'img', 'system.featureType', 'system.prerequisite', 'system.description', 'system.source'],
          { types: ['feature'] });
        for (const entry of index) {
          if (!this.isFeat(entry)) continue;
          const uuid = entry.uuid ?? `Compendium.${pack.collection}.Item.${entry._id}`;
          const key  = entry.name.toLowerCase();
          if (seen.has(key)) continue;              // same feat in two packs
          seen.add(key);
          /* The field, or failing it the "Prerequisite: ..." a description
             opens with - Eldritch Rager keeps its Wrathful Bargainer there. */
          const prerequisite = String(entry.system?.prerequisite ?? '').trim()
            || this.#prerequisiteInText(entry.system?.description);
          out.push({
            uuid,
            name:         entry.name,
            img:          entry.img,
            prerequisite,
            source:       entry.system?.source ?? '',
            packLabel:    pack.metadata?.label ?? '',
            /* The axes the picker sorts on, worked out once here rather than
               on every keystroke. */
            classes:      this.classesInPrerequisite(prerequisite),
            gated:        !!prerequisite.trim()
          });
        }
      } catch (err) {
        AM.log(2, `Could not index feats from ${pack.collection}:`, err);
      }
    }

    /* A sub-feat - "Bear Grab (Hibernating Affliction)", "Burning Hatred (True
       Revenant)" - is one of the options its parent feat opens, and a5e writes no
       prerequisite on it: every one of them passed every filter, "no
       prerequisite" included. The parent is in the name; a parent that is no
       feat ("Lycanthropy") still gates it, as a requirement that cannot be
       checked. */
    const names = new Set(out.map(f => f.name.toLowerCase()));
    for (const f of out) {
      if (f.prerequisite) continue;
      const parent = /\(([^)]+)\)\s*$/.exec(f.name)?.[1]?.trim();
      if (!parent) continue;
      f.prerequisite = names.has(parent.toLowerCase()) ? `${parent} feat` : parent;
      f.classes = this.classesInPrerequisite(f.prerequisite);
      f.gated = true;
    }

    out.sort((a, b) => a.name.localeCompare(b.name));
    this.#cache = out;
    AM.log(out.length ? 3 : 2, `Loaded ${out.length} feat(s)`);
    return out;
  }

  /** "Prerequisite: X" at the head of a description, as text; '' when there is none. */
  static #prerequisiteInText(html) {
    const m = /prerequisites?\s*:\s*(?:<\/?(?:em|strong|b|i|span)\b[^>]*>\s*)*([^<]+)/i.exec(String(html ?? ''));
    if (!m || m.index > 200) return '';
    return m[1].replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim().replace(/[.;:,]\s*$/, '');
  }

  /** CONFIG.A5E.classes by every name a prerequisite may use: its key and its label, spaced or not. */
  static #classNames() {
    const map = new Map();
    for (const [key, label] of Object.entries(CONFIG.A5E?.classes ?? {})) {
      const shown = String(game.i18n?.localize?.(label) ?? label ?? '').toLowerCase();
      for (const n of [key.toLowerCase(), shown, shown.replace(/\s+/g, '')]) if (n) map.set(n, key);
    }
    return map;
  }

  /** Drop the cache so a newly installed module's feats show up. */
  static invalidate() { this.#cache = null; }

  /**
   * Which classes a prerequisite names — "3 levels in marshal, 3 levels in
   * rogue" → ['marshal', 'rogue'].
   *
   * a5e records system.featClasses on almost none of its feats; the class gate
   * lives in the prerequisite text, which is why "feats for my class" could
   * never be offered as an ordering. Read out of the text, it can be. The keys
   * are CONFIG.A5E.classes keys, so they line up with what the character has.
   */
  static classesInPrerequisite(prereq) {
    if (!prereq) return [];
    const keys = this.#classNames();
    const found = [];
    const add = (raw) => {
      const words = String(raw).toLowerCase().trim();
      const key = keys.get(words.replace(/\s+/g, '')) ?? keys.get(words.split(/\s+/)[0]);
      if (key && !found.includes(key)) found.push(key);
    };
    /* Every way a5e writes it: "3 levels in marshal", "3 levels of cleric",
       "Artificer level 3", "3 herald", and a class named on its own -
       "warlock (diabolist archetype) and witch". Missing all but the first
       let "For my class" keep a cleric's Anointed Bearer for anybody. */
    for (const m of prereq.matchAll(/\blevels?\s+(?:in|of)\s+([a-z]+(?:\s+[a-z]+)?)/gi)) add(m[1]);
    for (const m of prereq.matchAll(/\b([a-z]+)\s+level\s+\d+/gi)) add(m[1]);
    for (const m of prereq.matchAll(/\b\d+\s+([a-z][a-z'-]+)/gi)) add(m[1]);
    for (const clause of prereq.split(/[,;]|\band\b|\bor\b/i)) {
      const bare = clause.trim().replace(/\s*\([^)]*\)\s*$/, '');
      if (bare && keys.has(bare.toLowerCase())) add(bare);
    }
    return found;
  }

  /** The class keys a character actually has levels in. */
  static actorClassKeys(actor) {
    const keys = new Map(
      Object.keys(CONFIG.A5E?.classes ?? {}).map(k => [k.toLowerCase(), k])
    );
    const out = [];
    for (const item of (actor?.items ?? [])) {
      if (item.type !== 'class') continue;
      const name = (item.name ?? '').toLowerCase();
      const key = keys.get(name.replace(/\s+/g, '')) ?? keys.get(name);
      if (key && !out.includes(key)) out.push(key);
    }
    return out;
  }

  /**
   * How the picker may be ordered.
   *
   * Alphabetical was the only order there was, and for six hundred entries
   * that is a list you scroll rather than one you use.
   */
  static SORTS = {
    name:   { label: 'am.asi.feat-sort-name',   cmp: (a, b) => a.name.localeCompare(b.name) },
    source: { label: 'am.asi.feat-sort-source',
              cmp: (a, b) => (a.source || '~').localeCompare(b.source || '~')
                          || a.name.localeCompare(b.name) },
    gate:   { label: 'am.asi.feat-sort-gate',
              /* Ungated first: those are the ones anybody may take. */
              cmp: (a, b) => (a.gated ? 1 : 0) - (b.gated ? 1 : 0)
                          || a.name.localeCompare(b.name) },
    fit:    { label: 'am.asi.feat-sort-fit',
              /* Eligible first, then the ones this character’s own classes gate. */
              cmp: (a, b) => (b.met ? 1 : 0) - (a.met ? 1 : 0)
                          || (b.forMyClass ? 1 : 0) - (a.forMyClass ? 1 : 0)
                          || a.name.localeCompare(b.name) }
  };

  /**
   * A feat is `feature` + `featureType: 'feat'`.
   *
   * Checked against the packs: of 732 documents in a5e's feats pack, 625 match
   * and the 107 that do not are class features, knacks and natural weapons —
   * none of which should be offered here. One class feature (Water's Balm) is
   * labelled `feat` in a5e's own data; that is their mislabel, not a filter to
   * work around.
   */
  static isFeat(entryOrItem) {
    return entryOrItem?.type === 'feature'
        && (entryOrItem.system?.featureType ?? '') === 'feat';
  }

  /* ── prerequisites ────────────────────────────────────── */

  /**
   * Check a feat's prerequisite against the character.
   *
   * a5e writes prerequisites as free prose — "3 levels in marshal, 3 levels in
   * rogue", "War Dancer feat", "Strength 13 or higher", "Proficiency with a type
   * of vehicle". Only some of those can be checked mechanically, so this reports
   * three states rather than two:
   *
   *   met: true          — parsed and satisfied, or no prerequisite at all
   *   met: false         — parsed and NOT satisfied, with the reason
   *   unknown: true      — could not be parsed; shown, never hidden
   *
   * Guessing at the unparseable ones and hiding them would quietly remove valid
   * options, which is worse than showing a line of text the player can read.
   */
  static checkPrerequisite(actor, feat) {
    const text = String(feat?.prerequisite ?? '').trim();
    if (!text) return { met: true, unknown: false, text: '' };

    /* "Hibernating Affliction, Pack Initiative, Rat Within, Striped Soul, or
       Swineheart" is one requirement - any of them - not five: a comma list whose
       last item says "or" is read as one "or" clause, and what follows it on its
       own. Everything else splits at commas, semicolons and "and" as before. */
    const parts = text.split(/;/).flatMap(segment => {
      const items = segment.split(/,/).map(s => s.trim()).filter(Boolean);
      const orAt = items.findIndex(t => /^or\s+/i.test(t));
      const group = orAt > 0 ? [items.slice(0, orAt + 1).map(t => t.replace(/^or\s+/i, '')).join(' or ')] : [];
      const rest = (orAt > 0 ? items.slice(orAt + 1) : items).flatMap(t => t.split(/ and /i));
      return [...group, ...rest];
    }).map(s => s.trim().replace(/^and\s+/i, '')).filter(Boolean);
    const failures = [];
    let parsedAny = false;

    for (const part of parts) {
      const check = this.#checkClause(actor, part);
      if (check === null) continue;                 // unparseable clause
      parsedAny = true;
      if (!check.ok) failures.push(check.reason);
    }

    if (!parsedAny) return { met: true, unknown: true, text };
    return { met: failures.length === 0, unknown: false, text, failures };
  }

  /**
   * One clause. Returns null when the shape is not recognised, so the caller can
   * tell "not satisfied" from "cannot tell".
   */
  /** Single words that follow a number in a prerequisite but name no class. */
  static #NOT_A_CLASS = new Set([
    'level', 'levels', 'spell', 'spells', 'feat', 'feats', 'cantrip', 'cantrips',
    'maneuver', 'maneuvers', 'attack', 'attacks', 'point', 'points',
    'die', 'dice', 'round', 'rounds', 'hour', 'hours', 'foot', 'feet'
  ]);

  /** a5e's skills by the names prerequisites use. */
  static #SKILLS = { acrobatics: 'acr', 'animal handling': 'ani', arcana: 'arc', athletics: 'ath', culture: 'cul', deception: 'dec',
    engineering: 'eng', history: 'his', insight: 'ins', intimidation: 'itm', investigation: 'inv', medicine: 'med', nature: 'nat',
    perception: 'prc', performance: 'prf', persuasion: 'per', religion: 'rel', science: 'sci', 'sleight of hand': 'slt', stealth: 'ste', survival: 'sur' };

  static #checkClause(actor, clause) {
    clause = clause.replace(/\s+/g, ' ').trim()
      // "You must have the spellcasting feature", "either the Spellcasting feature"
      .replace(/^(?:you\s+)?(?:must\s+)?(?:have\s+)?(?:either\s+)?/i, '').trim();

    /* "Exertion pool of at least 4 and either the Spellcasting feature, the
       Magic Wielding feature, or the Pact Magic feature": the first, and any
       one of the rest - not three alternatives, the first of them glued to
       the exertion pool. */
    const either = /^(.+?)\s+and\s+either\s+(.+)$/i.exec(clause);
    if (either) {
      const a = this.#checkClause(actor, either[1]);
      const b = this.#checkClause(actor, either[2]);
      if (a && !a.ok) return a;
      if (b && !b.ok) return b;
      if (!a || !b) return null;
      return { ok: true, reason: `${a.reason}, ${b.reason}` };
    }

    /* "Noble background or the favor of a noble", "Proficiency in Investigation
       or Perception": met when one of them is. Unknown when none is met and one
       of them cannot be judged - the favor of a noble is shown, never hidden. */
    // not "Strength 13 or higher", "8th level or above"
    const OR = /\s+or\s+(?!higher\b|above\b|more\b|greater\b|better\b)/i;
    if (OR.test(clause) && !/^proficiency\b/i.test(clause)) {
      const alts = clause.split(OR).map(s => s.trim()).filter(Boolean);
      // "Intelligence or Wisdom 13 or higher": the score is both abilities'
      const score = /\b(\d+)(?:\s+or\s+(?:higher|above|more|greater|better))?$/i.exec(alts.at(-1) ?? '')?.[0];
      if (score) alts.forEach((a, i) => { if (/^(strength|dexterity|constitution|intelligence|wisdom|charisma)$/i.test(a)) alts[i] = `${a} ${score}`; });
      const checks = alts.map(a => this.#checkClause(actor, a));
      const met = checks.find(c => c?.ok);
      if (met) return met;
      if (checks.some(c => c === null)) return null;
      return { ok: false, reason: checks.map(c => c.reason).join(' or ') };
    }

    // "Proficiency with Stealth", "Proficiency in Investigation or Perception",
    // "Proficiency with the Survival skill", "Proficiency with medium armor",
    // "Proficiency with shields", "Proficiency with at least one martial weapon"
    let p = clause.match(/^proficiency (?:with|in) (.+)$/i);
    if (p) {
      const what = p[1].trim().replace(/^(?:the|a|an|at least one)\s+/i, '');
      const profs = actor?.system?.proficiencies ?? {};
      const armor = /^(light|medium|heavy) armou?r$/i.exec(what)?.[1]?.toLowerCase()
        ?? (/^shields?$/i.test(what) ? 'shield' : null);
      if (armor) return { ok: [...(profs.armor ?? [])].includes(armor), reason: `proficiency with ${what}` };
      const category = /^(simple|martial|rare|exotic) weapons?$/i.exec(what)?.[1]?.toLowerCase();
      if (category) {
        const kinds = Object.keys(CONFIG.A5E?.weapons?.[category] ?? {});
        return { ok: [...(profs.weapons ?? [])].some(w => kinds.includes(w)), reason: `proficiency with ${what}` };
      }
      const names = what.replace(/\s+skills?$/i, '').toLowerCase().split(/\s*,\s*|\s+or\s+/)
        .map(s => s.trim().replace(/^the\s+/, '')).filter(Boolean);
      const keys = names.map(n => this.#SKILLS[n]);
      if (keys.some(k => !k)) return null;                 // a tool, a vehicle: not judged
      const ok = keys.some(k => (actor?.system?.skills?.[k]?.proficient ?? 0) > 0);
      return { ok, reason: `proficiency in ${p[1]}` };
    }

    // "Ace Starfighter combat tradition": the character knows the tradition
    p = clause.match(/^(.+?) combat tradition$/i);
    if (p) {
      const want = p[1].trim().toLowerCase();
      const traditions = CONFIG.A5E?.maneuverTraditions ?? {};
      const key = Object.keys(traditions).find(k => k.toLowerCase() === want.replace(/\s+/g, '')
        || String(game.i18n?.localize?.(traditions[k]) ?? traditions[k]).toLowerCase() === want);
      if (!key) return null;
      const known = actor?.system?.proficiencies?.traditions ?? [];
      return { ok: [...known].includes(key), reason: `${p[1].trim()} tradition` };
    }

    // "The ability to cast at least one spell (of 1st-level or higher)", "the ability to cast spells"
    p = clause.match(/^(?:the )?ability to cast (?:at least one )?spells?(?: of (\d)(?:st|nd|rd|th)[- ]level or higher)?$/i);
    if (p) {
      const least = Number(p[1] ?? 0);
      const ok = (actor?.items ?? []).some(i => i.type === 'spell' && Number(i.system?.level ?? 0) >= least);
      return { ok, reason: least ? `a spell of ${p[1]}th level` : 'spellcasting' };
    }

    /* "Noble background", "Seal skin feature from the selkie heritage", "X
       culture", "X destiny": the character's own origin, by name. Only
       backgrounds were read before, so a heritage's or a culture's feat was
       unjudged - and kept - for everybody. */
    p = clause.match(/^(?:.+?\s+from\s+)?(?:the\s+|an?\s+)?(.+?)\s+(heritage|culture|background|destiny)$/i);
    if (p) {
      const want = p[1].trim().toLowerCase();
      const kind = p[2].toLowerCase();
      const have = (actor?.items ?? []).filter(i => i.type === kind).map(i => i.name.toLowerCase());
      const ok = have.some(n => n === want || n.includes(want) || want.includes(n));
      return { ok, reason: `${p[1].trim()} ${kind}` };
    }

    // "The Spellcasting feature", "the Pact Magic feature", "the Relentless feature"
    p = clause.match(/^(?:the\s+)?(.+?)\s+feature$/i);
    if (p && !/\sand\s/i.test(p[1])) {
      const want = p[1].trim().toLowerCase();
      const items = actor?.items ?? [];
      let ok = items.some(i => i.name.toLowerCase() === want || i.name.toLowerCase().startsWith(`${want} (`));
      if (!ok && want === 'spellcasting') {
        ok = items.some(i => i.type === 'class'
          && !['', 'none', 'psion'].includes(String(i.system?.spellcasting?.casterType ?? 'none')));
      }
      return { ok, reason: `the ${p[1].trim()} feature` };
    }

    // "Exertion pool of at least 4"
    p = clause.match(/^exertion pool of at least (\d+)$/i);
    if (p) {
      // a5e's pool is twice the proficiency bonus; a stored max counts when there is one
      const have = Number(actor?.system?.attributes?.exertion?.max ?? 0)
        || 2 * Number(actor?.system?.attributes?.prof ?? 0);
      return { ok: have >= Number(p[1]), reason: `exertion ${have}/${p[1]}` };
    }

    // "No levels in non-wielder classes": that class and no other
    p = clause.match(/^no levels in non-([a-z]+) class(?:es)?$/i);
    if (p) {
      const only = p[1].toLowerCase();
      const others = (actor?.items ?? []).filter(i => i.type === 'class' && i.name.toLowerCase() !== only);
      return { ok: others.length === 0, reason: `no class but ${p[1]}` };
    }

    // "3 levels in marshal" / "3 Levels in Sorcerer" / "3 levels of cleric"
    let m = clause.match(/^(\d+)\s+levels?\s+(?:in|of)\s+(.+)$/i);
    if (m) {
      const need = Number(m[1]);
      const name = m[2].trim().toLowerCase();
      const cls  = (actor?.items ?? []).find(i =>
        i.type === 'class' && i.name.toLowerCase() === name);
      const have = cls?.system?.classLevels ?? cls?.system?.levels ?? 0;
      return { ok: have >= need, reason: `${m[2].trim()} ${have}/${need}` };
    }

    // "3 herald" / "3 witch" / "3 berserker (rugged defense)"
    //
    // This is how a5e actually writes class prerequisites — the "N levels in X"
    // shape above is the rarer one. Missing it was why the filter barely
    // filtered: an unrecognised clause counts as unjudged, and unjudged feats
    // are kept, so a cleric was offered every herald and deathwalker feat in
    // the book.
    //
    // The class name must be ONE word. A5e's are (herald, berserker, witch,
    // deathwalker), and the restriction is what keeps this from swallowing
    // clauses like "3 spells known" and judging them as a class nobody has.
    m = clause.match(/^(\d+)\s+([a-z][a-z'-]+)(?:\s*\(([^)]*)\))?$/i);
    if (m && !this.#NOT_A_CLASS.has(m[2].toLowerCase())) {
      const need = Number(m[1]);
      const name = m[2].toLowerCase();
      const arch = m[3]?.trim().toLowerCase() ?? '';
      const cls  = (actor?.items ?? []).find(i =>
        i.type === 'class' && i.name.toLowerCase() === name);
      const have = cls?.system?.classLevels ?? cls?.system?.levels ?? 0;

      if (have < need) return { ok: false, reason: `${m[2]} ${have}/${need}` };

      // A parenthetical names the archetype the levels have to be in.
      if (arch) {
        const hasArch = (actor?.items ?? []).some(i =>
          i.type === 'archetype' && i.name.toLowerCase() === arch);
        if (!hasArch) return { ok: false, reason: `${m[2]} (${m[3].trim()})` };
      }
      return { ok: true, reason: `${m[2]} ${have}/${need}` };
    }

    const classes = this.#classNames();
    const levelsIn = (name) => {
      const cls = (actor?.items ?? []).find(i => i.type === 'class' && i.name.toLowerCase() === name);
      return cls?.system?.classLevels ?? cls?.system?.levels ?? 0;
    };

    // "Artificer level 3"
    m = clause.match(/^([a-z][a-z' -]*?)\s+level\s+(\d+)$/i);
    if (m && classes.has(m[1].toLowerCase())) {
      const have = levelsIn(m[1].toLowerCase());
      const need = Number(m[2]);
      return { ok: have >= need, reason: `${m[1]} ${have}/${need}` };
    }

    // "warlock (diabolist archetype)": levels in the class, in that archetype
    m = clause.match(/^([a-z][a-z' -]*?)\s*\(\s*(.+?)\s+archetype\s*\)$/i);
    if (m && classes.has(m[1].toLowerCase())) {
      const have = levelsIn(m[1].toLowerCase());
      const arch = m[2].trim().toLowerCase();
      const hasArch = (actor?.items ?? []).some(i => i.type === 'archetype' && i.name.toLowerCase() === arch);
      return { ok: have > 0 && hasArch, reason: `${m[1]} (${m[2].trim()})` };
    }

    // "witch" on its own: a level in the class
    if (classes.has(clause.toLowerCase())) {
      const have = levelsIn(clause.toLowerCase());
      return { ok: have > 0, reason: clause };
    }

    // "Strength 13 or higher" / "Dexterity 13"
    m = clause.match(/^(strength|dexterity|constitution|intelligence|wisdom|charisma)\s+(\d+)/i);
    if (m) {
      const key = { strength: 'str', dexterity: 'dex', constitution: 'con',
                    intelligence: 'int', wisdom: 'wis', charisma: 'cha' }[m[1].toLowerCase()];
      const have = actor?.system?.abilities?.[key]?.value ?? 0;
      const need = Number(m[2]);
      return { ok: have >= need, reason: `${m[1]} ${have}/${need}` };
    }

    // "War Dancer feat" — a named feat the character must already have
    m = clause.match(/^(.+?)\s+feats?$/i);
    if (m) {
      const name = this.#featNamed(m[1].trim()) ?? m[1].trim().toLowerCase();
      const has  = (actor?.items ?? []).some(i =>
        this.isFeat(i) && i.name.toLowerCase() === name);
      return { ok: has, reason: `${m[1].trim()} feat` };
    }

    // "Level 4" / "4th level" / "8th level or higher"
    m = clause.match(/^(?:character\s+)?level\s+(\d+)/i) || clause.match(/^(\d+)(?:st|nd|rd|th)\s+level(?:\s+or\s+(?:higher|above))?$/i);
    if (m) {
      const have = (actor?.items ?? [])
        .filter(i => i.type === 'class')
        .reduce((n, i) => n + (i.system?.classLevels ?? i.system?.levels ?? 0), 0);
      const need = Number(m[1]);
      return { ok: have >= need, reason: `level ${have}/${need}` };
    }

    /* A feat named without the word: "Steel Protector", "Hulking" - what the
       imported feats write where a5e writes "War Dancer feat". Only a name the
       feats actually loaded carry, so no stray clause is read as one. */
    const name = this.#featNamed(clause);
    if (name) {
      const has = (actor?.items ?? []).some(i => this.isFeat(i) && i.name.toLowerCase() === name);
      return { ok: has, reason: `${clause} feat` };
    }

    return null;                                    // not a shape we can judge
  }

  /**
   * The loaded feat a prerequisite names, lower-cased; null when none. Near
   * misses count for a long name: "Pack Initiative" is how a5e writes the Pack
   * Initiate feat in four lycanthrope prerequisites.
   */
  static #featNamed(raw) {
    const want = String(raw ?? '').toLowerCase().trim();
    if (!want) return null;
    const names = (this.#cache ?? []).map(f => f.name.toLowerCase());
    if (names.includes(want)) return want;
    if (want.length < 8) return null;
    return names.find(n => Math.abs(n.length - want.length) <= 2 && this.#distance(n, want) <= 2) ?? null;
  }

  /** Edit distance, for #featNamed. */
  static #distance(a, b) {
    const row = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
      let prev = row[0]; row[0] = i;
      for (let j = 1; j <= b.length; j++) {
        const cur = row[j];
        row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
        prev = cur;
      }
    }
    return row[b.length];
  }

  /** Feats as a UI model, each carrying its prerequisite verdict. */
  static async optionsFor(actor, {
    search = '', onlyEligible = false, sort = 'name', dir = 'asc',
    onlyMyClass = false, onlyUngated = false
  } = {}) {
    const all = await this.loadAll();
    const q = search.trim().toLowerCase();
    const mine = this.actorClassKeys(actor);

    let rows = all
      .filter(f => !q || f.name.toLowerCase().includes(q)
                      || f.prerequisite.toLowerCase().includes(q))
      .map(f => {
        const pre = this.checkPrerequisite(actor, f);
        return {
          ...f,
          met:        pre.met,
          unknown:    pre.unknown,
          preText:    pre.text,
          why:        (pre.failures ?? []).join(', '),
          /* Gated on a class this character has — the difference between a
             feat that is merely restricted and one restricted TO them. */
          forMyClass: f.classes.length > 0 && f.classes.some(c => mine.includes(c))
        };
      });

    /* "Only ones I qualify for" means ones the character is known to qualify
       for. It used to keep the unjudged ones too, and a requirement the parser
       could not read - a heritage, a culture, "3 levels of cleric" - passed every
       filter: "they fall under no filter at all". They are still there with the
       filter off, marked; the count of those it hides goes out with the rows. */
    let unchecked = 0;
    if (onlyEligible) {
      unchecked = rows.filter(f => f.met && f.unknown).length;
      rows = rows.filter(f => f.met && !f.unknown);
    }
    /* A feat nobody gates is open to this character too, so it stays. */
    if (onlyMyClass)  rows = rows.filter(f => f.forMyClass || !f.classes.length);
    if (onlyUngated)  rows = rows.filter(f => !f.gated);

    const cmp = (this.SORTS[sort] ?? this.SORTS.name).cmp;
    rows.sort(cmp);
    if (dir === 'desc') rows.reverse();
    rows.unchecked = unchecked;
    return rows;
  }

  /**
   * Add a feat to the actor, with its own grants taken over by the builder when
   * they can be, so a5e's window stays shut here too.
   */
  static async addToActor(actor, uuid, choices = {}, lv = {}) {
    const { GrantAbsorber } = await import('./grantAbsorber.js');
    return GrantAbsorber.addFeatureItem(actor, uuid, choices, lv, 'feat');
  }
}
