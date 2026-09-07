# Tidy 5e Sheets assets

`quadrone.css`, `images/` and `fonts/` are taken from Tidy 5e Sheets
(https://github.com/kgar/foundry-vtt-tidy-5e-sheets), (c) kgar, MIT licensed.

The A5e Mancer character sheet renders Tidy's own Quadrone markup, so it can
use Tidy's own stylesheet unchanged and the design matches one to one rather
than approximately. Tidy's Quadrone rules are all scoped to
`.tidy5e-sheet.application:where(.quadrone)`, so putting those three classes on
our sheet root is what makes the whole stylesheet apply. Nothing here is scoped
to `:root`, so the rest of Foundry is untouched.

Copies live here, rather than being referenced in place, so the module does not
need Tidy — or dnd5e — installed.

## Regenerating after a Tidy update

With the new Tidy release unpacked in `Data/modules/tidy5e-sheet`, from
`Data/`:

    node -e "
    const fs=require('fs');
    let css=fs.readFileSync('modules/tidy5e-sheet/main.css','utf8');
    const rules=[
      ['../../modules/tidy5e-sheet/images/','images/'],
      ['../../modules/tidy5e-sheet/fonts/','fonts/'],
      ['../../systems/dnd5e/icons/currency/','images/'],
      ['../../systems/dnd5e/ui/official/','images/'],
      ['../../systems/dnd5e/ui/','images/'],
    ];
    for(const [f,t] of rules) css=css.split(f).join(t);
    fs.writeFileSync('modules/a5e-mancer/tidy/quadrone.css',css);
    "
    cp -r modules/tidy5e-sheet/images/. modules/a5e-mancer/tidy/images/
    cp -r modules/tidy5e-sheet/fonts/.  modules/a5e-mancer/tidy/fonts/

Then re-add the attribution header to the top of `quadrone.css`, and check that
every url still resolves:

    cd modules/a5e-mancer/tidy && node -e "
    const fs=require('fs');
    const css=fs.readFileSync('quadrone.css','utf8');
    const u=[...new Set([...css.matchAll(/url\((['\"]?)([^'\")]+)\1\)/g)].map(m=>m[2]))]
      .filter(x=>!x.startsWith('data:'));
    u.forEach(x=>{ if(!fs.existsSync(x)) console.log('MISSING:',x); });
    console.log('checked',u.length);
    "

Seven of the images (`copper` `silver` `electrum` `gold` `platinum`,
`ac-badge`, `banner-npc-dark`) come from the dnd5e system rather than from
Tidy, because Tidy's stylesheet points at them there. They are copied in for
the same reason as the rest: so nothing outside this module has to exist.

The RPGAwesome icon font is embedded in the stylesheet as data URIs, so the
`rpg-awesome/` folder does not need copying.

## The builder windows use a copy of the palette

`styles/tidy-a5e-app.css` styles the mancer's own windows — the builder, the
level-up, and the spell and maneuver pickers — in Tidy's colours. It does **not**
get those colours the usual way.

Wearing `.tidy5e-sheet.quadrone` is what makes Tidy's `--t5e-*` tokens resolve
inside an element, and the character sheet does exactly that. But it also brings
1257 of Tidy's rules along, 295 of which match plain markup — a `button`, a
`table`, an `input` — and would restyle those windows in ways that cannot be
checked without opening every screen of the builder.

So the token values are copied out of `quadrone.css` and declared on
`.a5e-mancer-app` instead. The windows get the palette and none of the layout.

**The cost:** when this directory is regenerated from a newer Tidy that has
re-tinted anything, those copies do not follow. Re-extract them with:

    node -e "const c=require('fs').readFileSync('tidy/quadrone.css','utf8'); \
      for (const t of ['--t5e-component-card-default','--t5e-component-card-darker', \
        '--t5e-component-field-border','--t5e-component-pill-border','--t5e-color-gold', \
        '--t5e-color-text-default','--t5e-color-text-lighter','--t5e-color-text-lightest', \
        '--t5e-color-text-gold','--t5e-color-text-gold-emphasis','--t5e-color-text-longform']) { \
        const i=c.indexOf(t+':'); console.log(t, c.slice(i+t.length+1, c.indexOf(';',i)).trim()); }"

and paste the values into the token block at the top of `tidy-a5e-app.css`.
Values that come back as `var(--t5e-color-palette-…)` need one more pass to
resolve the palette entry itself.

## The NPC sheet is generated

`templates/sheet/npc-sheet.hbs` is not written by hand. It is built from
`templates/sheet/tidy-character-sheet.hbs`:

```
node tools/build-npc-sheet.js
```

**Run it after any change to the character template.**

a5e has one `ActorSheet` for both kinds of actor and adapts it, and a monster
out of its own pack renders through the character sheet here without a single
failure — an Adult Red Dragon, 21 items, six abilities, twenty-one skills,
fifteen features, six maneuvers, an inventory. A monster is a character with a
challenge rating where the class levels go.

So the NPC sheet is not a second design. Keeping it by hand would mean 1600
lines that begin identical and drift apart with every fix to one of them, and
matching the character sheet one to one is the whole point of the work. What
differs is named in the build script and nothing else may differ.

What differs: the level-up button and the inspiration badge (a monster has
neither); the subtitle, which carries size, creature type, tags and terrain
where a character carries heritage, culture, background and classes; the level
plate, which shows the challenge rating; and a Statblock tab, first, listing
every action the monster has, grouped by the action's own activation type.

Every substitution must match exactly once. If the character template moves
under the script it fails and writes nothing, rather than producing a
half-transformed sheet.
