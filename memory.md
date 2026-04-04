# Project Memory: CASS Website

## 🎯 Tech Stack
- **Languages:** Plain HTML, CSS, vanilla JavaScript
- **Fonts:** Assistant (system font, no import needed)
- **Maps:** Leaflet.js (CDN) for partners page
- **Flipbook:** StPageFlip (CDN) for FAQ page
- **Deployment:** Cloudflare Pages (from GitHub repo)
- **Future:** Node.js backend planned for dynamic features

## 🗂 File Structure
```
/
├── index.html
├── events.html
├── faq.html
├── merch.html
├── about.html
├── contact.html
├── policies.html
├── partners.html
├── seasons.html
├── css/
│   └── shared.css          ← CSS variables, nav, hamburger, footer, utilities
├── js/
│   └── shared.js           ← Injects nav + footer, wires hamburger. Call initPage('key')
└── assets/
    ├── merch.json          ← Product data. Drives both merch.html and home page cards
    ├── media/              ← Images and video
    └── merch/              ← Product images
```

## 🧩 Shared Components (shared.js / shared.css)
Every page uses:
```html
<div id="site-nav"></div>
  <!-- page content -->
<div id="site-footer"></div>
<script src="js/shared.js"></script>
<script>initPage('pagekey');</script>
```
Page keys: `home`, `events`, `seasons`, `faq`, `partners`, `merch`, `about`, `contact`, `policies`

`initPage()` handles:
- Nav injection with active link highlighting
- Mobile menu injection
- Hamburger toggle (☰ ↔ ✕)
- Footer injection

## 🎨 Design Tokens (css/shared.css)
```css
--sage: #c8dfc0          /* page background */
--sage-light: #d8ebd0
--sage-mid: #b8cfb0
--dark: #121212          /* nav, footer */
--dark-mid: #2a2a26
--olive: #4a5e3a         /* accents, prices */
--olive-light: #5a7048
--cream: #f5f0e8
--accent: #7a9e5a        /* hover states */
--text-dark: #1a1a18
--text-mid: #3a3a38
--text-light: #6a6a68
```

## 📄 Pages Status

| Page | Status | Notes |
|------|--------|-------|
| index.html | ✅ Done | Slideshow, mission, video, merch grid, match CTA, Instagram stubs |
| events.html | ✅ Done | Filter/search/sort, event cards, modal, community events |
| faq.html | ✅ Done | FAQ text, StPageFlip flipbook stub, Find a Match CTA |
| merch.html | ✅ Done | JSON-driven grid, qty stepper / choose options per type |
| about.html | ✅ Done | Text + image strip stubs |
| contact.html | ✅ Done | Email address + image strip stub |
| policies.html | ✅ Done | Three policy items |
| partners.html | ✅ Done | Leaflet map, searchable venue sidebar, video strip stub |
| seasons.html | ✅ Done | Season Overview + Cascade Armory sections |

## 📦 Data Files

### assets/merch.json
Each product has: `id`, `name`, `price`, `image`, `type`
- `type: "simple"` → renders qty stepper (±)
- `type: "options"` → renders "Choose options" button

### Planned data files (not yet created)
- `assets/events.json` — events.html currently uses hardcoded JS array, should migrate
- `assets/venues.json` — partners.html currently uses hardcoded JS array, should migrate
- `assets/instagram.json` — static Instagram image cache (pending customer account setup)

## 🔧 Known Issues / Technical Notes
- `fetch()` requires a local server — use `python3 -m http.server 8080` or `npx serve .` for local dev
- Ken Burns slideshow: `animation-fill-mode: forwards` on `.slide-bg` prevents transition stutter
- Mobile nav dropdown appears at `max-width: 768px`
- Nav height is 100px (to accommodate large logo image)
- Mobile menu `top` offset must match nav height (currently 100px)

## 🖼 Assets In Use
- `assets/media/Catheadnobackgroundsmall.png` — logo (nav)
- `assets/media/PHADrone.jpg` — hero slide 1
- `assets/media/DSC_1116.jpg` — hero slide 2
- `assets/media/lean.png` — mission section image
- `assets/media/promo_video_01.mp4` — home video strip
- `assets/media/DSC_0739.jpg` — match CTA panel 1
- `assets/media/DSC_0719.jpg` — match CTA panel 2
- `assets/merch/*.jpg` — product images (filenames in merch.json)

## 📋 TODO

### High Priority
- [ ] Migrate events array to `assets/events.json` and fetch it in events.html
- [ ] Migrate venues array to `assets/venues.json` and fetch it in partners.html
- [ ] Replace all image strip stubs in about.html and contact.html with real images
- [ ] Replace flipbook stub pages with real booklet images (`assets/faq_files/booklet/page-01.jpg` etc.)
- [ ] Confirm flipbook source — ask customer how original Shopify version was built (StPageFlip? other?)
- [ ] Add real background images to partners page map panels and find-match CTA on FAQ

### Instagram
- [ ] Confirm cascadeaction Instagram account type (must be Creator or Business for API access)
- [ ] If Creator/Business: implement Graph API token fetch + server-side cache to `assets/instagram.json`
- [ ] If staying static: manually populate `assets/instagram.json` with image paths + links

### Merch / Cart
- [ ] Decide on cart/checkout approach — Stripe hosted checkout links are simplest
- [ ] Wire "Choose options" buttons to product detail pages or Stripe links
- [ ] Wire qty stepper add-to-cart to Stripe or a cart state system

### Node.js Backend (future)
- [ ] Set up Express server to replace `python3 -m http.server` for local dev
- [ ] Move shared nav/footer to server-side template partials (EJS or Handlebars) to eliminate shared.js injection approach
- [ ] Add Instagram Graph API token refresh endpoint
- [ ] Consider server-side events/venues data management

### Polish
- [ ] Add hamburger menu to events.html, faq.html, merch.html (currently only index.html has it wired — all pages use shared.js now so it should work, verify)
- [ ] Test all pages at mobile breakpoint
- [ ] Add `<meta description>` to all pages
- [ ] Verify Leaflet map loads correctly on Cloudflare (CDN dependency)
- [ ] Verify StPageFlip loads correctly on Cloudflare (CDN dependency)
- [ ] Add favicon

## 🚀 Deployment
- Host: Cloudflare Pages
- Source: GitHub repository
- Build: none (static files, no build step)
- No adapter needed — pure static output
- No overage billing risk on Cloudflare free tier (unlimited bandwidth)