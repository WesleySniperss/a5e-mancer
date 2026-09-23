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

## `spellrowlook.mjs` and `lib/png.mjs`

A spell row in the browser: C and R as coloured letters with no ring, readable
at 4.5:1 or better on a plain, prepared and always-prepared row; those rows in
a5e's own green and purple; and the prepare button among the row's buttons,
reachable, in a5e's active colours. Colours are read back from a5e's custom
properties; legibility from the screenshot's pixels, which `lib/png.mjs` decodes
— a computed style cannot say what is behind a letter once a gradient and a
textured window are stacked there.

Two things this check got wrong before it got them right, both worth knowing:
sampling the pixels *beside* a letter read the other letter (C and R sit
together), and every button in a row read as unreachable until the row was
scrolled to — Tidy gives row containers `content-visibility: auto`, and headless
Edge hit-tests straight through one that has not been. Neither was the sheet.

## `components.mjs`

V S M on the spells this world's actors actually carry. `spellrowlook.mjs`
passed the whole time components were reported missing, because it drew spells
straight from a5e's pack. Most spells on actors are stubs — 190 of 211, their
actions and nothing else — so there was nothing to draw. Components now come
from the compendium entry a stub records, for display only; this renders the
world's characters with the pack copy behind `game.packs` and counts. Against
the released code, 0 of 49 such spells showed components; now 49 of 49.

A stub is judged by its components being all unset, not absent: Foundry fills a
stub's missing fields with the schema's defaults when it loads, so the check's
close case is built that way.

It also counts what the sheet asks the server for. The first release read each
source through `fromUuid`, which for a compendium entry is a request and a whole
Item apiece, all before the sheet could draw — 52 across these sheets, 21 on
one. Now: 15 requests, one per pack a sheet's stubs name, none on a redraw.

## `worldload.mjs`

What the module asks the server for while a world loads — reported as
"something takes long to load". Two loaders run at `ready` for every user. The
check runs both over copies of a5e's 21 Item packs (`packcopy2/`, copied from
`systems/a5e/packs`) behind a pack that does what Foundry's
`CompendiumCollection.getIndex` does, including not sharing a request still in
flight, and counts requests and the JSON they would carry.

- `DocumentService`, the builder's origin lists, asked every Item pack for its
  index with `system` — every field of every item — for five types side by side,
  so each pack about five times: 105 requests, 119.2 MB of JSON, kept in memory
  for the session, when it reads only `_id`, name, type and img. Now it takes the
  index Foundry already holds: no requests.
- `SpellService.loadSpellcastingFeatures` read its 31 features one request at a
  time. Now one request per pack: 2.

The lists and the spell tables it reads are hashed and must match what the
released code read. `AM_SCRIPTS=<dir> node tools/checks/worldload.mjs --digest`
runs another tree's `scripts/` and prints its numbers.

## `bannercolor.mjs`

The colour under the sheet's banner, in headless Edge. Reported as "it was grey
and is red now", then "let it follow the player's colour, 10–20% over the grey".
Nothing of ours had changed: Tidy paints the root its red, and the grey was
Carolingian UI's glass effect (a client setting), whose `.window-app` rule
outranks Tidy's. Measured before: rgb(116, 27, 43) without the glass, rgba(11,
10, 19, 0.95) with it. Now Tidy's own basic-theme grey, #1a1b20, with 15% of the
owning player's `--user-color-<id>` (the viewer's when no player owns the
actor), the same with the glass on or off. `--shots` writes a PNG per case.

## `notesdup.mjs`

Every character in the world, rendered locked, with the text of every block on
the Details, Backstory and Notes pages compared: a block whose text another
block already holds is shown twice. The builder writes what it asked for into
a5e's fields and again onto its own flag, and the sheet drew both — against the
released code, 49 doubled blocks. It also turned up bonds, flaws and ideals that
hold the literal text "[object Object]", written by an earlier builder, shown
three times on one page; those now read as empty.

## `livecontrols.mjs` and `lib/livebrowser.mjs`

