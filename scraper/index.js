import puppeteer from "@cloudflare/puppeteer";
import { AsyncLocalStorage } from 'node:async_hooks';

const logStorage = new AsyncLocalStorage();

// Overload console.log and console.warn globally for this worker
const originalLog = console.log;
const originalWarn = console.warn;

console.log = (...args) => {
  const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ');
  originalLog(msg);
  const stream = logStorage.getStore();
  if (stream) stream(msg);
};

console.warn = (...args) => {
  const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ');
  originalWarn(`[WARN] ${msg}`);
  const stream = logStorage.getStore();
  if (stream) stream(`⚠️ ${msg}`);
};

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
      const { readable, writable } = new TransformStream();
      const writer = writable.getWriter();
      const encoder = new TextEncoder();
      const streamWriter = (msg) => writer.write(encoder.encode(msg + '\n'));

      ctx.waitUntil(logStorage.run(streamWriter, async () => {
        try {
          console.log('--- Starting Global Streamed Test Scrape ---');
          const ids = await fetchIdsFromSite(env);
          if (ids.length === 0) {
            console.warn('No IDs found in events.toml');
          } else {
            await scrapeSingleId(env, ids[0]);
            console.log('--- Scrape Finished ---');
          }
        } catch (err) {
          console.log(`!!! FATAL ERROR: ${err.message}`);
        } finally {
          writer.close();
        }
      }));

      return new Response(readable, {
        headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Access-Control-Allow-Origin': '*' }
      });
    }

    // GET /scrape-all (Manual Batch Trigger)
    if (url.pathname === '/scrape-all') {
      console.log('[Scraper] Triggered /scrape-all endpoint');
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

    if (url.pathname === '/debug-browser') {
      try {
        console.log('[Debug] Launching browser...');
        const b = await puppeteer.launch(env.BROWSER);
        const p = await b.newPage();
        await p.goto('https://example.com');
        const title = await p.title();
        await b.close();
        return new Response(`Success: ${title}`, { status: 200 });
      } catch (err) {
        return new Response(`Debug Failed: ${err.message}`, { status: 500 });
      }
    }

    // GET /sync-merch (Automator for Variant IDs)
    if (url.pathname === '/sync-merch') {
      if (!env.PRINTIFY_API_KEY || !env.PRINTIFY_SHOP_ID) {
        return new Response('Missing PRINTIFY_API_KEY or PRINTIFY_SHOP_ID in scraper secrets.', { status: 500 });
      }

      try {
        const res = await fetch(`https://api.printify.com/v1/shops/${env.PRINTIFY_SHOP_ID}/products.json?limit=100`, {
          headers: { 'Authorization': `Bearer ${env.PRINTIFY_API_KEY}` }
        });
        if (!res.ok) throw new Error(`Printify Error: ${res.status}`);
        const data = await res.json();

        let tomlOutput = "# PRINTIFY VARIANT MAPPING (Copy-paste these sections into merch.toml)\n\n";
        
        // Use the actual 'data' property in Printify's response
        const products = data.data || [];
        
        products.forEach(p => {
          tomlOutput += `### PRODUCT: ${p.title} (Blueprint: ${p.blueprint_id})\n`;
          tomlOutput += `# PRODUCT_ID: ${p.id} \n`;
          tomlOutput += `printifyBlueprintId = ${p.blueprint_id}\n`;
          tomlOutput += `printifyPrintProviderId = ${p.print_provider_id}\n\n`;
          tomlOutput += `[products.variants]\n`;
          
          p.variants.forEach(v => {
            // Convert "Color / Size" to "Color-Size"
            const cleanTitle = v.title.replace(/\s*\/\s*/g, '-');
            tomlOutput += `"${cleanTitle}" = ${v.id}\n`;
          });
          tomlOutput += "\n";
        });

        return new Response(tomlOutput, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
      } catch (err) {
        return new Response(`Sync Failed: ${err.message}`, { status: 500 });
      }
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
    <li><a href="/debug-sources">/debug-sources</a> <span class="dim">- verify TOML fetch &amp; ID extraction</span></li>
    <li><a href="/test">/test</a> <span class="dim">- scrape first match (one and done)</span></li>
    <li><a href="/scrape-all">/scrape-all</a> <span class="dim">- trigger full batch scrape in background</span></li>
    <li><a href="/data?id=pcsl-two-gun-at-pha-3">/data?id=...</a> <span class="dim">- fetch cached result for a match</span></li>
    <li><a href="/scrape?id=pcsl-two-gun-at-pha-3">/scrape?id=...</a> <span class="dim">- on-demand live scrape for a match</span></li>
    <li><a href="/sessions">/sessions</a> <span class="dim">- inspect active browser sessions</span></li>
    <li><a href="/clear-sessions">/clear-sessions</a> <span class="dim">- kill hung browser sessions</span></li>
    <li><a href="/sync-merch">/sync-merch</a> <span class="dim">- GENERATE Printify TOML mapping block</span></li>
  </ul>
</body></html>`, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });

  }
};

async function fetchIdsFromSite(env) {
  console.log('[Scraper] Fetching Match IDs from main site...');
  if (!env.CASS_SITE) {
    console.error('[Scraper] Missing CASS_SITE binding. Check wrangler.toml');
    return [];
  }

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
    console.log(`[Scraper] Found ${ids.length} IDs in events.toml`);
    if (ids.length > 0) return ids;
    throw new Error('No IDs found in TOML');
  } catch (err) {
    console.error(`[Scraper] Failed to fetch IDs via service binding: ${err.message}`);
    return [];
  }
}


async function clearDeadSessions(env) {
  try {
    console.log('[Scraper] Checking for stale browser sessions...');
    const sessions = await puppeteer.sessions(env.BROWSER);
    if (sessions.length === 0) return;

    console.log(`[Scraper] Found ${sessions.length} sessions. Clearing...`);
    await Promise.all(sessions.map(async (s) => {
      try {
        const b = await puppeteer.connect(env.BROWSER, s.sessionId);
        await b.close();
      } catch (_) { /* already closed */ }
    }));
    console.log('[Scraper] Session cleanup complete.');
  } catch (err) {
    console.warn(`[Scraper] Session cleanup failed: ${err.message}`);
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
    // Temporarily disabled to avoid management API rate limits
    // await clearDeadSessions(env);
    
    await new Promise(r => setTimeout(r, 3000));
    if (!env.BROWSER) throw new Error('BROWSER binding is missing.');

    // Retry loop for the 429 Rate Limit error
    let attempts = 0;
    while (attempts < 2) {
      try {
        console.log(`[Scraper] Launching browser (Batch Attempt ${attempts + 1})...`);
        browser = await puppeteer.launch(env.BROWSER);
        break;
      } catch (err) {
        if (err.message.includes('429') && attempts === 0) {
          console.warn('[Scraper] Rate limited (429). Waiting 15 seconds before retry...');
          await new Promise(r => setTimeout(r, 15000));
          attempts++;
        } else {
          throw err;
        }
      }
    }

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    // Login
    console.log('[Scraper] Logging in for batch process...');
    await page.goto("https://practiscore.com/login", { waitUntil: "networkidle2" });
    await page.type("#user-email", env.PS_USERNAME);
    await page.type("#user-password", env.PS_PASSWORD);
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2' }),
      page.click('button[type="submit"]')
    ]);

    for (const id of ids) {
      try {
        console.log(`[Scraper] Processing ${id}...`);
        const data = await page.evaluate(() => {
          const alerts = Array.from(document.querySelectorAll('.alert-info'));
          const target = alerts.find(a =>
            /spot|remain|full|waitlist|registration opens|requires a free account/i.test(a.innerText)
          );

          if (!target) return null;
          const text = target.innerText.replace(/×/g, '').trim();
          const lower = text.toLowerCase();

          if (text.includes('requires a free account')) return { status: 'error' };
          if (lower.includes('full') || lower.includes('wait list')) return { status: 'full', remaining: 0, raw: text };
          if (lower.includes('registration opens')) return { status: 'upcoming', remaining: null, raw: text };

          const match = text.match(/(\d+)/);
          return { status: 'open', remaining: match ? parseInt(match[1], 10) : null, raw: text };
        });

        if (!data || data.status === 'error') {
          if (data?.status === 'error') throw new Error('Scraper logged out or session expired.');
          console.warn(`[Scraper] No registration info found for ${id}`);
          continue;
        }

        const result = {
          id: id,
          remaining: data.remaining,
          status: data.status,
          raw: data.raw,
          updated: new Date().toISOString()
        };

        await env.MATCH_DATA.put(id, JSON.stringify(result));
      } catch (err) {
        console.error(`[Scraper] Failed ${id}: ${err.message}`);
        if (err.message.includes('Scraper logged out')) throw err; // Stop batch if auth fails
      }
    }
  } catch (err) {
    console.error(`[Scraper] Batch Error: ${err.message}`);
  } finally {
    if (browser) await browser.close();
  }
}

async function scrapeSingleId(env, matchId) {
  console.log(`[Scraper] Starting scrape for ID: ${matchId}`);
  let browser;
  try {
    // Temporarily disabled to avoid management API rate limits
    // await clearDeadSessions(env);
    
    await new Promise(r => setTimeout(r, 3000));
    if (!env.BROWSER) throw new Error('BROWSER binding is missing.');
    try {
      console.log(`[Scraper] Launching browser (Attempt 1)...`);
      browser = await puppeteer.launch(env.BROWSER);
    } catch (err) {
      if (err.message.includes('429')) {
        console.warn('Rate limited (429). Waiting 15 seconds before retry...');
        await new Promise(r => setTimeout(r, 15000));
        console.log(`[Scraper] Launching browser (Attempt 2)...`);
        browser = await puppeteer.launch(env.BROWSER);
      } else {
        throw err;
      }
    }

    const page = await browser.newPage();
    console.log('[Scraper] Navigating to login...');
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.goto("https://practiscore.com/login", { waitUntil: "networkidle2" });
    
    console.log('[Scraper] Submitting credentials...');
    await page.type("#user-email", env.PS_USERNAME);
    await page.type("#user-password", env.PS_PASSWORD);
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2' }),
      page.click('button[type="submit"]')
    ]);

    const url = buildUrl(matchId);
    console.log(`[Scraper] Navigating to: ${url}`);
    const data = await page.evaluate(() => {
      // ... same evaluation logic ...
      const alerts = Array.from(document.querySelectorAll('.alert-info'));
      const target = alerts.find(a =>
        /spot|remain|full|waitlist|registration opens|requires a free account/i.test(a.innerText)
      );

      if (!target) return null;
      const text = target.innerText.replace(/×/g, '').trim();
      const lower = text.toLowerCase();

      if (text.includes('requires a free account')) return { status: 'error' };
      if (lower.includes('full') || lower.includes('wait list')) return { status: 'full', remaining: 0, raw: text };
      if (lower.includes('registration opens')) return { status: 'upcoming', remaining: null, raw: text };

      const match = text.match(/(\d+)/);
      return { status: 'open', remaining: match ? parseInt(match[1], 10) : null, raw: text };
    });

    if (!data || data.status === 'error') throw new Error(data?.status === 'error' ? 'Scraper logged out' : 'Data not found');

    const res = {
      id: matchId,
      remaining: data.remaining,
      status: data.status,
      raw: data.raw,
      updated: new Date().toISOString()
    };

    // Save success state
    await env.MATCH_DATA.put(matchId, JSON.stringify(res));
    return res;
  } catch (err) {
    console.error(`[Scraper] Fatal error for ${matchId}:`, err.message);
    throw err;
  } finally {
    if (browser) await browser.close();
  }
}
