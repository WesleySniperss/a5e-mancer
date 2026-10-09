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
 *   - an origin's features held more than once are removed down to one, and
 *     where it holds more picks than it gives - two gifts - the player says
 *     which go (#overChosen).
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

  /** A compendium entry's name from the loaded index, without reading the document. */
  static #indexName(uuid) {
    try { return fromUuidSync(uuid)?.name ?? ''; } catch { return ''; }
  }

  static #sourceOf(item) {
    return item?._stats?.compendiumSource ?? item?.flags?.core?.sourceId ?? '';
  }

  /**
   * The character's items made from a compendium entry: by its id (the builder
   * keeps it), by the recorded source, or by name where the item records no
   * other source - a5e's own windows make features under new ids.
   */
  static #copiesOf(actor, uuid) {
    const id = String(uuid).split('.').pop();
    const name = this.#indexName(uuid);
    return actor.items.filter(i => i.id === id || this.#sourceOf(i) === uuid
      || (name && i.type === 'feature' && i.name === name && (!this.#sourceOf(i) || this.#sourceOf(i) === uuid)));
  }

  /** Is this feature (compendium uuid) on the character? */
  static #has(actor, uuid) {
    return this.#copiesOf(actor, uuid).length > 0;
  }

  /** The origins: what a character is made from once, so a pick there has no other source. */
  static ORIGIN_TYPES = new Set(['heritage', 'culture', 'background', 'destiny']);

  /** The features an item's own feature grants hand out, base and picks. */
  static #grantedUuids(item) {
    const out = [];
    for (const grant of item?.grants?.values?.() ?? []) {
      if (GrantAbsorber.typeOf(grant) !== 'feature') continue;
      const spec = GrantAbsorber.specOf(grant);
      out.push(...(spec?.base ?? []), ...(spec?.options ?? []));
    }
    return out;
  }

  /**
   * What an origin has handed out more of than it gives. Reported 2026-10-09:
   * an elf with two gifts, Prescient Vision and Preternatural Awareness, where
   * the heritage gives one - characters made while a5e's window and the
   * builder's own gift tab both asked came out with one from each.
   *   copies - the same feature more than once (a gift, or the trait a gift
   *            gives): the extra ones go without asking.
   *   over   - different picks beyond the grant's count: the player unticks
   *            what goes, nothing is ticked off to start with.
   */
  static #overChosen(actor) {
    const over = [], copies = new Map();
    const docIds = new Set();
    for (const item of actor.items) {
      for (const grant of item.grants?.values?.() ?? []) for (const id of grant?.applied?.documentIds ?? []) docIds.add(id);
    }
    const keepFirst = (items) => [...items].sort((a, b) =>
      (docIds.has(b.id) - docIds.has(a.id)) || ((a._stats?.createdTime ?? 0) - (b._stats?.createdTime ?? 0)));
    const noteCopies = (uuid) => {
      const found = this.#copiesOf(actor, uuid);
      if (found.length > 1) for (const extra of keepFirst(found).slice(1)) copies.set(extra.id, extra);
    };

    for (const item of actor.items) {
      if (!this.ORIGIN_TYPES.has(item.type)) continue;
      for (const [id, grant] of item.grants?.entries?.() ?? []) {
        if (GrantAbsorber.typeOf(grant) !== 'feature') continue;
        const spec = GrantAbsorber.specOf(grant);
        if (!spec) continue;
        for (const uuid of [...spec.base, ...spec.options]) {
          noteCopies(uuid);
          // one level down: the trait a gift gives
          for (const held of this.#copiesOf(actor, uuid)) for (const inner of this.#grantedUuids(held)) noteCopies(inner);
        }
        const total = Number(spec.total) || 0;
        const held = spec.options
          .map(uuid => ({ key: uuid, label: this.#indexName(uuid) || uuid, items: this.#copiesOf(actor, uuid) }))
          .filter(h => h.items.length);
        if (total > 0 && held.length > total) {
          over.push({ item, id, grant, name: GrantAbsorber.nameOf(grant) || 'Choice', total, held });
        }
      }
    }
    return { over, copies: [...copies.values()] };
  }

  /**
   * A spell held twice in one spell book: Prestidigitation and Darkness on one
   * character (reported 2026-10-09), made by two passes that each found it
   * missing. The same spell in two books is left - two classes may each know
   * it - and so is one with uses of its own beside the ordinary one: a
   * feature's once-a-day Darkness next to the warlock's. Kept: the prepared
   * one, else the one a feature gave, else the oldest.
   */
  static #spellCopies(actor) {
    const groups = new Map();
    for (const spell of actor.items) {
      if (spell.type !== 'spell') continue;
      const key = `${spell.name.toLowerCase()}|${spell.system?.spellBook ?? ''}|${spell.system?.uses?.max ?? ''}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(spell);
    }
    const rank = (s) => [Number(s.system?.prepared) > 0 ? 0 : 1, s.flags?.[AM.ID]?.grantedBy ? 0 : 1, s._stats?.createdTime ?? 0];
    const out = [];
    for (const spells of groups.values()) {
      if (spells.length < 2) continue;
      const sorted = [...spells].sort((a, b) => {
        const ra = rank(a), rb = rank(b);
        return (ra[0] - rb[0]) || (ra[1] - rb[1]) || (ra[2] - rb[2]);
      });
      out.push(...sorted.slice(1));
    }
    return out;
  }

  /**
   * What is missing, nothing changed.
   * @returns {Promise<{auto: object[], ask: object[], dupes: object[], over: object[], copies: Item[]}>}
   *   auto/ask: { item, id, grant, lv, model?, picked? }; dupes: { type, id, label };
   *   over: { item, id, grant, lv, name, total, held: [{ key, label, items }] }
   */
  static async plan(actor) {
    const out = { auto: [], ask: [], dupes: [], over: [], copies: [] };
    if (!actor || actor.type !== 'character') return out;
    const charLevel = this.#charLevel(actor);
    const lvOf = (item) => {
      const cls = this.#classOf(actor, item);
      return { charLevel, clsLevel: cls ? (Number(cls.system?.classLevels) || 1) : charLevel };
    };

    // More held than given: settled by the player first, then recorded with what is kept
    const { over, copies } = this.#overChosen(actor);
    out.over = over.map(o => ({ ...o, lv: lvOf(o.item) }));
    out.copies = [...copies, ...this.#spellCopies(actor)];
    const settled = new Set(over.map(o => `${o.item.id}.${o.id}`));
    // Items that may be about to go are not asked about: a copy, a pick the
    // player may untick, and what such a pick gave
    const pending = new Set(copies.map(i => i.id));
    for (const held of over.flatMap(o => o.held.flatMap(h => h.items))) {
      pending.add(held.id);
      for (const u of this.#grantedUuids(held)) for (const c of this.#copiesOf(actor, u)) pending.add(c.id);
    }

    for (const item of actor.items) {
      if (!this.OWNER_TYPES.has(item.type) || pending.has(item.id)) continue;
      const entries = item.grants?.entries ? [...item.grants.entries()] : [];
      if (!entries.length) continue;
      const lv = lvOf(item);
      const missing = [];
      for (const [id, grant] of entries) {
        if (!grant?.applied || typeof grant.applied !== 'object') continue;   // a5e 1.3
        if (GrantAbsorber.isAppliedGrant(grant) || grant.optional) continue;
        if (settled.has(`${item.id}.${id}`)) continue;
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
    if (!plan.auto.length && !plan.ask.length && !plan.dupes.length && !plan.over.length && !plan.copies.length) return 0;

    const esc = (s) => foundry.utils.escapeHTML(String(s ?? ''));
    const copyCount = plan.copies.reduce((m, i) => (m[i.name] = (m[i.name] ?? 0) + 1, m), {});
    const copyList = Object.entries(copyCount).map(([l, n]) => `<li>${esc(l)} ×${n}</li>`).join('');
    const overHtml = plan.over.map((o, i) => {
      const pills = o.held.map(h =>
        `<button type="button" class="am-filter-pill am-pill-active" data-key="${esc(h.key)}">${esc(h.label)}</button>`).join('');
      return `<div class="am-repair-keep" data-row="${i}">
        <div class="am-repair-ask-head"><strong>${esc(o.item.name)}</strong> · ${esc(o.name)} <span class="am-hint">(gives ${o.total}, has ${o.held.length})</span></div>
        <div class="am-filter-pills">${pills}</div></div>`;
    }).join('');
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
      ${autoList || askHtml ? `<p>${esc(actor.name)} is missing what these grant - most likely made or levelled before the module read a5e 1.4's grants.</p>` : ''}
      ${autoList ? `<h4>Applied as they are</h4><ul>${autoList}</ul>` : ''}
      ${askHtml ? `<h4>To choose</h4><p class="am-hint">Leave a row empty to skip it - a class's ability points, if a feat was taken instead.</p>${askHtml}` : ''}
      ${overHtml ? `<h4>More than the origin gives</h4><p class="am-hint">Untick what to remove - the features it gave go with it. Left all ticked, nothing is removed.</p>${overHtml}` : ''}
      ${copyList ? `<h4>The same feature or spell more than once, the copies removed</h4><ul>${copyList}</ul>` : ''}
      ${dupeList ? `<h4>Bonuses counted more than once, the copies removed</h4><ul>${dupeList}</ul>` : ''}
    </div>`;

    const rows = (root, selector) => [...root.querySelectorAll(selector)].map(div => ({
      row: Number(div.dataset.row),
      keys: [...div.querySelectorAll('.am-pill-active')].map(b => b.dataset.key)
    }));
    const picks = await foundry.applications.api.DialogV2.wait({
      window: { title: `${AM.NAME}: putting ${actor.name} right` },
      position: { width: 560 },
      content,
      buttons: [
        { action: 'apply', label: 'Apply', icon: 'fa-solid fa-check', default: true,
          callback: (_event, _button, dialog) => {
            const root = dialog.element ?? dialog;
            return { asks: rows(root, '.am-repair-ask'), keeps: rows(root, '.am-repair-keep') };
          } },
        { action: 'cancel', label: 'Cancel', icon: 'fa-solid fa-xmark' }
      ],
      render: (_event, dialog) => {
        const root = dialog.element ?? dialog;
        root.querySelectorAll('.am-repair-keep').forEach(div => div.addEventListener('click', (e) => {
          e.target.closest('.am-filter-pill')?.classList.toggle('am-pill-active');
        }));
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
    if (!Array.isArray(picks?.asks)) return null;

    // One apply per item, its grants named; choices filed under their grant ids
    const byItem = new Map();
    const add = (r, keys) => {
      if (!byItem.has(r.item.id)) byItem.set(r.item.id, { item: r.item, lv: r.lv, ids: new Set(), choices: {} });
      const e = byItem.get(r.item.id);
      e.ids.add(r.id);
      if (keys?.length) e.choices[r.id] = keys;
    };
    for (const r of plan.auto) add(r, r.picked);
    for (const { row, keys } of picks.asks) {
      const r = plan.ask[row];
      if (r && keys.length) add(r, keys);
    }

    // What goes: the copies, and the picks unticked with what they gave -
    // less anything a kept pick gave as well
    const remove = new Map(plan.copies.map(i => [i.id, i]));
    for (const { row, keys } of picks.keeps) {
      const o = plan.over[row];
      if (!o || !keys.length || keys.length === o.held.length) continue;
      const kept = o.held.filter(h => keys.includes(h.key));
      const keptIds = new Set(kept.flatMap(h => h.items.flatMap(i =>
        [i.id, ...this.#grantedUuids(i).flatMap(u => this.#copiesOf(actor, u).map(c => c.id))])));
      for (const h of o.held.filter(h => !keys.includes(h.key))) {
        for (const i of h.items) {
          if (!keptIds.has(i.id)) remove.set(i.id, i);
          for (const u of this.#grantedUuids(i)) for (const c of this.#copiesOf(actor, u)) if (!keptIds.has(c.id)) remove.set(c.id, c);
        }
      }
      // and the grant recorded with what is kept, where a5e has no record of it
      if (!GrantAbsorber.isAppliedGrant(o.grant) && GrantAbsorber.appliesAt(o.grant, o.lv)) add(o, kept.map(h => h.key));
    }
    if (!byItem.size && !plan.dupes.length && !remove.size) return null;     // every row left as it was: skipped

    let changed = 0;
    if (remove.size) {
      /* What another removed item gave goes first. a5e takes away the documents
         a grant made when its item is deleted, without waiting; deleted in the
         same breath, both went for the same items and one of them failed. */
      const children = new Set();
      for (const item of remove.values()) {
        for (const g of item.grants?.values?.() ?? []) for (const id of g?.applied?.documentIds ?? []) if (id !== item.id && remove.has(id)) children.add(id);
        for (const u of this.#grantedUuids(item)) for (const c of this.#copiesOf(actor, u)) if (c.id !== item.id && remove.has(c.id)) children.add(c.id);
      }
      for (const wave of [[...children], [...remove.keys()].filter(id => !children.has(id))]) {
        const ids = wave.filter(id => actor.items.get(id));
        if (!ids.length) continue;
        try {
          await actor.deleteEmbeddedDocuments('Item', ids);
          changed += ids.length;
        } catch (err) {
          AM.log(1, 'Extra features could not be removed:', err);
        }
      }
    }
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

    if (changed) ui.notifications.info(`${AM.NAME}: ${actor.name} - ${changed} grant(s), feature(s) and bonus(es) put right.`);
    return changed;
  }
}
