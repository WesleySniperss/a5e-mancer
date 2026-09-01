import { A5eCharacterSheet } from './A5eCharacterSheet.js';

const MODULE_ID = 'a5e-mancer';

/**
 * The illustrated layout, as a sheet in its own right.
 *
 * It inherits everything from A5eCharacterSheet — the same `getData`, the same
 * listeners, the same rolls — and overrides only the template and the window
 * geometry. So a fix to the working sheet reaches this one for free, and this
 * one cannot break that one.
 *
 * Registered alongside rather than replacing it, which is what puts it in
 * Foundry's own Sheet picker. That matters beyond tidiness: the choice is then
 * PER ACTOR, so a finished character can wear the illustrated page while the
 * one being built keeps the tabbed view — and it is remembered on the actor,
 * not in a client setting that swaps every sheet at once.
 *
 * A4 portrait. The page pins itself to the artwork's ratio in CSS, so this
 * only has to open near it.
 */
export class A5eIllustratedSheet extends A5eCharacterSheet {

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ['a5e-mancer-sheet', 'am-illustrated', 'sheet', 'actor'],
      template: `modules/${MODULE_ID}/templates/sheet/character-sheet-illustrated.hbs`,
      width: 780,
      height: 1040,
      // One page, no tabs: everything is on it at once, which is the point.
      tabs: []
    });
  }
}

/**
 * Registered here rather than from a5e-mancer.js, and that is not a style
 * choice — it is the only way this file can exist.
 *
 * `extends A5eCharacterSheet` runs the moment this module is evaluated, unlike
 * every other reference in this codebase, which sits inside a function and runs
 * later. a5e-mancer.js importing this file therefore closed a cycle at exactly
 * the wrong moment: A5eCharacterSheet.js loads first, imports `AM` from
 * a5e-mancer.js, which imported this file, which asked for A5eCharacterSheet
 * while it was still initialising — a ReferenceError that took the whole module
 * down with it.
 *
 * Loading from module.json after A5eCharacterSheet.js, and registering itself,
 * means a5e-mancer.js never has to name this file and the cycle never forms.
 */
Hooks.on('init', () => {
  Actors.registerSheet('a5e', A5eIllustratedSheet, {
    types: ['character'],
    makeDefault: false,
    label: 'A5e Mancer — Illustrated'
  });
});
