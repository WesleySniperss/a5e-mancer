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

  /**
   * What point buy can actually express, read from the cost table rather than
   * from the settings.
   *
   * `abilityScoreMin`/`Max` are the GM's bounds for MANUAL and ROLLED scores,
   * and using them for point buy too was exploitable: raise the maximum to 18
   * and 16–18 cost nothing, because the cost lookup returns `undefined` for a
   * score the table does not name and that was being counted as zero. Worse
   * than free — going 15 → 16 dropped the spend by 9 and handed the points
   * back, so every ability could be maxed with budget to spare.
   *
   * A cost table is a statement about which scores are purchasable. Beyond it
   * there is no price to charge, so there is nothing to buy.
   */
  static get POINT_BUY_BOUNDS() {
    const scores = Object.keys(this.POINT_BUY_COSTS).map(Number);
    return { MIN: Math.min(...scores), MAX: Math.max(...scores) };
  }

  /**
   * Sanity bounds for *rolled* scores. Deliberately NOT AM.ABILITY_SCORES.MIN/MAX —
   * those are the point-buy budget bounds (8–15) and would squash every roll.
   */
  static ROLL_BOUNDS = { MIN: 3, MAX: 20 };

  /** Math.clamped was removed in Foundry v13; keep our own so this is version-proof. */
  static clamp(value, min, max) { return Math.min(Math.max(value, min), max); }

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
    const { MIN, MAX } = this.POINT_BUY_BOUNDS;
    return scores.reduce((total, score) => {
      const cost = this.POINT_BUY_COSTS[score];
      if (cost !== undefined) return total + cost;
      // A score the table does not price must never come out cheaper than the
      // dearest one it does. Charging zero here is what made scores above the
      // table free; below it, nothing is owed.
      return total + (score > MAX ? this.POINT_BUY_COSTS[MAX] : 0);
    }, 0);
  }

  /**
   * Build the abilities context array used by the template.
   * A5e abilities: str, dex, con, int, wis, cha (same keys as 5e).
   */
  static buildAbilitiesContext(initialScore) {
    const ABILITIES = [
      { key: 'str', label: 'Strength',     abbreviation: 'STR' },
      { key: 'dex', label: 'Dexterity',    abbreviation: 'DEX' },
      { key: 'con', label: 'Constitution', abbreviation: 'CON' },
      { key: 'int', label: 'Intelligence', abbreviation: 'INT' },
      { key: 'wis', label: 'Wisdom',       abbreviation: 'WIS' },
      { key: 'cha', label: 'Charisma',     abbreviation: 'CHA' }
    ];

    const score = initialScore ?? AM.ABILITY_SCORES.DEFAULT;
    return ABILITIES.map(a => ({
      ...a,
      currentScore: score,
      fullKey: game.i18n.localize(`A5E.Ability${a.key.charAt(0).toUpperCase()}${a.key.slice(1)}`) || a.label
    }));
  }

  /**
   * Roll a single ability score using the configured formula.
   * @param {string} formula
   * @returns {Promise<number>}
   */
  static async rollSingleScore(formula) {
    let roll;
    try {
      roll = new Roll(formula || '4d6kh3');
      await roll.evaluate();
    } catch (err) {
      AM.log(1, 'Ability roll failed:', formula, err);
      ui.notifications?.error(`${AM.NAME}: invalid roll formula "${formula}"`);
      return null;
    }
    if (game.modules.get('dice-so-nice')?.active) {
      try { await game.dice3d.showForRoll(roll, game.user, true); } catch {}
    }
    return this.clamp(roll.total, this.ROLL_BOUNDS.MIN, this.ROLL_BOUNDS.MAX);
  }

  /**
   * Roll all six ability scores in sequence.
   * @param {string} formula
   * @returns {Promise<number[]>} array of 6 scores
   */
  static async rollAllScores(formula) {
    let delay = 400;
    try { delay = game.settings.get(AM.ID, 'rollDelay') || 400; } catch { /* setting missing */ }
    const scores = [];
    for (let i = 0; i < 6; i++) {
      const score = await this.rollSingleScore(formula);
      if (score === null) return scores;   // bad formula – stop, keep what we got
      scores.push(score);
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

    // Point buy is bounded by what the cost table prices, narrowed further by
    // the GM's own bounds — never widened past them. See POINT_BUY_BOUNDS.
    const buy      = this.POINT_BUY_BOUNDS;
    const lo       = Math.max(AM.ABILITY_SCORES.MIN, buy.MIN);
    const hi       = Math.min(AM.ABILITY_SCORES.MAX, buy.MAX);
    const current  = parseInt(scoreEl.textContent) || AM.ABILITY_SCORES.DEFAULT;
    const next     = this.clamp(current + delta, lo, hi);

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
