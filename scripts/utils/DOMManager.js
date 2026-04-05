import { AM } from '../a5e-mancer.js';
import { DocumentService } from './documentService.js';
import { EquipmentService } from './equipmentService.js';
import { SpellService } from './spellService.js';

const ITEM_TYPES = ['heritage', 'culture', 'background', 'destiny', 'class'];

export class DOMManager {
  static #listeners = [];

  static async initialize(form) {
    this.cleanup();

    // ── Item dropdowns ───────────────────────────────────
    for (const type of ITEM_TYPES) {
      const dropdown = form.querySelector(`#${type}-dropdown`);
      if (!dropdown) continue;
      const handler = (e) => this.#onDropdownChange(type, e.target, form);
      dropdown.addEventListener('change', handler);
      this.#listeners.push({ el: dropdown, type: 'change', fn: handler });
      if (dropdown.value) {
        const raw  = dropdown.value;
        const uuid = this.#extractUuid(raw);
        // Ensure AM.SELECTED is populated from existing dropdown value
        if (!AM.SELECTED[type]?.uuid && uuid) {
          AM.SELECTED[type] = { value: raw, id: raw.split(' ')[0], uuid };
        }
        if (uuid) this.#loadDescription(type, uuid, form);
      }
    }

    // ── Heritage Gift radio buttons (dynamic) ────────────
    form.querySelectorAll('.am-gift-option').forEach(radio => {
      const fn = (e) => this.#onGiftSelected(e.target, form);
      radio.addEventListener('change', fn);
      this.#listeners.push({ el: radio, type: 'change', fn });
    });

    // ── Equipment choices ────────────────────────────────
    form.querySelectorAll('.am-equipment-option-btn').forEach(btn => {
      const fn = () => this.#onEquipmentChoice(btn, form);
      btn.addEventListener('click', fn);
      this.#listeners.push({ el: btn, type: 'click', fn });
    });

    // ── Roll method selector ─────────────────────────────
    const rollMethodSel = form.querySelector('#roll-method');
    if (rollMethodSel) {
      const fn = async (e) => {
        await game.settings.set(AM.ID, 'diceRollingMethod', e.target.value);
        AM.app?.render(false, { parts: ['abilities'] });
      };
      rollMethodSel.addEventListener('change', fn);
      this.#listeners.push({ el: rollMethodSel, type: 'change', fn });
    }

    // ── Character name ───────────────────────────────────
    const nameInput = form.querySelector('#character-name');
    if (nameInput) {
      const fn = () => this.#updateNameDisplay(form);
      nameInput.addEventListener('input', fn);
      this.#listeners.push({ el: nameInput, type: 'input', fn });
    }

    // ── Token art link ───────────────────────────────────
    const linkChk = form.querySelector('#link-token-art');
    if (linkChk) {
      const fn = () => this.#syncTokenArtRow(form);
      linkChk.addEventListener('change', fn);
      this.#listeners.push({ el: linkChk, type: 'change', fn });
    }

    // ── Starting wealth manual input ─────────────────────
    const wealthInput = form.querySelector('#starting-wealth-amount');
    if (wealthInput) {
      const fn = () => this.#updateWealthDisplay(form);
      wealthInput.addEventListener('input', fn);
      this.#listeners.push({ el: wealthInput, type: 'input', fn });
    }

    this.updateTabIndicators(form);
    this.updateReviewTab(form);
    this.updateProgressBar(form);
  }

  static cleanup() {
    for (const { el, type, fn } of this.#listeners) {
      try { el.removeEventListener(type, fn); } catch {}
    }
    this.#listeners = [];
  }

  /* ── Dropdown handlers ──────────────────────────────── */

  static async #onDropdownChange(type, select, form) {
    const raw  = select.value;
    const uuid = this.#extractUuid(raw);
    AM.SELECTED[type] = { value: raw, id: raw.split(' ')[0], uuid: uuid || '' };

    if (uuid) {
      await this.#loadDescription(type, uuid, form);
      // Side effects per type
      if (type === 'heritage')   await this.#onHeritageChanged(uuid, form);
      if (type === 'class')      await this.#onClassChanged(uuid, form);
      if (type === 'background') await this.#onBackgroundChanged(uuid, form);
    } else {
      const panel = form.querySelector(`#${type}-description`);
      if (panel) panel.innerHTML = '';
      if (type === 'heritage')   this.#clearHeritageGifts(form);
    }

