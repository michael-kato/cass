/* shared.js - injects nav, mobile menu, and footer into every page.
   Each page must have:
     <div id="site-nav"></div>       at the top of <body>
     <div id="site-footer"></div>    at the bottom of <body>
   And call initNav('pagename') where pagename matches the data-page on the <a> tags.
*/

window.addEventListener('error', function (event) {
  try {
    fetch('/api/log-client', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'window.error',
        message: event.message,
        source: event.filename,
        lineno: event.lineno,
        error: event.error ? event.error.stack : null,
        url: window.location.href
      })
    });
  } catch(e) {}
});

window.addEventListener('unhandledrejection', function (event) {
  try {
    fetch('/api/log-client', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'unhandledrejection',
        message: event.reason ? event.reason.toString() : 'Unhandled promise rejection',
        url: window.location.href,
        stack: event.reason && event.reason.stack ? event.reason.stack : null
      })
    });
  } catch(e) {}
});

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
const CART_BADGE_HTML = `
  <span class="cart-badge" data-cart-badge="true">0</span>
`;

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
        <button class="search-trigger" aria-label="Search">${ICON_SEARCH}</button>
        <button class="cart-trigger" aria-label="Cart">
          ${ICON_CART}
          ${CART_BADGE_HTML}
        </button>
      </div>
      <button class="hamburger" id="hamburger" aria-label="Menu">${ICON_HAMBURGER}</button>
    </nav>
    <div class="mobile-menu" id="mobile-menu">
      <div class="mobile-menu-actions" style="grid-template-columns: repeat(2, minmax(0, 1fr));">
        <button class="search-trigger" aria-label="Search">${ICON_SEARCH}<span>Search</span></button>
        <button class="cart-trigger" aria-label="Cart">
          ${ICON_CART}
          <span>Cart</span>
          ${CART_BADGE_HTML}
        </button>
      </div>
      ${mobileLinks}
    </div>
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

  // Inject Search Modal
  const searchModalHtml = `
    <div class="site-search-modal" id="site-search-modal">
      <div class="site-search-backdrop" id="site-search-backdrop"></div>
      <div class="site-search-content">
        <form id="site-search-form">
          ${ICON_SEARCH}
          <input type="text" id="site-search-input" placeholder="Search the site..." autocomplete="off" />
          <button type="button" id="site-search-close" aria-label="Close">${ICON_CLOSE}</button>
        </form>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', searchModalHtml);

  const searchModal = document.getElementById('site-search-modal');
  const searchInput = document.getElementById('site-search-input');
  
  function openSearch() {
    searchModal.classList.add('open');
    searchInput.focus();
  }
  function closeSearch() {
    searchModal.classList.remove('open');
    searchInput.value = '';
  }

  document.querySelectorAll('.search-trigger').forEach(btn => btn.addEventListener('click', openSearch));
  document.getElementById('site-search-backdrop').addEventListener('click', closeSearch);
  document.getElementById('site-search-close').addEventListener('click', closeSearch);
  
  document.getElementById('site-search-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const q = searchInput.value.trim();
    if (q) {
      window.location.href = 'search.html?q=' + encodeURIComponent(q);
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeSearch();
  });

  // Load cart - dynamically so pages work without it if needed
  const cartScript = document.createElement('script');
  cartScript.src = 'assets/cart.js';
  cartScript.onload = () => initCart();
  document.body.appendChild(cartScript);

  initKenBurns();
}

async function loadToml(path, collectionKey = null, options = {}) {
  const params = new URLSearchParams({ path });

  if (options.markdownFields?.length) {
    params.set('markdown', options.markdownFields.join(','));
  }

  const response = await fetch(`/api/toml?${params.toString()}`);

  if (!response.ok) {
    throw new Error(`Failed to load TOML file: ${path}`);
  }

  const data = await response.json();
  return collectionKey ? (data[collectionKey] || []) : data;
}


// Ken Burns - true circular pan
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
