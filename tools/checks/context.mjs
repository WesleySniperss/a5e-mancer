/* Every path the sheet's templates read, against the context the sheet builds.
 *
 * Handlebars does not complain about a name it cannot find. `{{#if showXP}}`
 * with no `showXP` in the context is not an error — it is false, forever, and
 * the block inside it never appears. A misspelt `{{tidy.currencies}}` renders
 * as empty text. Both look, from the outside, exactly like "the tab is empty"
 * and "the checkbox does nothing", which is most of what has been reported on
 * this project.
 *
 * So: build the real context for a real character out of the world, parse the
 * templates into their AST, and walk it with a scope stack holding the actual
 * values — through {{#each}}, {{#with}}, and into the partials with the hash
 * arguments their callers hand them, which is the only frame those can be
 * judged against.
 *
 * Three outcomes, and only the first is a finding:
 *
 *   MISSING       the object it would hang off exists, and has no such key,
 *                 at every place the template is rendered from. Nothing will
 *                 ever appear there.
 *   unexercised   every one of those places sits inside an {{#each}} over a
 *                 list this character happens to have none of. Nothing can be
 *                 said, and it is not counted against anything.
 *   fine          it resolved somewhere.
 *
 * Every place matters, and getting that wrong made the first run report fifty
 * things that were not true. A partial is rendered from many call sites, and
 * an absent hash key is not a fault there — it is how the partial says a
 * column is optional. `{{#if c3}}` is false for a two-column table on purpose.
 * So a path counts as missing only when no call site anywhere satisfies it.
 *
 * And one character is not enough either. The row partial is rendered over
 * features, inventory, spells and maneuvers, and only spells carry
 * `concentration`; on a character with no spells that list is empty, the frame
 * is unknowable, and the field reads as absent when it is simply not this
 * character's. So every character in the world is run, and a path that
 * resolves for any of them is settled.
 */
import Handlebars from 'handlebars';
import { readFileSync } from 'fs';
import { buildSheet, R } from './lib/sheetdom.mjs';

/* Enough characters to reach every list the sheet draws. Sorted by how much
   they carry, so the widest sheets are rendered first. */
const CHARACTERS = JSON.parse(readFileSync(R + 'world-chars.json', 'utf8'))
  .map((c, i) => ({ i, items: c.items.length }))
  .sort((a, b) => b.items - a.items);

const SHEET = 'templates/sheet/tidy-character-sheet.hbs';
const PARTIALS = {
  'tidy-table': 'templates/sheet/partial-tidy-table.hbs',
  'tidy-row':   'templates/sheet/partial-tidy-row.hbs'
};
const asts = {};
for (const [name, rel] of Object.entries(PARTIALS))
  asts[name] = { ast: Handlebars.parse(readFileSync(R + rel, 'utf8')), file: rel.split('/').pop() };

/* Helpers and block names are not context paths. */
const HELPERS = new Set(['if', 'unless', 'each', 'with', 'log', 'lookup', 'blockHelperMissing',
  'helperMissing', 'eq', 'ne', 'lt', 'gt', 'and', 'or', 'not', 'localize', 'concat',
  'numberFormat', 'add', 'subtract', 'json', 'capitalize', 'else']);

/* file|path -> what happened at each place it was rendered from */
const outcomes = new Map();

/* Every name any call site passes to each partial.

   A partial's parameters cannot be judged by whether they resolved at some
   particular call site, because not passing one is the whole mechanism: a
   two-column table leaves out c3, and {{#if c3}} is false on purpose. What
   matters is whether ANY caller anywhere names it. One that nobody passes is
   a column, an icon or a badge the partial draws for nothing. */
const paramsOf = {};
(function collect(nodes) {
  for (const node of nodes ?? []) {
    if (node.type === 'PartialStatement' || node.type === 'PartialBlockStatement') {
      const name = node.name?.parts?.[0] ?? node.name?.original;
      const file = asts[name]?.file;
      if (file) for (const pair of node.hash?.pairs ?? []) (paramsOf[file] ??= new Set()).add(pair.key);
    }
    collect(node.program?.body);
    collect(node.inverse?.body);
  }
})(Handlebars.parse(readFileSync(R + SHEET, 'utf8')).body);

/** Resolve a path against the scope stack, the way Handlebars would. */
function resolve(path, stack) {
  if (path.data) return { found: true };                  // @index, @key, @root…
  const parts = path.parts ?? [];
  const frame = path.depth ? stack[stack.length - 1 - path.depth] : stack[stack.length - 1];
  if (frame === undefined) return { found: false, blind: true };
  if (!parts.length) return { found: true };              // {{this}}

  const tryOn = (obj) => {
    let cur = obj;
    for (const p of parts) {
      if (cur === null || cur === undefined) return { stop: true };
      if (!(p in Object(cur))) return { stop: true, at: p, parent: cur };
      cur = cur[p];
    }
    return { stop: false, cur };
  };

  const here = tryOn(frame);
  if (!here.stop) return { found: true, value: here.cur };
  if (path.depth || path.this) return { found: false, ...here };

  /* A bare name the current frame does not carry is looked for up the chain. */
  for (let i = stack.length - 2; i >= 0; i--) {
    const up = tryOn(stack[i]);
    if (!up.stop) return { found: true, value: up.cur };
  }
  return { found: false, ...here };
}

