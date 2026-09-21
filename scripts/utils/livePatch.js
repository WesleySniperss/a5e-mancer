/*
 * A number changed, not the sheet.
 *
 * Foundry redraws a v1 sheet whole for every write on the actor: getData, the
 * template, innerHTML, and activateListeners again over the new nodes. Measured
 * in the real browser on Elbranbran (44 items), one point of damage cost
 *
 *     getData 44–66ms · template 29–49ms · innerHTML 5–7ms · listeners 44–51ms
 *     = 133–170ms inside _render
 *
 * producing 358KB of markup, which the browser then parses and lays out against
 * Tidy's stylesheet. The canvas ticker shares that thread, so the map visibly
 * stops — which is how this was reported: "the map background hangs when
 * something changes on the sheet".
 *
 * None of it is needed to show one different number. Foundry says what changed:
 * a document update renders its apps with `renderContext: "updateActor"` and
 * `renderData` holding the diff (ClientDocument#_onUpdate). Where every changed
 * path is one this file knows how to draw, the elements holding that number are
 * set in place and the redraw is skipped; where anything else changed — an item,
 * a class, a name, a flag nobody here claims — the sheet redraws as before.
 *
 * The rules read their values off the ACTOR, never out of the diff: a write of
 * `system.attributes.hp.value` may be clamped, and `baseMax` moves the derived
 * `max`. The diff decides only whether the change is one we can draw.
 *
 * Adding a rule: name the paths it owns, and return false from apply() for any
 * change of SHAPE — a block that appears or disappears, a row count that moves.
 * Only a number, a class or an attribute may be set here. tools/checks/
 * livepatch.mjs holds the patched sheet against a full redraw of the same
 * actor, in the browser, and any difference is a failed check.
 */

const MODULE_ID = 'a5e-mancer';

