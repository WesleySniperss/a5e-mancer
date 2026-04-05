import { AM } from '../a5e-mancer.js';

export class ProgressBar {
  static calculateAndUpdateProgress(form, _changedEl) {
    if (!form) return 0;
    const required = form.querySelectorAll('[aria-required="true"]');
    if (!required.length) return 0;
    let filled = 0;
    required.forEach(el => {
      if (el.tagName === 'SELECT' ? !!el.value : !!el.value?.trim()) filled++;
    });
    const pct = Math.round((filled / required.length) * 100);
    const header = form.closest('.application')?.querySelector('.am-app-header');
    if (header) header.style.setProperty('--progress-percent', `${pct}%`);
    const text = form.closest('.application')?.querySelector('.wizard-progress-text');
    if (text) text.textContent = `${pct}% ${game.i18n.localize('am.app.creation-progress')}`;
    return pct;
  }
}
