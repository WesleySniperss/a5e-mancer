/**
 * canvas-pointer-guard.js — a5e-mancer
 *
 * Defensive guard for a canvas-wide failure that is NOT caused by this module.
 *
 * Foundry keeps exactly one listener on canvas.stage that updates
 * canvas.mousePosition (board.mjs, Canvas##addListeners):
 *
 *     this.stage.on("pointermove", event => {
 *       event.getLocalPosition(this.stage, this.mousePosition);
 *       ...
 *     });
 *
 * Some module removes it — most likely via `canvas.stage.off("pointermove")`
 * with no handler argument, which in eventemitter3 clears EVERY listener for
 * that event (`if (!fn) clearEvent(this, evt)`), not just its own.
 *
 * Once it is gone, canvas.mousePosition freezes at whatever it last held. That
 * is invisible on its own, but any consumer reading it then works off a dead
 * point. Mass Edit (multi-token-edit) patches Token hitArea.contains to do
 * pixel-perfect hover via `mesh.containsCanvasPoint(canvas.mousePosition, ...)`,
 * so with a frozen position EVERY token fails hit-testing: tokens cannot be
 * clicked directly, while marquee selection still works because it tests bounds
 * rather than hit areas.
 *
 * Diagnosed by observing listenerCount("pointermove") === 0 alongside a
 * mousePosition that never changed while the mouse moved.
 *
 * This file restores the listener when it disappears, and reports who removed
 * it. It is a workaround, not a fix: the module responsible still needs to pass
 * its own handler to .off().
 */

const TAG = "a5e-mancer | pointer-guard";
const CHECK_MS = 1000;

/** Last captured removal, readable later via a5eMancerPointerGuard.lastCulprit. */
let lastCulprit = null;

/**
 * Surface something the user must not miss. Permanent notifications stay on
 * screen until dismissed, which matters here: the culprit reveals itself once,
 * possibly while the user is looking elsewhere, and the stack is only in the
 * console.
 */
function notifyOnScreen(message) {
  try { ui.notifications?.warn(` | `, { permanent: true, console: false }); }
  catch (_) { /* notifications may not exist yet during early init */ }
}

let intervalId = null;
let patched = false;

/** Re-attach a minimal replacement for core's position updater. */
function restoreListener() {
  const stage = canvas?.stage;
  if (!stage) return;
  stage.on("pointermove", event => {
    event.getLocalPosition(stage, canvas.mousePosition);
  });
  console.warn(`${TAG} | canvas.stage lost its "pointermove" listener — restored it. `
    + `Token clicking should work again. Reload (F5) to restore core's full handler chain.`);
  notifyOnScreen("Клікання по токенах було зламане — відновлено. Подробиці в консолі (F12).");
}

/**
 * Report — with a stack trace — whoever clears every listener for an event.
 * Wraps rather than blocks: suppressing the call could break the caller's own
 * cleanup, and the goal here is to identify it, not to fight it.
 */
function instrumentStage() {
  const stage = canvas?.stage;
  if (!stage || stage.__a5eMancerGuarded) return;
  stage.__a5eMancerGuarded = true;

  // Core itself calls stage.removeAllListeners() at the top of Canvas##addListeners
  // and immediately re-registers everything, so a removal is not by itself a
  // fault. Record it, then check on the next tick whether the pointermove
  // listener actually came back — only a removal that sticks is worth reporting.
  const record = (what, stack) => {
    setTimeout(() => {
      if (canvas?.stage?.listenerCount?.("pointermove") !== 0) return;  // benign
      lastCulprit = { what, stack, at: new Date().toLocaleTimeString() };
      console.warn(`${TAG} | ${what}\nStack:\n${stack}`);
      notifyOnScreen(`ЗНАЙДЕНО ВИНУВАТЦЯ: ${what}. Стек у консолі (F12), `
        + `або введи a5eMancerPointerGuard.lastCulprit`);
    }, 0);
  };

  const off = stage.off.bind(stage);
  stage.off = function(event, fn, ...rest) {
    if (!fn) {
      record(`хтось зняв УСІ слухачі "${event}" зі stage`, new Error().stack);
    }
    return off(event, fn, ...rest);
  };

  const removeAll = stage.removeAllListeners.bind(stage);
  stage.removeAllListeners = function(event, ...rest) {
    record(`викликано stage.removeAllListeners(${event ?? "усі події"})`, new Error().stack);
    return removeAll(event, ...rest);
  };
  patched = true;
}

function start() {
  stop();
  instrumentStage();
  intervalId = setInterval(() => {
    if (!canvas?.ready || !canvas.stage) return;
    if (canvas.stage.listenerCount?.("pointermove") === 0) restoreListener();
  }, CHECK_MS);
}

function stop() {
  if (intervalId) clearInterval(intervalId);
  intervalId = null;
}

Hooks.on("canvasReady", start);
Hooks.on("canvasTearDown", stop);
if (globalThis.canvas?.ready) start();

// Manual check, for when the symptom appears and you want the state.
globalThis.a5eMancerPointerGuard = {
  status: () => ({
    listeners: canvas?.stage?.listenerCount?.("pointermove"),
    mousePosition: canvas ? { ...canvas.mousePosition } : null,
    instrumented: patched,
    watching: intervalId !== null,
  }),
  restore: restoreListener,
  get lastCulprit() { return lastCulprit; },
};
