import { AM } from '../a5e-mancer.js';

/**
 * Spell slot tables and known spells for a5e classes.
 * a5e uses the same spell system as 5e — Prepared or Known casters.
 */

// Spells known at level 1 for "known" casters
export const CLASS_SPELL_TABLES = {
  bard:      { type: 'known',    spellsKnown: 4,  cantrips: 2, maxLevel: 1 },
  sorcerer:  { type: 'known',    spellsKnown: 2,  cantrips: 4, maxLevel: 1 },
  warlock:   { type: 'known',    spellsKnown: 2,  cantrips: 2, maxLevel: 1 },
  // Prepared casters: spellsKnown: -1 = unlimited (add any spells to their list/spellbook)
  wizard:    { type: 'prepared', spellsKnown: -1, cantrips: 3, maxLevel: 1 },
  cleric:    { type: 'prepared', spellsKnown: -1, cantrips: 3, maxLevel: 1 },
  druid:     { type: 'prepared', spellsKnown: -1, cantrips: 2, maxLevel: 1 },
  herald:    { type: 'prepared', spellsKnown: -1, cantrips: 0, maxLevel: 1 },
  artificer: { type: 'prepared', spellsKnown: -1, cantrips: 2, maxLevel: 1 }
};

/**
 * Secondary school tags that are most relevant per class/caster-type.
 * Classes not listed here rely solely on primary school filtering.
 * Keys are lowercase class names (as they appear in system data).
 */
export const CLASS_RELEVANT_SECONDARY_SCHOOLS = {
  // Elementalist variants — each is scoped to its element(s)
  elementalist:      ['fire', 'water', 'air', 'earth', 'cold', 'lightning', 'thunder', 'acid', 'storm'],
  elementalistfire:  ['fire', 'radiant', 'enhancement'],
  elementalistwater: ['water', 'cold', 'healing'],
  elementalistair:   ['air', 'lightning', 'thunder', 'storm'],
  elementalistearth: ['earth', 'acid', 'nature'],
  // Psion — psionic disciplines
  psion:             ['psionic', 'psychic', 'telepathy', 'compulsion', 'control', 'senses'],
  // Wielder — arcane martial
  wielder:           ['arcane', 'enhancement', 'unarmed', 'weaponry', 'attack'],
  // Witch — nature and shadow
  witch:             ['nature', 'plants', 'beasts', 'poison', 'affliction', 'shadow', 'healing', 'chaos'],
  // Warlock — dark/planar
  warlock:           ['evil', 'shadow', 'planar', 'necrotic', 'undead', 'telepathy'],
  // Cleric / Herald — divine
  cleric:            ['divine', 'healing', 'radiant', 'good', 'evil', 'protection'],
  herald:            ['divine', 'healing', 'radiant', 'good', 'protection'],
  // Druid — nature
  druid:             ['nature', 'plants', 'beasts', 'earth', 'water', 'air', 'weather', 'shapechanging'],
  // Artificer — technological/arcane
  artificer:         ['technological', 'enhancement', 'object', 'arcane', 'utility'],
  // Bard — communication/performance
  bard:              ['communication', 'sound', 'compulsion', 'knowledge', 'enhancement'],
  // Sorcerer — wild/chaos magic
  sorcerer:          ['chaos', 'arcane', 'enhancement', 'prismatic'],
};

/**
 * Returns [{key, label}] for primary spell schools, sourced from CONFIG.A5E at runtime.
 * Falls back to a static list if CONFIG.A5E is unavailable.
 */
export function getSpellSchools() {
  const primary = CONFIG?.A5E?.spellSchools?.primary;
  if (primary) {
    return Object.entries(primary).map(([key, i18nKey]) => ({
      key,
      label: game.i18n.localize(i18nKey)
    })).sort((a, b) => a.label.localeCompare(b.label));
  }
  // Fallback
  return [
    'abjuration','conjuration','divination','enchantment',
    'evocation','illusion','necromancy','transmutation'
  ].map(key => ({ key, label: key.charAt(0).toUpperCase() + key.slice(1) }));
}

