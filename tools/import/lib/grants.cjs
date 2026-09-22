// Grants read from a feature's text, in a5e's shapes. Conservative: only what
// the text gives the character outright - never a companion's, never a
// conditional benefit ("while raging you have resistance ..."), never half of a
// choice between different kinds of thing ("light armor or Arcana").
const fs = require('fs'), path = require('path');
const K = JSON.parse(fs.readFileSync(require('./paths.cjs').KEYS, 'utf8'));

const words = (camel) => camel.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
const flat = (s) => String(s).toLowerCase().replace(/[’‘'`]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const NUM = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, single: 1, 'a single': 1, 1: 1, 2: 2, 3: 3, 4: 4 };
const uniq = (a) => [...new Set(a)];

const SKILLS = {
  acr: 'acrobatics', ani: 'animal handling', arc: 'arcana', ath: 'athletics', cul: 'culture', dec: 'deception',
  eng: 'engineering', his: 'history', ins: 'insight', itm: 'intimidation', inv: 'investigation', med: 'medicine',
  nat: 'nature', prc: 'perception', prf: 'performance', per: 'persuasion', rel: 'religion', sci: 'science',
  slt: 'sleight of hand', ste: 'stealth', sur: 'survival'
};
const ABIL = { strength: 'str', dexterity: 'dex', constitution: 'con', intelligence: 'int', wisdom: 'wis', charisma: 'cha' };

const TOOL_NAMES = {};
for (const [cat, tools] of Object.entries(K.tools)) for (const key of Object.keys(tools)) TOOL_NAMES[flat(words(key))] = key;
Object.assign(TOOL_NAMES, {
  'thieves tools': 'thievesTools', 'tinkers tools': 'tinkersTools', 'tinker tools': 'tinkersTools',
  'alchemists supplies': 'alchemistsSupplies', 'alchemist supplies': 'alchemistsSupplies',
  'herbalism kits': 'herbalismKit', 'poisoners kit': 'poisonersKit', 'poisoners kits': 'poisonersKit',
  'navigators tools': 'navigatorsTools', 'smiths tools': 'smithsTools', 'smiths kit': 'smithsTools',
  'woodworkers tools': 'woodcarversTools', 'woodcarvers tools': 'woodcarversTools', 'cooks utensils': 'cooksUtensils',
  'playing cards': 'playingCardSet', 'playing card set': 'playingCardSet', 'dice set': 'diceSet', 'dice': 'diceSet',
  'land vehicles': 'landVehicles', 'water vehicles': 'waterVehicles', 'air vehicles': 'airVehicles', 'space vehicles': 'spaceVehicles',
  'vehicles land': 'landVehicles', 'vehicles water': 'waterVehicles', 'vehicles air': 'airVehicles',
  'the sewing kit': 'sewingKit'
});
const WIND = ['bagpipes', 'flute', 'horn', 'ocarina', 'panFlute', 'shawm', 'harmonica', 'saxophone', 'trombone'];
// category phrases -> keys
const CATS = [
  [/artisans? tools?(?: or tool kits?)?|artisans? tool kits?|sets? of artisans? tools/, () => Object.keys(K.tools.artisansTools)],
  [/wind instruments?/, () => WIND],
  [/musical instruments?/, () => Object.keys(K.tools.musicalInstruments)],
  [/gaming sets?/, () => Object.keys(K.tools.gamingSets)],
  [/vehicles?(?! \()/, () => Object.keys(K.tools.vehicles)],
  [/tools?(?: kits?)?/, () => Object.values(K.tools).flatMap((c) => Object.keys(c))]
];
const TRADITIONS = Object.fromEntries(Object.keys(K.maneuverTraditions).map((k) => [flat(words(k)), k]));
const LANGS = Object.fromEntries(Object.keys(K.languages).map((k) => [k, k]));
Object.assign(LANGS, { 'deep speech': 'deep', 'thieves cant': 'cant' });
const SPECIALTIES = [];
for (const [skill, specs] of Object.entries(K.skillSpecialties)) for (const k of Object.keys(specs)) SPECIALTIES.push({ skill, key: k, name: flat(words(k)).replace(/^the /, '') });
const WEAPONS = { simple: Object.keys(K.weapons.simple), martial: Object.keys(K.weapons.martial) };
const WEAPON_NAMES = {};
for (const cat of Object.keys(K.weapons)) for (const k of Object.keys(K.weapons[cat])) { const n = flat(words(k)); WEAPON_NAMES[n] = k; WEAPON_NAMES[n + 's'] = k; }
const WEAPONISH = /weapon|whip|net|crossbow|bow|dagger|sword|axe|hammer|spear|javelin|sling|dart|lance|pike|trident|maul|flail|scimitar|rapier|saber|glaive|halberd|club|mace|staff|sickle|revolver|pistol|musket|rifle|shotgun|blowgun|gauntlet|chain|knuckles/;

const found = (text, names) => {
  const f = ' ' + flat(text) + ' ';
  const out = [];
  for (const [n, k] of Object.entries(names)) { const i = f.indexOf(' ' + n + ' '); if (i >= 0 && !out.some((o) => o[1] === k)) out.push([i, k]); }
  return out.sort((a, b) => a[0] - b[0]).map((x) => x[1]);
};
const skillsIn = (t) => found(t, Object.fromEntries(Object.entries(SKILLS).map(([k, n]) => [n, k])));
const toolsIn = (t) => found(t, TOOL_NAMES);
const traditionsIn = (t) => found(t, TRADITIONS);
const langsIn = (t) => found(t, LANGS);

/** What one part of a proficiency clause names, by kind. */
function itemsIn(part) {
  let p = ' ' + flat(part) + ' ';
  const it = { skill: [], tool: [], armor: [], weapon: [], savingThrow: [], tradition: [], language: [], counted: [] };
  // counted choices from a category: "three other artisan's tools of your choosing",
  // "a vehicle of your choice", "one set of artisan's tools or a musical instrument"
  const CAT = String.raw`(?:artisans? tools?(?: or tool kits?)?|artisans? tool kits?|sets? of artisans? tools|wind instruments?|musical instruments?|gaming sets?|vehicles?|tools?(?: kits?)?|languages?|skills?|martial or rare weapons|martial weapons?|simple weapons?|combat traditions?|traditions?)`;
  const countRe = new RegExp('\\b(a single|a|an|one|two|three|four|1|2|3|4) (?:other |additional |more |set of |type of |kind of )?(?:[a-z]+ )??(' + CAT + ')((?: or (?:a |an |one )?(?:set of )?' + CAT + ')*)( of your cho(?:ice|osing))?\\b', 'g');
  const keysOf = (what) => {
    if (/languages?/.test(what)) return ['language', Object.keys(K.languages)];
    if (/skills?/.test(what)) return ['skill', Object.keys(SKILLS)];
    if (/traditions?/.test(what)) return ['tradition', Object.values(TRADITIONS)];
    if (/martial or rare weapons|martial weapons?/.test(what)) return ['weapon', WEAPONS.martial];
    if (/simple weapons?/.test(what)) return ['weapon', WEAPONS.simple];
    const cat = CATS.find(([re]) => re.test(what));
    return cat ? ['tool', cat[1]()] : null;
  };
  let m;
  while ((m = countRe.exec(p))) {
    const n = NUM[m[1]] ?? 1, chosen = !!m[4];
    const alts = [m[2], ...(m[3] ? m[3].split(/ or (?:a |an |one )?(?:set of )?/).filter(Boolean) : [])];
    const parts = alts.map(keysOf).filter(Boolean);
    const blank = () => { p = p.slice(0, m.index) + ' '.repeat(m[0].length) + p.slice(m.index + m[0].length); };
    // "one language or tool": a choice between kinds, which no single grant holds
    if (!parts.length || new Set(parts.map((x) => x[0])).size > 1) { blank(); continue; }
    const kind = parts[0][0];
    if (kind === 'skill' && !chosen && !/other/.test(m[0])) continue;
    it.counted.push({ kind, n, keys: uniq(parts.flatMap((x) => x[1])) });
    blank();
  }
  if (/\ball gaming sets\b/.test(p)) { it.tool.push(...Object.keys(K.tools.gamingSets)); p = p.replace(/\ball gaming sets\b/, ' '); }
  if (/\ball musical instruments\b/.test(p)) { it.tool.push(...Object.keys(K.tools.musicalInstruments)); p = p.replace(/\ball musical instruments\b/, ' '); }
  // "any one artisan's tool kit" inside an options list
  const anyCat = /\bany (?:one )?(artisans? tool kits?|artisans? tools|musical instruments?|gaming sets?)\b/.exec(p);
  if (anyCat) { it.tool.push(...CATS.find(([re]) => re.test(anyCat[1]))[1]()); p = p.replace(anyCat[0], ' '); }
  if (/\bsaving throws?\b/.test(p)) {
    for (const [w, a] of Object.entries(ABIL)) if (new RegExp('\\b' + w + '\\b').test(p)) it.savingThrow.push(a);
    p = p.replace(/\b(strength|dexterity|constitution|intelligence|wisdom|charisma)\b/g, ' ');
  }
  for (const t of ['light', 'medium', 'heavy']) if (new RegExp('\\b' + t + '(?: armor|,| and| or)[^.]*?\\barmor\\b|\\b' + t + ' armor\\b').test(p)) it.armor.push(t);
  if (/\bshields?\b/.test(p) && !/\bmetal shields?\b/.test(p)) it.armor.push('shield');
  if (/\ball martial weapons\b|\bmartial weapons\b/.test(p)) it.weapon.push(...WEAPONS.martial);
  if (/\bsimple weapons\b/.test(p)) it.weapon.push(...WEAPONS.simple);
  for (const [n, k] of Object.entries(WEAPON_NAMES)) if (WEAPONISH.test(n) && p.includes(' ' + n + ' ')) it.weapon.push(k);
  it.skill.push(...skillsIn(p.replace(/\bskill specialt\w*/g, ' ')));
  it.tool.push(...toolsIn(p));
  it.tradition.push(...traditionsIn(p));
  it.language.push(...langsIn(p));
  for (const k of Object.keys(it)) if (k !== 'counted') it[k] = uniq(it[k]);
  return it;
}
const KINDS = ['skill', 'tool', 'armor', 'weapon', 'savingThrow', 'tradition', 'language'];
const kindsOf = (it) => uniq(KINDS.filter((k) => it[k].length).concat(it.counted.map((c) => c.kind)));

const sentences = (t) => String(t).replace(/\.\s+and\b/g, ', and').split(/(?<=[.!?])\s+(?=[A-Z“"(•])/);
const CONDITIONAL = /\b(while|when(?:ever)?|if|until|unless|for (?:the next|\d+|one|a)|as an? (?:bonus )?action|as a reaction|reaction|as part of|during|on a hit|each time|can use|you can|you may|so long as|nonmagical|non-magical|from attackers|from (?:nonmagical|effects))\b/i;
/** Drop "At 3rd level," / "When you choose this archetype at 3rd level," from the front of a sentence. */
const LEAD = [
  /^(?:also )?(?:starting |beginning )?(?:at|by|from) \d+(?:st|nd|rd|th)(?:,? (?:and )?\d+(?:st|nd|rd|th))* levels?\b,?\s*/i,
  /^(?:also )?(?:starting |beginning )?when you (?:choose|select|join|take|adopt|enter|swear|pick)\b[^,.]*?(?:\bat \d+(?:st|nd|rd|th) level\b|\blevel\b)(?: when you [^,.]*)?,?\s*/i,
  /^(?:also )?when you (?:choose|select|join|take|adopt|enter|swear|pick) this [a-z ]+?,\s*/i,
  /^(?:in addition|additionally|also|finally|furthermore),?\s*/i
];
const lead = (s) => { let t = s; for (let i = 0; i < 3; i++) for (const re of LEAD) t = t.replace(re, ''); return t; };
const SUBJECT_OTHER = /\b(companion|falcon|mount|steed|bear|ally|allies|creature|target|swarm|minion|familiar|hound|drone|beast|servant|construct|vehicle|homunculus|it|they|that creature|each)\b/i;

function detectGrants(blocksText) {
  const base = { skill: [], tool: [], armor: [], weapon: [], savingThrow: [], tradition: [], language: [] };
  const choices = [];
  const expertise = new Set();
  const specs = [];
  const other = [];

  for (const block of blocksText) {
    const blockConditional = /^(?:•\s*)?(if|while|when|whenever)\b/i.test(lead(block.trim()));
    for (const raw of sentences(block)) {
      const s = lead(raw.trim());
      const cond = blockConditional || /^(if|while|when|whenever|until|unless)\b/i.test(s);

      // ── proficiency clauses of the character ─────────────────
      const re = /\b(?:gain(?:s)?(?: a| an)?(?: bonus)? proficienc(?:y|ies)|(?:become|are|is) (?:also )?(?:always )?(?:considered (?:to be )?)?proficient|choose (?:one|two|three) of the following to (?:be|become) proficient)\s*(?:in|with)?:?\s*([^.;]*)/gi;
      let m;
      while (!cond && (m = re.exec(s))) {
        const before = s.slice(0, m.index);
        const last = before.split(/[,;]| and /).pop() || '';
        if (/\b(if|unless|when|while|whenever|does not|do not|not|never|instead)\b/i.test(last) || /\bdoes not grant you\b/i.test(before)) continue;
        if (!/\byou\b/i.test(before) && SUBJECT_OTHER.test(before)) continue;
        if (/\byou\b/i.test(before) === false && before.trim() && !/^choose/i.test(m[0])) { if (SUBJECT_OTHER.test(last)) continue; }
        if (/\b(your|its|their|the) (hunting )?(companion|falcon|mount|steed|bear|familiar|drone|swarm|minion|ally)\b/i.test(last)) continue;
        let clause = m[1].split(/\b(?:if you already|instead|you can|you may|and can|and may|and you|, and your|which you|who|that you can|until|for the purposes?|while|as long as|and gain (?:an )?expertise)\b/i)[0];
        const forcedChoice = /^choose (one|two|three)/i.exec(m[0]);
        // split at the choice marker
        const mk = /\b(one|two|three|four|a single)\s+(?:other\s+)?(?:of the following|from the following)(?:\s+(?:skills|tools|options|list))?:?|\byour choice of\b|\beither\b/i.exec(clause);
        let basePart = clause, optPart = '', n = 1;
        if (forcedChoice) { basePart = ''; optPart = clause; n = NUM[forcedChoice[1].toLowerCase()]; }
        else if (mk) { basePart = clause.slice(0, mk.index); optPart = clause.slice(mk.index + mk[0].length); n = NUM[(mk[1] || '').toLowerCase()] ?? 1; }
        const bi = itemsIn(basePart);
        // "Arcana, History, Nature, or Religion" / "Wisdom or Charisma saving throws": one kind, joined by or
        if (!optPart && /\bor\b/i.test(basePart)) {
          const kinds = KINDS.filter((k) => bi[k].length);
          if (kinds.length === 1 && bi[kinds[0]].length >= 2 && !bi.counted.length) { optPart = basePart; basePart = ''; n = 1; }
        }
        const b2 = optPart ? itemsIn(basePart) : bi;
        for (const k of KINDS) base[k].push(...b2[k]);
        for (const c of b2.counted) choices.push({ kind: c.kind, options: c.keys, total: c.n });
        if (optPart) {
          const oi = itemsIn(optPart);
          const kinds = kindsOf(oi);
          if (kinds.length === 1) {
            const k = kinds[0];
            const opts = uniq([...oi[k], ...oi.counted.filter((c) => c.kind === k).flatMap((c) => c.keys)]);
            const total = oi.counted.length && !oi[k].length ? oi.counted[0].n : n;
            if (opts.length) choices.push({ kind: k, options: opts, total });
          }
          // several kinds in one choice ("light armor, Arcana, ...") is not a grant a5e can hold: the text stays
        }
        // specialties named in this clause: "Arcana and the aberrations skill specialty"
        specs.push(...specialtiesIn(clause, skillsIn(clause)));
      }

      // ── specialties outside a proficiency clause ─────────────
      if (!cond && /speciali?t(?:y|ies)/i.test(s) && !/\bproficien/i.test(s)) {
        const sm = /\b(two|three|one|a|an)(?: additional)? specialt(?:y|ies) in ([A-Z][a-z]+(?: [A-Z][a-z]+)*)/.exec(s);
        if (sm && /\byou (?:also )?gain\b/i.test(s)) {
          const sk = skillsIn(sm[2])[0];
          if (sk) specs.push(...SPECIALTIES.filter((x) => x.skill === sk).map((x) => ({ skill: sk, key: x.key, choice: true, total: NUM[sm[1]] || 1 })));
        } else if (/\byou (?:also )?(?:gain|learn|have)\b/i.test(s)) specs.push(...specialtiesIn(s, skillsIn(s)));
      }

      // ── expertise dice on skills ─────────────────────────────
      const exRe = /\b(?:you )?(?:also )?(?:gain|have) (?:an |a d\d )?expertise di(?:e|ce) (?:on|with|in|for|to) ([^.;]*)/gi;
      let em;
      while (!cond && (em = exRe.exec(s))) {
        const before = s.slice(0, em.index);
        if (/\b(if|instead|when|while|until|for the next|so long as)\b/i.test(before.split(/[,;]/).pop() || '') || /\binstead\b/i.test(em[1])) continue;
        if (!/\byou\b/i.test(before) && before.trim()) continue;
        for (const part of (/\bchecks? and (?:on )?checks?\b|\bas well as\b/i.test(em[1]) ? em[1].split(/\band (?=(?:on )?checks?\b)|\bas well as\b/i) : [em[1]])) {
          if (/\b(when|while|made to|to (?:track|find|resist|recall|identify|notice|discern|communicate|avoid|escape|overcome|learn|detect|undertake)|against|involving|related|about|requiring)\b/i.test(part)) continue;
          let sk = skillsIn(part);
          if (!sk.length && /\b(them|those skills|these skills|either|those|the chosen skills?)\b/i.test(part)) sk = skillsIn(before);
          sk.forEach((k) => expertise.add(k));
        }
      }

      // ── languages ────────────────────────────────────────────
      const lm = /\b(?:you (?:also )?(?:learn to |can )?)?speak, read,?[^.;]*?\b(?:write|sign)\b,?(?: and (?:write|sign))? ([^.;]*)/i.exec(s)
              || /\byou (?:also )?learn (?:to speak )?(?:the )?([A-Z][a-z]+(?: Speech| Cant)?)\b/.exec(s);
      if (!cond && lm && !/\bif\b[^,]*$/i.test(s.slice(0, lm.index))) base.language.push(...langsIn(lm[1].split(/\bif\b|\band you\b|,\s*and\b/)[0]));

      // ── senses, movement, resistances, ability scores: outright only ──
      if (!cond && !CONDITIONAL.test(s.replace(/^you also /i, 'you '))) {
        const sn = /\byou (?:also )?(?:gain|have|now have) (darkvision|blindsight|tremorsense|truesight)(?: out)?(?: to a range of| with a range of| to| of)? (\d+) (?:feet|ft)/i.exec(s);
        if (sn && !/\bincreas/i.test(s.slice(sn.index, sn.index + 80))) other.push({ grantType: 'senses', label: sn[1][0].toUpperCase() + sn[1].slice(1).toLowerCase(), senses: { base: [sn[1].toLowerCase()] }, bonus: sn[2] });
        const mv = /\byou (?:also )?(?:gain|have) an? ((?:climb|climbing|swim|swimming|fly|flying|burrow|burrowing) speed(?:,? (?:and )?(?:an? )?(?:climb|climbing|swim|swimming|fly|flying|burrow|burrowing) speed)*) (?:equal to your (?:base |walking )?speed\b|of (\d+) feet)/i.exec(s);
        if (mv) {
          const types = uniq(mv[1].toLowerCase().match(/climb|swim|fly|burrow/g));
          other.push({ grantType: 'movement', label: types.map((t) => t[0].toUpperCase() + t.slice(1)).join(' and ') + ' Speed', bonus: mv[2] ?? '@attributes.movement.walk.distance', movementTypes: { base: types } });
        }
        const rs = /\byou (?:also )?(?:gain|have) (resistance|immunity) to ((?:(?:acid|bludgeoning|cold|fire|force|lightning|necrotic|piercing|poison|psychic|radiant|slashing|thunder)(?:,? (?:and )?)?)+) damage/i.exec(s);
        if (rs) {
          const types = rs[2].toLowerCase().match(/acid|bludgeoning|cold|fire|force|lightning|necrotic|piercing|poison|psychic|radiant|slashing|thunder/g);
          other.push({ grantType: 'trait', label: rs[1][0].toUpperCase() + rs[1].slice(1) + 's', traits: { base: types, options: [], total: 0, traitType: rs[1].toLowerCase() === 'resistance' ? 'damageResistances' : 'damageImmunities' } });
        }
        const ab = /\byour (strength|dexterity|constitution|intelligence|wisdom|charisma) score increases by (\d)/i.exec(s);
        if (ab) other.push({ grantType: 'ability', label: 'Ability Score Increase', bonus: ab[2], abilities: { base: [ABIL[ab[1].toLowerCase()]] }, context: { types: ['base'] } });
      }
    }
  }

  const grants = [];
  const LABEL = { skill: 'Skill Proficiencies', tool: 'Tool Proficiencies', armor: 'Armor Proficiencies', weapon: 'Weapon Proficiencies', savingThrow: 'Saving Throw Proficiencies', tradition: 'Combat Traditions', language: 'Languages' };
  const push = (kind, b, o, total) => {
    if (kind === 'language') grants.push({ grantType: 'trait', label: LABEL.language, traits: { base: b, options: o, total, traitType: 'languages' } });
    else grants.push({ grantType: 'proficiency', proficiencyType: kind, label: LABEL[kind], keys: { base: b, options: o, total }, ...(kind === 'armor' ? { isExpertise: false } : {}) });
  };
  for (const k of KINDS) { const b = uniq(base[k]); if (b.length) push(k, b, [], 0); }
  const seenChoice = new Set();
  for (const c of choices) {
    const b = uniq(base[c.kind]);
    const o = uniq(c.options).filter((x) => !b.includes(x));
    const key = c.kind + o.join(',') + c.total;
    if (!o.length || seenChoice.has(key)) continue;
    seenChoice.add(key);
    push(c.kind, [], o, Math.min(c.total || 1, o.length));
  }
  if (expertise.size) grants.push({ grantType: 'expertiseDice', label: 'Expertise Dice', keys: { base: [...expertise], options: [], total: 0 }, expertiseType: 'skill' });
  const bySkill = {};
  for (const sp of specs) (bySkill[sp.skill] ??= { base: new Set(), options: new Set(), total: 0 })[sp.choice ? 'options' : 'base'].add(sp.key);
  for (const sp of specs) if (sp.choice) bySkill[sp.skill].total = Math.max(bySkill[sp.skill].total, sp.total || 1);
  for (const [skill, v] of Object.entries(bySkill)) {
    grants.push({ grantType: 'skillSpecialty', label: `${SKILLS[skill].replace(/\b\w/g, (c) => c.toUpperCase())} Specialty`, skill,
      specialties: { base: [...v.base], options: [...v.options].filter((x) => !v.base.has(x)), total: v.options.size ? v.total : 0 } });
  }
  const seenOther = new Set();
  for (const g of other) { const k = JSON.stringify(g); if (!seenOther.has(k)) { seenOther.add(k); grants.push(g); } }
  return grants;
}

/** "the aberrations skill specialty", "Nature and its fey speciality" */
function specialtiesIn(clause, skillsNamed = []) {
  if (!/speciali?t(?:y|ies)/i.test(clause)) return [];
  const out = [];
  // each "X skill specialty" phrase, tied to the skill named just before it
  const re = /\b(?:the|its|a|an)?\s*([a-z][a-z ]{1,30}?) (?:skill )?speciali?t(?:y|ies)\b/gi;
  let m;
  while ((m = re.exec(clause))) {
    const name = flat(m[1]).replace(/^(the|its|a|an) /, '');
    const cands = SPECIALTIES.filter((x) => name === x.name || name.endsWith(' ' + x.name));
    if (!cands.length) continue;
    const beforeSkills = skillsIn(clause.slice(0, m.index));
    const skill = beforeSkills[beforeSkills.length - 1];
    const pick = cands.find((c) => c.skill === skill) ?? (cands.length === 1 ? cands[0] : cands.find((c) => skillsNamed.includes(c.skill)));
    if (pick && !out.some((o) => o.key === pick.key && o.skill === pick.skill)) out.push({ skill: pick.skill, key: pick.key });
  }
  return out;
}

module.exports = { detectGrants, sentences, SKILLS, TRADITIONS, flat, K, specialtiesIn, SPECIALTIES, itemsIn };
