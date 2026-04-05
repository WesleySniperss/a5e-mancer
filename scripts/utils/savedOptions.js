import { AM } from '../a5e-mancer.js';

export class SavedOptions {
  static async saveOptions(formDataObj) {
    try {
      await game.settings.set(AM.ID, 'savedOptions', formDataObj);
      AM.log(3, 'Options saved');
    } catch (err) {
      AM.log(1, 'Error saving options:', err);
    }
  }

  static async restoreFormOptions(form) {
    try {
      const saved = game.settings.get(AM.ID, 'savedOptions') || {};
      for (const [key, value] of Object.entries(saved)) {
        const el = form.querySelector(`[name="${key}"]`);
        if (!el || !value) continue;
        if (el.type === 'checkbox') el.checked = !!value;
        else el.value = value;
        // Trigger change so DOMManager updates descriptions and AM.SELECTED
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
      AM.log(3, 'Restored', Object.keys(saved).length, 'saved options');
    } catch (err) {
      AM.log(2, 'Error restoring options:', err);
    }
  }

  static async resetOptions(form) {
    try {
      await game.settings.set(AM.ID, 'savedOptions', {});
      // Clear all AM state
      for (const key of Object.keys(AM.SELECTED)) {
        if (key === 'heritageGift') AM.SELECTED[key] = { name: '', uuid: '' };
        else AM.SELECTED[key] = { value: '', id: '', uuid: '' };
      }
      AM.heritageGifts     = [];
      AM.equipmentData    = null;
      AM.creationManeuvers = null;
      AM.creationSpells    = null;
      form?.reset();
      return true;
    } catch {
      return false;
    }
  }
}
