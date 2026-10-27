/**
 * Documents found by their name: the packs' loaded indexes, then the world.
 *
 * For a link that names a document without leading to it - a link into a
 * pack that is not installed, or 5etools markup such as @creature[lemure] -
 * this is the document to link instead. A name can be in several packs:
 * a5e's own packs win, then the rest of the system (its packs of 5e
 * content), then the world's packs, then the modules', then the world's own
 * documents. Packs the user cannot see are left out, as a link into one
 * would not open for them.
 *
 * A link that came from a pack of one kind ("classfeatures") looks in packs
 * of that kind first, and there a name may also stand after a prefix: a5e's
 * 5e class features are "Invocation: Agonizing Blast", "Metamagic: Careful
 * Spell", while the texts link "Agonizing Blast". Without that, an
 * invocation's link went to the a5e maneuver or monster feature of its name.
 */
export class NamedDocs {

  /** documentName -> { sig, map: key -> [{ uuid, type, rank, kind, alias }] }, best first */
  static #maps = new Map();

  /** A name as it is compared: case, curly quotes, spacing and a closing full stop do not count. */
  static key(name) {
    return String(name ?? '').normalize('NFKC').toLowerCase()
      .replace(/[‘’`]/g, "'").replace(/\s+/g, ' ').replace(/[\s.]+$/, '').trim();
  }

  /** A pack's kind, as compared: "dnd5e-class-features" -> "dndeclassfeatures". */
  static kindOf(packName) {
    return String(packName ?? '').toLowerCase().replace(/[^a-z]/g, '');
  }

  /** "lemures" -> lemure, "harpies" -> harpy, "wolves" -> wolf: a plural's possible singulars. */
  static singulars(key) {
    const out = [];
    if (key.endsWith('ies')) out.push(`${key.slice(0, -3)}y`);
    if (key.endsWith('ves')) out.push(`${key.slice(0, -3)}f`, `${key.slice(0, -3)}fe`);
    if (key.endsWith('es')) out.push(key.slice(0, -2));
    if (key.endsWith('s') && !key.endsWith('ss')) out.push(key.slice(0, -1));
    if (key.endsWith('men')) out.push(`${key.slice(0, -3)}man`);
    return out;
  }

  static #rank(pack) {
    const meta = pack.metadata ?? {};
    if (meta.packageType === 'system') return (meta.packageName === game.system?.id && !/^dnd5e-/.test(meta.name ?? '')) ? 0 : 1;
    return meta.packageType === 'world' ? 2 : 3;
  }

  static #mapOf(documentName) {
    const packs = [...(game.packs ?? [])].filter(p => p.documentName === documentName && p.visible !== false);
    const collection = game.collections?.get?.(documentName);
    // Rebuilt when an index grows or a pack comes: before ready the indexes are still empty
    const sig = packs.reduce((n, p) => n + (p.index?.size ?? 0), 0) * 7 + packs.length * 3 + (collection?.size ?? 0);
    const held = this.#maps.get(documentName);
    if (held?.sig === sig) return held.map;
    const map = new Map();
    const put = (k, entry) => {
      if (!k) return;
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(entry);
    };
    const add = (name, entry) => {
      put(this.key(name), entry);
      // "Invocation: Agonizing Blast" also answers to "agonizing blast", in its own kind of pack
      const after = /^[^:]{2,40}:\s*(.+)$/.exec(name)?.[1];
      if (after && entry.kind) put(this.key(after), { ...entry, alias: true });
    };
    for (const pack of packs) {
      const rank = this.#rank(pack);
      const kind = this.kindOf(pack.metadata?.name);
      for (const e of pack.index ?? []) {
        if (e?.name) add(e.name, { uuid: `Compendium.${pack.collection}.${documentName}.${e._id}`, type: e.type, rank, kind });
      }
    }
    for (const doc of collection ?? []) {
      if (doc?.name && doc.visible !== false) add(doc.name, { uuid: doc.uuid, type: doc.type, rank: 4 });
    }
    for (const list of map.values()) list.sort((a, b) => (a.alias === b.alias ? 0 : a.alias ? 1 : -1) || a.rank - b.rank);
    this.#maps.set(documentName, { sig, map });
    return map;
  }

  /**
   * The uuid of the document of this kind with this name, or null.
   * @param {string} documentName  'Actor', 'Item', 'RollTable', ...
   * @param {string} name
   * @param {object} [opts]
   * @param {string} [opts.type]     only documents of this type ('spell', 'object', ...)
   * @param {boolean} [opts.plural]  a plural name may stand for a singular one ("pup clones")
   * @param {string} [opts.kind]     packs of this kind first (kindOf of the pack a link came from)
   */
  static uuidOf(documentName, name, { type = null, plural = false, kind = null } = {}) {
    const k = this.key(name);
    if (!k || !documentName) return null;
    let map;
    try { map = this.#mapOf(documentName); } catch { return null; }
    const fits = (e, alias, own) => (!type || e.type === type) && !!e.alias === alias
      && (!own || e.kind?.includes(kind));
    for (const key of [k, ...(plural ? this.singulars(k) : [])]) {
      const list = map.get(key) ?? [];
      const hit = (kind && (list.find(e => fits(e, false, true)) ?? list.find(e => fits(e, true, true))))
        || list.find(e => fits(e, false, false));
      if (hit) return hit.uuid;
    }
    return null;
  }
}
