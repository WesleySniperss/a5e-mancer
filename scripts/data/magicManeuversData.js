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
/* From 2nd level, and ten known by 20th (2026-09-16, by request). One more
   every other level to 14th, then at 17th and 20th; a second degree at 6th,
   a third at 12th; a third school at 8th and a fourth at 14th. */
export const MM_PROGRESSION = [
  { level: 2,  known: 2,  schools: 2, maxDegree: 1 },
  { level: 4,  known: 3,  schools: 2, maxDegree: 1 },
  { level: 6,  known: 4,  schools: 2, maxDegree: 2 },
  { level: 8,  known: 5,  schools: 3, maxDegree: 2 },
  { level: 10, known: 6,  schools: 3, maxDegree: 2 },
  { level: 12, known: 7,  schools: 3, maxDegree: 3 },
  { level: 14, known: 8,  schools: 4, maxDegree: 3 },
  { level: 17, known: 9,  schools: 4, maxDegree: 3 },
  { level: 20, known: 10, schools: 4, maxDegree: 3 }
];

/**
 * The maneuvers.
 *
 *   degree      gates learning by level (1 from 2nd, 2 from 6th, 3 from 12th).
 *               Independent of cost — a 1st-degree maneuver may cost 3.
 *   cost        exertion spent on activation
 *   trigger     what the cast must be for this to be offered
 *   activation  when it is used: 'damage' (as a spell or cantrip deals its damage),
 *               'cast' (as part of casting), 'miss' (when the spell misses or its
 *               target succeeds on the save), 'readyEnd' (when a readied spell is let
 *               go), 'bonusAction', 'reaction', 'special'
 *   flavor      the narrative first paragraph of the description
 *   reactionTrigger  for a reaction, the trigger a5e shows on the action:
 *               "Reaction (When ...)", as its own maneuvers do
 *   consumesState  true for the shared "next attack on the target" state; false
 *               when the maneuver carries a duration of its own
 */
