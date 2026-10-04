/**
 * The armour class, typed in, and where it comes from.
 *
 * a5e works the figure out on every prepare (prepareArmorClass): the base -
 * worn armour, or the actor's base formula, "10 + @dex.mod" unless set - plus
 * every bonus, a shield's and the effects' that add to
 * system.attributes.ac.changes.bonuses.value. A typed `ac.value` is
 * overwritten the moment it is stored, which is why a5e's own sheet draws the
 * figure disabled and only opens the base formula, behind its cog.
 *
 * Asked for (2026-10-04): change the armour class on this sheet when it is
 * unlocked. So the difference between what is typed and what a5e gives goes
 * into one effect of this sheet's, adding to the bonuses as Slowed's -2 does.
 * The armour class still follows armour, shield and Dexterity; the correction
 * rides on top, is listed under Effects where it can be seen, switched off
 * and deleted, and shows in the badge's breakdown. Back to what a5e would
 * give, the effect is deleted rather than left at 0 - the same rule as the
 * exertion pool's "Sheet correction" (A5eCharacterSheet.exertionMaxUpdate).
 */

const MODULE_ID = 'a5e-mancer';
const FLAG = 'acCorrection';
export const AC_BONUS_KEY = 'system.attributes.ac.changes.bonuses.value';

const signed = (n) => (n < 0 ? `−${Math.abs(n)}` : `+${n}`);

export class ArmorClass {

  /** The correction effect this sheet keeps on an actor, if there is one. */
  static correction(actor) {
    return actor?.effects?.find?.((e) => e.flags?.[MODULE_ID]?.[FLAG]) ?? null;
  }

  /** What an effect adds to the armour class bonuses, when it is a number. */
  static #amount(effect) {
    let sum = 0;
    for (const c of effect?.system?.changes ?? []) {
      if (c?.key !== AC_BONUS_KEY || (c.type ?? 'add') !== 'add') continue;
      const n = Number(c.value);
      if (Number.isFinite(n)) sum += n;
    }
    return sum;
  }

  /**
   * An effect that fixes the armour class outright (a key on ac.value): a5e
   * then drops every bonus, so no correction can reach the figure.
   * @returns {string|null} what fixes it
   */
  static fixedBy(actor) {
    const over = foundry.utils.getProperty(actor?.overrides ?? {}, 'system.attributes.ac.value');
    if (over === undefined || over === null) return null;
    return actor.system?.attributes?.ac?.changes?.override?.name || 'an effect';
  }

  /**
   * Make the actor's armour class `want`.
   * @returns {Promise<boolean>} whether it could be
   */
  static async set(actor, want) {
    if (!actor || !Number.isFinite(want)) return false;
    const fixer = this.fixedBy(actor);
    if (fixer) {
      ui.notifications.warn(game.i18n.format('am.ac.fixed', { name: fixer }));
      return false;
    }
    const now = Number(actor.system?.attributes?.ac?.value) || 0;
    const fx = this.correction(actor);
    const counted = fx && !fx.disabled && !fx.isSuppressed ? this.#amount(fx) : 0;
    const delta = want - (now - counted);

    if (!delta) {
      if (fx) await fx.delete();
      return true;
    }
    const changes = [{ key: AC_BONUS_KEY, type: 'add', value: String(delta) }];
    if (fx) {
      await fx.update(fx.disabled ? { 'system.changes': changes, disabled: false } : { 'system.changes': changes });
    } else {
      await actor.createEmbeddedDocuments('ActiveEffect', [{
        name: game.i18n.localize('am.ac.correction'),
        img: 'icons/svg/shield.svg',
        origin: actor.uuid,
        flags: { [MODULE_ID]: { [FLAG]: true } },
        system: { changes }
      }]);
    }
    return true;
  }

  /**
   * Where the figure comes from, a line each, for the badge's tooltip: the
   * base a5e chose, the items' bonuses, then the effects'. Built from what
   * a5e prepared, so it adds up to the figure shown.
   * @returns {string} HTML
   */
  static breakdown(actor) {
    const ac = actor?.system?.attributes?.ac ?? {};
    const ch = ac.changes ?? {};
    const esc = (s) => foundry.utils.escapeHTML(String(s ?? ''));
    const lines = [];
    if (ch.override) lines.push(`${esc(ch.override.name)} ${Number(ch.override.value) || 0}`);
    const parts = ch.bonuses?.components ?? [];
    for (const c of parts) lines.push(`${esc(c.name)} ${signed(Number(c.value) || 0)}`);
    let rest = (Number(ch.bonuses?.value) || 0) - parts.reduce((s, c) => s + (Number(c.value) || 0), 0);
    if (!this.fixedBy(actor)) {
      for (const fx of actor?.appliedEffects ?? []) {
        const n = this.#amount(fx);
        if (!n) continue;
        lines.push(`${esc(fx.name)} ${signed(n)}`);
        rest -= n;
      }
    }
    if (rest) lines.push(`${esc(game.i18n.localize('am.ac.other'))} ${signed(rest)}`);
    const head = `<strong>${esc(game.i18n.localize('am.ac.label'))} ${Number(ac.value) || 0}</strong>`;
    return [head, ...lines].join('<br>');
  }
}