    this.updateTabIndicators(form);
    this.updateReviewTab(form);
  }

  static async #loadDescription(type, uuid, form) {
    const panel = form.querySelector(`#${type}-description`);
    if (!panel) return;
    panel.innerHTML = `<p class="am-loading"><i class="fas fa-spinner fa-spin"></i> ${game.i18n.localize('am.app.loading')}</p>`;
    const html = await DocumentService.getEnrichedDescription(uuid);
    panel.innerHTML = html || `<p>${game.i18n.localize('am.app.no-description')}</p>`;
  }

  /* ── Heritage Gift ──────────────────────────────────── */

  static async #onHeritageChanged(uuid, form) {
    // Show loading state on gift tab
    const giftPanel = form.querySelector('[data-tab="heritageGift"]');
    if (giftPanel) {
      const container = giftPanel.querySelector('.am-gift-list');
      if (container) container.innerHTML = `<p class="am-loading"><i class="fas fa-spinner fa-spin"></i> ${game.i18n.localize('am.app.loading')}</p>`;
    }

    const gifts = await EquipmentService.loadHeritageGifts(uuid);
    AM.heritageGifts = gifts;

    // Re-render only the heritageGift part, then re-attach radio listeners
    if (AM.app) {
      await AM.app.render(false, { parts: ['heritageGift'] });
      // Re-attach radio listeners to newly rendered DOM
      const newForm = AM.app.element;
      newForm?.querySelectorAll('.am-gift-option').forEach(radio => {
        const fn = (e) => this.#onGiftSelected(e.target, newForm);
        radio.addEventListener('change', fn);
        this.#listeners.push({ el: radio, type: 'change', fn });
      });
    }
  }

  static #clearHeritageGifts(form) {
    AM.heritageGifts = [];
    AM.SELECTED.heritageGift = null;
    AM.app?.render(false, { parts: ['heritageGift'] });
  }

  static #onGiftSelected(radio, form) {
    AM.SELECTED.heritageGift = {
      uuid: radio.dataset.uuid || null,
      name: radio.dataset.name || radio.value,
      idx:  radio.value
    };
    // Sync the selected UUID into the hidden form input so formData picks it up
    const hiddenInput = form.querySelector('#heritage-gift-uuid');
    if (hiddenInput) hiddenInput.value = radio.dataset.uuid || '';
    this.updateReviewTab(form);
  }

  /* ── Equipment ──────────────────────────────────────── */

  static async #onClassChanged(uuid, form) {
    if (!AM.equipmentData) AM.equipmentData = {};
    AM.equipmentData.class         = await EquipmentService.loadStartingEquipment(uuid, 'class');
    AM.equipmentData.wealthFormula = await EquipmentService.getStartingWealthFormula(uuid);
    // Load dynamic spell info for classes not in the hardcoded table
    await SpellService.loadClassSpellInfo(uuid);
    // Reset maneuver/spell selections when class changes
    AM.creationManeuvers = null;
    AM.creationSpells    = null;
    if (AM.app) {
        await AM.app.render(false, { parts: ['equipment', 'maneuvers', 'spells'] });
        const newForm = AM.app.element;
        newForm?.querySelectorAll('.am-equipment-option-btn').forEach(btn => {
          const fn = () => this.#onEquipmentChoice(btn, newForm);
          btn.addEventListener('click', fn);
          this.#listeners.push({ el: btn, type: 'click', fn });
        });
      }
  }

  static async #onBackgroundChanged(uuid, form) {
    if (!AM.equipmentData) AM.equipmentData = {};
    AM.equipmentData.background = await EquipmentService.loadStartingEquipment(uuid, 'background');
    if (AM.app) {
        await AM.app.render(false, { parts: ['equipment'] });
        const newForm = AM.app.element;
        newForm?.querySelectorAll('.am-equipment-option-btn').forEach(btn => {
          const fn = () => this.#onEquipmentChoice(btn, newForm);
          btn.addEventListener('click', fn);
          this.#listeners.push({ el: btn, type: 'click', fn });
        });
      }
  }

  static #onEquipmentChoice(btn, _form) {
    const group = btn.closest('.am-equipment-choice-group');
    if (!group) return;
    group.querySelectorAll('.am-equipment-option').forEach(el => el.classList.remove('am-selected'));
    btn.closest('.am-equipment-option')?.classList.add('am-selected');
    const hidden = group.querySelector('input[type="hidden"]');
    if (hidden) hidden.value = btn.dataset.idx ?? '0';
  }

  static #updateWealthDisplay(form) {
    const input  = form.querySelector('#starting-wealth-amount');
    const result = form.querySelector('#wealth-roll-result');
    if (result && input) result.textContent = input.value ? `${input.value} gp` : '';
  }

  /* ── Review tab ─────────────────────────────────────── */

  static updateReviewTab(form) {
    if (!form) return;
    const panel = form.querySelector('[data-tab="finalize"]');
    if (!panel) return;

    for (const type of [...ITEM_TYPES, 'heritageGift']) {
      const el = panel.querySelector(`.review-${type}`);
      if (!el) continue;
      if (type === 'heritageGift') {
        el.textContent = AM.SELECTED.heritageGift?.name || '—';
      } else {
        el.textContent = this.#getSelectedName(type, form) || '—';
      }
    }

    this.updateAbilitiesSummary(form);
    this.#updateNameDisplay(form);
    this.#updatePortraitSrc(form);
    this.#updateBioPreview(form);
  }

  static updateAbilitiesSummary(form) {
    if (!form) return;
    const grid = form.querySelector('.abilities-grid');
    if (!grid) return;
    const scores = {};
    form.querySelectorAll('[name^="abilities["]').forEach(el => {
      const m = el.name.match(/abilities\[(\w+)\]/);
      if (m) scores[m[1]] = el.value || AM.ABILITY_SCORES.DEFAULT;
    });
    const labels = { str:'STR', dex:'DEX', con:'CON', int:'INT', wis:'WIS', cha:'CHA' };
    grid.innerHTML = Object.entries(labels).map(([key, abbr]) =>
      `<div class="ability-review-item"><span class="abbr">${abbr}</span><span class="score">${scores[key] ?? AM.ABILITY_SCORES.DEFAULT}</span></div>`
    ).join('');
  }

  static updateTabIndicators(form) {
    if (!form) return;
    const app = form.closest('.application');
    if (!app) return;

    const checks = {
      start:       () => !!(form.querySelector('#character-name')?.value?.trim()),
      heritage:    () => !!(AM.SELECTED.heritage?.uuid),
      heritageGift:() => !!(AM.SELECTED.heritageGift?.name) || (AM.heritageGifts || []).length === 0,
      culture:     () => !!(AM.SELECTED.culture?.uuid),
      background:  () => !!(AM.SELECTED.background?.uuid),
      destiny:     () => !!(AM.SELECTED.destiny?.uuid),
      class:       () => !!(AM.SELECTED.class?.uuid),
      abilities:   () => {
        const inputs = form.querySelectorAll('[name^="abilities["]');
        return inputs.length > 0 && [...inputs].every(el => el.value && el.value !== '');
      },
      equipment:   () => true, // optional
      biography:   () => true, // optional
      finalize:    () => true
    };

    for (const [tabId, checkFn] of Object.entries(checks)) {
      const navLink = app.querySelector(`[data-tab="${tabId}"]`);
      if (!navLink) continue;
      try {
        const complete = checkFn();
        navLink.classList.toggle('am-tab-complete',   complete);
        navLink.classList.toggle('am-tab-incomplete', !complete);
      } catch {}
    }
  }

  /* ── Misc ───────────────────────────────────────────── */

  static updateProgressBar(form) {
    if (!form) return;
    const required = form.querySelectorAll('[aria-required="true"]');
    if (!required.length) return;
    let filled = 0;
    required.forEach(el => {
      if (el.tagName === 'SELECT' ? !!el.value : !!el.value?.trim()) filled++;
    });
    const pct = Math.round((filled / required.length) * 100);
    const header = form.closest('.application')?.querySelector('.am-app-header');
    if (header) header.style.setProperty('--progress-percent', `${pct}%`);
    const text = form.closest('.application')?.querySelector('.wizard-progress-text');
    if (text) text.textContent = `${pct}% ${game.i18n.localize('am.app.creation-progress')}`;
  }

  static #updatePortraitSrc(form) {
    const artInput = form?.querySelector('#character-art-path');
    const img      = form?.querySelector('.character-portrait img');
    if (artInput?.value && img) img.src = artInput.value;
  }

  static #updateNameDisplay(form) {
    const name = form?.querySelector('#character-name')?.value?.trim() || '—';
    form?.querySelectorAll('.character-name-display').forEach(el => { el.textContent = name; });
  }

  static #syncTokenArtRow(form) {
    const chk = form.querySelector('#link-token-art');
    const row = form.querySelector('#token-art-row');
    if (row) row.style.display = chk?.checked ? 'none' : '';
  }

  static #updateBioPreview(form) {
    const preview = form.querySelector('.bio-preview');
    if (!preview) return;
    const traits = form.querySelector('#traits')?.value?.slice(0, 200);
    preview.textContent = traits || '—';
  }

  static #extractUuid(raw) {
    if (!raw) return null;
    const m = raw.match(/\[([^\]]+)\]/);
    return m ? m[1] : null;
  }

  static #getSelectedName(type, form) {
    const dd  = form.querySelector(`#${type}-dropdown`);
    const opt = dd?.options[dd?.selectedIndex];
    return opt?.textContent?.trim() || '';
  }
}
