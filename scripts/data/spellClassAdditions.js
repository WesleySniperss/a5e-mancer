/**
 * Classes a5e's pack leaves off a spell, by the spell's id, as a5e.tools
 * lists them. Compared 2026-10-20 over the 422 spells both have: Message and
 * Sufferer's Pact name no class at all, so no list offered them ("Message
 * is not among the wizard's cantrips"), and Stonesense lacks the wizard.
 * Witch's Broom and Calatyr's Explosive Conflagration name none either; the
 * site does not have them, and the second comes with its archetype.
 *
 * Read by the module's spell windows (SpellService.spellAllowsClass) and put
 * into the pack's index for a5e's own compendium browser, whose Spell Lists
 * filter reads system.classes there (compendiumIndexFix).
 */
export const SPELL_CLASS_ADDITIONS = {
  '4gcxix2l4zvy9kdu': ['artificer', 'bard', 'herald', 'sorcerer', 'wizard'],   // Message
  'fnw0f5ou3h8z4nb4': ['bard', 'druid', 'herald', 'warlock'],                  // Sufferer's Pact
  '22j2esam1cirwedf': ['wizard']                                                // Stonesense
};
