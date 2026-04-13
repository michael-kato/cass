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
          // Bypass browser buffering (send 1KB of whitespace)
          await writer.write(encoder.encode(' '.repeat(1024) + '\n'));
          
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
          await writer.close();
        }
      }));

      return new Response(readable, {
        headers: { 
          'Content-Type': 'text/plain; charset=utf-8', 
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'X-Content-Type-Options': 'nosniff',
          'Access-Control-Allow-Origin': '*' 
        }
      });
    }

    if (url.pathname === '/scrape-all') {
      console.log('[Scraper] Triggered /scrape-all endpoint');
      ctx.waitUntil(scrapeAllMatches(env));
      return new Response('Batch scrape job started...', { status: 202 });
    }

    if (url.pathname === '/sessions') {
      const sessions = await puppeteer.sessions(env.MYBROWSER);
      return new Response(JSON.stringify(sessions, null, 2), { headers: { 'Content-Type': 'application/json' } });
    }

    if (url.pathname === '/clear-sessions') {
      const sessions = await puppeteer.sessions(env.MYBROWSER);
      await clearDeadSessions(env);
      return new Response(`Cleared ${sessions.length} session(s).`, { status: 200 });
    }

    if (url.pathname === '/debug-browser') {
      try {
        console.log('[Debug] Diagnostic Start');
        console.log('--- Binding Status ---');
        console.log('BROWSER exists:', !!env.MYBROWSER);
        console.log('BROWSER type:', typeof env.MYBROWSER);

        console.log('[Debug] Attempting Launch (60s timeout)...');
        const b = await puppeteer.launch(env.MYBROWSER, { protocolTimeout: 60000 });

        console.log('[Debug] Browser Acquired. ID:', b.connected ? 'Connected' : 'Disconnected');
        const p = await b.newPage();
        await p.goto('https://example.com');
        const title = await p.title();
        await b.close();

        return new Response(`Success: ${title}`, { status: 200 });
      } catch (err) {
        const fullError = JSON.stringify(err, Object.getOwnPropertyNames(err), 2);
        console.error(`[Debug] FATAL LAUNCH ERROR:\n${fullError}`);
        return new Response(`Debug Failed: ${err.message}\n\nCheck logs for full trace.`, {
          status: 500,
          headers: { 'Content-Type': 'text/plain' }
        });
      }
    }

    if (url.pathname === '/history') {
      const history = await puppeteer.history(env.MYBROWSER);
      return new Response(JSON.stringify(history, null, 2), { headers: { 'Content-Type': 'application/json' } });
    }

    if (url.pathname === '/limits') {
      const limits = await puppeteer.limits(env.MYBROWSER);
      return new Response(JSON.stringify(limits, null, 2), { headers: { 'Content-Type': 'application/json' } });
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

    return new Response(`<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>CASS Scraper Dashboard</title><style>
  body { font-family: -apple-system, blinkmacsystemfont, 'Segoe UI', roboto, sans-serif; background: #0d1117; color: #c9d1d9; padding: 2rem; max-width: 800px; margin: 0 auto; }
  h2 { color: #58a6ff; border-bottom: 1px solid #30363d; padding-bottom: 0.5rem; margin-top: 2rem; }
  h3 { color: #8b949e; font-size: 0.9rem; text-transform: uppercase; letter-spacing: 0.05rem; margin-top: 2rem; }
  ul { list-style: none; padding: 0; }
  li { margin: 0.75rem 0; padding: 0.5rem; background: #161b22; border-radius: 6px; border: 1px solid #30363d; transition: border-color 0.2s; }
  li:hover { border-color: #58a6ff; }
  a { color: #79c0ff; text-decoration: none; font-weight: bold; font-family: monospace; }
  a:hover { text-decoration: underline; }
  .dim { color: #6e7681; margin-left: 0.5rem; font-size: 0.9rem; }
  .badge { background: #238636; color: white; padding: 2px 6px; border-radius: 12px; font-size: 0.7rem; vertical-align: middle; margin-left: 5px; }
  .warn { background: #9e6a03; }
</style></head>
<body>
  <h2>CASS Scraper Dashboard</h2>

  <h3>Scraper Control</h3>
  <ul>
    <li><a href="/test">/test</a> <span class="dim">Run one-off scrape for first match (returns text log)</span></li>
    <li><a href="/scrape-all">/scrape-all</a> <span class="dim">Trigger background batch scrape of all matches</span></li>
    <li><a href="/debug-sources">/debug-sources</a> <span class="dim">Verify ID extraction from events.toml</span></li>
  </ul>

  <h3>Browser Diagnostics</h3>
  <ul>
    <li><a href="/debug-browser">/debug-browser</a> <span class="badge">TEST</span> <span class="dim">Open example.com to verify Puppeteer connectivity</span></li>
    <li><a href="/sessions">/sessions</a> <span class="dim">List currently active browser sessions</span></li>
    <li><a href="/history">/history</a> <span class="dim">Session history (last 100, open and closed)</span></li>
    <li><a href="/limits">/limits</a> <span class="dim">Check concurrency and rate limits</span></li>
    <li><a href="/clear-sessions">/clear-sessions</a> <span class="badge warn">FORCE</span> <span class="dim">Kill all hung sessions immediately</span></li>
  </ul>

  <h3>Data &amp; Tools</h3>
  <ul>
    <li><a href="/data?id=pcsl-two-gun-at-pha-3">/data?id=...</a> <span class="dim">Fetch cached data for a specific match ID</span></li>
    <li><a href="/scrape?id=pcsl-two-gun-at-pha-3">/scrape?id=...</a> <span class="dim">Perform on-demand live scrape for one match</span></li>
    <li><a href="/sync-merch">/sync-merch</a> <span class="dim">Generate variant mapping TOML from Printify API</span></li>
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
    const sessions = await puppeteer.sessions(env.MYBROWSER);
    if (!sessions || sessions.length === 0) return;

    console.log(`[Scraper] Found ${sessions.length} sessions. Clearing...`);
    await Promise.allSettled(sessions.map(async (s) => {
      try {
        if (s.sessionId) {
          const b = await puppeteer.connect(env.MYBROWSER, s.sessionId);
          await b.close();
        }
      } catch (_) { /* already closed or inaccessible */ }
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
    browser = await puppeteer.launch(env.MYBROWSER, { protocolTimeout: 60000 });

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    // Login
    console.log('[Scraper] Navigating to login...');
    await page.goto("https://practiscore.com/login", { waitUntil: "networkidle2" });
    
    // Check for bot challenges
    const title = await page.title();
    console.log(`[Scraper] Login Page Title: ${title}`);
    if (title.includes('Cloudflare') || title.includes('Challenge')) {
      throw new Error(`Bot challenge detected: ${title}`);
    }

    console.log('[Scraper] Waiting for login form...');
    await page.waitForSelector("#user-email", { timeout: 15000 });
    
    console.log('[Scraper] Submitting credentials...');
    await page.type("#user-email", env.PS_USERNAME, { delay: 50 });
    await page.type("#user-password", env.PS_PASSWORD, { delay: 50 });
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
    browser = await puppeteer.launch(env.MYBROWSER, { protocolTimeout: 60000 });

    const page = await browser.newPage();
    console.log('[Scraper] Navigating to login...');
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.goto("https://practiscore.com/login", { waitUntil: "networkidle2" });

    const title = await page.title();
    console.log(`[Scraper] Login Page Title: ${title}`);
    if (title.includes('Cloudflare') || title.includes('Challenge')) {
      throw new Error(`Bot challenge detected: ${title}`);
    }

    console.log('[Scraper] Waiting for login form...');
    await page.waitForSelector("#user-email", { timeout: 15000 });

    console.log('[Scraper] Submitting credentials...');
    await page.type("#user-email", env.PS_USERNAME, { delay: 50 });
    await page.type("#user-password", env.PS_PASSWORD, { delay: 50 });
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
