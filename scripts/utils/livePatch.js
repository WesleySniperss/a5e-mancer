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
 * set in place and the redraw is skipped; where anything else changed — a new
 * item, a class, a name, a flag nobody here claims — the sheet redraws as before.
 * An item's own update ("updateitems") is read the same way, its paths as
 * items.<id>.<path>, and a change of conditions (the effects a5e writes at 0 hit
 * points) by the statuses it moves.
 *
 * The rules read their values off the ACTOR, never out of the diff: a write of
 * `system.attributes.hp.value` may be clamped, and `baseMax` moves the derived
 * `max`. The diff decides only whether the change is one we can draw.
 *
 * Adding a rule: name the paths it owns, and return false from apply() for any
 * change of SHAPE — a block that appears or disappears, a row count that moves.
 * Only a number, a class or an attribute may be set here - so a block that
 * comes and goes with a value (the death-save panel) is drawn always and shown
 * by a class. tools/checks/livepatch.mjs holds the patched sheet against a full redraw of the same
 * actor, in the browser, and any difference is a failed check.
 */

import { ArmorClass } from './armorClass.js';

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

/** A class attribute written in the template's order, the falsy entries dropped. */
const setClassName = (el, parts) => {
  if (!el) return;
  const value = parts.filter(Boolean).join(' ');
  if (el.className !== value) el.className = value;
};

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
    /* The death-save panel opens at 0 and shuts on a heal, which also clears
       the tally (a5e): classes and a word, set by drawDeathSaves. */
    if (!drawDeathSaves(sheet, el)) return false;

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
 * The death-save panel over the portrait, and the portrait under it: open at
 * 0 hit points, the pips lit to the tally, dead or stable, and the word for it.
 * Every class is rebuilt in the template's order, so a patched panel and a
 * redrawn one are the same markup. A sheet without the panel - a monster's -
 * has nothing here to draw.
 */
function drawDeathSaves(sheet, el) {
  const panel = el.querySelector('.actor-vitals-container .am-death-saves');
  if (!panel) return true;
  const ds = sheet.liveDeathSaves?.();
  if (!ds) return false;

  setClassName(panel, ['am-death-saves', ds.open && 'open', ds.dead ? 'dead' : (ds.stable && 'stable')]);
  const image = el.querySelector('.actor-vitals-container .actor-image');
  if (image) {
    const base = [...image.classList].filter((c) => c !== 'am-dying' && c !== 'am-dead');
    setClassName(image, [...base, ds.open && 'am-dying', ds.dead && 'am-dead']);
  }
  for (const pip of panel.querySelectorAll('.am-ds-pip')) {
    const list = pip.dataset.kind === 'failure' ? ds.failures : ds.successes;
    setClassName(pip, ['am-ds-pip', list[num(pip.dataset.count) - 1]?.checked && 'checked']);
  }
  setText(panel.querySelector('.am-ds-state'), ds.label);
  return true;
}

/** The death-save tally: a pip clicked, a roll made. */
const deathSaves = {
  owns: (path) => path === 'system.attributes.death' || path.startsWith('system.attributes.death.'),
  apply: (sheet, el) => drawDeathSaves(sheet, el)
};

/**
 * Conditions: the tiles lit in the Traits sidebar. a5e puts a character under
 * Unconscious and Incapacitated at 0 hit points and takes them off on a heal -
 * four writes of effects, each a redraw before. The Effects tab leaves
 * conditions out, so the tiles are all that show them; see EFFECTS below.
 */
const conditions = {
  owns: (path) => path === 'statuses',
  apply(sheet, el) {
    const active = sheet.liveActiveConditions?.();
    if (!active) return false;
    for (const tile of el.querySelectorAll('.conditions-list .condition[data-condition-id]')) {
      const on = active.has(tile.dataset.conditionId);
      setClassName(tile, ['condition', on && 'active']);
      setAttr(tile.querySelector('[data-action="toggle-condition"]'), 'aria-pressed', on ? 'true' : 'false');
    }
    return true;
  }
};

/** Armour class: the figure on the shield - a field while unlocked - and the
    breakdown its tooltip carries. */
