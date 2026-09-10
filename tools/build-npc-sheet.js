/*
 * Builds templates/sheet/npc-sheet.hbs out of tidy-character-sheet.hbs.
 *
 * WHY THIS IS GENERATED. a5e has one ActorSheet for both kinds of actor and
 * adapts it, and a monster out of its own pack renders through the character
 * sheet here without a single failure — six abilities, twenty-one skills,
 * fifteen features, six maneuvers, an inventory. A monster is a character with
 * a challenge rating where the class levels go.
 *
 * So the NPC sheet is not a second design. Writing it by hand would mean 1600
 * lines that start identical and drift apart with every fix to one of them,
 * and "the design must match one to one" is the whole point of this work.
 * Generating it means the two cannot drift: everything not named below is the
 * character sheet, exactly.
 *
 * Run it after changing the character template:
 *   node tools/build-npc-sheet.js
 *
 * Every substitution must match exactly once. If the character template moves
 * under it, the build fails loudly and writes nothing rather than producing a
 * half-transformed sheet.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC  = path.join(ROOT, 'templates/sheet/tidy-character-sheet.hbs');
const OUT  = path.join(ROOT, 'templates/sheet/npc-sheet.hbs');

let text = fs.readFileSync(SRC, 'utf8');
const eol = text.includes('\r\n') ? '\r\n' : '\n';
let failures = 0;

function swap(what, from, to) {
  const n = text.split(from).length - 1;
  if (n !== 1) { console.error(`FAIL ${what}: ${n} matches, need exactly 1`); failures++; return; }
  text = text.replace(from, to);
}
const L = (...lines) => lines.join(eol);

/* ── The banner says what this file is ────────────────────────────────────── */
swap('banner',
  '{{!-- ═══════════════════════════════════════════════════════════════════════',
  L('{{!-- GENERATED — do not edit. Run: node tools/build-npc-sheet.js',
    '     Source: templates/sheet/tidy-character-sheet.hbs',
    '',
    '     A monster is a character with a challenge rating where the class levels',
    '     go, so this sheet IS that sheet: same header, same ability plates, same',
    '     vitals, same tables. What differs is named in the build script, and',
    '     nothing else may differ, which is why it is generated rather than kept',
    '     by hand. --}}',
    '{{!-- ═══════════════════════════════════════════════════════════════════════'));

/* ── A monster does not gain levels ───────────────────────────────────────── */
swap('level-up button', L(
  '              <button type="button" class="button button-icon-only button-gold"',
  '                data-action="level-up" aria-label="Level Up" data-tooltip="Level Up">',
  '                <i class="fas fa-arrow-up-right-dots"></i>',
  '              </button>',
  ''), '');

/* ── …nor is it inspired ──────────────────────────────────────────────────── */
swap('inspiration badge', L(
  '          <div class="inspiration-badge theme-dark single">',
  '            <button type="button"',
  '              class="inspiration button button-borderless button-icon-only single{{#if resources.inspiration}} inspired{{/if}}"',
  '              aria-label="Inspiration" data-tooltip="Inspiration"',
  '              data-action="toggle-inspiration"></button>',
  '          </div>',
  ''), '');

/* ── Origin and classes become creature type, tags and terrain ────────────── */
swap('subtitle origin block', L(
  '              {{#if charInfo.heritage}}',
  '                <span class="species">',
  '                  <span class="font-label-medium color-text-gold">{{charInfo.heritage}}</span>',
  '                </span>',
  '                <div class="divider-dot"></div>',
  '              {{/if}}',
  '',
  '              {{#if charInfo.culture}}',
  '                <span class="creature-type hide-under-600">',
  '                  <span class="font-label-medium color-text-gold">{{charInfo.culture}}</span>',
  '                </span>',
  '                <div class="hide-under-600 divider-dot"></div>',
  '              {{/if}}',
  '',
  '              {{#if charInfo.background}}',
  '                <span class="alignment hide-under-700">',
  '                  <span class="font-label-medium color-text-gold">{{charInfo.background}}</span>',
  '                </span>',
  '                <div class="hide-under-700 divider-dot"></div>',
  '              {{/if}}',
  '',
  '              {{#each tidy.classLine}}',
  '                <span class="class">',
  '                  <span class="color-text-gold font-label-medium">{{this.name}}</span>',
  '                  <span class="color-text-default font-data-medium">{{this.levels}}</span>',
  '                  {{#if this.dc}}',
  '                    <span class="color-text-lighter font-label-medium dc">{{this.ability}} DC</span>',
  '                    <span class="color-text-default font-data-medium">{{this.dc}}</span>',
  '                  {{/if}}',
  '                </span>',
  '                {{#unless @last}}<div class="divider-dot"></div>{{/unless}}',
  '              {{/each}}'
), L(
  '              {{!-- Where a character carries heritage, culture, background and',
  '                   classes, a monster carries what the book prints under its',
  '                   name: size, creature type, the tags a5e keeps as flags of',
  '                   their own, and the terrain it is found in. --}}',
  '              {{#if npc.subtitle}}',
  '                <span class="creature-type">',
  '                  <span class="font-label-medium color-text-gold">{{npc.subtitle}}</span>',
  '                </span>',
  '                <div class="divider-dot"></div>',
  '              {{/if}}',
  '',
  '              {{#each npc.terrain}}',
  '                <span class="alignment hide-under-700">',
  '                  <span class="font-label-medium color-text-gold">{{this}}</span>',
  '                </span>',
  '                <div class="hide-under-700 divider-dot"></div>',
  '              {{/each}}',
  '',
  '              {{#if npc.languages}}',
  '                <span class="species hide-under-600">',
  '                  <span class="font-label-medium color-text-gold">{{npc.languages}}</span>',
  '                </span>',
  '              {{/if}}'
));

