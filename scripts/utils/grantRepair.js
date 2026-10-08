import { AM } from '../am.js';
import { GrantAbsorber } from './grantAbsorber.js';

/**
 * Grants a character should have and does not, and bonuses it has twice.
 *
 * Characters made or levelled with the module on a5e 1.4 before 2.89.0 came
 * out with grants that were never applied - the builder's writes went to
 * fields a5e 1.4 no longer reads - so they lack the languages, skills,
 * darkvision, speed and ability points their origins and classes give. And a
 * level-up applied every earlier grant of the class again, adding its bonus
 * once more each time: ability scores that grew by themselves. The sheet's
 * Fill In button runs this (asked 2026-10-08: "add all of it to our fill
 * button").
 *
 * What it does:
 *   - a grant up to the character's level that a5e does not record as applied
 *     is applied: at once where there is nothing to choose, after a choice in
 *     the window where there is. A feature grant whose features the character
 *     already has counts those as its picks, and is only recorded.
 *   - a bonus that is an exact copy of another (same name, formula and
 *     context, the name a grant's or an item's) is removed, the one a grant
 *     record points at kept.
 * What it leaves: optional grants, the Equipment and Maneuvers tabs' own (gear,
 * a class's traditions), and a class's ability points nobody picks - a feat
 * may have been taken instead.
 */
export class GrantRepair {

  /** a5e's own: the item types whose grants it applies (ActorGrantsManager). */
  static OWNER_TYPES = new Set(['feature', 'archetype', 'background', 'class', 'culture', 'heritage']);

