import { AM } from '../a5e-mancer.js';

/**
 * Bridge between the Your Flavor chat-styling module and Foundry's chat log.
 *
 * Two independent problems, two independent settings. Both are inert unless
 * Your Flavor is installed, active and booted.
 *
 * ── 1. a5e cards are never styled  (enableYourFlavor) ──────────────────────
 *
 * a5e's own renderChatMessageHTML hook DELETES .message-header and
 * .message-content from the <li>, puts .a5e-chat-card on that <li>, and mounts
 * a Svelte component in their place. Your Flavor's classifier opens with
 *
 *     const messageContent = html.querySelector('.message-content');
 *     if (!messageContent?.querySelector) return <unsupported, no fallback>;
 *
 * so every a5e item card, roll card and roll-table card is rejected before any
 * styling decision is reached, and none of them are themed.
 *
 * ── 2. Nothing already in the log is styled on v14  (enableYourFlavorRestyle)
 *
 * Foundry's chat list lost its #chat-log id in v14. Your Flavor's pass that
 * restyles the log after a reload gates on document.querySelector('#chat-log')
 * and returns early when it finds nothing, so on v14 every message already on
 * screen stays unstyled - for every system, not just a5e. Only messages that
 * arrive afterwards, through the render hook, get themed.
 *
 * ── Why the bridge lives here ─────────────────────────────────────────────
 *
 * Both are fixable inside Your Flavor, but Your Flavor is a module we do not
 * ship: a patch there lasts until its next update and reaches nobody else's
 * world. Here it is versioned and released with a5e-mancer.
 *
 * ── How it decides ────────────────────────────────────────────────────────
 *
 * Your Flavor's classifier, policy check and surface renderer live in modules
 * that touch no Foundry globals at all, so they are imported and CALLED rather
 * than reimplemented. A message this bridge styles is classified by exactly the
 * code Your Flavor would have used, and a GM who narrows the styling policy
 * gets the same answer from both. Only the a5e branch is our own, because that
 * is the part Your Flavor does not have.
 *
 * ── How it themes a5e ─────────────────────────────────────────────────────
 *
 * The a5e card interior is Svelte-rendered and assigns className wholesale on
 * update - toggling a critical, repeating a roll, switching expertise dice all
 * rewrite the class attribute. Marker classes written onto those nodes would be
 * dropped on the next update, leaving a half-themed card. So for a5e the
 * surface renderer is skipped entirely and styles/your-flavor.css maps Your
 * Flavor's tokens onto a5e's own CSS custom properties from the <li> instead.
 *
 * ── Coexistence ───────────────────────────────────────────────────────────
 *
 * Your Flavor marks a message it has handled with .yf-processed and skips any
 * message already carrying it. Both modules honour that marker, so a Your
 * Flavor that has grown its own a5e support, or has been patched locally, wins
 * and this bridge stands down - per message, with no ordering to rely on.
 */
export class YourFlavorService {

  static YF_ID = 'your-flavor';

  /** The three ChatMessage subtypes a5e renders itself. */
  static A5E_MESSAGE_TYPES = new Set(['item', 'roll', 'rollTableOutput']);

  static _renderHook = null;
  /** Your Flavor's style pipeline; required by both features. */
  static _styles = null;
  /** Your Flavor's classifier + surface renderer; required by the log sweep. */
  static _classifier = null;
  static _importFailed = false;

  /* ============================================================
     Settings
     ============================================================ */

  static get enabled() {
    try { return game.settings.get(AM.ID, 'enableYourFlavor') !== false; }
    catch { return false; }
  }

  static get restyleEnabled() {
    try { return game.settings.get(AM.ID, 'enableYourFlavorRestyle') !== false; }
    catch { return false; }
  }

  /** Your Flavor installed and switched on for this world. */
  static get installed() {
    return Boolean(game.modules.get(this.YF_ID)?.active);
  }

  /** Your Flavor finished booting and published the API this bridge needs. */
  static get available() {
    const api = game.modules.get(this.YF_ID)?.api;
    return Boolean(api?.getManager && api?.getLayouts);
  }

  /* ============================================================
     Lifecycle
     ============================================================ */