/**
 * Returns [{key, label}] for the secondary school tags relevant to a given class.
 * Returns empty array for classes with no relevant secondaries defined.
 */
export function getSecondarySchoolsForClass(className) {
  if (!className) return [];
  const key = className.toLowerCase().replace(/\s+/g, '');
  const relevantKeys = CLASS_RELEVANT_SECONDARY_SCHOOLS[key];
  if (!relevantKeys?.length) return [];

  const secondary = CONFIG?.A5E?.spellSchools?.secondary ?? {};
  return relevantKeys.map(k => ({
    key: k,
    label: secondary[k] ? game.i18n.localize(secondary[k]) : k.charAt(0).toUpperCase() + k.slice(1)
  }));
}

export class SpellService {

  /**
   * Check if a class is a spellcaster (checks hardcoded table + cached dynamic lookups).
   */
  static isSpellcaster(className) {
    return !!CLASS_SPELL_TABLES[className?.toLowerCase()] || !!this._dynamicSpellInfo;
  }

  /**
   * Get spell info for a class at level 1.
   * First checks the hardcoded table, then falls back to cached dynamic info
   * populated by loadClassSpellInfo().
   */
  static getClassSpellInfo(className) {
    return CLASS_SPELL_TABLES[className?.toLowerCase()] ?? this._dynamicSpellInfo ?? null;
  }

  /**
   * Dynamically load spellcasting info from a class compendium item.
   * Call this when the class changes so getClassSpellInfo can return data
   * for classes not in the hardcoded table (e.g. Witch, Psion, etc.)
   *
   * @param {string} classUuid
   * @returns {Promise<object|null>} spell info or null if not a caster
   */
  static async loadClassSpellInfo(classUuid) {
    this._dynamicSpellInfo = null;
    if (!classUuid) return null;

    try {
      const item = await fromUuid(classUuid);
      if (!item) return null;

      const casting = item.system?.spellcasting;
      if (!casting?.casterType || casting.casterType === 'none') return null;

      // Determine cantrips and spells known at level 1 based on caster type
      const casterType = casting.casterType;
      const isFullCaster = ['fullCaster', 'warlockA5e', 'warlock5e', 'elementalist'].includes(casterType);

      // Full casters get spells at level 1, half casters typically at level 2
      // Exception: halfCasterWithFirstLevel gets spells at 1
      const hasSpellsAtOne = isFullCaster || casterType === 'halfCasterWithFirstLevel' || casterType === 'psion' || casterType === 'wielder';

      if (!hasSpellsAtOne) return null;

      const isPrepared = ['halfCaster', 'halfCasterWithFirstLevel'].includes(casterType) && !isFullCaster;
      const info = {
        type: isPrepared ? 'prepared' : 'known',
        cantrips: isFullCaster ? 2 : 0,
        spellsKnown: isPrepared ? -1 : (isFullCaster ? 2 : 1),
        maxLevel: 1
      };

      this._dynamicSpellInfo = info;
      return info;
    } catch (err) {
      AM.log(2, 'Error loading class spell info:', err);
      return null;
    }
  }

