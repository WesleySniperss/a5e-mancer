/* The resolved CSS values behind reports that no other check here can see.
 *
 * The markup is right, the handler is bound, the click writes what it should —
 * and the thing still looks wrong, because of which rule won in a 2 MB
 * stylesheet we did not write.
 *
 * The AC badge was reported four times. Each time I found one rule, fixed it,
 * and missed the rest, because I was looking at whichever property I had a
 * theory about. There are six, and quadrone.css scopes every one of them to
 * `:where(.quadrone.character)`:
 *
 *     .ac-container          text-align, align-items, max-width, position
 *     .shield                width, height
 *     .ac-container .shield  --t5e-shield-image
 *     .shield .ac-label      display:none
 *     .shield .ac-value      margin
 *     .abilities-size-small  width:100%; height:auto   (to be refused)
 *
 * Our NPC sheet uses the character's .ac-container and carries .npc, so it
 * matched NONE of them. The one that mattered most was text-align: without it
 * the number sits at the LEFT EDGE of the badge, which is why three fixes to
 * its vertical geometry changed nothing anyone could see.
 *
 * So this no longer checks a property I happen to suspect. It takes Tidy's own
 * character AC block as the specification and holds both sheets to all of it.
 */
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ask = (target) => {
  const out = execFileSync(process.execPath, [path.join(HERE, 'cascade.mjs'), target],
    { encoding: 'utf8' });
  const won = {};
  for (const line of out.split(/\r?\n/)) {
    const m = line.match(/^ {2}([-a-z]+)\s{2,}(.+?)\s{2,}(\S+)$/);
    if (m) won[m[1]] = m[2].trim();
  }
  return won;
};

const results = [];
const check = (name, ok, detail) => results.push([name, ok, detail]);

/* What Tidy states for a character, read out of quadrone.css rather than
   copied here — copying a number out of that file by hand is how the box came
   to have the proportions of a different badge for three releases. */
const QUADRONE = fs.readFileSync(path.join(HERE, '..', '..', 'tidy', 'quadrone.css'), 'utf8');
function tidySays(selectorTail) {
  const found = {};
  let i = 0;
  while (i < QUADRONE.length) {
    const open = QUADRONE.indexOf('{', i);
    if (open < 0) break;
    let d = 0, k = open;
    for (; k < QUADRONE.length; k++) {
      if (QUADRONE[k] === '{') d++;
      else if (QUADRONE[k] === '}') { d--; if (!d) break; }
    }
    const prev = Math.max(QUADRONE.lastIndexOf('}', open), QUADRONE.lastIndexOf(';', open),
                          QUADRONE.lastIndexOf('{', open - 1));
    const sel = QUADRONE.slice(prev + 1, open).trim();
    const body = QUADRONE.slice(open + 1, k);
    if (!/\{/.test(body)) {
      for (const one of sel.split(',')) {
        const s = one.trim();
        if (/:where\(\.quadrone\.character\)/.test(s)
            && !/abilities-size|theme-basic|theme-light/.test(s)
            && s.endsWith(selectorTail)) {
          /* Merged across every matching rule, later winning, because that is
             what the cascade does. Returning the first match instead read
             `.ac-container .shield`, which declares only the badge image, and
             reported Tidy as having no opinion about the size. */
          for (const m of body.matchAll(/([-a-z]+)\s*:\s*([^;]+)/g)) found[m[1]] = m[2].trim();
        }
      }
    }
    i = k + 1;
  }
  return found;
}

const wantShield = tidySays('.shield') ?? {};
const wantValue  = tidySays('.shield .ac-value') ?? {};
const wantLabel  = tidySays('.ac-container .shield .ac-label') ?? {};

for (const [who, shieldCase, containerCase] of [['character', 'shield', 'accontainer'],
                                                ['NPC', 'npcshield', 'npcaccontainer']]) {
  const s = ask(shieldCase);
  const c = ask(containerCase);

  /* The one that was actually wrong for four releases. */
  check(`${who}: the AC number is centred on the badge`,
    c['text-align'] === 'center',
    `.ac-container text-align is ${c['text-align'] ?? '(unset — the number sits at the left edge)'}`);

  check(`${who}: the badge is the size Tidy draws it`,
    s.width === wantShield.width && s.height === wantShield.height,
    `${s.width ?? '(none)'} x ${s.height ?? '(none)'};`
    + ` Tidy says ${wantShield.width ?? '?'} x ${wantShield.height ?? '?'}`);

  check(`${who}: nothing crops the badge`,
    parseFloat(s['max-height']) >= parseFloat(wantShield.height ?? '0'),
    `max-height ${s['max-height'] ?? '(none)'} against a height of ${wantShield.height ?? '?'}`);

  check(`${who}: the badge draws the character art`,
    /badge_ac_dark/.test(s['background-image'] ?? ''),
    s['background-image'] ?? '(inherited — which is how it got the NPC badge)');

  check(`${who}: the word AC is hidden, as Tidy hides it`,
    ask(`${shieldCase}label`)?.display === (wantLabel.display ?? 'none'),
    `display ${ask(`${shieldCase}label`)?.display ?? '(shown — two lines on art made for one)'}`);
}

let bad = 0;
for (const [name, ok, detail] of results) {
  if (!ok) bad++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}`);
  console.log(`        ${detail}`);
}
console.log(bad ? `\n${bad} of Tidy's AC rules do not reach this sheet`
                : "\nboth sheets carry every one of Tidy's character AC rules");
process.exit(bad ? 1 : 0);