  static init() {
    this.disconnect();
    if (!this.enabled && !this.restyleEnabled) {
      AM.log(3, 'Your Flavor bridge disabled by setting');
      return;
    }
    if (!this.installed) {
      AM.log(3, 'Your Flavor bridge idle (module not active)');
      return;
    }

    /* Warm the imports now rather than on the first chat card, so a roll in the
     * middle of a fight never waits on a network round trip. */
    this._loadYourFlavorModules();

    /* The render hook handles a5e cards ONLY.
     *
     * Foundry loads modules in id order, so "a5e-mancer" registers before
     * "your-flavor" and this handler runs first. Styling anything else here
     * would mean beating Your Flavor to every message and quietly taking over
     * its job. Everything that is not an a5e card is left to Your Flavor's own
     * hook, which works correctly; the sweep below picks up only what it
     * demonstrably missed. */
    if (this.enabled && game.system?.id === 'a5e') {
      this._renderHook = Hooks.on('renderChatMessageHTML', (message, html) => {
        try {
          const element = html?.jquery ? html[0] : html;
          if (this._isA5eCard(message, element)) this._styleMessage(message, element);
        } catch (err) {
          AM.log(1, 'Your Flavor bridge: styling failed', err);
        }
      });
    }

    this._sweepWhenReady();
    AM.log(3, 'Your Flavor bridge installed');
  }

  static disconnect() {
    if (this._renderHook !== null) {
      Hooks.off('renderChatMessageHTML', this._renderHook);
      this._renderHook = null;
    }
  }

  /**
   * Messages already on screen at load never pass through the render hook -
   * they rendered before it existed. Your Flavor sweeps them from its own ready
   * handler (the pass broken on v14); ours has to wait until that has run and
   * its API is up, so anything it did handle is already marked and skipped
   * here. Bounded, once per session, silent if Your Flavor never boots.
   */
  static _sweepWhenReady(attempt = 0) {
    if (this.available) {
      try { this._sweepChatLog(); }
      catch (err) { AM.log(2, 'Your Flavor bridge: log sweep failed', err); }
      return;
    }
    if (attempt >= 20) {
      AM.log(2, 'Your Flavor bridge: its API never appeared, existing messages left unstyled');
      return;
    }
    setTimeout(() => this._sweepWhenReady(attempt + 1), 100);
  }

  /**
   * Style every message Your Flavor left unprocessed.
   *
   * Not scoped to #chat-log: that id exists through v13 but not v14, which is
   * the whole reason this sweep is needed. A bare .chat-message works on both
   * and picks up a popped-out chat window too. Your Flavor's own preview cards
   * are .yf-preview-card, so a document-wide query cannot reach them.
   */
  static _sweepChatLog() {
    const a5e = this.enabled && game.system?.id === 'a5e';
    const generic = this.restyleEnabled;
    if (!a5e && !generic) return;

    let styled = 0;
    for (const element of document.querySelectorAll('.chat-message')) {
      if (element.classList.contains('yf-processed')) continue;

      const message = game.messages.get(element.dataset?.messageId);
      if (!message) continue;

      const isA5e = this._isA5eCard(message, element);
      if (isA5e ? !a5e : !generic) continue;
      if (this._styleMessage(message, element)) styled++;
    }

    if (styled) AM.log(3, `Your Flavor bridge: restyled ${styled} message(s) Your Flavor had skipped`);
  }

  /* ============================================================
     Styling one message
     ============================================================ */

  /**
   * @returns {boolean} whether the message was styled.
   */
  static _styleMessage(message, element) {
    if (!this.available || !element?.classList) return false;

    /* Your Flavor already handled it - either a build with native a5e support,
     * or its hook simply ran first. Re-applying would fight what it decided. */
    if (element.classList.contains('yf-processed')) return false;

    /* Your Flavor's throwaway test messages carry an in-memory draft config
     * only it holds. Styling them from here would use the saved config instead
     * and show the wrong thing in its own preview. */
    if (message?.flags?.[this.YF_ID]?.previewId) return false;

    const styles = this._styles;
    if (!styles) return false;

    const classification = this._classify(message, element);
    if (!classification) return false;
    if (!this._shouldStyle(message, classification)) return false;

    const config = this._effectiveConfig(message);
    if (!config?.enabled || config.layout === 'none') return false;

    const layout = game.modules.get(this.YF_ID)?.api?.getLayouts?.()?.[config.layout];
    if (!layout) return false;

    element.classList.add('yf-card', `yf-card-${config.layout}`, `yf-message-${classification.type}`);
    element.dataset.yfMessageType = classification.type;

    this._applyClassification(element, classification, config);

    styles.applyFlavorStyles(element, config.customizations, layout.defaults, {
      rolls: config.rolls,
      cards: config.cards
    });

    this._resolveAvatar(message, element);
    element.classList.add('yf-processed');
    return true;
  }

