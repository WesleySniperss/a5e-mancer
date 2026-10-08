import { AM } from '../am.js';
import { CLASS_MANEUVER_TABLES } from './maneuverService.js';
import { ProficiencyLedger } from './proficiencyLedger.js';

/**
 * Augments the a5e system's own "Apply Grants" dialog without replacing it.
 *
 * Two things that dialog does not give you:
 *   1. Trait picks (combat traditions, spell schools, …) can be taken past the
 *      number the grant actually allows — its "Free Selection Mode" header toggle
 *      unlocks the whole trait list, and for combat traditions nothing keeps a
 *      class to the traditions its class table permits.
 *   2. The options are bare labels. There is no way to read what a tradition or
 *      school actually is while choosing it.
 *
 * Everything here is additive DOM work over the rendered Svelte output, guarded so
 * that a markup change in a5e degrades to "no enhancement" rather than an error.
 *
 * Structure we rely on (a5e.js, CheckboxGroup + Tag components):
 *   section.a5e-section
 *     h3.a5e-section-header__heading   → "Trait Grant - <label>"
 *     div.a5e-check-box-group__list
 *       button.tag[value="<traitKey>"] → selection fires on `pointerdown`
 * Selection is a delegated pointerdown listener on the app root, so blocking a
 * pick means stopping the event during the capture phase.
 */
export class GrantDialogEnhancer {

  /** name → description html, shared across dialogs for the session */
  static #descCache = new Map();

  static register() {
    const handler = (app, element) => {
      try { GrantDialogEnhancer.#enhance(app, element); }
      catch (err) { AM.log(2, 'Grant dialog enhancement failed:', err); }
    };
    // Foundry fires renderApplicationV2 for every ApplicationV2 subclass — a5e
    // relies on the same hook itself. We identify the grant dialog by its payload
    // rather than its class name, which survives minification changes.
    Hooks.on('renderApplicationV2', handler);
  }

  /* ── entry point ──────────────────────────────────────── */

  static #enhance(app, element) {
    if (!game.settings.get(AM.ID, 'enhanceGrantDialog')) return;

    const root = element instanceof HTMLElement ? element : element?.[0];
    if (!root) return;

    const actor  = app?.data?.actor;
    const grants = Array.isArray(app?.data?.allGrants) ? app.data.allGrants : [];
    if (!grants.length) return;

    const lists = root.querySelectorAll('.a5e-check-box-group__list');
    if (!lists.length) return;

    for (const list of lists) {
      if (list.dataset.amEnhanced === '1') continue;   // Svelte re-render, already done
      const tags = [...list.querySelectorAll('button.tag[value]')];
      if (!tags.length) continue;
      list.dataset.amEnhanced = '1';

      const grant = this.#matchGrant(grants, tags);
      this.#markHeld(list, tags, grant, grants, actor);
      if (!grant) continue;

      const traitType = grant.config?.traits?.traitType || grant.traits?.traitType || '';
      const isTradition = traitType === 'maneuverTraditions';
      const isSchool    = traitType === 'spellSchools' || this.#looksLikeSchools(tags);
      if (!isTradition && !isSchool) continue;

      this.#applyLimits(list, tags, grant, actor, app, isTradition);
      this.#addDescriptions(list, tags);
    }
  }

  /* ── what the character already has ───────────────────── */

  /**
   * Options the character would gain nothing by taking: a skill they are
   * already proficient in, a language they already speak - or one another
   * grant in this same window hands out outright (a5e's culture lists offer
   * Common to a character the same culture already gives Common). Reported
   * 2026-10-06: "the windows do not take out the skills I already have, so
   * the same one can be picked - a wasted skill". They are greyed, say why,
   * and refuse the click; one already picked can still be unpicked.
   *
   * a5e 1.4 writes a proficiency option as "kind:key" (skill:ath); 1.3 and
   * every trait list as the bare key.
   */
  static #markHeld(list, tags, grant, grants, actor) {
    const prefixed = tags.every(t => /^[a-zA-Z]+:/.test(t.value));
    let kind = '';
    let keyOf = (v) => v;
    if (prefixed) {
      const prefix = tags[0].value.split(':')[0];
      if (!tags.every(t => t.value.startsWith(prefix + ':'))) return;
      kind = `proficiency:${prefix}`;
      keyOf = (v) => v.slice(prefix.length + 1);
    } else if (grant) {
      const type = grant.type || grant.grantType;
      if (type === 'trait') kind = `trait:${grant.config?.traits?.traitType || grant.traits?.traitType || ''}`;
      else if (type === 'proficiency') kind = `proficiency:${grant.proficiencyType ?? ''}`;
    }
    if (!kind || kind.endsWith(':')) return;