  /**
   * Load all spells from compendiums, grouped by level then class.
   * Returns: Map<level (0–9), spell[]>
   */
  static async loadSpells(filterClass = null, maxLevel = 9) {
    const byLevel = new Map();
    for (let i = 0; i <= 9; i++) byLevel.set(i, []);

    const packs = game.packs.filter(p => p.metadata.type === 'Item');

    for (const pack of packs) {
      try {
        const index = await pack.getIndex({
          fields: ['name', 'type', 'img', 'system']
        });
        for (const entry of index) {
          if (entry.type !== 'spell') continue;

          const level  = parseInt(entry.system?.level ?? entry.system?.spellLevel ?? 0);
          if (level > maxLevel) continue;

          // Filter by class if specified
          if (filterClass) {
            const classes = entry.system?.classes ?? entry.system?.spellClasses ?? [];
            const classArr = Array.isArray(classes) ? classes : Object.keys(classes);
            if (classArr.length && !classArr.some(c =>
              c.toLowerCase().includes(filterClass.toLowerCase())
            )) continue;
          }

          const school = entry.system?.schools?.primary ?? entry.system?.school ?? '';
          const schoolI18nKey = CONFIG?.A5E?.spellSchools?.primary?.[school];
          const schoolLabel = schoolI18nKey
            ? game.i18n.localize(schoolI18nKey)
            : (school ? school.charAt(0).toUpperCase() + school.slice(1) : '');

          // Secondary schools — stored as array for multi-tag filtering
          const rawSecondary = entry.system?.schools?.secondary ?? [];
          const secondarySchools = Array.isArray(rawSecondary)
            ? rawSecondary
            : Object.keys(rawSecondary);

          byLevel.get(level)?.push({
            id:              entry._id,
            name:            entry.name,
            img:             entry.img,
            uuid:            `Compendium.${pack.collection}.${entry._id}`,
            level,
            school,           // primary school key
            schoolLabel,      // localized primary school
            secondarySchools, // array of secondary tag keys
            castingTime: entry.system?.activation?.type ?? '',
            ritual:      entry.system?.ritual ?? false,
            concentration: entry.system?.concentration ?? false,
            description: entry.system?.description?.value ?? entry.system?.description ?? ''
          });
        }
      } catch (err) {
        AM.log(2, `Error loading spells from ${pack.collection}:`, err);
      }
    }

    // Sort each level alphabetically
    for (const [level, spells] of byLevel) {
      byLevel.set(level, spells.sort((a, b) => a.name.localeCompare(b.name)));
    }

    return byLevel;
  }

  /**
   * Add selected spells to actor.
   */
  static async applySpellsToActor(actor, spellUuids) {
    if (!spellUuids.length) return;

    // A5e requires spells to reference a spellbook on the actor.
    // The spellbook is created by class grants when the class item is added.
    const spellBookId = actor.spellBooks?.first()?._id
      ?? Object.keys(actor.system?.spellBooks ?? {})[0]
      ?? null;

    // Collect existing spell names + source UUIDs to prevent duplicates
    const existingNames = new Set(
      actor.items.filter(i => i.type === 'spell').map(i => i.name.toLowerCase())
    );
    const existingSources = new Set(
      actor.items.filter(i => i.type === 'spell')
        .map(i => i._stats?.compendiumSource ?? i.flags?.core?.sourceId ?? '')
        .filter(Boolean)
    );

    const itemDatas = [];
    for (const uuid of spellUuids) {
      if (existingSources.has(uuid)) continue; // exact UUID match
      try {
        const item = await fromUuid(uuid);
        if (!item) continue;
        if (existingNames.has(item.name.toLowerCase())) continue; // name match fallback
        const data = item.toObject();
        data._stats = data._stats || {};
        data._stats.compendiumSource = uuid;
        // Assign to the actor's spellbook
        if (spellBookId) {
          data.system = data.system || {};
          data.system.spellBook = spellBookId;
        }
        itemDatas.push(data);
        existingNames.add(item.name.toLowerCase()); // prevent within-batch dupes
      } catch (err) {
        AM.log(2, `Error fetching spell ${uuid}:`, err);
      }
    }
    if (itemDatas.length) {
      await actor.createEmbeddedDocuments('Item', itemDatas);
      AM.log(3, `Added ${itemDatas.length} spells to spellbook ${spellBookId}`);
    }
  }

  /**
   * Get spells already on the actor.
   */
  static getActorSpells(actor) {
    return actor.items
      .filter(i => i.type === 'spell')
      .map(i => ({
        id:    i.id,
        name:  i.name,
        img:   i.img,
        level: parseInt(i.system?.level ?? i.system?.spellLevel ?? 0)
      }));
  }
}
