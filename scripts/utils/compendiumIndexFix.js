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
const ABILITY_RES = [
  [/\bstrength\b/i, 'str'], [/\bdexterity\b/i, 'dex'], [/\bconstitution\b/i, 'con'],
  [/\bintelligence\b/i, 'int'], [/\bwisdom\b/i, 'wis'], [/\bcharisma\b/i, 'cha']
];

function scanAsiWindow(ctx, found) {
  let hit = false;
  for (const [re, key] of ABILITY_RES) if (re.test(ctx)) { found.add(key); hit = true; }
  if (/spellcasting\s+abilit/i.test(ctx)) { found.add('spellcasting'); hit = true; }
  // "an ability score of your choice increases by 1" → any ability qualifies
  if (!hit && /ability\s+score/i.test(ctx)) for (const [, k] of ABILITY_RES) found.add(k);
}

/**
 * Extract which ability scores a feat increases from its description text
 * ("Your Strength or Dexterity score increases by 1, to a maximum of 20", …).
 * Validated against the whole feats pack: reproduces the hand-entered asi data
 * of all 29 synergy feats exactly, tags 224 of 625 feats, and correctly rejects
 * non-ASI phrases like "your speed increases by 10 feet" or "the maximum
 * Dexterity modifier … increases to 3".
 */
