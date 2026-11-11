import { AM } from '../am.js';

/**
 * The graphics card dropping the scene, a dead dice box, a page that loads
 * again by itself: what is done about each on this client, and a record of them.
 *
 * Reported 2026-11-10, with screenshots: the GM's weak laptop, a fight, players
 * connected - "every round the page reloaded, or stopped counting, or showed a
 * white screen; the game fell apart". The console showed every WebGL context of
 * the page lost at once (the browser's graphics process failing, not one
 * canvas), then Dice So Nice unable to make a new one. Foundry says and does
 * nothing on a lost context. On a copy of the world:
 *   - with no context to be had, Dice So Nice's box does not come up again, and
 *     every roll's chat card after that stays hidden behind an animation that
 *     never runs - "stopped counting";
 *   - Foundry loads the page again whenever the server connection was down for
 *     five seconds or more, without a word of why - "the page reloaded";
 *   - a page that comes up with no WebGL at all (the browser refusing after
 *     repeated losses) only says "WebGL is not supported".
 *
 * So, on this client only:
 *   - a lost scene is said in words; when the browser gives graphics back after
 *     a real loss the scene is drawn again; when it does not, that is said, with
 *     what does help;
 *   - a dead dice box no longer holds the rolls: its held cards are shown and 3D
 *     dice stay off until the page loads again;
 *   - "light graphics", this computer's own setting and off until someone turns
 *     it on, turns Foundry down in one step and puts it back as it was. Nothing
 *     offers it or turns anything off on its own: "don't switch it all off to
 *     save, I can't play like that" (2026-11-11);
 *   - a record is kept across reloads - graphics lost and back, the connection
 *     dropping, a page that ended without closing, long stalls, memory - for
 *     a5eMancer.sessionReport(), so that the next failure comes with its cause.
 */
export class GraphicsGuard {

  static KEY = `${AM.ID}.session`;
  static MAX_EVENTS = 70;

  /* What light graphics sets, and core's names for it */
  static LIGHT = [
    ['core', 'performanceMode', 0],
    ['core', 'maxFPS', 30],
    ['core', 'pixelRatioResolutionScaling', false],
    ['core', 'lightAnimation', false]
  ];

  static #installed = false;
  static #state = { events: [], beat: 0, clean: false, why: '', opened: 0 };
  static #before = null;        // what the page before this one left behind
  static #views = new WeakSet();
  static #lostAt = 0;
  static #lostTimer = null;
  static #redrawing = null;
  static #dropAt = 0;
  static #diceSeen = new WeakMap();
  static #diceOff = false;
  static #stalls = [];
  static #lastStallNote = 0;
  static #peak = { heap: 0, nodes: 0 };

  static get on() {
    try { return game.settings.get(AM.ID, 'graphicsGuard') !== false; }
    catch { return true; }
  }

  static get light() {
    try { return game.settings.get(AM.ID, 'lightGraphics') === true; }
    catch { return false; }
  }

