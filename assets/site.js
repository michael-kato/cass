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
  const pageHrefMap = {
    home: 'index.html',
    about: 'about-us.html',
    matches: 'matches.html',
    faq: 'faq.html',
    contact: 'contact.html',
    season: 'season-system.html',
    partners: 'partners.html',
    archive: 'match-archive.html',
  };

  document.querySelectorAll('.site-nav a').forEach((link) => {
    const match = link.getAttribute('href') === pageHrefMap[page];
    if (match) link.classList.add('is-active');
  });
}

const heroSlides = [
  {
    title: 'Signups for the North Carolina Circuit are live',
    text: 'Original homepage hero promoted the live circuit signup with a direct CTA to the events page.',
  },
  {
    title: 'Welcome to Cascade Action Shooting Sports',
    text: 'The second active homepage slide focused on the brand introduction and kept the image dominant.',
  },
  {
    title: 'Season rewards and membership messaging can plug back in later',
    text: 'Inactive Shopify slides were represented here so the extracted site still communicates the original design intent.',
  },
];

const heroTitle = document.querySelector('[data-hero-title]');
const heroText = document.querySelector('[data-hero-text]');
const heroCurrent = document.querySelector('[data-hero-current]');
const heroTotal = document.querySelector('[data-hero-total]');
const heroPrev = document.querySelector('[data-hero-prev]');
const heroNext = document.querySelector('[data-hero-next]');
const heroPause = document.querySelector('[data-hero-pause]');

if (heroTitle && heroText) {
  let index = 0;
  let timer = null;
  let playing = true;

  const renderSlide = () => {
    const slide = heroSlides[index];
    heroTitle.textContent = slide.title;
    heroText.textContent = slide.text;
    if (heroCurrent) heroCurrent.textContent = String(index + 1);
    if (heroTotal) heroTotal.textContent = String(heroSlides.length);
  };

  const startRotation = () => {
    timer = window.setInterval(() => {
      index = (index + 1) % heroSlides.length;
      renderSlide();
    }, 6500);
  };

  const stopRotation = () => {
    if (timer) window.clearInterval(timer);
  };

  renderSlide();
  startRotation();

  heroPrev?.addEventListener('click', () => {
    index = (index - 1 + heroSlides.length) % heroSlides.length;
    renderSlide();
  });

  heroNext?.addEventListener('click', () => {
    index = (index + 1) % heroSlides.length;
    renderSlide();
  });

  heroPause?.addEventListener('click', () => {
    playing = !playing;
    heroPause.textContent = playing ? '||' : '>';
    heroPause.setAttribute('aria-label', playing ? 'Pause slideshow' : 'Resume slideshow');
    if (playing) {
      stopRotation();
      startRotation();
    } else {
      stopRotation();
    }
  });

  window.addEventListener('beforeunload', () => {
    stopRotation();
  });
}
