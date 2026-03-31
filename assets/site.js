const menuToggle = document.querySelector('[data-menu-toggle]');
const menu = document.querySelector('[data-menu]');

if (menuToggle && menu) {
  menuToggle.addEventListener('click', () => {
    const open = menu.classList.toggle('is-open');
    menuToggle.setAttribute('aria-expanded', String(open));
  });
}

const page = document.body.dataset.page;
if (page) {
  document.querySelectorAll('.site-nav a').forEach((link) => {
    const match =
      (page === 'home' && link.getAttribute('href') === 'index.html') ||
      link.getAttribute('href') === `${page}.html`;
    if (match) link.classList.add('is-active');
  });
}

const heroSlides = [
  {
    title: 'Signups for the North Carolina Circuit are live',
    text: 'Original homepage hero promoted the live circuit signup with a direct CTA to the matches page.',
    label: 'Sign Up Now',
    href: 'matches.html',
  },
  {
    title: 'Welcome to Cascade Action Shooting Sports',
    text: 'The second active homepage slide focused on the brand introduction and kept the image dominant.',
    label: 'Learn More',
    href: 'about-us.html',
  },
  {
    title: 'Season rewards and membership messaging can plug back in later',
    text: 'Inactive Shopify slides were represented here so the extracted site still communicates the original design intent.',
    label: 'View Season Info',
    href: 'season-system.html',
  },
];

const heroTitle = document.querySelector('[data-hero-title]');
const heroText = document.querySelector('[data-hero-text]');
const heroLink = document.querySelector('[data-hero-link]');

if (heroTitle && heroText && heroLink) {
  let index = 0;
  window.setInterval(() => {
    index = (index + 1) % heroSlides.length;
    const slide = heroSlides[index];
    heroTitle.textContent = slide.title;
    heroText.textContent = slide.text;
    heroLink.textContent = slide.label;
    heroLink.setAttribute('href', slide.href);
  }, 6500);
}