function parseAsiFromDescription(html) {
  const text = (html ?? '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
  const found = new Set();
  let m;
  // "…Your Strength, Dexterity, or Charisma score increases by 1" — the abilities
  // sit BEFORE the verb: take the window back to the previous sentence boundary.
  const before = /\bincreases?\s+by\s+\+?\d/gi;
  while ((m = before.exec(text))) {
    let ctx = text.slice(Math.max(0, m.index - 130), m.index);
    const cut = Math.max(ctx.lastIndexOf('.'), ctx.lastIndexOf(';'), ctx.lastIndexOf(':'));
    if (cut >= 0) ctx = ctx.slice(cut + 1);
    scanAsiWindow(ctx, found);
  }
  // "Increase your Strength score by 1" — the abilities FOLLOW the verb.
  const after = /\bincrease\s/gi;
  while ((m = after.exec(text))) {
    const win = text.slice(m.index, m.index + 120);
    if (!/\bby\s+\+?\d/i.test(win)) continue;
    scanAsiWindow(win.replace(/\bby\s+\+?\d[\s\S]*/i, ''), found);
  }
  return [...found];
}

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

      /* Data shims (INDEX only — the database is untouched). Real pack data,
         verified by dumping the LevelDB: only the ~27 synergy feats carry
         featType/asi; system.prerequisite however IS recorded as free text on
         most feats (122 of 625 have none). Tag the gaps with semantic defaults. */

      // Pre-pass: map of feat name → prerequisite, for series-chain resolution.
      const featPrereqs = new Map();
      for (const e of fresh) {
        if (e.type === 'feature' && e.system?.featureType === 'feat') {
          featPrereqs.set(e.name.toLowerCase(), (e.system.prerequisite ?? '').trim());
        }
      }
      // "Officer Training feat, 3 levels in marshal" → "Officer Training"
      const prereqFeatName = (prereq) => {
        for (const seg of (prereq ?? '').split(/[,;]/)) {
          const m = seg.trim().match(/^(?:and\s+|or\s+)?(.*?)\s+feats?$/i);
          if (m && m[1]) return m[1].trim();
        }
        return null;
      };
      // Walk prerequisites upward to the feat that starts the series.
      const chainRoot = (name, prereq, depth = 0) => {
        const parent = prereqFeatName(prereq);
        if (!parent || depth > 6) return name;
        const parentPrereq = featPrereqs.get(parent.toLowerCase());
        return parentPrereq === undefined ? parent : chainRoot(parent, parentPrereq, depth + 1);
      };
      const classKeys = new Map(
        Object.keys(CONFIG.A5E?.classes ?? {}).map(k => [k.toLowerCase(), k])
      );
      const chainRoots = new Set();

      for (const entry of fresh) {
        if (entry.type === 'feature' && entry.system?.featureType === 'feat') {
          const prereq = (entry.system.prerequisite ?? '').trim();

          // "Basic" = no synergy chain AND no prerequisite of any kind. Feats
          // whose prerequisite names another feat (289 of them) are series
          // followups; another 187 require levels/proficiencies — none of those
          // should surface under the Basic chip.
          if (!entry.system.featType && !entry.system.synergy && !prereq) {
            entry.system.featType = 'basic';
          }

          // Recover class prerequisites ("3 levels in marshal, 3 levels in
          // rogue") so the "A5E Class Prerequisites" filter covers these feats.
          // Values must be the CONFIG.A5E.classes keys the filter compares with.
          if (!Array.isArray(entry.system.featClasses) || !entry.system.featClasses.length) {
            const classes = [];
            const re = /\blevels?\s+in\s+([a-z]+(?:\s+[a-z]+)?)/gi;
            let m;
            while ((m = re.exec(prereq))) {
              const two = m[1].toLowerCase().replace(/\s+/g, '');
              const one = m[1].toLowerCase().split(/\s+/)[0];
              const key = classKeys.get(two) ?? classKeys.get(one);
              if (key) classes.push(key);
            }
            if (classes.length) entry.system.featClasses = classes;
          }

          // Series feats (prerequisite names another feat) → tag the whole
          // series with its root feat's name so the Synergy Chain filter can
          // list and select it like the official synergy chains.
          if (!entry.system.synergy && prereqFeatName(prereq)) {
            entry.system.synergy = chainRoot(entry.name, prereq);
            chainRoots.add(entry.system.synergy);
          }

          // No recorded ASI → recover it from the description text; feats that
          // genuinely grant no increase match the filter's explicit "None" option.
          if (!Array.isArray(entry.system.asi) || !entry.system.asi.length) {
            const parsed = parseAsiFromDescription(entry.system.description);
            entry.system.asi = parsed.length ? parsed : ['none'];
          }
        }

        const existing = pack.index.get(entry._id);
        entry.uuid = pack.getUuid(entry._id);
        pack.index.set(entry._id, existing ? foundry.utils.mergeObject(existing, entry) : entry);
      }

      // The roots themselves carry no feat-prerequisite, so the loop above
      // could not tag them — do it now so a chain selection includes its root.
      if (chainRoots.size) {
        for (const e of pack.index.values()) {
          if (e.type !== 'feature' || e.system?.featureType !== 'feat') continue;
          if (!e.system.synergy && chainRoots.has(e.name)) e.system.synergy = e.name;
        }
      }
      enriched++;
    } catch (err) {
      AM.log(2, `Index enrichment failed for ${pack?.collection}:`, err);
    }
  });

  await Promise.allSettled(jobs);

  // The system collects CONFIG.A5E.synergies from indexes at its own ready hook,
  // BEFORE this async enrichment finishes — re-collect so the browser's Synergy
  // Chain filter also lists the series chains derived above.
  try {
    const synergies = new Set(Object.keys(CONFIG.A5E?.synergies ?? {}));
    for (const pack of game.packs) {
      if (pack.metadata.type !== 'Item') continue;
      for (const e of pack.index.values()) {
        if (e.type !== 'feature' || e.system?.featureType !== 'feat') continue;
        const s = (e.system.synergy ?? '').trim();
        if (s) synergies.add(s);
      }
    }
    if (CONFIG.A5E) {
      CONFIG.A5E.synergies = Object.fromEntries(
        [...synergies].sort((a, b) => a.localeCompare(b)).map(s => [s, s])
      );
    }
  } catch (err) {
    AM.log(2, 'Synergy list rebuild failed:', err);
  }

  AM.log(3, `Compendium index fix: enriched ${enriched} packs for browser filters`);
}
