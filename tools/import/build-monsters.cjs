// Step 3d: a5e.tools monster pages -> a5e NPC actors, with fixed ids.
//   node tools/import/build-monsters.cjs [--dry] [name...]
//
// A stat block is one field of text whose lines are not always broken the same
// way, so the header (AC, HP, Speed, saves, skills, senses, languages,
// resistances) is read by pattern out of the whole of it, and everything after
// the header is read as entries: a trait, an action, a bonus action, a
// reaction or a legendary action, each becoming a feature on the actor with
// its attack, save, damage and uses.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const P = require('./lib/paths.cjs');
const N = require('./lib/normalize.cjs');
const { fieldsOf } = require('./lib/fields.cjs');
const { emit } = require('./lib/emit.cjs');

const dry = process.argv.includes('--dry');
const only = process.argv.slice(2).filter((a) => !a.startsWith('--')).map((s) => s.toLowerCase());
const want = JSON.parse(fs.readFileSync(path.join(P.CACHE, 'monsters-want.json'), 'utf8'));
const lk = N.lookups();
const K = JSON.parse(fs.readFileSync(P.KEYS, 'utf8'));

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

/* ── shared ──────────────────────────────────────────────────────── */
const SOURCES = {
  "Adventurer's Guide": 'adventurersGuide', "Voidrunner's Codex": 'voidrunnersCodex', 'Trials & Treasures': 'trialsAndTreasures',
  'Adventures in ZEITGEIST': 'adventuresInZeitgeist', "Dungeon Delver's Guide": 'dungeonDelversGuide', 'To Save A Kingdom': 'toSaveAKingdom',
  'Monstrous Menagerie': 'monstrousMenagerie', "Planestrider's Journal": 'a5eMancerPlanestrider', 'Mythological Figures & Maleficent Monsters': 'a5eMancerMythological'
};
const sourceOf = (s) => {
  const t = String(s ?? '').trim();
  if (SOURCES[t]) return SOURCES[t];
  const gpg = /Gate Pass Gazette(?: Issue)? #?(\d+)/i.exec(t);
  if (gpg) return Number(gpg[1]) <= 21 ? `gpg${gpg[1]}` : 'a5eMancerGPG';
  return /gate pass/i.test(t) ? 'a5eMancerGPG' : t ? 'a5eMancerOther' : '';
};
const SIZES = { tiny: 'tiny', small: 'sm', medium: 'med', large: 'lg', huge: 'huge', gargantuan: 'grg', titanic: 'grg' };
const TOKEN_SIZE = { tiny: 0.5, sm: 1, med: 1, lg: 2, huge: 3, grg: 4 };
const ABIL = { strength: 'str', dexterity: 'dex', constitution: 'con', intelligence: 'int', wisdom: 'wis', charisma: 'cha',
  str: 'str', dex: 'dex', con: 'con', int: 'int', wis: 'wis', cha: 'cha' };
const SKILL_BY_NAME = { acrobatics: 'acr', 'animal handling': 'ani', arcana: 'arc', athletics: 'ath', culture: 'cul', deception: 'dec',
  engineering: 'eng', history: 'his', insight: 'ins', intimidation: 'itm', investigation: 'inv', medicine: 'med', nature: 'nat',
  perception: 'prc', performance: 'prf', persuasion: 'per', religion: 'rel', science: 'sci', 'sleight of hand': 'slt', stealth: 'ste', survival: 'sur' };
const EXPERTISE = { 4: 1, 6: 2, 8: 3, 10: 4, 12: 5, 20: 6 };
const SKILL_ABILITY = K.skillDefaultAbilities;
if (!SKILL_ABILITY) throw new Error('keys.json has no skillDefaultAbilities - rerun tools/import/prepare.cjs');
const TERRAIN = (keys) => keys.map((k) => [k, k.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()]).sort((a, b) => b[1].length - a[1].length);
const DMG = 'acid|bludgeoning|cold|fire|force|lightning|necrotic|piercing|poison|psychic|radiant|slashing|thunder';
const CONDITIONS = ['blinded', 'bloodied', 'charmed', 'confused', 'deafened', 'doomed', 'encumbered', 'fatigue', 'frightened', 'grappled',
  'incapacitated', 'invisible', 'paralyzed', 'petrified', 'poisoned', 'prone', 'rattled', 'restrained', 'slowed', 'strife', 'stunned', 'unconscious'];
