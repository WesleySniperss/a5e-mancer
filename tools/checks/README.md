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

## `truedom.mjs`, `roundtrip.mjs`, `singlebind.mjs`

Three ways a control can be dead while everything parses.

**`truedom.mjs`** runs `activateListeners` against a DOM built from the HTML the
sheet actually rendered. Every earlier harness here answered *every*
`querySelector` with a node; a browser answers `null` for anything not in the
markup, and 49 of the selectors this sheet asks for match nothing on a real
character. One of those used without `?.` throws and kills every listener bound
after it — the padlock is bound at line 2544, a long way down that list.

**`roundtrip.mjs`** writes what each handler writes, rebuilds the context, and
checks the sheet reads it back. A switch that writes to a path nothing reads
looks exactly like a switch that does nothing.

**`singlebind.mjs`** finds handlers bound with `querySelector` — the singular —
over markup that holds more than one of that element. `querySelector` returns
the first match; if the control the player uses is the second, the click does
nothing and there is no error anywhere.

All three pass for the padlock and for all 15 settings switches, which is worth
recording: when those were reported dead, the fault was not in this code.

## `settingsdo.mjs`

Does each switch on the Settings tab actually **change** the sheet?

`roundtrip.mjs` answers a different question, and answering it was not enough:
`showSpellTab` and `showManeuverTab` round-tripped perfectly while doing
nothing, because the sheet computed `flag || hasItems` — which lets a flag *add*
a tab and never take one away. Ticking worked; unticking did not, so the switch
was a lie for anyone who carried a spell.

This flips each switch, renders the sheet both ways, and reports whether the
HTML differs. A switch whose two renders are identical does nothing here.

Note what it does NOT claim: seventeen of the twenty-five settings are a5e's
own flags, read by the system rather than by this sheet — hit dice, spell
resources, macros, carrying capacity, crit thresholds. Those change a5e's
behaviour, not this page's appearance, and the Settings tab now says so under
each heading.

## `actions.mjs`

Every `data-action` the sheets draw, against every one they listen for. A button
whose action nobody binds does nothing and says nothing; a listener for an
action nobody draws is dead code that reads as coverage.

**It cost more than it found on its first run, and that is the lesson.** It
looked only for `data-action="…"` spelled out in the script, and reported
`cycle-fatigue` and `cycle-strife` as unbound — while a handler three hundred
lines further down bound both through `` `[data-action="${action}"]` `` in a
loop. Acting on that report added a second handler to each button, so one click
would have moved the track by two. A functional test caught it before release;
the check had not.

The same day, a quick partial-reference check reported 21 missing partials, all
of which are registered in a loop over a list of names. Two false positives from
two naive scans.

So: **a static check says where to look, never what is true.** Fire the handler
before changing anything.

## `fireall.mjs`

Clicks every action the sheet draws.

Static checks have twice told me a control was dead when it was not, and the
correction cost a release. So this one presses the buttons: build a DOM from the
sheet's own HTML, bind the listeners, then for each `data-action` call its
handlers and record whether anything happened — a document write, an a5e API
call, a re-render — or nothing at all.

On the largest character in the world, 51 distinct actions: **37 did something,
5 threw only where the harness has no dialog or no `ChatMessage.getSpeaker`, and
9 were silent for reasons that check out** — a confirm dialog the harness cannot
answer, a value already at its floor, a panel that toggles in the DOM without
writing.

"Silent" is not proof of a bug. It is a list of places to look, which is all any
check is.

## `a5eapi.mjs`

Every a5e method this module reaches for, against the methods a5e declares.

Nearly all of them are called with `?.` — `actor.configureSenses?.()` — so a
wrong name does not throw. The control simply does nothing, silently, which is
the most common shape of bug reported on this project.

Checked against the system's own source: all 23 actor methods and all 7 primary
item methods exist. `item.use`, `item.roll`, `item.toChat` and `item.share` do
not, and are only ever reached as fallbacks after the real method is found
missing.

Note the scanner is deliberately loose and will name this module's own methods
too; read its list as candidates, not findings.
