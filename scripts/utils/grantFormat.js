/**
 * Grants written in a5e 1.3's shape, given a5e 1.4's as well.
 *
 * a5e 1.4 reads a grant's `type`, `name` and `config`; 1.3 its `grantType`,
 * `label` and the buckets beside them (`keys`, `traits`, `features`…). The
 * content this module writes itself - the documents converted from a5e.tools,
 * the magic maneuver pack - was written in 1.3's shape, which 1.4 reads as a
 * grant with nothing in it: a heritage's darkvision of no range, a language
 * list filed as condition immunities. a5e migrates the documents of a world,
 * not the data a module builds packs from, so the module converts its own.
 *
 * The conversion is a5e's own (src/migration/migrations/025-migrate-grants.ts,
 * a5e 1.4.4), with one difference: the 1.3 fields stay, so the same data reads
 * on either a5e. A grant that already has a `config` is left as it is.
 *
 * Pure - no Foundry - so the pack builders and the checks share it.
 */

const BUCKET = (b = {}) => ({ base: [...(b.base ?? [])], options: [...(b.options ?? [])], total: b.total || 0 });

export function grantToV14(grant, id = '') {
  if (!grant || typeof grant !== 'object') return grant;
  if (grant.config && typeof grant.config === 'object' && Object.keys(grant.config).length) return grant;
  const type = grant.type || grant.grantType || '';
  const out = {
    ...grant,
    id: grant.id || id || grant._id || '',
    name: grant.name || grant.label || '',
    img: grant.img || '',
    level: grant.level || 1,
    levelType: grant.levelType || 'character',
    optional: grant.optional || false,
    type,
    grantType: type
  };
  const config = {};
  switch (type) {
    case 'ability':
      config.abilities = BUCKET(grant.abilities);
      config.bonus = grant.bonus || '';
      config.context = grant.context ?? {};
      break;
    case 'attack':
      config.attackTypes = BUCKET(grant.attackTypes);
      config.bonus = grant.bonus || '';
      config.context = grant.context ?? {};
      break;
    case 'damage':
      config.damageType = grant.damageType || '';
      config.bonus = grant.bonus || '';
      config.context = grant.context || {};
      break;
    case 'exertion':
      config.exertionType = grant.exertionType || 'bonus';
      config.bonus = grant.bonus || '';
      config.poolType = grant.poolType || 'none';
      break;
    case 'expertiseDice':
      config.keys = BUCKET(grant.keys);
      config.expertiseCount = grant.expertiseCount || 1;
      config.expertiseType = grant.expertiseType || 'abilityCheck';
      break;
    case 'feature': {
      const f = (x) => ({ uuid: x?.uuid || '', limitedReselection: x?.limitedReselection ?? true, selectionLimit: x?.selectionLimit || 1 });
      config.features = {
        base: (grant.features?.base ?? []).map(f),
        options: (grant.features?.options ?? []).map(f),
        total: grant.features?.total || 0
      };
      break;
    }
    case 'healing':
      config.healingType = grant.healingType || 'healing';
      config.bonus = grant.bonus || '';
      config.context = grant.context ?? {};
      break;
    case 'hitPoint':
    case 'initiative':
      config.bonus = grant.bonus || '';
      config.context = grant.context ?? {};
      break;
    case 'item': {
      const i = (x) => ({ uuid: x?.uuid || '', quantityOverride: x?.quantityOverride || 0 });
      config.items = {
        base: (grant.items?.base ?? []).map(i),
        options: (grant.items?.options ?? []).map(i),
        total: grant.items?.total || 0
      };
      break;
    }
    case 'movement':
      config.movementTypes = BUCKET(grant.movementTypes);
      config.bonus = grant.bonus || '';
      config.context = grant.context ?? {};
      config.unit = grant.unit || 'feet';
      break;
    case 'proficiency': {
      const p = grant.proficiencyType || 'armor';
      const pre = (v) => (String(v).includes(':') ? String(v) : `${p}:${v}`);
      config.keys = {
        base: (grant.keys?.base ?? []).map(pre),
        options: grant.keys?.options?.length
          ? [{ count: grant.keys?.total || 1, candidates: grant.keys.options.map(pre) }]
          : []
      };
      config.isExpertise = grant.isExpertise || false;
      break;
    }
    case 'rollOverride':
      config.keys = BUCKET(grant.keys);
      config.rollMode = grant.rollMode || 0;
      config.rollOverrideType = grant.rollOverrideType || 'abilityCheck';
      break;
    case 'senses':
      config.senses = BUCKET(grant.senses);
      config.bonus = grant.bonus || '';
      config.context = grant.context ?? {};
      config.unit = grant.unit || 'feet';
      break;
    case 'skill':
      config.skills = BUCKET(grant.skills);
      config.bonus = grant.bonus || '';
      config.context = grant.context ?? {};
      break;
    case 'skillSpecialty':
      config.specialties = BUCKET(grant.specialties ?? grant.keys);
      config.skill = grant.skill;
      break;
    case 'trait':
      config.traits = { ...BUCKET(grant.traits), traitType: grant.traits?.traitType || 'conditionImmunities' };
      break;
    default:
      return out;
  }
  out.config = config;
  return out;
}

/** Every grant of one item's data, in place. */
export function grantsToV14(itemData) {
  const grants = itemData?.system?.grants;
  if (!grants || typeof grants !== 'object') return itemData;
  for (const [id, g] of Object.entries(grants)) grants[id] = grantToV14(g, id);
  return itemData;
}

/** An item, or an actor with its items. */
export function documentToV14(data) {
  grantsToV14(data);
  for (const item of data?.items ?? []) grantsToV14(item);
  return data;
}

/** Bumped when the conversion changes, so packs built from it are rebuilt. */
export const GRANT_FORMAT = 'g14.1';
