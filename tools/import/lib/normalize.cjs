// a5e.tools page body -> clean units: { tag, html, text, lvl }
// Keeps p, h2-h4, ul/ol/li, table rows, strong, em, br; links become @UUID
// (spells, maneuvers) or plain text; level images become unit.lvl.
const fs = require('fs');
const path = require('path');
const { PACKS: PK } = require('./paths.cjs');

const norm = (s) => String(s ?? '').toLowerCase().replace(/[’‘`]/g, "'").replace(/&#039;|&rsquo;/g, "'")
  .replace(/[^a-z0-9' ]/g, ' ').replace(/\s+/g, ' ').trim();

function lookups() {
  const spells = JSON.parse(fs.readFileSync(path.join(PK, 'spells.json'), 'utf8'));
  const maneuvers = JSON.parse(fs.readFileSync(path.join(PK, 'maneuvers.json'), 'utf8'));
  const spellByName = new Map(), spellBySlug = new Map(), manByName = new Map();
  for (const s of spells) {
    const k = norm(s.name);
    if (!spellByName.has(k)) spellByName.set(k, s);
    const slug = k.replace(/'/g, '').replace(/\b(of|the|a|an)\b/g, ' ').replace(/\s+/g, '-').replace(/^-|-$/g, '');
    if (!spellBySlug.has(slug)) spellBySlug.set(slug, s);
  }
  for (const m of maneuvers) { const k = norm(m.name); if (!manByName.has(k)) manByName.set(k, m); }
  return { spellByName, spellBySlug, manByName };
}

const ENT = { '&nbsp;': ' ', '&amp;': '&', '&quot;': '"', '&#039;': '’', '&rsquo;': '’', '&lsquo;': '‘', '&ldquo;': '“', '&rdquo;': '”', '&mdash;': '—', '&ndash;': '–', '&hellip;': '…', '&times;': '×' };
const decode = (s) => s.replace(/&[a-z#0-9]+;/gi, (e) => ENT[e] ?? e);
const text = (html) => decode(String(html).replace(/@UUID\[[^\]]*\]\{([^}]*)\}/g, '$1').replace(/⟦L\d+⟧/g, '').replace(/<[^>]+>/g, ' ')).replace(/[​‌‍﻿]/g, '').replace(/\s+/g, ' ').trim();

function levelOf(alt) {
  const m = /(\d+)\s*(?:st|nd|rd|th)?\s*level|level\s*(\d+)/i.exec(alt || '');
  return m ? Number(m[1] || m[2]) : null;
}

function bodyOf(html) {
  const start = html.indexOf('<div class="field field--name-body');
  if (start < 0) return '';
  const open = html.indexOf('>', start) + 1;
  let depth = 1, end = html.length;
  const re = /<\/?div\b[^>]*>/g; re.lastIndex = open;
  let m;
  while ((m = re.exec(html))) { depth += m[0][1] === '/' ? -1 : 1; if (depth === 0) { end = m.index; break; } }
  return html.slice(open, end);
}

/** Clean the body to a restricted tag set. Records traditions and spells seen. */
function clean(body, lk, seen) {
  let s = body.replace(/<!--[\s\S]*?-->/g, '').replace(/\r/g, '');
  // the sibling-archetype navigation box
  s = s.replace(/^\s*<div style="float:\s*right[\s\S]*?<\/div>/, '');
  s = s.replace(/<span id="cke_bm_[^"]*"[^>]*>[\s\S]*?<\/span>/g, '');
  // level images
  s = s.replace(/<img\b[^>]*>/gi, (tag) => {
    const alt = (tag.match(/alt="([^"]*)"/) || [])[1];
    const n = levelOf(alt);
    return n ? ` ⟦L${n}⟧ ` : '';
  });
  // links
  s = s.replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi, (_all, attrs, inner) => {
    const href = (attrs.match(/href="([^"]*)"/) || [])[1] || '';
    const label = text(inner);
    if (!label) return '';
    const key = norm(label);
    const trad = /field_cm_tradition_target_id/.test(href);
    if (trad) { seen.traditions.add(label); return label; }
    const slug = (href.match(/\/spells?\/([a-z0-9-]+)/) || [])[1];
    const spell = lk.spellByName.get(key) ?? (slug ? lk.spellBySlug.get(slug) : null);
    if (spell && (slug || /\/node\//.test(href) || !href.includes('/rules/'))) {
      seen.spells.add(spell.name);
      return `@UUID[Compendium.a5e.a5e-spells.Item.${spell._id}]{${label}}`;
    }
    if (slug) { seen.unmatchedSpells.add(label); return `<em>${label}</em>`; }
    const man = lk.manByName.get(key);
    if (man && !/\/rules\//.test(href)) { seen.maneuvers.add(man.name); return `@UUID[Compendium.a5e.a5e-maneuvers.Item.${man._id}]{${label}}`; }
    return label;
  });
  // tag set
  s = s.replace(/<(\/?)b\b[^>]*>/gi, '<$1strong>').replace(/<(\/?)i\b[^>]*>/gi, '<$1em>');
  // a spell named in italics, as a5e's books set them - but not a trait's own
  // lead-in, which the books set in bold italics and end with a stop
  // ("<strong><em>Darkvision.</em></strong> You have superior vision ...")
  s = s.replace(/(<strong>\s*)?<em>(\s*)([^<@]{2,40}?)(\s*)<\/em>/g, (all, bold, a, name, b) => {
    if (bold || /[.:]\s*$/.test(name)) return all;
    const spell = lk.spellByName.get(norm(decode(name)));
    if (!spell) return all;
    seen.spells.add(spell.name);
    return '<em>' + a + '@UUID[Compendium.a5e.a5e-spells.Item.' + spell._id + ']{' + name + '}' + b + '</em>';
  });
  s = s.replace(/<(\/?)(span|font|u|sup|sub|div|colgroup|col|caption|section|article|small|big|mark|code|s|strike|del|ins|abbr)\b[^>]*>/gi, ' ');
  s = s.replace(/<blockquote\b[^>]*>/gi, '').replace(/<\/blockquote>/gi, '');
  s = s.replace(/<(p|h[1-6]|ul|ol|li|table|thead|tbody|tfoot|tr|td|th|strong|em|br|hr)\b[^>]*?(\/?)>/gi, (_m, t, sc) => `<${t.toLowerCase()}${sc ? ' /' : ''}>`);
  s = s.replace(/<(?!\/?(p|h[1-6]|ul|ol|li|table|thead|tbody|tfoot|tr|td|th|strong|em|br|hr)\b)[^>]+>/gi, ' ');
  s = decode(s).replace(/[​‌‍﻿]/g, '').replace(/[ \t\n]+/g, ' ');
  // tidy empty inline tags and spaces inside them
  for (let i = 0; i < 3; i++) s = s.replace(/<(strong|em)>\s*<\/\1>/g, ' ').replace(/<\/(strong|em)>\s*<\1>/g, ' ');
  s = s.replace(/<(strong|em)> +/g, ' <$1>').replace(/ +<\/(strong|em)>/g, '</$1> ');
  s = s.replace(/ +([,.;:!?)])/g, '$1').replace(/\( +/g, '(');
  return linkPlainSpells(s, lk, seen);
}

/**
 * Spell names in plain text where the sentence says they are spells: "the fire
 * bolt and produce flame cantrips", "the blink spell", "the spell sanctuary".
 * Only outside tags and links, and only names a5e has.
 */
function linkPlainSpells(html, lk, seen) {
  const link = (raw) => {
    const pre = (/^(?:(?:both|the|a|an) )+/i.exec(raw) || [''])[0];
    const name = raw.slice(pre.length);
    const spell = lk.spellByName.get(norm(name));
    if (!spell) return null;
    seen.spells.add(spell.name);
    return pre + '@UUID[Compendium.a5e.a5e-spells.Item.' + spell._id + ']{' + name + '}';
  };
  return html.split(/(<[^>]+>|@UUID\[[^\]]*\]\{[^}]*\})/).map((part) => {
    if (!part || part.startsWith('<') || part.startsWith('@UUID')) return part;
    let t = part.replace(/\b(the|both the|learn|know) ([a-z][a-z'’ /-]{1,30}?)(?: and ([a-z][a-z'’ /-]{1,30}?))? (cantrips?|spells?)\b/gi, (all, lead, a, b, word) => {
      const la = link(a), lb = b ? link(b) : null;
      if (!la || (b && !lb)) return all;
      return lead + ' ' + la + (b ? ' and ' + lb : '') + ' ' + word;
    });
    t = t.replace(/\bthe spells? ([a-z][a-z'’ /-]{1,30}?)(?=,| from| to| as| and|\.|;)/gi, (all, a) => { const la = link(a); return la ? all.replace(a, la) : all; });
    return t;
  }).join('');
}

/** Top-level blocks of cleaned html. */
function blocks(s) {
  const out = [];
  const re = /<(h[1-6]|p|ul|ol|table|hr)\b[^>]*?(\/?)>/g;
  let m, pos = 0;
  const loose = (from, to) => {
    const t = s.slice(from, to);
    if (text(t) || /⟦L\d+⟧/.test(t)) out.push({ tag: 'p', html: `<p>${t.trim()}</p>` });
  };
  while ((m = re.exec(s))) {
    if (m.index < pos) continue;
    loose(pos, m.index);
    const tag = m[1];
    if (tag === 'hr') { out.push({ tag: 'hr' }); pos = m.index + m[0].length; continue; }
    let depth = 1, end = s.length;
    const tre = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'g'); tre.lastIndex = m.index + m[0].length;
    let t;
    while ((t = tre.exec(s))) { depth += t[1] ? -1 : 1; if (!depth) { end = t.index + t[0].length; break; } }
    out.push({ tag, html: s.slice(m.index, end) });
    pos = end; re.lastIndex = end;
  }
  loose(pos, s.length);
  return out;
}

const TITLE_BAD = /^(at|when|starting|beginning|also|you|your|if|once|in addition|additionally|while|whenever|as an?|the \w+ table|each|this|these|by|upon|after|before|until|choose|select)\b/i;
function titleLike(t) {
  if (!t) return false;
  if (t.length > 70) return false;
  if (t.split(/\s+/).length > 9) return false;
  if (/[.]$/.test(t)) return false;
  if (TITLE_BAD.test(t)) return false;
  return true;
}

/** Units: blocks with the level marker lifted out, and "Title<br>Body" paragraphs split. */
function units(s) {
  const out = [];
  for (const b of blocks(s)) {
    if (b.tag === 'hr') { out.push({ tag: 'hr' }); continue; }
    let html = b.html;
    const lv = [...html.matchAll(/⟦L(\d+)⟧/g)].map((m) => Number(m[1]));
    html = html.replace(/\s*⟦L\d+⟧\s*/g, ' ');
    if (b.tag === 'p') {
      // "Title<br />Body..." -> a title unit and the body
      const inner = html.replace(/^<p>\s*/, '').replace(/\s*<\/p>$/, '').replace(/^(\s*<br \/>\s*)+/, '');
      const parts = inner.split(/<br \/>/);
      const head = text(parts[0]);
      if (parts.length > 1 && titleLike(head) && text(parts.slice(1).join(' '))) {
        out.push({ tag: 'p', html: `<p>${parts[0].trim()}</p>`, text: head, lvl: lv[0] ?? null, split: true });
        const rest = parts.slice(1).join('<br />').replace(/^(\s*<br \/>\s*)+/, '');
        out.push({ tag: 'p', html: `<p>${rest.trim()}</p>`, text: text(rest), lvl: null });
        continue;
      }
      html = `<p>${inner.replace(/^(\s*<br \/>\s*)+|(\s*<br \/>\s*)+$/g, '').trim()}</p>`;
    } else if (/^h\d$/.test(b.tag)) {
      html = html.replace(/<br \/>/g, ' ').replace(/<\/?(strong|em)>/g, '');
    }
    const t = text(html);
    if (!t && !lv.length) continue;
    out.push({ tag: b.tag, html, text: t, lvl: lv[0] ?? null });
  }
  return out;
}

module.exports = { lookups, bodyOf, clean, units, text, norm, titleLike, levelOf };
