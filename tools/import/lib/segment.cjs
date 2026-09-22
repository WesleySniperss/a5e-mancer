// Units -> { intro, extras, features: [{ name, lvl, markerLvl, textLvl, units, subs }] }
const { text, titleLike } = require('./normalize.cjs');

const isHead = (u) => /^h\d$/.test(u.tag);
const hdepth = (u) => Number(u.tag[1]);
const EXTRA = /^(tenets\b|multiclassing\b|variant\b|table:|designer|optional rule|sidebar)/i;
const boldOnly = (u) => u.tag === 'p' && /^<p>\s*<strong>[^<]*<\/strong>\s*<\/p>$/.test(u.html);

function textLevel(t) {
  const s = String(t || '').slice(0, 260);
  let m = /\b(?:at|starting at|beginning at|also at|by|upon reaching|when you reach|once you reach|from|until) (\d+)(?:st|nd|rd|th)[ ,]*level\b/i.exec(s)
       || /\bwhen you (?:choose|select|join|take|adopt|enter|swear)[^.]{0,60}? at (\d+)(?:st|nd|rd|th) level/i.exec(s)
       || /^(?:starting|beginning) (?:at|when you reach) (\d+)(?:st|nd|rd|th)/i.exec(s);
  return m ? Number(m[1]) : null;
}

function leadLevel(t) {
  const s = String(t || '').trim();
  const m = /^(?:also,? |additionally,? )?(?:starting |beginning )?(?:at|by|from|upon reaching|once you reach|when you reach) (\d+)(?:st|nd|rd|th)[ ,]*level/i.exec(s)
         || /^(?:starting |beginning )?(?:at \d+\w* level )?when you (?:choose|select|join|take|adopt|enter|swear)[^.]{0,80}? at (\d+)(?:st|nd|rd|th) level/i.exec(s)
         || /^(?:starting|beginning) (?:at|when you reach) (\d+)(?:st|nd|rd|th)/i.exec(s);
  return m ? Number(m[1]) : null;
}

function segment(us, { startLevel = 3 } = {}) {
  const sections = [[]];
  for (const u of us) { if (u.tag === 'hr') sections.push([]); else sections[sections.length - 1].push(u); }
  const marked = us.filter((u) => u.lvl != null && isHead(u));
  const tagCount = {};
  for (const u of marked) tagCount[u.tag] = (tagCount[u.tag] || 0) + 1;
  const featTag = Object.entries(tagCount).sort((a, b) => b[1] - a[1])[0]?.[0]
    ?? Object.entries(us.filter(isHead).reduce((o, u) => ((o[u.tag] = (o[u.tag] || 0) + 1), o), {})).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'h2';
  const featDepth = Number(featTag[1]);

  const res = { intro: [], extras: [], features: [], warnings: [] };
  let cur = null, extra = null;
  const start = (name, markerLvl, headUnit) => {
    cur = { name: name.replace(/[:.]\s*$/, '').trim(), markerLvl, units: [], subs: [], head: headUnit };
    res.features.push(cur);
    extra = null;
  };
  for (const sec of sections) {
    let first = true;
    for (let i = 0; i < sec.length; i++) {
      const u = sec[i];
      const atStart = first; first = false;
      // a level marker starts a feature
      if (u.lvl != null) {
        if (u.text && titleLike(u.text) && (isHead(u) || u.split || boldOnly(u) || u.text.length < 50)) { start(u.text, u.lvl, u); continue; }
        if (!u.text) {
          const nx = sec[i + 1];
          if (nx && titleLike(nx.text) && (isHead(nx) || nx.tag === 'p')) { start(nx.text, u.lvl, nx); i++; continue; }
          if (!nx) { res.warnings.push(`lone marker L${u.lvl}`); continue; }
          res.warnings.push(`marker L${u.lvl} before non-title: ${nx.text.slice(0, 40)}`); continue;
        }
        res.warnings.push(`marker L${u.lvl} inside text: ${u.text.slice(0, 50)}`);
      }
      // an unmarked heading opening a section: a feature, or text that is not one
      if (isHead(u) && atStart && hdepth(u) <= featDepth + 1) {
        const introish = !res.features.length && !/expanded spell list/i.test(u.text) && textLevel(sec[i + 1]?.text) == null;
        if (EXTRA.test(u.text) || introish) {
          cur = null;
          if (!res.features.length) { res.intro.push(u); extra = null; }
          else { extra = { name: u.text, units: [], head: u }; res.extras.push(extra); }
          continue;
        }
        start(u.text, null, u); continue;
      }
      if (!cur) {
        if (extra) extra.units.push(u); else res.intro.push(u);
        continue;
      }
      // inside a feature: headings and bold titles open a subsection
      const subTitle = (isHead(u) && u.text) || ((u.split || boldOnly(u)) && titleLike(u.text) && !/^table\b/i.test(u.text) ? u.text : null);
      if (subTitle && !(isHead(u) && hdepth(u) < featDepth)) {
        cur.subs.push({ name: subTitle.replace(/[:.]\s*$/, '').trim(), head: u, units: [], fromHeading: isHead(u) });
        continue;
      }
      if (cur.subs.length) cur.subs[cur.subs.length - 1].units.push(u); else cur.units.push(u);
    }
  }
  // levels
  let prev = null;
  for (const f of res.features) {
    f.textLvl = textLevel(f.units[0]?.text) ?? textLevel(f.subs[0]?.units[0]?.text);
    // the text's own "At 7th level, ..." beats a mislabelled image; a level
    // mentioned later in the sentence ("if you choose Pact of the Blade at
    // 3rd level") does not
    const lead = leadLevel(f.units[0]?.text);
    f.lvl = lead ?? f.markerLvl ?? f.textLvl ?? prev ?? startLevel;
    if (lead == null && f.markerLvl != null) f.textLvl = f.markerLvl;
    if (f.textLvl != null && f.markerLvl != null && f.textLvl !== f.markerLvl) res.warnings.push(`${f.name}: image L${f.markerLvl}, text L${f.textLvl}`);
    if (f.textLvl == null && f.markerLvl == null) res.warnings.push(`${f.name}: no level, took L${f.lvl}`);
    prev = f.lvl;
  }
  return res;
}

module.exports = { segment, textLevel };