    const held = new Set(actor ? ProficiencyLedger.onActor(actor, kind) : []);
    for (const k of this.#basesOf(grants, kind)) held.add(k);
    if (!held.size) return;

    const marked = tags.filter(t => held.has(keyOf(t.value)));
    if (!marked.length) return;
    const tip = game.i18n.localize('am.grants.already-held');
    for (const tag of marked) {
      tag.classList.add('am-grant-held');
      tag.dataset.tooltip = tip;
    }
    // Capture phase, as #applyLimits: a5e's handler never sees a refused pick
    list.addEventListener('pointerdown', (event) => {
      const tag = event.target.closest?.('button.tag[value]');
      if (!tag || !list.contains(tag) || !tag.classList.contains('am-grant-held')) return;
      if (this.#isActive(tag)) return;                   // unpicking is always fine
      event.preventDefault();
      event.stopPropagation();
      ui.notifications.warn(tip);
    }, true);
  }

  /** The keys every grant in the window hands out outright, of one kind. */
  static #basesOf(grants, kind) {
    const out = new Set();
    const [group, sub] = kind.split(':');
    for (const g of grants ?? []) {
      const type = g?.type || g?.grantType;
      if (group === 'proficiency' && type === 'proficiency') {
        for (const k of [...(g.config?.keys?.base ?? [])]) {
          const [p, key] = String(k).includes(':') ? String(k).split(':') : [g.proficiencyType, String(k)];
          if (p === sub) out.add(key);
        }
        if (!g.config?.keys?.base?.size && !g.config?.keys?.base?.length && g.proficiencyType === sub) {
          for (const k of g.keys?.base ?? []) out.add(k);
        }
      } else if (group === 'trait' && type === 'trait') {
        const traits = g.config?.traits ?? g.traits ?? {};
        if ((traits.traitType ?? '') === sub) for (const k of traits.base ?? []) out.add(k);
      }
    }
    return out;
  }

  /* ── limits ───────────────────────────────────────────── */

  /**
   * Re-imposes the grant's own allowance (base + total) plus, for combat
   * traditions, the class table's allowed-tradition list.
   */
  static #applyLimits(list, tags, grant, actor, app, isTradition) {
    const traits = grant.config?.traits ?? grant.traits ?? {};
    const base  = traits.base ?? [];
    const total = Number(traits.total ?? 0);
    // 0 total with no base means the grant states no allowance — don't invent one.
    const cap = (total > 0 || base.length) ? base.length + total : Infinity;

    const allowed = isTradition ? this.#allowedTraditions(app) : null;

    // Grey out options the class may never take
    if (allowed) {
      for (const tag of tags) {
        if (allowed.has(tag.value)) continue;
        tag.classList.add('am-grant-disallowed');
        tag.dataset.tooltip = game.i18n.localize('am.grants.tradition-not-allowed');
      }
    }

    if (cap === Infinity && !allowed) return;

    const label = list.closest('.a5e-section')
      ?.querySelector('.a5e-section-header__heading')?.textContent?.trim() ?? '';

    // Capture phase: Svelte's delegated pointerdown never sees a blocked pick.
    const guard = (event) => {
      const tag = event.target.closest?.('button.tag[value]');
      if (!tag || !list.contains(tag)) return;

      // Deselecting is always fine
      if (this.#isActive(tag)) return;

      if (allowed && !allowed.has(tag.value)) {
        event.preventDefault();
        event.stopPropagation();
        ui.notifications.warn(game.i18n.localize('am.grants.tradition-not-allowed'));
        return;
      }

      const selected = tags.filter(t => this.#isActive(t)).length;
      if (selected >= cap) {
        event.preventDefault();
        event.stopPropagation();
        ui.notifications.warn(game.i18n.format('am.grants.limit-reached', { n: cap, label }));
      }
    };

    list.addEventListener('pointerdown', guard, true);

    // Show the allowance next to the group so the limit is visible, not just felt
    if (cap !== Infinity && !list.querySelector('.am-grant-cap')) {
      const note = document.createElement('small');
      note.className = 'am-grant-cap';
      note.textContent = game.i18n.format('am.grants.cap-note', { n: cap });
      list.parentElement?.insertBefore(note, list);
    }
  }

  /**
   * A tag renders green when picked; the inline style carries the primary colour
   * variable. Falls back to aria/disabled state if a5e restyles.
   */
  static #isActive(tag) {
    return (tag.getAttribute('style') ?? '').includes('--a5e-color-primary');
  }

