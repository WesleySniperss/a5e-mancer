# Importing from a5e.tools

Converts a5e.tools pages into a5e item documents for the world compendium
"A5e Mancer: Imported" (`scripts/utils/importedPack.js`): archetypes, spells,
psionic powers, magic items, weapons and mundane equipment that a5e's packs
lack. Run from the module root, with Node 20 or later:

    node tools/import/prepare.cjs            # 1. a5e's packs and CONFIG maps, from the local install
    node tools/import/fetch-archetypes.cjs   # 2. missing archetypes, and their pages (cached)
    node tools/import/fetch-content.cjs      #    missing spells, powers, items, and their pages
    node tools/import/build-archetypes.cjs   # 3. convert; writes the module's data and a report
    node tools/import/build-content.cjs
    node tools/import/check-archetypes.mjs   # 4. check them with the module's own code
    node tools/import/check-content.mjs

Everything downloaded or copied goes to `tools/import/.cache`, which git
ignores. Step 3 writes `scripts/data/imported/a5etools-*.json` and
`generated.js`, the manifest over all of them; the pack rebuilds itself in the
world when its hash changes, into a folder per kind.

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

## Spells, psionic powers and items

- **What is missing** is decided by `lib/match.cjs`: names compared in several
  spellings ("Hand crossbow" / "Crossbow, Hand"), and a generic magic item
  counts as present when a5e has it per variant ("Holy Avenger" / "Holy Avenger
  Longsword", "Weapon +1" / "Longsword +1"). Hirelings, pets, mounts and
  services are not converted: in Foundry they are actors or prices.
- **Spells** get their level, schools, classes, components, concentration,
  ritual, and one action: casting time, range, duration, target, area, saving
  throw, the first damage or healing roll with its scaling, and the spell
  points a5e's table charges for the level.
- **Psionic powers** are spell items, as a5e models them: a psionic discipline,
  the psion's list, reflex powers at level 0 and I-V at 1-5.
- **Objects** get their kind (from the list's category first, then the name),
  rarity, attunement, price (credits too), weight, charges, and an action where
  the text uses one; weapons and siege engines their attack and damage;
  vehicles and drones their statistics in the text.

Corrections the page structure cannot tell the converter go in
`archetype-overrides.cjs`. Read `.cache/build-report.txt` after a build: one
line per feature with its level, choices, uses, action and grants.
