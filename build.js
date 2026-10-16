// Zero-dependency static site builder.
// Reads src/pages/*.html, wraps each in src/partials/layout.html, fills {{tokens}}
// from site.config.json, and writes clean URLs to dist/ (e.g. dist/about/index.html).
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const SRC = path.join(ROOT, 'src');
const DIST = path.join(ROOT, 'dist');
const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'site.config.json'), 'utf8'));
const base = config.domain.replace(/\/$/, '');

// Every file in src/partials/ can be included from a page with <!-- @file-name -->
// (e.g. <!-- @estimate-form --> pulls in src/partials/estimate-form.html).
const partials = {};
for (const file of fs.readdirSync(path.join(SRC, 'partials')).filter((f) => f.endsWith('.html'))) {
  partials[file.replace(/\.html$/, '')] = fs.readFileSync(path.join(SRC, 'partials', file), 'utf8');
}

// {{name}}, {{price.clearHaul}}, {{year}} ...
function fill(str, vars) {
  return str.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (m, key) => {
    const val = key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), vars);
    return val == null ? m : String(val);
  });
}

// Replace <!-- @partial --> markers (partials may include other partials).
function includePartials(str) {
  for (let pass = 0; pass < 5; pass++) {
    const next = str.replace(/<!--\s*@([\w-]+)\s*-->/g, (m, name) => (name in partials ? partials[name] : m));
    if (next === str) break;
    str = next;
  }
  return str;
}

const escapeHtml = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const stripTags = (s) =>
  s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&mdash;/g, '—').replace(/&ndash;/g, '–')
    .replace(/&rarr;/g, '→').replace(/&nbsp;/g, ' ').replace(/&#39;|&rsquo;/g, '’').replace(/\s+/g, ' ').trim();
const jsonLd = (obj) =>
  `<script type="application/ld+json">\n${JSON.stringify(obj, null, 2).replace(/<\//g, '<\\/')}\n  </script>`;

// Page front matter lives in a leading HTML comment:
// <!--
// title: ...
// description: ...
// crumb: Land & Lot Clearing          (breadcrumb label; adds BreadcrumbList schema)
// parent: Services=/services/         (optional middle breadcrumb)
// schema: service, faq                (optional extra schema; comma-separate several)
// area: Rio Rancho                    (service pages for one area: sets areaServed)
// noindex: true                       (keeps the page out of search + the sitemap)
// -->
function parsePage(raw) {
  const meta = {};
  const m = raw.match(/^<!--([\s\S]*?)-->\s*/);
  if (m) {
    m[1].split('\n').forEach((line) => {
      const i = line.indexOf(':');
      if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    });
    raw = raw.slice(m[0].length);
  }
  return { meta, body: raw };
}

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const s = path.join(from, entry.name);
    const d = path.join(to, entry.name);
    entry.isDirectory() ? copyDir(s, d) : fs.copyFileSync(s, d);
  }
}

const business = {
  '@context': 'https://schema.org',
  '@type': 'HomeAndConstructionBusiness',
  '@id': `${base}/#business`,
  name: config.name,
  description: config.tagline,
  url: `${base}/`,
  logo: `${base}/assets/img/logo.svg`,
  telephone: config.phone,
  email: config.email,
  address: {
    '@type': 'PostalAddress',
    streetAddress: config.address,
    addressLocality: config.city,
    addressRegion: config.state,
    postalCode: config.zip,
    addressCountry: 'US',
  },
  areaServed: config.areas.map((name) => ({ '@type': 'City', name: `${name}, ${config.state}` })),
};