const num = (v, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

/** The same percentage getData works out, to the same rounding. */
const pct01 = (v, max) => (max > 0 ? Math.round(Math.min(Math.max(v / max, 0), 1) * 100) : 0);

const setText = (el, text) => { if (el && el.textContent !== String(text)) el.textContent = String(text); };

/** A field being typed in is left alone: the typist is ahead of the document. */
const setValue = (el, value) => {
  if (!el || el === el.ownerDocument?.activeElement) return;
  if (el.value !== String(value)) el.value = String(value);
};

const setAttr = (el, name, value) => { if (el && el.getAttribute(name) !== String(value)) el.setAttribute(name, String(value)); };

/* ── The rules ──────────────────────────────────────────────────────────── */

/**
 * Each rule owns a set of paths and draws them.
 * @typedef {object} LiveRule
 * @property {(path: string, sheet: object) => boolean} owns
 * @property {(sheet: object, el: HTMLElement, paths: string[]) => boolean} apply
 *           false when the change needs a redraw after all.
 */

/** Hit points: the bar, the figure over its maximum, and the editor behind it. */
const hitPoints = {
  owns: (path) => path.startsWith('system.attributes.hp.') || path === 'system.attributes.hp',
  apply(sheet, el) {
    const hp    = sheet.actor.system?.attributes?.hp ?? {};
    const value = num(hp.value);
    const max   = num(hp.max);
    const temp  = num(hp.temp);

    const meter = el.querySelector('.meter.hit-points');
    const chip  = el.querySelector('.hp-row .temp-hp');
    /* The temporary block is drawn only when there is a temporary pool. Its
       coming and going is a change of shape, so it is a redraw. */
    if (!meter || (!!temp !== !!chip)) return false;

    meter.style.setProperty('--bar-percentage', `${pct01(value, max)}%`);
    setText(meter.querySelector('.label .value'), value);
    setText(meter.querySelector('.label .max'), max);
    setValue(el.querySelector('#am-hp-current'), value);
    setValue(el.querySelector('#am-hp-max'), max);
    setValue(el.querySelector('#am-hp-temp'), temp);
    if (chip) {
      setText(chip.querySelector('.am-temp-value'), temp);
      setAttr(chip, 'data-tooltip', `Temporary hit points: ${temp}`);
    }
    return true;
  }
};

/**
 * Exertion, wherever this sheet keeps it: a5e's field on a character, this
 * module's flag on a monster, which is what getData reads.
 *
 * The pool's own size is drawn, but a change to the BONUSES that derive it is
 * not claimed: those are listed on the Bonuses page as well, and a list is
 * shape. `system.attributes.exertion.max` moving on its own — a monster, or a
 * character a5e cannot work a pool out for — is only a number.
 */
const exertion = {
  owns: (path, sheet) => {
    const base = sheet.actor?.type === 'npc'
      ? `flags.${MODULE_ID}.exertion`
      : 'system.attributes.exertion';
    return path === base || path.startsWith(`${base}.`);
  },
  apply(sheet, el, paths) {
    const actor = sheet.actor;
    const ex = (actor.type === 'npc'
      ? actor.flags?.[MODULE_ID]?.exertion
      : actor.system?.attributes?.exertion) ?? {};
    /* recoverOnRest is a setting on the Automation page, not this chip. */
    if (paths.some((p) => p.endsWith('.recoverOnRest'))) return false;

    const current = num(ex.current ?? ex.value);
    const max     = num(ex.max);
    const chip    = el.querySelector('.am-tracker-exertion');
    if (!chip) return false;

    chip.querySelector('.meter')?.style.setProperty('--bar-percentage', `${pct01(current, max)}%`);
    setValue(chip.querySelector('#am-exertion-current'), current);

    const maxInput = chip.querySelector('#am-exertion-max');
    if (maxInput) setValue(maxInput, max);
    else setText(chip.querySelector('.max'), max);

    /* The steppers carry the ceiling they clamp to. */
    for (const b of chip.querySelectorAll('[data-action="exertion-step"]')) setAttr(b, 'data-max', max);
    return true;
  }
};

/**
 * Spell slots: which stars are lit, and the figure beside them when the sheet
 * is unlocked. Only `current` — a level's total is drawn as a row of stars, so
 * a change to it is a change of shape.
 */
const SLOT_CURRENT = /^system\.spellResources\.slots\.(\w+)\.current$/;
const spellSlots = {
  owns: (path) => SLOT_CURRENT.test(path),
  apply(sheet, el, paths) {
    for (const path of paths) {
      const level   = path.match(SLOT_CURRENT)[1];
      const current = num(sheet.actor.system?.spellResources?.slots?.[level]?.current);

      const stars = [...el.querySelectorAll('[data-action="slot-pip"]')]
        .filter((s) => s.dataset.level === String(level));
      const fields = [...el.querySelectorAll('[data-action="slot-field"]')]
        .filter((s) => s.dataset.level === String(level) && s.dataset.field === 'current');
      /* A level this sheet is not showing at all: let the redraw decide what
         it should be showing instead. */
      if (!stars.length && !fields.length) return false;

      for (const star of stars) {
        const spent = num(star.dataset.n) > current;
        star.classList.toggle('am-slot-spent', spent);
        setAttr(star, 'data-tooltip', spent ? 'Spent — click to recover' : 'Click to spend');
      }
      if (stars.length) {
        const group = stars[0].closest('.am-slots');
        if (group) setAttr(group, 'aria-label', `${current} of ${stars.length} slots left`);
      }
      for (const field of fields) setValue(field, current);
    }
    return true;
  }
};

const RULES = [hitPoints, exertion, spellSlots];

/* Foundry's own bookkeeping rides along in every diff and means nothing here. */
const IGNORED = new Set(['_id', '_stats']);

/* ── What the sheet was drawn from ──────────────────────────────────────── */

/**
 * The actor's prepared data, flat: every leaf of `system` by its path, and
 * the statuses it is under.
 *
 * The diff Foundry passes is what was WRITTEN. What the sheet shows is what
 * a5e PREPARED from it, and preparing can move more than was written: on a
 * monster in this world, one point of damage (270 → 269) put `deafened` into
 * actor.statuses — no effect was created or updated, nothing in the diff but
 * the hit points — and a patch that drew only the hit points left the
 * conditions strip showing it unheard. So a snapshot is kept of what each
 * redraw was drawn from, and a patch is allowed only when every path that
 * differs from it is one a rule owns.
 *
 * Measured on the characters in this world: 585–863 leaves, 0.15–0.31ms.
 *
 * @param {Actor} actor
 * @returns {Record<string, unknown>}
 */
export function snapshot(actor) {
  const out = {};
  const seen = new Set();
  const walk = (v, path, depth) => {
    if (typeof v === 'function') return;
    if (v === null || typeof v !== 'object') { out[path] = v; return; }
    if (depth > 12 || seen.has(v)) return;
    if (v instanceof foundry.abstract.Document) return;
    seen.add(v);
    if (v instanceof Set) { out[path] = [...v].sort().join(','); return; }
    /* A Foundry Collection is a Map whose iterator yields values alone. */
    if (v instanceof Map) { Map.prototype.forEach.call(v, (x, k) => walk(x, `${path}.${k}`, depth + 1)); return; }
    if (Array.isArray(v)) { v.forEach((x, i) => walk(x, `${path}.${i}`, depth + 1)); return; }
    for (const k of Object.keys(v)) walk(v[k], `${path}.${k}`, depth + 1);
  };
  walk(actor?.system ?? {}, 'system', 0);
  out.statuses = [...(actor?.statuses ?? [])].sort().join(',');
  return out;
}

/** Every path whose value differs between two snapshots. */
const differences = (a, b) => [...new Set([...Object.keys(a), ...Object.keys(b)])]
  .filter((k) => !Object.is(a[k], b[k]));

/**
 * Draw an actor update in place, or say that it needs a redraw.
 *
 * @param {object} sheet    the rendered v1 sheet
 * @param {object} options  the render options Foundry passed, carrying
 *                          renderContext and renderData
 * @param {object|null} drawn  the snapshot the sheet on screen was drawn from
 * @returns {object|null}  the snapshot the sheet now shows, when it shows the
 *                         change and no redraw is needed; null otherwise
 */
export function patchInPlace(sheet, options = {}, drawn = null) {
  if (!drawn || options.renderContext !== 'updateActor') return null;
  const changed = options.renderData;
  if (!changed || typeof changed !== 'object' || Array.isArray(changed)) return null;

  const el = sheet.element?.[0] ?? sheet.element;
  if (!el?.querySelector) return null;

  const now = snapshot(sheet.actor);
  const paths = [...new Set([
    ...Object.keys(foundry.utils.flattenObject(changed)),
    ...differences(drawn, now)
  ])].filter((p) => !IGNORED.has(p.split('.')[0]));
  if (!paths.length) return now;

  /* Every path has to be claimed before anything is drawn: a change that is
     half ours would otherwise leave the rest of it stale. */
  const work = new Map();
  for (const path of paths) {
    const rule = RULES.find((r) => r.owns(path, sheet));
    if (!rule) return null;
    if (!work.has(rule)) work.set(rule, []);
    work.get(rule).push(path);
  }

  for (const [rule, owned] of work) {
    if (!rule.apply(sheet, el, owned)) return null;
  }
  return now;
}
