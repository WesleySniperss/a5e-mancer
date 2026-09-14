/**
 * Magic Maneuvers — catalogue and progression.
 *
 * Data only: names, schools, degrees, costs, triggers, flavour and effect text,
 * plus the level table. No Foundry calls, so it can be verified on its own.
 *
 * The flavour lines and school text are translations of the author's originals
 * from the specification. Item descriptions are built as italic flavour followed
 * by the mechanical text; the school text belongs to the school and is not
 * repeated on every maneuver.
 */

/** Schools. Ids are transliterations of the working names in the spec. */
export const MM_SCHOOLS = {
  stykhia:      'Elements',
  esentsia:     'Essence',
  probiy:       'Breach',
  vlada:        'Dominion',
  utrymannia:   'Hold',
  provydinnia:  'Foresight'
};

/** School text, shown on the school rather than duplicated onto each maneuver. */
export const MM_SCHOOL_LORE = {
  stykhia:     `An element that does not go out on impact but stays on the target: binding, eating away, smouldering.`,
  esentsia:    `Damage beyond the elements — the kind that strikes not the body but the essence.`,
  probiy:      `Magic that reaches an enemy where they are certain they cannot be reached.`,
  vlada:       `Mastery over another's will, another's spells and another's body: to plant a thought, to turn a spell against its owner. And with an open hand, to mend what is broken and wash the taint from an ally.`,
  utrymannia:  `The magic of tenacity: concentration holds despite a failure, lethal overflow carries onward instead of vanishing, a shield strikes back. Nothing ends before its time.`,
  provydinnia: `In casting you touch the weave — and read through it more than the spell itself: what the target is warded against, where it is thin, what it will do a moment from now. The spell stays yours; what you learn from it arms the whole party.`
};

/** Only these four full casters have access. Sorcerer/Warlock/Witch do not. */
export const MM_CLASSES = ['wizard', 'cleric', 'druid', 'bard'];

/**
 * Progression thresholds. Levels between them keep the previous row, which is
 * what MagicManeuvers.progressionAt resolves.
 *   known      — how many maneuvers are known in total
 *   schools    — how many schools may be open
 *   maxDegree  — highest degree that may be learned
 */
export const MM_PROGRESSION = [
  { level: 3,  known: 2, schools: 2, maxDegree: 1 },
  { level: 5,  known: 3, schools: 2, maxDegree: 1 },
  { level: 7,  known: 4, schools: 2, maxDegree: 2 },
  { level: 9,  known: 5, schools: 3, maxDegree: 2 },
  { level: 11, known: 6, schools: 3, maxDegree: 2 },
  { level: 13, known: 7, schools: 3, maxDegree: 3 },
  { level: 15, known: 8, schools: 4, maxDegree: 3 },
  { level: 17, known: 8, schools: 4, maxDegree: 3 }
];

/**
 * The maneuvers.
 *
 *   degree      gates learning by level (1 from 3rd, 2 from 7th, 3 from 13th).
 *               Independent of cost — a 1st-degree maneuver may cost 3.
 *   cost        exertion spent on activation
 *   trigger     what the cast must be for this to be offered
 *   activation  'cast' | 'bonusAction' | 'reaction' | 'triggered' | 'special'
 *   reactionTrigger  for a reaction, the trigger a5e shows on the action:
 *               "Reaction (When ...)", as its own maneuvers do
 *   consumesState  true for the shared "next attack on the target" state; false
 *               when the maneuver carries a duration of its own
 */