  /** At ready. */
  static install() {
    if (this.#installed || !this.on) return;
    this.#installed = true;
    this.#open();
    this.#aboutLastPage();
    this.#watchSocket();
    this.#watchBoard();
    Hooks.on('canvasReady', () => this.#watchBoard());
    this.#watchStalls();
    this.#noScene();
    setInterval(() => this.#beat(), 15000);
    setInterval(() => this.#watchDice(), 4000);
    window.addEventListener('pagehide', () => { this.#state.clean = true; this.#save(); });
    window.addEventListener('unhandledrejection', (event) => {
      if (!/Error creating WebGL context/i.test(String(event.reason?.message ?? event.reason))) return;
      this.note('graphics', 'something asked the browser for a graphics context and was given none');
    });
  }

  /* ── The record ─────────────────────────────────────── */

  static #where() {
    const combat = game.combat;
    return combat?.started ? `round ${combat.round}, turn ${(combat.turn ?? 0) + 1}` : '';
  }

  /** One line of the record. */
  static note(kind, text) {
    const events = this.#state.events;
    events.push({ t: Date.now(), k: kind, x: text, w: this.#where() });
    if (events.length > this.MAX_EVENTS) events.splice(0, events.length - this.MAX_EVENTS);
    this.#save();
  }

  static #save() {
    try { localStorage.setItem(this.KEY, JSON.stringify(this.#state)); } catch { /* storage blocked or full */ }
  }

  /** This page starts its part of the record, after what the last one left. */
  static #open() {
    try { this.#before = JSON.parse(localStorage.getItem(this.KEY) ?? 'null'); } catch { this.#before = null; }
    const events = Array.isArray(this.#before?.events) ? this.#before.events.slice(-this.MAX_EVENTS) : [];
    this.#state = { events, beat: Date.now(), clean: false, why: '', opened: Date.now() };
    this.note('page', 'opened');
  }

  /** Why the page before this one ended, said when it was only minutes ago. */
  static #aboutLastPage() {
    const last = this.#before;
    if (!last?.beat || Date.now() - last.beat > 3 * 60 * 1000) return;
    const at = new Date(last.beat).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (last.why) {
      this.note('page', `Foundry loaded the page again: ${last.why}`);
      ui.notifications.info(game.i18n.format('am.graphics.reloaded', { at, why: last.why }));
    } else if (!last.clean) {
      this.note('page', 'the page before this one ended without closing: the tab crashed, or the browser threw it out');
      ui.notifications.warn(game.i18n.format('am.graphics.crashed', { at }));
    }
  }

  static #beat() {
    this.#state.beat = Date.now();
    const heap = performance.memory?.usedJSHeapSize ?? 0;
    const nodes = document.getElementsByTagName('*').length;
    this.#peak.heap = Math.max(this.#peak.heap, heap);
    this.#peak.nodes = Math.max(this.#peak.nodes, nodes);
    this.#save();
  }

  /** Stalls of the page: a task that held it for a second or more. */
  static #watchStalls() {
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.duration < 1000) continue;
          this.#stalls.push({ t: Date.now(), ms: Math.round(entry.duration), w: this.#where() });
          this.#stalls.sort((a, b) => b.ms - a.ms);
          this.#stalls.length = Math.min(this.#stalls.length, 6);
          // In the record only the long ones, and not a flood of them
          if (entry.duration >= 3000 && Date.now() - this.#lastStallNote > 20000) {
            this.#lastStallNote = Date.now();
            this.note('stall', `the page did not respond for ${(entry.duration / 1000).toFixed(1)} s`);
          }
        }
      }).observe({ entryTypes: ['longtask'] });
    } catch { /* a browser without long-task timing */ }
  }

  /* ── The connection ─────────────────────────────────── */

  /**
   * Foundry's own handlers run first and, after five seconds or more without
   * the server, load the page again a quarter of a second later. This writes
   * down why before it does.
   */
  static #watchSocket() {
    const socket = game.socket;
    if (!socket?.on) return;
    socket.on('disconnect', (reason) => {
      this.#dropAt = Date.now();
      this.note('connection', `lost (${reason})`);
    });
    socket.io?.on?.('reconnect', () => {
      const seconds = (Date.now() - (this.#dropAt || Date.now())) / 1000;
      const reload = seconds >= 5;
      this.note('connection', `back after ${seconds.toFixed(1)} s${reload ? '; Foundry loads the page again after 5 s or more' : ''}`);
      if (reload) {
        this.#state.why = `the connection to the server was lost for ${Math.round(seconds)} seconds`;
        this.#save();
      }
    });
  }

  /* ── The scene's graphics ───────────────────────────── */

  static #gl() {
    return canvas?.app?.renderer?.gl ?? null;
  }

  static #watchBoard() {
    const view = canvas?.app?.view;
    if (!view?.addEventListener || this.#views.has(view)) return;
    this.#views.add(view);
    view.addEventListener('webglcontextlost', () => this.#onLost());
    view.addEventListener('webglcontextrestored', () => this.#onBack());
  }

  static #onLost() {
    this.#lostAt = Date.now();
    this.note('graphics', `the scene's graphics were lost${this.#load()}`);
    ui.notifications.warn(game.i18n.localize('am.graphics.lost'));
    clearTimeout(this.#lostTimer);
    this.#lostTimer = setTimeout(() => this.#stillLost(), 10000);
  }

  static #onBack() {
    const seconds = (Date.now() - (this.#lostAt || Date.now())) / 1000;
    clearTimeout(this.#lostTimer);
    this.#lostTimer = null;
    this.note('graphics', `the scene's graphics came back after ${seconds.toFixed(1)} s`);
    /* A context PIXI takes straight back needs nothing: the next frame draws
       it all (tried). A real loss leaves what was drawn off-screen - fog,
       lighting, the cached scene - empty, and nothing asks for it again. */
    if (seconds >= 1) this.#redraw();
    ui.notifications.info(game.i18n.localize('am.graphics.back'));
  }

  static #redraw() {
    if (this.#redrawing || !canvas?.scene) return;
    this.#redrawing = (async () => {
      try {
        await canvas.draw();
        this.note('graphics', 'the scene was drawn again');
      } catch (err) {
        this.note('graphics', `the scene could not be drawn again: ${err?.message ?? err}`);
      } finally { this.#redrawing = null; }
    })();
  }

  static #stillLost() {
    this.#lostTimer = null;
    if (!this.#gl()?.isContextLost?.()) return;
    this.note('graphics', 'ten seconds on, the browser has not given the scene\'s graphics back');
    ui.notifications.error(game.i18n.localize('am.graphics.gone'), { permanent: true });
  }

  /** A page that came up with no scene at all, though it was meant to have one. */
  static #noScene() {
    let wanted = true;
    try { wanted = !game.settings.get('core', 'noCanvas'); } catch { /* core's setting, always there */ }
    if (!wanted || canvas?.app?.renderer) return;
    this.note('graphics', 'this page came up with no scene: the browser gave it no WebGL');
    const recent = (this.#before?.events ?? []).some(e => e.k === 'graphics' && /lost|given none/.test(e.x) && Date.now() - e.t < 15 * 60 * 1000);
    if (recent) ui.notifications.error(game.i18n.localize('am.graphics.refused'), { permanent: true });
  }

  /** What the page was carrying when the graphics went: for the record. */
  static #load() {
    try {
      const heap = performance.memory?.usedJSHeapSize;
      const parts = [];
      if (heap) parts.push(`heap ${Math.round(heap / 1048576)} MB`);
      parts.push(`${document.getElementsByTagName('*').length} elements`);
      const mb = this.#textureMB();
      if (mb) parts.push(`about ${mb} MB of textures`);
      return ` (${parts.join(', ')})`;
    } catch { return ''; }
  }

  static #textureMB() {
    const list = canvas?.app?.renderer?.texture?.managedTextures ?? [];
    let bytes = 0;
    for (const t of list) bytes += (t.realWidth || 0) * (t.realHeight || 0) * 4 * (t.mipmap ? 1.33 : 1);
    return Math.round(bytes / 1048576);
  }

  /* ── Dice So Nice ───────────────────────────────────── */

  /**
   * Dice So Nice hides a roll's card until its animation ends. A box that never
   * came up (no context to be had) animates nothing, so the cards stay hidden
   * and the initiative stays masked. Its held cards are shown, and it is told
   * not to take any more (messageHookDisabled, its own switch for other
   * modules) until the page loads again. One card stuck behind a working box is
   * shown alone. A throw waiting for a player's hand is left to wait.
   */
  static #watchDice() {
    const dice = game.dice3d;
    if (!dice || this.#diceOff) return;
    const held = game.messages.contents.slice(-30).filter(m => m._dice3danimating);
    if (!held.length) return;
    const now = Date.now();
    for (const m of held) if (!this.#diceSeen.has(m)) this.#diceSeen.set(m, now);
    const dead = !dice.box?.initialized;
    const stuck = held.filter(m => now - this.#diceSeen.get(m) >= (dead ? 8000 : 45000) && !dice.pendingThrows?.isPending?.(m.id));
    if (!stuck.length) return;
    if (dead) {
      this.#diceOff = true;
      dice.messageHookDisabled = true;
      for (const m of held) this.#show(dice, m);
      this.note('dice', `Dice So Nice has no dice box (the browser gave it no graphics): ${held.length} held roll(s) shown, 3D dice off until the page loads again`);
      ui.notifications.warn(game.i18n.localize('am.graphics.dice-off'), { permanent: true });
    } else {
      for (const m of stuck) this.#show(dice, m);
      this.note('dice', `${stuck.length} roll(s) held by Dice So Nice for 45 s were shown`);
    }
    try { ui.combat?.render?.(); } catch { /* the tracker draws itself soon enough */ }
  }

  static #show(dice, message) {
    for (let i = 0; i < 6 && message._dice3danimating; i++) {
      try { dice.pipeline?._revealMessage?.(message); } catch { break; }
    }
    delete message._dice3danimating;
    message._dice3dPendingRenders = 0;
    message._dice3dMessageHidden = false;
    for (const el of document.querySelectorAll(`.message[data-message-id="${message.id}"]`)) {
      el.classList.remove('dsn-hide');
      el.querySelectorAll('.dsn-hide').forEach(part => part.classList.remove('dsn-hide'));
    }
  }

  /* ── Light graphics ─────────────────────────────────── */

  /**
   * Turn Foundry down on this computer, or put it back: core's performance
   * mode, frame rate, resolution scaling and animated lights, which are this
   * browser's own settings. What they were is kept, and comes back when the
   * setting is turned off. The 3D dice are shadeDice's.
   */
  static #lightQueue = Promise.resolve();
  static setLight(on) {
    /* One at a time: a second call made while the first is still writing would
       read nothing kept yet, and keep the light values as what to put back. */
    const run = this.#lightQueue.then(() => this.#setLight(on));
    this.#lightQueue = run.catch(() => {});
    return run;
  }

  static async #setLight(on) {
    const kept = foundry.utils.deepClone(game.settings.get(AM.ID, 'lightGraphicsBefore') ?? {});
    const applied = Object.keys(kept).length > 0;
    if (on) {
      if (applied) return;
      for (const [scope, key, value] of this.LIGHT) {
        try {
          kept[`${scope}.${key}`] = game.settings.get(scope, key);
          await game.settings.set(scope, key, value);
        } catch (err) { AM.log(2, `Light graphics: ${scope}.${key} could not be set`, err); }
      }
      await game.settings.set(AM.ID, 'lightGraphicsBefore', kept);
      if (this.#installed) this.note('graphics', 'light graphics turned on');
      return;
    }
    if (!applied) return;
    for (const [scope, key] of this.LIGHT) {
      const id = `${scope}.${key}`;
      if (!(id in kept)) continue;
      try { await game.settings.set(scope, key, kept[id]); }
      catch (err) { AM.log(2, `Light graphics: ${id} could not be put back`, err); }
    }
    await game.settings.set(AM.ID, 'lightGraphicsBefore', {});
    if (this.#installed) this.note('graphics', 'light graphics turned off');
  }

  /**
   * No 3D dice on this computer while light graphics is on. Dice So Nice keeps
   * a user's choices on the user, so "show no dice" written there would follow
   * the GM to every computer. It is set on this page's copy of the user alone,
   * and never saved: Dice So Nice reads it when it builds its dice box at
   * ready, makes none, and takes no rolls. At setup, when the user is there.
   */
  static shadeDice() {
    if (!this.light || !game.modules.get('dice-so-nice')?.active || !game.user) return;
    try { game.user.updateSource({ 'flags.dice-so-nice.settings.visibility': 'none' }); }
    catch (err) { AM.log(2, 'Light graphics: the 3D dice could not be left off', err); }
  }

  /* ── The report ─────────────────────────────────────── */

  /** a5eMancer.sessionReport() in the console. */
  static report() {
    const clock = (t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const mb = (n) => (n ? `${Math.round(n / 1048576)} MB` : '?');
    const lines = [];
    lines.push(`a5e-mancer ${game.modules.get(AM.ID)?.version} | Foundry ${game.version} | ${game.system?.id} ${game.system?.version} | ${game.modules.filter(m => m.active).length} modules | ${game.user?.name}${game.user?.isGM ? ' (GM)' : ''}`);
    lines.push(`computer: ${navigator.hardwareConcurrency ?? '?'} threads, ${navigator.deviceMemory ?? '?'} GB (as the browser states it), screen ${screen.width}x${screen.height} at ${window.devicePixelRatio}x`);
    const gl = this.#gl();
    if (gl) {
      let card = '?';
      try { card = foundry.applications.sidebar.apps.SupportDetails.getWebGLRendererInfo(gl); } catch { /* not told */ }
      const perf = canvas.performance ?? {};
      lines.push(`graphics: ${card}; context ${gl.isContextLost() ? 'LOST' : 'alive'}; largest texture ${gl.isContextLost() ? '?' : gl.getParameter(gl.MAX_TEXTURE_SIZE)}`);
      lines.push(`Foundry's settings here: performance mode ${perf.mode}, ${perf.fps || 'no'} fps cap, drawing at ${canvas.app.renderer.resolution}x; light graphics ${this.light ? 'ON' : 'off'}; 3D dice ${game.dice3d ? (this.#diceOff ? 'switched off after a failure' : (game.dice3d.box?.initialized ? 'on' : 'no dice box')) : 'not installed'}`);
      if (canvas.scene) lines.push(`scene: ${canvas.scene.name}, ${canvas.dimensions?.width}x${canvas.dimensions?.height}, ${canvas.tokens?.placeables?.length ?? 0} tokens; about ${this.#textureMB()} MB of textures on the card`);
    } else {
      lines.push('graphics: this page has no scene (no WebGL was given, or the canvas is switched off)');
    }
    const heap = performance.memory?.usedJSHeapSize ?? 0;
    const nodes = document.getElementsByTagName('*').length;
    lines.push(`this page: opened ${clock(this.#state.opened)}; heap ${mb(heap)} (most ${mb(Math.max(this.#peak.heap, heap))}); ${nodes} elements (most ${Math.max(this.#peak.nodes, nodes)})`);
    if (this.#stalls.length) lines.push(`longest stalls: ${this.#stalls.map(s => `${(s.ms / 1000).toFixed(1)} s at ${clock(s.t)}${s.w ? ` (${s.w})` : ''}`).join('; ')}`);
    lines.push('record, oldest first:');
    for (const e of this.#state.events) lines.push(`  ${clock(e.t)}  ${e.k}: ${e.x}${e.w ? `  [${e.w}]` : ''}`);
    const text = lines.join('\n');
    console.log(text);
    return text;
  }
}
