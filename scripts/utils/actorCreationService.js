import { AM } from '../a5e-mancer.js';
import { DocumentService } from './documentService.js';
import { EquipmentService } from './equipmentService.js';
import { ManeuverService } from './maneuverService.js';
import { SpellService } from './spellService.js';
import { GrantAbsorber } from './grantAbsorber.js';
import { applyItemIcon } from '../data/a5eIcons.js';

export class ActorCreationService {

  static async createCharacter(event, formData) {
    AM.log(3, 'createCharacter called');
    const fd = formData.object;
    const targetUser = this.#resolveTargetUser(fd);

    try {
      if (!this.#validateSelections(fd)) return null;

      const abilities = this.#extractAbilities(fd);
      const actor = await this.#createActorDocument(fd, abilities, targetUser);
      if (!actor) return null;

      // Add all main items (Grants fire automatically)
      const uuids = this.#extractItemUuids(fd);
      await this.#addItemsToActor(actor, uuids, fd);

      // Apply HP choice (avg/roll) after class item sets base HP
      await this.#applyHpChoice(actor, fd);

      // Add Heritage Gift if selected
      await this.#addHeritageGift(actor, fd);

      // Apply equipment choices
      await this.#applyEquipment(actor, fd);

      // Apply starting wealth
      await this.#applyWealth(actor, fd);

      // Apply maneuvers (if class gets them at level 1)
      await this.#applyManeuvers(actor);

      // Apply spells (for caster classes)
      await this.#applySpells(actor);

      // Apply biography
      await this.#applyBiography(actor, fd);

      ui.notifications.info(
        game.i18n.format('am.app.character-created', { name: actor.name }),
        { permanent: false }
      );
      actor.sheet.render(true);
      AM.log(3, 'Character creation complete:', actor.name);
      return actor;

    } catch (err) {
      AM.log(1, 'Character creation error:', err);
      ui.notifications.error('am.errors.character-creation-failed', { localize: true });
      return null;
    }
  }

  /* ── Validation ─────────────────────────────────────── */

  static #resolveTargetUser(fd) {
    if (game.user.isGM && fd.player) return game.users.get(fd.player) ?? game.user;
    return game.user;
  }