const TYPE_ICON = {
  aberration: 'icons/creatures/tentacles/tentacles-thing-green.webp', beast: 'icons/creatures/abilities/paw-print-yellow.webp',
  celestial: 'icons/magic/holy/angel-winged-humanoid-blue.webp', construct: 'icons/commodities/tech/cog-brass.webp',
  dragon: 'icons/creatures/abilities/dragon-fire-breath-orange.webp', elemental: 'icons/magic/air/wind-tornado-funnel-blue.webp',
  fey: 'icons/magic/nature/leaf-glow-triple-teal.webp', fiend: 'icons/magic/unholy/silhouette-evil-horned-red.webp',
  giant: 'icons/creatures/magical/humanoid-giant-forest-blue.webp', humanoid: 'icons/environment/people/commoner.webp',
  monstrosity: 'icons/creatures/abilities/mouth-teeth-rows-white.webp', ooze: 'icons/creatures/slimes/slime-movement-pseudopods-green.webp',
  plant: 'icons/magic/nature/tree-animated-strike.webp', undead: 'icons/magic/death/skull-horned-goat-pentagram-red.webp'
};
const FOLDER = { aberration: 'Aberrations', beast: 'Beasts', celestial: 'Celestials', construct: 'Constructs', dragon: 'Dragons',
  elemental: 'Elementals', fey: 'Fey', fiend: 'Fiends', giant: 'Giants', humanoid: 'Humanoids', monstrosity: 'Monstrosities',
  ooze: 'Oozes', plant: 'Plants', undead: 'Undead' };
const icon = (type) => { const i = TYPE_ICON[type] ?? 'icons/svg/mystery-man.svg'; return fs.existsSync(P.PUBLIC + i) ? i : 'icons/svg/mystery-man.svg'; };

const seenStub = () => ({ traditions: new Set(), spells: new Set(), maneuvers: new Set(), unmatchedSpells: new Set() });
const cleanUnits = (html) => N.units(N.clean(html ?? '', lk, seenStub()));
const formula = (text) => String(text).replace(/\s+/g, ' ').replace(/\s*[\u00d7x]\s*10\b/i, ' * 10').trim();
const htmlOf = (units) => units.map((u) => u.html ?? '').join('').replace(/<table>/g, '<table border="1">');

/* ── the stat block ──────────────────────────────────────────────── */
/** Everything before the first section of entries: one text, however it is broken. */
const STAT_LABEL = /^(?:AC|Armor Class|HP|Hit Points?|Speed|Proficiency|Saving Throws?|Skills|Senses|Languages|Damage|Condition|Initiative|Perception)\b/i;
/** One page spells it "H P 170". */
const unspace = (text) => String(text).replace(/\bH\s+P\b/g, 'HP');

function header(text) {
  text = unspace(text);
  const out = { skills: {}, saves: [], saveBonus: {}, senses: {}, movement: {}, languages: [], traits: {} };
  const ac = /\b(?:AC|Armor Class)\s+(\d+)/i.exec(text);
  out.ac = ac ? ac[1] : '';
  const hp = /\b(?:HP|Hit Points?)\s+(\d+)\s*(?:\(([^)]*)\))?/i.exec(text);
  out.hp = hp ? Number(hp[1]) : 0;
  out.hpVaries = !hp && /\b(?:HP|Hit Points?)\s+varies/i.test(text);
  out.hitDice = hp && /(\d+)d(\d+)/.exec(hp[2] ?? '') ? /(\d+)d(\d+)/.exec(hp[2]) : null;
  const speed = /\bSpeed\s+([^\n]*?)(?=\s*(?:Proficiency|Saving Throws|Skills|Senses|Languages|Damage|Condition|$))/.exec(text);
  if (speed) {
    const walk = /^(\d+)\s*ft/.exec(speed[1].trim());
    if (walk) out.movement.walk = Number(walk[1]);
    for (const m of speed[1].matchAll(/\b(climb|swim|fly|burrow)\s+(\d+)\s*ft/gi)) out.movement[m[1].toLowerCase()] = Number(m[2]);
    out.hover = /\(hover\)/i.test(speed[1]);
  }
  out.pb = Number((/\bProficiency\s*\+(\d+)/.exec(text) || [])[1]) || 0;
  const saves = /\bSaving Throws\s+([^\n]*?)(?=\s*(?:Skills|Senses|Languages|Damage|Condition|Proficiency|$))/.exec(text);
  if (saves) for (const m of saves[1].matchAll(/\b(Str|Dex|Con|Int|Wis|Cha)\b\s*([+\-\u2013\u2212]\s*\d+)?/gi)) {
    out.saves.push(ABIL[m[1].toLowerCase()]);
    if (m[2]) out.saveBonus[ABIL[m[1].toLowerCase()]] = Number(m[2].replace(/[\u2013\u2212]/, '-').replace(/\s+/g, ''));
  }
  // the newer blocks write "Initiative Dex +1 (11), Perception +5 (15)": the
  // first is the initiative, the rest are the skills worth listing
  const init = /\bInitiative\s+(Str|Dex|Con|Int|Wis|Cha)\s*([+\-\u2013\u2212]\s*\d+)?([^\n]*?)(?=\s*(?:Proficiency|Saving Throws|Skills|Senses|Languages|Damage|Condition|$))/i.exec(text);
  if (init) out.initiativeAbility = ABIL[init[1].toLowerCase()];
  const skills = /\bSkills\s+([^\n]*?)(?=\s*(?:Senses|Languages|Damage|Condition|Saving Throws|Proficiency|$))/.exec(text);
  const skillText = `${skills ? skills[1] : ''} ${init ? init[3] : ''}`;
  for (const [name, key] of Object.entries(SKILL_BY_NAME)) {
    const m = new RegExp(`\\b${name}\\b\\s*([+-]\\d+)(?:\\s*\\((\\d)d(\\d+)\\))?`, 'i').exec(skillText);
    if (m) out.skills[key] = { expertise: m[3] ? (EXPERTISE[Number(m[3])] ?? 1) : 0 };
  }
  const senses = /\bSenses\s+([^\n]*?)(?=\s*(?:Languages|Damage|Condition|Skills|$))/.exec(text);
  if (senses) for (const m of senses[1].matchAll(/\b(blindsight|darkvision|tremorsense|truesight)\s+(\d+)\s*(?:ft|feet)/gi)) out.senses[m[1].toLowerCase()] = Number(m[2]);
  const langs = /\bLanguages\s+([^\n]*?)(?=\s*(?:Damage|Condition|Senses|Skills|Proficiency|$))/.exec(text);
  if (langs) {
    const f = ' ' + N.norm(langs[1]).replace(/'/g, '') + ' ';
    for (const key of Object.keys(K.languages)) if (f.includes(` ${key} `)) out.languages.push(key);
    if (/ deep speech /.test(f) && !out.languages.includes('deep')) out.languages.push('deep');
    if (/ thieves cant /.test(f) && !out.languages.includes('cant')) out.languages.push('cant');
    out.telepathy = /telepathy/i.test(langs[1]);
  }
  const pick = (label, list) => {
    const m = new RegExp(`\\b${label}\\s+([^\\n]*?)(?=\\s*(?:Damage|Condition|Senses|Languages|Skills|Saving|Proficiency|$))`).exec(text);
    if (!m) return [];
    return list.filter((k) => new RegExp(`\\b${k}\\b`, 'i').test(m[1]));
  };
  out.traits.damageResistances = pick('Damage Resistances', DMG.split('|'));
  out.traits.damageImmunities = pick('Damage Immunities', DMG.split('|'));
  out.traits.damageVulnerabilities = pick('Damage Vulnerabilities', DMG.split('|'));
  out.traits.conditionImmunities = pick('Condition Immunities', CONDITIONS);
  return out;
}