function schemaFor(meta, body, url, vars) {
  const blocks = [business];
  const types = (meta.schema || '').split(',').map((t) => t.trim()).filter(Boolean);
  const crumb = meta.crumb && fill(meta.crumb, vars);

  if (crumb) {
    const items = [{ name: 'Home', url: `${base}/` }];
    if (meta.parent) {
      const [name, href] = meta.parent.split('=');
      items.push({ name: name.trim(), url: base + href.trim() });
    }
    items.push({ name: crumb, url: base + url });
    blocks.push({
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: items.map((it, i) => ({ '@type': 'ListItem', position: i + 1, name: it.name, item: it.url })),
    });
  }

  if (types.includes('service')) {
    blocks.push({
      '@context': 'https://schema.org',
      '@type': 'Service',
      name: meta.area ? `Land clearing & excavation in ${meta.area}` : crumb,
      serviceType: meta.area ? 'Land clearing, grading and excavation' : crumb,
      description: fill(meta.description, vars),
      url: base + url,
      provider: { '@id': `${base}/#business` },
      areaServed: meta.area
        ? { '@type': 'Place', name: `${meta.area}, ${config.state}` }
        : business.areaServed,
    });
  }

  // FAQPage schema is built from the page's own <details><summary>Q</summary><p>A</p></details>
  // markup, so the schema can never drift from what visitors see.
  if (types.includes('faq')) {
    const qa = [...body.matchAll(/<details>\s*<summary>([\s\S]*?)<\/summary>([\s\S]*?)<\/details>/g)];
    blocks.push({
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: qa.map(([, q, a]) => ({
        '@type': 'Question',
        name: stripTags(fill(q, vars)),
        acceptedAnswer: { '@type': 'Answer', text: stripTags(fill(a, vars)) },
      })),
    });
  }
  return blocks.map(jsonLd).join('\n  ');
}

function breadcrumbsHtml(meta, vars) {
  if (!meta.crumb) return '';
  let html = '<nav class="breadcrumbs" aria-label="Breadcrumb"><ol><li><a href="/">Home</a></li>';
  if (meta.parent) {
    const [name, href] = meta.parent.split('=');
    html += `<li><a href="${href.trim()}">${escapeHtml(name.trim())}</a></li>`;
  }
  return html + `<li aria-current="page">${escapeHtml(fill(meta.crumb, vars))}</li></ol></nav>`;
}

fs.rmSync(DIST, { recursive: true, force: true });
copyDir(path.join(ROOT, 'assets'), path.join(DIST, 'assets'));

const vars = { ...config, year: new Date().getFullYear() };
const pagesDir = path.join(SRC, 'pages');
const urls = [];
const leftovers = [];

for (const file of fs.readdirSync(pagesDir).filter((f) => f.endsWith('.html')).sort()) {
  const slug = file.replace(/\.html$/, '');
  const url = slug === 'index' ? '/' : `/${slug}/`;
  const { meta, body } = parsePage(fs.readFileSync(path.join(pagesDir, file), 'utf8'));

  // Function replacements so "$" in content (prices!) is never treated as a replacement pattern.
  const content = includePartials(body).replace('<!-- @breadcrumbs -->', () => breadcrumbsHtml(meta, vars));

  // Mark the current nav link
  const header = partials.header.replace(
    new RegExp(`href="${url.replace(/\//g, '\\/')}"`, 'g'),
    `href="${url}" aria-current="page"`
  );

  let html = partials.layout
    .replace('{{> header}}', () => header)
    .replace('{{> footer}}', () => partials.footer)
    .replace('{{> schema}}', () => schemaFor(meta, content, url, vars))
    .replace('{{> robots}}', () => (meta.noindex === 'true' ? '<meta name="robots" content="noindex">' : ''))
    .replace('{{> content}}', () => content);

  html = fill(html, {
    ...vars,
    pageTitle: escapeHtml(fill(meta.title || config.name, vars)),
    pageDescription: escapeHtml(fill(meta.description || config.tagline, vars)),
    canonical: base + url,
  });

  const missing = html.match(/\{\{[^}]*\}\}|<!--\s*@[\w-]+\s*-->/g);
  if (missing) leftovers.push(`${file}: ${[...new Set(missing)].join(', ')}`);

  const outDir = slug === 'index' ? DIST : path.join(DIST, slug);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'index.html'), html);
  if (meta.noindex !== 'true') urls.push(url);
}

// sitemap + robots
fs.writeFileSync(
  path.join(DIST, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
    .map((u) => `  <url><loc>${base}${u}</loc></url>`)
    .join('\n')}\n</urlset>\n`
);
fs.writeFileSync(path.join(DIST, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${base}/sitemap.xml\n`);

if (leftovers.length) {
  console.error(`Unresolved tokens or partials:\n  ${leftovers.join('\n  ')}`);
  process.exit(1);
}
console.log(`Built ${urls.length} indexed pages (+ noindex pages) → dist/`);