  /** Traditions the levelling class may choose from, or null when unrestricted. */
  static #allowedTraditions(app) {
    const className = app?.data?.cls?.name ?? app?.data?.item?.name ?? '';
    const table = CLASS_MANEUVER_TABLES[className.toLowerCase()];
    if (!table) return null;                       // unknown class — don't restrict
    if (table.allowedTraditions === null) return null; // "any tradition of your choice"
    return new Set(table.allowedTraditions);
  }

  /* ── descriptions ─────────────────────────────────────── */

  static #addDescriptions(list, tags) {
    const section = list.closest('.a5e-section') ?? list.parentElement;
    if (!section || section.querySelector('.am-grant-desc')) return;

    const panel = document.createElement('div');
    panel.className = 'am-grant-desc';
    panel.innerHTML = `<p class="am-hint">${game.i18n.localize('am.grants.hover-hint')}</p>`;
    section.appendChild(panel);

    for (const tag of tags) {
      tag.addEventListener('mouseenter', async () => {
        const name = tag.textContent?.trim();
        if (!name) return;
        const html = await this.#lookupDescription(name);
        if (!panel.isConnected) return;
        panel.innerHTML = html
          ? `<strong>${name}</strong><div class="am-grant-desc-body">${html}</div>`
          : `<strong>${name}</strong><p class="am-hint">${game.i18n.localize('am.app.no-description')}</p>`;
      });
    }

    list.addEventListener('mouseleave', () => {
      if (panel.isConnected) {
        panel.innerHTML = `<p class="am-hint">${game.i18n.localize('am.grants.hover-hint')}</p>`;
      }
    });
  }

  /**
   * Traditions and schools are documented as journal entries or items named after
   * themselves. Same lookup the maneuver and spell pickers use.
   */
  static async #lookupDescription(name) {
    if (this.#descCache.has(name)) return this.#descCache.get(name);
    const q = name.toLowerCase().trim();
    for (const pack of game.packs) {
      if (!['JournalEntry', 'Item'].includes(pack.metadata.type)) continue;
      try {
        const index = await pack.getIndex();
        const hit = index.find(e => e.name.toLowerCase().trim() === q);
        if (!hit) continue;
        const doc = await pack.getDocument(hit._id);
        const desc = pack.metadata.type === 'JournalEntry'
          ? (doc.pages?.find(p => p.type === 'text')?.text?.content ?? '')
          : (doc.system?.description?.value ?? doc.system?.description ?? '');
        if (desc) { this.#descCache.set(name, desc); return desc; }
      } catch { /* pack unreadable — try the next */ }
    }
    this.#descCache.set(name, '');
    return '';
  }

  /* ── helpers ──────────────────────────────────────────── */

  /** Find the grant whose trait options are the ones rendered in this list. */
  static #matchGrant(grants, tags) {
    const values = new Set(tags.map(t => t.value).filter(Boolean));
    if (!values.size) return null;

    let best = null, bestScore = 0;
    for (const grant of grants) {
      if ((grant?.type || grant?.grantType) !== 'trait') continue;
      const traits = grant.config?.traits ?? grant.traits ?? {};
      const opts = [...(traits.options ?? []), ...(traits.base ?? [])];
      if (!opts.length) continue;
      const score = opts.filter(o => values.has(o)).length;
      if (score > bestScore) { best = grant; bestScore = score; }
    }
    return bestScore > 0 ? best : null;
  }

  /** Free Selection Mode lists every trait, so fall back to sniffing the keys. */
  static #looksLikeSchools(tags) {
    const schools = CONFIG?.A5E?.spellSchools?.primary ?? {};
    const keys = Object.keys(schools);
    if (!keys.length) return false;
    return tags.some(t => keys.includes(t.value));
  }
}