export const MAGIC_MANEUVERS = [
  /* ── Elements ─────────────────────────────────────────── */
  { id: 'ice', name: 'Ice', school: 'stykhia', degree: 1, cost: 1,
    trigger: 'damageType', damageType: 'cold', activation: 'damage', consumesState: true,
    flavor: `Frost-wardens of the high passes teach that cold is not a blow but a grip. Their magic settles into the joints and marrow of whatever it strikes and lingers there, until flesh and bone grow brittle enough to shatter under a hammer or a heel.`,
    effect: `When you deal cold damage to a creature with a spell or cantrip, you can use this maneuver as the damage is dealt. Until the end of your next turn, the next attack made against that creature treats it as vulnerable to bludgeoning damage.` },

  { id: 'acid', name: 'Acid', school: 'stykhia', degree: 1, cost: 1,
    trigger: 'damageType', damageType: 'acid', activation: 'damage', consumesState: true,
    flavor: `Alchemist-mages and the fen witches know that a hide eaten through is a hide that no longer holds. The corrosion their magic leaves behind keeps working at scale and leather, opening the way for any edge that follows.`,
    effect: `When you deal acid damage to a creature with a spell or cantrip, you can use this maneuver as the damage is dealt. Until the end of your next turn, the next attack made against that creature treats it as vulnerable to slashing damage.` },

  { id: 'fire', name: 'Fire', school: 'stykhia', degree: 1, cost: 1,
    trigger: 'damageType', damageType: 'fire', activation: 'damage', consumesState: false,
    flavor: `A fire that has already caught never truly goes out. Pyromancers learn to fan the embers left in a burned foe, so that the flames of the last spell flare again and finish what they started.`,
    effect: `When you deal fire damage with a spell or cantrip to a creature that already took fire damage since the start of your previous turn, you can use this maneuver as the damage is dealt. The creature takes that earlier fire damage again.` },

  { id: 'thunder', name: 'Thunder', school: 'stykhia', degree: 2, cost: 2,
    trigger: 'damageType', damageType: 'thunder', activation: 'damage', consumesState: false,
    flavor: `A thunderclap does more than bruise: it takes the world away. The ringing it leaves drowns out the words a spellcaster needs, and a mage deafened in the middle of an incantation stumbles over syllables that were second nature a moment before.`,
    effect: `When you deal thunder damage to a creature with a spell or cantrip, you can use this maneuver as the damage is dealt. Until the end of your next turn, the creature is deafened, and whenever it casts a spell with a verbal component, it must first succeed on a Constitution saving throw against your spell save DC or the spell fails.` },

  { id: 'lightning', name: 'Lightning', school: 'stykhia', degree: 2, cost: 2,
    trigger: 'damageType', damageType: 'lightning', activation: 'damage', consumesState: false,
    flavor: `Storm-callers of the coasts learned their craft in the rain, where a single bolt runs through every soaked warrior in a shield wall. Wherever water gathers, their lightning follows it and finds everyone who stands too close.`,
    effect: `When you deal lightning damage with a spell or cantrip to a creature standing on a wet surface, in water, or in the rain, you can use this maneuver as the damage is dealt. The damage also spreads to each hostile creature within 15 feet of it.` },

  { id: 'poison', name: 'Poison', school: 'stykhia', degree: 3, cost: 3,
    trigger: 'damageType', damageType: 'poison', activation: 'damage', consumesState: false,
    flavor: `Venom-weavers do not hurry. Their magic seeps into the blood and smoulders there, sapping strength a little more with every heartbeat, until the body either burns it out or gives in.`,
    effect: `When you deal poison damage to a creature with a spell or cantrip, you can use this maneuver as the damage is dealt. The venom lingers for up to 1 minute. At the start of each of its turns, the creature makes a saving throw against your maneuver DC, using the ability the spell calls for. On a failure, it takes a -1 penalty to its d20 rolls, and the penalty grows by 1 with each further failure. On a success, the effect and the penalty end.` },

  /* ── Essence ──────────────────────────────────────────── */
  { id: 'force', name: 'Force', school: 'esentsia', degree: 1, cost: 1,
    trigger: 'damageType', damageType: 'force', activation: 'damage', consumesState: true,
    flavor: `Pure force strikes without flame or frost, a blow of shaped will that knocks armor askew and the breath from the lungs. In the moment after, the body lies open, and the point of a spear or an arrow finds its way through.`,
    effect: `When you deal force damage to a creature with a spell or cantrip, you can use this maneuver as the damage is dealt. Until the end of your next turn, the next attack made against that creature treats it as vulnerable to piercing damage.` },

  { id: 'psychic', name: 'Psychic', school: 'esentsia', degree: 1, cost: 1,
    trigger: 'damageType', damageType: 'psychic', activation: 'damage', consumesState: false,
    flavor: `A mind struck by psychic magic is a door knocked off its hinges. For a few heartbeats its owner cannot gather their thoughts, and the reason, will, or presence they would call on to resist lies scattered.`,
    effect: `When you deal psychic damage to a creature with a spell or cantrip, you can use this maneuver as the damage is dealt. Until the end of your next turn, the creature has disadvantage on its next Intelligence, Wisdom, or Charisma saving throw.` },

  { id: 'necrotic', name: 'Necrotic', school: 'esentsia', degree: 2, cost: 3,
    trigger: 'damageType', damageType: 'necrotic', activation: 'damage', consumesState: false,
    flavor: `Necromancers say that every wound is a debt. With a touch of dying magic they mark a foe as the first payment, and the life spilled by the next blow flows back to the caster instead of into the dirt.`,
    effect: `When you deal necrotic damage to a creature with a spell or cantrip, you can use this maneuver as the damage is dealt. Until the end of your next turn, the next attack made against a hostile creature within 30 feet of you heals you for half the damage it deals. This happens once, and only while you are conscious.` },

  { id: 'radiant', name: 'Radiant', school: 'esentsia', degree: 2, cost: 2,
    trigger: 'damageType', damageType: 'radiant', activation: 'damage', consumesState: false,
    flavor: `Light that has found its mark once will find it again. Priests of the dawn teach that radiance leaves a trace on those it burns, a glow no shadow can hide, which guides the next spell home or strips away the will to withstand it.`,
    effect: `When you deal radiant damage to a creature with a spell or cantrip, you can use this maneuver as the damage is dealt. Until the end of your next turn, your next spell attack roll against that creature has advantage or, if your next spell or cantrip against it calls for a saving throw instead, the creature makes that saving throw with disadvantage.` },

  { id: 'peak', name: 'Peak', school: 'esentsia', degree: 3, cost: 4,
    trigger: 'damageType', damageType: 'any', activation: 'bonusAction', consumesState: false,
    flavor: `At the very edge of their power, a caster can pour everything they have into a single working. Nothing is held back and nothing is left to chance; the spell strikes with all the force it was ever capable of.`,
    effect: `When you cast a spell or cantrip that deals damage, you can use a bonus action to make each of its damage dice count as its highest number.` },

  /* ── Breach ───────────────────────────────────────────── */
  { id: 'bypass', name: 'Bypass', school: 'probiy', degree: 1, cost: 1,
    trigger: 'spellAttack', activation: 'cast', consumesState: false,
    flavor: `Shields and walls are made to stop steel and arrows, and spellcraft is neither. A mage who knows the trick lets their magic slip past the rim of a buckler and over the lip of a parapet as if neither were there at all.`,
    effect: `When you cast a spell or cantrip that makes a spell attack, you can use this maneuver as part of casting it. The attack ignores the target's bonus to AC from a shield and from cover.` },

  { id: 'reflection', name: 'Reflection', school: 'probiy', degree: 2, cost: 2,
    trigger: 'touchRange', activation: 'cast', consumesState: false,
    flavor: `Mirror-mages learned long ago that a reflection is a doorway. Where glass, still water, or polished steel shows the target, their touch can pass through the image and land as surely as if they stood beside it.`,
    effect: `When you cast a spell or cantrip with a range of Touch, you can use this maneuver as part of casting it. The spell's range becomes as far as you can see, provided you can see the target through something transparent or reflective, such as glass, water, or a mirror.` },

  { id: 'bend', name: 'Bend', school: 'probiy', degree: 2, cost: 2,
    trigger: 'lineOrRay', activation: 'cast', consumesState: false,
    flavor: `A line of fire or a ray of frost need not run straight. Battle-mages who learned their trade at sieges curl their spells around corners and over barricades, striking foes who believed themselves safely out of sight.`,
    effect: `When you cast a spell or cantrip that creates a line or a ray, you can use this maneuver as part of casting it. You can bend the line or ray once at an angle to go around cover or a corner. You don't need to see the target: you can instead choose a 10-foot cube the target is in, and the spell affects the target there.` },

  { id: 'pressure', name: 'Pressure', school: 'probiy', degree: 1, cost: 1,
    trigger: 'damagingSpell', activation: 'miss', consumesState: false,
    flavor: `Even a spell that goes wide carries weight. The pressure of the magic rushing past is enough to bruise, scorch, or chill, and a skilled caster makes certain that no one walks away from their work untouched.`,
    effect: `When a spell or cantrip you cast misses a creature, or the creature succeeds on its saving throw against it, you can use this maneuver at that moment. The creature still takes half the spell's damage.` },

  { id: 'resonance', name: 'Resonance', school: 'probiy', degree: 2, cost: 2,
    trigger: 'savingThrow', activation: 'cast', consumesState: false,
    flavor: `Magic of a single school rings like a struck bell, and a second strike lands before the first has fallen silent. Casters who work in concert learn to layer their spells until the echoes overwhelm whatever defenses remain.`,
    effect: `When you cast a spell or cantrip that forces a saving throw, you can use this maneuver as part of casting it. A creature makes that saving throw with disadvantage if a spell or cantrip of the same school was already cast at it earlier this round.` },

  /* ── Dominion ─────────────────────────────────────────── */
  { id: 'suggestion', name: 'Suggestion', school: 'vlada', degree: 1, cost: 2,
    trigger: 'enchantment', activation: 'cast', consumesState: false,
    flavor: `The subtlest enchanters leave no trace of their passing. Their charms arrive like a stray thought, and even those strong enough to shrug one off never realize that a stranger's will brushed against their own.`,
    effect: `When you cast an enchantment spell or cantrip, you can use this maneuver as part of casting it. The spell has no visible source, and a creature that succeeds on its saving throw against it does not realize it was charmed.` },

  { id: 'countercast', name: 'Countercast', school: 'vlada', degree: 3, cost: 3,
    trigger: 'enemyCast', activation: 'reaction', reactionTrigger: 'When a hostile creature you can see casts a spell or cantrip', consumesState: false,
    flavor: `Every spell is a thread, and a thread can be pulled from either end. Those who master dominion seize a hostile incantation as it forms and turn it about, so that the enemy's own magic breaks upon its caster.`,
    effect: `When a hostile creature you can see casts a spell or cantrip, you can turn it back on its caster for half its cost, provided you have that same spell or cantrip prepared or known. Make a spellcasting ability check contested by the caster's spellcasting ability check. On a success, the spell targets its caster instead.` },

  { id: 'generous-hand', name: 'Open Hand', school: 'vlada', degree: 2, cost: 2,
    trigger: 'healing', activation: 'cast', consumesState: false,
    flavor: `Healers of the old orders held that mercy should never be measured out. When they open their hand, the grace that pours through it is given in full, and the wounded rise as whole as the magic can make them.`,
    effect: `When you cast a spell or cantrip that restores hit points, you can use this maneuver as part of casting it. Each of its healing dice counts as its highest number.` },

  { id: 'cleansing', name: 'Cleansing', school: 'vlada', degree: 2, cost: 2,
    trigger: 'healing', activation: 'cast', consumesState: false,
    flavor: `Where healing flows strongest, corruption has nothing to cling to. The same grace that closes wounds burns away poisons, curses, and lingering ills, and the more complete the mending, the faster the taint flees.`,
    effect: `When you cast a spell or cantrip that restores hit points, you can use this maneuver as part of casting it. Choose one negative condition or effect on the target. Its remaining duration is reduced by 1 round for each healing die that rolled its highest number.` },

  /* ── Hold ─────────────────────────────────────────────── */
  { id: 'recall', name: 'Recall', school: 'utrymannia', degree: 1, cost: 1,
    trigger: 'readiedSpell', activation: 'readyEnd', consumesState: false,
    flavor: `A readied spell is a drawn bowstring, and a careless mage either lets the arrow fly or lets it fall. The disciplined call their magic back to themselves instead, unspent, to be shaped again when the moment is right.`,
    effect: `When you let a spell or cantrip you have readied go without releasing it, you can use this maneuver at that moment. The spell ends without effect, and the spell slot you spent to ready it is not expended.` },

  { id: 'harvest', name: 'Harvest', school: 'utrymannia', degree: 2, cost: 1,
    trigger: 'onKill', activation: 'reaction', reactionTrigger: 'When your spell or cantrip reduces a hostile creature to 0 hit points', consumesState: false,
    flavor: `When a spell kills, the power that ended one life does not vanish with it. Reapers who fight on battlefields learn to catch that leftover force and send it on to the next foe standing close by.`,
    effect: `When a spell or cantrip you cast reduces a hostile creature to 0 hit points, the damage beyond what it needed carries over to another hostile creature you can see within 15 feet of it.` },

  { id: 'ricochet', name: 'Ricochet', school: 'utrymannia', degree: 2, cost: 1,
    trigger: 'savingThrow', activation: 'reaction', reactionTrigger: 'When a creature succeeds on a saving throw against your spell or cantrip', consumesState: false,
    flavor: `A spell that fails to take hold is not wasted, only unfinished. The caster's will turns it aside from the one who resisted and sends it seeking another, the way a thrown stone skips from one wave to the next.`,
    effect: `When a creature succeeds on its saving throw against a spell or cantrip you cast, the spell does not end. It passes to the hostile creature you can see nearest that creature within 20 feet, which makes the same saving throw against the same DC. If two creatures are equally near, you choose. The spell passes only once: it ends if the new creature succeeds, and it can't pass to a creature it has already targeted.` },

  { id: 'riposte', name: 'Riposte', school: 'utrymannia', degree: 2, cost: 4,
    trigger: 'shield', activation: 'reaction', reactionTrigger: 'When your ward or shield absorbs damage from a melee attack', consumesState: false,
    flavor: `Wardens teach that a shield should do more than endure. Their protective magic remembers every blow it turns aside and returns part of that violence to the hand that struck.`,
    effect: `When a ward or shield effect from a spell or cantrip you cast absorbs damage from a melee attack, the attacker takes damage equal to half the damage absorbed.` },

  { id: 'steadfast', name: 'Steadfast', school: 'utrymannia', degree: 3, cost: 4,
    trigger: 'concentration', activation: 'reaction', reactionTrigger: 'When you fail a saving throw to maintain concentration on a spell', consumesState: false,
    flavor: `When pain or the chaos of battle threatens to tear a spell apart, the steadfast plant their feet and hold on. They move slowly and speak through gritted teeth, but the magic they sustain does not fall.`,
    effect: `When you fail a saving throw to maintain concentration on a spell, you can use your reaction to keep concentrating on it until the end of your next turn, and your speed is halved for the same time. When that time ends, you can use your reaction and spend this maneuver's exertion again to extend both by another round in the same way.` },

  /* ── Foresight ────────────────────────────────────────── */
  { id: 'insight', name: 'Insight', school: 'provydinnia', degree: 1, cost: 1,
    trigger: 'any', activation: 'cast', consumesState: false,
    flavor: `To a trained eye, every spell cast is also a question. As their magic touches a foe, diviners feel where it catches and where it slides away, and learn what the creature was made to withstand.`,
    effect: `When you cast a spell or cantrip at a creature, you can use this maneuver as part of casting it. You learn the creature's damage resistances and immunities.` },

  { id: 'premonition', name: 'Premonition', school: 'provydinnia', degree: 2, cost: 1,
    trigger: 'any', activation: 'cast', consumesState: false,
    flavor: `Every creature has a place where its defenses run thin, and magic finds that place the way water finds a crack. The caster feels it in the moment of casting and knows where the next spell should strike.`,
    effect: `When you cast a spell or cantrip at a creature, you can use this maneuver as part of casting it. You learn which of the creature's saving throws is the weakest.` },

  { id: 'farsight', name: 'Farsight', school: 'provydinnia', degree: 3, cost: 3,
    trigger: 'any', activation: 'cast', consumesState: false,
    flavor: `The greatest seers glimpse not only what is, but what is about to be. As their spell is loosed, the moment ahead unfolds before them, and they see the enemy's next move before the enemy has chosen it.`,
    effect: `When you cast a spell or cantrip, you can use this maneuver as part of casting it. Choose one hostile creature you can see. You learn the specific spell or action it will take on its next turn.` }
];
