/**
 * The conditions a5e's spells put on a creature by their text but carry in no
 * effect - so a failed save from the card put nothing on (Grease, Command,
 * Sunbeam, Flesh to Stone…), and the card had nothing to apply by hand. Read
 * sentence by sentence from a5e 1.5.1's spells pack (895 spells, 248 naming a
 * condition, 2026-11-15); a spell that only names a condition - a ward against
 * it, a cure, an immunity, an invisible sensor - is not here. Asked for:
 * "conditions should come from their spells, and their time come off right".
 *
 *   spell name (lower case, straight apostrophes) → {
 *     give: [[status, when, lasts], …],
 *     own:  false - the spell's own effects are not the failing creature's
 *                   (Holy Aura's blessing is for its allies, the save is the
 *                   attacker's), so a failed save puts on only what is here
 *     fix:  { status: lasts } - an effect a5e gives this spell carries the
 *                   status with no duration, where the text gives one
 *   }
 *
 *   when:  'fail'  the spell's saving throw from its card failed
 *          'pass'  it succeeded (Slow: rattled on a success)
 *          'save'  either way (Chains of Heaven grapple whatever the save)
 *          'card'  no save decides it - a hit, a hit point total, a table, a
 *                  choice: put on from the card by hand only
 *   lasts: 'spell'     the spell's duration
 *          'next'      until the end of the creature's next turn
 *          'nextStart' until the start of the creature's next turn
 *          'yours'     until the start of the caster's next turn
 *          'yoursEnd'  until the end of the caster's next turn
 *          n           n rounds
 *          '10m' '5m' '1h' '30d'  minutes, hours, days
 *          null        until it is ended - standing up, an escape, a cure, or
 *                      the spell's end when it is a concentration spell
 */