  /**
   * Mirrors Your Flavor's _applyMessageClassification: surface gating, the
   * safe-fallback marker, and the nested surface renderer.
   */
  static _applyClassification(element, classification, config) {
    const surfaces = this._classifier;
    const rolls = this._rollSurfacesEnabled(config, classification);
    const cards = this._cardSurfacesEnabled(config, classification);

    if (surfaces?.usesSafeFallbackClassification?.(classification)) {
      element.classList.add('yf-message-safe-fallback');
      element.dataset.yfFallback = classification.safeFallback;
      surfaces.clearMessageSurfaces(element);
      return;
    }

    element.classList.toggle('yf-message-card-surfaces-enabled', Boolean(classification.isCard && cards));
    element.classList.toggle('yf-message-roll-surfaces-enabled', rolls);

    /* A supported card with nested styling switched off keeps its native text
     * colours, so a themed message colour cannot bleed into a light card. */
    if (classification.isCard && !cards) {
      element.classList.add('yf-message-safe-fallback');
      element.dataset.yfFallback = 'card-surfaces-disabled';
      surfaces?.clearMessageSurfaces?.(element);
      return;
    }

    /* a5e's interior is Svelte-owned - see the header comment. */
    if (classification.nativeSurfaces) return;
    surfaces?.renderMessageSurfaces?.(element, classification, { rolls, cards });
  }

  /* ============================================================
     Classification
     ============================================================ */

  /**
   * a5e cards are classified here because Your Flavor cannot see them; anything
   * else goes to Your Flavor's own classifier, so the result is identical to
   * what it would have decided itself.
   */
  static _classify(message, element) {
    if (this._isA5eCard(message, element)) {
      const type = String(message?.type ?? '');
      let kind = 'roll';
      if (type === 'item' || element.querySelector?.('.a5e-chat-card__header--item')) kind = 'item-card';
      else if (type === 'rollTableOutput') kind = 'system-card';

      const isCard = kind !== 'roll';
      return {
        type: kind,
        supported: true,
        safeFallback: null,
        nativeSurfaces: true,
        systemId: 'a5e',
        cardType: isCard ? 'generic' : null,
        reasons: ['a5e-chat-card'],
        isSimple: false,
        isRoll: !isCard,
        isCard,
        isItemCard: kind === 'item-card',
        isSystemCard: kind === 'system-card',
        isUnsupportedComplex: false,
        isSafeFallback: false
      };
    }

    return this._classifier?.classifyChatMessage?.(message, element) ?? null;
  }

  /** item / roll / rollTableOutput, by document type or by a5e's own marker. */
  static _isA5eCard(message, element) {
    if (game.system?.id !== 'a5e') return false;
    if (this.A5E_MESSAGE_TYPES.has(String(message?.type ?? ''))) return true;
    return Boolean(element?.classList?.contains('a5e-chat-card'))
      || Boolean(element?.querySelector?.('.a5e-chat-card__header, .a5e-chat-card__body'));
  }

  /* ============================================================
     Your Flavor's gating

     The policy decision itself is Your Flavor's own exported function. Only the
     surrounding settings reads are restated here, because shouldStyleMessage
     and _getEffectiveConfig are instance methods on a module-scoped object with
     no public API. All of them read Your Flavor's own registered settings, so a
     GM who switches styling off, forces a layout or narrows the policy gets the
     same answer from this bridge as from Your Flavor.
     ============================================================ */

  static _yfSetting(key, fallback = undefined) {
    try { return game.settings.get(this.YF_ID, key); }
    catch { return fallback; }
  }

  static _shouldStyle(message, classification) {
    if (this._yfSetting('moduleEnabled', true) === false) return false;
    if (message?.whisper?.length > 0 && this._yfSetting('applyToWhispers', true) === false) return false;
    return Boolean(this._classifier?.canStyleMessageClassification?.(classification, this._policy()));
  }

  /* Mirrors Your Flavor's migration fallbacks: a world that has not completed
     its v4 / v4.0.1 setting migration still reports "simple-only" while
     behaving as "supported-fixtures". */
  static _policy() {
    const SIMPLE_ONLY = 'simple-only';
    const FIXTURES = 'supported-fixtures';
    const known = [SIMPLE_ONLY, 'simple-rolls', 'simple-cards', FIXTURES];

    const policy = this._yfSetting('messageStylingPolicy', FIXTURES);
    if (!this._yfSetting('messageStylingPolicyMigrated', true)
      && policy === SIMPLE_ONLY
      && this._yfSetting('applyToAllMessages', false)) return FIXTURES;
    if (!this._yfSetting('messageStylingPolicyV401Migrated', true) && policy === SIMPLE_ONLY) return FIXTURES;
    return known.includes(policy) ? policy : FIXTURES;
  }

