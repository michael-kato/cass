// CASS Practiscore Scraper (Final Production Version)
// Ultra-Lean ID-Based Logic
import puppeteer from "@cloudflare/puppeteer";

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(scrapeAllMatches(env));
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // GET /data?id=... (Fetch cached result)
    if (url.pathname === '/data') {
      const matchId = url.searchParams.get('id');
      if (!matchId) return new Response('Missing ?id=', { status: 400 });
      const cached = await env.MATCH_DATA.get(matchId);
      return new Response(cached || JSON.stringify({ error: "No data cached for this ID." }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    // GET /scrape?id=... (On-demand live scrape)
    if (url.pathname === '/scrape') {
      const matchId = url.searchParams.get('id');
      if (!matchId) return new Response('Missing ?id=', { status: 400 });
      
      const result = await scrapeSingleId(env, matchId);
      return new Response(JSON.stringify(result, null, 2), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    // GET /test (Scrape only the FIRST match found in the TOML)
    if (url.pathname === '/test') {
      const ids = await fetchIdsFromSite(env);
      if (ids.length === 0) return new Response('No match IDs found in events.toml', { status: 404 });
      
      const result = await scrapeSingleId(env, ids[0]);
      return new Response(JSON.stringify(result, null, 2), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    // GET /scrape-all (Manual Batch Trigger)
    if (url.pathname === '/scrape-all') {
      ctx.waitUntil(scrapeAllMatches(env));
      return new Response('Batch scrape job started...', { status: 202 });
    }

    // GET /debug-sources (Check what IDs are being pulled)
    if (url.pathname === '/debug-sources') {
      const ids = await fetchIdsFromSite(env);
      return new Response(JSON.stringify({
        count: ids.length,
        ids: ids
      }, null, 2), { headers: { 'Content-Type': 'application/json' } });
    }

    return new Response('CASS Scraper API. Endpoints: /data, /scrape, /test, /debug-sources', { status: 200 });
  }
};

async function fetchIdsFromSite(env) {
  try {
    const response = await fetch(`${env.SITE_URL}/assets/events.toml`);
    const text = await response.text();
    
    // Regex: Matches top-level 'id = "..."' (ignoring venueId)
    // In your TOML, match IDs come immediately after [[events]]
    const regex = /\[\[events\]\]\s*id\s*=\s*"([^"]+)"/g;
    const ids = [];
    let match;
    while ((match = regex.exec(text)) !== null) {
      if (!ids.includes(match[1])) ids.push(match[1]);
    }
    return ids;
  } catch (err) {
    console.error('[Scraper] Failed to fetch TOML:', err.message);
    return [];
  }
}

function buildUrl(matchId) {
  return `https://practiscore.com/${matchId}/register`;
}

async function scrapeAllMatches(env) {
  const ids = await fetchIdsFromSite(env);
  if (ids.length === 0) {
    console.log("[Scraper] No IDs found to scrape.");
    return;
  }

  let browser;
  try {
    browser = await puppeteer.launch(env.BROWSER);
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    // Login
    await page.goto("https://practiscore.com/login", { waitUntil: "domcontentloaded" });
    await page.type("input[name='email']", env.PS_USERNAME);
    await page.type("input[name='password']", env.PS_PASSWORD);
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
      page.click("button[type='submit']")
    ]);

    for (const id of ids) {
      try {
        console.log(`[Scraper] Processing ${id}...`);
        await page.goto(buildUrl(id), { waitUntil: 'domcontentloaded' });
        
        const data = await page.evaluate(() => {
          const alerts = Array.from(document.querySelectorAll('.alert-info'));
          const target = alerts.find(a => /spot|remain|full|waitlist/i.test(a.innerText));
          return target ? target.innerText.replace(/×/g, '').trim() : "Registration Info Not Found";
        });

        const result = {
          matchId: id,
          spotsText: data,
          success: !data.includes("Not Found"),
          scrapedAt: new Date().toISOString()
        };

        await env.MATCH_DATA.put(id, JSON.stringify(result));
      } catch (err) {
        console.error(`[Scraper] Failed ${id}: ${err.message}`);
      }
    }
  } catch (err) {
    console.error(`[Scraper] Batch Error: ${err.message}`);
  } finally {
    if (browser) await browser.close();
  }
}

async function scrapeSingleId(env, matchId) {
  let browser;
  try {
    browser = await puppeteer.launch(env.BROWSER);
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    await page.goto("https://practiscore.com/login", { waitUntil: "domcontentloaded" });
    await page.type("input[name='email']", env.PS_USERNAME);
    await page.type("input[name='password']", env.PS_PASSWORD);
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
      page.click("button[type='submit']")
    ]);

    await page.goto(buildUrl(matchId), { waitUntil: 'domcontentloaded' });
    const data = await page.evaluate(() => {
      const alerts = Array.from(document.querySelectorAll('.alert-info'));
      const target = alerts.find(a => /spot|remain|full|waitlist/i.test(a.innerText));
      return target ? target.innerText.replace(/×/g, '').trim() : "Registration Info Not Found";
    });

    const result = {
      matchId,
      spotsText: data,
      success: !data.includes("Not Found"),
      scrapedAt: new Date().toISOString()
    };

    await env.MATCH_DATA.put(matchId, JSON.stringify(result));
    return result;
  } catch (err) {
    return { error: err.message, success: false };
  } finally {
    if (browser) await browser.close();
  }
}