export const MAGIC_MANEUVERS = [
  /* ── Elements ─────────────────────────────────────────── */
  { id: 'ice', name: 'Ice', school: 'stykhia', degree: 1, cost: 1,
    trigger: 'damageType', damageType: 'cold', activation: 'cast', consumesState: true,
    flavor: `The chill binds the joints; flesh turns brittle.`,
    effect: `When a spell or cantrip you cast deals cold damage to a creature, the next attack made against that creature treats it as vulnerable to bludgeoning damage.` },

  { id: 'acid', name: 'Acid', school: 'stykhia', degree: 1, cost: 1,
    trigger: 'damageType', damageType: 'acid', activation: 'cast', consumesState: true,
    flavor: `Eaten-through hide parts under the blade.`,
    effect: `When a spell or cantrip you cast deals acid damage to a creature, the next attack made against that creature treats it as vulnerable to slashing damage.` },

  { id: 'fire', name: 'Fire', school: 'stykhia', degree: 1, cost: 1,
    trigger: 'damageType', damageType: 'fire', activation: 'cast', consumesState: false,
    flavor: `Flame catches hold and finishes the meal.`,
    effect: `When a spell or cantrip you cast deals fire damage to a creature that already took fire damage since the start of your previous turn, the creature takes that earlier fire damage again.` },

  { id: 'thunder', name: 'Thunder', school: 'stykhia', degree: 2, cost: 2,
    trigger: 'damageType', damageType: 'thunder', activation: 'cast', consumesState: false,
    flavor: `The blow deafens the world.`,
    effect: `When a spell or cantrip you cast deals thunder damage to a creature, it is deafened until the start of your next turn. Until then, whenever it casts a spell with a verbal component, it must first succeed on a Constitution saving throw against your spell save DC or the spell fails.` },

  { id: 'lightning', name: 'Lightning', school: 'stykhia', degree: 2, cost: 2,
    trigger: 'damageType', damageType: 'lightning', activation: 'cast', consumesState: false,
    flavor: `Across water the charge finds everyone.`,
    effect: `When a spell or cantrip you cast deals lightning damage to a creature standing on a wet surface, in water, or in the rain, the damage also spreads to each hostile creature within 15 feet of it.` },

  { id: 'poison', name: 'Poison', school: 'stykhia', degree: 3, cost: 3,
    trigger: 'damageType', damageType: 'poison', activation: 'cast', consumesState: false,
    flavor: `The venom smoulders until the body beats it.`,
    effect: `When a spell or cantrip you cast deals poison damage to a creature, the venom lingers for up to 1 minute. At the start of each of its turns, the creature makes a saving throw against your maneuver DC, using the ability the spell calls for. On a failure, it takes a -1 penalty to its d20 rolls, and the penalty grows by 1 with each further failure. On a success, the effect and the penalty end.` },

  /* ── Essence ──────────────────────────────────────────── */
  { id: 'force', name: 'Force', school: 'esentsia', degree: 1, cost: 1,
    trigger: 'damageType', damageType: 'force', activation: 'cast', consumesState: true,
    flavor: `The kinetic blow leaves the body open to the point.`,
    effect: `When a spell or cantrip you cast deals force damage to a creature, the next attack made against that creature treats it as vulnerable to piercing damage.` },

  { id: 'psychic', name: 'Psychic', school: 'esentsia', degree: 1, cost: 1,
    trigger: 'damageType', damageType: 'psychic', activation: 'cast', consumesState: false,
    flavor: `The mind is cracked open and defenceless.`,
    effect: `When a spell or cantrip you cast deals psychic damage to a creature, it has disadvantage on its next Intelligence, Wisdom, or Charisma saving throw made before the start of your next turn.` },

  { id: 'necrotic', name: 'Necrotic', school: 'esentsia', degree: 2, cost: 3,
    trigger: 'damageType', damageType: 'necrotic', activation: 'cast', consumesState: false,
    flavor: `The next wound will feed you.`,
    effect: `When a spell or cantrip you cast deals necrotic damage to a creature, the next attack made against a hostile creature within 30 feet of you heals you for half the damage it deals. This happens once, and only while you are conscious.` },

  { id: 'radiant', name: 'Radiant', school: 'esentsia', degree: 2, cost: 2,
    trigger: 'damageType', damageType: 'radiant', activation: 'cast', consumesState: false,
    flavor: `A second light finds what hid from the first.`,
    effect: `When you make a spell attack roll with a spell or cantrip that deals radiant damage against a creature you dealt radiant damage to in the previous round, you make the attack roll with advantage.` },

  { id: 'peak', name: 'Peak', school: 'esentsia', degree: 3, cost: 4,
    trigger: 'damageType', damageType: 'any', activation: 'bonusAction', consumesState: false,
    flavor: `Magic carried to its limit.`,
    effect: `When you cast a spell or cantrip that deals damage, you can use a bonus action to make each of its damage dice count as its highest number.` },

  /* ── Breach ───────────────────────────────────────────── */
  { id: 'bypass', name: 'Bypass', school: 'probiy', degree: 1, cost: 1,
    trigger: 'spellAttack', activation: 'cast', consumesState: false,
    flavor: `Neither shield nor wall will serve.`,
    effect: `When you make a spell attack roll with a spell or cantrip, the attack ignores the target's bonus to AC from a shield and from cover.` },

  { id: 'reflection', name: 'Reflection', school: 'probiy', degree: 2, cost: 2,
    trigger: 'touchRange', activation: 'cast', consumesState: false,
    flavor: `A touch through glass and water.`,
    effect: `When you cast a spell or cantrip with a range of Touch, its range becomes as far as you can see, provided you can see the target through something transparent or reflective, such as glass, water, or a mirror.` },

  { id: 'bend', name: 'Bend', school: 'probiy', degree: 2, cost: 2,
    trigger: 'lineOrRay', activation: 'cast', consumesState: false,
    flavor: `The beam turns the corner.`,
    effect: `When you cast a spell or cantrip that creates a line or a ray, you can bend it once at an angle to go around cover or a corner. You don't need to see the target: you can instead choose a 10-foot cube the target is in, and the spell affects the target there.` },

  { id: 'pressure', name: 'Pressure', school: 'probiy', degree: 1, cost: 1,
    trigger: 'damagingSpell', activation: 'cast', consumesState: false,
    flavor: `The magic grazes even as it passes by.`,
    effect: `When a spell or cantrip you cast misses a creature, or the creature succeeds on its saving throw against it, the creature still takes half the spell's damage.` },

  { id: 'resonance', name: 'Resonance', school: 'probiy', degree: 2, cost: 2,
    trigger: 'savingThrow', activation: 'cast', consumesState: false,
    flavor: `The second blow lands where the first is still ringing.`,
    effect: `When you cast a spell or cantrip that forces a saving throw, a creature makes that saving throw with disadvantage if a spell or cantrip of the same school was already cast at it earlier this round.` },

  /* ── Dominion ─────────────────────────────────────────── */
  { id: 'suggestion', name: 'Suggestion', school: 'vlada', degree: 1, cost: 2,
    trigger: 'enchantment', activation: 'cast', consumesState: false,
    flavor: `The thought settles, and the trace is wiped away.`,
    effect: `When you cast an enchantment spell or cantrip, it has no visible source, and a creature that succeeds on its saving throw against it does not realize it was charmed.` },

  { id: 'countercast', name: 'Countercast', school: 'vlada', degree: 3, cost: 3,
    trigger: 'enemyCast', activation: 'reaction', reactionTrigger: 'When a hostile creature you can see casts a spell or cantrip', consumesState: false,
    flavor: `Another's charm turns on its owner.`,
    effect: `When a hostile creature you can see casts a spell or cantrip, you can turn it back on its caster for half its cost, provided you have that same spell or cantrip prepared or known. Make a spellcasting ability check contested by the caster's spellcasting ability check. On a success, the spell targets its caster instead.` },

  { id: 'generous-hand', name: 'Open Hand', school: 'vlada', degree: 2, cost: 2,
    trigger: 'healing', activation: 'cast', consumesState: false,
    flavor: `Mercy poured out in full.`,
    effect: `When you cast a spell or cantrip that restores hit points, each of its healing dice counts as its highest number.` },

  { id: 'cleansing', name: 'Cleansing', school: 'vlada', degree: 2, cost: 2,
    trigger: 'healing', activation: 'cast', consumesState: false,
    flavor: `Where the grace is whole, the taint flees.`,
    effect: `When you cast a spell or cantrip that restores hit points, choose one negative condition or effect on the target. Its remaining duration is reduced by 1 round for each healing die that rolled its highest number.` },

  /* ── Hold ─────────────────────────────────────────────── */
  { id: 'recall', name: 'Recall', school: 'utrymannia', degree: 1, cost: 1,
    trigger: 'readiedSpell', activation: 'special', consumesState: false,
    flavor: `You call back the raised spell before it is too late.`,
    effect: `When you have readied a spell or cantrip, you can release it without casting it, and the spell slot is not expended.` },

  { id: 'harvest', name: 'Harvest', school: 'utrymannia', degree: 2, cost: 1,
    trigger: 'onKill', activation: 'reaction', reactionTrigger: 'When your spell or cantrip reduces a hostile creature to 0 hit points', consumesState: false,
    flavor: `One death feeds the next blow.`,
    effect: `When a spell or cantrip you cast reduces a hostile creature to 0 hit points, the damage beyond what it needed carries over to another hostile creature you can see within 15 feet of it.` },

  { id: 'ricochet', name: 'Ricochet', school: 'utrymannia', degree: 2, cost: 1,
    trigger: 'savingThrow', activation: 'reaction', reactionTrigger: 'When a creature succeeds on a saving throw against your spell or cantrip', consumesState: false,
    flavor: `It was not the spell that missed. It was the mark.`,
    effect: `When a creature succeeds on its saving throw against a spell or cantrip you cast, the spell does not end. It passes to the hostile creature you can see nearest that creature within 20 feet, which makes the same saving throw against the same DC. If two creatures are equally near, you choose. The spell passes only once: it ends if the new creature succeeds, and it can't pass to a creature it has already targeted.` },

  { id: 'riposte', name: 'Riposte', school: 'utrymannia', degree: 2, cost: 4,
    trigger: 'shield', activation: 'reaction', reactionTrigger: 'When your ward or shield absorbs damage from a melee attack', consumesState: false,
    flavor: `The shield strikes back.`,
    effect: `When a ward or shield effect from a spell or cantrip you cast absorbs damage from a melee attack, the attacker takes damage equal to half the damage absorbed.` },

  { id: 'steadfast', name: 'Steadfast', school: 'utrymannia', degree: 3, cost: 4,
    trigger: 'concentration', activation: 'reaction', reactionTrigger: 'When you fail a saving throw to maintain concentration on a spell', consumesState: false,
    flavor: `Rooted, you will not be moved — and the charm will not fall.`,
    effect: `When you fail a saving throw to maintain concentration on a spell, you can use your reaction to keep concentrating on it until the end of your next turn, and your speed is halved for the same time. When that time ends, you can use your reaction and spend this maneuver's exertion again to extend both by another round in the same way.` },

  /* ── Foresight ────────────────────────────────────────── */
  { id: 'insight', name: 'Insight', school: 'provydinnia', degree: 1, cost: 1,
    trigger: 'any', activation: 'cast', consumesState: false,
    flavor: `You see what the target is warded against.`,
    effect: `When you cast a spell or cantrip at a creature, you learn its damage resistances and immunities.` },

  { id: 'premonition', name: 'Premonition', school: 'provydinnia', degree: 2, cost: 1,
    trigger: 'any', activation: 'cast', consumesState: false,
    flavor: `You feel where it is thin.`,
    effect: `When you cast a spell or cantrip at a creature, you learn which of its saving throws is the weakest.` },

  { id: 'farsight', name: 'Farsight', school: 'provydinnia', degree: 3, cost: 3,
    trigger: 'any', activation: 'cast', consumesState: false,
    flavor: `You look a turn ahead.`,
    effect: `When you cast a spell or cantrip, choose one hostile creature you can see. You learn the specific spell or action it will take on its next turn.` }
];
