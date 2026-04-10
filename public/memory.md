# Project Memory: CASS Website

## Tech Stack
- Frontend: plain HTML, CSS, and vanilla JavaScript
- Main runtime: Cloudflare Worker in [server.js](/opt/git/cass/server.js) with static assets served from `public/`
- Payments: Dual gateway support (Stripe for Cards/Link, PayPal Direct REST API)
- Data format: TOML in `public/assets/*.toml`
- TOML parsing: `@iarna/toml` on the server
- Markdown rendering: `marked` on the server for trusted content fields
- Maps: Leaflet via CDN on the partners page
- PDF/flipbook: PDF.js on the FAQ page
- Scraper: separate Cloudflare Worker in [`/scraper`](/opt/git/cass/scraper)

## Repo Shape
```text
/opt/git/cass
├── server.js
├── package.json
├── package-lock.json
├── wrangler.jsonc
├── public/
│   ├── index.html
│   ├── events.html
│   ├── faq.html
│   ├── partners.html
│   ├── merch.html
│   ├── merch-item.html
│   ├── about.html
│   ├── contact.html
│   ├── policies.html
│   ├── seasons.html
│   ├── assets/
│   │   ├── shared.css
│   │   ├── shared.js
│   │   ├── cart.js
│   │   ├── events.toml
│   │   ├── venues.toml
│   │   ├── merch.toml
│   │   └── checkout-success.html
│   └── memory.md
└── scraper/
    ├── index.js
    ├── README.md
    └── wrangler.toml
```

## Main App
- [`server.js`](/opt/git/cass/server.js) is a Cloudflare Worker entrypoint, not an Express server.
- [`wrangler.jsonc`](/opt/git/cass/wrangler.jsonc) binds `./public` as `ASSETS`.
- [`wrangler.jsonc`](/opt/git/cass/wrangler.jsonc) marks `STRIPE_SECRET_KEY` as a required secret.
- The worker currently exposes:
  - `POST /api/create-checkout-session`
  - `GET /api/toml?path=assets/<file>.toml`
- `/api/toml` can also render trusted Markdown fields when `markdown=field1,field2` is supplied.

## Shared Frontend
Every page follows this pattern:
```html
<div id="site-nav"></div>
<!-- page content -->
<div id="site-footer"></div>
<script src="assets/shared.js"></script>
<script>initPage('pagekey');</script>
```

Page keys:
- `home`
- `events`
- `seasons`
- `faq`
- `partners`
- `merch`
- `about`
- `contact`
- `policies`

[`public/assets/shared.js`](/opt/git/cass/public/assets/shared.js) currently handles:
- nav injection
- footer injection
- mobile menu toggle
- loading `assets/cart.js`
- `loadToml(path, collectionKey, options)`
- shared Ken Burns initialization for any element marked with `data-ken-burns`

Nav note:
- desktop and mobile nav both include search, account, and cart actions
- the account button may no longer be needed and could be removed in a future cleanup pass

[`public/assets/shared.css`](/opt/git/cass/public/assets/shared.css) currently holds:
- shared color tokens
- shared layout gutter/content-width tokens
- nav/footer styles
- utility page content styles
- shared Ken Burns frame/layer styles

## Data Layer
Data sources are:
- [`public/assets/events.toml`](/opt/git/cass/public/assets/events.toml)
- [`public/assets/venues.toml`](/opt/git/cass/public/assets/venues.toml)
- [`public/assets/merch.toml`](/opt/git/cass/public/assets/merch.toml)

Current page usage:
- [`public/index.html`](/opt/git/cass/public/index.html): loads merch from `merch.toml`
- [`public/events.html`](/opt/git/cass/public/events.html): loads events from `events.toml` and venues from `venues.toml`
- [`public/partners.html`](/opt/git/cass/public/partners.html): loads venues from `venues.toml`
- [`public/merch.html`](/opt/git/cass/public/merch.html): loads merch from `merch.toml`
- [`public/merch-item.html`](/opt/git/cass/public/merch-item.html): loads merch from `merch.toml`

## Markdown Rendering
Trusted Markdown is rendered server-side in `/api/toml` using `marked`.

Current Markdown-enabled fields:
- `desc` in events data, exposed to the client as `descHtml`
- `description` in merch data, exposed to the client as `descriptionHtml`

Current consumers:
- [`public/events.html`](/opt/git/cass/public/events.html): modal description uses `innerHTML` with `descHtml`
- [`public/merch-item.html`](/opt/git/cass/public/merch-item.html): product description uses `innerHTML` with `descriptionHtml`

Important note:
- This currently assumes all TOML content is trusted.
- If user-generated content is ever introduced, sanitization must be added before rendering HTML.

## Cart / Checkout
- Cart state lives in `localStorage` under `cass_cart`
- [`public/assets/cart.js`](/opt/git/cass/public/assets/cart.js) owns drawer UI and cart operations
- Stripe checkout is created by `POST /api/create-checkout-session`
- Worker uses `env.SITE_URL || request.url.origin` as the checkout base URL
- Success URL points to [`public/assets/checkout-success.html`](/opt/git/cass/public/assets/checkout-success.html)
- Cancel URL points back to [`public/merch.html`](/opt/git/cass/public/merch.html)
- Cart clears on the success page after returning from a payment gateway
- Fulfillment automated via Printify API calls triggered by verified payment events.
- Stripe uses `POST /api/stripe-webhook` for fulfillment to handle async payments.
- Local Worker secrets should be supplied through `.dev.vars` during `wrangler dev`
- **TODO:** Implement Cloudflare D1 for unified order history and reconciliation.
- Added Stripe Webhook endpoints handling `checkout.session.completed`, `checkout.session.expired`, `checkout.session.async_payment_failed`, and `account.external_account.created`.