  static #validateSelections(fd) {
    // AM.SELECTED is the authoritative store; fd[type] may be empty when the hidden
    // select loses its value after a partial re-render of the detail view template.
    if (!fd['class'] && !AM.SELECTED.class?.uuid) {
      ui.notifications.warn('am.errors.select-class', { localize: true }); return false;
    }
    if (!fd['character-name']?.trim()) {
      ui.notifications.warn('am.errors.enter-name', { localize: true }); return false;
    }
    return true;
  }

  /* ── Extract form data ──────────────────────────────── */

  static #extractItemUuids(fd) {
    const result = {};
    for (const type of ['heritage', 'culture', 'background', 'destiny', 'class']) {
      // Prefer form data value; fall back to AM.SELECTED when the hidden select
      // has lost its value after a partial re-render of the detail view template.
      const raw = fd[type] || AM.SELECTED[type]?.value || '';
      if (!raw) {
        if (AM.SELECTED[type]?.uuid) result[type] = AM.SELECTED[type].uuid;
        continue;
      }
      const m = raw.match(/\[([^\]]+)\]/);
      result[type] = m ? m[1] : (AM.SELECTED[type]?.uuid || null);
    }
    return result;
  }

  static #extractAbilities(fd) {
    const abilities = {};
    for (const key of ['str', 'dex', 'con', 'int', 'wis', 'cha']) {
      abilities[key] = { value: parseInt(fd[`abilities[${key}]`]) || AM.ABILITY_SCORES.DEFAULT };
    }
    return abilities;
  }

  /* ── Actor creation ─────────────────────────────────── */

  static async #createActorDocument(fd, abilities, targetUser) {
    const name = fd['character-name']?.trim() || targetUser.name;
    const img  = fd['character-art'] || 'icons/svg/mystery-man.svg';

    const actorData = {
      name, type: 'character', img,
      prototypeToken: {
        name,
        img: fd['token-art'] || img,
        displayName:  parseInt(fd.displayName)  || CONST.TOKEN_DISPLAY_MODES.OWNER,
        displayBars:  parseInt(fd.displayBars)  || CONST.TOKEN_DISPLAY_MODES.OWNER,
        'bar1.attribute': fd['bar1.attribute'] ?? 'attributes.hp',
        actorLink: true, vision: true
      },
      system: {
        abilities,
        // A5e's character details schema is: age, appearance, archetype,
        // background, classes, culture, destiny, eyeColor, gender, hairColor,
        // heritage, height, level, bonds, flaws, ideals, goals, notes, prestige,
        // skinColor, weight. We were writing eyes/hair/skin/alignment/pronouns,
        // none of which exist — Foundry drops unknown paths, so every one of those
        // fields silently stayed empty. Alignment and pronouns have no home in the
        // schema at all and are folded into `appearance`.
        details: {
          gender:    fd.gender  || '',
          age:       fd.age     || '',
          height:    fd.height  || '',
          weight:    fd.weight  || '',
          eyeColor:  fd.eyes    || '',
          hairColor: fd.hair    || '',
          skinColor: fd.skin    || '',
          appearance: [
            fd.pronouns  ? `Pronouns: ${fd.pronouns}`   : '',
            fd.alignment ? `Alignment: ${fd.alignment}` : ''
          ].filter(Boolean).join(' · ')
        }
      },
      ownership: { [targetUser.id]: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER }
    };

    const actor = await Actor.create(actorData);
    if (!actor) { AM.log(1, 'Actor.create returned null'); return null; }

    if (!game.user.isGM || targetUser.id === game.user.id) {
      await targetUser.update({ character: actor.id }).catch(() => {});
    }
    if (fd['player-color'])   await targetUser.update({ color: fd['player-color'] }).catch(() => {});
    if (fd['player-pronouns']) await targetUser.update({ 'flags.core.pronouns': fd['player-pronouns'] }).catch(() => {});

    AM.log(3, 'Actor created:', actor.id);
    return actor;
  }

  /* ── Add items ──────────────────────────────────────── */

  static async #addItemsToActor(actor, uuids, fd = {}) {
    const itemDatas = [];
    for (const [type, uuid] of Object.entries(uuids)) {
      if (!uuid) continue;
      try {
        const item = await DocumentService.getItemByUuid(uuid);
        if (!item) { AM.log(2, `Missing ${type} item: ${uuid}`); continue; }
        const data = item.toObject();
        data._stats = data._stats || {};
        data._stats.compendiumSource = uuid;
        this.#stripBuilderOwnedGrants(data);
        itemDatas.push(data);
        AM.log(3, `Queued ${type}: ${item.name}`);
      } catch (err) {
        AM.log(1, `Error fetching ${type} (${uuid}):`, err);
      }
    }
    // Create one-at-a-time so A5e's grant system (skills, proficiencies) fires per item
    for (const data of itemDatas) {
      applyItemIcon(data);

      // Whatever the builder already asked for gets created with noGrant, so a5e's
      // window never opens for it, and the picks are applied through a5e's own
      // writers instead. Anything we could not fully account for still goes
      // through its grant engine untouched.
      const store = AM.itemGrants?.[data.type];
      if (store?.absorb) {
        // Mixed heritage: the gift comes from another heritage, so this one's
        // gift grant is skipped and the chosen gift added on its own below.
        // Only the gift — its traits, size and speed still apply as normal.
        const mix = AM.mixedHeritage;
        const skip = (data.type === 'heritage' && mix?.enabled && mix.giftUuid)
          ? new Set(store.features.filter(f => GrantAbsorber.isGiftGrant(f)).map(f => f.id))
          : null;

        const [created] = await actor.createEmbeddedDocuments('Item', [data], { noGrant: true });
        if (created) {
          await GrantAbsorber.apply(actor, created, store.choices ?? {},
                                    { charLevel: 1, clsLevel: 1 }, 0, { skip });

          if (skip?.size) {
            await GrantAbsorber.addFeatureItem(actor, mix.giftUuid, store.choices ?? {},
                                               { charLevel: 1, clsLevel: 1 }, 'heritage gift');
          }
          // The class needs the non-grant tail a5e's routine ends with
          if (data.type === 'class') {
            await GrantAbsorber.applyClassTail(actor, created, {
              hpValue:   this.#level1Hp(fd),
              ability:   store.spellcastingAbility,
              charLevel: 1
            });
            await this.#applyArchetype(actor);
          }
        }
        continue;
      }

      await actor.createEmbeddedDocuments('Item', [data]);
    }
    if (itemDatas.length) AM.log(3, `Added ${itemDatas.length} items`);
  }

  /**
   * The archetype chosen on the class tab, for classes that pick one at 1st.
   *
   * Runs after the class exists, because a5e matches an archetype to its class
   * by slug and reads `classLevels` off it — added before the class, it would
   * attach to nothing. GrantAbsorber.applyArchetype is the same call the
   * level-up dialog makes, so the two paths produce the same result.
   */
  static async #applyArchetype(actor) {
    const arch = AM.archetypes;
    if (!arch?.uuid || arch.level !== 1) return;
    try {
      const ok = await GrantAbsorber.applyArchetype(actor, arch.uuid, { charLevel: 1, clsLevel: 1 });
      AM.log(3, ok ? `Archetype applied: ${arch.uuid}` : `Archetype not applied: ${arch.uuid}`);
    } catch (err) {
      // The character is already created at this point, so this is reported
      // rather than thrown — losing the domain is bad, losing the character
      // would be worse.
      AM.log(1, 'Could not apply the chosen archetype:', err);
      ui.notifications.warn(game.i18n.localize('am.errors.archetype-failed'));
    }
  }

  /**
   * Drop the grants the builder itself asks for, before the item data reaches
   * the actor. a5e reads grants off the item being created
   * (`t.noGrant || grants.createInitialGrants(this)`), so anything removed here
   * simply never appears in its window. Everything else still goes through a5e's
   * grant engine untouched.
   *
   *  - `item` grants  — "Starting Equipment" / "Suggested Equipment"; the
   *    Equipment tab is the single place gear is chosen.
   *  - `maneuverTraditions` trait grants — the Maneuvers tab claims a tradition
   *    as you pick maneuvers from it. Note a5e grants the *tradition* only; it has
   *    no grant type that hands out maneuver or spell items, which is why those
   *    pickers belong to the builder.
   */
  static #stripBuilderOwnedGrants(data) {
    const grants = data.system?.grants;
    if (!grants || typeof grants !== 'object') return;

    // Only from the item types whose tab really does claim them. Stripping every
    // item grant regardless of owner meant a heritage feature that grants gear
    // lost it outright: removed here and offered on no tab. Must stay in step
    // with GrantAbsorber#isOwnedElsewhere.
    const ownsEquipment = data.type === 'class' || data.type === 'background';
    const ownsTradition = data.type === 'class';

    let removed = 0;
    for (const [id, grant] of Object.entries(grants)) {
      const isEquipment = grant?.grantType === 'item' && ownsEquipment;
      const isTradition = grant?.grantType === 'trait'
                          && grant.traits?.traitType === 'maneuverTraditions'
                          && ownsTradition;
      if (isEquipment || isTradition) { delete grants[id]; removed++; }
    }
    if (removed) AM.log(3, `Removed ${removed} builder-owned grant(s) from ${data.name}`);
  }

  /* ── Heritage Gift ──────────────────────────────────── */

  static async #addHeritageGift(actor, fd) {
    // Absorbed heritages grant the gift through their feature grant already;
    // a stale hidden field from before the switch must not add it a second time.
    if (AM.itemGrants?.heritage?.absorb) return;
    const uuid = fd['heritageGiftUuid'];
    if (!uuid) return;
    try {
      const item = await DocumentService.getItemByUuid(uuid);
      if (!item) return;
      const data = item.toObject();
      data._stats = data._stats || {};
      data._stats.compendiumSource = uuid;
      applyItemIcon(data);
      await actor.createEmbeddedDocuments('Item', [data]);
      AM.log(3, `Added heritage gift: ${item.name}`);
    } catch (err) {
      AM.log(2, 'Error adding heritage gift:', err);
    }
  }

  /* ── Equipment ──────────────────────────────────────── */

  static async #applyEquipment(actor, fd) {
    const eqData = AM.equipmentData;
    if (!eqData) return;

    const itemsToCreate = [];

    // Helper: resolve chosen option and add its item.
    //
    // The quantity has to be carried across the same way the fixed lists below
    // do it. EquipmentService reads `quantityOverride` off the grant and the
    // tab renders it — "20× Arrow" — but this only ever created the compendium
    // item, whose own quantity is 1. The player was shown twenty and given one,
    // with nothing to suggest the other nineteen had gone missing.
    const addChoice = async (choices, choiceIndex, key) => {
      const idx = parseInt(fd[key] ?? '0') || 0;
      const choice = choices?.[choiceIndex];
      if (!choice) return;
      const opt = choice.options[idx];
      if (!opt) return;
      if (opt.uuid) {
        try {
          const item = await fromUuid(opt.uuid);
          if (!item) return;
          const data = item.toObject();
          if (opt.qty > 1) {
            data.system = data.system || {};
            data.system.quantity = opt.qty;
          }
          itemsToCreate.push(data);
        } catch (err) {
          AM.log(2, `Equipment choice ${opt.uuid} could not be read:`, err);
        }
      }
    };

    // Class fixed equipment
    for (const fixed of eqData.class?.fixed ?? []) {
      if (fixed.uuid) {
        try {
          const item = await fromUuid(fixed.uuid);
          if (item) {
            const data = item.toObject();
            data.system = data.system || {};
            data.system.quantity = fixed.qty ?? 1;
            itemsToCreate.push(data);
          }
        } catch {}
      }
    }

    // Class choices
    const classChoices = eqData.class?.choices ?? [];
    for (let i = 0; i < classChoices.length; i++) {
      await addChoice(classChoices, i, `classEquipmentChoice[${i}]`);
    }

    // Background fixed equipment
    for (const fixed of eqData.background?.fixed ?? []) {
      if (fixed.uuid) {
        try {
          const item = await fromUuid(fixed.uuid);
          if (item) {
            const data = item.toObject();
            data.system = data.system || {};
            data.system.quantity = fixed.qty ?? 1;
            itemsToCreate.push(data);
          }
        } catch {}
      }
    }

    // Background choices
    const bgChoices = eqData.background?.choices ?? [];
    for (let i = 0; i < bgChoices.length; i++) {
      await addChoice(bgChoices, i, `bgEquipmentChoice[${i}]`);
    }

    // a5e's class and background carry optional "Starting/Suggested Equipment"
    // item grants. They default to unticked, but a player who accepts them would
    // otherwise get a second copy of everything we just added, so merge by name:
    // bump the quantity instead of creating a duplicate row.
    const qtyOf = (o) => Number(o?.system?.quantity ?? 1) || 1;

    const onActor = new Map();            // name → existing embedded item
    for (const item of actor.items) {
      if (item.type !== 'object') continue;
      onActor.set(item.name.toLowerCase(), item);
    }

    const bumps = new Map();              // existing item id → new quantity
    const fresh = new Map();              // name → item data queued for creation

    for (const data of itemsToCreate) {
      const key = (data.name ?? '').toLowerCase();

      const queued = fresh.get(key);      // same item twice in our own picks
      if (queued) {
        queued.system.quantity = qtyOf(queued) + qtyOf(data);
        continue;
      }

      const have = onActor.get(key);      // already on the actor
      if (have) {
        bumps.set(have.id, (bumps.get(have.id) ?? qtyOf(have)) + qtyOf(data));
        continue;
      }

      data.system = data.system || {};
      data.system.quantity = qtyOf(data);
      fresh.set(key, data);
    }

    if (bumps.size) {
      await actor.updateEmbeddedDocuments('Item',
        [...bumps].map(([_id, quantity]) => ({ _id, 'system.quantity': quantity })));
    }
    if (fresh.size) {
      const list = [...fresh.values()];
      list.forEach(applyItemIcon);
      await actor.createEmbeddedDocuments('Item', list);
      AM.log(3, `Added ${list.length} equipment items (${bumps.size} merged into existing)`);
    }
  }

  /* ── Wealth ─────────────────────────────────────────── */

  static async #applyWealth(actor, fd) {
    const gold = parseInt(fd['startingWealth']);
    if (!gold || gold <= 0) return;
    await EquipmentService.applyWealthToActor(actor, gold);
    AM.log(3, `Applied ${gold} gp starting wealth`);
  }

  /* ── HP choice ──────────────────────────────────────── */

  /**
   * Level-1 hit points from the Class tab's choice, before CON.
   * This is the per-level value a5e stores on the class item, not a total.
   */
  static #level1Hp(fd) {
    const hitDie = AM.SELECTED.class?.hitDie ?? '';
    const hitNum = parseInt(String(hitDie).replace('d', '')) || 0;
    if (!hitNum) return 0;

    switch (fd.hpMethod || 'max') {
      case 'roll': return parseInt(fd.hpRollResult) || Math.floor(hitNum / 2) + 1;
      case 'avg':  return Math.floor(hitNum / 2) + 1;
      case 'max':
      default:     return hitNum;   // A5e grants a full hit die at 1st level
    }
  }

  static async #applyHpChoice(actor, fd) {
    // The class tail already wrote system.hp.levels.1 when we absorbed the class
    if (AM.itemGrants?.class?.absorb) return;
    // Otherwise a5e's grant dialog asks for level-1 HP as part of applying the class.
    if (AM.deferToSystemGrants) return;

    const method = fd.hpMethod || 'max';
    if (method === 'max') return; // A5e grants full hit die at level 1 by default

    const hitDie = AM.SELECTED.class?.hitDie ?? '';
    const hitNum = parseInt(hitDie.replace('d', '')) || 0;
    if (!hitNum) return;

    const baseHp = method === 'roll'
      ? (parseInt(fd.hpRollResult) || Math.floor(hitNum / 2) + 1)
      : Math.floor(hitNum / 2) + 1; // avg

    const conScore = actor.system?.abilities?.con?.value ?? 10;
    const conMod   = Math.floor((conScore - 10) / 2);
    const totalHp  = Math.max(1, baseHp + conMod);

    try {
      const hp = actor.system?.attributes?.hp;
      const classItem = actor.items.find(i => i.type === 'class');
      // With class HP automation on — the default as soon as a class item exists —
      // Actor#prepareHitPoints derives hp.max from each class item's hp.levels plus
      // CON x level. baseMax is only consulted in the non-automated branch, so the
      // per-level value on the class item is the only thing that sticks.
      const automated = actor.classAutomationFlags?.hitPoints ?? !!classItem;

      if (automated && classItem) {
        await classItem.update({ 'system.hp.levels.1': baseHp });
        await actor.update({ 'system.attributes.hp.value': totalHp });
      } else {
        const update = { 'system.attributes.hp.value': totalHp };
        if (hp?.baseMax !== undefined) {
          const bonus = (Number(hp.max) || 0) - (Number(hp.baseMax) || 0);
          update['system.attributes.hp.baseMax'] = Math.max(1, totalHp - bonus);
        } else {
          update['system.attributes.hp.max'] = totalHp;
        }
        await actor.update(update);
      }
      AM.log(3, `HP choice (${method}): ${baseHp} + ${conMod} CON = ${totalHp}`);
    } catch (err) {
      AM.log(2, 'HP choice update failed:', err);
    }
  }

  /* ── Biography ──────────────────────────────────────── */

  static async #applyManeuvers(actor) {
    const data = AM.creationManeuvers;
    if (!data?.uuids?.length && !data?.traditions?.length) return;
    await ManeuverService.applyManeuversToActor(
      actor, data.uuids ?? [], data.traditions ?? []
    );
    AM.creationManeuvers = null;
  }

  static async #applySpells(actor) {
    const data = AM.creationSpells;
    if (!data) return;
    const all = [...(data.cantrips ?? []), ...(data.spells ?? [])];
    if (all.length) await SpellService.applySpellsToActor(actor, all);
    AM.creationSpells = null;
  }

  /**
   * Everything the Biography and Destiny tabs collected.
   *
   * A5e's details schema only has bonds, flaws, ideals, goals and notes for prose,
   * so backstory, connections, mementos and the destiny table results have no
   * native home and used to be concatenated into one `notes` blob — which is why
   * they read as "not carried over" on the sheet.
   *
   * Each piece is now ALSO stored verbatim under our own flag, so the sheet can
   * show it as its own field, while the native a5e fields still get a readable
   * composed version for the system's own sheet and for anything else that reads
   * them.
   */
  static async #applyBiography(actor, fd) {
    const clean = (v) => (typeof v === 'string' ? v.trim() : '');

    // Every lore table the destiny/background offered, with its own heading —
    // there are several per destiny and previously only two ever reached here.
    const lore = [];
    for (const [source, tables] of Object.entries(AM.loreTables ?? {})) {
      for (const table of (tables ?? [])) {
        const text = clean(fd[`lore[${table.key}]`] ?? AM.loreRolls?.[table.key]);
        if (text) lore.push({ source, heading: table.heading, text });
      }
    }

    const bio = {
      lore,
      traits:      clean(fd.traits),
      ideals:      clean(fd.ideals),
      bonds:       clean(fd.bonds),
      flaws:       clean(fd.flaws),
      connections: clean(fd.connections),
      backstory:   clean(fd.backstory),
      mementos:    clean(fd.mementos),
      destiny: {
        motivation:  clean(fd.destinyMotivation),
        goals:       clean(fd.destinyGoals),
        connection:  clean(fd.destinyConnection),
        fulfillment: clean(fd.destinyFulfillment),
        inspiration: clean(fd.destinyInspiration)
      }
    };

    const para    = (t) => `<p>${t.replace(/\n{2,}/g, '</p><p>').replace(/\n/g, '<br>')}</p>`;
    const section = (heading, body) => (body ? `<h4>${heading}</h4>${para(body)}` : '');

    const bondsHtml = [
      bio.bonds       ? para(bio.bonds) : '',
      section('Connections', bio.connections),
      section('Destiny Connection', bio.destiny.connection)
    ].filter(Boolean).join('\n');

    const goalsHtml = [
      bio.destiny.goals ? para(bio.destiny.goals) : '',
      section('Fulfillment', bio.destiny.fulfillment)
    ].filter(Boolean).join('\n');

    const notesHtml = [
      section('Backstory',            bio.backstory),
      section('Personality Traits',   bio.traits),
      section('Mementos',             bio.mementos),
      section('Destiny Motivation',   bio.destiny.motivation),
      section('Inspiration Feature',  bio.destiny.inspiration),
      ...lore.map(l => section(l.heading, l.text))
    ].filter(Boolean).join('\n');

    const updates = {
      'system.details.ideals': bio.ideals ? para(bio.ideals) : '',
      'system.details.bonds':  bondsHtml,
      'system.details.flaws':  bio.flaws ? para(bio.flaws) : '',
      'system.details.goals':  goalsHtml,
      'system.details.notes':  notesHtml,
      [`flags.${AM.ID}.biography`]: bio
    };

    try {
      await actor.update(updates);
      AM.log(3, 'Biography applied:', Object.keys(bio).filter(k => bio[k]).join(', '));
    } catch (err) {
      // Loud: a silent failure here is exactly how these fields went missing before
      AM.log(1, 'Biography update failed:', err);
      ui.notifications.warn(`${AM.NAME}: could not save the biography fields — see the console.`);
    }
  }
}