const HEADINGS = /^(ACTIONS?|BONUS ACTIONS?|REACTIONS?|LEGENDARY ACTIONS?|MYTHIC ACTIONS?|SPECIAL TRAITS?|TRAITS?|LAIR ACTIONS?|REGIONAL EFFECTS?)\b/;
const LEAD = /^<p>\s*(?:<strong>\s*<em>|<em>\s*<strong>|<strong>|<em>)\s*([^<]{2,70}?)\s*[.:]?\s*(?:<\/strong>\s*<\/em>|<\/em>\s*<\/strong>|<\/strong>|<\/em>)/;
const PLAIN_LEAD = /^<p>\s*((?!The\b|This\b|Each\b|When|While|If\b|At\b|On\b|As\b|A\b|An\b|In\b|Any\b|It\b|Once\b|Whenever)[A-Z][\w'’()/–-]*(?: [\w'’()/,–-]+){0,5})\s*\.\s+(?=[A-Z(])/;
/** "@UUID[Compendium...]{Fire Bolt}" is called Fire Bolt. */
const unlink = (s) => String(s).replace(/@UUID\[[^\]]+\]\{([^}]+)\}/g, '$1');
const leadOf = (u) => {
  if (u.tag !== 'p') return null;
  const bold = (LEAD.exec(u.html) || [])[1];
  if (bold) return unlink(bold.trim());
  const plain = (PLAIN_LEAD.exec(u.html) || [])[1];
  return plain && plain.trim().length > 3 && u.text.length > plain.length + 15 ? unlink(plain.trim()) : null;
};

/* ── spells ──────────────────────────────────────────────────────── */
/** A line of a spell list, written in bold on some pages: it belongs to the Spellcasting entry above it. */
const PER = 'day|week|month|year|long rest|short rest';
const SPELL_GROUP = new RegExp(`^(?:constant|at will|cantrips?(?:\\s*\\(at will\\))?|\\d+\\s*\\/\\s*(?:${PER})(?:\\s+each)?(?:\\s*\\([^)]*\\))?|\\d+\\s*(?:st|nd|rd|th)[- ]?level(?:\\s*\\(\\d+\\s*slots?\\))?)\\s*:?$`, 'i');
// [1] the label, [2] times per [3] period, [4] a spell level, [5] its slots
const GROUP_LABEL = new RegExp(`(constant|at will|cantrips?(?:\\s*\\(at will\\))?|(\\d+)\\s*\\/\\s*(${PER})(?:\\s+each)?(?:\\s*\\([^)]*\\))?|(\\d+)\\s*(?:st|nd|rd|th)[- ]?level(?:\\s*\\((\\d+)\\s*slots?\\))?)\\s*:`, 'gi');
/** An ability named in a spellcasting sentence, even as "In telligence". */
const ABILITY_WORD = new RegExp(['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma']
  .map((w) => w.split('').join(' ?')).join('|'), 'i');
