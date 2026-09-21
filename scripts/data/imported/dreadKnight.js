/**
 * Dread Knight, a warlock archetype - Gate Pass Gazette #8, from
 * https://a5e.tools/node/3780. The text is the source's; the structure is
 * a5e's own, built the way its packs build an archetype, so the builder, the
 * level-up and a5e's sheet read it like any other:
 *
 *   the archetype    class warlock, Wisdom as its spellcasting ability, and a
 *                    feature grant at 1st, 6th, 10th and 14th
 *   Dread Armaments  medium armor, and a choice of Eldritch Maneuvers or
 *                    Eldritch Smite
 *   Baleful Blows    a choice of Fearful, Miring or Noxious Blows
 *
 * The 1st-level grant also offers the Expanded Spell List, as 17 of the 21
 * warlock archetypes in a5e's packs do: it is how a5e hands a warlock that
 * choice. Spells named in a feature's text (find steed, at 6th) are added by
 * ProseSpells as the text says, always prepared and outside the spells known.
 *
 * Ids are fixed, so every link below - and every character that took the
 * archetype - keeps pointing at the same documents when the pack is rebuilt.
 */
const PACK = 'Compendium.world.a5e-mancer-imported.Item.';
const SOURCE = 'gpg8';
const A5E_FEATURE = 'Compendium.a5e.a5e-class-features.Item.';
const A5E_SPELL = 'Compendium.a5e.a5e-spells.Item.';

export const DREAD_KNIGHT_IDS = {
  archetype: 'amImpDreadKnight',
  armaments: 'amImpDKArmament0',
  maneuvers: 'amImpDKManeuver0',
  smite:     'amImpDKSmite0000',
  rider:     'amImpDKRider0000',
  baleful:   'amImpDKBaleful00',
  fearful:   'amImpDKFearful00',
  miring:    'amImpDKMiring000',
  noxious:   'amImpDKNoxious00',
  recall:    'amImpDKRecall000'
};
const ID = DREAD_KNIGHT_IDS;
const ref = (id, name, img = '') => ({ uuid: PACK + id, name, img, limitedReselection: true, selectionLimit: 1 });

/* The Herald table, as the feature says, with the one maneuver it gives at 1st */
const HERALD = { known: [0, 1, 2, 2, 3, 3, 3, 4, 4, 4, 5, 5, 5, 6, 6, 6, 7, 7, 7, 8, 8],
                 degree: [0, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3, 4, 4] };
const ord = (n) => `${n}${n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'}`;
const maneuverTable = '<p><strong>Table: Eldritch Maneuvers</strong></p>'
  + '<table border="1"><thead><tr><td>Level</td><td>Maneuvers Known</td><td>Maneuver Degree</td></tr></thead><tbody>'
  + Array.from({ length: 20 }, (_, i) => i + 1)
      .map((l) => `<tr><td>${ord(l)}</td><td>${HERALD.known[l]}</td><td>${ord(HERALD.degree[l])}</td></tr>`).join('')
  + '</tbody></table>';

const featureGrant = (_id, level, label, { base = [], options = [], total = 0 } = {}) => ({
  [_id]: { _id, grantType: 'feature', level, levelType: 'class', optional: false, label, img: '',
           features: { base, options, total } }
});

function feature(_id, name, img, description, { grants = {}, actions = {}, uses = null, flags = {} } = {}) {
  return {
    _id, name, type: 'feature', img,
    system: {
      description, secretDescription: '', source: SOURCE,
      featureType: 'class', classes: 'warlock', class: '', prerequisite: '',
      requiresBloodied: false, concentration: false, favorite: false,
      uses: uses ?? { value: 0, max: '', per: '', recharge: { formula: '1d6', threshold: 6 } },
      actions, grants
    },
    flags: { 'a5e-mancer': { imported: 'dread-knight', ...flags } },
    effects: []
  };
}

/** An action with a saving throw against the spell save DC, for the three blows */
const saveAction = (_id, name, ability) => ({
  [_id]: {
    name,
    activation: { cost: 1, type: 'special', reactionTrigger: '' },
    duration: { unit: 'minutes', value: '1' },
    target: { quantity: 1, type: 'creature', shape: '', size: '' },
    prompts: { [_id + 'p']: { type: 'savingThrow', ability, onSave: '', saveDC: { type: 'spellcasting', bonus: null } } },
    rolls: {}, consumers: {}
  }
});

