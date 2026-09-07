/* Enough Foundry to let the sheet module load and getData() run. */
class Collection extends Map {
  get contents() { return [...this.values()]; }
  filter(f) { return this.contents.filter(f); }
  find(f)   { return this.contents.find(f); }
  map(f)    { return this.contents.map(f); }
  reduce(f, i) { return this.contents.reduce(f, i); }
  forEach(f){ return this.contents.forEach(f); }
  get first() { return () => this.contents[0]; }
  [Symbol.iterator]() { return this.values(); }
}
globalThis.Collection = Collection;

globalThis.foundry = {
  utils: {
    mergeObject: (a, b) => ({ ...a, ...b }),
    getProperty: (o, p) => p.split('.').reduce((x, k) => x?.[k], o),
    setProperty: () => {}, deepClone: (o) => JSON.parse(JSON.stringify(o ?? null)),
    duplicate: (o) => JSON.parse(JSON.stringify(o ?? null)),
    randomID: () => 'abc123', diffObject: () => ({}),
    objectsEqual: (a, b) => JSON.stringify(a) === JSON.stringify(b),
    escapeHTML: (s) => String(s)
  },
  applications: { api: { DialogV2: { confirm: async () => false }, ApplicationV2: class {}, HandlebarsApplicationMixin: (b) => b } },
  documents: { collections: { Actors: { unregisterSheet(){}, registerSheet(){} }, Items: { unregisterSheet(){}, registerSheet(){} } } }
};

globalThis.ActorSheet = class {
  static get defaultOptions() { return { classes: [], tabs: [], dragDrop: [] }; }
  constructor(...a) { this.options = {}; }
  _getHeaderButtons() { return []; }
  activateListeners() {}
  _onDragStart() {}
  _onDrop() {}
  /* The real ActorSheet grants this for an owned, unlocked document. Without
     it activateListeners returned at its editable gate and every listener past
     that line — most of the sheet — went untested. */
  get isEditable() { return true; }
  get actor() { return this._actor; }
};
globalThis.Application = globalThis.ActorSheet;
globalThis.FormApplication = globalThis.ActorSheet;
globalThis.Hooks = { on(){}, once(){}, callAll(){} };
globalThis.ui = { notifications: { info(){}, warn(){}, error(){} } };
globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { OBSERVER: 1 } };

globalThis.game = {
  i18n: { localize: (k) => String(k ?? ''), format: (k) => String(k ?? '') },
  /* Foundry THROWS for a setting that was never registered — it does not return
     undefined. A stub that quietly answers false hides exactly the bug that
     shipped in 2.36.0: game.settings.get('core', 'fontSize") threw inside
     activateListeners and aborted the whole render. So this throws too, and
     only knows what the module actually registers. */
  settings: {
    _known: new Set([
      "a5e-mancer.enable", "a5e-mancer.includeDnd5ePacks",
      "a5e.itemRightClickConfigure"
    ]),
    get(scope, key) {
      const id = scope + "." + key;
      if (!this._known.has(id)) {
        throw new Error('"' + id + '" is not a registered game setting');
      }
      return false;
    }
  },
  user: { isGM: true },
  packs: Object.assign([], { get: () => null, filter: () => [] }),
  a5e: { utils: { getDeterministicBonus: (f) => { const n = Number(f); return Number.isFinite(n) ? n : 0; } } },
  modules: { get: () => null }
};

globalThis.CONFIG = {
  A5E: {
    bonusTypes: { damage: 'A5E.damage.title', skills: 'A5E.skillLabels.title' },
    bonusLabels: {},
    interactionTypes: { basicAction: 'A5E.interactions.types.basicAction', other: 'A5E.interactions.types.other' },
    maneuverTraditions: {},
    activeEffectTypes: {},
    spellSchools: { primary: {} },
    classSpellLists: { wizard: 'x', psion: 'x' },
    abilities: {}, skills: {}
  },
  Item: { documentClass: class { constructor(d){ this.name=d.name; this.type=d.type; } toObject(){ return { system:{} }; } } },
  statusEffects: []
};

/* Enough of a browser for activateListeners to run its full length. Each gap
   here used to end the run early with a bare "x is not defined", which read as
   a passing test because nothing after the throw was ever reached. */
const _node = () => {
  const n = {
    querySelector: () => _node(), querySelectorAll: () => [],
    addEventListener(){}, removeEventListener(){}, appendChild(){}, remove(){},
    closest: () => null, contains: () => false, focus(){}, blur(){}, click(){},
    setAttribute(){}, getAttribute: () => null, removeAttribute(){},
    insertAdjacentHTML(){}, scrollIntoView(){},
    classList: { add(){}, remove(){}, toggle(){}, contains: () => false },
    dataset: {}, style: {}, value: '', textContent: '', innerHTML: '',
    children: [], parentElement: null, offsetWidth: 800, offsetHeight: 600,
    getBoundingClientRect: () => ({ width: 800, height: 600, top: 0, left: 0, right: 800, bottom: 600 })
  };
  return n;
};
globalThis.document = {
  createElement: () => _node(),
  querySelector: () => _node(), querySelectorAll: () => [],
  addEventListener(){}, removeEventListener(){},
  body: _node(), documentElement: _node()
};
globalThis.window = {
  addEventListener(){}, removeEventListener(){},
  getComputedStyle: () => ({ fontSize: '16px', getPropertyValue: () => '' }),
  innerWidth: 1280, innerHeight: 900, requestAnimationFrame: (f) => f(),
  setTimeout: (f) => f, clearTimeout(){}
};
globalThis.getComputedStyle = globalThis.window.getComputedStyle;
globalThis.ResizeObserver = class { observe(){} unobserve(){} disconnect(){} };
globalThis.ActiveEffect = class {};
