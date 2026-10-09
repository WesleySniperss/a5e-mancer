import { AM } from '../am.js';

/**
 * Spells cast with a weapon attack: Booming Blade and Green-Flame Blade, and
 * a5e's own Trick Shot, Rope Shot, Flare Shot, Detonating Shot, Cupid's Arrow.
 *
 * Asked 2026-10-09: spells like Booming Blade that need a weapon attack should
 * roll together with the weapon, as on D&D Beyond - which puts the spell's
 * damage under the weapon and rolls the weapon's attack. Here, casting one
 * from the sheet asks which weapon (only those that fit, the equipped first;
 * nothing is asked when one fits), rolls that weapon's attack in a5e's own
 * window - its bonus and its damage - and then opens the spell's, for what the
 * spell adds: its damage, the slot, a save. An attack called off casts nothing.
 *
 * Which spells: those whose text makes the weapon attack part of casting and
 * whose own actions roll no attack. One with an attack roll of its own
 * (Altered Strike, Air Wave) rolls it already and is left as a5e has it.
 */
export class WeaponSpells {

  /* a5e's own ("As part of the action used to cast this spell, make a ranged
     weapon attack"), the 2014 blades' ("...you must make a melee attack with a
     weapon") and the 2024 ones' ("As part of the Magic action to cast this
     spell", "You brandish the weapon used in the spell's casting and make a
     melee attack with it"). */
  static #PATTERNS = [
    /as part of the (?:\w+ )?action (?:used )?to cast this spell,? (?:you (?:must )?)?make an? (melee|ranged) (?:weapon )?attack/i,
    /make an? (melee|ranged) attack with a weapon/i,
    /brandish the weapon used in the spell'?s casting and make an? (melee|ranged) attack/i
  ];

  static #text(item) {
    const html = typeof item?.system?.description === 'string'
      ? item.system.description : (item?.system?.description?.value ?? '');
    return html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
  }

  /** 'melee' or 'ranged', or null for a spell not cast with a weapon attack. */
  static kindOf(item) {
    if (item?.type !== 'spell') return null;
    const actions = Object.values(item.system?.actions ?? {});
    if (actions.some(a => Object.values(a?.rolls ?? {}).some(r => r?.type === 'attack'))) return null;
    const text = this.#text(item);
    for (const re of this.#PATTERNS) {
      const m = text.match(re);
      if (m) return m[1].toLowerCase();
    }
    return null;
  }

  /** The character's weapon attacks of a kind - [{ item, actionId, label }], the equipped first. */
  static attacksFor(actor, kind) {
    const want = kind === 'ranged' ? 'rangedWeaponAttack' : 'meleeWeaponAttack';
    const out = [];
    for (const item of actor?.items ?? []) {
      if (item.type !== 'object' || item.system?.objectType !== 'weapon') continue;
      for (const [actionId, action] of Object.entries(item.system?.actions ?? {})) {
        if (!Object.values(action?.rolls ?? {}).some(r => r?.type === 'attack' && r.attackType === want)) continue;
        out.push({
          item, actionId,
          label: action?.name && action.name !== item.name ? action.name : item.name,
          equipped: Number(item.system?.equippedState ?? 0)
        });
      }
    }
    return out.sort((a, b) => (b.equipped - a.equipped) || a.label.localeCompare(b.label));
  }

  /**
   * Cast a weapon spell: a weapon picked, its attack rolled, then the spell.
   * @returns {Promise<boolean>} whether the spell was cast
   */
  static async cast(actor, spell, spellActionId = null, { skipRollDialog = false } = {}) {
    const kind = this.kindOf(spell);
    const attacks = this.attacksFor(actor, kind);
    if (!attacks.length) {
      ui.notifications.warn(`${AM.NAME}: ${spell.name} is cast with a ${kind} weapon attack, and ${actor.name} has no ${kind} weapon - only the spell is rolled.`);
      await spell.activate(spellActionId, { skipRollDialog });
      return true;
    }
    const pick = attacks.length === 1 ? attacks[0] : await this.#choose(spell, kind, attacks);
    if (!pick) return false;
    if (!await this.#rollAttack(actor, pick, { skipRollDialog })) return false;
    await spell.activate(spellActionId, { skipRollDialog });
    return true;
  }

  static async #choose(spell, kind, attacks) {
    const esc = (s) => foundry.utils.escapeHTML(String(s ?? ''));
    const choice = await foundry.applications.api.DialogV2.wait({
      window: { title: `${spell.name}: with which weapon?` },
      position: { width: 380 },
      content: `<p>${esc(spell.name)} is cast with a ${kind} weapon attack. Its attack is rolled first, then the spell.</p>`,
      buttons: attacks.map((a, i) => ({
        action: String(i), label: a.label, icon: kind === 'ranged' ? 'fa-solid fa-bow-arrow' : 'fa-solid fa-sword',
        default: i === 0
      })),
      rejectClose: false
    }).catch(() => null);
    const i = Number(choice);
    return Number.isInteger(i) && attacks[i] ? attacks[i] : null;
  }

  /**
   * Roll a weapon's attack and wait for it: true once its card is in the chat,
   * false when its window was closed without rolling. a5e's activate returns
   * before the roll, so the card is what tells.
   */
  static #rollAttack(actor, { item, actionId }, { skipRollDialog }) {
    return new Promise((resolve) => {
      let done = false, seen = false, closedAt = 0;
      // a5e names the window after the action: "Activate Dagger (Off-Hand)"
      const title = `Activate ${item.system?.actions?.[actionId]?.name || item.name}`;
      const finish = (ok) => {
        if (done) return;
        done = true;
        Hooks.off('createChatMessage', onMessage);
        clearInterval(watch);
        clearTimeout(limit);
        resolve(ok);
      };
      const onMessage = (message) => {
        if (message?.system?.itemId === item.uuid) finish(true);
      };
      Hooks.on('createChatMessage', onMessage);
      // The window called off: gone, and no card after it
      const watch = setInterval(() => {
        const open = [...foundry.applications.instances.values()].some(w => (w.title ?? '').endsWith(title));
        if (open) { seen = true; closedAt = 0; return; }
        if (!seen) return;
        closedAt ||= Date.now();
        if (Date.now() - closedAt > 2000) finish(false);
      }, 300);
      const limit = setTimeout(() => finish(false), 10 * 60 * 1000);
      Promise.resolve(item.activate(actionId, { skipRollDialog })).catch((err) => {
        AM.log(2, `${item.name} could not be rolled:`, err);
        finish(false);
      });
    });
  }
}
