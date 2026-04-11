// CASS Practiscore Scraper (Final Production Version)
// Uses 1 browser session for ALL matches + KV Caching
import puppeteer from "@cloudflare/puppeteer";

export default {
  // ── 1. BACKGROUND CRON: Runs on schedule ──
  async scheduled(event, env, ctx) {
    ctx.waitUntil(scrapeAllMatches(env));
  },

  // ── 2. WEB API: Fetches cached data or triggers manual scrape ──
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Endpoint for your website to get the data: /data?slug=renton-idpa
    if (url.pathname === '/data') {
      const slug = url.searchParams.get('slug');
      if (!slug) return new Response('Missing slug', { status: 400 });
      
      const cached = await env.MATCH_DATA.get(slug);
      return new Response(cached || JSON.stringify({ error: "No data cached yet." }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    // Manual Trigger: /scrape-all
    if (url.pathname === '/scrape-all') {
      ctx.waitUntil(scrapeAllMatches(env));
      return new Response('Scrape triggered in background...', { status: 202 });
    }

    return new Response('CASS Scraper Active', { status: 200 });
  }
};

async function scrapeAllMatches(env) {
  // 1. Fetch the slugs you want to track (You can move this to a secret or keep it here)
  const slugs = ["renton-idpa-2026-april", "pcsl-one-gun-low-light"];
  
  let browser;
  try {
    console.log(`[Scraper] Starting batch scrape for ${slugs.length} matches...`);
    browser = await puppeteer.launch(env.BROWSER);
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    // 2. Perform Single Login
    console.log(`[Scraper] Logging into Practiscore...`);
    await page.goto("https://practiscore.com/login", { waitUntil: "domcontentloaded" });
    await page.type("input[name='email']", env.PS_USERNAME);
    await page.type("input[name='password']", env.PS_PASSWORD);
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
      page.click("button[type='submit']")
    ]);

    // 3. Iterate through each match in the SAME browser session
    for (const slug of slugs) {
      try {
        console.log(`[Scraper] Scraping ${slug}...`);
        await page.goto(`https://practiscore.com/${slug}/register`, { waitUntil: 'domcontentloaded' });
        
        const data = await page.evaluate(() => {
          const alerts = Array.from(document.querySelectorAll('.alert-info'));
          const target = alerts.find(a => /spot|remain|full|waitlist/i.test(a.innerText));
          return target ? target.innerText.replace(/×/g, '').trim() : "Registration Info Not Found";
        });

        const result = {
          slug,
          spotsText: data,
          success: !data.includes("Not Found"),
          scrapedAt: new Date().toISOString()
        };

        // 4. Cache in KV Database for 24 hours
        await env.MATCH_DATA.put(slug, JSON.stringify(result), { expirationTtl: 86400 });
        console.log(`[Scraper] Cached ${slug}: ${data}`);
      } catch (err) {
        console.error(`[Scraper] Failed ${slug}: ${err.message}`);
      }
    }
  } catch (err) {
    console.error(`[Scraper] Fatal Batch Error: ${err.message}`);
  } finally {
    if (browser) await browser.close();
  }
}