## Search & Navigation
- A purely local search engine operates from `public/search.html`.
- Parses and indexes all TOML data (`merch`, `events`, `venues`).
- Dynamically fetches and strips script tags from static HTML pages (About, Contact, FAQ, etc.) to index bare-text content.
- Results dynamically extract associated hero images (`data-bg-image`) or standard `<img>` tags for visual layout.
- Search result links to Events pass a `?highlight=ID` URL parameter.
- `events.html` reads the parameter, triggers a smooth scrolling action, and animates a spotlight brightness and dark-border ping to highlight the event card.
- User accounts are currently shelved (no "Account" header icon).

## Error Logging & Observability
- Uses Cloudflare D1 SQLite Database (`cass-db`) and `migrations/0001_initial_logs.sql` for error logging.
- Global async `logError()` intercepts Stripe Signature verification, Printify fulfillment issues, and top-level fetch exceptions inside `server.js`.
- D1 bindings configured in `wrangler.jsonc`.

## Visual / Motion State
Shared Ken Burns logic is central and reusable across pages.

Current usage:
- Home hero backgrounds in [`public/index.html`](/opt/git/cass/public/index.html)
- FAQ bottom CTA image in [`public/faq.html`](/opt/git/cass/public/faq.html)
- About image strip in [`public/about.html`](/opt/git/cass/public/about.html)
- Contact image strip in [`public/contact.html`](/opt/git/cass/public/contact.html)

Home page specifics:
- Hero uses two layered backgrounds to crossfade between slide images
- Shared helper updates the active background image while Ken Burns continues underneath

## Layout State
- Shared spacing tokens operate from [`public/assets/shared.css`](/opt/git/cass/public/assets/shared.css)
- `--site-gutter`, `--content-narrow`, `--content-standard`, and `--content-wide` dictate spacing logic.
- Nav, footer, page content, FAQ content, and home sections inherit these shared spacing styling logic.
- Some page-local sections use hardcoded padding and require a consistency pass.

## Page Status
| Page | Status | Notes |
|------|--------|-------|
| `index.html` | Active | Hero slideshow, shared Ken Burns, merch feed, CTA panels |
| `events.html` | Active | TOML-driven events, modal, scraper merge, Markdown descriptions |
| `faq.html` | Active | FAQ text, PDF.js matchbook, shared Ken Burns CTA |
| `partners.html` | Active | Leaflet map, searchable venue list, TOML-driven venues |
| `merch.html` | Active | TOML-driven product list |
| `merch-item.html` | Active | TOML-driven detail page, Markdown descriptions |
| `about.html` | Active | Shared page shell plus Ken Burns image strip |
| `contact.html` | Active | Shared page shell plus Ken Burns image strip |
| `policies.html` | Active | Shared shell, static content |
| `seasons.html` | Active | Shared shell, static content |

## Local Run Notes
Likely local workflow:
```bash
npm install
npx wrangler dev
```

Important:
- `fetch()`-based pages require the worker/static server environment
- opening files directly from disk will not work for TOML-backed pages
- the app depends on `/api/toml` for content loading
- local Stripe testing uses `.dev.vars` config mapping `STRIPE_SECRET_KEY` and `SITE_URL`

## Scraper Worker
Scraper lives in [`/scraper`](/opt/git/cass/scraper).

Current code in [`scraper/index.js`](/opt/git/cass/scraper/index.js):
- says it fetches slugs dynamically from the live site
- still points to `assets/events.json`
- exposes `/data`, `/scrape`, and `/scrape-all`
- stores match results in KV under `MATCH_DATA`

Current mismatch to note:
- scraper code comments mention dynamic slug loading from `events.json`
- scraper README and `scraper/wrangler.toml` still describe hardcoded `MATCH_SLUGS`
- main site has already migrated to `events.toml`

This area still needs alignment before treating scraper behavior as current.

## Dependencies
Current app dependencies in [`package.json`](/opt/git/cass/package.json):
- `@iarna/toml`
- `marked`
- `express`
- `stripe`

Note:
- `express` is still listed, but the current main app runtime is a Worker-style `fetch()` handler, not an Express app

## Current Known Issues / Follow-Ups
- Update `public/assets/merch.toml` to include `shopifyVariantId` for every product.
- Update scraper worker to consume TOML or a derived JSON/API source instead of `assets/events.json`
- Update scraper README and `scraper/wrangler.toml` so docs/config match reality
- Replace placeholder `SCRAPER_URL` in [`public/events.html`](/opt/git/cass/public/events.html) if not already deployed
- Run a consistency pass on page-local layout gutters
- Test all TOML-backed pages through the real worker/server path after content edits
- Setup production Stripe Webhook keys securely by running `npx wrangler secret put STRIPE_WEBHOOK_SECRET`

## Recent Major Changes
- Implemented global error logging securely tied to a Cloudflare D1 SQL database.
- Created robust Local Search engine inside `search.html`.
- Implemented deep-link highlighting and auto-scrolling on event cards.
- Wired secure Stripe Webhook listeners in `server.js` to begin tracking async payments and cart abandonment.
- Polished checkout and quantity selection buttons on `merch-item.html`.
- Migrated asset data from JSON to TOML
- Added server-side TOML parsing through `/api/toml`
- Added trusted Markdown rendering for selected TOML fields
- Refactored Ken Burns behavior into shared JS/CSS
- Applied Ken Burns to home, FAQ, about, and contact
- Added hero background crossfade on the home page
- Tightened shared site gutters and content width handling
