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
 * The 26 maneuvers.
 *
 *   degree      gates learning by level (1 from 3rd, 2 from 7th, 3 from 13th).
 *               Independent of cost — a 1st-degree maneuver may cost 3.
 *   cost        exertion spent on activation
 *   trigger     what the cast must be for this to be offered
 *   activation  'cast' | 'reaction' | 'triggered' | 'special'
 *   consumesState  true for the shared "next attack on the target" state; false
 *               when the maneuver carries a duration of its own
 */
export const MAGIC_MANEUVERS = [
  /* ── Elements ─────────────────────────────────────────── */
  { id: 'ice', name: 'Ice', school: 'stykhia', degree: 1, cost: 1,
    trigger: 'damageType', damageType: 'cold', activation: 'cast', consumesState: true,
    flavor: `The chill binds the joints; flesh turns brittle.`,
    effect: `The next attack against the target: vulnerability to bludgeoning damage. The target's speed is reduced by 10 ft until the start of your next turn.` },

  { id: 'acid', name: 'Acid', school: 'stykhia', degree: 1, cost: 1,
    trigger: 'damageType', damageType: 'acid', activation: 'cast', consumesState: true,
    flavor: `Eaten-through hide parts under the blade.`,
    effect: `The next attack against the target: vulnerability to slashing damage.` },

  { id: 'fire', name: 'Fire', school: 'stykhia', degree: 1, cost: 1,
    trigger: 'damageType', damageType: 'fire', activation: 'cast', consumesState: false,
    flavor: `Flame catches hold and finishes the meal.`,
    effect: `When you cast a fire spell or cantrip at a target that has already taken fire damage, it takes that fire damage a second time.` },

  { id: 'thunder', name: 'Thunder', school: 'stykhia', degree: 2, cost: 2,
    trigger: 'damageType', damageType: 'thunder', activation: 'cast', consumesState: false,
    flavor: `The blow deafens the world.`,
    effect: `The target is deafened and cannot cast spells with a verbal component, until the start of your next turn.` },

  { id: 'lightning', name: 'Lightning', school: 'stykhia', degree: 2, cost: 2,
    trigger: 'damageType', damageType: 'lightning', activation: 'cast', consumesState: false,
    flavor: `Across water the charge finds everyone.`,
    effect: `If the target is on a wet surface, in water, or in the rain, the damage spreads to every enemy within 15 ft of the target.` },

  { id: 'poison', name: 'Poison', school: 'stykhia', degree: 3, cost: 3,
    trigger: 'damageType', damageType: 'poison', activation: 'cast', consumesState: false,
    flavor: `The venom smoulders until the body beats it.`,
    effect: `For up to 1 minute: at the start of each of its turns the target makes a saving throw (maneuver DC, ability from the spell). On a failure it remains poisoned and takes −1 to its d20 rolls; on a success the effect ends.` },

  /* ── Essence ──────────────────────────────────────────── */
  { id: 'force', name: 'Force', school: 'esentsia', degree: 1, cost: 1,
    trigger: 'damageType', damageType: 'force', activation: 'cast', consumesState: true,
    flavor: `The kinetic blow leaves the body open to the point.`,
    effect: `The next attack against the target: vulnerability to piercing damage.` },

  { id: 'psychic', name: 'Psychic', school: 'esentsia', degree: 1, cost: 1,
    trigger: 'damageType', damageType: 'psychic', activation: 'cast', consumesState: false,
    flavor: `The mind is cracked open and defenceless.`,
    effect: `The target's next mental saving throw (Int/Wis/Cha) is made with disadvantage, until the start of your next turn.` },

  { id: 'necrotic', name: 'Necrotic', school: 'esentsia', degree: 2, cost: 3,
    trigger: 'damageType', damageType: 'necrotic', activation: 'cast', consumesState: false,
    flavor: `The next wound will feed you.`,
    effect: `While the owner is conscious: the next attack against an enemy within 30 ft of the owner heals the owner for half the damage it deals (once).` },

  { id: 'radiant', name: 'Radiant', school: 'esentsia', degree: 2, cost: 2,
    trigger: 'damageType', damageType: 'radiant', activation: 'cast', consumesState: false,
    flavor: `A second light finds what hid from the first.`,
    effect: `If the owner struck this target with radiant damage in the previous round, this radiant spell is rolled with advantage (or the target has disadvantage on its saving throw against it).` },

  { id: 'peak', name: 'Peak', school: 'esentsia', degree: 3, cost: 3,
    trigger: 'damageType', damageType: 'any', activation: 'cast', consumesState: false,
    maxSpellLevel: 5,
    flavor: `Magic carried to its limit.`,
    effect: `Maximize every damage die of this spell (each die counts as its highest face). Spells of 5th level and lower only. Not a reaction — applied as part of the cast.` },

  /* ── Breach ───────────────────────────────────────────── */
  { id: 'bypass', name: 'Bypass', school: 'probiy', degree: 1, cost: 1,
    trigger: 'spellAttack', activation: 'cast', consumesState: false,
    flavor: `Neither shield nor wall will serve.`,
    effect: `The spell attack of this cast ignores the target's AC bonus from a shield and from cover.` },

  { id: 'reflection', name: 'Reflection', school: 'probiy', degree: 2, cost: 2,
    trigger: 'touchRange', activation: 'cast', consumesState: false,
    flavor: `A touch through glass and water.`,
    effect: `A spell with a range of Touch gains a range equal to line of sight, provided the target is visible through something transparent or reflective (glass, water, a mirror).` },

  { id: 'bend', name: 'Bend', school: 'probiy', degree: 2, cost: 2,
    trigger: 'lineOrRay', activation: 'cast', consumesState: false,
    flavor: `The beam turns the corner.`,
    effect: `A ray or line may be bent once at an angle, to get around cover or a corner.` },

  { id: 'pressure', name: 'Pressure', school: 'probiy', degree: 1, cost: 1,
    trigger: 'damagingSpell', activation: 'cast', consumesState: false,
    flavor: `The magic grazes even as it passes by.`,
    effect: `If the spell attack missed OR the target succeeded on its saving throw, the target still takes half the spell's damage.` },

  { id: 'resonance', name: 'Resonance', school: 'probiy', degree: 2, cost: 2,
    trigger: 'savingThrow', activation: 'cast', consumesState: false,
    flavor: `The second blow lands where the first is still ringing.`,
    effect: `If a spell or cantrip of the same school as this one has already been cast at the target earlier this round, the target makes its saving throw against this spell with disadvantage.` },

  /* ── Dominion ─────────────────────────────────────────── */
  { id: 'suggestion', name: 'Suggestion', school: 'vlada', degree: 1, cost: 2,
    trigger: 'enchantment', activation: 'cast', consumesState: false,
    flavor: `The thought settles, and the trace is wiped away.`,
    effect: `The enchantment spell has no visible source; on a success the target does not realise it was charmed.` },

  { id: 'countercast', name: 'Countercast', school: 'vlada', degree: 3, cost: 3,
    trigger: 'enemyCast', activation: 'reaction', consumesState: false,
    flavor: `Another's charm turns on its owner.`,
    effect: `Reaction to an enemy cast in sight: you turn that spell against its own source for half its cost, provided the owner has that same spell prepared or known. Contest of spellcasting ability (owner against enemy).` },

  { id: 'generous-hand', name: 'Open Hand', school: 'vlada', degree: 2, cost: 2,
    trigger: 'healing', activation: 'cast', consumesState: false,
    flavor: `Mercy poured out in full.`,
    effect: `This spell's healing dice count as maximum.` },

  { id: 'cleansing', name: 'Cleansing', school: 'vlada', degree: 2, cost: 2,
    trigger: 'healing', activation: 'cast', consumesState: false,
    flavor: `Where the grace is whole, the taint flees.`,
    effect: `If this spell's healing dice came up at their natural maximum, the spell additionally removes one negative condition from the target.` },

  /* ── Hold ─────────────────────────────────────────────── */
  { id: 'recall', name: 'Recall', school: 'utrymannia', degree: 1, cost: 1,
    trigger: 'readiedSpell', activation: 'special', consumesState: false,
    flavor: `You call back the raised spell before it is too late.`,
    effect: `You may remove a spell from your readied actions — the spell slot is not spent.` },

  { id: 'harvest', name: 'Harvest', school: 'utrymannia', degree: 2, cost: 1,
    trigger: 'onKill', activation: 'reaction', consumesState: false,
    flavor: `One death feeds the next blow.`,
    effect: `When your spell kills an enemy, the excess damage (beyond its current HP) carries to another enemy within 15 ft.` },

  { id: 'riposte', name: 'Riposte', school: 'utrymannia', degree: 2, cost: 4,
    trigger: 'shield', activation: 'reaction', consumesState: false,
    flavor: `The shield strikes back.`,
    effect: `When your ward or shield effect absorbs damage from a melee attack, it returns half of what it absorbed to the attacker.` },

  { id: 'steadfast', name: 'Steadfast', school: 'utrymannia', degree: 3, cost: 4,
    trigger: 'concentration', activation: 'triggered', consumesState: false,
    flavor: `Rooted, you will not be moved — and the charm will not fall.`,
    effect: `When the owner fails a concentration save, the spell does not end: it holds for one more round despite the failure. While this effect lasts, the owner's speed is halved.` },

  /* ── Foresight ────────────────────────────────────────── */
  { id: 'insight', name: 'Insight', school: 'provydinnia', degree: 1, cost: 1,
    trigger: 'any', activation: 'cast', consumesState: false,
    flavor: `You see what the target is warded against.`,
    effect: `On casting their own spell, the owner learns the resistances and immunities of that spell's target.` },

  { id: 'premonition', name: 'Premonition', school: 'provydinnia', degree: 2, cost: 1,
    trigger: 'any', activation: 'cast', consumesState: false,
    flavor: `You feel where it is thin.`,
    effect: `On casting, the owner learns the weakest saving throw of their spell's target.` },

  { id: 'farsight', name: 'Farsight', school: 'provydinnia', degree: 3, cost: 3,
    trigger: 'any', activation: 'cast', consumesState: false,
    flavor: `You look a turn ahead.`,
    effect: `On casting, the owner learns the specific spell or action one enemy in sight will take next round.` }
];
