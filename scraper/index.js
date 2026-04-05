// scraper-worker/index.js
// Cloudflare Worker with Browser Rendering + KV storage
// Deploys separately from the main static site
//
// Setup:
//   1. npm install wrangler --save-dev
//   2. Create KV namespace: npx wrangler kv namespace create MATCH_DATA
//   3. Add the KV namespace ID to wrangler.toml
//   4. Set EVENTS in wrangler.toml (list of matches to scrape)
//   5. Deploy: npx wrangler deploy

import puppeteer from "@cloudflare/puppeteer";

export default {
  // ── Cron trigger — runs on schedule defined in wrangler.toml ──
  async scheduled(event, env, ctx) {
    ctx.waitUntil(scrapeAll(env));
  },

  // ── HTTP trigger — call /scrape?slug=match-slug to trigger manually ──
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/scrape') {
      const slug = url.searchParams.get('slug');
      if (!slug) return new Response('Missing ?slug=', { status: 400 });

      const result = await scrapeMatch(env, slug);
      return new Response(JSON.stringify(result, null, 2), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (url.pathname === '/data') {
      // Return all stored match data — called by the CASS site
      const slug = url.searchParams.get('slug');
      if (slug) {
        const val = await env.MATCH_DATA.get(slug);
        if (!val) return new Response('Not found', { status: 404 });
        return new Response(val, {
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          }
        });
      }

      // Return all slugs and their data
      const list = await env.MATCH_DATA.list();
      const all = {};
      for (const key of list.keys) {
        const val = await env.MATCH_DATA.get(key.name);
        if (val) all[key.name] = JSON.parse(val);
      }
      return new Response(JSON.stringify(all, null, 2), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        }
      });
    }

    return new Response('CASS Scraper Worker', { status: 200 });
  }
};

// ── Scrape all matches listed in env.MATCH_SLUGS ──
async function scrapeAll(env) {
  const slugs = JSON.parse(env.MATCH_SLUGS || '[]');
  console.log(`Scraping ${slugs.length} matches...`);

  for (const slug of slugs) {
    try {
      await scrapeMatch(env, slug);
    } catch (err) {
      console.error(`Failed to scrape ${slug}:`, err.message);
    }
  }
}

// ── Scrape a single match registration page ──
async function scrapeMatch(env, slug) {
  const url = `https://practiscore.com/${slug}/register`;
  console.log(`Scraping: ${url}`);

  let browser;
  try {
    browser = await puppeteer.launch(env.BROWSER);

    const page = await browser.newPage();

    // Set a realistic user agent
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );

    await page.goto(url, {
      waitUntil: 'networkidle2',
      timeout: 30000,
    });

    // Extract all alert-info elements and their text
    const alerts = await page.$$eval(
      '.alert.alert-info.centerText',
      els => els.map(el => el.innerText.trim())
    );

    console.log('Alert elements found:', alerts);

    // Look for the one containing spots/registration info
    // Practiscore typically says something like "X spots remaining" or "X of Y registered"
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

    // Store in KV with 6 hour TTL
    await env.MATCH_DATA.put(slug, JSON.stringify(result), {
      expirationTtl: 60 * 60 * 6,
    });

    console.log(`Stored result for ${slug}:`, spotsText);
    return result;

  } catch (err) {
    const result = {
      slug,
      url,
      spotsText: null,
      error: err.message,
      scrapedAt: new Date().toISOString(),
      success: false,
    };

    // Store the error too so the site knows the last attempt failed
    await env.MATCH_DATA.put(slug, JSON.stringify(result), {
      expirationTtl: 60 * 60,
    });

    return result;
  } finally {
    if (browser) await browser.close();
  }
}
