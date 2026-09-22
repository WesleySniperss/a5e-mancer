// a5e.tools list views (Drupal): every page of one, as rows of { url, name, ...columns }.
const fs = require('fs'), path = require('path');
const P = require('./paths.cjs');

const txt = (s) => s.replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#039;|&rsquo;/g, "'").replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

async function get(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'a5e-mancer importer (github.com/WesleySniperss/a5e-mancer)' } });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.text();
}

/** Rows of one list page: the title link, and every other column by its field name. */
function rowsOf(html) {
  const body = html.slice(html.indexOf('<tbody'), html.indexOf('</tbody>'));
  if (!body) return [];
  return body.split('<tr').slice(1).map((r) => {
    const row = {};
    for (const m of r.matchAll(/<td[^>]*class="views-field views-field-([a-z0-9-]+)[^"]*"[^>]*>([\s\S]*?)<\/td>/g)) {
      const field = m[1].replace(/^field-/, '');
      if (field === 'title') { row.url = (m[2].match(/href="([^"]+)"/) || [])[1]; row.name = txt(m[2]); }
      else row[field] = txt(m[2]);
    }
    return row;
  }).filter((r) => r.url);
}

/** Every page of a list, cached; `refresh` fetches again. */
async function fetchList(slug, { refresh = false, pause = 400 } = {}) {
  const dir = path.join(P.CACHE, 'lists', slug);
  fs.mkdirSync(dir, { recursive: true });
  const all = [];
  for (let page = 0; page < 500; page++) {
    const file = path.join(dir, `page-${page}.html`);
    let html;
    if (!refresh && fs.existsSync(file)) html = fs.readFileSync(file, 'utf8');
    else { html = await get(`https://a5e.tools/${slug}?page=${page}`); fs.writeFileSync(file, html); await new Promise((ok) => setTimeout(ok, pause)); }
    const rows = rowsOf(html);
    if (!rows.length) break;
    all.push(...rows);
    if (!/rel="next"|pager__item--next/.test(html)) break;
  }
  return all;
}

module.exports = { fetchList, rowsOf, get, txt };
