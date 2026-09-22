// A Drupal node page's fields: { name: { label, html, text } } for each
// "field--name-*" block in the node's content, and the node title.
const { txt } = require('./lists.cjs');

function balanced(html, from) {
  // the <div ...> starting at `from`, to its matching </div>
  let depth = 0; const re = /<\/?div\b[^>]*>/g; re.lastIndex = from; let m;
  while ((m = re.exec(html))) { depth += m[0][1] === '/' ? -1 : 1; if (!depth) return html.slice(from, m.index + m[0].length); }
  return html.slice(from);
}

function fieldsOf(html) {
  const out = {};
  const title = (/<h1[^>]*class="[^"]*page-title[^"]*"[^>]*>([\s\S]*?)<\/h1>/.exec(html) || /<title>([^|<]*)/.exec(html) || [])[1];
  out.__title = txt(title ?? '');
  const re = /<div class="field field--name-([a-z0-9-]+)[^"]*"/g;
  let m;
  while ((m = re.exec(html))) {
    const name = m[1].replace(/^field-/, '');
    if (out[name]) continue;
    const block = balanced(html, m.index);
    const label = (/<div class="field--label[^"]*">([\s\S]*?)<\/div>/.exec(block) || [])[1];
    const items = [...block.matchAll(/<div class="field--item">([\s\S]*?)<\/div>\s*(?=<div class="field--item">|<\/div>\s*$|<\/div>\s*<\/div>)/g)].map((x) => x[1]);
    const inner = block.replace(/^<div[^>]*>/, '').replace(/<\/div>$/, '');
    out[name] = { label: label ? txt(label) : '', html: inner, text: txt(inner.replace(/<div class="field--label[^"]*">[\s\S]*?<\/div>/, '')), items: items.map(txt) };
  }
  return out;
}

module.exports = { fieldsOf, balanced };
