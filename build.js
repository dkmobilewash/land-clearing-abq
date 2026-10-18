// Zero-dependency static site builder.
// Reads src/pages/*.html, wraps each in src/partials/layout.html, fills {{tokens}}
// from site.config.json, and writes clean URLs to dist/ (e.g. dist/about/index.html).
const fs = require('fs');
const { execFileSync } = require('child_process');
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
// parent: Services=/services/         (optional middle breadcrumbs; chain several with " > ")
// schema: service, faq                (optional extra schema; comma-separate several)
// area: Rio Rancho                    (service pages for one area: sets areaServed)
// servicename: Land & Lot Clearing     (service + area pages: names the Service schema)
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
  logo: `${base}/assets/img/logo-512.png`,
  image: `${base}/assets/img/og-image.png`,
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
  ...(config.geo && {
    geo: { '@type': 'GeoCoordinates', latitude: config.geo.latitude, longitude: config.geo.longitude },
    hasMap: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${config.address}, ${config.city}, ${config.state} ${config.zip}`)}`,
  }),
  areaServed: config.areas.map((name) => ({ '@type': 'City', name: `${name}, ${config.state}` })),
};

// Google shows roughly 60 characters of a title. If "Page title | Brand" runs longer, drop the brand.
const TITLE_MAX = 60;
const brandSuffix = ` | ${config.name}`;
function pageTitle(meta, vars) {
  const t = fill(meta.title || config.name, vars);
  return t.length > TITLE_MAX && t.endsWith(brandSuffix) ? t.slice(0, -brandSuffix.length) : t;
}

// Last change date of a page's source file, from git (for <lastmod>). Missing git history → no date.
function lastModified(file) {
  try {
    const out = execFileSync('git', ['log', '-1', '--format=%cs', '--', path.join('src/pages', file)], { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] });
    return String(out).trim() || null;
  } catch {
    return null;
  }
}

// "Services=/services/ > Land & Lot Clearing=/land-clearing/" → [[name, href], ...]
function parents(meta) {
  if (!meta.parent) return [];
  return meta.parent.split(' > ').map((part) => {
    const i = part.lastIndexOf('=');
    return [part.slice(0, i).trim(), part.slice(i + 1).trim()];
  });
}

function schemaFor(meta, body, url, vars) {
  const blocks = [business];
  const types = (meta.schema || '').split(',').map((t) => t.trim()).filter(Boolean);
  const crumb = meta.crumb && fill(meta.crumb, vars);

  if (crumb) {
    const items = [{ name: 'Home', url: `${base}/` }];
    for (const [name, href] of parents(meta)) items.push({ name, url: base + href });
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
      name: meta.servicename && meta.area ? `${meta.servicename} in ${meta.area}`
        : meta.area ? `Land clearing & excavation in ${meta.area}` : crumb,
      serviceType: meta.servicename || (meta.area ? 'Land clearing, grading and excavation' : crumb),
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
  for (const [name, href] of parents(meta)) html += `<li><a href="${href}">${escapeHtml(name)}</a></li>`;
  return html + `<li aria-current="page">${escapeHtml(fill(meta.crumb, vars))}</li></ol></nav>`;
}

fs.rmSync(DIST, { recursive: true, force: true });
copyDir(path.join(ROOT, 'assets'), path.join(DIST, 'assets'));

const vars = { ...config, year: new Date().getFullYear() };
const pagesDir = path.join(SRC, 'pages');
const urls = [];
const leftovers = [];

// Pages can be nested one folder deep: src/pages/land-clearing/albuquerque.html → /land-clearing/albuquerque/
const pageFiles = [];
for (const entry of fs.readdirSync(pagesDir, { withFileTypes: true })) {
  if (entry.isDirectory()) {
    for (const f of fs.readdirSync(path.join(pagesDir, entry.name)).filter((f) => f.endsWith('.html')))
      pageFiles.push(`${entry.name}/${f}`);
  } else if (entry.name.endsWith('.html')) pageFiles.push(entry.name);
}

for (const file of pageFiles.sort()) {
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
    pageTitle: escapeHtml(pageTitle(meta, vars)),
    pageDescription: escapeHtml(fill(meta.description || config.tagline, vars)),
    canonical: base + url,
  });

  const missing = html.match(/\{\{[^}]*\}\}|<!--\s*@[\w-]+\s*-->/g);
  if (missing) leftovers.push(`${file}: ${[...new Set(missing)].join(', ')}`);

  if (slug === '404') {
    // Vercel serves dist/404.html for any URL that doesn't exist
    fs.writeFileSync(path.join(DIST, '404.html'), html);
    continue;
  }
  const outDir = slug === 'index' ? DIST : path.join(DIST, slug);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'index.html'), html);
  if (meta.noindex !== 'true') urls.push({ url, lastmod: lastModified(file) });
}

// sitemap + robots
fs.writeFileSync(
  path.join(DIST, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
    .map(({ url, lastmod }) => `  <url><loc>${base}${url}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}</url>`)
    .join('\n')}\n</urlset>\n`
);
fs.writeFileSync(
  path.join(DIST, 'site.webmanifest'),
  JSON.stringify({
    name: config.name,
    short_name: config.shortName,
    start_url: '/',
    display: 'browser',
    background_color: '#ffffff',
    theme_color: '#24211d',
    icons: [
      { src: '/assets/img/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/assets/img/logo-512.png', sizes: '512x512', type: 'image/png' },
    ],
  }, null, 2)
);
fs.writeFileSync(path.join(DIST, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${base}/sitemap.xml\n`);

if (leftovers.length) {
  console.error(`Unresolved tokens or partials:\n  ${leftovers.join('\n  ')}`);
  process.exit(1);
}
console.log(`Built ${urls.length} indexed pages (+ noindex pages) → dist/`);