The sheet's own script, running in headless Edge on a real DOM. The module is
served over HTTP, `A5eCharacterSheet` loads with the stand-ins from
`stubs.mjs` (which leave a real `document` and `window` alone),
`activateListeners` is called with the jQuery-shaped wrapper Foundry v1 passes,
and the probe dispatches real pointer events.

It answers what neither of the other two harnesses can: does every listener
bind in a real browser, and does a real click reach its handler and write?
Reported as "the stars neither spend nor restore", it found both do — 2 → 1 on
a lit star, 2 → 4 on a spent one, a Settings box writing its flag — so what
fails in a world lies between the click and the saved document. The stars now
say so: drawn at once, put back with the reason when a write is refused, which
this also checks.

## `exertion.mjs`

Where exertion can be typed in. A character's pool size is a5e's figure while
it has a class to work it out from, and a field when it has none — a5e's own
rule. A monster has no `attributes.exertion` in a5e's data model at all, so its
exertion is kept on this module's flag, both fields and the steps writing there.
Against the released code all seven cases failed.

Then reported: unlocked, it still cannot be corrected. Unlocked, the pool size
is a field on every sheet now. Where a5e works the pool out, a stored max is
overwritten on every prepare (`prepareMaxExertion` in `character.ts`), so a
typed size becomes one exertion bonus of this sheet's (`amSheetExertion1`),
counted from a5e's own figure, which a5e adds itself and lists under Bonuses —
and is removed, not left at 0, when the size is set back.

## `hpedit.mjs`

Hit points, locked and unlocked. Locked, clicking the figure offers only the
current value, to be replaced or healed and hurt by `+N`/`-N`; unlocked, the
maximum and temporary pool as well. A sign goes to a5e's `applyHealing` and
`applyDamage`, the latter taking temporary hit points first.

It also checks that a starred item's star is lit on every tab it is drawn on,
on two characters so Inventory, Magic, Martial and Features are all covered.
Only the Favorites tab's rows used to carry `starred`; with that taken out
again, both star cases fail.

## `vitals.mjs`

The HP bar and the initiative badge in headless Edge, with and without
Carolingian UI's stylesheet. Carolingian gives every button in an old-style
window's form a 15% black wash; the HP figure is a button over 148px of the
176px bar, which left its last 28px reading as a pale square — a brightness step
of 39 at +147px, against 3 for a clean gradient. And Tidy's initiative column is
3rem with `overflow: hidden` around a 3.25rem badge, which cut 2px off each side
of the hexagon on both sheets. With the two rules taken out, five of six cases
fail.

Then the slot stars, reported a third time as not working. The world's own
actor log (read from the LevelDB `.log` in write order) had every click writing
the right count — 1 → 2 → 1 on a cleric — and nothing on the sheet changing:
the same Carolingian rule outweighed the lit and spent styles and drew both
alike, and even without it the star glyph kept Tidy's icon colour in both
states. The sheet now carries the class `default`, which that rule excludes,
and the glyph takes the pip's colour. The check compares a lit and a spent
star, and every button on both sheets with and without Carolingian: before,
180 of 211 on the character sheet differed.

## `spellbooks.mjs`

The Magic tab's spell books against a5e's Spells page: the strip drawn when
unlocked or when there is more than one book; one book's spells at a time, the
pick surviving a redraw; a book's `showSpellSlots` deciding the stars and its
points shown with it; unlocked, the plus adding a book through
`SpellBookManager.add` and opening its settings, the cog opening a5e's fields,
the bin asking — naming the spells that go with the book — before `remove`.

And moving a spell between books, which a5e has no control for: dropped on a
book in the strip, picked in the spell's summary, or — for every spell that
names no book — filed as the actor's own copy in a5e's compendium keeps it.
Run over the pack-imported monsters in this world, that last sorts Archfey
Enchanter's 42 loose spells 12 into Innate Spellcasting and 30 into
Spellcasting, exactly as a5e's pack has them, with none left unmatched.

A spell naming no book is listed under the first book. a5e files those under
"none" and never draws them; in the saved copy of this world's characters 74 of
92 spells name no book, so copying that would empty most spell lists.

