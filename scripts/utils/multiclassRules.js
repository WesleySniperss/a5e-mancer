import { AM } from '../a5e-mancer.js';
import { A5E_MULTICLASS, classKey } from '../data/a5eClassData.js';

/**
 * Cuts a class item down to what it hands out as an ADDITIONAL class.
 *
 * a5e's grant engine knows nothing about multiclassing: creating a class item on
 * an actor fires its 1st-level grants whole, so a character taking a fighter
 * level sixth was offered the fighter's saving throws, its three skills and a
 * set of starting equipment — the full first-class package, every time.
 *
 * Rather than reimplement a5e's writes, this trims the item data BEFORE it is
 * created. Whatever survives here is what a5e's own dialog asks about, so the
 * player still picks through the familiar window and the `system.grants`
 * bookkeeping that makes a grant removable later stays a5e's.
 *
 * Three rules apply to every class, table entry or not:
 *   – saving throw proficiencies come from your first class alone,
 *   – so does starting equipment,
 *   – features, the class knack and combat maneuvers arrive as normal (the
 *     exertion pool does not stack, but a5e derives that itself).
 * Everything else is per class, and lives in A5E_MULTICLASS.
 *
 * Two of a5e's grant shapes look like this one's business and are not:
 *   – `grantType: 'skill'` is a SkillGrant, which writes a skill *bonus*
 *     (`system.bonuses.skills.<id>`, with a formula) — a class feature, not a
 *     starting proficiency. Only `proficiency` + `proficiencyType: 'skill'`
 *     makes a character proficient.
 *   – a proficiency grant with `isExpertise` is the Expertise feature doubling
 *     a proficiency the character already has.
 * Trimming either of them would take away a feature the rules do hand over.
 */
export class MulticlassRules {

  /** The multiclass entry for a class name, or null if the table has no row. */
  static spec(className) {
    return A5E_MULTICLASS[classKey(className)] ?? null;
  }

  /**
   * Trim one class item's data in place, ready to be created as a second class.
   *
   * @param {object} data              a class item's `toObject()` data
   * @param {object} [opts]
   * @param {boolean} [opts.log=true]  false when previewing rather than applying
   * @returns {{ known: boolean, dropped: string[], trimmed: string[] }}
   */
  static apply(data, { log = true } = {}) {
    const spec   = this.spec(data?.name);
    const result = { known: !!spec, dropped: [], trimmed: [] };
    const grants = data?.system?.grants;
    if (!grants || typeof grants !== 'object') return result;

    // A class's allowance is a total, not a per-grant one. Two 1st-level skill
    // grants (a fixed skill and a choice, say) would otherwise each be handed
    // the whole multiclass allowance and hand out twice what the rules allow,
    // so the first one to arrive spends it and the rest are dropped.
    const spent = new Set();
    let sawSkillProficiency = false;

    for (const [id, grant] of Object.entries(grants)) {
      if (this.#pastFirstLevel(grant)) continue;
      if (this.#isSkillProficiency(grant)) sawSkillProficiency = true;

      let verdict;
      try {
        verdict = this.#verdict(grant, spec, spent);
      } catch (err) {
        // A grant we cannot read is left exactly as a5e would apply it: too many
        // proficiencies is a mistake the player can see and undo, too few is not.
        AM.log(2, `Multiclass trim skipped a grant on ${data?.name}:`, err);
        continue;
      }

      const label = grant.label || grant.proficiencyType || grant.grantType;
      if (verdict === 'drop')      { delete grants[id]; result.dropped.push(label); }
      else if (verdict === 'trim') { result.trimmed.push(label); }
    }

    // A class whose entry grants a named skill outright (the wizard's Arcana)
    // needs one even when the item carries no skill proficiency grant to narrow.
    if (spec?.skills?.base?.length && !sawSkillProficiency) {
      if (this.#addSkillGrant(grants, spec.skills.base, data?.name)) result.trimmed.push('skill');
    }

    if (log) {
      AM.log(3, `Multiclass ${data?.name}: dropped ${result.dropped.length} grant(s), `
              + `trimmed ${result.trimmed.length}`
              + `${spec ? '' : ' (no table entry — universal rules only)'}`);
    }
    return result;
  }

  /* ── one grant at a time ──────────────────────────────── */

  /**
   * 'keep' | 'trim' | 'drop' for a single grant.
   *
   * With no table entry only the universal rules run, so a third-party class
   * keeps its own proficiencies rather than a guessed slice of them.
   */
  static #verdict(grant, spec, spent) {
    if (grant?.grantType === 'item') return 'drop';          // no starting equipment
    if (grant?.grantType !== 'proficiency') return 'keep';   // features, traits, bonuses

    const type = grant.proficiencyType;
    if (type === 'savingThrow') return 'drop';
    if (grant.isExpertise) return 'keep';                    // the Expertise feature
    if (!spec) return 'keep';

    if (type === 'armor')  return this.#narrow(grant.keys, spec.armor);
    if (type === 'weapon') return this.#narrow(grant.keys, this.#weaponKeys(spec.weapons));

    if (type === 'tool') {
      if (spec.tools === 'all') return 'keep';
      if (!spec.tools || spent.has('tool')) return 'drop';
      spent.add('tool');
      return this.#choose(grant.keys, spec.tools);
    }
    if (type === 'skill') {
      if (!spec.skills || spent.has('skill')) return 'drop';
      spent.add('skill');
      return this.#choose(grant.keys, spec.skills);
    }
    return 'keep';                                           // languages, traditions
  }

  /** Skill PROFICIENCY, as opposed to a SkillGrant's skill bonus. */
  static #isSkillProficiency(grant) {
    return grant?.grantType === 'proficiency'
        && grant.proficiencyType === 'skill'
        && !grant.isExpertise;
  }

  /**
   * The table names weapon proficiencies by category, but a5e stores them one
   * weapon at a time — `system.proficiencies.weapons` holds `shortsword`, never
   * `martial`, and its sheet only collapses a category back into a heading once
   * every weapon in it is present. Matching a spec of `['simple']` against those
   * keys literally found nothing and dropped the grant, so a warlock taken as a
   * second class came away with no weapons at all.
   *
   * @returns {string[]|'all'|null}  null when CONFIG cannot resolve a category,
   *                                 which means keep the grant rather than guess.
   */
  static #weaponKeys(categories) {
    if (categories === 'all') return 'all';
    if (!Array.isArray(categories) || !categories.length) return [];

    const config = CONFIG?.A5E?.weapons ?? {};
    const keys   = new Set(categories);        // the category name itself, just in case
    for (const category of categories) {
      const group = config[category];
      if (!group || typeof group !== 'object') {
        AM.log(2, `Multiclass: CONFIG.A5E.weapons has no "${category}" — `
                + `leaving the class's weapon grant alone`);
        return null;
      }
      for (const key of Object.keys(group)) keys.add(key);
    }
    return [...keys];
  }

