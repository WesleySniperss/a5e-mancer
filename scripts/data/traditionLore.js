/**
 * What each combat tradition is, in its own book's words. Nothing here is
 * written by us.
 *
 * The eleven core ones come from the Level Up: Advanced 5e Adventurer's Guide,
 * from the paragraph that opens each tradition's maneuver list.
 *
 * Two more come from a5e.tools, which turned out to carry flavour text for some
 * of the later traditions after all — on `taxonomy/term/<id>`, not on the
 * `traditions/<slug>` pages that were checked first and which carry only a list
 * of maneuvers. The core eleven have no prose even there, so the two paths hold
 * different things and both had to be looked at.
 *
 * Keys are a5e's own, as used in CONFIG.A5E.maneuverTraditions.
 *
 * The rest are still absent rather than invented. Of the 27 traditions the
 * system knows, a5e.tools hosts maneuvers for only 15; Arcane Knight (613) and
 * Beast Unity (612) are hosted but carry no prose, and the remaining twelve —
 * the Voidrunner and third-party ones, Ace Starfighter and Viper's Fangs among
 * them — are not on the site at all. For any tradition missing here the dialog
 * falls back to looking its description up in the compendium.
 */
export const TRADITION_LORE = {
  /* From a5e.tools taxonomy/term/840. Gate Pass Gazette. */
  gallantHeart: {
    keywords: 'Honor, Glamour, Presentation',
    intro: `Combat, in all of its bleak mundanity, is so much more to those who wield Gallant Heart maneuvers. Dramatic flairs, honorable duels, glamorous attire — fighters using this tradition know how to turn a battle into something truly stylish.`
  },
  /* From a5e.tools taxonomy/term/616. The note about antimagic is the
     site's own text, kept because it is the tradition's defining limit. */
  eldritchBlackguard: {
    keywords: '',
    intro: `Terror and pain can be unleashed through those willing to delve into dark magics and blend them with martial prowess. Note. Unlike normal combat maneuvers, mystical martial maneuvers cannot be used where magic is suppressed, such as within an antimagic field or similar effect.`
  },
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

/* ============================================================
   OUR OWN SUMMARIES — not from any book
   ============================================================
   Eleven traditions the module can show but nobody publishes a description
   for: they come from Gate Pass Gazette, the Voidrunner line and third-party
   products, and their text is in books we do not have. It is not in the
   Adventurer's Guide, not on a5e.tools (taxonomy/term/612 and /613 answer
   NONE), not in the a5e system's journal pack, which holds only conditions,
   and not in any installed module.

   So these are written from what each tradition's maneuvers actually do, read
   out of the compendium in the reporter's own world. They are a summary, not a
   quotation, and they are kept in a SEPARATE export for that reason: whatever
   happens to this file later, the boundary between what a book said and what
   we wrote stays visible.

   No keyword lines. The real traditions have them — "Hardiness, Might, Power"
   and the rest — and inventing three words to sit in the same place, in the
   same type, would make ours indistinguishable from the published ones inside
   a year. An empty line says honestly that we do not know them, and leaves an
   obvious slot if a book ever turns up.
   ============================================================ */
export const TRADITION_NOTES = {
  arcaneArtillery: `A bow needs no spell to kill, but it profits from one. Practitioners of Arcane Artillery lay the magic on the shot rather than the shooter: an arrow that splits in flight, one that fades out of the world and back in at the target, one that drags a tempest along behind it. Most of the tradition is about reaching what ought to be out of reach.`,

  arcaneKnight: `Steel need not stop at what the arm can reach. Arcane Knight techniques feed magic into the swing itself — a blade arriving wreathed in flame or frost, a step taken through space rather than across it, a ward thrown over an ally in the same motion that parries. The spell and the strike are one movement.`,

  awakenedMind: `The mind reaches further than the arm and arrives sooner. These warriors fight with attention itself: pinning a foe by intruding on their thoughts, hurling a weapon and calling it back, reading the next attack before it is thrown. Insight does the work that weapon skill does elsewhere.`,

  beastUnity: `Two bodies with one intent, though only one of them takes orders. Beast Unity is the craft of directing an animal companion mid-battle — striking with it in tandem, bringing down something a size larger than it is, calling it back out of reach the moment it is hurt. As much of the tradition protects the companion as arms it.`,

  comedicJabs: `An opponent braced for a blade is not braced for a punchline. Those who fight with Comedic Jabs disarm in the older sense of the word: a pratfall that takes an enemy down with them, a drink poured into a snarling mouth, a gift pressed on someone who came to kill them. Nobody swings well while off balance.`,

  cuttingOmen: `Magic held in reserve is magic doing nothing. This tradition spends it — a spell slot burned to put weight behind a strike, a school's power poured into a parry, resolve traded back for reserves once they run dry. Nearly every technique asks what you will give up to make the next hit land.`,

  grindingCog: `A warrior's pack is an arsenal if they are quick enough with it. Grinding Cog turns oil flasks, caltrops, manacles and a crowbar into combat techniques: armour pried open, ground made impassable, fire and oil landing in the same square. It rewards whoever packed for the problem.`,

  sanctifiedSteel: `Some enemies are not merely killed. Sanctified Steel arms the faithful against them — holy water anointing a blade, silver worked hastily onto a striking edge, radiance carried on from one wound into the next. Its techniques ask for a prepared prayer as often as an opening.`,

  selflessSentinel: `The point is not to win the exchange but to see that someone else survives it. A Selfless Sentinel stands where the blow will fall: swapping places with an ally mid-strike, catching one who drops, making themselves the only target worth attacking. Almost nothing here improves your own attack.`,

  viciousVein: `Being wounded is a condition, and a condition can be used. Vicious Vein draws on blood already spilled — strikes that open arteries, a blade drawn through one's own wound, a heartbeat amplified until it unsettles the room. Several of these techniques only work once you are bloodied.`,

  vipersFangs: `A dose costs less than a wound and outlasts it. Viper's Fangs is fought with what is on the blade rather than the blade itself: blinding dust, a toxin that saps the limbs, curare that stops them altogether. Its practitioners spend poison the way others spend stamina.`,
};
