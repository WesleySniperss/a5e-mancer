// Step 3b: a5e.tools spells, psionic powers, magic items, weapons, mundane
// equipment, combat maneuvers, feats, backgrounds and destinies -> a5e
// documents, with fixed ids.
//   node tools/import/build-content.cjs [--dry]
//
// Writes scripts/data/imported/a5etools-content.json and generated.js, and
// .cache/content-report.txt: one line per document with what was read.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const P = require('./lib/paths.cjs');
const N = require('./lib/normalize.cjs');
const { fieldsOf } = require('./lib/fields.cjs');
const { detectUses, detectAction } = require('./lib/actions.cjs');
const { detectGrants } = require('./lib/grants.cjs');
const M = require('./lib/match.cjs');
const { iconIndex } = require('./lib/icons.cjs');
const { emit } = require('./lib/emit.cjs');

const dry = process.argv.includes('--dry');
const want = JSON.parse(fs.readFileSync(path.join(P.CACHE, 'content-want.json'), 'utf8'));
const lk = N.lookups();
const K = JSON.parse(fs.readFileSync(P.KEYS, 'utf8'));
const pickSpellIcon = iconIndex(['spells']);
const pickGearIcon = iconIndex(['adventuringGear']);
const pickManeuverIcon = iconIndex(['maneuvers']);
const pickFeatureIcon = iconIndex(['feats', 'backgroundFeatures', 'destinyFeatures', 'backgrounds', 'destinies']);
const packDocs = (n) => JSON.parse(fs.readFileSync(path.join(P.PACKS, `${n}.json`), 'utf8'));
/* a5e's creatures, for the mounts and pets a character buys: name variants -> the actor */
const MONSTERS = (() => {
  const map = new Map();
  const file = path.join(P.PACKS, 'monsterIndex.json');
  if (!fs.existsSync(file)) return map;
  for (const m of JSON.parse(fs.readFileSync(file, 'utf8'))) for (const v of M.variants(m.name)) if (!map.has(v)) map.set(v, m);
  return map;
})();
const monsterFor = (name) => { for (const v of M.variants(name)) if (MONSTERS.has(v)) return MONSTERS.get(v); return null; };
/* a5e's adventuring gear, for a background's suggested equipment */
const GEAR = (() => { const map = new Map(); for (const g of packDocs('adventuringGear')) for (const v of M.variants(g.name)) if (!map.has(v)) map.set(v, g); return map; })();
const gearFor = (name) => { for (const v of M.variants(name)) if (GEAR.has(v)) return GEAR.get(v); return null; };
const blocksOfHtml = (html) => N.units(html).flatMap((u) => /^(ul|ol)$/.test(u.tag) ? [...u.html.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => N.text(m[1])) : u.tag === 'table' ? [] : [u.text]);
function grantsFrom(blocks, idBase, level = 0) {
  const out = {};
  for (const g of detectGrants(blocks)) {
    const gid = rid(`${idBase}|g|${g.grantType}|${g.proficiencyType ?? g.skill ?? g.traits?.traitType ?? ''}|${JSON.stringify(g.keys ?? g.traits ?? g.specialties ?? g.senses ?? g.movementTypes ?? g.abilities ?? '')}`, 'g');
    out[gid] = { _id: gid, level, levelType: level ? 'class' : 'character', optional: false, img: '', ...g };
  }
  return out;
}
/* The tradition keys a5e knows, and the ones a5e.tools has that it does not (registered by the module) */
const TRADITION_KEYS = Object.fromEntries(Object.keys(K.maneuverTraditions).map((k) => [k.replace(/([A-Z])/g, ' $1').toLowerCase(), k]));
const EXTRA_TRADITIONS = {};
const traditionKey = (label) => {
  const n = String(label ?? '').toLowerCase().replace(/[’']/g, '').trim();
  if (TRADITION_KEYS[n]) return TRADITION_KEYS[n];
  const key = n.replace(/[^a-z0-9 ]/g, '').replace(/ (\w)/g, (_m, c) => c.toUpperCase());
  EXTRA_TRADITIONS[key] = String(label).trim();
  return key;
};
const fileOf = (list, url) => path.join(P.CACHE, 'pages', list, url.replace(/^\//, '').replace(/\//g, '_') + '.html');

/* ── ids ─────────────────────────────────────────────────────────── */
const B62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const used = new Map();
function rid(key, prefix = 'amI') {
  const h = crypto.createHash('sha1').update(key).digest();
  let s = prefix;
  for (let i = 0; s.length < 16; i++) s += B62[h[i % h.length] % 62];
  if (used.has(s) && used.get(s) !== key) throw new Error(`id clash ${s}: ${key} / ${used.get(s)}`);
  used.set(s, key);
  return s;
}

/* ── shared readers ──────────────────────────────────────────────── */
const ABIL = { strength: 'str', dexterity: 'dex', constitution: 'con', intelligence: 'int', wisdom: 'wis', charisma: 'cha' };
const DMG = 'acid|bludgeoning|cold|fire|force|lightning|necrotic|piercing|poison|psychic|radiant|slashing|thunder';
const SOURCES = {
  "Adventurer's Guide": 'adventurersGuide', "Voidrunner's Codex": 'voidrunnersCodex', 'Trials & Treasures': 'trialsAndTreasures',
  'Adventures in ZEITGEIST': 'adventuresInZeitgeist', "Dungeon Delver's Guide": 'dungeonDelversGuide', 'To Save A Kingdom': 'toSaveAKingdom',
  'Gate Pass Gazette': 'a5eMancerGPG', "Planestrider's Journal": 'a5eMancerPlanestrider', 'Mythological Figures & Maleficent Monsters': 'a5eMancerMythological'
};
const sourceOf = (s) => SOURCES[String(s ?? '').trim()] ?? (s ? 'a5eMancerOther' : '');
const article = (html) => html.slice(html.indexOf('<article'), html.indexOf('</article>') + 10);
const seenStub = () => ({ traditions: new Set(), spells: new Set(), maneuvers: new Set(), unmatchedSpells: new Set() });
/** A field's html, cleaned the way the archetype text is: a5e's spells linked, page markup gone. */
function cleanHtml(html) {
  if (!html) return '';
  const inner = html.replace(/<div class="field--label[^"]*">[\s\S]*?<\/div>/, '');
  const s = N.clean(inner, lk, seenStub());
  return N.units(s).map((u) => u.html).join('').replace(/<table>/g, '<table border="1">').replace(/<h[1-6]>/g, '<h3>').replace(/<\/h[1-6]>/g, '</h3>');
}
const plainOf = (html) => N.text(html);
const NUMW = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

function parsePrice(s) {
  const m = /([\d,.]+)\s*(cp|sp|ep|gp|pp|cr)\b/i.exec(String(s ?? ''));
  return m ? { value: Number(m[1].replace(/,/g, '')), denomination: m[2].toLowerCase(), special: '' } : { value: 0, denomination: 'gp', special: '' };
}
function parseWeight(s) {
  const t = String(s ?? '');
  const m = /([\d,.]+)\s*(lbs?|pounds?|tons?|oz)\b/i.exec(t);
  if (!m) return 0;
  const n = Number(m[1].replace(/,/g, ''));
  return /ton/i.test(m[2]) ? n * 2000 : /oz/i.test(m[2]) ? Math.round((n / 16) * 100) / 100 : n;
}

/* ── spells and psionic powers ───────────────────────────────────── */
const POINTS = [0, 2, 3, 5, 6, 7, 9, 10, 11, 13];
const ROMAN = { reflex: 0, i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9 };
function activationOf(t) {
  const s = String(t ?? '').toLowerCase();
  const n = Number((/(\d+)/.exec(s) || [])[1] || 1);
  if (/bonus action/.test(s)) return { type: 'bonusAction', cost: 1, reactionTrigger: '' };
  if (/reaction/.test(s)) return { type: 'reaction', cost: 1, reactionTrigger: '' };
  if (/action/.test(s)) return { type: 'action', cost: 1, reactionTrigger: '' };
  if (/minute/.test(s)) return { type: 'minute', cost: n, reactionTrigger: '' };
  if (/hour/.test(s)) return { type: 'hour', cost: n, reactionTrigger: '' };
  if (/day/.test(s)) return { type: 'day', cost: n, reactionTrigger: '' };
  return { type: 'special', cost: 1, reactionTrigger: '' };
}
function durationOf(t) {
  const s = String(t ?? '').toLowerCase();
  const n = String((/(\d+)/.exec(s) || [])[1] || 1);
  if (/instant/.test(s)) return { unit: 'instantaneous', value: '' };
  if (/until dispelled|permanent/.test(s)) return { unit: 'permanent', value: '' };
  for (const u of ['round', 'minute', 'hour', 'day', 'week', 'turn']) if (new RegExp(`\\b${u}s?\\b`).test(s)) return { unit: u, value: n };
  return { unit: 'special', value: '' };
}
function rangeOf(t) {
  const s = String(t ?? '').trim();
  const low = s.toLowerCase();
  for (const k of ['short', 'medium', 'long', 'touch', 'self']) if (low.startsWith(k)) return { range: k };
  const ft = /^(\d[\d,]*)\s*(feet|foot|ft)/i.exec(s);
  if (ft) return { range: Number(ft[1].replace(/,/g, '')), unit: 'feet' };
  const mi = /^(\d[\d,]*)\s*miles?/i.exec(s);
  if (mi) return { range: Number(mi[1].replace(/,/g, '')), unit: 'miles' };
  if (/sight/i.test(s)) return { range: 'Sight' };
  return s ? { range: s } : null;
}
function targetOf(t) {
  const s = String(t ?? '').toLowerCase();
  if (!s || /special/.test(s)) return { quantity: '', type: '' };
  if (/^self/.test(s)) return { quantity: '', type: 'self' };
  const q = /^(one|two|three|four|five|six|\d+)\b/.exec(s);
  const quantity = q ? (NUMW[q[1]] ?? Number(q[1])) : '';
  const type = /creature/.test(s) && /object/.test(s) ? 'creatureObject' : /object|construct|artifact/.test(s) ? 'object' : /creature|humanoid|beast|undead|fiend|minion/.test(s) ? 'creature' : 'other';
  return { quantity, type };
}
function saveOf(t, body) {
  const s = String(t ?? '');
  const m = new RegExp('\\b(strength|dexterity|constitution|intelligence|wisdom|charisma)\\b', 'i').exec(s)
         || new RegExp('\\b(strength|dexterity|constitution|intelligence|wisdom|charisma) saving throw', 'i').exec(body);
  if (!m) return null;
  return { type: 'savingThrow', default: true, ability: ABIL[m[1].toLowerCase()], saveDC: { type: 'spellcasting', bonus: '' }, label: '',
    onSave: /halves|half/i.test(s) ? 'Half damage' : /negates/i.test(s) ? 'Negates' : '' };
}
function rollsOf(body, higher, id, level) {
  const rolls = {};
  const dm = new RegExp(`\\b(\\d+d\\d+(?:\\s*\\+\\s*\\d+)?)(?: points of)? (${DMG}) damage`, 'i').exec(body);
  if (dm) {
    const r = { type: 'damage', default: true, formula: dm[1].replace(/\s+/g, ' '), damageType: dm[2].toLowerCase(), canCrit: false, label: '' };
    const sc = /\b(?:increases?|additional|extra) (?:by )?(\d+d\d+)[^.]*?\b(?:slot|power) level above/i.exec(higher) || /\b(\d+d\d+) for each (?:slot|power) level above/i.exec(higher);
    if (sc && level > 0) r.scaling = { mode: 'spellLevel', formula: sc[1] };
    rolls[rid(`${id}|damage`, 'r')] = r;
    return rolls;
  }
  const hl = /\bregains? (\d+d\d+(?:\s*\+\s*\d+)?) hit points/i.exec(body) || /\b(\d+d\d+(?:\s*\+\s*\d+)?) temporary hit points/i.exec(body);
  if (hl) rolls[rid(`${id}|healing`, 'r')] = { type: 'healing', default: true, formula: hl[1], healingType: /temporary/i.test(hl[0]) ? 'temporaryHealing' : 'healing', label: '' };
  return rolls;
}
const SCHOOLS2 = new Set(Object.keys(K.spellSchools.secondary));
const CLASSES = new Set(JSON.parse(fs.readFileSync(path.join(P.PACKS, 'classes.json'), 'utf8')).map((c) => c.system?.slug || c.name.toLowerCase()));

const DISCIPLINE = (t) => { const s = String(t ?? '').toLowerCase(); return /clairsentien/.test(s) ? 'clairsentient' : Object.hasOwn(DISCIPLINE_ICON, s) ? s : 'general'; };
const DISCIPLINE_ICON = {
  general: 'icons/magic/perception/third-eye-blue-red.webp', clairsentient: 'icons/magic/control/hypnosis-mesmerism-swirl.webp',
  dynakinetic: 'icons/magic/lightning/orb-ball-purple.webp', kinesthetic: 'icons/magic/life/heart-cross-strong-flame-purple-orange.webp',
  telekinetic: 'icons/magic/control/debuff-energy-hold-levitate-blue-yellow.webp', telepathic: 'icons/magic/control/control-influence-puppet.webp',
  translocation: 'icons/magic/movement/portal-vortex-orange.webp'
};

function spellDoc(list, row) {
  const html = article(fs.readFileSync(fileOf(list, row.url), 'utf8'));
  const F = fieldsOf(html);
  const psionic = list === 'psionic-powers';
  const slug = row.url.split('/').pop();
  const id = rid(`${list}|${slug}|${row.name}`);
  const level = psionic ? (ROMAN[String(F['psionic-power-level']?.text ?? '').toLowerCase()] ?? 0)
                        : (/cantrip/i.test(F['spell-level']?.text ?? '') ? 0 : Number((/(\d)/.exec(F['spell-level']?.text ?? '') || [])[1] || 0));
  const top = html.slice(0, html.indexOf('spell-body') > 0 ? html.indexOf('spell-body') : html.indexOf('field--name-body'));
  const durText = N.text((/class ?='duration-value'>([\s\S]*?)<\/span>/.exec(html) || [])[1] ?? F['psionic-power-duration']?.text ?? '');
  const concentration = /concentration/i.test(N.text(top)) || /\bconcentration\b/i.test(F['psionic-power-duration']?.text ?? '');
  const compText = N.text((/<div id="spell-components-display">([\s\S]*?)<\/div>/.exec(html) || [])[1] ?? '');
  const body = cleanHtml(F.body?.html ?? '');
  const higherHtml = cleanHtml(F['spellcast-at-higher-levels']?.html ?? '');
  const rareHtml = cleanHtml(F['spell-rare-versions']?.html ?? '');
  const bodyText = plainOf(body), higherText = plainOf(higherHtml);
  const description = body
    + (higherHtml ? `<p><strong><em>${psionic ? 'Manifest at Higher Levels' : 'Cast at Higher Levels'}.</em></strong> ${higherText}</p>` : '')
    + (rareHtml ? `<p><strong><em>Rare Versions.</em></strong></p>${rareHtml}` : '');
  const activation = activationOf(psionic ? F['psionic-power-man-time']?.text : F['spell-casting-time']?.text);
  const duration = durationOf(durText || F['psionic-power-duration']?.text);
  const range = rangeOf(psionic ? F['psionic-power-range']?.text : F['spell-range']?.text);
  const target = targetOf(psionic ? F['psionic-power-target']?.text : F['spell-target']?.text);
  const save = saveOf(psionic ? F['psionic-power-savethr-desc']?.text : F['spell-saving-throw-desc']?.text, bodyText);
  const areaSize = F['spell-area']?.text, areaShape = (F['area-shape']?.text ?? '').toLowerCase();
  const action = {
    name: row.name, activation, duration,
    ranges: range ? { [rid(`${id}|range`, 'g')]: range } : {},
    area: areaSize && areaShape ? { shape: areaShape, radius: areaSize, size: areaSize, placeTemplate: false } : { shape: '', size: '', placeTemplate: false },
    target,
    rolls: rollsOf(bodyText, higherText, id, level),
    prompts: save ? { [rid(`${id}|save`, 'p')]: save } : {},
    consumers: level > 0 ? { [rid(`${id}|points`, 'c')]: { type: 'spell', mode: 'variable', spellLevel: level, points: POINTS[level] } } : {}
  };
  const secondary = psionic ? ['psionic'] : (F['spell-schools']?.items ?? []).map((x) => x.toLowerCase().replace(/\s+(\w)/g, (_m, c) => c.toUpperCase())).filter((x) => SCHOOLS2.has(x));
  const classes = psionic ? ['psion'] : (F['spell-classes']?.items ?? []).map((x) => x.toLowerCase()).filter((c) => CLASSES.has(c));
  return {
    _id: id, name: row.name, type: 'spell',
    img: psionic ? pickSpellIcon(row.name, DISCIPLINE_ICON[DISCIPLINE(F['psionic-discipline']?.text)])
                 : pickSpellIcon(`${row.name} ${F['classical-spell-school']?.text ?? ''}`, 'icons/magic/symbols/runes-star-pentagon-blue.webp'),
    system: {
      description, secretDescription: '', source: sourceOf(psionic ? F['psionic-power-source']?.text : F['spell-source']?.text) || (psionic ? 'voidrunnersCodex' : ''),
      favorite: false, uses: { value: 0, max: '', per: '', recharge: { formula: '', threshold: 0 } },
      classes,
      components: { vocalized: /vocalized/i.test(compText), seen: /seen/i.test(compText), material: /material/i.test(compText) },
      concentration,
      disciplines: psionic ? [DISCIPLINE(F['psionic-discipline']?.text)] : [],
      level, materials: plainOf(cleanHtml(F['spellcomponent-description']?.html ?? '')), materialsConsumed: /consum/i.test(F['spellcomponent-description']?.text ?? ''),
      prepared: 0, prerequisite: '', rare: false,
      ritual: /ritual/i.test(top) || /ritual/i.test(row['spell-ritual'] ?? ''),
      schools: { primary: psionic ? '' : String(F['classical-spell-school']?.text ?? '').toLowerCase(), secondary },
      spellBook: '', actions: { [rid(`${id}|action`, 'a')]: action },
      price: { value: 0, denomination: 'gp', special: '' }
    },
    flags: { 'a5e-mancer': { imported: `${list}/${slug}`, url: `https://a5e.tools${row.url}`, folder: psionic ? 'Psionic Powers' : 'Spells' } },
    effects: []
  };
}

/* ── objects ─────────────────────────────────────────────────────── */
const OBJECT_BASE = () => ({
  ac: { baseFormula: '', formula: '', grantsDisadvantage: false, maxDex: 0, minStr: 0, mode: 1, requiresNoShield: false, requiresUnarmored: false },
  actions: {}, favorite: false, secretDescription: '', source: '',
  uses: { value: 0, max: '', per: '', recharge: { formula: '1d6', threshold: 6 } },
  ammunitionProperties: [], armorCategory: '', armorProperties: [], attuned: false, bulky: false, craftingComponents: '', containerId: '',
  damagedState: 0, equippedState: 0, items: {}, materialProperties: [], objectType: 'miscellaneous', plotItem: false,
  price: { value: 0, denomination: 'gp', special: '' }, proficient: true, quantity: 1, rarity: 'mundane', requiresAttunement: false,
  shieldCategory: '', shieldProperties: [], unidentified: false, unidentifiedDescription: '', unidentifiedName: '', weaponProperties: [], weight: 0,
  breakerProperties: [], defensiveProperties: '', flaws: [], versatile: '', mounted: []
});
const RARITY = { common: 'common', uncommon: 'uncommon', rare: 'rare', 'very rare': 'veryRare', legendary: 'legendary', artifact: 'artifact', varies: 'rare' };
function objectTypeOf(category, name, text) {
  const cat = String(category ?? '').toLowerCase();
  if (/^weapon\b/.test(cat)) return /ammunition/.test(name.toLowerCase()) ? 'ammunition' : 'weapon';
  if (/^armor\b/.test(cat)) return /shield/.test(name.toLowerCase()) ? 'shield' : 'armor';
  if (/^(potion|scroll)\b/.test(cat)) return 'consumable';
  if (/^ring\b/.test(cat)) return 'jewelry';
  if (/^(rod|staff|wand)\b/.test(cat)) return 'miscellaneous';
  const c = ` ${name} `.toLowerCase();
  if (/\b(tome|book|manual|codex|grimoire|scroll)s?\b/.test(c)) return /scroll/.test(c) ? 'consumable' : 'miscellaneous';
  if (/\b(potion|elixir|oil of|brew|wine|pie|milk|dust|bandages?|meal|poison|tea|gel|salve|tincture|poultice|acid)\b/.test(c)) return 'consumable';
  if (/ammunition|arrows?\b|bolts?\b|bullets?\b/.test(c)) return 'ammunition';
  if (/\bshield\b/.test(c)) return 'shield';
  if (/\barmor\b|chain shirt|corset|exosuit|plate\b|mail\b|breastplate/.test(c)) return 'armor';
  if (/\b(weapon|sword|blade|axe|bow|dagger|saber|spear|whip|hammer|mace|halberd|gun|fusil|firearm|club)\b/.test(c) && !/whetstone|wand/.test(c)) return 'weapon';
  if (/\b(rings?|amulet|necklace|pendant|brooch|charm|gem|pearls|jewel|crest|clips?)\b/.test(c)) return 'jewelry';
  if (/\bhelm\b|helmet|circlet|crown/.test(c)) return 'helm';
  if (/\b(cloak|boots|shoes|gloves|gauntlets?|bracers?|belt|hat|cap|cravat|coat|robe|cuffs|halter|clothing|outfit|goggles|anklets|garb|vestments?|sash|suit|mask)\b/.test(c)) return 'clothing';
  if (/\b(container|bag|chest|pouch|hamper|bottle|jug|pitcher|safe|goblet|cauldron|crock|saddlebags)\b/.test(c)) return 'container';
  if (/\btools?\b|toolbox|kit\b|set\b/.test(c)) return 'tool';
  return 'miscellaneous';
}
const WEAPON_PROPS = Object.fromEntries(Object.keys({ ammunition: 1, aquatic: 1, breaker: 1, compounding: 1, defensive: 1, dualWielding: 1, finesse: 1, flamboyant: 1, handMounted: 1, heavy: 1, inaccurate: 1, loading: 1, mounted: 1, overkill: 1, parrying: 1, parryingImmunity: 1, punching: 1, quickdraw: 1, range: 1, rebounding: 1, reach: 1, scatter: 1, simple: 1, stealthy: 1, storage: 1, thrown: 1, trip: 1, twoHanded: 1, versatile: 1, vicious: 1, exotic: 1 })
  .map((k) => [k.replace(/([A-Z])/g, ' $1').toLowerCase().replace(/-/g, ' '), k]));
function weaponPropsOf(text) {
  const t = String(text ?? '').toLowerCase().replace(/-/g, ' ');
  return Object.entries(WEAPON_PROPS).filter(([n]) => new RegExp(`\\b${n}\\b`).test(t)).map(([, k]) => k);
}
function attackAction(id, name, { die, type, ranged, rangeText, finesse, thrown }) {
  const ranges = {};
  const rr = /(\d+)\s*\/\s*(\d+)/.exec(rangeText ?? '');
  if (rr) { ranges[rid(`${id}|short`, 'g')] = { range: Number(rr[1]), unit: 'feet' }; ranges[rid(`${id}|long`, 'g')] = { range: Number(rr[2]), unit: 'feet' }; }
  const mod = finesse ? '@finesse.mod' : ranged && !thrown ? '@dex.mod' : '@str.mod';
  return {
    name, activation: { cost: 1, type: 'action', reactionTrigger: '' }, duration: { unit: '', value: '' }, ranges,
    area: { shape: '', size: '', placeTemplate: false }, target: { quantity: 1, type: 'creatureObject' },
    rolls: {
      [rid(`${id}|attack`, 'r')]: { type: 'attack', default: true, attackType: ranged && !thrown ? 'rangedWeaponAttack' : 'meleeWeaponAttack', ability: 'default', bonus: '', critThreshold: 20, proficient: true, label: '' },
      ...(die ? { [rid(`${id}|damage`, 'r')]: { type: 'damage', default: true, canCrit: true, formula: `${die} + ${mod}`, damageType: type, label: '' } } : {})
    },
    prompts: {}, consumers: {}
  };
}
function objectDoc(list, row) {
  const html = article(fs.readFileSync(fileOf(list, row.url), 'utf8'));
  const F = fieldsOf(html);
  const slug = row.url.split('/').pop();
  const id = rid(`${list}|${slug}|${row.name}`);
  const sys = OBJECT_BASE();
  let description = '';
  let folder = 'Equipment';
  const name = N.text(row.name).replace(/&quot;/g, '"');
  if (list === 'magic-items') {
    folder = 'Magic Items';
    description = cleanHtml(F['mi-description']?.html ?? F.body?.html ?? '');
    const tags = F['mi-tags']?.text ?? row['mi-tags'] ?? '';
    sys.rarity = RARITY[String(row['mi-rarity'] ?? '').toLowerCase()] ?? 'rare';
    sys.requiresAttunement = /attunement/i.test(tags) || /requires attunement/i.test(N.text(html.slice(0, html.indexOf('field--name-field-mi-description'))));
    sys.price = { value: Number(String(row['mi-cost'] ?? '0').replace(/[^\d.]/g, '')) || 0, denomination: 'gp', special: '' };
    sys.craftingComponents = F['mi-crafting-components']?.text ?? '';
    sys.objectType = objectTypeOf(`${row['mi-category'] ?? ''} ${row['mi-subcategory'] ?? ''}`, name, description);
    sys.weight = parseWeight((/^\s*<p>\s*([\d.,]+\s*lbs?\.?)/.exec(description) || [])[1]);
    const lead = [row['mi-category'], row['mi-subcategory']].filter(Boolean).join(' (') + (row['mi-subcategory'] ? ')' : '');
    description = `<p><em>${lead}${lead ? ', ' : ''}${String(row['mi-rarity'] ?? '').toLowerCase()}${sys.requiresAttunement ? ' (requires attunement)' : ''}${/cursed/i.test(tags) ? ', cursed' : ''}${/sentient/i.test(tags) ? ', sentient' : ''}</em></p>` + description;
    sys.source = sourceOf(F['mi-source']?.text ?? row['mi-source']);
  } else if (list === 'weapons') {
    folder = 'Equipment';
    description = cleanHtml(F.body?.html ?? '');
    sys.objectType = 'weapon';
    sys.price = parsePrice(F.field?.text ?? row.field);
    sys.weight = parseWeight(F['weapon-weight']?.text ?? row['weapon-weight']);
    const props = F['weapon-properties']?.text ?? row['weapon-properties'] ?? '';
    sys.weaponProperties = weaponPropsOf(props);
    const die = (/\d+d\d+/.exec(F['damage-dice']?.text ?? '') || [])[0];
    const type = String(F['weap-damage-type']?.text ?? '').toLowerCase();
    if (die && new RegExp(DMG).test(type)) {
      sys.actions[rid(`${id}|action`, 'a')] = attackAction(id, name, { die, type, ranged: /ranged/i.test(F['weapon-type']?.text ?? ''), rangeText: F.range?.text, finesse: /finesse/i.test(props), thrown: /thrown/i.test(props) });
    }
    sys.source = sourceOf(F['weapon-source']?.text ?? row['weapon-source']);
    description = `<p><em>${F['weapon-type']?.text ?? ''} weapon; ${F['damage-dice']?.text ?? ''} ${type}; ${props}${F.range?.text && !/melee/i.test(F.range.text) ? `; range ${F.range.text}` : ''}</em></p>` + description;
  } else {
    const type = F.type?.text ?? row.type ?? '';
    folder = 'Equipment';
    description = cleanHtml(F.body?.html ?? '');
    sys.price = parsePrice(F.cost?.text ?? row.cost);
    sys.weight = parseWeight(F.weight?.text ?? row.weight);
    sys.objectType = /container/i.test(type) ? 'container' : /clothing/i.test(type) ? 'clothing'
      : /medicinal|poison|alchemical|meal/i.test(type) ? 'consumable' : /tool/i.test(type) ? 'tool'
      : objectTypeOf('', name, '') === 'consumable' && /good|gear/i.test(type) ? 'consumable' : 'miscellaneous';
    if (/siege/i.test(type)) {
      const t = plainOf(description) + ' ' + N.text(html);
      const dm = new RegExp(`Damage (\\d+d\\d+) (${DMG})`, 'i').exec(t);
      const rg = /Range (\d+\/\d+)/i.exec(t);
      if (dm) sys.actions[rid(`${id}|action`, 'a')] = { ...attackAction(id, name, { die: dm[1], type: dm[2].toLowerCase(), ranged: true, rangeText: rg?.[1] }), rolls: {
        [rid(`${id}|attack`, 'r')]: { type: 'attack', default: true, attackType: 'rangedWeaponAttack', ability: 'none', bonus: '', critThreshold: 20, proficient: true, label: '' },
        [rid(`${id}|damage`, 'r')]: { type: 'damage', default: true, canCrit: true, formula: dm[1], damageType: dm[2].toLowerCase(), label: '' } } };
    }
    // a vehicle's or a siege engine's statistics are on the page, not in its body
    if (!plainOf(description) || /vehicle|siege|drone/i.test(type)) {
      const stats = N.text(html.slice(html.indexOf('</h1>') + 5)).replace(/^.*?\bWeight\b\s*[\d.,]*\s*(?:lbs?\.?|tons?|-)?\s*/i, '').replace(/\s*Source\b.*$/i, '');
      if (stats && !plainOf(description).includes(stats.slice(0, 40))) description = `<p>${stats}</p>` + description;
    }
    // a mount or a pet is bought here and played from its stat block: the link
    if (/^(mount|pet)$/i.test(type)) {
      const m = monsterFor(name.replace(/\s*\((?:mount|pet)\)\s*$/i, ''));
      if (m) description += `<p><strong>Statistics:</strong> @UUID[Compendium.a5e.a5e-monsters.Actor.${m._id}]{${m.name}}${m.cr !== undefined && m.cr !== null ? ` (CR ${m.cr})` : ''} - drag it to the canvas or the sidebar to have the creature.</p>`;
      sys.weight = 0;
    }
    if (/follower/i.test(type)) sys.weight = 0;
    // "5s per day": a price a5e reads, and what it is for
    if (/per day|per week|per night|per month/i.test(F.cost?.text ?? row.cost ?? '')) {
      const t = String(F.cost?.text ?? row.cost);
      const m = /([\d,.]+)\s*(cp|sp|ep|gp|pp|cr|c|s|g)\b/i.exec(t);
      if (m) sys.price = { value: Number(m[1].replace(/,/g, '')), denomination: ({ c: 'cp', s: 'sp', g: 'gp' })[m[2].toLowerCase()] ?? m[2].toLowerCase(), special: t.slice(m.index + m[0].length).trim() };
    }
    description = `<p><em>${type}</em></p>` + description;
    sys.source = sourceOf(F.source?.text ?? row.source);
  }
  sys.description = description;
  // uses and an action from the text: charges, "as an action", a potion's drink
  const plain = plainOf(description);
  const charges = /\bhas (\d+|one|two|three|four|five|six|seven|eight|nine|ten) charges\b/i.exec(plain);
  if (charges && (NUMW[charges[1].toLowerCase()] ?? Number(charges[1])) > 0) {
    const n = NUMW[charges[1].toLowerCase()] ?? Number(charges[1]);
    const regain = /regains? ([^.]*?) (?:expended )?charges? (?:daily )?(?:each day )?at dawn|regains? ([^.]*?) charges? (?:daily|each day)/i.exec(plain);
    sys.uses = { value: n, max: String(n), per: regain ? 'day' : '', recharge: { formula: '1d6', threshold: 6 } };
  } else {
    const u = detectUses(plain);
    if (u) sys.uses = u;
  }
  if (!Object.keys(sys.actions).length && list !== 'weapons') {
    if (sys.objectType === 'consumable' && list === 'magic-items') {
      const act = detectAction(`Use ${name}`, plain, { uses: null, caster: false, rid: (k) => rid(`${id}|a|${k}`, k) }) ?? { name: `Use ${name}`, activation: { type: 'action', cost: 1, reactionTrigger: '' }, prompts: {}, rolls: {}, consumers: {} };
      act.consumers[rid(`${id}|a|q`, 'q')] = { type: 'quantity', default: true, itemId: '', quantity: 1 };
      sys.actions[rid(`${id}|action`, 'a')] = act;
    } else if (list === 'magic-items') {
      const act = detectAction(name, plain, { uses: sys.uses.max ? sys.uses : null, caster: false, rid: (k) => rid(`${id}|a|${k}`, k) });
      if (act) {
        if (charges) for (const [k, c] of Object.entries(act.consumers)) if (c.type === 'itemUses') act.consumers[k] = { type: 'itemUses', default: true, quantity: 1 };
        sys.actions[rid(`${id}|action`, 'a')] = act;
      }
    }
  }
  // a mundane thing's own kind first: a5e's gear has no drones, eggs or ships to borrow from
  const kind = list === 'mundane-equipment' ? String(F.type?.text ?? row.type ?? '') : '';
  const low = name.toLowerCase();
  const KIND_ICON = /egg/i.test(kind) ? 'icons/consumables/eggs/egg-speckled-tan.webp'
    : /vehicle/i.test(kind) ? (/ship|galley|galleon|boat|skiff|raider|vessel|submarine|logboat/.test(low) ? 'icons/environment/settlement/ship.webp' : /balloon/.test(low) ? 'icons/environment/settlement/ship.webp' : 'icons/environment/settlement/wagon.webp')
    : /drone/i.test(kind) ? 'icons/commodities/tech/cog-gear-steel-glass.webp'
    : /siege/i.test(kind) ? (/ballista/.test(low) ? 'icons/weapons/artillery/ballista-wood-green.webp' : 'icons/weapons/artillery/catapult-simple.webp')
    : /trade good/i.test(kind) ? (/cow|ox\b/.test(low) ? 'icons/creatures/mammals/livestock-cow-green.webp' : /pig/.test(low) ? 'icons/creatures/mammals/livestock-pig-green.webp' : /sheep/.test(low) ? 'icons/creatures/mammals/livestock-sheep-green.webp'
      : /gold|silver|platinum|copper|iron|bronze|adamantine|mithral/.test(low) ? 'icons/commodities/metal/ingot-engraved-gold.webp' : /cloth|linen|silk|cotton/.test(low) ? 'icons/commodities/cloth/cloth-bolt-gold-orange.webp'
      : 'icons/consumables/food/salt-seasoning-spice-pink.webp')
    : null;
  const img = KIND_ICON ?? pickGearIcon(name, {
    consumable: 'icons/consumables/potions/bottle-round-corked-yellow.webp', weapon: 'icons/weapons/swords/sword-guard-steel-green.webp',
    armor: 'icons/equipment/chest/breastplate-banded-steel.webp', jewelry: 'icons/equipment/finger/ring-band-engraved-gold.webp',
    clothing: 'icons/equipment/back/cloak-collared-red.webp', container: 'icons/containers/bags/pack-leather-brown.webp',
    ammunition: 'icons/weapons/ammunition/arrows-bodkin-yellow-red.webp', shield: 'icons/equipment/shield/heater-steel-worn.webp',
    helm: 'icons/equipment/head/helm-barbute-steel.webp', tool: 'icons/tools/hand/hammer-and-nail.webp'
  }[sys.objectType] ?? 'icons/containers/chest/chest-reinforced-steel-brown.webp');
  return {
    _id: id, name, type: 'object', img, system: sys,
    flags: { 'a5e-mancer': { imported: `${list}/${slug}`, url: `https://a5e.tools${row.url}`, folder } },
    effects: []
  };
}

/* ── combat maneuvers ────────────────────────────────────────────── */
function maneuverDoc(list, row) {
  const html = article(fs.readFileSync(fileOf(list, row.url), 'utf8'));
  const F = fieldsOf(html);
  const slug = row.url.split('/').pop();
  const id = rid(`${list}|${slug}|${row.name}`);
  const name = N.text(row.name).replace(/^Def lect\b/, 'Deflect');
  const tradition = traditionKey(row['cm-tradition']);
  const degree = Number((/(\d)/.exec(row['cm-degree'] ?? '') || [])[1] || 1);
  const exertion = Number(row['cm-exertion-points'] ?? 0) || 0;
  const actType = String(row['cm-action-type'] ?? '');
  const isStance = /stance/i.test(actType) || /\(stance\)/i.test(F.body?.text ?? '');
  const activation = /bonus action/i.test(actType) ? { type: 'bonusAction', cost: 1, reactionTrigger: '' }
    : /reaction/i.test(actType) ? { type: 'reaction', cost: 1, reactionTrigger: '' }
    : /action/i.test(actType) ? { type: 'action', cost: 1, reactionTrigger: '' } : { type: 'special', cost: 1, reactionTrigger: '' };
  const description = cleanHtml(F.body?.html ?? '');
  const plain = plainOf(description);
  if (activation.type === 'reaction') {
    const w = /^(?:\w+ \(?stance\)?\s*)?((?:when|whenever|if)\b[^,]*),/i.exec(plain);
    if (w) activation.reactionTrigger = w[1].slice(0, 200);
  }
  const sv = new RegExp('\\b(strength|dexterity|constitution|intelligence|wisdom|charisma) saving throw', 'i').exec(plain);
  const dm = new RegExp(`\\b(\\d+d\\d+(?:\\s*\\+\\s*\\d+)?) (${DMG}) damage`, 'i').exec(plain);
  const action = {
    name, activation, duration: isStance ? { unit: 'special', value: '' } : { unit: 'instantaneous', value: '' },
    ranges: {}, area: { shape: '', size: '', placeTemplate: false }, target: { quantity: '', type: '' },
    prompts: sv ? { [rid(`${id}|save`, 'p')]: { type: 'savingThrow', default: true, ability: ABIL[sv[1].toLowerCase()], onSave: '', saveDC: { type: 'custom', bonus: '@maneuverDC' }, label: '' } } : {},
    rolls: dm ? { [rid(`${id}|damage`, 'r')]: { type: 'damage', default: true, formula: dm[1], damageType: dm[2].toLowerCase(), canCrit: false, label: '' } } : {},
    consumers: exertion ? { [rid(`${id}|exertion`, 'c')]: { type: 'resource', default: true, resource: 'exertion', quantity: exertion } } : {}
  };
  return {
    _id: id, name, type: 'maneuver',
    img: pickManeuverIcon(name, 'icons/skills/melee/maneuver-sword-katana-yellow.webp'),
    system: {
      description, secretDescription: '', source: sourceOf(F['cm-source']?.text ?? row['cm-source']), favorite: false,
      uses: { value: 0, max: '', per: '', recharge: { formula: '1d6', threshold: 6 } },
      concentration: false, degree, exertionCost: exertion, isStance,
      prerequisite: String(F['cm-prerequisite']?.text ?? '').replace(/\.$/, ''), tradition,
      actions: { [rid(`${id}|action`, 'a')]: action },
      price: { value: 0, denomination: 'gp', special: '' }
    },
    flags: { 'a5e-mancer': { imported: `${list}/${slug}`, url: `https://a5e.tools${row.url}`, folder: 'Combat Maneuvers' } },
    effects: []
  };
}

/* ── feats ───────────────────────────────────────────────────────── */
/* maneuvers by name - a5e's, and the ones converted here - for feats that grant them */
const MANEUVERS = (() => {
  const map = new Map();
  for (const m of packDocs('maneuvers')) for (const v of M.variants(m.name)) if (!map.has(v)) map.set(v, `Compendium.a5e.a5e-maneuvers.Item.${m._id}`);
  for (const r of want['combat-maneuvers'] ?? []) {
    const id = rid(`combat-maneuvers|${r.url.split('/').pop()}|${r.name}`);
    for (const v of M.variants(r.name)) if (!map.has(v)) map.set(v, `Compendium.world.a5e-mancer-imported.Item.${id}`);
  }
  return map;
})();
const maneuverFor = (name) => { for (const v of M.variants(name)) if (MANEUVERS.has(v)) return MANEUVERS.get(v); return null; };
function featureBase(id, name, description, featureType, source, { prerequisite = '', blocks = null, level = 0 } = {}) {
  const b = blocks ?? blocksOfHtml(description);
  const plain = b.join(' ');
  const uses = detectUses(plain);
  const act = detectAction(name, plain, { uses, caster: false, rid: (k) => rid(`${id}|a|${k}`, k) });
  return {
    _id: id, name, type: 'feature',
    img: pickFeatureIcon(name, 'icons/sundries/scrolls/scroll-bound-sealed-blue.webp'),
    system: {
      description, secretDescription: '', source, featureType, classes: '', class: '', prerequisite,
      requiresBloodied: false, concentration: false, favorite: false,
      uses: uses ?? { value: 0, max: '', per: '', recharge: { formula: '1d6', threshold: 6 } },
      actions: act ? { [rid(`${id}|action`, 'a')]: act } : {},
      grants: grantsFrom(b, id, level)
    },
    effects: []
  };
}
function featDoc(list, row) {
  const html = article(fs.readFileSync(fileOf(list, row.url), 'utf8'));
  const F = fieldsOf(html);
  const slug = row.url.split('/').pop();
  const id = rid(`${list}|${slug}|${row.name}`);
  const name = N.text(row.name);
  const body = cleanHtml(F['feat-details']?.html ?? '');
  const head = N.text(html.slice(html.indexOf('</h1>'), html.indexOf('field--name-field-feat-details')));
  const kind = (/\b(Synergy|Heritage|Culture|Destiny|Tier \d|Epic|Origin)\s+Feat\b/i.exec(head) || [])[0];
  const prerequisite = String(F['feat-prerequisite-formattd']?.text ?? row['feat-prerequisite-formattd'] ?? '').replace(/\.$/, '');
  const description = (kind || prerequisite ? `<p><em>${[kind, prerequisite ? `Prerequisite: ${prerequisite}` : ''].filter(Boolean).join('. ')}</em></p>` : '') + body;
  const d = featureBase(id, name, description, 'feat', sourceOf(F['feat-source']?.text ?? row['feat-source']), { prerequisite, blocks: blocksOfHtml(body) });
  // "You gain proficiency with the Socialite Stance and To My Side maneuvers": the maneuvers themselves
  const known = [];
  for (const m of plainOf(body).matchAll(/proficiency with (?:the )?([^.;]+?) maneuvers?\b/gi)) {
    for (const part of m[1].split(/,\s*|\s+and\s+/)) { const hit = maneuverFor(part.trim()); if (hit && !known.includes(hit)) known.push(hit); }
  }
  if (known.length) {
    const gid = rid(`${id}|maneuvers`, 'g');
    d.system.grants[gid] = { _id: gid, grantType: 'item', level: 0, levelType: 'character', optional: false, img: '', label: 'Maneuvers',
      items: { base: known.map((uuid) => ({ uuid, quantityOverride: 0 })), options: [], total: 0 } };
  }
  d.flags = { 'a5e-mancer': { imported: `${list}/${slug}`, url: `https://a5e.tools${row.url}`, folder: 'Feats' } };
  return d;
}

/* ── backgrounds ─────────────────────────────────────────────────── */
const ABIL_KEYS = { strength: 'str', dexterity: 'dex', constitution: 'con', intelligence: 'int', wisdom: 'wis', charisma: 'cha' };
function proficiencyGrants(text, what, idBase) {
  let t = String(text ?? '').replace(/\.$/, '').trim();
  if (!t) return {};
  const n = (/^(one|two|three) of your choice$/i.exec(t) || [])[1];
  if (n && what === 'tool') t = `${n} tools of your choice`;
  // "Water vehicles, musical instrument": a category named alone is one of your choice
  t = t.replace(/(^|,\s*|\bor\s+|\band\s+)(musical instrument|gaming set|artisan[’']?s tools?|vehicle)\b(?! of your)/gi, (_m, lead, cat) => `${lead}one ${cat} of your choice`);
  const sentence = what === 'language' ? `You gain proficiency in ${t.replace(/^(\w+)$/, '$1')}.` : `You gain proficiency with ${t}.`;
  return grantsFrom([sentence], `${idBase}|${what}`);
}
function backgroundDocs(list, row) {
  const html = article(fs.readFileSync(fileOf(list, row.url), 'utf8'));
  const F = fieldsOf(html);
  const slug = row.url.split('/').pop();
  const id = rid(`${list}|${slug}|${row.name}`);
  const name = N.text(row.name);
  const source = sourceOf(F['background-source']?.text ?? row['background-source']);
  const featName = N.text(F['background-feature-name']?.text ?? 'Feature').replace(/\.$/, '');
  const featDesc = cleanHtml(F['background-feature-desc']?.html ?? '');
  const feature = featureBase(rid(`${id}|feature`), featName, featDesc, 'background', source);
  feature.flags = { 'a5e-mancer': { imported: `${list}/${slug}/feature`, url: `https://a5e.tools${row.url}`, folder: 'Background Features' } };

  const grants = {};
  const abil = ABIL_KEYS[String(F['background-ability-score']?.text ?? '').toLowerCase().trim()];
  if (abil) {
    const gid = rid(`${id}|ability`, 'g');
    grants[gid] = { _id: gid, grantType: 'ability', level: 0, optional: false, default: true, img: '', label: 'Ability Score Increase',
      abilities: { base: [abil], options: ['str', 'dex', 'con', 'int', 'wis', 'cha'], total: 1 }, bonus: '1', context: { types: ['base'], requiresProficiency: false } };
  }
  Object.assign(grants, proficiencyGrants(F['background-skill-prof']?.text, 'skill', id));
  Object.assign(grants, proficiencyGrants(F['background-tool-prof']?.text, 'tool', id));
  Object.assign(grants, proficiencyGrants(F['background-lang']?.text, 'language', id));
  const equipText = F['background-suggested-equip']?.text ?? '';
  const gear = [];
  for (const raw of equipText.replace(/\.$/, '').split(/,\s*|\s+and\s+/)) {
    const item = raw.replace(/^(?:a|an|the|two|three|\d+)\s+/i, '').replace(/\s*\(.*\)\s*/, '').trim();
    const g = item && gearFor(item);
    if (g && !gear.some((x) => x._id === g._id)) gear.push(g);
  }
  if (gear.length) {
    const gid = rid(`${id}|equipment`, 'g');
    grants[gid] = { _id: gid, grantType: 'item', level: 0, optional: true, default: true, img: '', label: 'Suggested Equipment',
      items: { base: gear.map((g) => ({ uuid: `Compendium.a5e.a5e-adventuring-gear.Item.${g._id}`, quantityOverride: 0 })), options: [], total: 0 } };
  }
  const fgid = rid(`${id}|featuregrant`, 'g');
  grants[fgid] = { _id: fgid, grantType: 'feature', level: 0, optional: false, img: '', label: 'Feature',
    features: { base: [{ uuid: `${PACK}${feature._id}`, name: featName, img: feature.img, limitedReselection: true, selectionLimit: 1 }], options: [], total: 0 } };

  const li = (key) => Array.from({ length: 12 }, (_, i) => F[`background-${key}-${i + 1}`]?.text).filter(Boolean);
  const connections = li('connection'), mementos = li('memento');
  const cost = F['background-sugg-eq-cost']?.text;
  const line = (label, v) => v ? `<p><strong>${label}:</strong> ${v}</p>` : '';
  const description = cleanHtml(F.body?.html ?? '')
    + line('Ability Score Increases', abil ? `+1 to ${F['background-ability-score'].text.trim()} and one other ability score.` : '')
    + line('Skill Proficiencies', F['background-skill-prof']?.text)
    + line('Tool Proficiencies', F['background-tool-prof']?.text)
    + line('Languages', F['background-lang']?.text)
    + line(`Suggested Equipment${cost ? ` (Cost ${cost} gold)` : ''}`, equipText)
    + `<p><strong><em>Feature: @UUID[${PACK}${feature._id}]{${featName}}.</em></strong> ${plainOf(featDesc)}</p>`
    + (F['background-adventures-adv'] ? `<p><strong><em>Adventures and Advancement.</em></strong> ${F['background-adventures-adv'].text}</p>` : '')
    + (connections.length ? `<h3>${name.toUpperCase()} CONNECTIONS</h3><ol>${connections.map((c) => `<li>${c}</li>`).join('')}</ol>` : '')
    + (mementos.length ? `<hr><h3>${name.toUpperCase()} MEMENTOS</h3><ol>${mementos.map((c) => `<li>${c}</li>`).join('')}</ol>` : '');
  const background = {
    _id: id, name, type: 'background',
    img: pickFeatureIcon(`${name} ${featName}`, 'icons/sundries/documents/document-sealed-signatures-red.webp'),
    system: { description, secretDescription: '', source, favorite: false, grants, actions: {}, price: { value: 0, denomination: 'gp', special: '' } },
    flags: { 'a5e-mancer': { imported: `${list}/${slug}`, url: `https://a5e.tools${row.url}`, folder: 'Backgrounds' } },
    effects: []
  };
  return [background, feature];
}

/* ── destinies ───────────────────────────────────────────────────── */
function destinyDocs(list, row) {
  const html = article(fs.readFileSync(fileOf(list, row.url), 'utf8'));
  const F = fieldsOf(html);
  const slug = row.url.split('/').pop();
  const id = rid(`${list}|${slug}|${row.name}`);
  const name = N.text(row.name);
  const source = sourceOf(F['destiny-source']?.text ?? row['destiny-source']);
  // "Obfuscation. You draw inspiration from..." - the name is the lead-in
  const split = (field) => {
    const h = cleanHtml(F[field]?.html ?? '');
    const t = plainOf(h);
    const m = /^([^.]{2,60})\.\s*/.exec(t);
    return { title: m ? m[1].trim() : '', html: h, text: t };
  };
  const src = split('destiny-source-of-insp'), insp = split('destiny-insp-feature'), full = split('destiny-fulfillment-feat');
  const mk = (key, part, label) => {
    const d = featureBase(rid(`${id}|${key}`), part.title ? `${label}: ${part.title}` : `${name} ${label}`, part.html, 'destiny', source);
    d.flags = { 'a5e-mancer': { imported: `${list}/${slug}/${key}`, url: `https://a5e.tools${row.url}`, folder: 'Destiny Features' } };
    return d;
  };
  const fSrc = mk('source', src, 'Source of Inspiration'), fInsp = mk('inspiration', insp, 'Inspiration Feature'), fFull = mk('fulfillment', full, 'Fulfillment Feature');
  // the source of inspiration is the destiny's own name in a5e's packs
  fSrc.name = name;
  const motivations = Array.from({ length: 12 }, (_, i) => F[`destiny-motivation-${i + 1}`]?.text).filter(Boolean);
  const description = cleanHtml(F.body?.html ?? '')
    + `<hr><p><strong><em>Source of Inspiration: ${src.title || name}.</em></strong> ${src.text.replace(/^[^.]{2,60}\.\s*/, '')}</p>`
    + `<p><strong><em>Inspiration Feature: ${insp.title}.</em></strong> ${insp.text.replace(/^[^.]{2,60}\.\s*/, '')}</p>`
    + `<hr><h4>FULFILLING YOUR DESTINY</h4>${cleanHtml(F['destiny-fulfilling-your']?.html ?? '')}`
    + `<p><strong><em>Fulfillment Feature: ${full.title}.</em></strong> ${full.text.replace(/^[^.]{2,60}\.\s*/, '')}</p>`
    + (motivations.length ? `<h3>${name.toUpperCase()} MOTIVATIONS</h3><ol>${motivations.map((m) => `<li>${m}</li>`).join('')}</ol>` : '');
  const destiny = {
    _id: id, name, type: 'destiny',
    img: pickFeatureIcon(name, 'icons/magic/symbols/star-yellow.webp'),
    system: {
      description, secretDescription: '', source, favorite: false,
      sourceOfInspiration: `${PACK}${fSrc._id}`, inspirationFeature: `${PACK}${fInsp._id}`, fulfillmentFeature: `${PACK}${fFull._id}`,
      actions: {}, price: { value: 0, denomination: 'gp', special: '' }
    },
    flags: { 'a5e-mancer': { imported: `${list}/${slug}`, url: `https://a5e.tools${row.url}`, folder: 'Destinies' } },
    effects: []
  };
  return [destiny, fSrc, fInsp, fFull];
}
const PACK = 'Compendium.world.a5e-mancer-imported.Item.';

/* ── run ──────────────────────────────────────────────────────────── */
const docs = [];
const report = [];
for (const [list, rows] of Object.entries(want)) {
  const byName = new Map();
  const extra = [];
  for (const row of rows) {
    const made = /spells|psionic/.test(list) ? spellDoc(list, row)
      : list === 'combat-maneuvers' ? maneuverDoc(list, row)
      : list === 'feats' ? featDoc(list, row)
      : list === 'backgrounds' ? backgroundDocs(list, row)
      : list === 'destinies' ? destinyDocs(list, row)
      : objectDoc(list, row);
    const [d, ...rest] = Array.isArray(made) ? made : [made];
    extra.push(...rest);
    const prev = byName.get(d.name);
    const worth = (x) => (x.system.price?.value ? 2 : 0) + (x.system.weight ? 1 : 0);
    if (!prev || worth(d) > worth(prev)) byName.set(d.name, d);
  }
  for (const d of extra) byName.set(`${d.name}\u0000${d._id}`, d);
  report.push(`\n## ${list} (${byName.size})`);
  for (const d of byName.values()) {
    docs.push(d);
    const s = d.system;
    const a = Object.values(s.actions)[0];
    const bits = d.type === 'spell'
      ? [`L${s.level}`, s.schools.primary || s.disciplines.join(), s.classes.join('/'), s.concentration ? 'conc' : '', s.ritual ? 'ritual' : '',
         a ? `${a.activation.type}${a.duration.unit ? ' ' + a.duration.value + ' ' + a.duration.unit : ''}${Object.values(a.ranges)[0] ? ' @' + Object.values(a.ranges)[0].range : ''}` : '',
         Object.values(a?.prompts ?? {})[0] ? 'save ' + Object.values(a.prompts)[0].ability : '', Object.values(a?.rolls ?? {})[0] ? Object.values(a.rolls)[0].formula + ' ' + (Object.values(a.rolls)[0].damageType ?? Object.values(a.rolls)[0].healingType) + (Object.values(a.rolls)[0].scaling ? ' +' + Object.values(a.rolls)[0].scaling.formula : '') : '']
      : d.type === 'object'
      ? [s.objectType, s.rarity, s.requiresAttunement ? 'attune' : '', `${s.price.value} ${s.price.denomination}${s.price.special ? ' ' + s.price.special : ''}`, s.weight ? s.weight + ' lb' : '', s.uses.max ? `uses ${s.uses.max}/${s.uses.per || '-'}` : '',
         a ? `act:${a.activation.type}${Object.values(a.rolls)[0] ? ' ' + Object.values(a.rolls).map((r) => r.formula ?? r.attackType).join(' ') : ''}` : '', s.weaponProperties.join('/'), /@UUID\[Compendium\.a5e\.a5e-monsters/.test(s.description) ? 'stat block linked' : '']
      : d.type === 'maneuver'
      ? [`${s.tradition} ${s.degree}°`, `${s.exertionCost} ex`, s.isStance ? 'stance' : '', a?.activation.type, s.prerequisite ? 'prereq: ' + s.prerequisite : '',
         Object.values(a?.prompts ?? {})[0] ? 'save ' + Object.values(a.prompts)[0].ability : '', Object.values(a?.rolls ?? {})[0] ? Object.values(a.rolls)[0].formula + ' ' + Object.values(a.rolls)[0].damageType : '']
      : [d.type, s.featureType ?? '', s.prerequisite ? 'prereq: ' + s.prerequisite : '', s.uses?.max ? `uses ${s.uses.max}/${s.uses.per}` : '', a ? 'act:' + a.activation.type : '',
         Object.values(s.grants ?? {}).map((g) => g.proficiencyType ?? g.traits?.traitType ?? g.grantType).join(','),
         d.type === 'destiny' ? 'features linked' : ''];
    report.push(`  ${d.name} [${s.source}] ${bits.filter(Boolean).join(' · ')}  (${d.img.split('/').pop()})`);
  }
}
fs.writeFileSync(path.join(P.CACHE, 'content-report.txt'), report.join('\n'));
const types = docs.reduce((o, d) => ((o[d.type] = (o[d.type] || 0) + 1), o), {});
console.log(`${docs.length} documents ${JSON.stringify(types)} - report in .cache/content-report.txt`);
if (dry) { fs.writeFileSync(path.join(P.CACHE, "content-dry.json"), JSON.stringify(docs)); process.exit(0); }
const r = emit('a5etools-content', docs);
/* The combat traditions a5e.tools has and a5e does not, for the module to register */
const TRADITION_LORE_TEXT = {
  duelingManeuvers: 'Context-specific maneuvers, considered to be basic maneuvers, but only available during duels.'
};
const tradFile = path.join(P.OUT, 'traditions.js');
fs.writeFileSync(tradFile, `/**
 * Combat traditions of the maneuvers converted from a5e.tools that a5e's own
 * list does not have - generated by tools/import/build-content.cjs. Registered
 * beside a5e's (registerMagicSchools), so their maneuvers sort, filter and
 * read like any other; the text is what right-clicking the tradition shows.
 */
export const IMPORTED_TRADITIONS = ${JSON.stringify(Object.fromEntries(Object.entries(EXTRA_TRADITIONS).sort().map(([k, label]) => [k, { label, lore: TRADITION_LORE_TEXT[k] ?? '' }])), null, 2).replace(/"(\w+)":/g, '$1:').replace(/"/g, "'")};
`);
console.log(`${path.relative(P.MODULE, tradFile)}: ${Object.keys(EXTRA_TRADITIONS).join(', ') || 'none'}`);
console.log(`${path.relative(P.MODULE, r.file)}: ${(r.bytes / 1024).toFixed(0)} KB; generated.js lists ${r.total} documents`);