  static _effectiveConfig(message) {
    const api = game.modules.get(this.YF_ID)?.api;
    const manager = api?.getManager?.();
    if (!manager?.resolveConfig) return null;

    const userId = message?.author?.id;
    if (!userId) return null;
    const actorId = message?.speaker?.actor || null;

    const user = game.users.get(userId);
    if (!user) return null;
    if (user.isGM) return manager.resolveConfig(userId, actorId);

    const forced = this._yfSetting('forcePlayerLayout', 'none');
    if (forced && forced !== 'none') {
      const layout = api?.getLayouts?.()?.[forced];
      if (layout) return { enabled: true, layout: forced, customizations: { ...layout.defaults } };
    }
    if (this._yfSetting('allowPlayerCustomization', true) === false) return null;

    return manager.resolveConfig(userId, actorId);
  }

  /* Your Flavor keys its roll/card surface toggles on the system, with anything
     it does not recognise - a5e included - falling under "generic". */
  static _surfaceSystem(classification) {
    const id = classification?.systemId;
    return id === 'dnd5e' || id === 'pf2e' ? id : 'generic';
  }

  static _rollSurfacesEnabled(config, classification) {
    if (config?.rolls?.enabled === false) return false;
    return config?.rolls?.systems?.[this._surfaceSystem(classification)]?.enabled !== false;
  }

  static _cardSurfacesEnabled(config, classification) {
    if (!classification?.isCard) return true;
    if (config?.cards?.enabled === false) return false;

    const systems = config?.cards?.systems;
    if (classification.systemId === 'dnd5e') {
      return systems?.dnd5e?.[classification.cardType === 'abilityCards' ? 'abilityCards' : 'itemCards'] !== false;
    }
    if (classification.systemId === 'pf2e') {
      return systems?.pf2e?.[classification.cardType === 'spellCards' ? 'spellCards' : 'actionCards'] !== false;
    }
    return systems?.generic?.enabled !== false;
  }

  /**
   * Your Flavor swaps the message avatar for the token or actor portrait. The
   * sweep has to do the same, or a restyled message would sit in the log beside
   * a hook-styled one wearing a different face.
   *
   * a5e cards have no .message-header at all - it is one of the two elements
   * a5e removes - so this is a no-op for them.
   */
  static _resolveAvatar(message, element) {
    const img = element.querySelector('.message-header img.avatar')
      || element.querySelector('.message-header img');
    const speaker = message?.speaker;
    if (!img || !speaker) return;

    if (speaker.token && speaker.scene) {
      const src = game.scenes.get(speaker.scene)?.tokens?.get(speaker.token)?.texture?.src;
      if (src) { img.src = src; return; }
    }
    if (speaker.actor) {
      const actor = game.actors.get(speaker.actor);
      if (actor?.img && !actor.img.includes('mystery-man')) img.src = actor.img;
    }
  }

  /* ============================================================
     Your Flavor's own modules
     ============================================================ */

  /**
   * Turning a config into the ~96 CSS custom properties the stylesheet reads
   * means running Your Flavor's config normalizer and its token model, and
   * deciding what a message IS means running its classifier. That is well over
   * a thousand lines we are not going to restate, and all three modules are a
   * good surface to borrow: they are pure, they touch no Foundry globals, and
   * they are already in the browser's module cache because Your Flavor imported
   * them at load.
   *
   * Failure is not fatal, it narrows what the bridge can do: without the style
   * pipeline nothing is styled at all (a .yf-card with no custom properties
   * behind it renders as a transparent, visibly broken message), and without
   * the classifier only a5e cards can be, since those are the one kind this
   * bridge can classify by itself.
   */
  static _loadYourFlavorModules() {
    if (this._importFailed || (this._styles && this._classifier)) return;

    /* getRoute applies Foundry's route prefix. A bare "/modules/..." is correct
     * on a default install and wrong on every server hosted under a subpath -
     * The Forge, or any world started with routePrefix - where it would 404 and
     * silently disable the bridge. */
    const route = (file) => foundry.utils?.getRoute?.(`/modules/${this.YF_ID}/scripts/${file}`)
      ?? `/modules/${this.YF_ID}/scripts/${file}`;

    Promise.all([
      import(route('style-utils.js')),
      import(route('message-classifier.js')),
      import(route('message-surface-renderer.js'))
    ]).then(([styles, classifier, surfaces]) => {
      if (typeof styles?.applyFlavorStyles !== 'function') throw new Error('applyFlavorStyles missing');
      this._styles = styles;
      this._classifier = {
        classifyChatMessage: classifier.classifyChatMessage,
        canStyleMessageClassification: classifier.canStyleMessageClassification,
        usesSafeFallbackClassification: classifier.usesSafeFallbackClassification,
        renderMessageSurfaces: surfaces.renderMessageSurfaces,
        clearMessageSurfaces: surfaces.clearMessageSurfaces
      };
    }).catch(err => {
      this._importFailed = true;
      AM.log(2, 'Your Flavor bridge: could not load its modules, standing down', err);
    });
  }
}