/* ── The level block becomes the challenge rating ─────────────────────────── */
swap('level block', L(
  '          <div class="level-block">',
  '            <span class="level bonus font-data-xlarge color-text-default"',
  '              data-tooltip="Level">{{charInfo.totalLevel}}</span>'
), L(
  '          {{!-- Challenge rating stands exactly where the character level',
  '               stands, in the same plate, with the same proficiency row under',
  '               it. The XP the rating is worth rides along in the tooltip. --}}',
  '          <div class="level-block">',
  '            <span class="level bonus font-data-xlarge color-text-default"',
  '              data-tooltip="Challenge {{npc.cr}} — {{npc.xp}} XP">{{npc.cr}}</span>'
));

/* ── The tab strip is the character sheet’s, unchanged ───────────────────
   It was not, for two releases: Favorites and Actions were dropped and a
   Statblock tab took the first place, because a sample of a5e’s monsters had
   nothing in Actions and a monster’s shortlist is arguably its statblock.

   The instruction since is the better rule and it is followed here:
   everything is to be synchronised with the character sheet. A tab that is
   empty for a monster is a tab that is empty, which is a smaller problem than
   two sheets that disagree about what tabs exist.

   So this file no longer touches the strip. What differs is the header, and
   only the header. */

/* ── A panel whose tab was dropped goes with it ───────────────────────────
   Removing a tab above leaves its content in the file: rendered, in the DOM,
   and unreachable, because nothing can activate it. Rather than anchor a
   second substitution per tab — which would rot the moment a tab moves — the
   rule is stated once: every panel whose data-tab-contents-for is not among
   the data-tab-id values left in the strip is cut out.

   The sidebar’s own two panels are addressed by data-sidebar-tab and are not
   in the strip, so they are spared explicitly. */
function dropOrphanPanels() {
  const tabs = new Set([...text.matchAll(/data-tab-id="([a-z]+)"/g)].map(m => m[1]));
  const sidebar = new Set(['skills', 'traits']);
  const panels = [...new Set([...text.matchAll(/data-tab-contents-for="([a-z]+)"/g)]
                    .map(m => m[1]))];
  let cut = 0;
  for (const id of panels) {
    if (tabs.has(id) || sidebar.has(id)) continue;
    const at = text.indexOf(`data-tab-contents-for="${id}"`);
    if (at < 0) continue;
    /* Back up to the <div that opens this panel, then forward to its close,
       counting nesting so the panel leaves whole. */
    const start = text.lastIndexOf('<div', at);
    let depth = 0, i = start;
    for (; i < text.length; i++) {
      if (text.startsWith('<div', i)) depth++;
      else if (text.startsWith('</div>', i)) { depth--; if (!depth) { i += 6; break; } }
    }
    if (depth !== 0) { console.error(`FAIL: the ${id} panel never closes`); failures++; continue; }
    text = text.slice(0, start) + text.slice(i);
    cut++;
  }
  if (cut) console.log(`  dropped ${cut} panel(s) whose tab is gone`);
}
dropOrphanPanels();

if (failures) {
  console.error(`\n${failures} substitution(s) failed — npc-sheet.hbs NOT written.`);
  console.error('The character template has moved under this script; re-anchor it.');
  process.exit(1);
}

fs.writeFileSync(OUT, text);
console.log(`npc-sheet.hbs built from tidy-character-sheet.hbs `
          + `(${text.split(eol).length} lines)`);
