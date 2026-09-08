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

## `dupmembers.mjs`

Two methods with the same name in one class body.

JavaScript does not complain: the later one replaces the earlier, and everything
the earlier did stops happening. `A5eCharacterSheet` had two `close()` methods
three thousand lines apart. The second won, so the `ResizeObserver` the first
disconnected was never disconnected — every sheet opened and closed left one
behind, still firing its layout callback against an element no longer in the
document.

Nothing else here would find that. It parses, it runs, and it shows up only as a
session that gets slower the longer it goes on.

## `cascade.mjs`

Which declarations actually win for an element, across quadrone.css and every
stylesheet `module.json` declares, in load order, by specificity.

    node tools/checks/cascade.mjs value|max|sep|label

I twice "fixed" the counter figures by writing rules and reasoning about what
they would override, and both times the reasoning was wrong. Resolving the
cascade instead found it in one run: Tidy styles a number input as a **flex box
1.75rem tall** while its neighbours are inline-blocks 1.375rem tall, so the
current value and the maximum were drawn at different heights. Three boxes, two
heights, two display types — the figures were never a typeface problem.

Its own first version was wrong too, in a way worth keeping in mind: it parsed
comments as declarations, so a comment containing `display: flex` was reported
as the winning rule. A check that can be wrong quietly is worse than no check.

## `tabsync.mjs` and `npcsync.mjs`

What a5e holds with content, against what the sheet actually renders. Not
"does it parse" — does the writing reach the screen.

They need a dump of real actors beside them (`world-chars.json`, and a copy of
a5e's monster pack), so they run from the scratch directory rather than here;
they are kept for the method, which is the part worth repeating. What they found:

- Our own builder writes `system.details.ideals/bonds/flaws/goals` at creation,
  and the sheet read a flag of its own instead. Eleven characters carried them
  and **nine saw none of it**.
- `system.details.appearance` — a5e's Notes page has an editor for it; we had the
  seven short fields and not the editor.
- Damage immunities, resistances, vulnerabilities and condition immunities were
  read by nothing at all. **373 of a5e's 982 creatures carry damage immunities
  and 387 carry condition immunities.** On a statblock that is not a detail.

Both of my first attempts at these checks reported failures that were the
check's own fault — one stripped HTML tags to an empty string on one side and to
a space on the other. Read a failure twice before believing it.
