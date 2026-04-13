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
│   ├── checkout-success.html
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
│   │   └── merch.toml
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
- Success URL points to [`public/checkout-success.html`](/opt/git/cass/public/checkout-success.html)
- Cancel URL points back to [`public/merch.html`](/opt/git/cass/public/merch.html)
- Cart clears on the success page after returning from a payment gateway
- Fulfillment automated via Printify API calls triggered by verified payment events.
- Stripe uses `POST /api/stripe-webhook` for fulfillment to handle async payments.
- Local Worker secrets should be supplied through `.dev.vars` during `wrangler dev`
- **TODO:** Implement Cloudflare D1 for unified order history and reconciliation.
- **Financial Flow**: Customer pays via Shopify/Stripe (funds held ~1 week before payout). Printify charges the bank account immediately for fulfillment. Refunds are deducted from bank account or pending Shopify balance.
- Added Stripe Webhook endpoints handling `checkout.session.completed`, `checkout.session.expired`, `checkout.session.async_payment_failed`, and `account.external_account.created`.

## Search & Navigation
- A purely local search engine operates from `public/search.html`.
- Parses and indexes all TOML data (`merch`, `events`, `venues`).
- Dynamically fetches and strips script tags from static HTML pages (About, Contact, FAQ, etc.) to index bare-text content.
- Results dynamically extract associated hero images (`data-bg-image`) or standard `<img>` tags for visual layout.
- Search result links to Events pass a `?highlight=ID` URL parameter.
- `events.html` reads the parameter, triggers a smooth scrolling action, and animates a spotlight brightness and dark-border ping to highlight the event card.
- User accounts are currently in development (see NEXT STEPS).

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

## Deployment
- Main CASS site auto-deploys to Cloudflare when changes are pushed to `main` via Cloudflare's native Git integration. No GitHub Actions needed.
- Scraper worker at `/scraper/` is NOT covered by the Git integration. It must be manually deployed from within that directory: `npx wrangler deploy -c wrangler.toml`
- **Critical**: Always use `-c wrangler.toml` for the scraper deploy to prevent Wrangler from picking up the parent `wrangler.jsonc`

## Scraper Worker
Scraper lives in [`/scraper`](/opt/git/cass/scraper) as a fully independent Cloudflare Worker.

### Architecture
- **No external API exists** for Practiscore — all data must be scraped.
- Registration data is behind a login wall. Raw HTTP fetch returns only a "requires a free account" alert, not spot counts.
- Scraper must: (1) log in via Puppeteer, (2) navigate to each match's `/register` URL, (3) extract the `.alert-info` div text.
- Data is cached in a Cloudflare KV namespace (`MATCH_DATA`, id: `f06e1acee402409aaf9b39d9bc1f87e3`) so the main site reads from cache, not live scrapes.
- Scraper runs automatically every 2 hours via Cron trigger.

### ID System
- `events.toml` uses `id = "practiscore-match-handle"` (the middle segment of the Practiscore URL).
- The scraper constructs the full URL as `https://practiscore.com/${id}/register`.
- The same `id` is used as the KV database key, so `MATCH_DATA.get(id)` returns live spot data.
- `registerUrl` field has been removed from `events.toml` — it's now derived from `id`.
- `events.html` constructs registration links as `` `https://practiscore.com/${e.id}/register` ``.
- `events.html` looks up scraper data with `matchData[e.id]` (previously used `e.practiscoreSlug`).

### Endpoints
| Endpoint | Description |
|---|---|
| `/` | HTML index of all endpoints (clickable links) |
| `/debug-sources` | Verbose fetch diagnostics — shows what IDs resolve to |
| `/test` | Scrapes the first match found (one-and-done, no param needed) |
| `/scrape-all` | Triggers background batch scrape of all matches |
| `/data?id=...` | Returns cached KV result for a specific match |
| `/scrape?id=...` | On-demand live scrape for a specific match |
| `/sessions` | Lists active Cloudflare Browser Rendering sessions |
| `/clear-sessions` | Force-kills any hung browser sessions |

### Config Files
- [`scraper/wrangler.toml`](/opt/git/cass/scraper/wrangler.toml): binds `BROWSER` (Browser Rendering), `MATCH_DATA` (KV), and Cron trigger
- [`scraper/.dev.vars`](/opt/git/cass/scraper/.dev.vars): `PS_USERNAME`, `PS_PASSWORD`, `CASS_SITE_URL`, `TEST_IDS`
- `CASS_SITE_URL` is also set in `[vars]` in `wrangler.toml` for production

