// Uses and a usable action read from a feature's text, in a5e's shapes.
const { sentences } = require('./grants.cjs');

const ABIL = { strength: 'str', dexterity: 'dex', constitution: 'con', intelligence: 'int', wisdom: 'wis', charisma: 'cha' };
const DMG = 'acid|bludgeoning|cold|fire|force|lightning|necrotic|piercing|poison|psychic|radiant|slashing|thunder';

function restOf(s) {
  if (/short or long rest|short rest or (?:a )?long rest|short or a long rest|either a short or long|any rest/i.test(s)) return 'shortRest';
  if (/long rest|per day|each day|between long rests|dawn/i.test(s)) return 'longRest';
  if (/short rest/i.test(s)) return 'shortRest';
  return null;
}
function countFormula(s) {
  const m = /(?:a )?number of times (?:per day |per long rest )?equal to (twice |half )?your (?:(?:\w+ )?level|proficiency (?:bonus|modifier)|(strength|dexterity|constitution|intelligence|wisdom|charisma) modifier)(?: \(minimum of (?:once|one|1)\)| \(minimum 1\)|,? \(?minimum of once\)?)?/i.exec(s);
  if (!m) return null;
  let f;
  if (/proficiency/i.test(m[0])) f = '@prof';
  else if (m[2]) f = `@${ABIL[m[2].toLowerCase()]}.mod`;
  else return null;
  if (/twice/i.test(m[1] || '')) f = `${f} * 2`;
  if (/half/i.test(m[1] || '')) f = `floor(${f} / 2)`;
  if (/minimum/i.test(m[0]) || m[2]) f = `max(1, ${f})`;
  return f;
}

