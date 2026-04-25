import { registerSettings } from './settings.js';
import { A5eMancer } from './app/A5eMancer.js';
import { LevelUpDialog } from './app/LevelUpDialog.js';
import { A5eCharacterSheet } from './app/A5eCharacterSheet.js';
import { A5eNPCSheet } from './app/A5eNPCSheet.js';
import { DocumentService, StatRoller } from './utils/index.js';

export class AM {
  static ID   = 'a5e-mancer';
  static NAME = 'A5e Mancer';

  static documents         = {};
  static heritageGifts     = [];
  static equipmentData     = null;
  static creationManeuvers = null;
  static creationSpells    = null;
  static app               = null;
  static levelUpDialog     = null;

  static SELECTED = {
    heritage:    { value: '', id: '', uuid: '' },
    heritageGift:{ name: '', uuid: '' },
    culture:     { value: '', id: '', uuid: '' },
    background:  { value: '', id: '', uuid: '' },
    destiny:     { value: '', id: '', uuid: '' },
    class:       { value: '', id: '', uuid: '' }
  };

  static ABILITY_SCORES = { DEFAULT: 8, MIN: 8, MAX: 15 };
  static LOG_LEVEL      = 0;

  static init() {
    registerSettings();
    this.LOG_LEVEL = parseInt(game.settings.get(this.ID, 'loggingLevel') ?? 0);
    this.ABILITY_SCORES = {
      DEFAULT: game.settings.get(this.ID, 'abilityScoreDefault') || 8,
      MIN:     game.settings.get(this.ID, 'abilityScoreMin')     || 8,
      MAX:     game.settings.get(this.ID, 'abilityScoreMax')     || 15
    };
  }

  static log(level, ...args) {
    if (this.LOG_LEVEL === 0 || level > this.LOG_LEVEL) return;
    const p = `${this.ID} |`;
    if (level === 1) console.error(p, ...args);
    else if (level === 2) console.warn(p, ...args);
    else console.debug(p, ...args);
  }

  static openLevelUp(actor) {
    if (this.levelUpDialog) this.levelUpDialog.close();
    this.levelUpDialog = new LevelUpDialog(actor);
    this.levelUpDialog.render(true);
  }
}

/* ============================================================
   Hooks
   ============================================================ */

