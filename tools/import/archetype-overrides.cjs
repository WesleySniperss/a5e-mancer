// Per-archetype corrections the page structure cannot tell the converter.
// choice: { featureName: true | count | false } - force a feature's subsections to be (or not be) a choice
// pre(seg, notes): adjust the segmented page before documents are made
// post(features, ctx): adjust the documents after
module.exports = {
  Executore: {
    // "Archetype Schools" opens the page with no level image; it is the 3rd-level feature every herald archetype has
    pre(seg, notes) {
      const i = seg.intro.findIndex((u) => /^Archetype Schools?$/i.test(u.text));
      if (i < 0) return;
      const rest = seg.intro.splice(i);
      seg.features.unshift({ name: rest[0].text, lvl: 3, units: rest.slice(1), subs: [] });
      notes.push('Archetype Schools: a 3rd-level feature');
    }
  },
  Blinkwitch: {
    // 10th: another knack from the knight's list; 14th: a noble knack, and one more knack of either earlier list
    choice: { 'Faerie Knight Knacks': 1 },
    post(features, { rid, PACK, notes }) {
      const get = (n) => features.find((x) => x.doc.name === n);
      const knacks = get('Faerie Knacks'), knight = get('Faerie Knight Knacks'), noble = get('Faerie Noble Knacks');
      if (!knacks || !knight || !noble) return;
      const gid = rid(`${noble.doc._id}|additional`, 'g');
      noble.doc.system.grants[gid] = {
        _id: gid, grantType: 'feature', level: noble.f.lvl, levelType: 'class', optional: false, label: 'Additional Faerie Knack', img: '',
        features: { base: [], options: [...knacks.options, ...knight.options].map((o) => ({ uuid: PACK + o._id, name: o.name, img: o.img, limitedReselection: true, selectionLimit: 1 })), total: 1 }
      };
      notes.push('Faerie Noble Knacks: plus one more Faerie or Faerie Knight Knack');
    }
  },
  Naturalist: {
    // 14th: the Hazardous Study option not taken at 6th, or one of the two new ones
    post(features, { PACK, notes }) {
      const hs = features.find((x) => x.doc.name === 'Hazardous Study');
      const as = features.find((x) => x.doc.name === 'Adaptive Survival');
      if (!hs || !as) return;
      const g = Object.values(as.doc.system.grants).find((x) => x.grantType === 'feature');
      if (!g) return;
      g.features.options.push(...hs.options.map((o) => ({ uuid: PACK + o._id, name: o.name, img: o.img, limitedReselection: true, selectionLimit: 1 })));
      notes.push('Adaptive Survival: also offers the Hazardous Study options');
    }
  }
};
