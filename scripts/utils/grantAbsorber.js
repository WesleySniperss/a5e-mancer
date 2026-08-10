import { AM } from '../a5e-mancer.js';

/**
 * Lets the builder ask for an item's grant choices itself, so a5e does not have to
 * open its own window for them.
 *
 * The apply step deliberately does NOT reimplement a5e's writes. Every grant object
 * exposes `getApplyData(actor, selection)`, which returns exactly the update a5e
 * would perform — including the `system.grants.<id>` bookkeeping record that makes
 * the grant removable later. We only supply the selection and skip the dialog by
 * creating the item with `{ noGrant: true }`.
 *
 * Coverage comes from two more methods on the same objects: `requiresConfig()`
 * says whether a grant has anything to ask, and `getSelectionComponentProps()`
 * returns { base, choices, count } in one shape for every grant type — the same
 * shape a5e's dialog renders from. So a grant either asks nothing and is applied
 * straight out, or asks something we can list. Anything that fails both tests
 * hands the whole item back to a5e — see #isSupported and canAbsorb.
 */
export class GrantAbsorber {


  /* ── reading ──────────────────────────────────────────── */

  /**
   * Build a UI model for one item's configurable grants.
   * @param {object} doc  compendium item (background, culture, …)
   * @returns {Array<{id, type, label, total, options: Array<{key,label}>, base: string[]}>}
   */
  static describe(doc) {
    // Prepared objects, so requiresConfig/getSelectionComponentProps are available
    const prepared = doc?.grants && typeof doc.grants.values === 'function'
      ? [...doc.grants.values()]
      : Object.values(doc?.system?.grants ?? {});
    if (!prepared.length) return [];

    const out = [];
    for (const grant of prepared) {
      if (grant?.grantType === 'feature') continue;  // described separately
      if (!this.#isSupported(grant)) continue;
      if (!this.#needsConfig(grant)) continue;       // applied without asking

      const spec    = this.#specOf(grant);
      if (!spec) continue;
      const options = spec.options.map(key => ({ key, label: this.#labelFor(grant, key) }));
      if (!options.length) continue;   // nothing to choose — a5e applies the base set

      out.push({
        id: grant._id,
        type:    grant.grantType,
        label:   grant.label || this.#defaultLabel(grant),
        total:   spec.total,
        base:    spec.base,
        baseLabels: spec.base.map(key => this.#labelFor(grant, key)),
        options
      });
    }
    return out;
  }

  /**
   * Grants the builder owns elsewhere, so they must not appear as pickers here
   * and are stripped from the item data before creation:
   *   – `item`  → the Equipment tab
   *   – combat tradition traits → the Maneuvers tab claims one as you pick from it
   * See ActorCreationService#stripBuilderOwnedGrants, which must stay in step.
   */
  static #isOwnedElsewhere(grant) {
    if (grant?.grantType === 'item') return true;
    return grant?.grantType === 'trait'
        && grant.traits?.traitType === 'maneuverTraditions';
  }

  /** Does this grant have anything to ask the player? a5e's own test. */
  static #needsConfig(grant) {
    try { return !!grant.requiresConfig?.(); }
    catch { return false; }
  }

  /**
   * A grant is absorbable when it either asks nothing — in which case
   * getApplyData writes it straight out, exactly as a5e does when it decides its
   * dialog is unnecessary — or asks something we can list as options.
   */
  static #isSupported(grant, level = 1) {
    if (!grant?.grantType) return false;
    if (this.#isOwnedElsewhere(grant)) return false;
    if (grant.level && grant.level > level) return false;
    if (!this.#needsConfig(grant)) return true;
    return !!this.#specOf(grant)?.options.length;
  }

  /**
   * Normalise a grant's choices into { base, options, total }.
   *
   * getSelectionComponentProps is a5e's own uniform shape — the one its dialog
   * renders from — so it covers every grant type rather than the handful whose
   * field names we happened to know. The per-type buckets remain as a fallback.
   * Feature and item grants list { uuid } objects; the rest list string keys.
   */
  static #specOf(grant) {
    const flatten = (list) => (Array.isArray(list) ? list : [])
      .map(v => (v && typeof v === 'object') ? (v.uuid ?? '') : v)
      .filter(Boolean);

    try {
      const props = grant.getSelectionComponentProps?.({});
      if (props) {
        return {
          base:    flatten(props.base),
          options: flatten(props.choices),
          total:   Number(props.count ?? 0) || 0
        };
      }
    } catch { /* fall through to the raw shapes */ }

    const bucket = grant.grantType === 'ability'     ? grant.abilities
                 : grant.grantType === 'proficiency' ? grant.keys
                 : grant.grantType === 'trait'       ? grant.traits
                 : grant.grantType === 'skill'       ? grant.skills
                 : grant.grantType === 'skillSpecialty' ? grant.keys
                 : null;
    if (!bucket) return null;
    return {
      base:    flatten(bucket.base),
      options: flatten(bucket.options),
      total:   Number(bucket.total ?? 0) || 0
    };
  }

  /** Human label for one option key, from the matching CONFIG.A5E table. */
  static #labelFor(grant, key) {
    const A5E = CONFIG?.A5E ?? {};
    const tables = {
      ability:     A5E.abilities,
      skill:       A5E.skills,
      skillSpecialty: A5E.skillSpecialties,
    };

    let table = tables[grant.grantType];
    if (grant.grantType === 'proficiency') {
      table = {
        skill: A5E.skills, tool: A5E.tools, language: A5E.languages,
        armor: A5E.armor, weapon: A5E.weapons, savingThrow: A5E.abilities
      }[grant.proficiencyType] ?? null;
    }
    if (grant.grantType === 'trait') {
      table = {
        maneuverTraditions: A5E.maneuverTraditions,
        conditionImmunities: A5E.conditions,
        damageImmunities: A5E.damageTypes,
        damageResistances: A5E.damageTypes,
        damageVulnerabilities: A5E.damageTypes,
        languages: A5E.languages,
        size: A5E.actorSizes
      }[grant.traits?.traitType] ?? null;
    }

    const raw = table?.[key];
    if (typeof raw === 'string') {
      const localized = game.i18n.localize(raw);
      // CONFIG tables hold either an i18n key or the label itself
      return localized === raw && !raw.includes('.') ? raw : localized;
    }
    if (raw && typeof raw === 'object' && raw.label) return game.i18n.localize(raw.label);
    // Fall back to a readable form of the key
    return String(key).replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase());
  }

  static #defaultLabel(grant) {
    if (grant.grantType === 'ability')     return game.i18n.localize('am.grants.type-ability');
    if (grant.grantType === 'proficiency') return game.i18n.localize('am.grants.type-proficiency');
    if (grant.grantType === 'trait')       return game.i18n.localize('am.grants.type-trait');
    return game.i18n.localize('am.grants.type-generic');
  }

  /* ── applying ─────────────────────────────────────────── */

  /**
   * Apply the collected choices for an item that was created with `noGrant: true`.
   *
   * @param {Actor} actor
   * @param {Item}  item       the embedded item, whose `.grants` we drive
   * @param {object} choices   { [grantId]: string[] }
   */
  static async apply(actor, item, choices = {}, depth = 0, level = 1) {
    if (!actor || !item) return;
    if (depth > this.#MAX_DEPTH) {
      AM.log(2, `Grant nesting too deep at ${item.name}; leaving the rest to a5e`);
      return;
    }

    const grantMap = item.grants;
    if (!grantMap) { AM.log(2, 'Item has no prepared grants collection:', item.name); return; }

    let update = {};
    let applied = 0;
    const documentIds = {};   // grantId → created feature item ids
    const spawned = [];       // features created here, whose own grants come next

    for (const [id, grant] of grantMap.entries?.() ?? []) {
      // a5e's grant routines skip anything above the level being applied;
      // without the same guard a class's 5th-level feature landed at creation.
      if (grant?.level && grant.level > level) continue;
      if (this.#isOwnedElsewhere(grant)) continue;

      if (grant?.grantType === 'feature') {
        try {
          const { update: u, ids, items } = await this.#applyFeatureGrant(actor, grant, choices[id]);
          update = foundry.utils.mergeObject(update, u, { inplace: false });
          if (ids.length) documentIds[id] = ids;
          spawned.push(...items);
          applied++;
        } catch (err) {
          AM.log(2, `Feature grant ${id} on ${item.name} failed:`, err);
        }
        continue;
      }

      if (!this.#isSupported(grant, level)) continue;
      const spec = this.#specOf(grant) ?? { base: [], options: [], total: 0 };

      // Chosen keys, capped at what the grant allows; base is always included.
      const picked = (choices[id] ?? []).filter(k => spec.options.includes(k)).slice(0, spec.total);
      const selected = [...new Set([...spec.base, ...picked])];

      try {
        // a5e's own writer — we never construct the update paths ourselves.
        // Grants with nothing to choose get the same call with just their base,
        // which is what a5e passes when it skips its dialog.
        const data = grant.getApplyData(actor, { selected });
        if (data && Object.keys(data).length) {
          update = foundry.utils.mergeObject(update, data, { inplace: false });
          applied++;
        }
      } catch (err) {
        AM.log(2, `getApplyData failed for grant ${id} on ${item.name}:`, err);
      }
    }

    // a5e records which items a feature grant produced; without this the grant
    // cannot be undone later.
    for (const [id, ids] of Object.entries(documentIds)) {
      update[`system.grants.${id}.documentIds`] = ids;
    }

    if (Object.keys(update).length) {
      await actor.update(update);
      AM.log(3, `Applied ${applied} absorbed grant(s) from ${item.name}`);
    }

    // The features we just created were made with noGrant, so their own grants
    // did not fire — a5e resolves this chain recursively and so must we.
    for (const feature of spawned) {
      await this.apply(actor, feature, choices, depth + 1, level);
    }
  }

  /* ── level changes ────────────────────────────────────── */

  /**
   * Raise a class's level without a5e opening its grant window, then apply the
   * new level's grants from the builder's own choices.
   *
   * Item creation has `noGrant`, but a level change has no equivalent: the class
   * item's `_preUpdate` calls `actor.grants.createLeveledGrants(...)`
   * unconditionally, and cancels the update if it returns falsy. The only way in
   * is to neutralise that one method for the duration of the update.
   *
   * This is the one place the module patches the system. It is a public method on
   * a reachable prototype (not one of the private #-methods), the patch is
   * removed in a finally, and it returns true so the update is never cancelled.
   * It is also the piece most likely to need checking after an a5e update.
   *
   * @returns {boolean} whether the level actually changed
   */
  static async levelUpWithoutDialog(actor, classItem, newLevel, choices = {},
                                    { hpValue = 0, charLevel = 0 } = {}) {
    if (!actor || !classItem) return false;

    const manager = actor.grants;
    const proto   = manager && Object.getPrototypeOf(manager);
    const original = proto?.createLeveledGrants;

    if (typeof original !== 'function') {
      AM.log(2, 'createLeveledGrants not found — letting a5e handle the level up');
      return false;
    }

    const path = classItem.system?.classLevels !== undefined ? 'system.classLevels'
               : classItem.system?.levels     !== undefined ? 'system.levels'
               : 'system.level';

    try {
      // Returning true keeps _preUpdate happy; the grants are ours to apply.
      proto.createLeveledGrants = async () => true;
      const update = { [path]: newLevel };
      // a5e's routine also writes the level's hit points. Suppressing it means
      // writing them here, or the character gains a level with no hit points.
      if (hpValue > 0 && charLevel > 0) update[`system.hp.levels.${charLevel}`] = hpValue;
      await classItem.update(update);
    } catch (err) {
      AM.log(1, 'Level update failed:', err);
      return false;
    } finally {
      proto.createLeveledGrants = original;
    }

    // Now the level's own grants, with the picks made in the dialog
    const fresh = actor.items.get(classItem.id) ?? classItem;
    await this.apply(actor, fresh, choices, 0, newLevel);
    return true;
  }

  /** Grants that belong to exactly this level — what a level-up has to ask for. */
  static describeForLevel(doc, level) {
    return this.describe(doc).filter(g => {
      const grant = doc?.grants?.get?.(g.id);
      return (grant?.level ?? 1) === level;
    });
  }

  /* ── class tail ───────────────────────────────────────── */

  /**
   * Everything a5e does for a CLASS item after its grants are applied.
   *
   * Its grant routine ends with three writes that are not grants at all, which is
   * why the class window could not simply be skipped:
   *   – the level's hit points, on the class item at system.hp.levels.<level>
   *   – the spellcasting ability, at system.spellcasting.ability.value
   *   – a spell book, configured for the class's casting resource
   * This mirrors that tail for a 1st-level class. Archetypes are not handled —
   * they are chosen at the class's archetypeLevel, never at creation.
   *
   * @param {object} opts
   * @param {number} opts.hpValue      hit points for level 1 (before CON)
   * @param {string} [opts.ability]    chosen spellcasting ability
   * @param {number} [opts.charLevel]  character level this class entry is for
   */
  static async applyClassTail(actor, classItem, { hpValue, ability, charLevel = 1 } = {}) {
    if (!actor || !classItem) return;
    const sys = classItem.system ?? {};

    const spellcasting = sys.spellcasting ?? {};
    const chosen = ability
      || spellcasting.ability?.options?.[0]
      || spellcasting.ability?.base
      || 'none';

    const clsUpdate = {};
    if (Number.isFinite(hpValue) && hpValue > 0) {
      clsUpdate[`system.hp.levels.${charLevel}`] = hpValue;
    }
    if (chosen) clsUpdate['system.spellcasting.ability.value'] = chosen;
    if (Object.keys(clsUpdate).length) {
      try { await classItem.update(clsUpdate); }
      catch (err) { AM.log(1, 'Class hit points / spellcasting ability failed:', err); }
    }

    if (!chosen || chosen === 'none') return;

    // Mark the actor's casting ability when this is the starting class
    try {
      if (actor.system?.classes?.startingClass === classItem.slug) {
        await actor.update({ 'system.attributes.spellcasting': chosen });
      }
    } catch (err) { AM.log(2, 'Could not set the actor spellcasting ability:', err); }

    await this.#ensureSpellBook(actor, classItem, chosen);
  }

  /** Create or configure the class's spell book, matching its casting resource. */
  static async #ensureSpellBook(actor, classItem, ability) {
    const book = {
      ability,
      name: `${classItem.name} Spell Book`,
      showSpellSlots: false
    };
    const resource = classItem.casting?.resource || 'slots';
    if      (resource === 'points')          book.showSpellPoints     = true;
    else if (resource === 'inventions')      book.showSpellInventions = true;
    else if (resource === 'artifactCharges') book.showArtifactCharges = true;
    else                                     book.showSpellSlots      = true;

    try {
      // More than one class means an additional book; otherwise configure the
      // one every character starts with, exactly as a5e does.
      if (Object.keys(actor.classes ?? {}).length > 1) {
        await actor.spellBooks.add(book);
      } else {
        const id = actor.spellBooks?.first()?._id;
        if (id) await actor.update({ [`system.spellBooks.${id}`]: book });
        else    await actor.spellBooks.add(book);
      }
      AM.log(3, `Spell book ready for ${classItem.name} (${resource}, ${ability})`);
    } catch (err) {
      AM.log(1, 'Spell book setup failed:', err);
    }
  }

  /**
   * Grants on this item that we are NOT taking over, so the caller can decide
   * whether a5e still needs to be involved.
   */
  static unsupported(doc) {
    const grants = doc?.system?.grants;
    if (!grants || typeof grants !== 'object') return [];
    return Object.entries(grants)
      .filter(([, g]) => g?.grantType && g.grantType !== 'item'
                         && g.grantType !== 'feature' && !this.#isSupported(g))
      .map(([id, g]) => ({ id, type: g.grantType, label: g.label ?? g.grantType }));
  }

  /* ── feature grants ───────────────────────────────────── */

  /** Guard against a feature that grants itself, directly or in a loop. */
  static #MAX_DEPTH = 6;

  /**
   * Can the builder own this item's whole grant set?
   *
   * `noGrant` is all-or-nothing per item: suppressing a5e's window also suppresses
   * every grant on it. So we only take over when nothing would be silently lost —
   * which means walking into the features a grant hands out, because those carry
   * grants of their own and a5e resolves them recursively.
   */
  static async canAbsorb(doc, depth = 0, seen = new Set()) {
    const grants = doc?.system?.grants;
    if (!grants || typeof grants !== 'object') return depth > 0;   // leaf feature: fine

    if (depth > this.#MAX_DEPTH) return false;

    // Prepared grant objects carry requiresConfig/getSelectionComponentProps;
    // the raw system.grants entries do not.
    const prepared = doc?.grants && typeof doc.grants.values === 'function'
      ? [...doc.grants.values()]
      : Object.values(grants);

    for (const grant of prepared) {
      const type = grant?.grantType;
      if (!type) continue;
      if (this.#isOwnedElsewhere(grant)) continue;   // stripped before creation
      // A grant for a later level does not block absorption at this one
      if (grant.level && grant.level > 1) continue;
      if (type === 'feature') {
        if (await this.#featuresAbsorbable(grant, depth, seen)) continue;
        return false;
      }
      if (this.#isSupported(grant)) continue;
      return false;                                  // asks something we cannot show
    }
    return true;
  }

  /** Every feature this grant can hand out must itself be absorbable. */
  static async #featuresAbsorbable(grant, depth, seen) {
    const uuids = [...(grant.features?.base ?? []), ...(grant.features?.options ?? [])]
      .map(f => f?.uuid).filter(Boolean);

    for (const uuid of uuids) {
      if (seen.has(uuid)) continue;                  // already cleared (or cycling)
      seen.add(uuid);
      try {
        const doc = await fromUuid(uuid);
        if (!doc) return false;
        const nested = doc.system?.grants;
        if (!nested || !Object.keys(nested).length) continue;   // flat feature
        if (!await this.canAbsorb(doc, depth + 1, seen)) return false;
      } catch {
        return false;                                // unreadable — do not gamble
      }
    }
    return true;
  }

  /** Feature grants on this item, as a UI model (base always granted). */
  static async describeFeatures(doc) {
    const grants = doc?.system?.grants;
    if (!grants || typeof grants !== 'object') return [];

    const out = [];
    for (const [id, grant] of Object.entries(grants)) {
      if (grant?.grantType !== 'feature') continue;
      if (grant.level && grant.level > 1) continue;   // a later level's feature
      const base    = grant.features?.base ?? [];
      const options = grant.features?.options ?? [];
      const total   = Number(grant.features?.total ?? 0) || 0;

      const name = async (uuid) => {
        try { return (await fromUuid(uuid))?.name ?? uuid; } catch { return uuid; }
      };
      out.push({
        id,
        label: grant.label || game.i18n.localize('am.grants.type-feature'),
        total,
        baseLabels: await Promise.all(base.map(f => name(f.uuid))),
        options: await Promise.all(options.map(async f => ({ key: f.uuid, label: await name(f.uuid) })))
      });
    }
    return out;
  }

  /**
   * Create the features a feature-grant hands out and record them the way a5e
   * does, so the grant can still be removed cleanly later.
   */
  static async #applyFeatureGrant(actor, grant, chosenUuids) {
    const base  = (grant.features?.base ?? []).map(f => f.uuid).filter(Boolean);
    const total = Number(grant.features?.total ?? 0) || 0;
    const picked = (chosenUuids ?? [])
      .filter(u => (grant.features?.options ?? []).some(f => f.uuid === u))
      .slice(0, total);

    const uuids = [...new Set([...base, ...picked])];
    if (!uuids.length) return { update: grant.getApplyData(actor, { uuids }) ?? {}, ids: [], items: [] };

    const datas = [];
    for (const uuid of uuids) {
      try {
        const doc = await fromUuid(uuid);
        if (!doc) continue;
        const data = doc.toObject();
        data._stats = data._stats || {};
        data._stats.compendiumSource = uuid;
        datas.push(data);
      } catch (err) { AM.log(2, `Feature ${uuid} could not be read:`, err); }
    }

    let ids = [], items = [];
    if (datas.length) {
      const created = await actor.createEmbeddedDocuments('Item', datas, { noGrant: true, keepId: true });
      ids   = created.map(i => i.id);
      items = [...created];
    }
    return { update: grant.getApplyData(actor, { uuids }) ?? {}, ids, items };
  }
}