Hooks.on('init', () => {
  try {
    AM.init();
  } catch(e) {
    console.error('a5e-mancer | init error:', e);
  }

  /* ── Handlebars partials ── */
  Handlebars.registerPartial('am-controls',
    '<div class="am-item-controls">' +
    '<a data-action="item-chat" data-id="{{id}}" title="Chat"><i class="fa-solid fa-comment"></i></a>' +
    '<a data-action="item-edit" data-id="{{id}}" title="Edit"><i class="fa-solid fa-pen"></i></a>' +
    '<a data-action="item-delete" data-id="{{id}}" title="Delete"><i class="fa-solid fa-trash"></i></a>' +
    '</div>'
  );

  Handlebars.registerPartial('am-action-row',
    '<div class="am-action-row" data-item-id="{{id}}">' +
    '<img src="{{img}}" class="am-ico" alt="" />' +
    '<span class="am-item-name">{{name}}</span>' +
    '{{#if atkBonus}}<span class="am-atk-tag">{{atkBonus}}</span>{{/if}}' +
    '{{#if dmg}}<span class="am-dmg-tag am-dim">{{dmg}}</span>{{/if}}' +
    '{{#if degree}}<span class="am-degree-pip">{{degree}}°</span>{{/if}}' +
    '{{#if exertion}}<span class="am-ex-cost"><i class="fa-solid fa-bolt"></i>{{exertion}}</span>{{/if}}' +
    '<div class="am-row-right">' +
    '<button type="button" data-action="item-use" data-id="{{id}}" class="am-use-btn">Use</button>' +
    '{{> am-controls id=id}}' +
    '</div>' +
    '</div>'
  );

  Handlebars.registerPartial('am-spell-row',
    '<div class="am-action-row am-spell-row-item" data-item-id="{{id}}">' +
    '<img src="{{img}}" class="am-ico" alt="" />' +
    '<span class="am-item-name">{{name}}</span>' +
    '{{#if concentration}}<span class="am-tag am-tag-c" title="Concentration">C</span>{{/if}}' +
    '{{#if ritual}}<span class="am-tag am-tag-r" title="Ritual">R</span>{{/if}}' +
    '{{#if school}}<span class="am-school am-dim">{{school}}</span>{{/if}}' +
    '<div class="am-row-right">' +
    '<button type="button" data-action="item-use" data-id="{{id}}" class="am-use-btn am-cast-btn">Cast</button>' +
    '{{> am-controls id=id}}' +
    '</div>' +
    '</div>'
  );

  Handlebars.registerPartial('am-item-props',
    '<div class="am-item-props">' +
    '{{#if schoolLabel}}<span class="am-chip am-chip-school">{{schoolLabel}}</span>{{/if}}' +
    '{{#if dmgFull}}<span class="am-chip am-chip-dmg">{{dmgFull}}</span>{{/if}}' +
    '{{#if range}}<span class="am-chip am-chip-range">{{range}}</span>{{/if}}' +
    '{{#if duration}}<span class="am-chip am-chip-dur">{{duration}}</span>{{/if}}' +
    '{{#if saveDC}}<span class="am-chip am-chip-save">{{saveDC}}</span>{{/if}}' +
    '{{#if shortDesc}}<span class="am-chip am-chip-desc">{{shortDesc}}</span>{{/if}}' +
    '</div>'
  );

  /* ── Sheet registration ── */
  Actors.registerSheet('a5e', A5eCharacterSheet, {
    types: ['character'],
    makeDefault: true,
    label: 'A5e Mancer Sheet'
  });

  Actors.registerSheet('a5e', A5eNPCSheet, {
    types: ['npc'],
    makeDefault: true,
    label: 'A5e Mancer NPC Sheet'
  });
});

/* ── Ready ──────────────────────────────────────────────── */
Hooks.once('ready', async () => {
  if (!game.settings.get(AM.ID, 'enable')) return;
  await DocumentService.loadAndInitializeDocuments();
  const arr = game.settings.get(AM.ID, 'customStandardArray') || StatRoller.getDefaultStandardArray();
  if (!arr || arr.trim() === '')
    game.settings.set(AM.ID, 'customStandardArray', StatRoller.getDefaultStandardArray());
  globalThis.a5eMancer = { AM };
  Hooks.callAll('a5eMancer.Ready');
});

