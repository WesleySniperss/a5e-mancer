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
import fs from 'fs';
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

/* The size of a WebP, from the file. VP8L, VP8 and VP8X each carry it
   differently, so all three are read.

   This is here because the aspect-ratio in the stylesheet was wrong for three
   releases, and it was wrong because it had been copied by hand out of a Tidy
   rule about a different picture. A number that describes a file should be
   read from that file. */
function webpSize(buf) {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WEBP') return null;
  const fourcc = buf.toString('ascii', 12, 16);
  if (fourcc === 'VP8X') return { w: 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16)),
                                  h: 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16)) };
  if (fourcc === 'VP8L') { const b = buf.readUInt32LE(21);
    return { w: 1 + (b & 0x3fff), h: 1 + ((b >> 14) & 0x3fff) }; }
  if (fourcc === 'VP8 ') return { w: buf.readUInt16LE(26) & 0x3fff,
                                  h: buf.readUInt16LE(28) & 0x3fff };
  return null;
}

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

  /* And the box is the shape of that picture.

     background-size is `contain`, so the art keeps its own proportions inside
     whatever box it is given. A box of a different shape letterboxes it, and
     with background-position:top the slack all goes to the bottom — so the
     number, centred on the box, comes out below the middle of the shield.
     That is what "the armour is crooked" was, three times. */
  const url = (w['background-image']?.value ?? '').match(/url\(([^)]+)\)/)?.[1];
  const file = url && path.resolve(HERE, '..', '..', 'styles', url);
  const px = file && fs.existsSync(file) ? webpSize(fs.readFileSync(file)) : null;
  const stated = (w['aspect-ratio']?.value ?? '').match(/([\d.]+)\s*\/\s*([\d.]+)/);
  const want = px ? px.w / px.h : null;
  const got = stated ? Number(stated[1]) / Number(stated[2]) : null;
  check(`the ${who} AC badge box is the shape of that picture`,
    want !== null && got !== null && Math.abs(want - got) < 0.005,
    px ? `the file is ${px.w} x ${px.h} = ${want.toFixed(4)};`
         + ` the sheet says ${w['aspect-ratio']?.value} = ${got?.toFixed(4) ?? '(none)'}`
       : `could not read ${url ?? '(no image)'}`);
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
