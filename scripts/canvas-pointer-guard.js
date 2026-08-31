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

  const off = stage.off.bind(stage);
  stage.off = function(event, fn, ...rest) {
    if (!fn) {
      console.warn(`${TAG} | something removed ALL "${event}" listeners from canvas.stage. `
        + `In eventemitter3, .off(event) without a handler clears every listener, not just `
        + `the caller's. Stack:\n${new Error().stack}`);
    }
    return off(event, fn, ...rest);
  };

  const removeAll = stage.removeAllListeners.bind(stage);
  stage.removeAllListeners = function(event, ...rest) {
    console.warn(`${TAG} | canvas.stage.removeAllListeners(${event ?? "all events"}) `
      + `was called. Stack:\n${new Error().stack}`);
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
};
