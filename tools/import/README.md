# Importing from a5e.tools

Converts a5e.tools pages into a5e documents for three world compendia
(`scripts/utils/importedPack.js`): "A5e Mancer: Imported" holds the heritages,
cultures, backgrounds, destinies, archetypes, feats, combat maneuvers, spells,
psionic powers, magic items and equipment a5e's packs lack, "A5e Mancer:
Imported Monsters" the monsters and "A5e Mancer: Exploration Challenges" the
challenges - a compendium holds one kind of document, and a monster is an
actor, a challenge a journal entry. Run from the module root, with Node 20 or
later:

    node tools/import/prepare.cjs            # 1. a5e's packs and CONFIG maps, from the local install
    node tools/import/fetch-archetypes.cjs   # 2. missing archetypes, and their pages (cached)
    node tools/import/fetch-content.cjs      #    everything else missing, and its pages
    node tools/import/fetch-origins.cjs      #    missing heritages and cultures (two rules pages)
    node tools/import/fetch-monsters.cjs     #    missing monsters, and their pages
    node tools/import/fetch-challenges.cjs   #    the exploration challenges (a5e ships none)
    node tools/import/build-archetypes.cjs   # 3. convert; writes the module's data and a report
    node tools/import/build-content.cjs
    node tools/import/build-origins.cjs
    node tools/import/build-monsters.cjs
    node tools/import/build-challenges.cjs
    node tools/import/check-archetypes.mjs   # 4. check them with the module's own code
    node tools/import/check-content.mjs
    node tools/import/check-origins.mjs
    node tools/import/check-monsters.mjs
    node tools/import/check-challenges.mjs

Everything downloaded or copied goes to `tools/import/.cache`, which git
ignores. Step 3 writes `scripts/data/imported/a5etools-*.json` and
`generated.js`, the manifest over all of them - each file with the count, the
hash and whether it holds items, actors or journal entries. A pack rebuilds
itself in the world when its own hash changes, into a folder per kind.

`prepare` needs Foundry's `classic-level`: it looks for the install at
`D:/Games/FVTT/Foundry Virtual Tabletop/resources/app`, or `FOUNDRY_APP`.

## What the converter does

- **Structure.** A feature starts where the page puts a level image (or an
  unmarked heading that opens a section). Its level is the text's own "At 7th
  level, ..." when the text starts so, else the image's - the images are wrong
  now and then. Subsections are a choice when the feature's last sentence says
  "choose one of the following" and it is a choice made once; lists picked from
  at each rest or each use stay in the text.
- **Grants.** Proficiencies (skills, tools, armor, weapons, saving throws,
  combat traditions), languages, skill specialties, expertise dice, and outright
  senses, speeds, resistances and ability increases, in a5e's own keys. Never a
  companion's, never a conditional one, never half of a choice between kinds of
  thing ("light armor or Arcana" stays text).
- **Uses and actions.** "Once you use this feature ... long rest", "a number of
  times equal to your proficiency bonus": the feature's uses. "As a bonus
  action" / "as a reaction": an action, with a saving throw (and its DC), the
  first damage or healing roll, and what it spends (uses, exertion).
- **Spells.** Spell names are linked to a5e's spells; a list of "3rd  spell,
  spell" lines becomes a table. ProseSpells then grants them as a5e's own
  archetype spell features are granted. A warlock's expanded list is read as a
  list to choose from, and a warlock archetype without one is offered a5e's
  Expanded Spell List choice.
- **Ids** are derived from the archetype and feature names, so a rebuild keeps
  them and a character that took an archetype keeps its links.

## Everything else

