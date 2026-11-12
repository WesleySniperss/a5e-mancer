// A picture for an imported monster, and one its token can show.
//
// a5e.tools has a picture on 50 of its 313 monster pages and sends no CORS headers, so Foundry shows
// those as the portrait but can never draw one on a token: a token's texture is fetched in CORS mode
// (TextureLoader.loadTexture). What every monster can have, in this order:
//
// 1. a5e's own pictures, systems/a5e/assets - on every a5e install, and served by the world's own server,
//    so tokens show them - by creature family. A monster whose name holds the name of an a5e monster that
//    has a picture, or the picture's own name, and that shares its creature type, takes the picture:
//    "Skeleton Horde" the skeleton, "Vampire Lord Nemirtvi" the vampire. A name two pictures share
//    ("dragon", "elemental") says nothing and is left out; so is a name the type does not back
//    ("Shadow Elf Archmage" is no shadow).
// 2. the few the names do not say: Dracula is a vampire, Grendel is drawn as a5e draws Grendelkin.
// 3. a core Foundry icon for a word in the name, where the word fits the creature type: a wolf, a spider,
//    a drone, a knight.
// 4. nothing: the builder falls back on its creature-type icon.
const fs = require('fs'), path = require('path');
const P = require('./paths.cjs');

const singular = (w) => {
  if (w.length >= 5 && w.endsWith('ves')) return w.slice(0, -3) + 'f';      // wolves, elves
  if (w.length >= 5 && w.endsWith('ies')) return w.slice(0, -3) + 'y';      // harpies
  if (w.length >= 5 && /(ss|sh|ch|x)es$/.test(w)) return w.slice(0, -2);   // foxes
  if (w.length >= 4 && w.endsWith('s') && !/(ss|us|is)$/.test(w)) return w.slice(0, -1);
  return w;
};
const words = (s) => String(s).toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean).map(singular);
const phraseIn = (phrase, name) => (` ${name.join(' ')} `).includes(` ${phrase} `);

const A5E = (file) => `systems/a5e/assets/${file}`;
const exists = (img) => fs.existsSync(img.startsWith('systems/a5e/') ? path.join(P.SYSTEM, img.slice('systems/a5e/'.length)) : P.PUBLIC + img);