const PER_KEY = { day: 'day', week: 'week', month: 'month', year: 'year', 'long rest': 'longRest', 'short rest': 'shortRest' };
const SPELL_LINK = /@UUID\[(Compendium\.a5e\.a5e-spells\.Item\.[A-Za-z0-9]{16})\]\{([^}]+)\}/g;
/** Spells by name, a5e's and the imported ones, for the names a page did not link. */
const SPELL_BY_NAME = (() => {
  const map = new Map();
  const imported = JSON.parse(fs.readFileSync(path.join(P.OUT, 'a5etools-content.json'), 'utf8')).filter((d) => d.type === 'spell');
  for (const d of imported) map.set(N.norm(d.name), `Compendium.world.a5e-mancer-imported.Item.${d._id}`);
  const a5e = JSON.parse(fs.readFileSync(path.join(P.PACKS, 'spells.json'), 'utf8'));
  for (const d of a5e) map.set(N.norm(d.name), `Compendium.a5e.a5e-spells.Item.${d._id}`);
  // "antipathy" is a5e's "Antipathy/Sympathy" - where one half names one spell only
  const halves = new Map();
  for (const d of a5e) if (d.name.includes('/')) for (const h of d.name.split('/')) {
    const k = N.norm(h);
    halves.set(k, halves.has(k) ? null : `Compendium.a5e.a5e-spells.Item.${d._id}`);
  }
  for (const [k, v] of halves) if (v && !map.has(k)) map.set(k, v);
  return map;
})();

/**
 * A Spellcasting or Innate Spellcasting entry: the book it makes, its slots,
 * the caster's ability and level, and the spells it names. Null for an entry
 * that only mentions a spell ("Foresight. The sphinx is under the effect of
 * foresight") - a list is a label followed by names.
 */
function spellcastingOf(monsterId, name, html) {
  const text = unlink(html.replace(/@UUID\[(Compendium\.a5e\.a5e-spells\.Item\.[A-Za-z0-9]{16})\]\{([^}]+)\}/g, '⟦$1|$2⟧'))
    .replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/&rsquo;|&#8217;/g, '’').replace(/[\u2010-\u2013]/g, '-').replace(/\s+/g, ' ');
  const labels = [...text.matchAll(GROUP_LABEL)];
  const prose = !labels.length && /spellcasting/i.test(name) && text.includes('⟦');
  if ((!labels.length && !prose) || !/⟦|spellcasting/i.test(text)) return null;
  const hasLevels = labels.some((l) => l[4]);
  const innate = /innate/i.test(name) || /innately/i.test(text) || !hasLevels;
  // the first ability in the sentence that names the spellcasting ability ("uses Charisma for bard spells and Wisdom for ...": Charisma)
  const abilitySentence = (/[^.]*spellcasting ability[^.]*/i.exec(text) || [''])[0];
  const abilityWord = (ABILITY_WORD.exec(abilitySentence) || [])[0]?.replace(/\s+/g, '');
  // read with the spaces taken out: some pages split a word ("5th-lev el", "spe llcaster")
  const casterLevel = Number((/(\d+)(?:st|nd|rd|th)-?levelspellcaster/i.exec(text.replace(/\s+/g, '')) || [])[1]) || 0;
  const bookId = rid(`${monsterId}|book|${name}`, 'amB');
  const slots = {};
  const spells = [], unmatched = [];
  const seen = new Set();
  const add = (uuid, group) => {
    if (seen.has(uuid)) return;
    seen.add(uuid);
    const times = group[2] ? Number(group[2]) : 0;
    spells.push({
      id: rid(`${monsterId}|spell|${bookId}|${uuid}`, 'amS'), uuid, book: bookId,
      // a5e's own marks: 1 prepared, 2 always there (innate), 0 a cantrip of a prepared caster
      prepared: innate ? 2 : /cantrip/i.test(group[1]) ? 0 : 1,
      uses: times ? { value: times, max: String(times), per: PER_KEY[group[3].toLowerCase()] ?? 'day', recharge: { formula: '', threshold: 0 } } : null
    });
  };
  labels.forEach((group, i) => {
    if (group[4] && group[5]) slots[group[4]] = Math.max(slots[group[4]] ?? 0, Number(group[5]));
    // the list runs to the next label, or to the end of its sentence
    let seg = text.slice(group.index + group[0].length, i + 1 < labels.length ? labels[i + 1].index : text.length);
    seg = seg.split(/\.\s+(?=[A-Z*])/)[0];
    for (const m of seg.matchAll(/⟦([^|⟧]+)\|[^⟧]*⟧/g)) add(m[1], group);
    // names the page did not link
    for (let piece of seg.replace(/⟦[^⟧]*⟧/g, ',').replace(/\([^)]*\)/g, ' ').split(/[,;]/)) {
      piece = piece.replace(/[*\[\]]/g, '').trim();
      // "D" and "none" are a footnote letter and an empty list, not spells
      if (piece.length < 3 || /^(none|and|or)$/i.test(piece) || piece.split(/\s+/).length > 5 || !/[a-z]/i.test(piece)) continue;
      const uuid = SPELL_BY_NAME.get(N.norm(piece));
      if (uuid) add(uuid, group);
      else unmatched.push(piece);
    }
  });
  if (prose) {
    // no list, one sentence: every spell it names, at will or so many times a period
    const times = /(\d+)\s*\/\s*(day|week|month|year)/i.exec(text);
    const group = times ? [times[0], times[0], times[1], times[2]] : ['at will', 'at will'];
    for (const m of text.matchAll(/⟦([^|⟧]+)\|[^⟧]*⟧/g)) add(m[1], group);
  }
  if (!spells.length) return null;
  return {
    book: { _id: bookId, name, img: 'icons/svg/book.svg', ability: 'default', disableSpellConsumers: false, showSpellPoints: false, showSpellSlots: Object.keys(slots).length > 0 },
    ability: ABIL[String(abilityWord ?? '').toLowerCase()] ?? null, casterLevel, slots, spells, unmatched
  };
}

