import { AM } from '../a5e-mancer.js';

/**
 * Handles all ability-score generation logic:
 *   – Standard Array  (assign fixed values)
 *   – Point Buy       (spend a budget of points)
 *   – Manual / Roll   (roll a formula per ability)
 *
 * A5e uses the same six abilities as 5e: str, dex, con, int, wis, cha.
 */
export class StatRoller {

  /* --- point-buy cost table (score → cost) -------------- */
  static POINT_BUY_COSTS = { 8:0, 9:1, 10:2, 11:3, 12:4, 13:5, 14:7, 15:9 };

  /* -------------------------------------------------------- */

  /** @returns {string} comma-separated default standard array */
  static getDefaultStandardArray() { return '15,14,13,12,10,8'; }

  /** @returns {number[]} */
  static getStandardArrayValues() {
    const raw = game.settings.get(AM.ID, 'customStandardArray') || this.getDefaultStandardArray();
    return raw.split(',').map(v => parseInt(v.trim())).filter(n => !isNaN(n)).sort((a,b) => b - a);
  }

  /** @returns {string} the configured roll method */
  static getDiceRollingMethod() {
    return game.settings.get(AM.ID, 'diceRollingMethod') || 'standardArray';
  }

  /** @returns {number} */
  static getTotalPoints() {
    return game.settings.get(AM.ID, 'pointBuyTotal') || 27;
  }

  /** @returns {number} points spent for a given array of scores */
  static calculateTotalPointsSpent(scores) {
    return scores.reduce((total, score) => {
      const cost = this.POINT_BUY_COSTS[score];
      return total + (cost !== undefined ? cost : 0);
    }, 0);
  }

  /**
   * Build the abilities context array used by the template.
   * A5e abilities: str, dex, con, int, wis, cha (same keys as 5e).
   */
  static buildAbilitiesContext() {
    const ABILITIES = [
      { key: 'str', label: 'Strength',     abbreviation: 'STR' },
      { key: 'dex', label: 'Dexterity',    abbreviation: 'DEX' },
      { key: 'con', label: 'Constitution', abbreviation: 'CON' },
      { key: 'int', label: 'Intelligence', abbreviation: 'INT' },
      { key: 'wis', label: 'Wisdom',       abbreviation: 'WIS' },
      { key: 'cha', label: 'Charisma',     abbreviation: 'CHA' }
    ];

    const defaultScore = AM.ABILITY_SCORES.DEFAULT;
    return ABILITIES.map(a => ({
      ...a,
      currentScore: defaultScore,
      fullKey: game.i18n.localize(`A5E.Ability${a.key.charAt(0).toUpperCase()}${a.key.slice(1)}`) || a.label
    }));
  }

  /**
   * Roll a single ability score using the configured formula.
   * @param {string} formula
   * @returns {Promise<number>}
   */
  static async rollSingleScore(formula) {
    const roll = new Roll(formula);
    await roll.evaluate();
    if (game.modules.get('dice-so-nice')?.active) {
      try { await game.dice3d.showForRoll(roll, game.user, true); } catch {}
    }
    return Math.clamped(roll.total, AM.ABILITY_SCORES.MIN, AM.ABILITY_SCORES.MAX);
  }

  /**
   * Roll all six ability scores in sequence.
   * @param {string} formula
   * @returns {Promise<number[]>} array of 6 scores
   */
  static async rollAllScores(formula) {
    const delay = game.settings.get(AM.ID, 'rollDelay') || 400;
    const scores = [];
    for (let i = 0; i < 6; i++) {
      scores.push(await this.rollSingleScore(formula));
      if (i < 5) await new Promise(r => setTimeout(r, delay));
    }
    return scores;
  }

  /**
   * Adjust a point-buy score up or down.
   * @param {Event} _event
   * @param {HTMLElement} btn
   */
  static adjustScore(_event, btn) {
    const idx   = parseInt(btn.dataset.abilityIndex);
    const delta = parseInt(btn.dataset.adjust);
    if (isNaN(idx) || isNaN(delta)) return;

    // Use document lookup - more reliable during partial renders
    const scoreEl  = document.getElementById(`ability-score-${idx}`);
    const inputEl  = document.getElementById(`ability-${idx}-input`);
    if (!scoreEl || !inputEl) return;

    const current  = parseInt(scoreEl.textContent) || AM.ABILITY_SCORES.DEFAULT;
    const next     = Math.clamped(current + delta, AM.ABILITY_SCORES.MIN, AM.ABILITY_SCORES.MAX);

    // Check point-buy budget
    const allScores = [];
    document.querySelectorAll('.ability-block.point-buy .current-score').forEach((el, i) => {
      allScores[i] = i === idx ? next : (parseInt(el.textContent) || AM.ABILITY_SCORES.DEFAULT);
    });

    const spent = this.calculateTotalPointsSpent(allScores);
    if (spent > this.getTotalPoints() && delta > 0) return; // not enough points

    scoreEl.textContent = next;
    inputEl.value = next;

    // Update points display
    const remaining = document.getElementById('remaining-points');
    if (remaining) remaining.textContent = this.getTotalPoints() - spent;

    inputEl.dispatchEvent(new Event('change', { bubbles: true }));
  }
}
