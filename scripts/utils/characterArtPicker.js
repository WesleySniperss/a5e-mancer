import { AM } from '../a5e-mancer.js';

export class CharacterArtPicker {
  static selectCharacterArt(_event, _btn) {
    try {
      new FilePicker({
        type: 'image',
        callback: (path) => {
          const input = document.getElementById('character-art-path');
          if (input) { input.value = path; input.dispatchEvent(new Event('change', { bubbles: true })); }
          const portrait = document.querySelector('.character-portrait img');
          if (portrait) portrait.src = path;
          const linked = document.getElementById('link-token-art');
          if (linked?.checked) {
            const tokenInput = document.getElementById('token-art-path');
            if (tokenInput) { tokenInput.value = path; tokenInput.dispatchEvent(new Event('change', { bubbles: true })); }
          }
        }
      }).render(true);
    } catch (err) {
      AM.log(1, 'Art picker error:', err);
      ui.notifications.error('am.errors.art-picker-failed', { localize: true });
    }
  }

  static selectTokenArt(_event, _btn) {
    try {
      new FilePicker({
        type: 'image',
        callback: (path) => {
          const input = document.getElementById('token-art-path');
          if (input) { input.value = path; input.dispatchEvent(new Event('change', { bubbles: true })); }
        }
      }).render(true);
    } catch (err) {
      AM.log(1, 'Token art picker error:', err);
    }
  }

  static selectPlayerAvatar(_event, _btn) {
    try {
      new FilePicker({
        type: 'image',
        callback: (path) => {
          const input = document.getElementById('player-avatar-path');
          if (input) { input.value = path; input.dispatchEvent(new Event('change', { bubbles: true })); }
        }
      }).render(true);
    } catch (err) {
      AM.log(1, 'Avatar picker error:', err);
    }
  }
}
