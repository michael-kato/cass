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

// Fetch the list of practiscoreSlugs from the live site's events.json.
// Returns an array of slug strings (nulls filtered out).
async function fetchSlugsFromEvents(env) {
  const url = `${env.SITE_URL}/assets/events.json`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const events = await res.json();
    return events
      .map(e => e.practiscoreSlug)
      .filter(Boolean);
  } catch (err) {
    console.error('Failed to fetch events.json:', err.message);
    return [];
  }
}

export default {
  // ── Cron trigger — runs on schedule defined in wrangler.toml ──
  async scheduled(event, env, ctx) {
    ctx.waitUntil(scrapeAll(env));
  },

  // ── HTTP trigger ──
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

    // Manual trigger: /scrape-all re-fetches slugs from events.json and scrapes
    if (url.pathname === '/scrape-all') {
      ctx.waitUntil(scrapeAll(env));
      return new Response('Scrape triggered', { status: 202 });
    }

    return new Response('CASS Scraper Worker', { status: 200 });
  }
};

// ── Scrape all matches with a practiscoreSlug in events.json ──
async function scrapeAll(env) {
  const slugs = await fetchSlugsFromEvents(env);
  console.log(`Scraping ${slugs.length} matches:`, slugs);

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

    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );

    await page.goto(url, {
      waitUntil: 'networkidle2',
      timeout: 30000,
    });

    const alerts = await page.$$eval(
      '.alert.alert-info.centerText',
      els => els.map(el => el.innerText.trim())
    );

    console.log('Alert elements found:', alerts);

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

    await env.MATCH_DATA.put(slug, JSON.stringify(result), {
      expirationTtl: 60 * 60,
    });

    return result;
  } finally {
    if (browser) await browser.close();
  }
}