  static #slug(cls) {
    return cls?.slug || cls?.system?.slug || String(cls?.name ?? '').slugify?.({ strict: true }) || '';
  }

  static #charLevel(actor) {
    return actor.items.filter(i => i.type === 'class')
      .reduce((n, c) => n + (Number(c.system?.classLevels) || 0), 0) || 1;
  }

  /** The class an item belongs to, for grants counted in class levels. */
  static #classOf(actor, item) {
    const classes = actor.items.filter(i => i.type === 'class');
    if (item.type === 'class') return item;
    if (item.type === 'archetype') return classes.find(c => this.#slug(c) === item.system?.class) ?? null;
    const slug = item.system?.classes;
    return typeof slug === 'string' && slug ? (classes.find(c => this.#slug(c) === slug) ?? null) : null;
  }

  /** Is this feature (compendium uuid) on the character? Kept ids first, then the recorded source. */
  static #has(actor, uuid) {
    const id = String(uuid).split('.').pop();
    return !!(actor.items.get(id) ?? actor.items.find(i => i._stats?.compendiumSource === uuid));
  }

  /**
   * What is missing, nothing changed.
   * @returns {Promise<{auto: object[], ask: object[], dupes: object[]}>}
   *   auto/ask: { item, id, grant, lv, model?, picked? }; dupes: { type, id, label }
   */
  static async plan(actor) {
    const out = { auto: [], ask: [], dupes: [] };
    if (!actor || actor.type !== 'character') return out;
    const charLevel = this.#charLevel(actor);

    for (const item of actor.items) {
      if (!this.OWNER_TYPES.has(item.type)) continue;
      const entries = item.grants?.entries ? [...item.grants.entries()] : [];
      if (!entries.length) continue;
      const cls = this.#classOf(actor, item);
      const lv = { charLevel, clsLevel: cls ? (Number(cls.system?.classLevels) || 1) : charLevel };
      const missing = [];
      for (const [id, grant] of entries) {
        if (!grant?.applied || typeof grant.applied !== 'object') continue;   // a5e 1.3
        if (GrantAbsorber.isAppliedGrant(grant) || grant.optional) continue;
        if (!GrantAbsorber.appliesAt(grant, lv)) continue;
        if (GrantAbsorber.ownedElsewhere(grant, item.type)) continue;
        missing.push([id, grant]);
      }
      if (!missing.length) continue;

      let models = null;   // read once per item, only when something asks
      const modelsOf = async () => {
        if (models) return models;
        const features = await GrantAbsorber.describeFeatures(item, lv);
        models = new Map([...GrantAbsorber.describe(item, lv), ...features].map(m => [m.id, m]));
        return models;
      };

      for (const [id, grant] of missing) {
        const type = GrantAbsorber.typeOf(grant);
        /* Gear is left out: what an item grant hands over may be on the
           character already, bought or moved, and a second copy is worse than
           none. */
        if (type === 'item') continue;
        const row = { item, id, grant, lv, name: GrantAbsorber.nameOf(grant) || type };
        if (type === 'feature') {
          const spec = GrantAbsorber.specOf(grant) ?? { options: [], total: 0 };
          const picked = spec.options.filter(u => this.#has(actor, u));
          if (!spec.options.length || picked.length >= Math.min(spec.total || 1, spec.options.length)) {
            out.auto.push({ ...row, picked });
            continue;
          }
          const model = (await modelsOf()).get(id);
          if (model) out.ask.push({ ...row, model, picked });
          continue;
        }
        if (!GrantAbsorber.needsChoice(grant)) { out.auto.push(row); continue; }
        const model = (await modelsOf()).get(id);
        if (model) out.ask.push({ ...row, model, picked: [] });
      }
    }

    out.dupes = this.#duplicates(actor);
    return out;
  }

  /** Bonuses that are exact copies, beyond the one kept. */
  static #duplicates(actor) {
    const names = new Set();
    for (const item of actor.items) {
      names.add(item.name);
      for (const g of item.grants?.values?.() ?? []) { const n = GrantAbsorber.nameOf(g); if (n) names.add(n); }
    }
    const referenced = new Set([...(actor.grants?.values?.() ?? [])].map(g => g?.applied?.bonusId).filter(Boolean));
    const out = [];
    for (const [type, bucket] of Object.entries(actor.system?.bonuses ?? {})) {
      if (!bucket || typeof bucket !== 'object') continue;
      const groups = new Map();
      for (const [id, bonus] of Object.entries(bucket)) {
        if (!bonus || typeof bonus !== 'object' || !names.has(bonus.label)) continue;
        const key = `${bonus.label}|${bonus.formula}|${JSON.stringify(bonus.context ?? {})}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(id);
      }
      for (const ids of groups.values()) {
        if (ids.length < 2) continue;
        const keep = ids.filter(id => referenced.has(id));
        const kept = keep.length ? new Set(keep) : new Set([ids[0]]);
        for (const id of ids) if (!kept.has(id)) out.push({ type, id, label: bucket[id].label });
      }
    }
    return out;
  }

  /**
   * Ask, then apply. Returns how many things were changed - 0 when nothing was
   * missing, null when the player closed the window without applying.
   */
  static async run(actor) {
    const plan = await this.plan(actor);
    if (!plan.auto.length && !plan.ask.length && !plan.dupes.length) return 0;

    const esc = (s) => foundry.utils.escapeHTML(String(s ?? ''));
    const autoList = plan.auto.map(r => `<li>${esc(r.item.name)}: ${esc(r.name)}</li>`).join('');
    const dupeCount = plan.dupes.reduce((m, d) => (m[d.label] = (m[d.label] ?? 0) + 1, m), {});
    const dupeList = Object.entries(dupeCount).map(([l, n]) => `<li>${esc(l)} ×${n}</li>`).join('');
    const askHtml = plan.ask.map((r, i) => {
      const m = r.model;
      const total = Math.max(1, Number(m.total) || 1);
      const pills = (m.options ?? []).map(o => {
        const on = r.picked?.includes(o.key);
        return `<button type="button" class="am-filter-pill${on ? ' am-pill-active' : ''}" data-key="${esc(o.key)}">${esc(o.label)}</button>`;
      }).join('');
      return `<div class="am-repair-ask" data-row="${i}" data-total="${total}">
        <div class="am-repair-ask-head"><strong>${esc(r.item.name)}</strong> · ${esc(m.label)} <span class="am-hint">(${total})</span></div>
        <div class="am-filter-pills">${pills}</div></div>`;
    }).join('');

    const content = `<div class="am-repair">
      <p>${esc(actor.name)} is missing what these grant - most likely made or levelled before the module read a5e 1.4's grants.</p>
      ${autoList ? `<h4>Applied as they are</h4><ul>${autoList}</ul>` : ''}
      ${askHtml ? `<h4>To choose</h4><p class="am-hint">Leave a row empty to skip it - a class's ability points, if a feat was taken instead.</p>${askHtml}` : ''}
      ${dupeList ? `<h4>Bonuses counted more than once, the copies removed</h4><ul>${dupeList}</ul>` : ''}
    </div>`;

    const picks = await foundry.applications.api.DialogV2.wait({
      window: { title: `${AM.NAME}: grants never applied` },
      position: { width: 560 },
      content,
      buttons: [
        { action: 'apply', label: 'Apply', icon: 'fa-solid fa-check', default: true,
          callback: (_event, _button, dialog) => {
            const root = dialog.element ?? dialog;
            return [...root.querySelectorAll('.am-repair-ask')].map(div => ({
              row: Number(div.dataset.row),
              keys: [...div.querySelectorAll('.am-pill-active')].map(b => b.dataset.key)
            }));
          } },
        { action: 'cancel', label: 'Cancel', icon: 'fa-solid fa-xmark' }
      ],
      render: (_event, dialog) => {
        const root = dialog.element ?? dialog;
        root.querySelectorAll('.am-repair-ask').forEach(div => {
          const total = Number(div.dataset.total) || 1;
          div.addEventListener('click', (e) => {
            const pill = e.target.closest('.am-filter-pill');
            if (!pill) return;
            if (!pill.classList.contains('am-pill-active')
                && div.querySelectorAll('.am-pill-active').length >= total) {
              div.querySelector('.am-pill-active')?.classList.remove('am-pill-active');
            }
            pill.classList.toggle('am-pill-active');
          });
        });
      }
    }).catch(() => null);
    if (!Array.isArray(picks)) return null;

    // One apply per item, its grants named; choices filed under their grant ids
    const byItem = new Map();
    const add = (r, keys) => {
      if (!byItem.has(r.item.id)) byItem.set(r.item.id, { item: r.item, lv: r.lv, ids: new Set(), choices: {} });
      const e = byItem.get(r.item.id);
      e.ids.add(r.id);
      if (keys?.length) e.choices[r.id] = keys;
    };
    for (const r of plan.auto) add(r, r.picked);
    for (const { row, keys } of picks) {
      const r = plan.ask[row];
      if (r && keys.length) add(r, keys);
    }
    if (!byItem.size && !plan.dupes.length) return null;     // every row left empty: skipped

    let changed = 0;
    for (const { item, lv, ids, choices } of byItem.values()) {
      const fresh = actor.items.get(item.id);
      if (!fresh) continue;
      try {
        await GrantAbsorber.apply(actor, fresh, choices, lv, 0, { only: ids, walkOwned: false });
        changed += ids.size;
      } catch (err) {
        AM.log(1, `Grants of ${item.name} could not be applied:`, err);
      }
    }

    if (plan.dupes.length) {
      const Del = foundry.data?.operators?.ForcedDeletion;
      const update = {};
      for (const d of plan.dupes) {
        if (Del) update[`system.bonuses.${d.type}.${d.id}`] = new Del();
        else update[`system.bonuses.${d.type}.-=${d.id}`] = null;
      }
      try { await actor.update(update); changed += plan.dupes.length; }
      catch (err) { AM.log(1, 'Duplicate bonuses could not be removed:', err); }
    }

    if (changed) ui.notifications.info(`${AM.NAME}: ${actor.name} - ${changed} grant(s) and bonus(es) put right.`);
    return changed;
  }
}
