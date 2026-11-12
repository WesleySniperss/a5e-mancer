/**
 * The companion classes of Martial Artistry (a5e 1.4.10 and later): the levels a
 * Sentinel's companion takes - Acolyte, Construct, Cultist, Fey, Hedge Wizard,
 * Hunter, Mage, Scoundrel, Squire, Undead. Their tables run by "Sentinel Level"
 * and "Companion Level", and a5e's class pack holds them beside the classes a
 * character is built from, with nothing else to tell them apart.
 *
 * A player character does not start in one or multiclass into one, so the
 * builder and the level-up's multiclass list leave them out. a5e's own sheet
 * still takes them, for the companion itself.
 *
 * A file of its own: a name added to a file a cached copy of the module may
 * already hold breaks at link time (the Forge keeps old files under the same URL).
 */
export const COMPANION_CLASSES = new Set(['acolyte', 'construct', 'cultist', 'fey', 'hedge wizard', 'hunter', 'mage', 'scoundrel', 'squire', 'undead']);

/** Only a5e's own pack is read so: a homebrew "Hunter" class elsewhere is a class. */
export function isCompanionClass(name, packCollection) {
  return packCollection === 'a5e.a5e-classes' && COMPANION_CLASSES.has(String(name ?? '').toLowerCase().trim());
}
