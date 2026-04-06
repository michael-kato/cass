# Project Memory: CASS Website

## 🎯 Tech Stack
- **Languages:** Plain HTML, CSS, vanilla JavaScript
- **Backend:** Node.js + Express (`server.js` at root)
- **Payments:** Stripe Checkout (hosted, server-side session creation)
- **Scraping:** Cloudflare Worker + Browser Rendering (Puppeteer) + KV storage
- **Fonts:** Assistant (system font, no import needed)
- **Maps:** Leaflet.js (CDN) for partners page
- **Flipbook:** StPageFlip (CDN) for FAQ page
- **Deployment:** Cloudflare Pages (static site) + Cloudflare Worker (scraper)

## 🗂 File Structure (Monorepo)
```
/
├── server.js               ← Express — serves static files + Stripe API
├── package.json            ← Express, Stripe dependencies
├── .env                    ← never committed
├── .env.example
├── .gitignore              ← excludes .env, node_modules at all levels
├── index.html
├── events.html
├── faq.html
├── merch.html
├── about.html
├── contact.html
├── policies.html
├── partners.html
├── seasons.html
├── checkout-success.html
├── assets/
│   ├── shared.css          ← CSS variables, nav, hamburger, footer, utilities
│   ├── shared.js           ← Injects nav+footer, hamburger, loads cart.js
│   ├── cart.js             ← Cart state (localStorage), drawer UI, Stripe redirect
│   ├── events.json         ← TODO: migrate from hardcoded array in events.html
│   ├── merch.json          ← Product data — drives merch.html and home merch grid
│   ├── venues.json         ← TODO: migrate from hardcoded array in partners.html
│   ├── media/              ← Images and video
│   └── merch/              ← Product images
└── scraper-worker/         ← Separate Cloudflare Worker project (same git repo)
    ├── index.js            ← Worker: scrapes Practiscore, stores in KV
    ├── wrangler.toml       ← Worker config, KV binding, cron schedule
    ├── package.json        ← Wrangler, @cloudflare/puppeteer
    └── README.md
```

## 🧩 Shared Components
Every page uses:
```html
<div id="site-nav"></div>
  <!-- page content -->
<div id="site-footer"></div>
<script src="assets/shared.js"></script>
<script>initPage('pagekey');</script>
```
Page keys: `home`, `events`, `seasons`, `faq`, `partners`, `merch`, `about`, `contact`, `policies`

`initPage()` handles:
- Nav injection with active link highlighting
- Mobile menu injection + hamburger toggle (☰ ↔ ✕)
- Footer injection
- Dynamically loads `assets/cart.js` and calls `initCart()`

## 🛒 Cart System
- State stored in `localStorage` under key `cass_cart`
- `cart.js` exposes: `addToCart(product)`, `removeFromCart(id)`, `updateQuantity(id, qty)`
- Slide-out drawer injected into every page via `initCart()`
- Cart icon in nav shows red badge with item count
- Checkout POSTs to `/api/create-checkout-session` → redirects to Stripe hosted checkout
- On success: redirects to `checkout-success.html`, clears cart
- On cancel: returns to `merch.html`
- `merch.html` uses `window.MERCH_PRODUCTS[id]` lookup to avoid JSON/quote issues in onclick attributes
- Drawer uses event delegation for qty/remove buttons — no inline onclick handlers

## 💳 Stripe Integration
- `server.js` exposes `POST /api/create-checkout-session`
- Takes `{ items: [{ id, name, price, image, quantity }] }`
- Converts price strings (e.g. `"$35.00 USD"`) to cents via regex
- Env vars required: `STRIPE_SECRET_KEY`, `SITE_URL`
- Shipping collection enabled, US only
- `server.js` uses `extensions: ['html']` so `/merch`, `/events` etc. resolve without extension

## 🕷 Scraper Worker (scraper-worker/)
Cloudflare Worker that scrapes Practiscore registration pages for spots remaining.

**Architecture:**
```
Cron (every 3hrs) → Worker → Puppeteer → practiscore.com/{slug}/register
                                        → KV store → /data endpoint → events.html
```

**Key design decisions:**
- Worker fetches `assets/events.json` from the live site to get slugs dynamically — no hardcoding in wrangler.toml
- Stores results in KV with 6hr TTL (1hr TTL on failure)
- Exposes `GET /data` (all matches) and `GET /data?slug=...` (single match)
- `GET /scrape?slug=...` for manual testing
- Target selector: `.alert.alert-info.centerText` — may need narrowing, multiple elements possible
- Falls back gracefully — events.html shows static data if scraper unavailable or blocked

**Setup steps:**
```bash
cd scraper-worker
npm install
npx wrangler kv namespace create MATCH_DATA
# paste KV namespace ID into wrangler.toml
npx wrangler deploy
```

**In events.html:** after deploying, replace `YOUR-SUBDOMAIN` in `SCRAPER_URL`:
```javascript
const SCRAPER_URL = 'https://cass-scraper.YOUR-SUBDOMAIN.workers.dev/data';
```

**Known risk:** Practiscore is behind Cloudflare and robots.txt disallows scraping.
Browser Rendering is always identified as bot traffic. May get blocked — treat as
best-effort. If blocked, events.html silently falls back to static spot counts.

## 🖨 Print-on-Demand (TODO)
- Confirm with client: Printful or Printify?
- Plan: Stripe `checkout.session.completed` webhook → Node.js → Printful API
- Only apparel is POD — towels and sticker packs are physical inventory