### Local Development Limitations
Cloudflare Workers sandbox blocks these in local dev (`wrangler dev`):
1. **Fetch to `localhost`**: Returns `403 error code: 1003` (Direct IP Access Not Allowed)
2. **Fetch to `*.workers.dev`**: Returns `404 error code: 1042` (Worker-to-Worker routing blocked in dev)
3. **Puppeteer/Browser Rendering**: Crashes with `RangeError: Offset is outside the bounds of the DataView`

**Workaround**: `TEST_IDS=id1,id2` in `.dev.vars` provides a fallback ID list when TOML fetch fails. The `fetchIdsFromSite()` function falls back to this automatically.

### Dynamic ID Fetching
- In production: scraper fetches `${CASS_SITE_URL}/assets/events.toml` and extracts all `id` fields using regex: `/\[\[events\]\]\s*id\s*=\s*"([^"]+)"/g`
- In local dev: TOML fetch fails (403/404), `TEST_IDS` fallback kicks in
- `usingFallback: true` in `/debug-sources` output confirms fallback is active

### Known Gotchas
- **Never add `MATCH_DATA` KV binding to the main `wrangler.jsonc`** — it belongs only to the scraper. Adding it to the main site causes `error 1042` on all requests, breaking `events.toml` serving.
- Cloudflare Browser Rendering free tier: 100 sessions/day, max 2 concurrent. `wrangler dev` counts against this, not just production.
- `wrangler dev` for scraper may show 429 even under the limit due to dev-mode throttling. Deploy to production for reliable browser testing.
- The `[vars]` in `wrangler.toml` override `.dev.vars` for the same key — remove vars from `wrangler.toml` if you want `.dev.vars` to take effect locally.

## events.toml Schema
Each `[[events]]` entry has:
```toml
[[events]]
id = "practiscore-match-handle"   # used as DB key + URL segment, replaces old numeric id
type = "two-gun" | "low-light"
name = "Display Name"
date = "YYYY-MM-DD"
venueId = "bir" | "pha" | "svrc" | "jcsa"
image = "assets/media/filename.jpg"
spots = 60
desc = """..."""   # Markdown, rendered server-side to descHtml
```
Note: `registerUrl` field was removed. URL is derived from `id`.

## Current Known Issues / Follow-Ups
- Deploy scraper via `npx wrangler deploy -c wrangler.toml` after changes (not covered by Git auto-deploy)
- Update `public/assets/merch.toml` to include `shopifyVariantId` for every product
- Run a consistency pass on page-local layout gutters
- Test all TOML-backed pages through the real worker/server path after content edits
- Setup production Stripe Webhook keys securely by running `npx wrangler secret put STRIPE_WEBHOOK_SECRET`
- [x] Implement `withErrorHandling` middleware in `server.js` for global error logging to D1.
- [x] Fix Scraper Service Binding path and remove fragile HTTP fetch fallback.
- [x] Implement parallel session cleanup in Scraper.
- [x] Add numeric 'remaining' Extraction to scraper for frontend math.
- [x] Update frontend to show "Sold / Total" spots with "Almost Full" badges.
- [x] Implement Stripe session retrieval in webhook for robust address/metadata access.
- [x] Fix Printify fulfillment logic to handle multi-dash product and color names.

### NEXT STEPS (Tomorrow):
- [ ] **Customer Accounts**: Re-enable "Account" header icon and build D1-backed profile/order history page.
- [ ] **Printify ID Mapping**: Add `printifyBlueprintId` and `printifyPrintProviderId` to each product in `merch.toml`.
- [ ] **Variant Logic**: Map specific `variant_id` values for color/size combinations in `merch.toml` to automate order creation.
- [ ] **D1 Order Ledger**: Create a dedicated `orders` table in D1 (beyond the current diagnostic `cass_logs`).
- [ ] **Refund API**: Build `/api/refund` for Stripe and PayPal with Printify order cancellation logic.
- [ ] **Stripe Production Check**: Ensure the webhook is subscribed to `checkout.session.completed` in the live dashboard.

## Recent Major Changes
- **Scraper complete overhaul**: Link-first architecture, ID-based KV storage, dynamic TOML-fetching, login-authenticated Puppeteer scraping, full management endpoint suite
- `events.toml` migrated from numeric IDs + `registerUrl` to string IDs (Practiscore match handles) with no `registerUrl` field
- `events.html` updated to derive registration URLs from `e.id` and look up scraper data by `e.id`
- Implemented global error logging securely tied to a Cloudflare D1 SQL database
- Created robust Local Search engine inside `search.html`
- Implemented deep-link highlighting and auto-scrolling on event cards
- Wired secure Stripe Webhook listeners in `server.js`
- Migrated asset data from JSON to TOML
- Added server-side TOML parsing through `/api/toml`
- Added trusted Markdown rendering for selected TOML fields
- Refactored Ken Burns behavior into shared JS/CSS
- Tightened shared site gutters and content width handling