- **What is missing** is decided by `lib/match.cjs`: names compared in several
  spellings ("Hand crossbow" / "Crossbow, Hand"), and a generic magic item
  counts as present when a5e has it per variant ("Holy Avenger" / "Holy Avenger
  Longsword", "Weapon +1" / "Longsword +1").
- **Spells** get their level, schools, classes, components, concentration,
  ritual, and one action: casting time, range, duration, target, area, saving
  throw, the first damage or healing roll with its scaling, and the spell
  points a5e's table charges for the level.
- **Psionic powers** are spell items, as a5e models them: a psionic discipline,
  the psion's list, reflex powers at level 0 and I-V at 1-5.
- **Objects** get their kind (from the list's category first, then the name),
  rarity, attunement, price (credits too), weight, charges, and an action where
  the text uses one; weapons and siege engines their attack and damage;
  vehicles and drones their statistics in the text. A mount or a pet is the
  entry a character buys, with a link to a5e's creature to play it from; a
  hireling is what recruiting them costs.
- **Combat maneuvers** get their tradition, degree, exertion, stance, saving
  throw and damage. Two traditions a5e's list lacks (Unerring Hawk, the duels'
  basic maneuvers) are written to `scripts/data/imported/traditions.js` and
  registered by the module beside a5e's own.
- **Feats** are a5e's feat features, with the prerequisite the Add Feat window
  reads, the proficiencies, ability increases and maneuvers their text gives,
  and an action where they have one.
- **Backgrounds** get their ability increase, skill, tool and language
  proficiencies, the suggested equipment as links to a5e's gear, and their
  feature as a document of its own; their connections and mementos are lists
  the builder can roll on.
- **Destinies** get their source of inspiration, inspiration feature and
  fulfillment feature as three documents, linked the way a5e links them, and
  their motivations as a rollable list.
- **Heritages** get a document per named trait and per gift, the gifts of the
  page's variant sections among them, the paragon gifts as a choice at 10th
  level, and grants for size (a choice where the page gives one, none where it
  gives none), speed and creature type. **Cultures** get a document per trait
  and their languages, the ones they know apart from the ones they choose.
  Both read pages that mark nothing in bold, as some do.
- **Monsters** are NPC actors. The head of a stat block is read by pattern out
  of the whole of it, because the lines are broken differently from page to
  page, and in two styles: the older one lists only the saving throws a monster
  is proficient in, the newer one lists all six with their bonuses (proficient
  where the bonus beats the ability's own by the proficiency bonus) and folds
  the skills into an "Initiative" line. Everything after the head is an entry -
  a trait, an action, a bonus action, a reaction, a legendary action - and
  becomes a feature with its attack, saving throw, damage, reach, range and
  uses; a5e's own kinds, so an attack is a natural weapon. Legendary actions
  written as one paragraph of ◆ bullets are split into one entry each, and text
  that names nothing stays in the biography under its own heading. Terrain,
  creature type, size, senses, languages, swarm and elite come off the page's
  fields. What the page does not say is not invented: a page that says the hit
  points vary leaves them at zero, and the report says so.
  Every skill is written, proficient or not, each with a5e's default ability
  (`skillDefaultAbilities`, read by `prepare`). a5e 1.2 filled in the rest
  itself; 1.3 keeps only the skills the data names, and a skill named without
  an ability passes nothing from it into the check or the passive score.
  A Spellcasting or Innate Spellcasting entry becomes a spell book with its
  slots, the caster's level and ability, and the spells it lists - at will,
  so many a day or week, or from slots - kept in the data as references that
  ImportedPack turns into a5e's own spells when it builds the pack, so they
  are not copied into the module. A page's picture is the monster's portrait,
  linked where a5e.tools keeps it (the token keeps the creature-kind icon:
  a5e.tools sends no CORS headers, so the canvas could not draw it).
- **Exploration challenges** are journal entries: a5e has no item type for one,
  and nothing to hang it on. Each is one page - the kind, tier, challenge
  rating and area at the top, the regions under it, then the description and
  the possible solutions under their own headings - filed under its kind
  (Traps, Terrain, Weather...), with the numbers kept in the module's flags so
  a journal can still be picked out by tier or rating. These pages write their
  bold and italics as styled spans, so the emphasis is turned into markup
  before the text is cleaned, and the spaces the spans swallowed are put back.

Corrections the page structure cannot tell the converter go in
`archetype-overrides.cjs`. Read `.cache/build-report.txt` after a build: one
line per feature with its level, choices, uses, action and grants.
