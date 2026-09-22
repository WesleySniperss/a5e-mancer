// Where the importer reads and writes. Everything it downloads or copies goes
// to tools/import/.cache (not in git); what it produces goes into the module.
const path = require('path');

const MODULE = path.resolve(__dirname, '..', '..', '..');
const DATA = path.resolve(MODULE, '..', '..');                 // Foundry's Data directory
const APP = process.env.FOUNDRY_APP || 'D:/Games/FVTT/Foundry Virtual Tabletop/resources/app';
const CACHE = path.join(__dirname, '..', '.cache');

module.exports = {
  MODULE,
  DATA,
  APP,
  PUBLIC: path.join(APP, 'public') + path.sep,                // core icons live here
  CLASSIC_LEVEL: path.join(APP, 'node_modules', 'classic-level'),
  SYSTEM: path.join(DATA, 'systems', 'a5e'),
  WORLDS: path.join(DATA, 'worlds'),
  CACHE,
  PACKS: path.join(CACHE, 'packs'),                           // a5e's packs as JSON
  PAGES: path.join(CACHE, 'pages'),                           // a5e.tools pages as fetched
  KEYS: path.join(CACHE, 'keys.json'),                        // CONFIG.A5E maps, from a5e's source
  CLASSINFO: path.join(CACHE, 'classinfo.json'),              // per class: archetype start level, spellcasting
  WANT: path.join(CACHE, 'arch-want.json'),                   // the archetypes to convert
  OUT: path.join(MODULE, 'scripts', 'data', 'imported')
};
