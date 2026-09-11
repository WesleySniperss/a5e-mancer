# Checks

`node tools/checks/<name>.mjs`, from the module root.

Most need nothing. The ones that render the sheet — `fireall`, `controls`,
`truedom`, `tabsync`, `npcsync`, `roundtrip`, `settingsdo` — want `handlebars`
and `parse5` reachable, and a `world-chars.json` in the module root: the real
characters out of the world, which is what makes their answers worth anything.

The rule the whole directory exists to enforce is at the bottom of
`actions.mjs` below, and it is worth reading first: **a static check says where
to look, never what is true.**

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

## `lib/sheetdom.mjs`

Not a check. The DOM `fireall` and `controls` both drive: the real template
rendered for a real character out of the world, the real `activateListeners`
bound over it, and an actor that records the path of every write.

It answers questions about wiring, not about appearance. There is no layout
here and no CSS, so it can say whether a click reaches a handler and what that
handler writes, and it can say nothing at all about whether the result is
legible on screen.

## `controls.mjs`

Named controls, pressed, against what each is actually for.

`fireall` asks the weaker question — did anything happen — and cannot ask a
stronger one. That turned out not to be enough. The coin fields "did
something": they called `update`. They had also been writing
`system.currency.undefined` for the whole life of the Quadrone sheet, because
the input carries `data-denom` and the handler read `dataset.currency`. a5e
drops an unknown field without a word, so the coin simply snapped back on the
next render.

So each case here states what must be true afterwards — the exact path
written, the exact rows hidden — and every one of them is a bug that shipped:
the coins, the features search that filtered markup the rewrite had already
replaced, and `+5` / `-3` in the hit-point field reaching a5e’s own
`applyHealing` and `applyDamage`. It also settles two of `fireall`’s standing
"no listener" reports: the inventory and effects searches listen for `input`,
which that pass never sends.

## `dangling.mjs`

Selectors and `dataset` keys the JS reaches for that no markup ever writes.

This is the shape almost every bug reported on this project has taken: the
handler is bound, it runs, it finds nothing, and it fails in silence. Nothing
in the console, nothing on screen, and from the outside it looks exactly like
"it doesn’t click".

Deliberately narrow — our own `.am-*` classes and every `dataset` read, and
nothing of Foundry’s or Tidy’s markup, which we do not own and cannot judge.
Its first run found eleven, of which two were live bugs (the coins, the
features search) and the rest were handlers still bound to markup the Quadrone
rewrite had removed: the feat search and its filter buttons, three sets of
collapse arrows, and the fatigue, exertion and spell-slot pip rows that bars
and stepper buttons replaced.

It reads comments as prose, not code — the first version did not, and
immediately reported a class named in a comment that said the class was gone.

## `v2actions.mjs`

The builder windows dispatch clicks through ApplicationV2’s `actions` map, and
that map **is** the dispatch table: a `data-action` with no entry has nowhere
to go. Unlike the sheet, where a handler name can be built from a variable —
which is what made two earlier checks lie — this one is exact.

Three idioms are not entries in that map and are not counted against it:
`submit` and `saveOptions` sit on `<button type="submit">` and are told apart
by `event.submitter.dataset.action`; `tab` is ApplicationV2’s own. All three
were reported as missing handlers on the first run, and all three were fine.
It also has to gather `templates/tab-*.hbs` from the directory, because
`A5eMancer` builds those paths from a name and no literal ever appears.

What it did find, once it stopped lying: `toggleEquipmentChoice`, declared in
the map, defined on the class, drawn nowhere — and stale twice over, stripping
a class the template does not use and reading a dataset key the button does
not carry. Removed.

## `bench.mjs`

What one redraw costs — `getData()` and the template — on every character in the
world.

The headline is not the milliseconds. Those wander: the mean over all 61
characters moved between 11.9 ms and 15.8 ms on one unchanged tree, which is
more than several of the changes measured against it, and one reading made a
change look like a 26% win that a rerun did not support. **The markup size does
not wander.** It is the same bytes every time, it is what the browser parses and
lays out on every redraw, and it is what a change should be argued from.

It also warms both halves before timing either. The first version warmed only
`getData`, so whichever character came first paid for compiling the template and
reported three times its real cost — it named a six-item character as the most
expensive sheet in the world.

## `tabcost.mjs`

What each tab costs on its own, for deciding whether to build only the tab that
is open.

On the heaviest sheet in this world: the header, sidebar and tab strip together
are **0.21 ms and 71 kB**; the ten tab panels are **3.42 ms and 400 kB**, of
which Features alone is **2.18 ms and 287 kB**.

So a redraw while sitting on Favorites would cost 0.21 ms and 72 kB instead of
3.63 ms and 471 kB — and a tab switch, which is free today because Foundry
toggles one class, would cost a full re-render.

**Three attempts at this measurement were wrong before one was right**, and they
are worth knowing about because the first produced a number that nearly got
acted on:

1. It timed the whole sheet first, cold, and got 14.8 ms. A later script that
   had already run seventeen templates got 4.2 ms for the same template. The
   difference was V8 warming up on the Handlebars runtime, and the conclusion
   drawn from it — *"the chrome costs 11 of the 15 ms, so lazy tabs would make
   things worse"* — was pure artifact.
2. It built the stripped template with `String.replace()` against a source with
   CRLF endings, using text that had been split and rejoined with LF. Nothing
   matched, nothing was stripped, and "the chrome" was measured as the whole
   sheet — 473 kB of it.
3. Only the third, warming everything first and cutting by line index, agreed
   with itself twice.

Timing is the least trustworthy thing in this directory. Prefer a number that
cannot drift.
