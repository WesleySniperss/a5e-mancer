# Checks

Two checks, no dependencies. `node tools/checks/<name>.mjs`.

## `loadorder.mjs`

Loads exactly what `module.json` declares in `esmodules`, in the order it
declares them, against a stub of Foundry.

This is the check that was missing when the NPC sheet came to extend the
character sheet. `module.json` listed `scripts/app/A5eCharacterSheet.js` first,
so Foundry reached it before the entry point, and a class that extends
something needs it initialised at that moment:

    ReferenceError: Cannot access 'A5eCharacterSheet' before initialization

before a single hook ran. Nothing else would have caught it — every file parses,
every template compiles, and importing the entry point by hand happens to work.
**Only the declared order fails.**

## `cycles.mjs`

Static import cycles, and which of them cross an `extends`.

A cycle where every use is inside a function body resolves by luck of ordering
and is reported as `soft`. One where a class extends something it imports from
its own ring does not resolve at all, and is reported as `HARD` — a non-zero
exit.

There were 32 cycles here, all of them formed with `a5e-mancer.js`, because it
is both the entry point and the home of `AM`. `AM` now lives in `scripts/am.js`
and imports nothing, so there are none.

## `stubs.mjs`

Enough of Foundry — `foundry.utils`, `ActorSheet`, `Hooks`, `ui`, a DOM — for a
module to load and for `activateListeners` to run its whole length. Each gap in
it used to end a run early with a bare "x is not defined", which read as a pass
because nothing after the throw was ever reached.

## `anyfirst.mjs`

Loads every script in the module as if it were the first thing loaded, each in
its own process.

`module.json`'s order is one order. A browser holding half the module in cache,
a manifest a running world read before the last change, another module importing
one of these files — each picks a different first file, and a class that extends
one from another module only survives some of them.

That is how the NPC sheet broke the character sheet: the module threw at load,
before anything registered, so the symptom was not an error in a sheet but a
sheet that would not open. Re-create the pre-fix shape and this check says

    CANNOT BE FIRST  scripts/app/A5eCharacterSheet.js
                     ReferenceError: Cannot access 'A5eCharacterSheet' before initialization

`hooks.mjs` fires the module's `init`, `setup` and `ready` hooks and reports what
throws, plus whether both sheets ended up registered. `loadorder.mjs` proves the
files import; only this proves a line of hook code runs.
