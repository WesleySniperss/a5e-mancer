/* The handful of resolved CSS values that have been reported broken twice.
 *
 * No DOM check can see these. The markup is right, the handler is bound, the
 * click writes what it should — and the thing still looks wrong or cannot be
 * hit, because of which rule won in a stylesheet 2 MB long that we did not
 * write. Both of the cases below were reported, fixed, and reported again.
 *
 * cascade.mjs already resolves the cascade; this asks it the questions and
 * insists on the answers. It runs it as a child process rather than importing
 * it, because that script is a command and not a library, and turning it into
 * one to save a process would be the more fragile of the two.
 */
import { execFileSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ask = (target) => {
  const out = execFileSync(process.execPath, [path.join(HERE, 'cascade.mjs'), target],
    { encoding: 'utf8' });
  const won = {};
  const lines = out.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^ {2}([-a-z]+)\s{2,}(.+?)\s{2,}(\S+)$/);
    if (m) won[m[1]] = { value: m[2].trim(), from: m[3] };
  }
  return won;
};

const results = [];
const check = (name, ok, detail) => results.push([name, ok, detail]);

const rem = (v) => {
  const m = String(v).match(/^([\d.]+)rem$/);
  return m ? parseFloat(m[1]) : null;
};

/* ── The AC badge ───────────────────────────────────────────────────────
   Reported as "the numbers are off the shield". Twice. The second time it was
   the image: Tidy defines --t5e-shield-image on .sheet-header for any actor and
   again on .character .ac-container .shield, so an NPC using the character's
   container inherited the NPC badge — art drawn for a 3.5 x 4.25rem box pinned
   to the portrait — while the number was centred on ours. */
for (const [who, target] of [['character', 'shield'], ['NPC', 'npcshield']]) {
  const w = ask(target);
  check(`the ${who} AC badge has a size of its own`,
    rem(w.height?.value) > 0 && !!w['aspect-ratio'],
    `height ${w.height?.value ?? '(none)'}, aspect-ratio ${w['aspect-ratio']?.value ?? '(none)'},`
    + ` width ${w.width?.value ?? '(none)'}`);
  check(`the ${who} AC badge draws the character art`,
    /badge_ac_dark/.test(w['background-image']?.value ?? ''),
    w['background-image']?.value ?? '(inherited — which is the bug)');
}

/* ── A spell slot star ──────────────────────────────────────────────────
   Reported as "too small and they don't work". a5e draws its own at 1.15rem;
   these were at 0.8125rem, which is thirteen pixels. A miss lands on the
   section heading and collapses the table, which is indistinguishable from the
   star doing nothing. Anything under a rem is not a control. */
{
  const w = ask('slot');
  const size = rem(w.width?.value);
  check('a spell slot star is big enough to hit', size !== null && size >= 1,
    `${w.width?.value ?? '(none)'} wide — a5e draws its own at 1.15rem`);
  check('and it is not wearing Tidy’s button chrome',
    w['min-height']?.value === '0' && w.transition?.value === 'none',
    `min-height ${w['min-height']?.value ?? '(Tidy’s)'},`
    + ` transition ${w.transition?.value ?? '(Tidy’s)'}`);
}

let bad = 0;
for (const [name, ok, detail] of results) {
  if (!ok) bad++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}`);
  console.log(`        ${detail}`);
}
console.log(bad ? `\n${bad} resolved value(s) are not what they were fixed to be`
                : '\nevery value these two reports turned on is still what it was set to');
process.exit(bad ? 1 : 0);
