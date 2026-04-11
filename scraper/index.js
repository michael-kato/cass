// CASS Practiscore Scraper (Final Production Version)
// Dynamic Link-Based Scraping
import puppeteer from "@cloudflare/puppeteer";

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(scrapeAllMatches(env));
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // GET /data?slug=... (Fetch cached result)
    if (url.pathname === '/data') {
      const slug = url.searchParams.get('slug');
      if (!slug) return new Response('Missing slug', { status: 400 });
      const cached = await env.MATCH_DATA.get(slug);
      return new Response(cached || JSON.stringify({ error: "No data cached yet." }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    // GET /scrape-all (Manual Trigger)
    if (url.pathname === '/scrape-all') {
      ctx.waitUntil(scrapeAllMatches(env));
      return new Response('Scrape triggered in background...', { status: 202 });
    }

    // GET /test (Scrape only the FIRST link found in the TOML)
    if (url.pathname === '/test') {
      const links = await fetchLinksFromSite(env);
      if (links.length === 0) return new Response('No registration links found in events.toml', { status: 404 });
      
      const result = await scrapeSingleLink(env, links[0]);
      return new Response(JSON.stringify(result, null, 2), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    // Diagnostic: See all links found
    if (url.pathname === '/debug-links') {
      const links = await fetchLinksFromSite(env);
      return new Response(JSON.stringify(links, null, 2), { headers: { 'Content-Type': 'application/json' } });
    }

    return new Response('CASS Scraper. Endpoints: /data, /scrape-all, /test, /debug-links', { status: 200 });
  }
};

async function fetchLinksFromSite(env) {
  try {
    const response = await fetch(`${env.SITE_URL}/assets/events.toml`);
    const text = await response.text();
    
    // Find all registration URLs directly (e.g., registrationUrl = "https://...")
    const regex = /registrationUrl\s*=\s*"([^"]+)"/g;
    const links = [];
    let match;
    while ((match = regex.exec(text)) !== null) {
      if (!links.includes(match[1])) links.push(match[1]);
    }
    return links;
  } catch (err) {
    console.error('[Scraper] Failed to fetch links:', err.message);
    return [];
  }
}

// Helper to get a database-friendly name from a URL
function getSlugFromUrl(url) {
  try {
    const parts = new URL(url).pathname.split('/').filter(p => p && p !== 'register');
    return parts[parts.length - 1] || 'unknown-match';
  } catch {
    return 'invalid-url';
  }
}

async function scrapeAllMatches(env) {
  const links = await fetchLinksFromSite(env);
  if (links.length === 0) {
    console.error("[Scraper] No links found to scrape.");
    return;
  }

  let browser;
  try {
    console.log(`[Scraper] Starting batch scrape for ${links.length} links...`);
    browser = await puppeteer.launch(env.BROWSER);
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    console.log(`[Scraper] Logging into Practiscore...`);
    await page.goto("https://practiscore.com/login", { waitUntil: "domcontentloaded" });
    await page.type("input[name='email']", env.PS_USERNAME);
    await page.type("input[name='password']", env.PS_PASSWORD);
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
      page.click("button[type='submit']")
    ]);

    for (const link of links) {
      try {
        const slug = getSlugFromUrl(link);
        console.log(`[Scraper] Scraping ${slug}...`);
        
        await page.goto(link, { waitUntil: 'domcontentloaded' });
        
        const data = await page.evaluate(() => {
          const alerts = Array.from(document.querySelectorAll('.alert-info'));
          const target = alerts.find(a => /spot|remain|full|waitlist/i.test(a.innerText));
          return target ? target.innerText.replace(/×/g, '').trim() : "Registration Info Not Found";
        });

        const result = {
          slug,
          url: link,
          spotsText: data,
          success: !data.includes("Not Found"),
          scrapedAt: new Date().toISOString()
        };

        await env.MATCH_DATA.put(slug, JSON.stringify(result));
        console.log(`[Scraper] Cached ${slug}: ${data}`);
      } catch (err) {
        console.error(`[Scraper] Failed ${link}: ${err.message}`);
      }
    }
  } catch (err) {
    console.error(`[Scraper] Fatal Batch Error: ${err.message}`);
  } finally {
    if (browser) await browser.close();
  }
}

async function scrapeSingleLink(env, link) {
  const slug = getSlugFromUrl(link);
  let browser;
  try {
    console.log(`[Scraper] Starting single scrape for: ${link}`);
    browser = await puppeteer.launch(env.BROWSER);
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    console.log(`[Scraper] Portal Login...`);
    await page.goto("https://practiscore.com/login", { waitUntil: "domcontentloaded" });
    await page.type("input[name='email']", env.PS_USERNAME);
    await page.type("input[name='password']", env.PS_PASSWORD);
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
      page.click("button[type='submit']")
    ]);

    await page.goto(link, { waitUntil: 'domcontentloaded' });
    const data = await page.evaluate(() => {
      const alerts = Array.from(document.querySelectorAll('.alert-info'));
      const target = alerts.find(a => /spot|remain|full|waitlist/i.test(a.innerText));
      return target ? target.innerText.replace(/×/g, '').trim() : "Registration Info Not Found";
    });

    const result = {
      slug,
      url: link,
      spotsText: data,
      success: !data.includes("Not Found"),
      scrapedAt: new Date().toISOString()
    };

    await env.MATCH_DATA.put(slug, JSON.stringify(result));
    return result;
  } catch (err) {
    return { error: err.message, success: false };
  } finally {
    if (browser) await browser.close();
  }
}
