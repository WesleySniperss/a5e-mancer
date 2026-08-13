import { AM } from '../a5e-mancer.js';
import { MagicManeuverService } from '../utils/magicManeuverService.js';
import { MagicManeuvers, MM_SCHOOLS, MM_SCHOOL_LORE } from '../data/magicManeuvers.js';

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Manage a character's magic maneuvers from the sheet, at any time.
 *
 * This is the counterpart to ManeuverDialog and deliberately works the same way:
 * open it whenever, change your mind about anything, the entitlement is shown
 * rather than enforced by hiding, and a GM can lift the caps for homebrew or to
 * correct a mistake. Magic maneuvers were previously editable only during a
 * level-up, which made them the one thing on the sheet you could not revise —
 * there is nothing in the rules that asks for that.
 *
 * Nothing is written until Save, so backing out costs nothing.
 */
export class MagicManeuverDialog extends HandlebarsApplicationMixin(ApplicationV2) {

  constructor(actor, options = {}) {
    super(options);
    this.actor = actor;

    const state = MagicManeuverService.stateOf(actor);
    this._schools  = new Set(state.openSchools);
    this._known    = new Set(state.knownIds);
    this._unlocked = false;          // GM override for the caps
    this._search   = '';
    this._searchFocused = false;
    this._openLore = new Set();      // schools whose description is expanded
  }

  static DEFAULT_OPTIONS = {
    id: 'a5e-magic-maneuver-dialog',
    tag: 'div',
    classes: ['am-app', 'am-mm-dialog'],
    position: { width: 760, height: 620 },
    window: { icon: 'fa-solid fa-wand-sparkles', resizable: true, minimizable: false },
    actions: {
      mmToggleSchool:   MagicManeuverDialog.toggleSchool,
      mmToggleManeuver: MagicManeuverDialog.toggleManeuver,
      mmToggleLore:     MagicManeuverDialog.toggleLore,
      mmToggleUnlock:   MagicManeuverDialog.toggleUnlock,
      mmSave:           MagicManeuverDialog.save,
      mmCancel:         MagicManeuverDialog.cancel
    }
  };

  static PARTS = {
    main: {
      template:   'modules/a5e-mancer/templates/magic-maneuver-dialog.hbs',
      scrollable: ['', '.am-mmd-body']
    }
  };

  get title() {
    const label = game.i18n.localize('am.mm.manage-title');
    return this.actor ? `${label} — ${this.actor.name}` : label;
  }

