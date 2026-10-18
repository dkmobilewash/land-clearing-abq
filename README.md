# Land Clearing Albuquerque — website

Static marketing site for Land Clearing Albuquerque, a land clearing and excavation company in Albuquerque, NM.
It uses the same architecture as the Soft Water Albuquerque site: a zero-dependency Node build script,
`{{token}}` placeholders filled from one config file, and a Vercel serverless function that emails leads through Resend.

## Pages
| URL | Source |
|---|---|
| `/` | `src/pages/index.html`: hero + estimate form, trust strip, problem cards, 3 bundles, comparison table, 3 steps, local know-how, services, reviews, service areas, FAQ |
| `/services/` | Services hub, links to every service page |
| `/land-clearing/`, `/brush-weed-removal/`, `/tree-stump-removal/`, `/forestry-mulching/`, `/defensible-space/`, `/demolition-debris-hauling/` | Clearing service pages |
| `/excavation/`, `/grading-leveling/`, `/site-prep/`, `/trenching/`, `/driveway-grading/`, `/drainage-erosion-control/`, `/rock-caliche-removal/` | Excavation & grading service pages |
| `/<service>/<area>/`, e.g. `/land-clearing/albuquerque/` | 85 service + area pages in `src/pages/<service>/<area>.html`, one for each service in each featured area where the service fits (weak fits were left out on purpose). Each has its own copy, section mix and FAQ. They're linked from the "Where we offer…" section on every service page and the "Services we offer in…" section on every area page (`src/partials/where-<service>.html` and `src/partials/services-in-<area>.html`). |
| `/packages/` | 3 bundles + comparison table (hidden for now: `noindex`, not linked, no prices) |
| `/free-estimate/` | Estimate booking form |
| `/service-areas/` | Bernalillo, Sandoval, Valencia & Torrance Counties (anchors like `#rio-rancho` are linked from the home page) |
| `/albuquerque/`, `/rio-rancho/`, `/corrales/`, `/north-valley/`, `/tanoan/`, `/paradise-hills/`, `/los-ranchos-de-albuquerque/`, `/albuquerque-acres/` | One page per featured service area: local ground conditions, who sets the rules, most-requested services, local FAQ (with FAQPage schema) and an estimate form. Listed in this order in the Service Areas dropdown and the footer. |
| `/projects/` | Before/after gallery (placeholder cards) |
| `/reviews/`, `/about/`, `/faq/`, `/contact/` | |
| `/thank-you/` | Shown after a form is sent (`noindex`, left out of the sitemap) |

## Editing
- **Business info, placeholders & prices:** `site.config.json`. Change the phone number there once and it updates everywhere.
- **Shared pieces:** `src/partials/`. Any partial can be pulled into a page with `<!-- @file-name -->`
  (`estimate-form`, `packages`, `services-grid`, `review-cards`, `cta`, plus `<!-- @breadcrumbs -->`).
