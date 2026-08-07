import { AM } from '../a5e-mancer.js';
import { CLASS_MANEUVER_TABLES } from './maneuverService.js';

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
      if (!grant) continue;

      const traitType = grant.traits?.traitType ?? '';
      const isTradition = traitType === 'maneuverTraditions';
      const isSchool    = traitType === 'spellSchools' || this.#looksLikeSchools(tags);
      if (!isTradition && !isSchool) continue;

      this.#applyLimits(list, tags, grant, actor, app, isTradition);
      this.#addDescriptions(list, tags);
    }
  }

  /* ── limits ───────────────────────────────────────────── */

  /**
   * Re-imposes the grant's own allowance (base + total) plus, for combat
   * traditions, the class table's allowed-tradition list.
   */
  static #applyLimits(list, tags, grant, actor, app, isTradition) {
    const base  = grant.traits?.base ?? [];
    const total = Number(grant.traits?.total ?? 0);
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
      if (grant?.grantType !== 'trait') continue;
      const opts = [...(grant.traits?.options ?? []), ...(grant.traits?.base ?? [])];
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