/** "◆ Move. ... ◆ Bite (Costs 2 Actions). ..." is three entries in one paragraph. */
function bullets(u) {
  if (u.tag !== 'p' || !String(u.html ?? '').includes('\u25c6')) return [u];
  return String(u.html).replace(/^<p>|<\/p>$/g, '').split(/(?:<br\s*\/?>)?\s*\u25c6\s*/)
    .map((part) => part.trim().replace(/(?:<br\s*\/?>)+$/, '').trim())
    .filter((part) => part && N.norm(part.replace(/<[^>]+>/g, ' ')).trim())
    .map((part) => ({ tag: 'p', html: `<p>${part}</p>`, text: part.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() }));
}

/** "(3/Day)", "(Recharge 5-6)", "(1/short rest)" in an entry's name. */
function usesOf(name) {
  const rech = /recharge\s*(\d)\s*[-–]\s*(\d)|recharge\s*(\d)\b/i.exec(name);
  if (rech) return { value: 1, max: '1', per: '', recharge: { formula: '1d6', threshold: Number(rech[1] ?? rech[3]) } };
  const per = /\((\d+)\s*\/\s*(day|short rest|long rest|turn|round|minute|hour)\)/i.exec(name);
  if (per) {
    const p = per[2].toLowerCase();
    return { value: Number(per[1]), max: String(per[1]),
      per: p === 'short rest' ? 'shortRest' : p === 'long rest' ? 'longRest' : p === 'turn' ? 'turn' : p === 'round' ? 'round' : p === 'minute' ? 'minute' : p === 'hour' ? 'hour' : 'day',
      recharge: { formula: '1d6', threshold: 6 } };
  }
  return null;
}

/** The action of a trait, attack or ability: what it hits, what it asks, what it does. */
function actionOf(id, name, text, category) {
  const activation = category === 'action' ? { type: 'action', cost: 1, reactionTrigger: '' }
    : category === 'bonusAction' ? { type: 'bonusAction', cost: 1, reactionTrigger: '' }
    : category === 'reaction' ? { type: 'reaction', cost: 1, reactionTrigger: '' }
    : category === 'legendary' ? { type: 'legendaryAction', cost: Number((/costs (\d+) actions?/i.exec(name) || [])[1] || 1), reactionTrigger: '' }
    : category === 'lair' ? { type: 'lairAction', cost: 1, reactionTrigger: '' }
    : null;
  const atk = /\b(Melee|Ranged|Melee or Ranged)\s+(Weapon|Spell)\s+Attack:\s*([+-]\d+)\s*to hit/i.exec(text);
  const hit = new RegExp(`Hit:\\s*\\d+\\s*\\(([^)]+)\\)\\s*(${DMG})\\s*damage`, 'i').exec(text.replace(/\bd\s+amage\b/g, 'damage'));
  const extra = new RegExp(`plus\\s*\\d+\\s*\\(([^)]+)\\)\\s*(${DMG})\\s*damage`, 'i').exec(text);
  const save = new RegExp(`DC\\s*(\\d+)\\s*(strength|dexterity|constitution|intelligence|wisdom|charisma)\\s*saving throw`, 'i').exec(text);
  if (!activation && !atk && !save && !hit) return null;
  const action = {
    name, activation: activation ?? { type: 'special', cost: 1, reactionTrigger: '' },
    duration: { unit: '', value: '' }, ranges: {}, area: { shape: '', size: '', placeTemplate: false },
    target: { quantity: atk ? 1 : '', type: atk ? 'creatureObject' : '' }, rolls: {}, prompts: {}, consumers: {}
  };
  const reach = /reach\s+(\d+)\s*ft/i.exec(text);
  const range = /range\s+(\d+)\s*\/\s*(\d+)\s*ft/i.exec(text) || /range\s+(\d+)\s*ft/i.exec(text);
  if (reach) action.ranges[rid(`${id}|reach`, 'g')] = { range: Number(reach[1]), unit: 'feet' };
  if (range) { action.ranges[rid(`${id}|range`, 'g')] = { range: Number(range[1]), unit: 'feet' }; if (range[2]) action.ranges[rid(`${id}|long`, 'g')] = { range: Number(range[2]), unit: 'feet' }; }
  if (atk) {
    const ranged = /^ranged/i.test(atk[1]);
    action.rolls[rid(`${id}|attack`, 'r')] = { type: 'attack', default: true, attackType: `${ranged ? 'ranged' : 'melee'}${atk[2].toLowerCase() === 'spell' ? 'Spell' : 'Weapon'}Attack`,
      ability: 'none', bonus: atk[3], critThreshold: 20, proficient: false, label: '' };
  }
  if (hit) action.rolls[rid(`${id}|damage`, 'r')] = { type: 'damage', default: true, canCrit: true, formula: formula(hit[1]), damageType: hit[2].toLowerCase(), label: '' };
  if (extra) action.rolls[rid(`${id}|damage2`, 'r')] = { type: 'damage', default: true, canCrit: true, formula: formula(extra[1]), damageType: extra[2].toLowerCase(), label: '' };
  if (!hit && !atk) {
    const dm = new RegExp(`\\b\\d+\\s*\\(([^)]*\\dd\\d[^)]*)\\)\\s*(${DMG})\\s*damage`, 'i').exec(text) || new RegExp(`\\b(\\d+d\\d+(?:\\s*[+-]\\s*\\d+)?)\\s*(${DMG})\\s*damage`, 'i').exec(text);
    if (dm) action.rolls[rid(`${id}|damage`, 'r')] = { type: 'damage', default: true, canCrit: false, formula: formula(dm[1]), damageType: dm[2].toLowerCase(), label: '' };
  }
  if (save) action.prompts[rid(`${id}|save`, 'p')] = { type: 'savingThrow', default: true, ability: ABIL[save[2].toLowerCase()],
    saveDC: { type: 'custom', bonus: save[1] }, label: '', onSave: /half (?:as much )?damage|takes half/i.test(text) ? 'Half damage' : '' };
  return action;
}

