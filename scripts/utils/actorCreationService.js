import { AM } from '../a5e-mancer.js';
import { DocumentService } from './documentService.js';
import { EquipmentService } from './equipmentService.js';
import { ManeuverService } from './maneuverService.js';
import { SpellService } from './spellService.js';

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
      await this.#addItemsToActor(actor, uuids);

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
    if (!fd['class']) {
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
      const raw = fd[type];
      if (!raw) continue;
      const m = raw.match(/\[([^\]]+)\]/);
      result[type] = m ? m[1] : null;
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
        details: {
          gender: fd.gender || '', age: fd.age || '',
          height: fd.height || '', weight: fd.weight || '',
          eyes:   fd.eyes   || '', hair:   fd.hair   || '',
          skin:   fd.skin   || '', alignment: fd.alignment || '',
          pronouns: fd.pronouns || ''
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

  static async #addItemsToActor(actor, uuids) {
    const itemDatas = [];
    for (const [type, uuid] of Object.entries(uuids)) {
      if (!uuid) continue;
      try {
        const item = await DocumentService.getItemByUuid(uuid);
        if (!item) { AM.log(2, `Missing ${type} item: ${uuid}`); continue; }
        const data = item.toObject();
        data._stats = data._stats || {};
        data._stats.compendiumSource = uuid;
        itemDatas.push(data);
        AM.log(3, `Queued ${type}: ${item.name}`);
      } catch (err) {
        AM.log(1, `Error fetching ${type} (${uuid}):`, err);
      }
    }
    if (itemDatas.length) {
      await actor.createEmbeddedDocuments('Item', itemDatas);
      AM.log(3, `Added ${itemDatas.length} items`);
    }
  }

  /* ── Heritage Gift ──────────────────────────────────── */

  static async #addHeritageGift(actor, fd) {
    const uuid = fd['heritageGiftUuid'];
    if (!uuid) return;
    try {
      const item = await DocumentService.getItemByUuid(uuid);
      if (!item) return;
      const data = item.toObject();
      data._stats = data._stats || {};
      data._stats.compendiumSource = uuid;
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

    // Helper: resolve chosen option and add its item
    const addChoice = async (choices, choiceIndex, key) => {
      const idx = parseInt(fd[key] ?? '0') || 0;
      const choice = choices?.[choiceIndex];
      if (!choice) return;
      const opt = choice.options[idx];
      if (!opt) return;
      if (opt.uuid) {
        try {
          const item = await fromUuid(opt.uuid);
          if (item) itemsToCreate.push(item.toObject());
        } catch {}
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

    if (itemsToCreate.length) {
      await actor.createEmbeddedDocuments('Item', itemsToCreate);
      AM.log(3, `Added ${itemsToCreate.length} equipment items`);
    }
  }

  /* ── Wealth ─────────────────────────────────────────── */

  static async #applyWealth(actor, fd) {
    const gold = parseInt(fd['startingWealth']);
    if (!gold || gold <= 0) return;
    await EquipmentService.applyWealthToActor(actor, gold);
    AM.log(3, `Applied ${gold} gp starting wealth`);
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

  static async #applyBiography(actor, fd) {
    const updates = {};
    const bioFields = {
      'system.details.biography.value':   fd.backstory   || '',
      'system.details.personality.value': fd.traits      || '',
      'system.details.ideals.value':      fd.ideals      || '',
      'system.details.bonds.value':       fd.bonds       || '',
      'system.details.flaws.value':       fd.flaws       || '',
      'system.details.connections.value': fd.connections || '',
      'system.details.mementos.value':    fd.mementos    || '',
      // Destiny-specific narrative fields
      'system.details.notes.value':       fd.destinyMotivation
        ? `<p>${fd.destinyMotivation}</p>`
        : '',
      'system.details.goals.value':       fd.destinyGoals
        ? `<p>${fd.destinyGoals}</p>`
        : ''
    };
    Object.assign(updates, bioFields);
    await actor.update(updates).catch(() => {});
  }
}