## 🎨 Design Tokens (assets/shared.css)
```css
--sage: #c8dfc0
--sage-light: #d8ebd0
--sage-mid: #b8cfb0
--dark: #121212
--dark-mid: #2a2a26
--olive: #4a5e3a
--olive-light: #5a7048
--cream: #f5f0e8
--accent: #7a9e5a
--text-dark: #1a1a18
--text-mid: #3a3a38
--text-light: #6a6a68
```

## 📄 Pages Status

| Page | Status | Notes |
|------|--------|-------|
| index.html | ✅ Done | Slideshow, mission, video, merch grid, match CTA, Instagram stubs |
| events.html | ✅ Done | Filter/search/sort, cards, modal, community events, live spots from scraper |
| faq.html | ✅ Done | FAQ text, StPageFlip flipbook stub, Find a Match CTA |
| merch.html | ✅ Done | JSON-driven, Add to Cart wired to cart.js |
| about.html | ✅ Done | Text + image strip stubs |
| contact.html | ✅ Done | Email + image strip stub |
| policies.html | ✅ Done | Three policy items |
| partners.html | ✅ Done | Leaflet map, searchable sidebar, video stub |
| seasons.html | ✅ Done | Season Overview + Cascade Armory sections |
| checkout-success.html | ✅ Done | Post-Stripe confirmation page |

## 📦 Data Files

### assets/merch.json
Each product: `id`, `name`, `price`, `image`, `type`
- `type: "simple"` — no variants
- `type: "options"` — has variants (size etc.) — variants not yet implemented

### assets/events.json (TODO — not yet created)
Each event should include:
```json
{
  "id": 1,
  "type": "match",
  "name": "SVRC Season Kickoff",
  "month": "APR", "day": "19",
  "dateSort": "2026-04-19",
  "date": "April 19, 2026",
  "time": "7:30 AM – 4:00 PM",
  "state": "WA",
  "location": "Snoqualmie Valley Rifle Club, Fall City, WA",
  "spots": 60, "filled": 44,
  "desc": "...",
  "registerUrl": "https://practiscore.com/...",
  "practiscoreSlug": "svrc-season-kickoff-2026"
}
```
`practiscoreSlug` drives the scraper — omit for events not on Practiscore.

### assets/venues.json (TODO — not yet created)
### assets/instagram.json (TODO — pending account type confirmation)

## 🔧 Running Locally
```bash
# Main site
npm install
cp .env.example .env   # fill in STRIPE_SECRET_KEY
node server.js         # http://localhost:3000

# Scraper worker (separate)
cd scraper-worker
npm install
npx wrangler dev       # test locally
```

## 🔧 Known Issues / Notes
- Cart `onclick` uses `window.MERCH_PRODUCTS[id]` — avoids JSON/quote issues in HTML attributes
- Cart drawer uses event delegation for qty/remove buttons
- Ken Burns: `animation-fill-mode: forwards` on `.slide-bg` prevents stutter
- Nav height is 100px; mobile menu `top` offset must match
- `fetch()` requires a server — don't open HTML files directly from disk
- Scraper worker and main site are separate `npm install` environments in the same repo

## 🖼 Assets In Use
- `assets/media/Catheadnobackgroundsmall.png` — logo
- `assets/media/PHADrone.jpg` — hero slide 1
- `assets/media/DSC_1116.jpg` — hero slide 2
- `assets/media/lean.png` — mission image
- `assets/media/promo_video_01.mp4` — home video strip
- `assets/media/DSC_0739.jpg` — match CTA panel 1
- `assets/media/DSC_0719.jpg` — match CTA panel 2
- `assets/merch/*.jpg` — product images (filenames in merch.json)

## 📋 TODO

### High Priority
- [ ] Migrate events hardcoded array → `assets/events.json` (update events.html + scraper worker)
- [ ] Migrate venues hardcoded array → `assets/venues.json`
- [ ] Update scraper worker to fetch slugs from `assets/events.json` instead of wrangler.toml
- [ ] Replace `YOUR-SUBDOMAIN` in events.html after deploying scraper worker
- [ ] Test full Stripe checkout flow end to end with test keys
- [ ] Implement product size/variant selection for apparel
- [ ] Confirm POD provider with client (Printful vs Printify)

### Scraper
- [ ] Deploy scraper worker and confirm it can reach Practiscore at all
- [ ] Narrow CSS selector if `.alert.alert-info.centerText` returns multiple elements
- [ ] Handle Cloudflare challenge page response gracefully
- [ ] Consider parsing spots as integer for "Almost full!" logic

### Instagram
- [ ] Confirm cascadeaction account type (must be Creator/Business)
- [ ] Implement Graph API fetch + server-side cache

### Print-on-Demand
- [ ] Wire Printful/Printify API on Stripe `checkout.session.completed` webhook

### Deployment
- [ ] Decide Node.js API hosting: Cloudflare Workers vs Render/Railway
- [ ] Set STRIPE_SECRET_KEY + SITE_URL in production environment
- [ ] Switch Stripe keys test → live before launch

### Polish
- [ ] Replace image stubs in about.html, contact.html
- [ ] Replace flipbook stubs with real booklet images
- [ ] Test all pages at mobile breakpoint
- [ ] Add `<meta description>` to all pages
- [ ] Add favicon
- [ ] Verify Leaflet + StPageFlip CDN on Cloudflare