/* ── one monster ─────────────────────────────────────────────────── */
function monsterDoc(row) {
  const slug = row.url.split('/').pop();
  const id = rid(`monster|${slug}|${row.name}`);
  const file = path.join(P.CACHE, 'pages', 'monsters', row.url.replace(/^\//, '').replace(/\//g, '_') + '.html');
  const html = fs.readFileSync(file, 'utf8');
  const article = html.slice(html.indexOf('<article'), html.indexOf('</article>'));
  const F = fieldsOf(article);
  const notes = [];
  const abilities = {};
  for (const m of article.matchAll(/id="(str|dex|con|int|wis|cha)-value"[^>]*>\s*(\d+)/g)) abilities[m[1]] = Number(m[2]);
  if (Object.keys(abilities).length !== 6) notes.push(`abilities read: ${Object.keys(abilities).join(',') || 'none'}`);

  const units = cleanUnits(F['monster-stat-block']?.html ?? '');
  // the header is everything up to the first entry with a lead-in or an uppercase heading
  let firstEntry = units.findIndex((u) => u.tag === 'p'
    && (HEADINGS.test(u.text) || (leadOf(u) && !STAT_LABEL.test(unspace(u.text)))));
  if (firstEntry < 0) firstEntry = units.length;
  const head = header(units.slice(0, firstEntry).map((u) => u.text).join('\n'));

  const sizeText = String(F['monster-size']?.text ?? '').toLowerCase().trim();
  const size = SIZES[sizeText] ?? 'med';
  if (sizeText && !SIZES[sizeText]) notes.push(`size "${sizeText}" unknown, taken as Medium`);
  else if (sizeText === 'titanic') notes.push('titanic, which a5e has no size for, taken as Gargantuan');
  const typeText = String(F['monster-type']?.text ?? '').toLowerCase();
  const creatureTypes = Object.keys(K.creatureTypes).filter((c) => new RegExp(`\\b${c}`, 'i').test(typeText));
  let terrainText = ' ' + String(F['monster-terrain']?.text ?? '').toLowerCase().replace(/\s+/g, ' ') + ' ';
  const terrain = [];
  for (const [key, label] of TERRAIN(Object.keys(K.terrainTypes))) {
    if (!terrainText.includes(` ${label} `)) continue;
    terrain.push(key);
    terrainText = terrainText.replace(` ${label} `, ' ');   // "The Dreaming" is not also "the" and "dreaming"
  }
  const crText = String(F['monster-challenge-rating']?.text ?? row['monster-challenge-rating'] ?? '').trim();
  const cr = /\//.test(crText) ? Number(crText.split('/')[0]) / Number(crText.split('/')[1]) : Number(crText) || 0;

  // entries, by the section they are in
  const items = [];
  const casting = [];
  const keys = new Set();
  let category = 'trait';
  let current = null;
  const loose = new Map();                                // heading -> the text under it that is no entry
  let heading = '';
  const push = () => {
    if (!current) return;
    const text = current.units.map((u) => u.text).join(' ');
    let key = `${id}|item|${current.name}|${category}`;
    for (let n = 2; keys.has(key); n++) key = `${id}|item|${current.name}|${category}|${n}`;
    keys.add(key);
    const iid = rid(key);
    const uses = usesOf(current.name);
    const act = actionOf(iid, current.name, text, category);
    const attacks = act && Object.values(act.rolls).some((r) => r.type === 'attack');
    const featureType = category === 'legendary' ? 'legendaryAction' : attacks ? 'naturalWeapon' : category === 'trait' ? '' : 'other';
    const spells = spellcastingOf(id, current.name, htmlOf(current.units));
    if (spells) casting.push(spells);
    items.push({
      _id: iid, name: current.name, type: 'feature', img: attacks ? 'icons/svg/sword.svg' : 'icons/svg/aura.svg',
      system: {
        description: htmlOf(current.units), secretDescription: '', source: sourceOf(F['monster-source']?.text ?? row['monster-source']),
        featureType,
        classes: '', class: '', prerequisite: '', requiresBloodied: /while bloodied/i.test(current.name), concentration: false, favorite: false,
        uses: uses ?? { value: 0, max: '', per: '', recharge: { formula: '', threshold: 0 } },
        actions: act ? { [rid(`${iid}|action`, 'a')]: act } : {}, grants: {}
      },
      flags: { 'a5e-mancer': { imported: `monsters/${slug}`, category } },
      effects: []
    });
    current = null;
  };
  for (const u of units.slice(firstEntry).flatMap(bullets)) {
    if (u.tag === 'hr') continue;
    if (u.tag === 'p' && HEADINGS.test(u.text)) {
      push();
      const h = u.text.toUpperCase();
      heading = u.text.trim().toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
      category = /^BONUS/.test(h) ? 'bonusAction' : /^REACTION/.test(h) ? 'reaction' : /^(LEGENDARY|MYTHIC)/.test(h) ? 'legendary'
        : /^ACTION/.test(h) ? 'action' : /^(LAIR|REGIONAL)/.test(h) ? 'lair' : 'trait';
      continue;
    }
    const lead = leadOf(u);
    if (lead && current && SPELL_GROUP.test(lead.replace(/[\u2010-\u2013]/g, '-'))) { current.units.push(u); continue; }
    if (lead) { push(); current = { name: lead, units: [u] }; continue; }
    if (current) current.units.push(u);
    else { if (!loose.has(heading)) loose.set(heading, []); loose.get(heading).push(u); }   // "The aboleth can take 2 legendary actions ..."
  }
  push();

  const bio = ['monster-description', 'monster-other-notes', 'monster-behavior', 'monster-signs', 'monster-encounters']
    .map((f) => (F[f] ? `<h2>${F[f].label || f.replace('monster-', '').replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}</h2>${htmlOf(cleanUnits(F[f].html.replace(/<div class="field--label[^"]*">[\s\S]*?<\/div>/, '')))}` : ''))
    .join('') + [...loose].map(([h, us]) => `${h ? `<h2>${h}</h2>` : ''}${htmlOf(us)}`).join('');

  const artSrc = (/<img[^>]+src="([^"]+)"/.exec(F['monster-image']?.html ?? '') || [])[1];
  const art = artSrc ? new URL(artSrc, 'https://a5e.tools').href : null;
  // Every skill, each with its ability: a5e 1.3 keeps only the skills an actor's data names, and a
  // skill named without an ability rolls with none. 1.2 filled both in itself.
  const skills = Object.fromEntries(Object.keys(K.skills).map((key) => [key, {
    ability: SKILL_ABILITY[key], proficient: head.skills[key] ? 1 : 0, expertiseDice: head.skills[key]?.expertise ?? 0,
    specialties: [], bonuses: { check: '', passive: 0 }
  }]));
  const pb = head.pb || 2 + Math.floor(Math.max(cr - 1, 0) / 4);
  const mod = (a) => Math.floor(((abilities[a] ?? 10) - 10) / 2);
  const proficientSave = (a) => {
    if (!head.saves.includes(a)) return false;
    if (head.saves.length < 6 || head.saveBonus[a] === undefined) return true;   // only the proficient ones are listed
    return head.saveBonus[a] - mod(a) >= pb;
  };
  const actor = {
    _id: id, name: row.name, type: 'npc', img: art ?? icon(creatureTypes[0]),
    system: {
      abilities: Object.fromEntries(['str', 'dex', 'con', 'int', 'wis', 'cha'].map((a) => [a, {
        value: abilities[a] ?? 10, check: { expertiseDice: 0, bonus: '' }, save: { proficient: proficientSave(a), expertiseDice: 0, bonus: '' }
      }])),
      skills,
      attributes: {
        ac: { baseFormula: head.ac || '10', value: 0 },
        hp: { value: head.hp, baseMax: head.hp, temp: 0, bonus: 0 },
        ...(head.hitDice ? { hitDice: { [`d${head.hitDice[2]}`]: { current: Number(head.hitDice[1]), total: Number(head.hitDice[1]) } } } : {}),
        movement: { ...Object.fromEntries(Object.entries({ walk: head.movement.walk ?? 30, ...head.movement }).map(([k, v]) => [k, { distance: v, unit: 'feet' }])), traits: { hover: !!head.hover } },
        senses: Object.fromEntries(Object.entries(head.senses).map(([k, v]) => [k, { distance: v, unit: 'feet' }])),
        initiative: { bonus: '', expertiseDice: 0, ability: head.initiativeAbility ?? 'dex' }
      },
      details: { bio, cr, creatureTypes: creatureTypes.length ? creatureTypes : ['humanoid'], isSwarm: /swarm/i.test(typeText) || /\bswarm\b/i.test(row.name), elite: /elite/i.test(String(F['monster-tags']?.text ?? '')), privateNotes: '', notes: '', terrain, isSquad: false },
      traits: { size, ...head.traits, alignment: [] },
      proficiencies: { armor: [], languages: head.languages, tools: [], weapons: [] },
      source: sourceOf(F['monster-source']?.text ?? row['monster-source'])
    },
    prototypeToken: {
      name: row.name, displayName: 0, actorLink: false, width: TOKEN_SIZE[size] ?? 1, height: TOKEN_SIZE[size] ?? 1,
      disposition: -1, sight: { enabled: false }, texture: { src: icon(creatureTypes[0]) }, bar1: { attribute: 'attributes.hp' }
    },
    items,
    effects: [],
    flags: { 'a5e-mancer': { imported: `monsters/${slug}`, url: `https://a5e.tools${row.url}`, folder: FOLDER[creatureTypes[0]] ?? 'Humanoids', ...(art ? { art } : {}) } }
  };
  if (casting.length) {
    const slots = {};
    for (const c of casting) for (const [lv, n] of Object.entries(c.slots)) slots[lv] = Math.max(slots[lv] ?? 0, n);
    actor.system.spellBooks = Object.fromEntries(casting.map((c) => [c.book._id, c.book]));
    actor.system.spellResources = {
      slots: Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8, 9].map((lv) => [String(lv), { current: slots[lv] ?? 0, max: slots[lv] ?? 0 }])),
      points: { current: 0, max: 0 }, artifactCharges: { current: 0, max: 0 }, inventions: { current: 0, max: 0 }
    };
    const main = casting.find((c) => Object.keys(c.slots).length) ?? casting[0];
    actor.system.attributes.spellcasting = main.ability ?? casting.find((c) => c.ability)?.ability ?? 'int';
    actor.system.attributes.casterLevel = Math.max(...casting.map((c) => c.casterLevel));
    actor.flags['a5e-mancer'].spells = casting.flatMap((c) => c.spells);
    const unmatched = [...new Set(casting.flatMap((c) => c.unmatched))];
    if (unmatched.length) notes.push(`spells a5e does not have: ${unmatched.join(', ')}`);
    if (!casting.every((c) => c.ability)) notes.push('a spellcasting ability not read');
  }
  if (!items.length) notes.push('no traits or actions read');
  if (!head.hp) notes.push(head.hpVaries ? 'the page says the hit points vary, so they are left at 0' : 'no hit points read');
  return { actor, notes };
}

