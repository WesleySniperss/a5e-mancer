/* Every field a5e lets you write, asked whether this sheet lets you write it.
 *
 * This check exists because of a question I did not have a good answer to: why
 * does something new keep turning up.
 *
 * The honest answer is that until now every check here asked whether a thing
 * that IS drawn behaves — does the click reach a handler, does the handler
 * write the right path, does the path exist on the actor. Not one asked whether
 * a thing that a5e HAS is drawn here at all, or, having been drawn, can be
 * edited. The Notes pages were the case: each of the eight written fields was
 * shown read-only when it held anything and given an editor only while it was
 * empty, so a page could be written once and never changed. Eight fields, one
 * mistake, repeated eight times, and everything here passed.
 *
 * So this one starts from a5e's schema rather than from our markup: for each
 * writable field on the actor, find the control on the unlocked sheet that
 * writes it, and fail when there is none.
 */
import { buildSheet, q, R } from './lib/sheetdom.mjs';
import { readFileSync } from 'fs';

/* The fields a5e's own sheet edits, with how each is written there.
   Taken from its schema and its Notes page, not guessed. */
const FIELDS = [
  ['system.details.appearance',   'html',  'both'],
  ['system.details.bio',          'html',  'both'],
  ['system.details.notes',        'html',  'both'],
  ['system.details.privateNotes', 'html',  'both'],
  ['system.details.ideals',       'html',  'character'],
  ['system.details.bonds',        'html',  'character'],
  ['system.details.flaws',        'html',  'character'],
  ['system.details.goals',        'html',  'character'],
  ['system.details.age',          'field', 'character'],
  ['system.details.height',       'field', 'character'],
  ['system.details.weight',       'field', 'character'],
  ['system.details.eyeColor',     'field', 'character'],
  ['system.details.hairColor',    'field', 'character'],
  ['system.details.skinColor',    'field', 'character'],
  ['system.details.gender',       'field', 'character']
];

/* A character with something written in every one of them, so the check is
   testing the case that was broken: a field that already holds text. */
const chars = JSON.parse(readFileSync(R + 'world-chars.json', 'utf8'));
const pick = chars.map((c, i) => ({ i, n: c.items.length })).sort((a, b) => b.n - a.n)[0].i;

const { sheet, actor, render } = await buildSheet({ choose: (all) => all[pick] });
for (const [path] of FIELDS) {
  const key = path.split('.').pop();
  actor.system.details = actor.system.details ?? {};
  actor.system.details[key] = `<p>something already written in ${key}</p>`;
}
/* Unlocked, which is the state these controls belong to. */
actor.flags = actor.flags ?? {};
(actor.flags.a5e ??= {}).sheetIsLocked = false;

const root = await render();
const results = [];
const isCharacter = actor.type === 'character';

for (const [path, kind, who] of FIELDS) {
  if (who === 'character' && !isCharacter) continue;
  const key = path.split('.').pop();

  /* An html page is written by a textarea carrying the path; a short field by
     an input carrying the key. Either way: something on the page that takes
     typing and says where it goes. */
  const byPath = q(root, `[data-path="${path}"]`);
  const byKey  = q(root, `[data-key="${key}"]`);
  const control = [...byPath, ...byKey].find(el => el.tag === 'textarea' || el.tag === 'input');

  let ok = !!control, detail;
  if (!control) {
    detail = `nothing on the unlocked sheet writes ${path}`;
  } else {
    /* And it has to hold what is stored, or the first save wipes it. */
    const holds = control.tag === 'textarea'
      ? (control.textContent ?? '').includes(key)
      : String(control.attrs.value ?? '').length > 0;
    ok = holds;
    detail = holds
      ? `${control.tag} carrying the current value`
      : `${control.tag} is drawn but empty — saving it would wipe what is stored`;
  }
  results.push([`${kind === 'html' ? 'page' : 'field'}  ${key}`, ok, detail]);
}

let bad = 0;
for (const [name, ok, detail] of results) {
  if (!ok) bad++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name.padEnd(22)} ${detail}`);
}
console.log(bad ? `\n${bad} of a5e's writable fields cannot be written here`
                : `\nevery writable field a5e has can be written on this sheet`);
process.exit(bad ? 1 : 0);
