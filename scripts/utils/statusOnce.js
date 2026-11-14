import { AM } from '../am.js';

/**
 * A status put on twice at the same moment.
 *
 * When a creature drops to 0 hit points, as many as three things put the "dead"
 * status on it at once on the GM's client: a5e itself (its "automate
 * unconscious" setting gives an NPC "dead"), Monk's Combat Details ("auto
 * defeated") and Combat Booster ("mark defeated"). toggleStatusEffect - core's
 * and a5e's own - looks for the effect, then makes it after an await, so each of
 * them saw no effect yet and each made one with the status's fixed id. The
 * second was refused, and its refusal came up on screen: "The _id
 * [dead000000000000] already exists within the parent collection: ActorDelta
 * [...] effects" (the user's game, 2026-11-14).
 *
 * Calls that set the same status on the same creature to the same state while
 * one is under way now wait for it and get its answer: the status is there.
 * One that loses the race to another client is told the same: the refusal names
 * the status's own id, so what it asked for exists. A plain toggle, which is
 * asked to switch and not to set, is left alone - two of those are on, then off.
 *
 * A file of its own: a name added to a file a cached copy of the module may
 * already hold breaks at link time (the Forge keeps old files under the same URL).
 */
export class StatusOnce {
  static #installed = false;

  static install() {
    if (this.#installed) return;
    const proto = CONFIG.Actor?.documentClass?.prototype;
    const toggle = proto?.toggleStatusEffect;
    if (typeof toggle !== 'function') return;
    this.#installed = true;
    const running = new Map();
    proto.toggleStatusEffect = function (statusId, ...rest) {
      const active = rest[0]?.active;
      if (active !== true && active !== false) return toggle.call(this, statusId, ...rest);
      const key = `${this.uuid}|${statusId}|${active}`;
      const under = running.get(key);
      if (under) return under.then(() => (active ? true : undefined), () => toggle.call(this, statusId, ...rest));
      const run = (async () => {
        try {
          return await toggle.call(this, statusId, ...rest);
        } catch (err) {
          const id = StatusOnce.#fixedId(statusId);
          if (active && id && /already exists within the parent collection/.test(String(err?.message)) && String(err.message).includes(id)) return true;
          throw err;
        }
      })();
      running.set(key, run);
      run.then(() => running.delete(key), () => running.delete(key));
      return run;
    };
    AM.log(3, 'a status set twice at once is set once');
  }

  /** The fixed effect id core gives a status (dead000000000000), if it has one. */
  static #fixedId(statusId) {
    const list = CONFIG.statusEffects;
    const status = Array.isArray(list) ? list.find((s) => s.id === statusId) : list?.[statusId];
    return status?._id ?? null;
  }
}