export const DREAD_KNIGHT = [
  /* ── the archetype ─────────────────────────────────────────────── */
  {
    _id: ID.archetype, name: 'Dread Knight', type: 'archetype',
    img: 'icons/magic/unholy/silhouette-evil-horned-giant.webp',
    system: {
      class: 'warlock', slug: '', source: SOURCE, favorite: false, secretDescription: '',
      description:
        '<p>Known variously as anti-paladins, blackguards, and nightmare cavalry, dread knight warlocks exist to sow fear and confusion, riding fell steeds to the forefront of battle to strike down the enemies of their patrons. Many who walk this path follow fiends, though there are others who swear allegiance to dark fey, spiteful gods, or even stranger beings.</p>'
        + '<p>As your powers are derived from how well you obey your patron’s code and intuit its will, you must choose Wisdom as your spellcasting ability for this class.</p>'
        + '<p><strong>Table: Dread Knight</strong></p>'
        + '<table border="1"><thead><tr><td>Level</td><td>Features</td></tr></thead><tbody>'
        + `<tr><td>1st</td><td>@UUID[${PACK}${ID.armaments}]{Dread Armaments}, @UUID[${A5E_FEATURE}9z7flr4asm95pk3c]{Expanded Spell List}</td></tr>`
        + `<tr><td>6th</td><td>@UUID[${PACK}${ID.rider}]{Dread Rider}</td></tr>`
        + `<tr><td>10th</td><td>@UUID[${PACK}${ID.baleful}]{Baleful Blows}</td></tr>`
        + `<tr><td>14th</td><td>@UUID[${PACK}${ID.recall}]{Recall the Damned}</td></tr>`
        + '</tbody></table>'
        + '<p><em>Source: Gate Pass Gazette #8.</em></p>',
      grants: {
        ...featureGrant('dkGrantLevel0001', 1, '1st Level Archetype Features', { base: [
          ref(ID.armaments, 'Dread Armaments', 'icons/equipment/chest/breastplate-layered-steel-black.webp'),
          { uuid: A5E_FEATURE + '9z7flr4asm95pk3c', name: 'Expanded Spell List', img: '', limitedReselection: true, selectionLimit: 1 }
        ] }),
        ...featureGrant('dkGrantLevel0006', 6, '6th Level Archetype Features', { base: [ref(ID.rider, 'Dread Rider', 'icons/magic/fire/elemental-creature-horse.webp')] }),
        ...featureGrant('dkGrantLevel0010', 10, '10th Level Archetype Features', { base: [ref(ID.baleful, 'Baleful Blows', 'icons/skills/melee/strike-sword-dagger-runes-red.webp')] }),
        ...featureGrant('dkGrantLevel0014', 14, '14th Level Archetype Features', { base: [ref(ID.recall, 'Recall the Damned', 'icons/magic/death/skeleton-skull-soul-blue.webp')] })
      },
      resources: [],
      /* Wisdom, and nothing else: "you must choose Wisdom". a5e's own warlock
         archetypes offer int, wis or cha here. */
      spellcasting: { ability: { base: 'wis', options: ['wis'], value: 'wis' }, casterType: 'warlockA5e' },
      actions: {},
      price: { value: 0, denomination: 'gp', special: '' }
    },
    flags: { 'a5e-mancer': { imported: 'dread-knight', url: 'https://a5e.tools/node/3780' } },
    effects: []
  },

  /* ── 1st: Dread Armaments, and its choice ──────────────────────── */
  feature(ID.armaments, 'Dread Armaments', 'icons/equipment/chest/breastplate-layered-steel-black.webp',
    '<p>At 1st level, your patron strengthens your martial prowess. You gain proficiency with medium armor. If you later choose the Eldritch Warrior eldritch invocation, you instead gain proficiency with heavy armor. Additionally, choose one of the following features.</p>'
    + `<p>@UUID[${PACK}${ID.maneuvers}]{Eldritch Maneuvers} or @UUID[${PACK}${ID.smite}]{Eldritch Smite}.</p>`,
    { grants: {
      dkGrantArmorMed1: { _id: 'dkGrantArmorMed1', grantType: 'proficiency', proficiencyType: 'armor', level: 1, levelType: 'class',
        optional: false, label: 'Armor Proficiency', isExpertise: false, keys: { base: ['medium'], options: [], total: 0 } },
      ...featureGrant('dkGrantArmament1', 1, 'Dread Armaments', { options: [
        ref(ID.maneuvers, 'Eldritch Maneuvers', 'icons/skills/melee/maneuver-sword-katana-yellow.webp'),
        ref(ID.smite, 'Eldritch Smite', 'icons/magic/lightning/bolt-strike-purple-pink.webp')
      ], total: 1 })
    } }),

  feature(ID.maneuvers, 'Eldritch Maneuvers', 'icons/skills/melee/maneuver-sword-katana-yellow.webp',
    '<p>You gain proficiency in two combat traditions from the following list: Adamant Mountain, Mirror’s Glint, Spirited Steed, Tempered Iron, Unending Wheel. You learn one maneuver of your choice from traditions you are proficient with.</p>'
    + '<p>You do not gain exertion, and you may never use maneuvers learned through this feature by spending exertion. Instead, you use these maneuvers by expending spell points equal to the required exertion. You may not spend spell points to use maneuvers learned in another way. You use the Herald table to determine when you learn more maneuvers and what degree those maneuvers can be.</p>'
    + '<p>Whenever you learn a new maneuver, you may choose one of the maneuvers you know and replace it with another of the same level or lower from a tradition you are proficient with. You may treat Eldritch Scythe and Eldritch Whip as melee weapons for the purpose of maneuvers learned through this feature. Any additional damage granted by a maneuver is not added to Eldritch Scythe’s bonus damage or Eldritch Whip’s temporary hit points. While you are wielding your pact weapon, or when you use Eldritch Scythe or Eldritch Whip to make a maneuver, you may use your spell save DC in place of your maneuver save DC.</p>'
    + maneuverTable,
    { grants: {
      dkGrantTradition: { _id: 'dkGrantTradition', grantType: 'proficiency', proficiencyType: 'tradition', level: 1, levelType: 'class',
        optional: false, label: 'Combat Traditions', isExpertise: false,
        keys: { base: [], options: ['adamantMountain', 'mirrorsGlint', 'spiritedSteed', 'temperedIron', 'unendingWheel'], total: 2 } }
    },
    /* Read by the module: maneuvers learned through this feature spend spell
       points, not exertion - see ManeuverService.spendSpellPoints */
    flags: { maneuversCost: 'spellPoints' } }),

  feature(ID.smite, 'Eldritch Smite', 'icons/magic/lightning/bolt-strike-purple-pink.webp',
    '<p>Once per round, when you hit a creature with your pact weapon, Eldritch Scythe, or Eldritch Whip, you may expend a number of spell points up to your proficiency bonus to deal 1d8 force damage per spell point. This additional damage is not added to Eldritch Scythe’s bonus damage or Eldritch Whip’s temporary hit points.</p>',
    { actions: {
      dkSmiteAction001: {
        name: 'Eldritch Smite',
        activation: { cost: 1, type: 'special', reactionTrigger: '' },
        target: { quantity: 1, type: 'creature', shape: '', size: '' },
        prompts: {},
        /* 1d8 a point: a5e raises the dice with the points spent, as its own
           spell-point features do */
        rolls: { dkSmiteRoll00001: { type: 'damage', default: true, canCrit: true, formula: '1d8', damageType: 'force',
                                     label: 'Eldritch Smite', scaling: { mode: 'spellPoints', formula: '1d8' } } },
        consumers: { dkSmiteSpend0001: { type: 'spell', default: true, mode: 'pointsOnly', spellLevel: 1, points: 1 } }
      }
    } }),

  /* ── 6th ───────────────────────────────────────────────────────── */
  feature(ID.rider, 'Dread Rider', 'icons/magic/fire/elemental-creature-horse.webp',
    `<p>At 6th level, your patron gives you access to their personal stable. You learn the @UUID[${A5E_SPELL}oqsv50k3glkbk7z2]{find steed} spell. It does not count towards your number of spells known, and you can cast it as a ritual. You cannot choose for the steed’s creature type to be celestial when you cast the spell using this method, though you can choose the aberration creature type.</p>`
    + '<p>Additionally, over the course of a short rest, you may spend an hour and 100 gold of spell ingredients to perform a similar ritual that summons a dread mount. This ritual dismisses any mount summoned by a previous casting of find steed. A dread mount functions as a spirit summoned by find steed with the following alterations.</p>'
    + '<ul><li>If you order your dread mount to take the Attack action, it uses your spell attack modifier in place of its own attack modifier.</li>'
    + '<li>You calculate your dread mount’s hit points as though you had cast find steed using your maximum spell level (including spells learned by Sixth Arcana and similar eldritch invocations).</li>'
    + '<li>When your maximum spell level is 4th-level or higher, you can grant it a swim or fly speed as though you had cast find steed with a 4th-level spell slot.</li>'
    + '<li>Once per short or long rest, you can spend a number of spell points up to your proficiency bonus. Your dread mount gains temporary hit points equal to the number of spell points spent multiplied by your warlock level. These temporary hit points last until the beginning of your next long rest.</li></ul>'
    + '<p>If your dread mount dies, you may perform this ritual again to resummon it or bind a new dread mount.</p>',
    { uses: { value: 1, max: '1', per: 'shortRest', recharge: { formula: '1d6', threshold: 6 } },
      actions: {
        dkRiderAction001: {
          name: 'Empower Dread Mount',
          activation: { cost: 1, type: 'special', reactionTrigger: '' },
          target: { quantity: 1, type: 'creature', shape: '', size: '' },
          prompts: {},
          // warlock level a point, raised with the points spent
          rolls: { dkRiderRoll00001: { type: 'healing', default: true, healingType: 'temporaryHealing',
                                       formula: '@classes.warlock.level', label: 'Temporary hit points',
                                       scaling: { mode: 'spellPoints', formula: '@classes.warlock.level' } } },
          consumers: {
            dkRiderSpend0001: { type: 'spell', default: true, mode: 'pointsOnly', spellLevel: 1, points: 1 },
            dkRiderUses00001: { type: 'itemUses', default: true, quantity: 1 }
          }
        }
      } }),

  /* ── 10th: Baleful Blows, and its choice ───────────────────────── */
  feature(ID.baleful, 'Baleful Blows', 'icons/skills/melee/strike-sword-dagger-runes-red.webp',
    '<p>At 10th level, your patron magnifies your fiercest attacks. The critical hit range for your pact weapon, Eldritch Scythe, and Eldritch Whip increases by 1 to 19–20. If you already have a feature that increases this range, your critical hit range increases by 1 (maximum 17–20).</p>'
    + '<p>In addition, choose one of the following, which applies whenever you score a critical hit with a weapon attack, Eldritch Scythe, or Eldritch Whip.</p>'
    + `<p>@UUID[${PACK}${ID.fearful}]{Fearful Blows}, @UUID[${PACK}${ID.miring}]{Miring Blows} or @UUID[${PACK}${ID.noxious}]{Noxious Blows}.</p>`,
    { grants: featureGrant('dkGrantBaleful01', 10, 'Baleful Blows', { options: [
      ref(ID.fearful, 'Fearful Blows', 'icons/magic/control/fear-fright-monster-red.webp'),
      ref(ID.miring, 'Miring Blows', 'icons/magic/control/debuff-chains-red.webp'),
      ref(ID.noxious, 'Noxious Blows', 'icons/magic/death/skull-poison-green.webp')
    ], total: 1 }) }),

  feature(ID.fearful, 'Fearful Blows', 'icons/magic/control/fear-fright-monster-red.webp',
    '<p>The target becomes frightened of you for one minute. At the end of each of the target’s turns it may make a Wisdom saving throw against your spell save DC. On a success, it is no longer slowed.</p>',
    { actions: saveAction('dkFearfulAction1', 'Fearful Blows', 'wis') }),
  feature(ID.miring, 'Miring Blows', 'icons/magic/control/debuff-chains-red.webp',
    '<p>The target is slowed for one minute. At the end of each of the target’s turns it may make an Intelligence saving throw against your spell save DC. On a success, it is no longer confused.</p>',
    { actions: saveAction('dkMiringAction01', 'Miring Blows', 'int') }),
  feature(ID.noxious, 'Noxious Blows', 'icons/magic/death/skull-poison-green.webp',
    '<p>The target is poisoned for one minute. At the end of each of the target’s turns it may make a Constitution saving throw against your spell save DC. On a success, it is no longer poisoned. This does not affect creatures that are immune to the poisoned condition.</p>',
    { actions: saveAction('dkNoxiousAction1', 'Noxious Blows', 'con') }),

  /* ── 14th ──────────────────────────────────────────────────────── */
  feature(ID.recall, 'Recall the Damned', 'icons/magic/death/skeleton-skull-soul-blue.webp',
    '<p>At 14th level, you learn how to temporarily shackle the spirits of the recently dead. If you have killed a creature with the beast or humanoid type with your pact weapon, Eldritch Scythe, or Eldritch Whip, you can, on the following round, cast dominate beast or dominate person on it as though it were alive. Casting a spell in this way does not require spell points, though it has no effect if the creature has been dead longer than 1 round. The target creature still makes its saving throw and reacts to the spell’s effects as normal, though its creature type becomes undead for the duration of the spell, after which it reverts to a mundane corpse that cannot be reanimated.</p>'
    + '<p>This feature does not add dominate beast or dominate person to your list of spells known; you may only use these spells in the context of this feature. Once you have used this feature, you cannot use it again until you have finished a long rest.</p>',
    { uses: { value: 1, max: '1', per: 'longRest', recharge: { formula: '1d6', threshold: 6 } },
      actions: {
        dkRecallAction01: {
          name: 'Recall the Damned',
          activation: { cost: 1, type: 'action', reactionTrigger: '' },
          target: { quantity: 1, type: 'creature', shape: '', size: '' },
          prompts: {}, rolls: {},
          consumers: { dkRecallUses0001: { type: 'itemUses', default: true, quantity: 1 } }
        }
      } })
];
