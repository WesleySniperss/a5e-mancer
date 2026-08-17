import { AM } from '../a5e-mancer.js';
import { ItemDescPanel } from './itemDescPanel.js';
import { applyItemIcon } from '../data/a5eIcons.js';

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
  static describe(doc, lv = {}) {
    // Prepared objects, so requiresConfig/getSelectionComponentProps are available
    const prepared = this.#preparedGrants(doc);
    if (!prepared.length) return [];

    const out = [];
    for (const [id, grant] of prepared) {
      if (grant?.grantType === 'feature') continue;  // described separately
      if (!this.#isSupported(grant, lv, doc?.type)) continue;
      if (!this.#needsConfig(grant)) continue;       // applied without asking

      const spec    = this.#specOf(grant);
      if (!spec) continue;
      const options = spec.options.map(key => ({ key, label: this.#labelFor(grant, key) }));
      if (!options.length) continue;   // nothing to choose — a5e applies the base set

      out.push({
        id,
        grant,                       // kept so the level can be re-checked later
        type:    grant.grantType,
        // What kind of proficiency or trait this is. Two grants can only collide
        // when these match, so the duplicate check needs them on the model.
        proficiencyType: grant.proficiencyType ?? '',
        traitType:       grant.traits?.traitType ?? '',
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
   * Prepared grants as [id, grant] pairs, falling back to the raw entries if the
   * document is unprepared.
   *
   * The id is the RECORD KEY, never `grant._id`, and that distinction is the
   * whole point. Across the a5e packs 785 grants carry no `_id` at all and
   * another 275 share one with a sibling grant on the same item — the archetype
   * feature rows are copies of each other, `_id` included. Keying the pickers on
   * `_id` therefore gave several rows one shared bucket of choices, so picking in
   * one row filled another's allowance, and the ones with no `_id` produced an
   * empty `data-grant-id` that the click handler rejected outright: the row
   * simply did not respond.
   *
   * `apply` has always read the record key — it is the path a5e itself updates
   * (`system.grants.<key>`) — so describing by `_id` also meant the choices were
   * filed under an id the apply step never looked up.
   */
  static #preparedGrants(doc) {
    if (doc?.grants && typeof doc.grants.entries === 'function') return [...doc.grants.entries()];
    if (doc?.grants && typeof doc.grants.values === 'function') {
      return [...doc.grants.values()].map(g => [g?._id ?? '', g]);
    }
    return Object.entries(doc?.system?.grants ?? {});
  }

  /**
   * Grants the builder owns elsewhere, so they must not appear as pickers here
   * and are stripped from the item data before creation:
   *   – `item`  → the Equipment tab
   *   – combat tradition traits → the Maneuvers tab claims one as you pick from it
   * See ActorCreationService#stripBuilderOwnedGrants, which must stay in step.
   */
  static #isOwnedElsewhere(grant, ownerType = '') {
    // The Equipment tab covers the starting gear a class and a background hand
    // out — and nothing else. Stripping every item grant meant the four heritage
    // features that grant an item lost it silently: removed here, and offered
    // nowhere, because no tab claims them.
    if (grant?.grantType === 'item') return ownerType === 'class' || ownerType === 'background';

    // Likewise the Maneuvers tab claims a tradition only from the class table.
    return grant?.grantType === 'trait'
        && grant.traits?.traitType === 'maneuverTraditions'
        && ownerType === 'class';
  }

  /**
   * Does this grant belong to the level being applied?
   *
   * a5e checks `level` against the CHARACTER level for `levelType: 'character'`
   * and against the CLASS level otherwise, and skips anything above it. Ignoring
   * that handed out every level's grants at once — the heritage traits meant for
   * later levels all arrived at 1st.
   *
   * @param {object} lv  { charLevel, clsLevel }
   */
  static #appliesAtLevel(grant, { charLevel = 1, clsLevel = 1 } = {}) {
    const level = Number(grant?.level ?? 0) || 0;
    if (level <= 0) return true;                       // ungated
    const ceiling = grant.levelType === 'character' ? charLevel : clsLevel;
    return level <= ceiling;
  }

  /** Only the grants introduced *at* this level — what a level-up must ask for. */
  static #isExactlyAtLevel(grant, { charLevel = 1, clsLevel = 1 } = {}) {
    const level = Number(grant?.level ?? 0) || 0;
    if (level <= 0) return charLevel <= 1 && clsLevel <= 1;
    return level === (grant.levelType === 'character' ? charLevel : clsLevel);
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
  static #isSupported(grant, lv = {}, ownerType = '') {
    if (!grant?.grantType) return false;
    if (this.#isOwnedElsewhere(grant, ownerType)) return false;
    if (!this.#appliesAtLevel(grant, lv)) return false;
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
        const options = flatten(props.choices);
        return {
          base:    flatten(props.base),
          options,
          total:   this.#allowance(props.count, options.length)
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
    const options = flatten(bucket.options);
    return {
      base:    flatten(bucket.base),
      options,
      total:   this.#allowance(bucket.total, options.length)
    };
  }

  /**
   * How many of a grant's options may be picked.
   *
   * Taken at face value this is just the grant's `total`, but 34 grants across
   * the a5e packs offer options and state no usable total — Battle Master lists
   * three abilities with `total: 0`, Beach Raider lists 27 languages with
   * `total: -1`. Read literally that is an allowance of none: the row renders,
   * refuses every click, and reports a limit of zero.
   *
   * One is the reading that matches the text in every one of those cases ("choose
   * a language", "+1 to one of three"), and it is the floor a5e's own rules
   * assume whenever a grant bothers to offer a choice at all. It is also the safe
   * direction to be wrong in: too few picks can be topped up by hand, whereas
   * handing out all 27 languages cannot be taken back without noticing.
   */
  static #allowance(total, optionCount) {
    const n = Number(total);
    if (Number.isFinite(n) && n > 0) return n;
    return optionCount > 0 ? 1 : 0;
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

  /**
   * A document's description, enriched so @UUID links and embeds resolve.
   * a5e declares description as a plain HTMLField — there is no .
   */
  static async #enrich(doc) {
    const raw = typeof doc?.system?.description === 'string'
      ? doc.system.description
      : (doc?.system?.description?.value ?? '');
    if (!raw) return '';
    try {
      const TE = foundry.applications?.ux?.TextEditor?.implementation ?? TextEditor;
      return await TE.enrichHTML(raw, { async: true, relativeTo: doc });
    } catch {
      return raw;
    }
  }

  /**
   * Does this feature tell the player to choose something that no grant records?
   *
   * 93 of the 1031 origin features in the a5e packs do exactly that. The
   * Tyrannized culture is the plain case: "All Hail the Tyrant" says *you gain
   * proficiency in either Deception or Intimidation* and carries no grant at
   * all, so nothing — not a5e, not this builder — ever asks. The choice simply
   * goes unmade unless the player notices the sentence.
   *
   * The prose cannot be turned into a picker: two thirds of them are free-form
   * ("choose either scars or scourge, then one of the following damage types"),
   * and guessing would apply the wrong thing some of the time. Flagging is what
   * can be done honestly — the row then says there is a decision here, with the
   * text one right-click away.
   */
  static #asksInProse(doc, html = '') {
    if (this.#preparedGrants(doc).length) return false;   // a grant records it

    const text = String(html).replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ');
    return /\b(?:choose (?:one|either|two|a |an |from)|gain proficiency (?:in|with) either|of your choice)\b/i
      .test(text);
  }

  static #defaultLabel(grant) {
    if (grant.grantType === 'ability')     return game.i18n.localize('am.grants.type-ability');
    if (grant.grantType === 'proficiency') return game.i18n.localize('am.grants.type-proficiency');
    if (grant.grantType === 'trait')       return game.i18n.localize('am.grants.type-trait');
    return game.i18n.localize('am.grants.type-generic');
  }

  /**
   * The separator between a granted feature's source uuid and a grant key inside
   * it. Nested choices are filed under `<feature uuid>|<grant key>` so they can be
   * handed back to the right document when that feature is created.
   */
  static NEST = '|';

  /**
   * Every grant on an item AND inside the features it grants, flattened.
   *
   * This is the fix for the thing that made whole class features disappear.
   * `canAbsorb` has always walked the full tree to decide whether the builder can
   * take an item over, but `describe` only ever looked at the top level — so the
   * builder promised to handle everything and then asked about a fraction of it.
   * A5e nests the interesting choices one level down: a class grants "1st Level
   * Class Features", that feature is "Soldiering Knacks", and the knacks are
   * feature grants on IT. Nothing asked, so every one of them silently took its
   * base set, which is empty. That is why knacks did not exist.
   *
   * @returns {Promise<{grants: object[], features: object[]}>} models whose ids
   *   are paths — `key` at the top, `<uuid>|key` one level down, and so on.
   */
  static async describeTree(doc, lv = {}, { depth = 0, prefix = '', seen = new Set() } = {}) {
    const out = { grants: [], features: [] };
    if (!doc || depth > this.#MAX_DEPTH) return out;

    const tag = (g) => ({ ...g, id: `${prefix}${g.id}`, source: doc.name ?? '' });
    out.grants.push(...this.describe(doc, lv).map(tag));

    const features = (await this.describeFeatures(doc, lv)).map(tag);
    out.features.push(...features);

    // Walk into everything a feature grant can hand out, base and options alike:
    // a base feature is granted outright, and its own choices still need asking.
    for (const model of features) {
      const uuids = [...model.baseUuids ?? [], ...model.options.map(o => o.key)];
      for (const uuid of uuids) {
        if (seen.has(uuid)) continue;               // already walked (or cycling)
        seen.add(uuid);
        try {
          const child = await fromUuid(uuid);
          if (!child) continue;
          const nested = await this.describeTree(child, lv, {
            depth: depth + 1,
            prefix: `${uuid}${this.NEST}`,
            seen
          });
          out.grants.push(...nested.grants);
          out.features.push(...nested.features);
        } catch (err) {
          AM.log(2, `Could not read nested grants of ${uuid}:`, err);
        }
      }
    }
    return out;
  }

  /** describeTree, keeping only what this level introduces. */
  static async describeTreeForLevel(doc, lv = {}) {
    const all = await this.describeTree(doc, lv);
    const atLevel = (model) => {
      const grant = this.#grantFor(model);
      return grant ? this.#isExactlyAtLevel(grant, lv) : false;
    };
    return { grants: all.grants.filter(atLevel), features: all.features.filter(atLevel) };
  }

  /**
   * The grant object a model was built from, so its level can be re-checked.
   * Cached on the model at describe time — re-resolving a nested uuid here would
   * mean another round of pack reads for every row.
   */
  static #grantFor(model) {
    return model?.grant ?? null;
  }

  /**
   * Split a flat choices object into the part belonging to this document and the
   * parts belonging to the features it grants.
   */
  static #choicesFor(choices, uuid) {
    const pre = `${uuid}${this.NEST}`;
    const out = {};
    for (const [id, picked] of Object.entries(choices ?? {})) {
      if (id.startsWith(pre)) out[id.slice(pre.length)] = picked;
    }
    return out;
  }

  /* ── applying ─────────────────────────────────────────── */

  /**
   * Apply the collected choices for an item that was created with `noGrant: true`.
   *
   * @param {Actor} actor
   * @param {Item}  item       the embedded item, whose `.grants` we drive
   * @param {object} choices   { [grantId]: string[] }
   * @param {object} [opts]
   * @param {Set<string>} [opts.skip]  grant ids to leave unapplied — how taking a
   *   feat instead of an ability score increase is expressed, since a5e has no
   *   grant for that choice and simply carries the two ability points.
   */
  static async apply(actor, item, choices = {}, lv = {}, depth = 0, { skip } = {}) {
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
      // without the same guard a class's 5th-level feature landed at creation,
      // and a heritage handed out every level's traits at once.
      if (!this.#appliesAtLevel(grant, lv)) continue;
      if (this.#isOwnedElsewhere(grant, item?.type)) continue;
      if (skip?.has(id)) { AM.log(3, `Grant ${id} skipped by choice`); continue; }

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

      if (!this.#isSupported(grant, lv, item?.type)) continue;
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
    //
    // Each one gets the slice of the choices filed under its own uuid. Passing
    // the whole object down was the other half of the missing-knacks bug: the
    // nested grant looked for its record key, the dialog had stored it under
    // `<uuid>|<key>`, nothing matched, and the choice was dropped.
    for (const feature of spawned) {
      const uuid = feature._stats?.compendiumSource ?? '';
      const sub  = uuid ? this.#choicesFor(choices, uuid) : {};
      await this.apply(actor, feature, sub, lv, depth + 1, { skip });
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
                                    { hpValue = 0, charLevel = 0, lv = null, skip = null } = {}) {
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

      // If the assignment did not take (a frozen or redefined prototype), a5e's
      // routine is still live. Applying ours too would double everything, so
      // hand the whole level back instead.
      if (proto.createLeveledGrants === original) {
        AM.log(2, 'createLeveledGrants could not be suppressed — a5e will handle this level');
        return false;
      }

      const update = { [path]: newLevel };
      // a5e's routine also writes the level's hit points. Suppressing it means
      // writing them here, or the character gains a level with no hit points.
      // hp.levels is a schema of keys 1–20, so anything outside that is skipped.
      if (hpValue > 0 && charLevel >= 1 && charLevel <= 20) {
        update[`system.hp.levels.${charLevel}`] = hpValue;
      }
      await classItem.update(update);
    } catch (err) {
      AM.log(1, 'Level update failed:', err);
      return false;
    } finally {
      proto.createLeveledGrants = original;
    }

    // The level is committed at this point. A failure here would leave the
    // character levelled with none of the level's grants and a5e's routine
    // already skipped, so it is reported rather than thrown.
    try {
      const fresh = actor.items.get(classItem.id) ?? classItem;
      await this.apply(actor, fresh, choices,
                       lv ?? { charLevel: charLevel || newLevel, clsLevel: newLevel },
                       0, { skip });
    } catch (err) {
      AM.log(1, `Applying the level ${newLevel} grants failed:`, err);
      ui.notifications.error(
        `${AM.NAME}: the level was gained but its features could not be applied — see the console.`
      );
    }
    return true;
  }

  /** Grants that belong to exactly this level — what a level-up has to ask for. */
  static describeForLevel(doc, lv = {}) {
    return this.describe(doc, lv).filter(g => {
      const grant = doc?.grants?.get?.(g.id);
      return grant && this.#isExactlyAtLevel(grant, lv);
    });
  }

  /** Feature grants introduced at exactly this level. */
  static async describeFeaturesForLevel(doc, lv = {}) {
    const all = await this.describeFeatures(doc, lv);
    return all.filter(f => {
      const grant = doc?.grants?.get?.(f.id);
      return grant && this.#isExactlyAtLevel(grant, lv);
    });
  }

  /**
   * Create one feature-ish item on the actor with its own grants taken over.
   *
   * The same three steps a feat, an archetype and a mixed-heritage gift all
   * need: read the document, create it with `noGrant` when the builder can
   * account for its grants, then apply the choices through a5e's own writers.
   *
   * @returns {Item|null} the created item, or null if it could not be added
   */
  /**
   * The heritage grant that hands out the gift.
   *
   * a5e labels it "Gifts" at 1st level and "Paragon Gifts" at 10th, both feature
   * grants with options; the level filter already separates them, so the label
   * is what distinguishes the gift from the traits that come alongside it.
   */
  static isGiftGrant(model) {
    return model?.type === 'feature'
        && /^gifts?$/i.test(String(model.label ?? '').trim())
        && (model.options ?? []).length > 0;
  }

  static async addFeatureItem(actor, uuid, choices = {}, lv = {}, label = 'item') {
    if (!actor || !uuid) return null;
    try {
      const doc = await fromUuid(uuid);
      if (!doc) { AM.log(1, `${label} not found:`, uuid); return null; }

      const data = doc.toObject();
      data._stats = data._stats || {};
      data._stats.compendiumSource = uuid;
      applyItemIcon(data);

      const absorb = await this.canAbsorb(doc, lv);
      const [created] = await actor.createEmbeddedDocuments('Item', [data],
                                                            absorb ? { noGrant: true } : {});
      if (created && absorb) await this.apply(actor, created, choices, lv);
      AM.log(3, `${label} added: ${doc.name}${absorb ? '' : ' (a5e handled its grants)'}`);
      return created ?? null;
    } catch (err) {
      AM.log(1, `${label} could not be added:`, err);
      ui.notifications.error(`${AM.NAME}: the ${label} could not be added — see the console.`);
      return null;
    }
  }

  /**
   * Add the archetype chosen for a class, with its own grants applied here.
   *
   * a5e creates it at the end of its grant routine and then sets its spellcasting
   * ability. Because that routine is suppressed, skipping this would mean the
   * archetype level passes and no archetype is ever gained.
   */
  static async applyArchetype(actor, uuid, lv = {}, choices = {}) {
    if (!actor || !uuid) return false;
    try {
      const doc = await fromUuid(uuid);
      if (!doc) { AM.log(1, 'Archetype not found:', uuid); return false; }

      const data = doc.toObject();
      data._stats = data._stats || {};
      data._stats.compendiumSource = uuid;

      const [created] = await actor.createEmbeddedDocuments('Item', [data], { noGrant: true });
      if (!created) return false;

      await this.apply(actor, created, choices, lv);

      // Archetypes can carry their own spellcasting ability, same as a class
      const options = created.system?.spellcasting?.ability?.options ?? [];
      const ability = options[0] ?? created.system?.spellcasting?.ability?.base ?? '';
      if (ability && ability !== 'none') {
        await created.update({ 'system.spellcasting.ability.value': ability });
      }

      AM.log(3, `Archetype added: ${created.name}`);
      return true;
    } catch (err) {
      AM.log(1, 'Archetype could not be applied:', err);
      ui.notifications.error(
        `${AM.NAME}: the archetype could not be applied — see the console.`
      );
      return false;
    }
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
  static async canAbsorb(doc, lv = {}, depth = 0, seen = new Set()) {
    const prepared = this.#preparedGrants(doc);
    if (!prepared.length) return depth > 0;          // leaf feature: fine

    if (depth > this.#MAX_DEPTH) return false;

    for (const [, grant] of prepared) {
      const type = grant?.grantType;
      if (!type) continue;
      if (this.#isOwnedElsewhere(grant, doc?.type)) continue;   // stripped before creation
      // A grant for a later level does not block absorption at this one
      if (!this.#appliesAtLevel(grant, lv)) continue;
      if (type === 'feature') {
        if (await this.#featuresAbsorbable(grant, lv, depth, seen)) continue;
        AM.log(2, `Absorption declined: feature grant "${grant.label ?? type}" `
                + `on ${doc?.name} has something the builder cannot model`);
        return false;
      }
      if (this.#isSupported(grant, lv, doc?.type)) continue;
      // Name the culprit — otherwise "a5e's window appeared" has no explanation
      AM.log(2, `Absorption declined: ${type} grant "${grant.label ?? ''}" on ${doc?.name} `
              + `asks for something with no listable options`);
      return false;
    }
    return true;
  }

  /** Every feature this grant can hand out must itself be absorbable. */
  static async #featuresAbsorbable(grant, lv, depth, seen) {
    const props = this.#specOf(grant);
    const uuids = [...(props?.base ?? []), ...(props?.options ?? [])];

    for (const uuid of uuids) {
      if (seen.has(uuid)) continue;                  // already cleared (or cycling)
      seen.add(uuid);
      try {
        const doc = await fromUuid(uuid);
        if (!doc) return false;
        if (!this.#preparedGrants(doc).length) continue;   // flat feature
        if (!await this.canAbsorb(doc, lv, depth + 1, seen)) return false;
      } catch {
        return false;                                // unreadable — do not gamble
      }
    }
    return true;
  }

  /**
   * Feature grants on this item, as a UI model (base always granted).
   *
   * Each feature carries its own description. They are what the player is
   * actually being asked about — a heritage gift, a background feature, an
   * elective study — and a bare name says nothing about what it does. The
   * document is already being read for the name, so the text costs no extra
   * lookup.
   */
  static async describeFeatures(doc, lv = {}) {
    const out = [];

    // The document has to be read for the name anyway, so its description is
    // banked for the panel at the same time. Right-clicking a row then shows
    // text we already hold instead of resolving the uuid a second time.
    const entryFor = async (uuid) => {
      try {
        const d = await fromUuid(uuid);
        if (!d) return { key: uuid, label: uuid };
        const html = await this.#enrich(d);
        ItemDescPanel.seeded.set(uuid, html);
        return {
          key: uuid,
          label: d.name ?? uuid,
          asksInProse: this.#asksInProse(d, html)
        };
      } catch {
        return { key: uuid, label: uuid };
      }
    };
    const name = async (uuid) => (await entryFor(uuid)).label;

    for (const [id, grant] of this.#preparedGrants(doc)) {
      if (grant?.grantType !== 'feature') continue;
      if (!this.#appliesAtLevel(grant, lv)) continue;   // a later level's feature

      const spec = this.#specOf(grant) ?? { base: [], options: [], total: 0 };
      out.push({
        id,
        grant,                       // kept so the level can be re-checked later
        type:  'feature',
        label: grant.label || game.i18n.localize('am.grants.type-feature'),
        total: spec.total,
        base:      spec.base,
        baseUuids: spec.base,        // describeTree walks these for nested grants
        baseLabels: await Promise.all(spec.base.map(name)),
        // Granted outright, but still the thing the player wants to read about
        baseEntries: await Promise.all(spec.base.map(entryFor)),
        options:     await Promise.all(spec.options.map(entryFor))
      });
    }
    return out;
  }

  /**
   * Create the features a feature-grant hands out and record them the way a5e
   * does, so the grant can still be removed cleanly later.
   */
  static async #applyFeatureGrant(actor, grant, chosenUuids) {
    const base    = (grant.features?.base ?? []).map(f => f.uuid).filter(Boolean);
    const options = (grant.features?.options ?? []);
    // Same allowance rule the picker was drawn with, or a choice the player was
    // shown and made would be silently dropped here.
    const total = this.#allowance(grant.features?.total, options.length);
    const picked = (chosenUuids ?? [])
      .filter(u => options.some(f => f.uuid === u))
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

    // Features keep their compendium _id, so anything the actor already has would
    // collide and make createEmbeddedDocuments throw — which is what stopped a
    // level-up dead. a5e filters the same way and counts the existing ones as
    // part of the grant's documentIds.
    const alreadyOwned = datas
      .map(d => d._id)
      .filter(id => id && actor.items.get(id));
    const fresh = datas.filter(d => !alreadyOwned.includes(d._id));

    let ids = [...alreadyOwned], items = [];
    if (fresh.length) {
      try {
        const created = await actor.createEmbeddedDocuments('Item', fresh, { noGrant: true, keepId: true });
        ids = [...ids, ...created.map(i => i.id)];
        items = [...created];
      } catch (err) {
        // Retry without keepId rather than abandoning the level: a duplicate id
        // is worth working around, a lost feature is not.
        AM.log(2, 'Feature creation with keepId failed; retrying without it:', err);
        const created = await actor.createEmbeddedDocuments('Item', fresh, { noGrant: true });
        ids = [...ids, ...created.map(i => i.id)];
        items = [...created];
      }
    }
    return { update: grant.getApplyData(actor, { uuids }) ?? {}, ids, items };
  }
}