const armorClass = {
  owns: (path) => path === 'system.attributes.ac' || path.startsWith('system.attributes.ac.'),
  apply(sheet, el) {
    const value = el.querySelector('.ac-container .ac-value');
    if (!value) return false;
    const ac = sheet.actor.system?.attributes?.ac;
    const figure = ac?.value ?? ac ?? 10;
    if (value.tagName === 'INPUT') setValue(value, figure);
    else setText(value, figure);
    setAttr(value.closest('.shield'), 'data-tooltip-html', ArmorClass.breakdown(sheet.actor));
    return true;
  }
};

/**
 * An item's state: equipped, damaged, prepared - the buttons on its rows
 * (Inventory and Favorites both draw it), the row's own classes, and what
 * those states feed: the carried weight (only what is carried counts) and the
 * prepared count. Picking a spell or equipping gear redrew the whole sheet;
 * "I click something and it all jumps up". The values come from the sheet's
 * own builders (liveItemState and the rest), so they cannot drift from getData.
 */
const ITEM_STATE = /^items\.([^.]+)\.system\.(equippedState|prepared|damagedState)$/;
const ROW_CLASSES = ['tidy-table-row', 'tidy-table-row-v2', 'equipped', 'attunement-problem', 'am-always-prepared', 'am-prepared'];
const itemStates = {
  owns: (path) => ITEM_STATE.test(path),
  apply(sheet, el, paths) {
    if (!sheet.liveItemState) return false;
    const ids = new Set(paths.map((p) => p.match(ITEM_STATE)[1]));
    const fields = new Set(paths.map((p) => p.match(ITEM_STATE)[2]));

    for (const id of ids) {
      const item = sheet.actor.items.get(id);
      if (!item) return false;
      const st = sheet.liveItemState(item);
      for (const box of el.querySelectorAll(`.tidy-table-row-container[data-item-id="${id}"]`)) {
        const row = box.querySelector(':scope > .tidy-table-row');
        if (row) {
          /* Only on the rows whose builder gives the state: a spell is drawn in
             four rows (Favorites and Magic, each with its action's row), and
             only the one with the prepare button wears am-prepared; equipped
             goes with the equip and damaged buttons the same way. */
          const want = {};
          if (box.querySelector('[data-action="item-equip"], [data-action="item-damaged"]')) want.equipped = st.equipped;
          if (box.querySelector('[data-action="item-prepare"]')) {
            want['am-always-prepared'] = st.alwaysPrepared;
            want['am-prepared'] = !st.alwaysPrepared && st.preparedOnly;
          }
          const runtime = [...row.classList].filter((c) => !ROW_CLASSES.includes(c));
          setClassName(row, [...ROW_CLASSES.filter((c) => (c in want ? want[c] : (c.startsWith('tidy-table-row') || row.classList.contains(c)))), ...runtime]);
        }
        const lit = (on) => (on ? 'color-icon-theme-highlight highlighted' : 'color-text-lightest');
        const equip = box.querySelector('[data-action="item-equip"]');
        if (equip) {
          setAttr(equip, 'aria-label', `Equipped state: ${st.equipLabel}`);
          setAttr(equip, 'data-tooltip', st.equipLabel);
          setClassName(equip.querySelector('i'), ['fa-solid', st.equipIcon, lit(st.equipActive)]);
        }
        const damaged = box.querySelector('[data-action="item-damaged"]');
        if (damaged) {
          setAttr(damaged, 'aria-label', `Condition: ${st.damagedLabel}`);
          setAttr(damaged, 'data-tooltip', st.damagedLabel);
          setClassName(damaged.querySelector('i'), ['fa-solid', st.damagedIcon, lit(st.damagedActive)]);
        }
        for (const prep of box.querySelectorAll('[data-action="item-prepare"]')) {
          setAttr(prep, 'aria-label', `Prepared state: ${st.preparedLabel}`);
          if (prep.classList.contains('am-prepare')) {
            setClassName(prep, ['button', 'button-borderless', 'button-icon-only', 'am-prepare', `am-prepare-${st.preparedState}`]);
            setAttr(prep, 'data-tooltip', `${st.preparedLabel} — click to change`);
            setClassName(prep.querySelector('i'), ['fa-solid', st.preparedIcon]);
          } else {
            setAttr(prep, 'data-tooltip', st.preparedLabel);
            setClassName(prep.querySelector('i'), ['fa-solid', st.preparedIcon, lit(st.prepared)]);
          }
        }
      }
    }

    if (fields.has('prepared')) {
      const count = el.querySelector('.am-prepared-count');
      const sp = sheet.liveSpellsPrepared?.();
      if (!!count !== !!sp) return false;
      if (count) {
        setClassName(count, ['am-prepared-count', sp.over && 'am-over']);
        setText(count.querySelector('.am-prepared-held'), sp.held);
        setText(count.querySelector('.am-prepared-cap'), sp.cap);
      }
    }
    if (fields.has('equippedState')) {
      const carried = el.querySelector('.am-carried .am-a5e-value');
      if (carried && sheet.liveCarried) setText(carried, sheet.liveCarried());
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

const RULES = [hitPoints, deathSaves, conditions, armorClass, itemStates, exertion, spellSlots];

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
 * What a render request writes, as paths: an actor's own update, an item's
 * (as items.<id>.<path>), or nothing for a change of conditions - whose effect
 * documents no rule draws, and whose consequence, the statuses, the snapshot
 * diff brings in. null when the request is of a kind no rule can answer.
 */
const EFFECTS = /^(create|update|delete)effects$/;
function writtenPaths(sheet, el, options) {
  const ctx  = options.renderContext;
  const data = options.renderData;
  if (ctx === 'updateActor') {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
    return Object.keys(foundry.utils.flattenObject(data));
  }
  if (ctx === 'updateitems') {
    if (!Array.isArray(data)) return null;
    const out = [];
    for (const change of data) {
      const id = change?._id;
      if (!id) return null;
      for (const key of Object.keys(foundry.utils.flattenObject(change))) {
        if (key === '_id' || key.startsWith('_stats.')) continue;
        out.push(`items.${id}.${key}`);
      }
    }
    return out;
  }
  /* A condition is an effect a5e marks effectType 'condition', and the Effects
     tab leaves those out. Any other effect is a row there - shape. One that is
     gone is judged by whether the tab still draws it. */
  if (EFFECTS.test(ctx ?? '')) {
    if (!Array.isArray(data)) return null;
    for (const entry of data) {
      const id = typeof entry === 'string' ? entry : entry?._id;
      if (!id) return null;
      const effect = sheet.actor.effects?.get(id);
      /* The armour class correction changing amount: its row draws a name,
         an icon and a switch, none of which moved; the figure it moves the
         snapshot brings in. Created or deleted, it is a row - shape. */
      if (effect && ctx === 'updateeffects' && ArmorClass.correction(sheet.actor) === effect
          && typeof entry === 'object'
          && Object.keys(foundry.utils.flattenObject(entry)).every((k) => k === '_id'
            || k.startsWith('_stats.') || k === 'system.changes' || k.startsWith('system.changes.'))) continue;
      if (effect ? effect.system?.effectType !== 'condition' : !!el.querySelector(`[data-effect-id="${id}"]`)) return null;
    }
    return [];
  }
  return null;
}

/**
 * Draw an update in place, or say that it needs a redraw.
 *
 * @param {object} sheet    the rendered v1 sheet
 * @param {object} options  the render options Foundry passed, carrying
 *                          renderContext and renderData
 * @param {object|null} drawn  the snapshot the sheet on screen was drawn from
 * @returns {object|null}  the snapshot the sheet now shows, when it shows the
 *                         change and no redraw is needed; null otherwise
 */
export function patchInPlace(sheet, options = {}, drawn = null) {
  if (!drawn) return null;
  const el = sheet.element?.[0] ?? sheet.element;
  if (!el?.querySelector) return null;

  const written = writtenPaths(sheet, el, options);
  if (!written) return null;

  const now = snapshot(sheet.actor);
  const paths = [...new Set([...written, ...differences(drawn, now)])]
    .filter((p) => !IGNORED.has(p.split('.')[0]));
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