## `dropspell.mjs`

Drops a5e's Fireball on the sheet. On Magic it must go into a spell book
through that book's own `addSpell`; on Inventory it must become a Spell Scroll
with the scroll's save DC and consumers pointing at itself — both as a5e's own
drop does. The sheet had ported only the object branch of that drop, so a spell
fell through to Foundry's plain create and a5e refused it: *"You must select a
spell book to create a spell."* The stand-in actor's create refuses the same
way, which is how the check printed that exact message against the released
code.

## `featpicker.mjs`

Opens **Add Feat** on the Features tab against a5e's real feats pack
(`packcopy2/feats`, a copy with `LOCK` removed), served by a stand-in that
behaves as Foundry does on it: the plain index has no system data, and asking
`getIndex` for more throws. Against the released code it printed exactly what
was reported — *"No feat compendiums found"* — because the window kept items of
type `feat`, which a5e never uses, after a `getIndex` call that had already
thrown and been swallowed. It now reads through `FeatService`, as the level-up
does: 625 feats.

Writing it turned up a harness gap too: the stub `Collection` had no `some` or
`every`, which Foundry's does, so the prerequisite check threw here and only
here.

## `settingsa5e.mjs`

The Settings tab against a5e's own settings pages, read out of `a5e.js.map`:
which boxes a character and a monster are offered, and how each is ticked for
an actor that has never set anything. The list had been written from memory,
and against the released code this check reported it wrong three ways —
eight boxes unticked where a5e reads them as on, seven character-only boxes
drawn on a monster (one of them, experience, forced on and so impossible to
untick), and a5e's one NPC option missing. `settingsflip.mjs` passed through
all of it, because it only ever flipped boxes on a character.

## `slotroom.mjs` and `lib/browser.mjs`

The only checks here that look at the sheet the way a person does: laid out in
headless Edge, inside the window Foundry wraps a v1 sheet in, under Foundry's
`foundry2.css`, a5e's stylesheet and this module's in `module.json` order. A
probe runs in the page and returns JSON; `--shots` also saves a picture.

Every other check reads markup through a DOM of our own, which knows what an
element is and nothing about where it lands. That is how *"the stars are too
small, there is no room for them"* survived `controls.mjs`, which proved the
star's handler writes what a5e writes — by calling it. It never asked whether
the star was 18px, or whether two of the four columns beside it had been hidden
outright for width. In the browser, at the default 820px window, the answer
was: `Cast Time=112 | Range=112 | Duration=0 | Save=0`.

It renders all 895 spells in a5e's pack, not a sample: a short column fits or
not by its longest value. Its first run over the pack found seven free-text
ranges cut to an ellipsis that a dozen hand-picked spells had not.

What it is not: Foundry. None of Foundry's or the sheet's JavaScript runs, so
anything a listener would do to the layout — opening a tab — the probe does
itself, and says so. The window's 700px minimum width is Foundry's CSS, and
applies here as there.

## `livepatch.mjs` and `lib/cdp.mjs` — live checks

The one check here that runs against **Foundry itself**: a real world, real
documents, a5e's own automation, Foundry's own render pipeline. Everything else
stands Foundry in; this is what those stand-ins cannot answer.

Reported as: *the map background hangs whenever something changes on the
sheet.* Measured in the browser, one point of damage cost 133–170 ms inside
`_render` — getData 44–66, the template 29–49, innerHTML 5–7, listeners 44–51 —
on the thread the canvas draws on. And taking a character to 0 hit points cost
**four** of those in 1.1 s: the write, then a5e removing Bloodied and adding
Unconscious and Incapacitated, one document write each, each redrawing the lot.

`_render` now draws a change in place where `scripts/utils/livePatch.js` has a
rule for everything that moved — hit points, exertion, a spell slot — and
gathers a burst of other requests into one redraw. This check holds that to
account: for each case it draws the actor the slow way at the new state, and
compares that markup, character by character, with the patched sheet. Both
come out of the same browser and the same template, so a difference is a
number left stale. It also counts redraws, and a change no rule claims must
still cost one.

