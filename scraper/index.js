// scraper-worker/index.js
// Cloudflare Worker with Browser Rendering + KV storage
//
// Slugs are now fetched dynamically from the live site's assets/events.json
// instead of being hardcoded in wrangler.toml. Set SITE_URL in wrangler.toml.
//
// Setup:
//   1. npm install wrangler --save-dev
//   2. Create KV namespace: npx wrangler kv namespace create MATCH_DATA
//   3. Add the KV namespace ID to wrangler.toml
//   4. Set SITE_URL in wrangler.toml [vars]
//   5. Deploy: npx wrangler deploy

import puppeteer from "@cloudflare/puppeteer";

export default {
  // ── HTTP trigger for debugging ──
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/scrape') {
      const slug = url.searchParams.get('slug');
      if (!slug) return new Response('Missing ?slug= parameter', { status: 400 });

      const result = await scrapeMatch(env, slug);
      let htmlResponse = `
        <h3>Scrape Results for: ${slug}</h3>
        <p><strong>Spots Extracted:</strong> ${result.spotsText || 'Not Found'}</p>
        <p><strong>Success Status:</strong> ${result.success}</p>
        <pre>${JSON.stringify(result, null, 2)}</pre>
      `;
      
      return new Response(htmlResponse, {
        headers: { 'Content-Type': 'text/html' }
      });
    }

    return new Response('CASS Scraper API. Hit /scrape?slug=pcsl-one-gun-low-light to test.', { status: 200 });
  }
};

// ── Scrape a single match registration page via Puppeteer ──
async function scrapeMatch(env, slug) {
  const url = `https://practiscore.com/${slug}/register`;
  console.log(`[Scraper] Initializing trace for: ${slug}`);
  console.log(`[Scraper] Target URL: ${url}`);

  let browser;
  try {
    console.log(`[Scraper] Attempting to lease remote Chromium session...`);
    browser = await puppeteer.launch(env.BROWSER);
    console.log(`[Scraper] Browser session launched. Opening isolated tab...`);

    const page = await browser.newPage();
    console.log(`[Scraper] Spoofing user agent headers...`);
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );

    console.log(`[Scraper] Redirecting to Portal Authentication...`);
    await page.goto("https://practiscore.com/login", { waitUntil: "domcontentloaded" });

    // Validate that the user actually supplied local secrets via .dev.vars
    if (!env.PS_USERNAME || !env.PS_PASSWORD) {
        throw new Error("Missing Practiscore Auth Secrets (PS_USERNAME / PS_PASSWORD)");
    }

    console.log(`[Scraper] Injecting portal credentials...`);
    await page.type("input[type='email'], input[name='email']", env.PS_USERNAME);
    await page.type("input[type='password'], input[name='password']", env.PS_PASSWORD);
    
    await Promise.all([
        page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
        page.click("button[type='submit']")
    ]);
    console.log(`[Scraper] Auth payload submitted successfully.`);

    console.log(`[Scraper] Executing navigation routing to Match Page. Waiting for DOM load...`);
    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    console.log(`[Scraper] DOM acquired successfully! Searching for availability alerts...`);

    const alerts = await page.$$eval(
      '.alert.alert-info.centerText',
      els => els.map(el => el.innerText.trim())
    );

    console.log(`[Scraper] Document extraction complete. Found ${alerts.length} potential alert nodes.`);

    const spotsText = alerts.find(text =>
      /spot|register|remain|full|waitlist/i.test(text)
    ) || alerts[0] || null;

    const result = {
      slug,
      url,
      spotsText,
      allAlerts: alerts,
      scrapedAt: new Date().toISOString(),
      success: true,
    };

    console.log(`[Scraper] Live Regex Result -> ${spotsText || 'NULL'}`);
    return result;

  } catch (err) {
    console.error(`[Scraper] FATAL ENGINE CRASH: ${err.message}`);
    return {
      slug,
      url,
      spotsText: null,
      error: err.message,
      scrapedAt: new Date().toISOString(),
      success: false,
    };
  } finally {
    if (browser) {
       console.log(`[Scraper] Tearing down tab and closing headless Chromium connection...`);
       await browser.close();
       console.log(`[Scraper] Teardown complete. Exiting.`);
    }
  }
}