/** { value, max, per, recharge } or null */
function detectUses(plain) {
  for (const s of sentences(plain)) {
    const low = s.toLowerCase();
    if (/\b(your|its|the) (companion|mount|falcon|bear|familiar|ally)\b/i.test(s)) continue;
    // "Once you use this feature, you can't use it again until you finish a long rest."
    if (/\bonce you(?: have)? use[ds]? (?:this|it|that|the chosen)|once you have used (?:this|it|that|the chosen)|after you use this (?:ability|feature|trait)|once this feature has been used|you can(?:no|')?t use (?:it|this feature) again until/i.test(s)
        && /\buntil you (?:finish|complete)|\buntil you have finished|\bbefore you can use it again|\bagain until/i.test(s)) {
      const per = restOf(s); if (!per) continue;
      return { value: 0, max: countFormula(s) ?? (/\btwice\b/.test(low) ? '2' : '1'), per, recharge: { formula: '1d6', threshold: 6 } };
    }
    // "You can use this feature a number of times equal to your proficiency bonus, and you regain all expended uses when you finish a long rest."
    const f = countFormula(s);
    if (f && /\b(use|do so|perform|activate|cast|invoke|call|summon)\b/i.test(s)) {
      const per = restOf(s) ?? restOf(plain.slice(plain.indexOf(s)).split(/(?<=[.!?])\s+/).slice(1, 2).join(' '));
      if (per) return { value: 0, max: f, per, recharge: { formula: '1d6', threshold: 6 } };
    }
    const once = /\bonce (?:per|each|between) (short or long rest|short rest|long rest|long rests|day)\b/i.exec(s);
    if (once && /\b(you can|you may|can be used)\b/i.test(s)) return { value: 0, max: '1', per: restOf(once[0]) ?? 'longRest', recharge: { formula: '1d6', threshold: 6 } };
    const times = /\b(two|three) times (?:per|each|between) (short or long rest|short rest|long rest|long rests|day)\b/i.exec(s);
    if (times) return { value: 0, max: times[1] === 'two' ? '2' : '3', per: restOf(times[0]) ?? 'longRest', recharge: { formula: '1d6', threshold: 6 } };
  }
  return null;
}

const ACT = [
  [/\bas a bonus action\b|\buse (?:a|your) bonus action\b|\bspend a bonus action\b|\bcan use a bonus action\b|\bbonus action to\b/i, 'bonusAction'],
  [/\bas a reaction\b|\buse your reaction\b|\bspend (?:a|your) reaction\b|\buse a reaction\b|\breaction to\b/i, 'reaction'],
  [/\bas an action\b|\buse (?:an|your) action\b|\bspend(?:ing)? an action\b|\byou can use an action\b|\buse the magic action\b/i, 'action']
];

/** The action a feature is used by, or null for a passive one. */
function detectAction(name, plain, { uses = null, caster = true, rid }) {
  const ss = sentences(plain);
  let act = null, at = -1, trigger = '';
  ss.some((s, i) => {
    // an action the character takes - not a companion's, not a creature's
    if (/\b(companion|mount|falcon|bear|familiar|creature|target|ally|minion) (?:can|must|may|uses?)\b/i.test(s) && !/\byou can\b/i.test(s)) return false;
    const hits = ACT.map(([re, type]) => { const m = re.exec(s); return m ? [m.index, type] : null; }).filter(Boolean).sort((a, b) => a[0] - b[0]);
    if (!hits.length) return false;
    act = hits[0][1]; at = i;
    if (act === 'reaction') {
      const w = /^(?:also,? |additionally,? |in addition,? )?((?:when|whenever|if)\b[^,]*),/i.exec(s);
      if (w) trigger = w[1].replace(/\s+/g, ' ').slice(0, 200);
    }
    return true;
  });
  if (!act && !uses) return null;
  const from = at >= 0 ? ss.slice(at).join(' ') : plain;

  const action = {
    name,
    activation: { type: act ?? 'special', cost: 1, reactionTrigger: trigger },
    prompts: {}, rolls: {}, consumers: {}
  };
  const dur = /\bfor (1|one|10|ten) (minute|hour|round)s?\b/i.exec(from);
  if (dur) action.duration = { unit: `${dur[2].toLowerCase()}s`, value: String({ one: 1, ten: 10 }[dur[1].toLowerCase()] ?? dur[1]) };

  const sv = new RegExp('\\b(strength|dexterity|constitution|intelligence|wisdom|charisma) saving throw', 'i').exec(from);
  if (sv) {
    const sentence = sentences(from).find((x) => x.includes(sv[0])) ?? '';
    let saveDC = { type: caster ? 'spellcasting' : 'maneuver' };
    if (/spell save DC|spell DC/i.test(sentence)) saveDC = { type: 'spellcasting' };
    else if (/maneuver (?:save )?DC/i.test(sentence)) saveDC = { type: 'maneuver' };
    else {
      const dc = /DC (?:equal to |of )?8 \+ your proficiency bonus \+ your (strength|dexterity|constitution|intelligence|wisdom|charisma) modifier/i.exec(sentence);
      if (dc) saveDC = { type: ABIL[dc[1].toLowerCase()] };
    }
    action.prompts[rid('p')] = { type: 'savingThrow', default: true, ability: ABIL[sv[1].toLowerCase()], saveDC, label: '',
      onSave: /half (?:as much )?(?:the )?damage/i.test(from) ? 'Half damage' : '' };
  }
  const dm = new RegExp(`\\b(\\d+d\\d+(?:\\s*\\+\\s*(?:your (?:strength|dexterity|constitution|intelligence|wisdom|charisma) modifier|your proficiency bonus|\\d+))?)(?: points of)? (${DMG}) damage`, 'i').exec(from)
          || new RegExp(`\\b(${DMG}) damage equal to (?:your )?(proficiency bonus|(strength|dexterity|constitution|intelligence|wisdom|charisma) modifier)`, 'i').exec(from);
  if (dm) {
    let formula, type;
    if (/^\d+d\d+/.test(dm[1])) {
      formula = dm[1].replace(/your (strength|dexterity|constitution|intelligence|wisdom|charisma) modifier/i, (_x, a) => `@${ABIL[a.toLowerCase()]}.mod`).replace(/your proficiency bonus/i, '@prof').replace(/\s+/g, ' ');
      type = dm[2].toLowerCase();
    } else {
      type = dm[1].toLowerCase();
      formula = /proficiency/i.test(dm[2]) ? '@prof' : `@${ABIL[dm[3].toLowerCase()]}.mod`;
    }
    action.rolls[rid('r')] = { type: 'damage', default: true, formula, damageType: type, label: '', canCrit: false };
  } else {
    const hl = /\bregains? (\d+d\d+(?:\s*\+\s*(?:your \w+ modifier|your proficiency bonus|\d+))?) hit points/i.exec(from)
            || /\b(\d+d\d+(?:\s*\+\s*(?:your \w+ modifier|your proficiency bonus|\d+))?) temporary hit points/i.exec(from);
    if (hl) {
      const formula = hl[1].replace(/your (\w+) modifier/i, (_x, a) => (ABIL[a.toLowerCase()] ? `@${ABIL[a.toLowerCase()]}.mod` : _x)).replace(/your proficiency bonus/i, '@prof');
      action.rolls[rid('r')] = { type: 'healing', default: true, formula, healingType: /temporary/i.test(hl[0]) ? 'temporaryHealing' : 'healing', label: '' };
    }
  }
  if (uses) action.consumers[rid('c')] = { type: 'itemUses', default: true, quantity: 1 };
  const ex = /\bspend(?:ing)? (\d+|one|two|three) exertion\b/i.exec(from);
  if (ex) action.consumers[rid('x')] = { type: 'resource', default: !uses, resource: 'exertion', quantity: Number({ one: 1, two: 2, three: 3 }[ex[1].toLowerCase()] ?? ex[1]) };
  return action;
}

module.exports = { detectUses, detectAction };
