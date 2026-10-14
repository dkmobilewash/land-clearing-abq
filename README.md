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
| `/packages/` | 3 bundles + comparison table |
| `/free-estimate/` | Estimate booking form |
| `/service-areas/` | Bernalillo, Sandoval, Valencia & Torrance Counties (anchors like `#rio-rancho` are linked from the home page) |
| `/projects/` | Before/after gallery (placeholder cards) |
| `/reviews/`, `/about/`, `/faq/`, `/contact/` | |
| `/thank-you/` | Shown after a form is sent (`noindex`, left out of the sitemap) |

## Editing
- **Business info, placeholders & prices:** `site.config.json`. Change the phone number there once and it updates everywhere.
- **Shared pieces:** `src/partials/`. Any partial can be pulled into a page with `<!-- @file-name -->`
  (`estimate-form`, `packages`, `services-grid`, `review-cards`, `cta`, plus `<!-- @breadcrumbs -->`).
- **Page content:** `src/pages/*.html`. The comment at the top of each page sets:
  - `title:` and `description:` for the `<title>` and meta description
  - `crumb:` (and optional `parent: Services=/services/`) for the visible breadcrumbs and BreadcrumbList schema
  - `schema: service` (Service schema) or `schema: faq` (FAQPage schema, built from the page's own `<details>` questions)
  - `noindex: true` to keep a page out of search engines and the sitemap
- **Styles:** `assets/css/styles.css`. Colors and the type scale are CSS variables at the top.
  The palette is named after local materials: basalt (dark), caliche (light sections), juniper (accents),
  survey tan (contour lines) and safety yellow (buttons only). Type is Barlow Condensed for headlines and Barlow for text.
  `assets/img/topo.svg` is the contour-map texture used in the hero and page headers.
- **Images:** `assets/img/`. Hand-made SVGs (logo, favicon, equipment illustrations, icons).

The build fails if any `{{token}}` or `<!-- @partial -->` is left unresolved, so typos are caught before deploy.

## Placeholders to replace before launch
Search the repo for `PLACEHOLDER` to find them all.

| What | Where |
|---|---|
| Phone (`phone`, `phoneHref`) | `site.config.json` (currently `(505) 555-0123`) |
| Email, domain, hours | `site.config.json` |
| NM contractor license, insurance details, year founded, equipment list | `site.config.json` |
| **"Starting at" prices** (`price.clearHaul`, `price.clearGrade`, `price.fullSitePrep`) | `site.config.json` (currently `$X,XXX`) |
| Google review link (`googleReviewUrl`) | `site.config.json` |
| Customer reviews | `src/partials/review-cards.html` |
| Owner story | `src/pages/about.html` |
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
   - `https://yourdomain.com/api/lead?check` shows `true`/`false` for each variable (never the values) and the sender domain.
   - `https://yourdomain.com/api/lead?check&send=you@yourbusiness.com` sends one test email and shows Resend's reply.
     It only sends to an address listed in `LEAD_TO_EMAIL` / `SEND_EMAIL`.

Spam protection: a hidden `company` honeypot field. When a bot fills it in, the API reports success and sends nothing.