function note(file, path, res) {
  /* Inside a partial, a name some caller passes is supplied by definition. */
  if (paramsOf[file]?.has(path.parts?.[0])) return;
  const key = `${file}|${path.original}`;
  let o = outcomes.get(key);
  if (!o) outcomes.set(key, o = { file, path: path.original, found: 0, blind: 0, why: null });
  if (res.found) o.found++;
  else if (res.blind) o.blind++;
  else o.why ??= res.parent === undefined
    ? 'nothing in scope carries this name'
    : `no "${res.at}" on the object it hangs off`;
}

const isPath = (n) => n?.type === 'PathExpression';
const helperCall = (n) => (n.params?.length > 0 || n.hash?.pairs?.length > 0)
                       && isPath(n.path) && HELPERS.has(n.path.parts?.[0]);

/** Every path inside one expression, its parameters and its hash. */
function expr(node, stack, file) {
  if (isPath(node)) {
    if (!HELPERS.has(node.parts?.[0]) || node.parts?.length > 1)
      note(file, node, resolve(node, stack));
    return;
  }
  if (node?.type === 'SubExpression' || node?.type === 'MustacheStatement') {
    if (!helperCall(node)) expr(node.path, stack, file);
    for (const p of node.params ?? []) expr(p, stack, file);
    for (const pair of node.hash?.pairs ?? []) expr(pair.value, stack, file);
  }
}

/** The frame a partial is rendered with: the caller's, plus its hash. */
function partialFrame(node, stack, file) {
  const base = stack[stack.length - 1];
  const over = {};
  for (const pair of node.hash?.pairs ?? []) {
    expr(pair.value, stack, file);
    over[pair.key] = isPath(pair.value) ? resolve(pair.value, stack).value
                   : pair.value.value !== undefined ? pair.value.value : true;
  }
  /* No caller context means no frame. The hash on its own is not one: it
     carries the column flags and nothing the row itself reads, so treating it
     as the frame reported every field of every row as absent. */
  if (base === undefined) return undefined;
  return { ...base, ...over };
}

function walk(nodes, stack, file) {
  for (const node of nodes ?? []) {
    switch (node.type) {
      case 'MustacheStatement':
        expr(node, stack, file);
        break;

      case 'BlockStatement': {
        const name = node.path?.parts?.[0];
        const arg = node.params[0];
        for (const p of node.params) expr(p, stack, file);
        for (const pair of node.hash?.pairs ?? []) expr(pair.value, stack, file);

        let inner = stack;
        if (name === 'each') {
          const v = arg ? resolve(arg, stack).value : undefined;
          const first = Array.isArray(v) ? v[0]
                      : (v && typeof v === 'object') ? Object.values(v)[0] : undefined;
          inner = [...stack, first];
        } else if (name === 'with') {
          inner = [...stack, arg ? resolve(arg, stack).value : undefined];
        }
        walk(node.program?.body, inner, file);
        walk(node.inverse?.body, name === 'each' ? stack : inner, file);
        break;
      }

      /* {{> tidy-row a=b}} and {{#> tidy-table a=b}}…{{/tidy-table}}.
         Handlebars renders the partial with the caller's own context plus the
         hash, so that — and only that — is the frame it can be judged in. */
      case 'PartialStatement':
      case 'PartialBlockStatement': {
        const name = node.name?.parts?.[0] ?? node.name?.original;
        const frame = partialFrame(node, stack, file);
        const target = asts[name];
        if (target) walk(target.ast.body, [...stack, frame], target.file);
        /* The block body of {{#> …}} renders as @partial-block, in the
           caller's scope. */
        walk(node.program?.body, stack, file);
        break;
      }
    }
  }
}

const sheetAst = Handlebars.parse(readFileSync(R + SHEET, 'utf8'));
const names = [];
for (const { i } of CHARACTERS) {
  const { sheet, character } = await buildSheet({ choose: (all) => all[i] });
  names.push(character);
  walk(sheetAst.body, [await sheet.getData()], SHEET.split('/').pop());
}

/* A path that was ever rendered from a scope this run could not see is not
   proven absent, whatever the other call sites said.

   The row partial is the case: it draws features, inventory, spells and
   maneuvers, and only a spell carries `concentration`. Where the spell list
   is empty that frame is unknowable, while the feature list right beside it
   is perfectly knowable and has no such field — correctly, since a feature is
   not a spell. Counting the second against the first reported six fields the
   sheet does build. So one blind sighting is enough to withhold judgement.

   What this keeps is what caught the real one: {{this.dc}} on the class line,
   read from a list every character has, blind nowhere, and never once put
   into the context. */
const all = [...outcomes.values()];
const missing     = all.filter(o => !o.found && o.why && !o.blind);
const unexercised = all.filter(o => !o.found && (!o.why || o.blind));

console.log(`the context built for all ${names.length} characters in the world`);
console.log(`${all.length} distinct paths read across the sheet and its partials\n`);
if (missing.length) {
  console.log(`paths no call site satisfies: ${missing.length}`);
  for (const o of missing)
    console.log(`  ${o.file.padEnd(28)} {{${o.path}}}  — ${o.why}`);
} else {
  console.log('every path the sheet reads resolves somewhere in the context it builds');
}
if (unexercised.length) {
  console.log(`\nnot exercised by anyone in this world — every call site is inside`
            + ` an empty list, so nothing can be concluded: ${unexercised.length}`);
  const byFile = {};
  for (const o of unexercised) (byFile[o.file] ??= []).push(o.path);
  for (const [f, ps] of Object.entries(byFile))
    console.log(`  ${f}: ${ps.slice(0, 10).join(', ')}${ps.length > 10 ? `, +${ps.length - 10} more` : ''}`);
}
process.exit(missing.length ? 1 : 0);