- **Page content:** `src/pages/*.html` and `src/pages/<service>/<area>.html` (one folder level of nesting becomes `/<service>/<area>/`). The comment at the top of each page sets:
  - `title:` and `description:` for the `<title>` and meta description
  - `crumb:` (and optional `parent: Services=/services/`) for the visible breadcrumbs and BreadcrumbList schema
  - `schema: service`, `schema: faq` or `schema: service, faq` (Service schema; FAQPage schema built from the page's own `<details>` questions)
  - `area: Rio Rancho` on area pages, which sets the Service schema's `areaServed`
  - `noindex: true` to keep a page out of search engines and the sitemap
- **Styles:** `assets/css/styles.css`. Colors and the type scale are CSS variables at the top.
  The palette is named after local materials: basalt (dark), caliche (light sections), juniper (accents),
  survey tan (contour lines) and safety yellow (buttons only). Type is Barlow Condensed for headlines and Barlow for text.
  `assets/img/topo.svg` is the contour-map texture used in the hero and page headers.
- **Images:** `assets/img/`. Hand-made SVGs (logo, favicon, equipment illustrations, icons).

The build fails if any `{{token}}` or `<!-- @partial -->` is left unresolved, so typos are caught before deploy.

SEO details handled by the build:
- Titles that would run past 60 characters with " | Land Clearing Albuquerque" drop the brand automatically.
- Every page gets Open Graph and Twitter tags with `assets/img/og-image.png` (1200×630) as the share image.
- Business schema includes the PNG logo, share image, map coordinates (`geo` in `site.config.json`) and a Google Maps link.
- `sitemap.xml` includes `<lastmod>` from each page's last git commit; `src/pages/404.html` becomes `dist/404.html`
  (noindex, not in the sitemap); `site.webmanifest` and PNG icons are generated/included.
- Fonts (Barlow, Barlow Condensed) are self-hosted in `assets/fonts/` under the SIL Open Font License.

## Placeholders to replace before launch
Search the repo for `PLACEHOLDER` to find them all.

| What | Where |
|---|---|
| Email | `site.config.json` |
| Year founded | `site.config.json` (`license`, `insurance` and `equipment` are kept there but not shown on the site right now) |
| **"Starting at" prices** (`price.clearHaul`, `price.clearGrade`, `price.fullSitePrep`) | Hidden for now: the home bundles section and the Pricing nav/footer links were removed, `/packages/` is `noindex` and shows no prices. To bring them back, set real prices in `site.config.json` and see the comment at the top of `src/partials/packages.html`. |
| Google review link (`googleReviewUrl`) | `site.config.json` |
| Customer reviews | `src/partials/review-cards.html` |
| Before/after project photos | `src/pages/projects.html` (put photos in `assets/img/projects/`) |
| Logo | `assets/img/logo.svg` and `assets/img/favicon.svg` |
| "Licensed & insured" claims | Trust strip and comparison table in `src/pages/index.html`; remove them if not yet true |

Don't add star ratings, review counts, awards, warranties, or years-in-business claims until they're real.

## Build & test
```bash
npm run build     # outputs dist/
npm start         # build + serve at http://localhost:3000
npm test          # tests for the lead form API (api/lead.js) with a mocked Resend
```
No dependencies.

## Deploying on Vercel
1. Import this repo in Vercel. `vercel.json` already sets the build command (`node build.js`) and output folder (`dist`).
   Don't add `trailingSlash` to `vercel.json`: it redirects POSTs to `/api/lead` and breaks the form.
2. Form submissions go to the serverless function `api/lead.js`, which emails each lead through [Resend](https://resend.com).
   In **Project → Settings → Environment Variables**, add these for **Production**:

   | Variable (either name works) | Example |
   |---|---|
   | `RESEND_API_KEY` or `RESEND_API` | `re_xxxxxxxx` (from Resend → API Keys) |
   | `LEAD_TO_EMAIL` or `SEND_EMAIL` | `you@yourbusiness.com` (comma-separate for several) |
   | `LEAD_FROM_EMAIL` (optional) | `Website <leads@landclearingalbuquerque.com>` (the domain must be verified in Resend) |

   Without `LEAD_FROM_EMAIL`, leads are sent from Resend's test sender (`onboarding@resend.dev`), which
   **only delivers to the email address your Resend account was created with**. Verify your domain in Resend and
   set `LEAD_FROM_EMAIL` to send leads to any address.

3. Redeploy after adding the variables. Until they're set, the form shows a "please call us" error instead of silently losing leads.
4. In Resend → Domains, verify your sending domain. At your DNS host, also add a DMARC record so Gmail doesn't spam-folder the leads:
   `TXT` record, name `_dmarc`, value `v=DMARC1; p=none;`
5. Check the setup:
   - `https://www.landclearingalbuquerque.com/api/lead?check` shows `true`/`false` for each variable (never the values) and the sender domain.
   - `https://www.landclearingalbuquerque.com/api/lead?check&send=you@yourbusiness.com` sends one test email and shows Resend's reply.
     It only sends to an address listed in `LEAD_TO_EMAIL` / `SEND_EMAIL`.

Spam protection: a hidden `company` honeypot field. When a bot fills it in, the API reports success and sends nothing.
