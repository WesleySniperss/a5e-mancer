/**
 * What each combat tradition is, in the book's own words.
 *
 * Taken verbatim from the Level Up: Advanced 5e Adventurer's Guide, from the
 * paragraph that opens each tradition's maneuver list. It is NOT on a5e.tools:
 * the per-tradition pages there carry only a list of maneuvers, and the rules
 * page gives a single sentence naming all eleven. It is not in the a5e system
 * either, whose lang file has the names without any description. So a combat
 * tradition showed no text at all where a magic school showed its own, which
 * is the gap this closes.
 *
 * Keys are a5e's own, as used in CONFIG.A5E.maneuverTraditions.
 *
 * Only the eleven the Adventurer's Guide describes are here. Traditions from
 * later books and any homebrew a table adds are deliberately absent rather
 * than invented: the dialog falls back to looking their description up in the
 * compendium, which is where such a tradition's own text belongs.
 */
export const TRADITION_LORE = {
  adamantMountain: {
    keywords: 'Hardiness, Might, Power',
    intro: `Engaging in combat means enduring some amount of suffering and those who make use of Adamant Mountain maneuvers are well prepared to weather their opponents' blows, relying not just on their might but the careful and expert application of force in all aspects of battle.`
  },
  bitingZephyr: {
    keywords: 'Distance, Sharpshooting, Thrown Weapons',
    intro: `Not every battle requires making close contact with the enemy and there is an art to fighting from a distance, whether that be a few dozen feet or hundreds. Warriors that know Biting Zephyr techniques are superlative ranged combatants, not only for the deadly accuracy of their attacks but also the myriad tricks they've mastered to routinely make shots that should be impossible.`
  },
  mirrorsGlint: {
    keywords: 'Flowing, Insightful, Reactive',
    intro: `At its heart combat is a dance between opponents and practicing the Mirror's Glint tradition means reading, interpreting, and anticipating one's foe. Using instinct and your insight from battles won and lost, you are excellent at reacting to an enemy in order to gain the upper hand.`
  },
  mistAndShade: {
    keywords: 'Diversion, Feinting, Mental',
    intro: `Making the wrong move in a fight can be fatal — particularly when an opponent causes such a misstep. Warriors that rely on Mist and Shade maneuvers are confounding foes that play mental games amidst battle, feinting and leading their enemies into crucial mistakes they are all too ready to exploit.`
  },
  rapidCurrent: {
    keywords: 'Fast Strikes, Mobility, Swiftness',
    intro: `It is not always the hardest hits that win a fight — sometimes striking first is far more important. Embracing rapid blows and agility, warriors of the Rapid Current tradition know how to use speed to its utmost to defeat a foe.`
  },
  razorsEdge: {
    keywords: 'Awareness, Concentration, Discipline',
    intro: `The most impressive strikes and superlative parries are not matters of luck or circumstance when made by a warrior utilizing the Razor's Edge — they are the fruits of keen awareness, concentration, and iron-clad discipline.`
  },
  sanguineKnot: {
    keywords: 'Legion, Teamwork, Trust',
    intro: `A battle fought alone is often a battle already lost and practitioners of the Sanguine Knot tradition focus on the opportunities presented when an ally is nearby to help. While they may be weaker alone, these warriors are lethal in tandem and the trust they have for their companions make them truly valuable adventurers to keep nearby.`
  },
  spiritedSteed: {
    keywords: 'Mounted, Soldiering, Warfare',
    intro: `There are many warriors that fight on horseback — or an altogether different kind of creature — and master the tricks of battling in tandem with their mount to overwhelm slower, less mobile foes. The most common adherents to this tradition are soldiers typically born to noble castes with the resources to both keep steeds and pay for the tutelage of their use.`
  },
  temperedIron: {
    keywords: 'Confidence, Conviction, Zealotry',
    intro: `To achieve victory over any opponent a warrior must be confident and those who utilize the techniques of Tempered Iron are certain of their every step and swing, often zealous in their pursuit of a foe and motivated by a daunting drive to succeed no matter the cost.`
  },
  toothAndClaw: {
    keywords: 'Animalistic, Movement, Natural',
    intro: `There is a fundamental need to survive that all creatures tap into during a fight, an urge to endure that can be captured and focused to tremendous effect. Wielders of Tooth and Claw are animalistic in their attacks, moving around in combat and pouncing upon an opponent's every weakness.`
  },
  unendingWheel: {
    keywords: 'Mastery, Patience, Training',
    intro: `There are many facets to combat — how one places their feet, an adroit grip upon a weapon's hilt, the angle of a shield arm — but achieving exceptional skill over specific weaponry can be an efficient means to victory. By patiently focusing your martial studies you unlock secrets that general practitioners of combat never glean, and with dedicated training you master their use.`
  },
};