export const SPELL_CONDITIONS = {
  'adhering blast': { give: [['blinded', 'card', null], ['grappled', 'card', null], ['deafened', 'card', null], ['confused', 'card', '1m'], ['slowed', 'card', 'next'], ['rattled', 'card', 'next']] },
  'arcane hand': { give: [['grappled', 'card', null]] },
  'augmented awaken': { give: [['charmed', 'card', '30d']] },
  'awaken': { give: [['charmed', 'card', '30d']] },
  'slippery awaken': { give: [['charmed', 'card', '30d']] },
  'banishment': { give: [['incapacitated', 'fail', null]] },
  'icy displeasure': { give: [['incapacitated', 'fail', null]] },
  'battle of wits': { give: [['rattled', 'card', '1m'], ['confused', 'card', '1m'], ['stunned', 'card', 1], ['paralyzed', 'card', 1]] },
  'be ye not afraid': { give: [['frightened', 'card', 'spell'], ['stunned', 'card', 1]] },
  'blinding acid arrow': { give: [['blinded', 'fail', 'next']] },
  'blinding darkness': { give: [['blinded', 'fail', '1m']] },
  'blindness/deafness': { give: [['deafened', 'card', 'spell']] },
  'breath of the dragon': { give: [['prone', 'card', null], ['stunned', 'card', 'yours'], ['frightened', 'card', '1m']] },
  'caustic muck': { give: [['grappled', 'fail', null]] },
  'chains of heaven': { give: [['grappled', 'save', null]] },
  'chains of hell': { give: [['grappled', 'save', null]] },
  'chaos field': { give: [['blinded', 'card', 'nextStart'], ['poisoned', 'card', 'nextStart'], ['confused', 'card', 'nextStart'], ['paralyzed', 'card', 'nextStart']] },
  'charm monster': { give: [['charmed', 'fail', 'spell']] },
  'charm person': { give: [['charmed', 'fail', 'spell']] },
  "gorana's inveigling charm monster": { give: [['charmed', 'fail', 'spell']] },
  "gorana's inveigling charm person": { give: [['charmed', 'fail', 'spell']] },
  'clangorous blow': { give: [['deafened', 'fail', '1m']] },
  "cobra's spit": { give: [['poisoned', 'card', 'next']] },
  "vomitous cobra's spit": { give: [['poisoned', 'card', 'next']] },
  'color spray': { give: [['blinded', 'card', 'yours']] },
  'command': { give: [['prone', 'card', null]] },
  'contagion': { give: [['stunned', 'card', 'next']] },
  'corpse explosion': { give: [['poisoned', 'fail', '1m']] },
  'cosmic injunction': { give: [['slowed', 'card', 'next']] },
  'crashing wave': { give: [['prone', 'fail', null]] },
  'creeping phantasmal killer': { give: [['frightened', 'fail', null]] },
  'draining phantasmal killer': { give: [['frightened', 'fail', null]] },
  'phantasmal killer': { give: [['frightened', 'fail', null]] },
  'cruel puppeteer': { give: [['prone', 'card', null]] },
  'effigy': { give: [['prone', 'card', null]] },
  'puppetmaster': { give: [['prone', 'card', null]] },
  'crushing haymaker': { give: [['prone', 'fail', null], ['stunned', 'fail', 'next']] },
  'dismissal': { give: [['stunned', 'card', 'yours']] },
  'dispel evil and good': { give: [['stunned', 'card', 'yours']] },
  'edict: arrest': { give: [['rattled', 'card', 'nextStart']] },
  'edict: away': { give: [['prone', 'card', null], ['rattled', 'card', 'nextStart']] },
  'edict: collapse': { give: [['rattled', 'card', 'nextStart']] },
  'edict: flee': { give: [['rattled', 'card', 'nextStart']] },
  'fiendish antipathy/sympathy': { give: [['frightened', 'fail', null]] },
  'flammable grease': { give: [['prone', 'fail', null]] },
  'grease': { give: [['prone', 'fail', null]] },
  'grease fire': { give: [['prone', 'fail', null]] },
  'flesh to stone': { give: [['restrained', 'fail', null], ['slowed', 'pass', 'next'], ['petrified', 'card', null]] },
  'punishing flesh to stone': { give: [['restrained', 'fail', null], ['slowed', 'pass', 'next'], ['petrified', 'card', null]] },
  "garnion's caustic geyserblast": { give: [['prone', 'fail', null]] },
  'geyserblast': { give: [['prone', 'fail', null]] },
  "tarol's scalding geyserblast": { give: [['prone', 'fail', null]] },
  'glass barrage': { own: false, give: [['dazzled', 'fail', 'yoursEnd']] },
  'gravity sphere': { give: [['prone', 'fail', null]] },
  'hallow': { give: [['frightened', 'card', null]] },
  'hammerfall': { give: [['prone', 'fail', null]] },
  'heart of dis': { give: [['frightened', 'card', 'yours']] },
  'holy aura': { own: false, give: [['blinded', 'fail', null]] },
  'infernal insect plague': { give: [['frightened', 'fail', null]] },
  'infernal weapon': { give: [['frightened', 'card', 'yoursEnd'], ['slowed', 'card', '1m']] },
  'malevolent infernal weapon': { give: [['frightened', 'card', 'yoursEnd'], ['slowed', 'card', '1m'], ['confused', 'card', null]] },
  'insidious acid arrow': { give: [['poisoned', 'fail', 'next']] },
  'imprisonment': { give: [['restrained', 'fail', null]] },
  'insidious imprisonment': { give: [['restrained', 'fail', null]] },
  'lemure transformation': { give: [['frightened', 'card', 'nextStart']] },
  'mark of exile': { give: [['rattled', 'card', '1m']] },
  'mark of shame': { give: [['stunned', 'pass', 'nextStart']] },
  'modify memory': { give: [['charmed', 'fail', null], ['incapacitated', 'fail', null]] },
  'mudball': { give: [['blinded', 'fail', 'next']] },
  'poison skin': { own: false, give: [['poisoned', 'fail', null]] },
  'power word stun': { give: [['rattled', 'card', 'next']] },
  'maiming power word stun': { give: [['rattled', 'card', 'next']] },
  'prismatic mess': { give: [['blinded', 'card', null], ['restrained', 'card', null]] },
  'prismatic spray': { give: [['blinded', 'card', null], ['restrained', 'card', null]] },
  'prismatic wall': { give: [['blinded', 'card', null], ['restrained', 'card', null]] },
  'raise hell': { give: [['frightened', 'card', 'nextStart']] },
  'rattling faerie fire': { give: [['rattled', 'card', 'next']] },
  'ravaging roots': { give: [['prone', 'card', null], ['restrained', 'card', null]] },
  'resplendent refraction': { give: [['blinded', 'card', 'next']] },
  'righteous strike': { give: [['rattled', 'card', null]] },
  'rotten tomatoes': { give: [['blinded', 'card', 'next']] },
  'searing equation': { give: [['deafened', 'fail', 1]] },
  'shaking thunderwave': { give: [['prone', 'card', null]] },
  'shocking revelation': { give: [['rattled', 'fail', 'next']] },
  'shroud of glory': { own: false, give: [['blinded', 'fail', 'next']] },
  'silence': { give: [['deafened', 'card', null]] },
  'sleep': { give: [['unconscious', 'card', 'spell'], ['rattled', 'card', 'nextStart']] },
  'sleet storm': { give: [['prone', 'fail', null]] },
  'slow': { give: [['rattled', 'pass', 'next']] },
  'snowball': { give: [['prone', 'fail', null]] },
  'sparkler spray': { own: false, give: [['dazzled', 'fail', 'next']] },
  'stomach purge': { give: [['poisoned', 'fail', 'next'], ['rattled', 'fail', 'next'], ['stunned', 'card', 'next']] },
  'storm of vengeance': { give: [['deafened', 'card', '5m']] },
  'stunning eldritch cube': { give: [['stunned', 'card', 'next']] },
  'sunbeam': { give: [['blinded', 'fail', 1]] },
  'superior forcewall': { give: [['prone', 'card', null]] },
  'surfacing wormway': { give: [['prone', 'fail', null]] },
  'wormway': { give: [['prone', 'fail', null]] },
  'telekinesis': { give: [['restrained', 'card', 'yoursEnd']] },
  'tempestuous earthquake': { give: [['prone', 'fail', null]] },
  'trapped passwall': { give: [['prone', 'fail', null]] },
  'tumbleweb': { give: [['grappled', 'fail', null]] },
  'unholy star': { give: [['blinded', 'card', 'yoursEnd']] },
  'unstable blast': { give: [['poisoned', 'card', 'next'], ['deafened', 'card', 'next'], ['rattled', 'card', 'next'], ['confused', 'card', 'next'], ['prone', 'card', null]] },
  // a5e's own effect carries the status, the text gives the time
  'geas': { fix: { charmed: 'spell' } },
  'flashfreeze heatwave': { fix: { restrained: 'yours' } }
};