  /**
   * Keep only the listed keys. `'all'` leaves the grant alone — the class's
   * multiclass list is its full one — `[]` drops it, and null keeps it because
   * the allowance could not be resolved.
   */
  static #narrow(bucket, allowed) {
    if (allowed === 'all' || allowed === null) return 'keep';
    if (!Array.isArray(allowed) || !allowed.length) return 'drop';
    if (!bucket) return 'keep';

    const before   = (bucket.base ?? []).length + (bucket.options ?? []).length;
    bucket.base    = (bucket.base ?? []).filter(k => allowed.includes(k));
    bucket.options = (bucket.options ?? []).filter(k => allowed.includes(k));
    bucket.total   = Math.min(Number(bucket.total ?? 0) || 0, bucket.options.length);

    if (!bucket.base.length && !bucket.options.length) return 'drop';
    return before === bucket.base.length + bucket.options.length ? 'keep' : 'trim';
  }

  /**
   * Narrow a choice: `total` picks, optionally restricted by `only`, plus any
   * `base` keys granted outright.
   */
  static #choose(bucket, choice) {
    if (!bucket) return 'keep';

    bucket.base = [...(choice.base ?? [])];
    const total = Number(choice.total ?? 0) || 0;

    if (total <= 0) {
      bucket.options = [];
      bucket.total   = 0;
      return bucket.base.length ? 'trim' : 'drop';
    }

    if (choice.only?.length) {
      const kept = (bucket.options ?? []).filter(k => choice.only.includes(k));
      // The rule names the skills, so an option list sharing none of them is a
      // mismatched compendium, not a shorter allowance: use the named ones.
      bucket.options = kept.length ? kept : [...choice.only];
    }

    bucket.total = Math.min(total, (bucket.options ?? []).length);
    if (!bucket.total && !bucket.base.length) return 'drop';
    return 'trim';
  }

  /** Grants for later levels are left to the level-ups that reach them. */
  static #pastFirstLevel(grant) {
    return (Number(grant?.level ?? 0) || 0) > 1;
  }

  /** A plain proficiency grant for skills the entry hands out with no choice. */
  static #addSkillGrant(grants, keys, className) {
    try {
      const id = foundry.utils.randomID();
      grants[id] = {
        _id: id,
        grantType: 'proficiency',
        proficiencyType: 'skill',
        keys: { base: [...keys], options: [], total: 0 },
        label: game.i18n.localize('am.levelup.mc-prof-title'),
        level: 1,
        levelType: 'class',
        optional: false,
      };
      return true;
    } catch (err) {
      AM.log(2, `Could not add the multiclass skill grant for ${className}:`, err);
      return false;
    }
  }

  /* ── UI ───────────────────────────────────────────────── */

  /**
   * What the player is about to get — and what the same class would have given
   * had they started with it — read off the very item that will be created.
   *
   * Describing the table instead would be describing an intention: this reports
   * the outcome, so a compendium that disagrees with the table shows up here
   * rather than as a surprise in a5e's window afterwards. Naming the loss
   * concretely is the point of the panel: "no saving throws" is a rule, but
   * "not Strength and Constitution, and not three skills" is the decision.
   *
   * @param {object} data  a class item's `toObject()` data (not modified)
   * @returns {{ known: boolean, lines: string[], lost: string[],
   *             lostEquipment: boolean, hasLosses: boolean }}
   */
  static preview(data) {
    const empty = {
      known: !!this.spec(data?.name),
      lines: [], lost: [], lostEquipment: false, hasLosses: false,
    };

    let clone;
    try { clone = structuredClone(data); }
    catch { return empty; }

    const before  = this.#profLines(data);
    const { known } = this.apply(clone, { log: false });
    const after   = this.#profLines(clone);

    // Whole categories the second class no longer hands over. A category that
    // merely shrank (three skills down to one) is not a loss to list — the
    // surviving line already says how many are left.
    const lost = MulticlassRules.#ORDER
      .filter(type => before[type]?.length && !after[type]?.length)
      .flatMap(type => before[type]);

    const lostEquipment = this.#hasEquipment(data) && !this.#hasEquipment(clone);

    return {
      known,
      lines: MulticlassRules.#ORDER.flatMap(type => after[type] ?? []),
      lost,
      lostEquipment,
      hasLosses: lost.length > 0 || lostEquipment,
    };
  }

  /** Proficiency categories in the order the rulebook lists them. */
  static #ORDER = ['armor', 'weapon', 'skill', 'tool', 'language', 'savingThrow'];

  /** One line per proficiency category present at 1st level, keyed by category. */
  static #profLines(data) {
    const out = {};
    for (const grant of Object.values(data?.system?.grants ?? {})) {
      if (grant?.grantType !== 'proficiency') continue;
      if (this.#pastFirstLevel(grant)) continue;
      if (grant.isExpertise) continue;                 // a feature, not the starting kit
      const line = this.#lineFor(grant);
      if (!line) continue;
      (out[grant.proficiencyType] ??= []).push(line);
    }
    return out;
  }

  static #hasEquipment(data) {
    return Object.values(data?.system?.grants ?? {})
      .some(g => g?.grantType === 'item' && !this.#pastFirstLevel(g));
  }

  /** "Light Armor, Shields" / "2 skills from: Culture, History, …" */
  static #lineFor(grant) {
    const type   = grant.proficiencyType;
    const bucket = grant.keys ?? {};
    const parts  = [];

    const base = type === 'weapon'
      ? this.#weaponLabels(bucket.base ?? [])
      : (bucket.base ?? []).map(k => this.#label(type, k));
    if (base.length) parts.push(base.join(', '));

    const total = Number(bucket.total ?? 0) || 0;
    if (total > 0) {
      const options = type === 'weapon'
        ? this.#weaponLabels(bucket.options ?? [])
        : (bucket.options ?? []).map(k => this.#label(type, k));
      const kind = this.#kind(type, total);
      // A short list is worth naming; the fighter's forty weapons are not.
      parts.push(options.length && options.length <= 6
        ? game.i18n.format('am.levelup.mc-prof-choose-from',
            { count: total, kind, list: options.join(', ') })
        : game.i18n.format('am.levelup.mc-prof-choose', { count: total, kind }));
    }

    return parts.join(' + ');
  }

  /**
   * Weapon keys as a5e's own sheet shows them: a category becomes its heading
   * once every weapon in it is present, and the rest are named one by one.
   */
  static #weaponLabels(keys) {
    const config = CONFIG?.A5E?.weaponsPlural ?? CONFIG?.A5E?.weapons ?? {};
    const left   = new Set(keys);
    const out    = [];

    for (const [category, group] of Object.entries(config)) {
      const groupKeys = Object.keys(group ?? {});
      if (!groupKeys.length || !groupKeys.every(k => left.has(k))) continue;
      groupKeys.forEach(k => left.delete(k));
      out.push(this.#localize(`A5E.weapons.categories.${category}`, category));
    }
    for (const key of left) out.push(this.#label('weapon', key));
    return out;
  }

  /** Human label for one proficiency key, from a5e's own config tables. */
  static #label(type, key) {
    const A5E   = CONFIG?.A5E ?? {};
    const flat  = (groups) => Object.values(groups ?? {})
      .reduce((acc, g) => (g && typeof g === 'object' ? Object.assign(acc, g) : acc), {});
    const table = {
      // A proficiency list reads in the plural — "Shields", not "Shield".
      armor:       A5E.armorPlural ?? A5E.armor,
      skill:       A5E.skills,
      savingThrow: A5E.abilities,
      language:    A5E.languages,
      tool:        flat(A5E.toolsPlural ?? A5E.tools),
      weapon:      flat(A5E.weaponsPlural ?? A5E.weapons),
    }[type];

    const raw = table?.[key];
    return typeof raw === 'string' ? this.#localize(raw, key) : this.#prettify(key);
  }

  /** The noun for a "choose N …" line, in the form the count calls for. */
  static #kind(type, count) {
    return game.i18n.localize(`am.levelup.mc-prof-kind-${type}-${count === 1 ? 'one' : 'other'}`);
  }

  /** Localize, falling back to a readable form of the key when there is no string. */
  static #localize(path, key) {
    const out = game.i18n.localize(path);
    return out === path ? this.#prettify(key) : out;
  }

  static #prettify(key) {
    return String(key).replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase());
  }
}
