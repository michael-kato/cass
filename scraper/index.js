// CASS Practiscore Scraper Worker
// Cloudflare Worker with Browser Rendering
// Debug mode: hit /scrape?slug=<slug> to test

import puppeteer from "@cloudflare/puppeteer";

// Persistent lock with timestamp to prevent permanent hangs
let lock = {
  active: false,
  timestamp: 0,
  slug: null
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // EMERGENCY RESET: Hit this if the scraper is stuck
    if (url.pathname === '/reset') {
      lock.active = false;
      lock.timestamp = 0;
      lock.slug = null;
      return new Response("Scraper lock force-cleared. Try again.", { status: 200 });
    }

    if (url.pathname === '/scrape') {
      const slug = url.searchParams.get('slug');
      if (!slug) return new Response('Missing ?slug= parameter', { status: 400 });

      // Check for stale lock (older than 2 minutes)
      const now = Date.now();
      if (lock.active && (now - lock.timestamp > 120000)) {
        console.log(`[Scraper] Detected stale lock for ${lock.slug}. Force-clearing.`);
        lock.active = false;
      }

      if (lock.active) {
        console.log(`[Scraper] Blocked: already scraping ${lock.slug}.`);
        return new Response(JSON.stringify({ 
          error: "A scrape is already in progress.", 
          current_match: lock.slug,
          seconds_elapsed: Math.floor((now - lock.timestamp) / 1000)
        }), {
          status: 429, headers: { 'Content-Type': 'application/json' }
        });
      }

      try {
        lock.active = true;
        lock.timestamp = Date.now();
        lock.slug = slug;

        const result = await scrapeMatch(env, slug);

        let htmlResponse = `
          <h3>Scrape Results for: ${slug}</h3>
          <p><strong>Spots Extracted:</strong> ${result.spotsText || 'Not Found'}</p>
          <p><strong>Success Status:</strong> ${result.success}</p>
          <pre>${JSON.stringify(result, null, 2)}</pre>
          <hr>
          <a href="/reset">Click here to Force Reset Scraper</a>
        `;

        return new Response(htmlResponse, {
          headers: { 'Content-Type': 'text/html' }
        });
      } catch (err) {
        return new Response(`Error: ${err.message}`, { status: 500 });
      } finally {
        lock.active = false;
        lock.slug = null;
      }
    }

    return new Response('CASS Scraper. Hit /scrape?slug=your-slug to test or /reset to clear hangs.', { status: 200 });
  }
};

async function scrapeMatch(env, slug) {
  const url = `https://practiscore.com/${slug}/register`;
  console.log(`[Scraper] ──────────────────────────────────`);
  console.log(`[Scraper] Target: ${slug}`);

  let browser;
  try {
    console.log(`[Scraper] Launching browser...`);
    // Pass protocolTimeout to prevent indefinite hangs in the launch phase
    browser = await puppeteer.launch(env.BROWSER);
    
    console.log(`[Scraper] Browser session OK. Opening tab...`);
    const page = await browser.newPage();
    
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    console.log(`[Scraper] Logging in...`);
    await page.goto("https://practiscore.com/login", { waitUntil: "domcontentloaded", timeout: 25000 });

    if (!env.PS_USERNAME || !env.PS_PASSWORD) throw new Error("Missing credentials");

    await page.type("input[type='email'], input[name='email']", env.PS_USERNAME);
    await page.type("input[type='password'], input[name='password']", env.PS_PASSWORD);
    
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 25000 }),
      page.click("button[type='submit']")
    ]);
    console.log(`[Scraper] Auth Successful.`);

    console.log(`[Scraper] Heading to match page...`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    const alerts = await page.$$eval('.alert.alert-info.centerText', els => els.map(el => el.innerText.trim())).catch(() => []);
    
    const spotsText = alerts.find(text => /spot|register|remain|full|waitlist/i.test(text)) || alerts[0] || null;

    console.log(`[Scraper] Result Found: ${spotsText}`);
    return {
      slug,
      spotsText,
      success: true,
      scrapedAt: new Date().toISOString()
    };

  } catch (err) {
    console.error(`[Scraper] ERROR: ${err.message}`);
    throw err;
  } finally {
    if (browser) {
      console.log(`[Scraper] Closing browser...`);
      await browser.close().catch(() => {});
    }
  }
}
