import { AM } from '../a5e-mancer.js';

/* ============================================================
   FormValidation
   ============================================================ */
export class FormValidation {
  static async checkMandatoryFields(form) {
    const required = form.querySelectorAll('[aria-required="true"]');
    required.forEach(el => {
      const hasValue = el.tagName === 'SELECT'
        ? !!el.value
        : !!el.value?.trim();
      el.closest('.form-group, .form-row, div')
        ?.classList.toggle('am-field-missing', !hasValue);
    });
  }
}