/* ── Actors sidebar button ──────────────────────────────── */
Hooks.on('renderActorDirectory', (_app, html) => {
  console.log('a5e-mancer | renderActorDirectory hook fired');
  console.log('a5e-mancer | _app:', _app);
  console.log('a5e-mancer | html type:', typeof html, html instanceof HTMLElement ? 'HTMLElement' : (html instanceof jQuery ? 'jQuery' : html?.constructor?.name));
  console.log('a5e-mancer | html:', html);

  if (!game.settings.get(AM.ID, 'enable')) {
    console.log('a5e-mancer | Module disabled in settings, skipping button injection');
    return;
  }

  // html can be jQuery object (v12) or plain HTMLElement (v13)
  const root = (html instanceof jQuery) ? html[0] : html;

  // Build a list of candidate roots: the hook element, the app element, and the DOM node
  const appEl = _app?.element;
  const domEl = document.getElementById('actors');
  const candidates = [root, appEl, domEl].filter(Boolean);
  console.log('a5e-mancer | Candidate roots:', { root, appElement: appEl, domElement: domEl });
  console.log('a5e-mancer | root outerHTML (first 500):', root?.outerHTML?.substring(0, 500));
  if (appEl && appEl !== root) console.log('a5e-mancer | appElement outerHTML (first 500):', appEl?.outerHTML?.substring(0, 500));
  if (domEl && domEl !== root && domEl !== appEl) console.log('a5e-mancer | domElement outerHTML (first 500):', domEl?.outerHTML?.substring(0, 500));

  // Already injected?
  for (const el of candidates) {
    if (el?.querySelector?.('.am-actortab-button')) {
      console.log('a5e-mancer | Button already injected, skipping');
      return;
    }
  }

  // Locate the header action bar by looking for known action buttons first,
  // then falling back to container class selectors.
  let header = null;
  const actionSelectors = [
    '[data-action="createDocument"]',   // V13 "Create Actor"
    '[data-action="create"]',           // alternate
    '[data-action="createFolder"]',     // V13 "Create Folder"
    '[data-action="create-folder"]',    // V12 "Create Folder"
  ];
  const containerSelectors = [
    '.header-actions', '.action-buttons', '.directory-header', 'header',
  ];

  for (const el of candidates) {
    if (!el?.querySelector) continue;
    console.log('a5e-mancer | Searching candidate:', el.tagName, el.id || '', el.className || '');
    // Strategy 1: find a known action button and use its parent as the header
    for (const sel of actionSelectors) {
      const actionBtn = el.querySelector(sel);
      if (actionBtn) {
        console.log('a5e-mancer | Found action button with selector:', sel, actionBtn);
        header = actionBtn.parentElement;
        break;
      }
    }
    if (header) break;
    // Strategy 2: find the header container directly
    for (const sel of containerSelectors) {
      const found = el.querySelector(sel);
      if (found) {
        console.log('a5e-mancer | Found header container with selector:', sel, found);
        header = found;
        break;
      }
    }
    if (header) break;
  }

  if (!header) {
    console.warn('a5e-mancer | Could not find Actors Directory header to inject button');
    console.warn('a5e-mancer | Dumping full candidate innerHTML for debugging:');
    for (const el of candidates) {
      console.warn('a5e-mancer |  -', el.tagName, el.id, '→', el.innerHTML?.substring(0, 1000));
    }
    return;
  }

  console.log('a5e-mancer | Injecting button into header:', header);

  const btn = document.createElement('button');
  btn.type  = 'button';
  btn.className = 'am-actortab-button';
  btn.title = game.i18n.localize('am.actortab-button.hint');
  btn.innerHTML =
    '<i class="fa-solid fa-hat-wizard" style="color:var(--user-color)"></i> ' +
    game.i18n.localize('am.actortab-button.name');

  btn.addEventListener('click', () => {
    if (AM.app) { AM.app.close(); AM.app = null; }
    AM.app = new A5eMancer();
    AM.app.render(true);
  });

  header.appendChild(btn);
});

/* ── Level Up button on character sheet ──────────────────── */
Hooks.on('renderActorSheet', (sheet, html) => {
  const actor = sheet.actor;
  if (!actor) return;
  if (!game.settings.get(AM.ID, 'enable')) return;

  // Only inject into NON-a5e-mancer sheets (avoid double buttons on our own sheet)
  if (sheet instanceof A5eCharacterSheet || sheet instanceof A5eNPCSheet) return;
  if (actor.type !== 'character') return;

  const el = (html instanceof jQuery) ? html[0] : html;
  if (!el || el.querySelector('.am-levelup-btn')) return;

  const lvlBtn = document.createElement('button');
  lvlBtn.type = 'button';
  lvlBtn.className = 'am-levelup-btn';
  lvlBtn.title = game.i18n.localize('am.levelup.button-hint');
  lvlBtn.innerHTML = '<i class="fa-solid fa-arrow-up"></i> ' + game.i18n.localize('am.levelup.button');
  lvlBtn.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); AM.openLevelUp(actor); });

  // Insert before the first system control icon (minimize/close) in the window header
  const windowHeader = el.querySelector('.window-header');
  const firstControl = windowHeader?.querySelector('.header-control');
  if (firstControl) {
    windowHeader.insertBefore(lvlBtn, firstControl);
  } else {
    // Fallback: append to whatever header area is available
    const area = el.querySelector('.window-header .header-elements') ??
                 el.querySelector('.sheet-header .header-details') ??
                 windowHeader;
    area?.appendChild(lvlBtn);
  }
});
