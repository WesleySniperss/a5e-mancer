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
