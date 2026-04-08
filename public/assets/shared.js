/* shared.js — injects nav, mobile menu, and footer into every page.
   Each page must have:
     <div id="site-nav"></div>       at the top of <body>
     <div id="site-footer"></div>    at the bottom of <body>
   And call initNav('pagename') where pagename matches the data-page on the <a> tags.
*/

const NAV_LINKS = [
  { href: 'index.html',    label: 'Home',     key: 'home' },
  { href: 'events.html',   label: 'Events',   key: 'events' },
  { href: 'seasons.html',  label: 'Seasons',  key: 'seasons' },
  { href: 'faq.html',      label: 'FAQ',      key: 'faq' },
  { href: 'partners.html', label: 'Partners', key: 'partners' },
  { href: 'merch.html',    label: 'Merch / Swag', key: 'merch' },
  { href: 'about.html',    label: 'About Us', key: 'about' },
  { href: 'contact.html',  label: 'Contact',  key: 'contact' },
];

const ICON_SEARCH = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>`;
const ICON_ACCOUNT = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;
const ICON_CART = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>`;
const ICON_HAMBURGER = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>`;
const ICON_CLOSE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
const ICON_ARROW = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>`;
const ICON_INSTAGRAM = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none"/></svg>`;

function buildNav(activePage) {
  const links = NAV_LINKS.map(l =>
    `<li><a href="${l.href}" ${l.key === activePage ? 'class="active"' : ''}>${l.label}</a></li>`
  ).join('');

  const mobileLinks = NAV_LINKS.map(l =>
    `<a href="${l.href}" ${l.key === activePage ? 'class="active"' : ''}>${l.label}</a>`
  ).join('');

  return `
    <nav>
      <a href="index.html" class="nav-logo">
        <img src="assets/media/Catheadnobackgroundsmall.png" alt="CASS" />
      </a>
      <ul class="nav-links">${links}</ul>
      <div class="nav-icons">
        <button aria-label="Search">${ICON_SEARCH}</button>
        <button aria-label="Account">${ICON_ACCOUNT}</button>
        <button aria-label="Cart" style="position:relative;">
          ${ICON_CART}
          <span id="cart-badge" style="
            display:none;position:absolute;top:-4px;right:-4px;
            background:#c0392b;color:#fff;
            width:16px;height:16px;border-radius:50%;
            font-size:0.6rem;font-weight:700;
            align-items:center;justify-content:center;
            font-family:Assistant,sans-serif;line-height:1;
          ">0</span>
        </button>
      </div>
      <button class="hamburger" id="hamburger" aria-label="Menu">${ICON_HAMBURGER}</button>
    </nav>
    <div class="mobile-menu" id="mobile-menu">${mobileLinks}</div>
  `;
}

function buildFooter(activePage) {
  const footerLinks = [
    { href: '#', label: 'Search', key: '' },
    { href: 'faq.html', label: 'FAQ', key: 'faq' },
    { href: 'policies.html', label: 'Policies', key: 'policies' },
  ];

  const links = footerLinks.map(l =>
    `<a href="${l.href}" ${l.key === activePage ? 'class="active"' : ''}>${l.label}</a>`
  ).join('');

  return `
    <footer>
      <div class="footer-top">${links}</div>
      <div class="footer-bottom">
        <div class="footer-newsletter">
          <h4>Stay connected on the latest from CASS</h4>
          <div class="newsletter-form">
            <input type="email" placeholder="Email" />
            <button aria-label="Subscribe">${ICON_ARROW}</button>
          </div>
        </div>
        <div class="footer-social">
          <a href="https://instagram.com/cascadeaction" aria-label="Instagram" target="_blank" rel="noopener">
            ${ICON_INSTAGRAM}
          </a>
        </div>
      </div>
    </footer>
  `;
}

function initPage(activePage) {
  // Inject nav
  const navEl = document.getElementById('site-nav');
  if (navEl) navEl.innerHTML = buildNav(activePage);

  // Inject footer
  const footerEl = document.getElementById('site-footer');
  if (footerEl) footerEl.innerHTML = buildFooter(activePage);

  // Wire hamburger
  const hamburger = document.getElementById('hamburger');
  const mobileMenu = document.getElementById('mobile-menu');
  if (hamburger && mobileMenu) {
    hamburger.addEventListener('click', () => {
      const open = mobileMenu.classList.toggle('open');
      hamburger.innerHTML = open ? ICON_CLOSE : ICON_HAMBURGER;
    });
    mobileMenu.querySelectorAll('a').forEach(a => {
      a.addEventListener('click', () => {
        mobileMenu.classList.remove('open');
        hamburger.innerHTML = ICON_HAMBURGER;
      });
    });
  }

  // Load cart — dynamically so pages work without it if needed
  const cartScript = document.createElement('script');
  cartScript.src = 'assets/cart.js';
  cartScript.onload = () => initCart();
  document.body.appendChild(cartScript);

  initKenBurns();
}

let tomlLibraryPromise = null;

function ensureTomlLibrary() {
  if (window.TOML?.parse) return Promise.resolve(window.TOML);
  if (tomlLibraryPromise) return tomlLibraryPromise;

  tomlLibraryPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-toml-library="true"]');
    if (existing) {
      existing.addEventListener('load', () => resolve(window.TOML), { once: true });
      existing.addEventListener('error', () => reject(new Error('Failed to load TOML library.')), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.src = 'assets/toml.js';
    script.dataset.tomlLibrary = 'true';
    script.onload = () => resolve(window.TOML);
    script.onerror = () => reject(new Error('Failed to load TOML library.'));
    document.head.appendChild(script);
  });

  return tomlLibraryPromise;
}

async function loadToml(path, collectionKey = null) {
  const [{ parse }, response] = await Promise.all([
    ensureTomlLibrary(),
    fetch(path),
  ]);

  if (!response.ok) {
    throw new Error(`Failed to load TOML file: ${path}`);
  }

  const data = parse(await response.text());
  return collectionKey ? (data[collectionKey] || []) : data;
}


// Ken Burns — true circular pan
const KB_RADIUS = 1;   // pan radius in %
const KB_SCALE_START = 1.08;
const KB_SCALE_END   = 1.0;
const KB_DURATION    = 20000; // ms

function startKenBurns(el) {
  if (!el || el.dataset.kenBurnsStarted === 'true') return;

  el.dataset.kenBurnsStarted = 'true';

  const startAngle = Math.random() * Math.PI * 2;
  const startTime = performance.now();

  function tick(ts) {
    const t = ((ts - startTime) % KB_DURATION) / KB_DURATION; // loops 0→1 forever

    const angle = startAngle + t * Math.PI * 2;
    const scale = KB_SCALE_START + (KB_SCALE_END - KB_SCALE_START) * t;
    const tx = Math.cos(angle) * KB_RADIUS;
    const ty = Math.sin(angle) * KB_RADIUS;

    el.style.transform = `translate3d(${tx}%, ${ty}%, 0) scale(${scale})`;
    requestAnimationFrame(tick);
  }

  requestAnimationFrame(tick);
}

function setLayerBackgroundImage(el, image) {
  if (!el || !image) return;

  el.dataset.bgImage = image;
  const resolvedImage = new URL(image, document.baseURI).href;
  el.style.setProperty('--bg-image', `url('${resolvedImage}')`);
}

function initKenBurns(root = document) {
  root.querySelectorAll('[data-bg-image]').forEach(el => {
    const image = el.dataset.bgImage;
    setLayerBackgroundImage(el, image);
  });

  root.querySelectorAll('[data-ken-burns]').forEach(startKenBurns);
}