/** The family names a5e's own pictures are drawn for: phrase -> { img, types }. */
const FAMILIES = (() => {
  const index = JSON.parse(fs.readFileSync(path.join(P.PACKS, 'monsterIndex.json'), 'utf8'));
  if (!index.some((m) => Array.isArray(m.types))) throw new Error('monsterIndex.json has no creature types - rerun tools/import/prepare.cjs');
  const out = new Map();
  const add = (phrase, img, types) => {
    if (phrase.replace(/ /g, '').length < 4) return;
    const e = out.get(phrase) ?? { imgs: new Set(), types: new Set() };
    e.imgs.add(img);
    for (const t of types ?? []) e.types.add(t);
    out.set(phrase, e);
  };
  for (const m of index) {
    if (!/^systems\/a5e\/assets\/[^/]+\.webp$/.test(m.img || '') || !exists(m.img)) continue;
    // "Conjured Woodland Beings (Satyr)" names one picture for three kinds of creature
    if (!/[(:]/.test(m.name)) add(words(m.name).join(' '), m.img, m.types);
    add(words(path.basename(m.img, '.webp').replace(/[-_]/g, ' ').replace(/\d+$/, '')).join(' '), m.img, m.types);
  }
  for (const [phrase, e] of out) {
    if (e.imgs.size > 1) out.delete(phrase);
    else out.set(phrase, { img: [...e.imgs][0], types: e.types });
  }
  return out;
})();

/** Names that say nothing of the family, and what a5e or the core icons draw them as. */
const ALIASES = {
  dracula: A5E('vampire.webp'),
  doppelganger: A5E('doppleganger.webp'),
  grendel: A5E('troll.webp'),
  'loch ness monster': A5E('sea-serpent.webp'),
  arachne: A5E('drider.webp'),
  cerberus: 'icons/creatures/abilities/wolf-heads-swirl-purple.webp',
  fenrir: 'icons/creatures/mammals/wolf-howl-moon-black.webp',
  thunderbird: 'icons/creatures/birds/raptor-hawk-flying.webp',
  cthulhu: 'icons/creatures/tentacles/tentacles-octopus-black-pink.webp'
};

/* Words, the core icon they are drawn with, and the creature types they may be drawn for */
const ANIMAL = ['beast', 'monstrosity', 'fey'];
const PEOPLE = ['humanoid', 'undead'];
const ICON_WORDS = [
  [['wolf', 'warg', 'cyberwolf'], 'icons/creatures/mammals/wolf-howl-moon-gray.webp', [...ANIMAL, 'construct']],
  [['dog', 'hound', 'jackal'], 'icons/creatures/mammals/dog-husky-white-blue.webp', ANIMAL],
  [['bear'], 'icons/creatures/abilities/bear-roar-bite-brown.webp', ANIMAL],
  [['lion'], 'icons/creatures/abilities/lion-roar-yellow.webp', ANIMAL],
  [['cat', 'jaguar', 'cougar', 'panther', 'tiger', 'leopard'], 'icons/creatures/abilities/cougar-pounce-stalk-black.webp', ANIMAL],
  [['bat'], 'icons/creatures/mammals/bat-giant-tattered-purple.webp', ANIMAL],
  [['rat', 'mole', 'rodent', 'mouse'], 'icons/creatures/mammals/rodent-rat-green.webp', ANIMAL],
  [['deer', 'elk', 'moose', 'stag'], 'icons/creatures/mammals/deer-antlers-green.webp', ANIMAL],
  [['ox', 'bull', 'buffalo', 'bison'], 'icons/creatures/mammals/ox-buffalo-horned-green.webp', ANIMAL],
  [['goat'], 'icons/creatures/mammals/goat-horned-blue.webp', ANIMAL],
  [['boar', 'pig', 'hog'], 'icons/creatures/mammals/livestock-pig-green.webp', ANIMAL],
  [['rabbit', 'hare'], 'icons/creatures/mammals/rabbit-movement-glowing-green.webp', ANIMAL],
  [['unicorn'], 'icons/creatures/mammals/unicorn-horned-white.webp', ANIMAL],
  [['spider'], 'icons/creatures/invertebrates/spider-mandibles-brown.webp', ANIMAL],
  [['scorpion'], 'icons/creatures/invertebrates/scorpion-yellow.webp', ANIMAL],
  [['ant'], 'icons/creatures/invertebrates/ant-strength-green.webp', ANIMAL],
  [['bee', 'wasp', 'hornet'], 'icons/creatures/invertebrates/wasp-swarm-attack.webp', ANIMAL],
  [['beetle'], 'icons/creatures/invertebrates/beetle-stag-tan-brown.webp', ANIMAL],
  [['centipede'], 'icons/creatures/invertebrates/centipede-brown.webp', ANIMAL],
  [['fly', 'mosquito', 'gnat'], 'icons/creatures/invertebrates/fly-wasp-mosquito-green.webp', ANIMAL],
  [['leech'], 'icons/creatures/invertebrates/leech-attack-green.webp', ANIMAL],
  [['snail', 'slug'], 'icons/creatures/invertebrates/snail-movement-green.webp', ANIMAL],
  [['tick'], 'icons/creatures/invertebrates/tick-cross-glowing-purple.webp', ANIMAL],
  [['snake', 'serpent', 'viper', 'cobra', 'cybersnake'], 'icons/creatures/reptiles/snake-fangs-bite-green.webp', [...ANIMAL, 'construct']],
  [['lizard', 'iguana', 'chameleon', 'gecko'], 'icons/creatures/reptiles/lizard-iguana-green.webp', ANIMAL],
  [['turtle', 'tortoise'], 'icons/creatures/reptiles/turtle-shell-glowing-green.webp', ANIMAL],
  [['frog', 'toad'], 'icons/creatures/amphibians/bullfrog-glowing-green.webp', ANIMAL],
  [['crab'], 'icons/creatures/fish/crab-blue-purple.webp', ANIMAL],
  [['shark'], 'icons/creatures/fish/fish-shark-swimming.webp', ANIMAL],
  [['octopus'], 'icons/creatures/fish/octopus-pink.webp', ANIMAL],
  [['squid', 'kraken'], 'icons/creatures/fish/squid-kraken-teal.webp', [...ANIMAL, 'aberration']],
  [['jellyfish'], 'icons/creatures/fish/jellyfish-swarm-eyed-teal.webp', ANIMAL],
  [['piranha', 'fish', 'eel'], 'icons/creatures/fish/fish-pirahna-tan.webp', ANIMAL],
  [['crow', 'raven', 'corvid'], 'icons/creatures/birds/corvid-flying-wings-purple.webp', ANIMAL],
  [['owl'], 'icons/creatures/birds/raptor-owl-flying-moon.webp', ANIMAL],
  [['hawk', 'eagle', 'falcon', 'vulture'], 'icons/creatures/birds/raptor-hawk-flying.webp', ANIMAL],
  [['sparrow', 'songbird', 'bird', 'finch'], 'icons/creatures/birds/songbird-yellow-flying.webp', ANIMAL],
  [['chicken', 'hen', 'rooster'], 'icons/creatures/birds/chicken-hen-white.webp', ANIMAL],
  [['ghost', 'spirit', 'phantom', 'poltergeist', 'specter', 'spectre', 'wraith', 'haunt'], 'icons/creatures/magical/spirit-undead-ghost-blue.webp', ['undead']],
  [['demon', 'devil', 'fiend', 'hordeling'], 'icons/creatures/unholy/demon-horned-winged-laughing.webp', ['fiend']],
  [['imp'], 'icons/creatures/unholy/demon-fire-imp.webp', ['fiend']],
  [['succubus', 'incubus'], 'icons/creatures/unholy/demon-female-succubus-orange.webp', ['fiend']],
  [['drone', 'robot', 'automaton', 'turret', 'android', 'cyberraptor', 'cyberrex', 'men'], 'icons/creatures/magical/construct-golem-robot-blue.webp', ['construct']],
  [['golem', 'guardian'], 'icons/creatures/magical/construct-golem-stone-blue.webp', ['construct']],
  [['gargoyle'], 'icons/creatures/magical/construct-gargoyle-stone-gray.webp', ['construct']],
  [['fairy', 'faerie', 'pixie', 'sprite'], 'icons/creatures/magical/fae-fairy-winged-glowing-green.webp', ['fey']],
  [['mote', 'wisp'], 'icons/creatures/magical/spirit-fire-yellow.webp', ['elemental', 'fey', 'undead']],
  [['mushroom', 'fungus', 'mindspore'], 'icons/consumables/mushrooms/mushroom-spotted-red.webp', ['plant']],
  [['ooze', 'slime', 'jelly', 'pudding'], 'icons/creatures/slimes/slime-movement-pseudopods-green.webp', ['ooze']],
  [['eye', 'beholder'], 'icons/creatures/eyes/void-single-black-purple.webp', ['aberration']],
  [['mothman', 'alien'], 'icons/creatures/magical/humanoid-silhoette-alien-gray.webp', ['aberration', 'humanoid']],
  [['dragon', 'drake', 'wyrm', 'wyvern'], 'icons/creatures/reptiles/dragon-winged-blue.webp', ['dragon']],
  [['archer', 'hunter', 'ranger', 'bowman', 'sniper', 'markswoman', 'marksman'], 'icons/environment/people/archer.webp', PEOPLE],
  [['knight', 'cavalier', 'rider', 'horseman', 'paladin'], 'icons/environment/people/cavalry.webp', PEOPLE],
  [['priest', 'priestess', 'cleric', 'monk', 'nun', 'acolyte', 'abbot', 'bishop', 'cultist'], 'icons/environment/people/cleric-orange.webp', PEOPLE],
  [['soldier', 'guard', 'warrior', 'legionnaire', 'gladiator', 'berserker', 'warlord', 'champion', 'mercenary', 'brute', 'bruiser', 'breaker', 'killer'], 'icons/environment/people/infantry-armored.webp', PEOPLE],
  [['spearman', 'hoplite', 'pikeman'], 'icons/environment/people/spearfighter.webp', PEOPLE],
  [['horde', 'gang', 'mob', 'crew', 'band'], 'icons/environment/people/group.webp', PEOPLE]
];
for (const [, img] of ICON_WORDS) if (!exists(img)) throw new Error(`monsterArt: ${img} is not in this Foundry install`);
for (const img of Object.values(ALIASES)) if (!exists(img)) throw new Error(`monsterArt: ${img} is not in this install`);

/**
 * The picture for a monster, or null: { img, how } - how is 'a5e' (a5e's own art), 'alias' or 'icon'.
 * @param {string} name
 * @param {string[]} types   its creature types
 */
function pictureOf(name, types) {
  const ws = words(name);
  for (const [alias, img] of Object.entries(ALIASES)) if (phraseIn(alias, ws)) return { img, how: 'alias' };
  let best = null;
  for (const [phrase, e] of FAMILIES) {
    if (!phraseIn(phrase, ws) || !types.some((t) => e.types.has(t))) continue;
    if (!best || phrase.length > best.phrase.length) best = { phrase, img: e.img };
  }
  if (best) return { img: best.img, how: 'a5e', phrase: best.phrase };
  for (const [list, img, fits] of ICON_WORDS) {
    if (!types.some((t) => fits.includes(t))) continue;
    if (list.some((w) => phraseIn(w, ws))) return { img, how: 'icon' };
  }
  return null;
}

module.exports = { pictureOf };