  async _prepareContext() {
    const level = MagicManeuverService.maneuverLevel(this.actor);
    const row   = MagicManeuvers.progressionAt(level);
    const search = this._search.trim().toLowerCase();

    const schools = Object.entries(MM_SCHOOLS).map(([key, label]) => {
      const open = this._schools.has(key);
      return {
        key, label,
        open,
        lore:     MM_SCHOOL_LORE[key] ?? '',
        loreOpen: this._openLore.has(key),
        count:    [...this._known].filter(id => MagicManeuvers.byId(id)?.school === key).length,
        // Closing a school you have maneuvers from would strand them, so say so
        // instead of letting the click quietly drop several picks.
        holds:    [...this._known].some(id => MagicManeuvers.byId(id)?.school === key)
      };
    });

    const groups = [];
    for (const [key, label] of Object.entries(MM_SCHOOLS)) {
      const maneuvers = MagicManeuvers.bySchool(key)
        .filter(m => !search || m.name.toLowerCase().includes(search)
                              || (m.effect ?? '').toLowerCase().includes(search))
        .map(m => ({
          ...m,
          known:       this._known.has(m.id),
          schoolOpen:  this._schools.has(key),
          degreeOk:    this._unlocked || m.degree <= row.maxDegree,
          // Selectable is about this click, so a known one is always selectable
          // (you can always give it back)
          selectable:  this._unlocked || this._known.has(m.id)
                       || (this._schools.has(key) && m.degree <= row.maxDegree)
        }));
      if (maneuvers.length) groups.push({ key, label, maneuvers });
    }

    return {
      actor:       this.actor,
      level,
      unlocked:    this._unlocked,
      isGM:        game.user.isGM,
      search:      this._search,
      schools,
      groups,
      schoolsUsed: this._schools.size,
      schoolsMax:  row.schools,
      knownUsed:   this._known.size,
      knownMax:    row.known,
      maxDegree:   row.maxDegree,
      exertion:    MagicManeuverService.exertionPool(this.actor),
      dc:          MagicManeuverService.saveDC(this.actor),
      overSchools: this._schools.size > row.schools,
      overKnown:   this._known.size  > row.known,
      // Below the level the first ones arrive at, the answer is "not yet"
      tooEarly:    row.known <= 0
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    const input = this.element?.querySelector('.am-mmd-search');
    if (!input) return;

    input.addEventListener('input', (e) => {
      this._search = e.target.value ?? '';
      this._searchFocused = true;
      this.render(false);
    });

    // Filtering re-renders the whole part, which replaces the input the player is
    // typing into — without this the field loses focus after the first letter.
    if (this._searchFocused) {
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    }
  }

  /* ── actions ──────────────────────────────────────────────
     ApplicationV2 invokes these with `this` bound to the instance, so they read
     the dialog they belong to rather than a module-level handle — two sheets can
     be open at once without one editing the other's picks. */

  static toggleSchool(_event, btn) {
    const key = btn.dataset.school;
    if (!key) return;

    if (this._schools.has(key)) {
      // Dropping a school takes its maneuvers with it — they would otherwise sit
      // in the known list with no school backing them.
      const orphans = [...this._known].filter(id => MagicManeuvers.byId(id)?.school === key);
      this._schools.delete(key);
      for (const id of orphans) this._known.delete(id);
      if (orphans.length) {
        ui.notifications.info(game.i18n.format('am.mm.school-closed', { n: orphans.length }));
      }
    } else {
      const row = MagicManeuvers.progressionAt(MagicManeuverService.maneuverLevel(this.actor));
      if (!this._unlocked && this._schools.size >= row.schools) {
        ui.notifications.warn(game.i18n.format('am.mm.no-school-slots-n', { n: row.schools }));
        return;
      }
      this._schools.add(key);
    }
    this.render(false);
  }

  static toggleManeuver(_event, btn) {
    const id = btn.dataset.maneuver;
    if (!id) return;

    // Giving one back is never gated — that is the freedom this dialog exists for
    if (this._known.has(id)) { this._known.delete(id); this.render(false); return; }

    const maneuver = MagicManeuvers.byId(id);
    if (!maneuver) return;

    if (!this._unlocked) {
      const row = MagicManeuvers.progressionAt(MagicManeuverService.maneuverLevel(this.actor));
      if (!this._schools.has(maneuver.school)) {
        ui.notifications.warn(game.i18n.localize('am.mm.reason.school-not-open'));
        return;
      }
      if (maneuver.degree > row.maxDegree) {
        ui.notifications.warn(game.i18n.localize('am.mm.reason.degree-too-high'));
        return;
      }
      if (this._known.size >= row.known) {
        ui.notifications.warn(game.i18n.format('am.mm.no-slots', { n: row.known }));
        return;
      }
    }
    this._known.add(id);
    this.render(false);
  }

  static toggleLore(_event, btn) {
    const key = btn.dataset.school;
    if (!key) return;
    if (this._openLore.has(key)) this._openLore.delete(key);
    else this._openLore.add(key);
    this.render(false);
  }

  static toggleUnlock() {
    if (!game.user.isGM) return;
    this._unlocked = !this._unlocked;
    this.render(false);
  }

  static async save() {
    try {
      const { dropped } = await MagicManeuverService.setState(
        this.actor,
        { openSchools: [...this._schools], knownIds: [...this._known] },
        { force: this._unlocked }
      );
      if (dropped.length) {
        ui.notifications.warn(game.i18n.format('am.mm.dropped', { n: dropped.length }));
      }
      this.close();
    } catch (err) {
      AM.log(1, 'Could not save magic maneuvers:', err);
      ui.notifications.error(`${AM.NAME}: the magic maneuvers could not be saved — see the console.`);
    }
  }

  static cancel() {
    this.close();
  }
}