/* ── run ─────────────────────────────────────────────────────────── */
const all = [];
const report = [];
let withNotes = 0;
for (const row of want) {
  if (only.length && !only.includes(row.name.toLowerCase())) continue;
  const { actor, notes } = monsterDoc(row);
  all.push(actor);
  const s = actor.system;
  const attacks = actor.items.filter((i) => Object.values(i.system.actions)[0] && Object.values(Object.values(i.system.actions)[0].rolls).some((r) => r.type === 'attack')).length;
  report.push(`  ${actor.name} [${s.source}] ${s.traits.size} ${s.details.creatureTypes.join('/')} CR ${s.details.cr} · AC ${s.attributes.ac.baseFormula} · HP ${s.attributes.hp.value} · ${Object.entries(s.attributes.movement).filter(([k]) => k !== 'traits').map(([k, v]) => `${k} ${v.distance}`).join(', ')}${s.attributes.movement.traits.hover ? ' (hover)' : ''}`
    + ` · ${actor.items.length} entries (${attacks} attacks)${actor.flags['a5e-mancer'].spells ? ` · ${actor.flags['a5e-mancer'].spells.length} spells` : ''}${Object.keys(s.skills).length ? ' · skills ' + Object.keys(s.skills).join(',') : ''}${s.proficiencies.languages.length ? ' · ' + s.proficiencies.languages.join(',') : ''}${s.details.terrain.length ? ' · ' + s.details.terrain.join(',') : ''}`);
  if (notes.length) { report.push('      ! ' + notes.join('; ')); withNotes++; }
}
fs.writeFileSync(path.join(P.CACHE, 'monsters-report.txt'), report.join('\n'));
console.log(`${all.length} monsters, ${all.reduce((n, a) => n + a.items.length, 0)} traits and actions, ${withNotes} with notes - report in .cache/monsters-report.txt`);
if (dry || only.length) process.exit(0);
const r = emit('a5etools-monsters', all);
console.log(`${path.relative(P.MODULE, r.file)}: ${(r.bytes / 1024).toFixed(0)} KB; generated.js lists ${r.total} documents`);