Two things it found that nothing else would have:

- **What was written is not what changed.** On a monster, one point of damage
  put `deafened` into `actor.statuses` — no effect created, nothing in the diff
  but the hit points — and the patched conditions strip showed it hearing. A
  patch now also compares a snapshot of the prepared data the sheet was drawn
  from (0.15–0.31 ms, 585–863 leaves) and redraws when anything unowned moved.
- **Foundry drops a render that arrives mid-render.** v1 `_render` returns at
  once while `_state` is RENDERING, so a burst could end on a sheet still
  showing Bloodied. Gathered requests are redrawn after the one running.

Needs a Foundry serving a **copy** of the world — it writes, and puts back what
it wrote — and Edge. The copy used so far: a data path whose `Data/modules` and
`Data/systems` are links to the real folders, and whose `Data/worlds/a5e` is a
copied world, served with `node main.js --dataPath=<copy> --port=30011
--world=a5e --noupdate --noupnp`. Then:

    node tools/checks/livepatch.mjs --user <a GM's user id>

`lib/cdp.mjs` starts Edge with extensions off. Edge signed in to Windows brings
its extensions into even a fresh profile, and their welcome pages opened in
front of the Foundry tab: `document.hidden`, every timer throttled to as much
as a minute, and a check of a few minutes ran for ten before anyone looked. The
check now refuses to run in a hidden tab.

## `prosespells.mjs`

What a feature's prose grants, offers or skips, through the real
`ProseSpells.parse`, and what the spell pickers let through from an expanded
list, through the real `SpellService.collectExpandedLists`. 37 sentences as a5e
and the imported content write them, then a5e's own features: the cleric's
Thaumaturgy, the six artificer archetypes whose tables are written as lines,
the Elemental Priest's chosen list, the Air list's short-form links, Mythfire's
list, a herald oath's added schools.

Every probe was a spell lost or wrongly given before it was fixed. Run against
the code before those fixes it passes 21 of 44; the ones it failed were real:
every a5e cleric without Thaumaturgy, six artificer archetypes without one of
their ten spells, a 1st-level warlock never offered their patron's list.

What decided the rules, found by running the parser over all 6,907 features in
a5e's packs and the imported content, old against new:

- **"Or" is a choice only when you learn.** "You learn the Dancing Lights,
  Light, or Produce Flame cantrip" is picked once; "you can cast either
  Counterspell or Dispel Magic once per rest" is picked at each casting, so
  both are the character's; "you learn the Sleep spell, or another bard spell
  if you already know it" grants Sleep.
- **"Count as artificer spells for you" is a grant.** An artificer archetype's
  table says it of spells always prepared; read as an expanded list, it took
  ten spells from each of nine archetypes. A warlock's list is known by its
  name instead.
- **A row number is a spell level when the rows run 1, 2, 3...** Labyrinth
  Priest's and Stone Heart's tables, and the Court Magician's "Spell Level"
  column, are reached at 1st, 3rd, 5th... class level.

Reads a5e's packs from `tools/import/.cache`: run `tools/import/prepare.cjs`
once.

## `hiddensources.mjs`

a5e's "Hidden Compendium Sources", applied (`scripts/utils/hiddenSources.js`),
against a5e's heritages, classes and feats and the Imported challenges, behind
stub packs that behave as Foundry v14's do: `getIndex({fields})` merges the
server's answer - the whole pack - into the loaded index, and
`database.get({index: true})` answers without merging.

a5e applies the setting at `setup`, when no pack index is loaded yet, so on
Foundry v13 and later it has never hidden anything. Two things decided the
shape of the fix:

- **Only a saved value hides.** a5e registers the setting with Voidrunner's
  Codex ticked, but its own code reads the value saved in the world and not
  the default. Read the same way here, a world with Psions and a Psyknight in
  it keeps them until a GM saves the setting.
- **Every index request brings the pack back.** A picker's, the browser's
  enrichment, a rebuilt Imported pack: each gets every entry from the server,
  hidden ones included, so each drops them again.
