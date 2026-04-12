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

    if (url.pathname === '/sessions') {
      const sessions = await puppeteer.sessions(env.BROWSER);
      return new Response(JSON.stringify(sessions, null, 2), { headers: { 'Content-Type': 'application/json' } });
    }

    if (url.pathname === '/clear-sessions') {
      const sessions = await puppeteer.sessions(env.BROWSER);
      await clearDeadSessions(env);
      return new Response(`Cleared ${sessions.length} session(s).`, { status: 200 });
    }

    // GET /debug-sources
    if (url.pathname === '/debug-sources') {
      const resolvedIds = await fetchIdsFromSite(env);
      return new Response(JSON.stringify({
        resolvedIds,
        resolvedCount: resolvedIds.length,
        resolvedVia: env.CASS_SITE ? 'service-binding' : resolvedIds.length > 0 ? 'TEST_IDS' : 'none'
      }, null, 2), { headers: { 'Content-Type': 'application/json' } });
    }

    const origin = new URL(request.url).origin;
    return new Response(`<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>CASS Scraper</title><style>
  body { font-family: monospace; background: #0f1117; color: #c9d1d9; padding: 2rem; }
  h2 { color: #58a6ff; margin-bottom: 1rem; }
  ul { list-style: none; padding: 0; }
  li { margin: 0.5rem 0; }
  a { color: #79c0ff; text-decoration: none; }
  a:hover { text-decoration: underline; }
  .dim { color: #6e7681; margin-left: 1rem; }
</style></head>
<body>
  <h2>CASS Scraper API</h2>
  <ul>
    <li><a href="${origin}/debug-sources">/debug-sources</a> <span class="dim">- verify TOML fetch &amp; ID extraction</span></li>
    <li><a href="${origin}/test">/test</a> <span class="dim">- scrape first match (one and done)</span></li>
    <li><a href="${origin}/scrape-all">/scrape-all</a> <span class="dim">- trigger full batch scrape in background</span></li>
    <li><a href="${origin}/data?id=pcsl-two-gun-at-pha-3">/data?id=...</a> <span class="dim">- fetch cached result for a match</span></li>
    <li><a href="${origin}/scrape?id=pcsl-two-gun-at-pha-3">/scrape?id=...</a> <span class="dim">- on-demand live scrape for a match</span></li>
    <li><a href="${origin}/sessions">/sessions</a> <span class="dim">- inspect active browser sessions</span></li>
    <li><a href="${origin}/clear-sessions">/clear-sessions</a> <span class="dim">- kill hung browser sessions</span></li>
  </ul>
</body></html>`, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });

  }
};

async function fetchIdsFromSite(env) {
  // Production: uses CASS_SITE service binding (direct Worker-to-Worker).
  // Local dev: service binding unavailable, falls back to TEST_IDS in .dev.vars.
  if (env.CASS_SITE) {
    try {
      const response = await env.CASS_SITE.fetch(new Request('https://cass/assets/events.toml'));
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const text = await response.text();

      const regex = /\[\[events\]\]\s*id\s*=\s*"([^"]+)"/g;
      const ids = [];
      let match;
      while ((match = regex.exec(text)) !== null) {
        if (!ids.includes(match[1])) ids.push(match[1]);
      }
      if (ids.length > 0) return ids;
      throw new Error('No IDs found in TOML');
    } catch (err) {
      console.warn(`[Scraper] Service binding fetch failed: ${err.message}`);
    }
  }

  // Fallback for local dev
  if (env.TEST_IDS) {
    console.warn('[Scraper] Using TEST_IDS fallback (local dev mode).');
    return env.TEST_IDS.split(',').map(s => s.trim()).filter(Boolean);
  }

  console.error('[Scraper] No CASS_SITE binding and no TEST_IDS set. Cannot fetch match IDs.');
  return [];
}


async function clearDeadSessions(env) {
  try {
    const sessions = await puppeteer.sessions(env.BROWSER);
    for (const s of sessions) {
      try {
        const b = await puppeteer.connect(env.BROWSER, s.sessionId);
        await b.close();
      } catch (_) { /* already dead */ }
    }
    if (sessions.length > 0) console.log(`[Scraper] Cleared ${sessions.length} stale session(s).`);
  } catch (_) { /* ignore */ }
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
    await clearDeadSessions(env);
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
    await clearDeadSessions(env);
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
