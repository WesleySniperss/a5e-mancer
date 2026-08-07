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
 * Only grant types whose choices are plain enumerable keys are handled. Anything
 * else (nested feature trees, spellcasting setup, class hit points) is left to a5e
 * — see #isSupported.
 */
export class GrantAbsorber {

  /** Grant types whose choices are plain enumerable keys. */
  static SUPPORTED = new Set(['ability', 'proficiency', 'trait', 'skill', 'skillSpecialty']);

  /* ── reading ──────────────────────────────────────────── */

  /**
   * Build a UI model for one item's configurable grants.
   * @param {object} doc  compendium item (background, culture, …)
   * @returns {Array<{id, type, label, total, options: Array<{key,label}>, base: string[]}>}
   */
  static describe(doc) {
    const grants = doc?.system?.grants;
    if (!grants || typeof grants !== 'object') return [];

    const out = [];
    for (const [id, grant] of Object.entries(grants)) {
      if (!this.#isSupported(grant)) continue;

      const spec    = this.#specOf(grant);
      if (!spec) continue;
      const options = spec.options.map(key => ({ key, label: this.#labelFor(grant, key) }));
      if (!options.length) continue;   // nothing to choose — a5e applies the base set

      out.push({
        id,
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

  static #isSupported(grant) {
    if (!grant?.grantType) return false;
    if (!this.SUPPORTED.has(grant.grantType)) return false;
    // Levelled grants belong to the class flow, not to a one-off origin pick
    if (grant.level && grant.level > 1) return false;
    return true;
  }

  /** Normalise the per-type shape into { base, options, total }. */
  static #specOf(grant) {
    const bucket = grant.grantType === 'ability'     ? grant.abilities
                 : grant.grantType === 'proficiency' ? grant.keys
                 : grant.grantType === 'trait'       ? grant.traits
                 : grant.grantType === 'skill'       ? grant.skills
                 : grant.grantType === 'skillSpecialty' ? grant.keys
                 : null;
    if (!bucket) return null;
    return {
      base:    Array.isArray(bucket.base) ? bucket.base : [],
      options: Array.isArray(bucket.options) ? bucket.options : [],
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
  static async apply(actor, item, choices = {}) {
    if (!actor || !item) return;

    const grantMap = item.grants;
    if (!grantMap) { AM.log(2, 'Item has no prepared grants collection:', item.name); return; }

    let update = {};
    let applied = 0;
    const documentIds = {};   // grantId → created feature item ids

    for (const [id, grant] of grantMap.entries?.() ?? []) {
      if (grant?.grantType === 'feature') {
        try {
          const { update: u, ids } = await this.#applyFeatureGrant(actor, grant, choices[id]);
          update = foundry.utils.mergeObject(update, u, { inplace: false });
          if (ids.length) documentIds[id] = ids;
          applied++;
        } catch (err) {
          AM.log(2, `Feature grant ${id} on ${item.name} failed:`, err);
        }
        continue;
      }

      if (!this.#isSupported(grant)) continue;
      const spec = this.#specOf(grant);
      if (!spec) continue;

      // Chosen keys, capped at what the grant allows; base is always included.
      const picked = (choices[id] ?? []).filter(k => spec.options.includes(k)).slice(0, spec.total);
      const selected = [...new Set([...spec.base, ...picked])];

      try {
        // a5e's own writer — we never construct the update paths ourselves
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

  /**
   * Feature grants hand out items, and those items may carry grants of their own —
   * a5e resolves that recursively. We only take over the flat case; anything with
   * a nested grant goes back to a5e untouched.
   */
  static async #featuresAreFlat(grant) {
    const uuids = [...(grant.features?.base ?? []), ...(grant.features?.options ?? [])]
      .map(f => f?.uuid).filter(Boolean);
    for (const uuid of uuids) {
      try {
        const doc = await fromUuid(uuid);
        const nested = doc?.system?.grants;
        if (nested && Object.keys(nested).length) return false;
      } catch { return false; }   // unreadable — do not gamble
    }
    return true;
  }

  /**
   * Can the builder own this item's whole grant set?
   *
   * `noGrant` is all-or-nothing per item: suppressing a5e's window also suppresses
   * every grant on it. So we only take over when nothing would be silently lost.
   */
  static async canAbsorb(doc) {
    const grants = doc?.system?.grants;
    if (!grants || typeof grants !== 'object') return false;

    for (const grant of Object.values(grants)) {
      const type = grant?.grantType;
      if (!type) continue;
      if (type === 'item') continue;                 // stripped — the Equipment tab owns gear
      if (this.#isSupported(grant)) continue;
      if (type === 'feature') {
        if (await this.#featuresAreFlat(grant)) continue;
        return false;
      }
      return false;                                  // something we do not model
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
    if (!uuids.length) return { update: grant.getApplyData(actor, { uuids }) ?? {}, ids: [] };

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

    let ids = [];
    if (datas.length) {
      const created = await actor.createEmbeddedDocuments('Item', datas, { noGrant: true, keepId: true });
      ids = created.map(i => i.id);
    }
    return { update: grant.getApplyData(actor, { uuids }) ?? {}, ids };
  }
}
