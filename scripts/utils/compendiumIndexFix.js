import { AM } from '../a5e-mancer.js';

/**
 * Fixes the a5e system's compendium browser filters.
 *
 * The system enriches pack indexes with the system.* fields its browser filters
 * read (system.degree, system.featureType, system.level, …) via
 * indexCompendiaFields() — but it runs that during the `setup` hook, when pack
 * indexes are still empty in Foundry v13. Its per-pack type detection
 * (most-frequent item type) then yields undefined and the enrichment silently
 * never happens, so every filter predicate reads undefined and feats, maneuvers,
 * spells etc. cannot be filtered.
 *
 * We re-run the same enrichment at `ready`, when indexes are loaded, and go one
 * better: fields are merged for the UNION of item types present in a pack, so
 * minority types in mixed packs (e.g. feats inside a features pack) are indexed
 * too — the system only ever indexed the majority type.
 *
 * Field lists mirror the system's FIELD_MAPPINGS (a5e.js) so its filter
 * predicates find exactly the properties they expect.
 */
const FIELD_MAPPINGS = {
  archetype: ['system.description', 'system.class', 'system.source'],
  feature: [
    'system.asi', 'system.description', 'system.classes', 'system.concentration',
    'system.featClasses', 'system.featType', 'system.featureType',
    'system.prerequisite', 'system.source', 'system.synergy'
  ],
  interaction: ['system.description', 'system.interactionType', 'system.source'],
  maneuver: [
    'system.description', 'system.exertionCost', 'system.concentration',
    'system.degree', 'system.isStance', 'system.source', 'system.tradition'
  ],
  npc: [
    'system.description', 'system.details.cr', 'system.details.creatureTypes',
    'system.details.elite', 'system.details.isSquad', 'system.details.isSwarm',
    'system.details.terrain', 'system.traits.size', 'system.source'
  ],
  spell: [
    'system.concentration', 'system.components', 'system.classes',
    'system.description', 'system.level', 'system.rare', 'system.ritual',
    'system.schools', 'system.source'
  ],
  object: [
    'system.requiresAttunement', 'system.bulky', 'system.objectType',
    'system.description', 'system.price', 'system.quantity', 'system.rarity',
    'system.source'
  ],
  generic: ['system.source', 'system.description']
};

/**
 * Enrich every compendium pack's index with the fields the a5e compendium
 * browser filters on. Safe to run repeatedly (merge is idempotent).
 */
export async function enrichCompendiumIndexes() {
  let enriched = 0;

  const jobs = game.packs.map(async (pack) => {
    try {
      if (!pack?.metadata?.type || !pack.index?.size) return;

      // Union of field lists for every item type present in this pack
      const types = new Set([...pack.index].map(e => e.type).filter(Boolean));
      const fields = new Set();
      for (const t of types) {
        for (const f of (FIELD_MAPPINGS[t] ?? FIELD_MAPPINGS.generic)) fields.add(f);
      }
      if (!fields.size) return;

      const fresh = await pack.getIndex({ fields: [...fields] });
      for (const entry of fresh) {
        const existing = pack.index.get(entry._id);
        entry.uuid = pack.getUuid(entry._id);
        pack.index.set(entry._id, existing ? foundry.utils.mergeObject(existing, entry) : entry);
      }
      enriched++;
    } catch (err) {
      AM.log(2, `Index enrichment failed for ${pack?.collection}:`, err);
    }
  });

  await Promise.allSettled(jobs);
  AM.log(3, `Compendium index fix: enriched ${enriched} packs for browser filters`);
}
