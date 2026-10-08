import { AM } from '../am.js';

/**
 * What a character's grants applied, in one shape whichever a5e this is.
 *
 * a5e 1.3 kept a record per applied grant on the actor (`actor.grants`):
 *   { grantId, itemUuid, grantType, level, documentIds, bonusId, type,
 *     proficiencyData, traitData, expertiseDiceData, specialtyData, … }
 * a5e 1.4 dropped those. `actor.grants` now holds the item grants that are
 * applied, keyed "<itemId>.<grantId>", each with the record on the grant
 * itself (`applied`): grantType 'document' | 'bonus' | 'proficiency' | 'trait'
 * …, the keys picked as `selected` ("skill:ath" for a proficiency).
 *
 * The level list and Lower Level read 1.3's shape; a 1.4 grant is turned into
 * it here, with the grant itself kept as `v14` for removing it.
 */
export class GrantRecords {

  /** Every applied grant of the actor, as 1.3-shaped records. */
  static of(actor) {
    const g = actor?.grants;
    const list = g?.values ? [...g.values()] : [];
    return list.map((x) => (this.#isV14(x) ? this.#fromV14(x) : x)).filter(Boolean);
  }

  static #isV14(grant) {
    return !!grant?.applied && typeof grant.applied === 'object' && 'isApplied' in grant.applied;
  }

  static #fromV14(grant) {
    const a = grant.applied ?? {};
    const type = grant.type || grant.grantType || '';
    const selected = [...(a.selected ?? [])];
    const rec = {
      v14: grant,
      grantId: grant.fullId ?? grant.id,
      id: grant.id,
      itemUuid: grant.item?.uuid ?? '',
      level: Number(grant.level) || Number(a.level) || 1,
      grantType: a.grantType || type,
      documentIds: [...(a.documentIds ?? [])]
    };
    switch (a.grantType) {
      case 'document':
        rec.grantType = type === 'feature' ? 'feature' : 'item';
        break;
      case 'bonus':
        rec.type = a.bonusType;
        rec.bonusId = a.bonusId;
        break;
      case 'proficiency': {
        const i = selected.length ? String(selected[0]).indexOf(':') : -1;
        rec.proficiencyData = {
          proficiencyType: i > 0 ? String(selected[0]).slice(0, i) : '',
          keys: selected.map((k) => { const j = String(k).indexOf(':'); return j > 0 ? String(k).slice(j + 1) : k; })
        };
        break;
      }
      case 'trait':
        rec.traitData = { traitType: a.traitType ?? '', traits: selected };
        break;
      case 'expertiseDice':
        rec.expertiseDiceData = { keys: selected };
        break;
      case 'skillSpecialty':
        rec.specialtyData = { skill: a.skill ?? '', specialties: selected };
        break;
      case 'rollOverride':
        rec.rollOverrideData = { keys: selected };
        break;
      default:
        break;
    }
    return rec;
  }

  /**
   * Take one grant's effects off the actor, as a5e does. In 1.4 its record on
   * the item is reset too - removeGrant alone leaves it marked applied, and
   * a grant marked applied is never offered again.
   */
  static async remove(actor, rec) {
    if (!actor?.grants || !rec) return;
    const grant = rec.v14;
    if (!grant) { await actor.grants.removeGrant(rec.grantId); return; }
    await actor.grants.removeGrant(grant.id);
    const item = grant.item;
    if (!item || !actor.items.get(item.id)) return;
    try {
      const initial = grant.schema?.getInitialValue?.()?.applied ?? { isApplied: false };
      await item.update({ [`system.grants.${grant.id}.applied`]: initial });
    } catch (err) {
      AM.log(2, `The record of grant ${grant.id} on ${item.name} could not be reset:`, err);
    }
  }
}
