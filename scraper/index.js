import puppeteer from "@cloudflare/puppeteer";
import { AsyncLocalStorage } from 'node:async_hooks';

const logStorage = new AsyncLocalStorage();

// Overload console.log and console.warn globally for this worker
const originalLog = console.log;
const originalWarn = console.warn;

console.log = (...args) => {
  const ts = new Date().toISOString().split('T')[1].split('.')[0];
  const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ');
  const finalMsg = `[${ts}] ${msg}`;
  originalLog(finalMsg);
  const stream = logStorage.getStore();
  if (stream) stream(finalMsg);
};

console.warn = (...args) => {
  const ts = new Date().toISOString().split('T')[1].split('.')[0];
  const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ');
  const finalMsg = `[${ts}] ⚠️ ${msg}`;
  originalWarn(finalMsg);
  const stream = logStorage.getStore();
  if (stream) stream(finalMsg);
};

// Helper for real-time streaming logs in the browser
async function streamedResponse(ctx, logStorage, action) {
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  const streamWriter = (msg) => writer.write(encoder.encode(msg + '\n'));

  ctx.waitUntil(logStorage.run(streamWriter, async () => {
    try {
      // Bypass browser buffering (send 1KB of whitespace)
      await writer.write(encoder.encode(' '.repeat(1024) + '\n'));
      await action();
    } catch (err) {
      console.log(`\n!!! FATAL ERROR: ${err.message}`);
      console.log(err.stack || '');
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

      return streamedResponse(ctx, logStorage, async () => {
        console.log(`--- Live Scrape: ${matchId} ---`);
        const result = await scrapeSingleId(env, matchId);
        console.log(`\nSuccess! Status: ${result.status} | Raw: ${result.raw}`);
      });
    }

    // GET /test (Scrape only the FIRST match found in the TOML)
    if (url.pathname === '/test') {
      return streamedResponse(ctx, logStorage, async () => {
        console.log('--- Starting Global Streamed Test Scrape ---');
        const ids = await fetchIdsFromSite(env);
        if (ids.length === 0) {
          console.warn('No IDs found in events.toml');
        } else {
          const id = ids[Math.floor(Math.random() * ids.length)];
          console.log(`[Scraper] Random test match: ${id}`);
          await scrapeSingleId(env, id);
          console.log('\n--- Test Run Complete ---');
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
      return streamedResponse(ctx, logStorage, async () => {
        console.log('--- Browser Diagnostic Start ---');
        console.log(`Binding (MYBROWSER) type: ${typeof env.MYBROWSER}`);
        console.log('Attempting launch...');

        const b = await puppeteer.launch(env.MYBROWSER, { protocolTimeout: 60000 });
        console.log(`Browser acquired: ${b.connected}`);

        const page = await b.newPage();
        await applyStealth(page);
        console.log('Stealth applied. Navigating to example.com...');

        await page.goto('https://example.com');
        const title = await page.title();
        console.log(`Success! Page title: ${title}`);

        await b.close();
        console.log('--- Diagnostic Complete ---');
      });
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

      return streamedResponse(ctx, logStorage, async () => {
        console.log('--- Printify Sync Start ---');
        const res = await fetch(`https://api.printify.com/v1/shops/${env.PRINTIFY_SHOP_ID}/products.json?limit=100`, {
          headers: { 'Authorization': `Bearer ${env.PRINTIFY_API_KEY}` }
        });
        if (!res.ok) throw new Error(`Printify Error: ${res.status}`);
        const data = await res.json();

        let tomlOutput = "# PRINTIFY VARIANT MAPPING (Copy-paste these sections into merch.toml)\n\n";
        const products = data.data || [];

        products.forEach(p => {
          tomlOutput += `### PRODUCT: ${p.title} (Blueprint: ${p.blueprint_id})\n`;
          tomlOutput += `# PRODUCT_ID: ${p.id} \n`;
          tomlOutput += `printifyBlueprintId = ${p.blueprint_id}\n`;
          tomlOutput += `printifyPrintProviderId = ${p.print_provider_id}\n\n`;
          tomlOutput += `[products.variants]\n`;
          p.variants.forEach(v => {
            const cleanTitle = v.title.replace(/\s*\/\s*/g, '-');
            tomlOutput += `"${cleanTitle}" = ${v.id}\n`;
          });
          tomlOutput += "\n";
        });

        console.log(tomlOutput);
        console.log('\n--- Sync Complete ---');
      });
    }

    // GET /debug-view
    if (url.pathname === '/debug-view') {
      const debugData = await env.MATCH_DATA.get('DEBUG_LAST_RUN', { type: 'json' });
      if (!debugData) return new Response('No debug data found. Run /test first.', { status: 404 });

      let html = `<html><head><title>Visual Debugger</title><style>
        body { font-family: sans-serif; background: #1a1a1a; color: #eee; padding: 2rem; }
        .step { background: #2a2a2a; padding: 1rem; margin-bottom: 2rem; border-radius: 8px; border: 1px solid #444; }
        img { max-width: 100%; border: 1px solid #555; margin-top: 1rem; }
        pre { background: #000; padding: 1rem; overflow: auto; max-height: 300px; font-size: 12px; }
        h2 { color: #4ade80; }
      </style></head><body><h1>Latest Scrape Diagnostics</h1>`;

      for (const step of debugData) {
        html += `<div class="step">
          <h2>Step: ${step.name}</h2>
          <p>URL: ${step.url} | Time: ${step.time}</p>
          <img src="data:image/png;base64,${step.screenshot}" />
          <h3>HTML Snippet</h3>
          <pre>${step.html.substring(0, 5000).replace(/</g, '&lt;')}</pre>
        </div>`;
      }

      html += '</body></html>';
      return new Response(html, { headers: { 'Content-Type': 'text/html' } });
    }

    // GET /view-html?url=...
    if (url.pathname === '/view-html') {
      const targetUrl = url.searchParams.get('url');
      if (!targetUrl) return new Response('Missing ?url=', { status: 400 });

      let browser;
      try {
        browser = await puppeteer.launch(env.MYBROWSER, { protocolTimeout: 60000 });
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36');
        await page.goto(targetUrl, { waitUntil: 'networkidle2' });
        const content = await page.content();
        await browser.close();
        return new Response(content, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      } catch (err) {
        if (browser) await browser.close();
        return new Response(`Error: ${err.message}`, { status: 500 });
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
    <li><a href="/debug-view">/debug-view</a> <span class="badge">VISION</span> <span class="dim">See screenshots & HTML from last test run</span></li>
    <li><a href="/view-html?url=https://practiscore.com/login">/view-html?url=...</a> <span class="badge">DEBUG</span> <span class="dim">See raw HTML of any page via Puppeteer</span></li>
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

async function captureDebug(env, page, name, debugList) {
  try {
    console.log(`[Debug] Capturing state: ${name}...`);
    // Full page screenshot for context
    const screenshot = await page.screenshot({ encoding: 'base64', fullPage: true });
    const html = await page.content();
    const url = page.url();
    debugList.push({ name, url, screenshot, html, time: new Date().toISOString() });
    await env.MATCH_DATA.put('DEBUG_LAST_RUN', JSON.stringify(debugList));
  } catch (err) {
    console.warn(`[Debug] Capture failed for ${name}: ${err.message}`);
  }
}

async function applyStealth(page) {
  // Use a modern, consistent viewport
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });

  // Set extra headers
  await page.setExtraHTTPHeaders({
    'Accept-Language': 'en-US,en;q=0.9',
  });

  // Inject stealth script
  await page.evaluateOnNewDocument(() => {
    // Hide webdriver
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });

    // Mock traits
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    Object.defineProperty(navigator, 'platform', { get: () => 'Win32' });
    
    // WebGL Vendor/Renderer masking (NVIDIA RTX 3080)
    const getParameter = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function(parameter) {
      if (parameter === 37445) return 'Google Inc. (NVIDIA)';
      if (parameter === 37446) return 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3080 Direct3D11 vs_5_0 ps_5_0, D3D11)';
      return getParameter.apply(this, arguments);
    };

    // Canvas Fingerprinting Masking
    const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL = function(type) {
      if (type === 'image/png' && this.width === 220 && this.height === 30) {
        // Return a slightly jittered version or a known "safe" one if needed
        return originalToDataURL.apply(this, arguments);
      }
      return originalToDataURL.apply(this, arguments);
    };

    // Mock Screen consistency
    Object.defineProperty(window, 'screen', {
      get: () => ({
        width: 1920, height: 1080, availWidth: 1920, availHeight: 1040,
        colorDepth: 24, pixelDepth: 24,
      })
    });

    // Conceal vendor/renderer
    window.chrome = { runtime: {} };
    window.name = '';

    // Mock permissions
    const originalQuery = window.navigator.permissions.query;
    window.navigator.permissions.query = (parameters) => (
      parameters.name === 'notifications' ?
        Promise.resolve({ state: Notification.permission }) :
        originalQuery(parameters)
    );
  });
}

async function performLogin(page, env, debugList) {
  console.log(`[Scraper] Starting login attempt for: ${env.PS_USERNAME?.substring(0, 3)}... (length: ${env.PS_USERNAME?.length || 0})`);
  
  // Force navigate to the actual login page to ensure all auth scripts load correctly
  console.log('[Scraper] Navigating to official login page...');
  await page.goto('https://practiscore.com/login', { waitUntil: 'networkidle0', timeout: 30000 });
  
  // Diagnostic: Check if Turnstile script is even loaded
  const scriptExists = await page.evaluate(() => !!document.querySelector('script[src*="turnstile"]'));
  console.log(`[Scraper] Turnstile script tag present: ${scriptExists}`);

  const widgetExists = await page.evaluate(() => !!document.querySelector('.cf-turnstile'));
  console.log(`[Scraper] Turnstile widget container present: ${widgetExists}`);

  // Human-like signals to wake up Turnstile
  console.log('[Scraper] Sending randomized human-like signals...');
  const randX = () => Math.floor(Math.random() * 600) + 100;
  const randY = () => Math.floor(Math.random() * 600) + 100;
  
  await page.mouse.move(randX(), randY());
  await page.mouse.move(randX(), randY(), { steps: 15 });
  await page.evaluate((depth) => window.scrollBy(0, depth), Math.floor(Math.random() * 300) + 200);
  await new Promise(r => setTimeout(r, Math.floor(Math.random() * 800) + 400));
  await page.evaluate(() => window.scrollTo(0, 0));

  await captureDebug(env, page, 'Before Login Form', debugList || []);

  const userField = await page.$('input[name="username"]');
  if (!userField) {
    const buttons = await page.evaluate(() =>
      Array.from(document.querySelectorAll('button, a.btn')).map(b => `${b.tagName}: ${b.innerText.trim()}`).join(' | ')
    );
    console.warn(`[Scraper] Form not found. Available buttons: ${buttons}`);
    throw new Error(`Login form not found. Title: ${await page.title()}`);
  }

  // 1. Kill the USCCA trap/popup immediately
  await page.evaluate(() => {
    const trap = document.querySelector('#popupForm') || document.querySelector('.modal');
    if (trap) trap.remove();
  });

  console.log('[Scraper] Waiting for Turnstile iframe to load...');
  await page.waitForSelector('iframe[src*="challenges.cloudflare.com"]', { timeout: 5000 }).catch(() => {
    console.warn('[Scraper] Turnstile iframe not found (might be internal or delayed)');
  });

  await page.type('input[name="username"]', env.PS_USERNAME || '', { delay: 50 });
  await page.type('input[name="password"]', env.PS_PASSWORD || '', { delay: 50 });
  
  await page.focus('input[name="password"]');
  await captureDebug(env, page, 'Form Filled', debugList || []);

  // Deliberate human-like pause for Turnstile to react to typing
  console.log('[Scraper] Pausing for 2s (human-like behavior)...');
  await new Promise(r => setTimeout(r, 2000));
  
  // Continuously unlock the button in the background
  const unlocker = setInterval(() => {
    page.evaluate(() => {
      const btn = document.querySelector('button.btn-primary.btn-block.top3') || document.querySelector('.omb_loginForm button[type="submit"]');
      if (btn) {
        btn.removeAttribute('disabled');
        btn.style.pointerEvents = 'auto';
        btn.style.opacity = '1';
      }
    }).catch(() => {});
  }, 500);

  console.log('[Scraper] Waiting for Turnstile token...');
  try {
    await page.waitForFunction(() => {
      const token = document.querySelector('input[name="cf-turnstile-response"]')?.value;
      return token && token.length > 30;
    }, { timeout: 20000 });
    console.log('[Scraper] Turnstile solved!');
  } catch (e) {
    console.warn('[Scraper] Turnstile wait expired - attempting submission anyway.');
  }

  clearInterval(unlocker);

  // Final Diagnostic: What does the form actually look like now?
  const formHtml = await page.evaluate(() => {
    const form = document.querySelector('.omb_loginForm');
    return form ? form.outerHTML : 'Form not found';
  });
  console.log('[Scraper] Form state before click (check for tokens):', formHtml.substring(0, 1000));

  console.log('[Scraper] Submitting form via native click...');
  await page.click('button.btn-primary.btn-block.top3');

  // Wait for the form to disappear or navigation to happen
  await Promise.race([
    page.waitForNavigation({ waitUntil: 'load', timeout: 15000 }).catch(() => { }),
    page.waitForSelector('input[name="username"]', { hidden: true, timeout: 15000 }).catch(() => { })
  ]);

  // Small delay to let the results page paint
  await new Promise(r => setTimeout(r, 1000));
  await captureDebug(env, page, 'After Submission', debugList || []);

  const afterTitle = await page.title();
  const afterContent = await page.content();
  console.log(`[Scraper] Post-Submission Title: ${afterTitle}`);

  if (afterContent.includes('Invalid') || afterContent.includes('failed')) {
    throw new Error('Login failed: Invalid email or password detected on results page.');
  }

  if (afterTitle.includes('Cloudflare') || afterTitle.includes('Challenge') || afterTitle.includes('Just a moment')) {
    throw new Error(`Cloudflare/Bot challenge encountered after login: ${afterTitle}`);
  }

  // Brief wait for cookies to settle in the warm pool
  console.log('[Scraper] Waiting for session to settle...');
  await new Promise(r => setTimeout(r, 4000));

  const cookies = await page.cookies();
  const sessionExists = cookies.some(c => c.name.includes('session'));
  console.log(`[Scraper] Session Cookie Detected: ${sessionExists} (${cookies.length} total cookies)`);

  await captureDebug(env, page, 'Session Settled', debugList || []);
  console.log('[Scraper] Login step finished.');
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
    await applyStealth(page);
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36');

    for (const id of ids) {
      try {
        console.log(`[Scraper] Processing ${id}...`);
        const url = buildUrl(id);
        console.log(`[Scraper] Navigating to: ${url}`);
        await page.goto(url, { waitUntil: "networkidle2" });
        await page.waitForSelector('.alert-info, .alert-warning, .alert-danger', { timeout: 5000 }).catch(() => { });

        let content = await page.content();
        if (content.includes('requires a free account')) {
          console.log('[Scraper] Registration requires login. Authenticating...');
          await performLogin(page, env);
          console.log(`[Scraper] Returning to match: ${url}`);
          await page.goto(url, { waitUntil: "networkidle2" });
          content = await page.content();
        }

        const data = await page.evaluate(() => {
          const alerts = Array.from(document.querySelectorAll('.alert-info, .alert-warning, .alert-danger'));
          const alertTexts = alerts.map(a => a.innerText.trim());
          console.log('[Scraper] Found alerts:', alertTexts);

          const target = alerts.find(a =>
            /spot|remain|full|waitlist|registration opens|requires a free account/i.test(a.innerText)
          );

          if (!target) return { status: 'missing', found: alertTexts };
          const text = target.innerText.replace(/×/g, '').trim();
          const lower = text.toLowerCase();

          if (text.includes('requires a free account')) return { status: 'error' };
          if (lower.includes('full') || lower.includes('wait list')) return { status: 'full', remaining: 0, raw: text };
          if (lower.includes('registration opens')) return { status: 'upcoming', remaining: null, raw: text };

          const match = text.match(/(\d+)/);
          return { status: 'open', remaining: match ? parseInt(match[1], 10) : null, raw: text };
        });

        if (!data || data.status === 'error' || data.status === 'missing') {
          console.warn(`[Scraper] Data skip for ${id}: ${data?.status || 'no info'}`);
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
        console.error(`[Scraper] Error ${id}: ${err.message}`);
      }
    }
  } catch (err) {
    console.error(`[Scraper] Batch Error: ${err.message}`);
  } finally {
    if (browser) await browser.close();
  }
}

async function scrapeSingleId(env, matchId) {
  console.log(`[Scraper] Starting single scrape: ${matchId}`);
  let browser;
  const debugList = [];
  try {
    browser = await puppeteer.launch(env.MYBROWSER, { protocolTimeout: 60000 });
    const page = await browser.newPage();
    await applyStealth(page);
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36');
    
    // Deep Diagnostics: Network & Console
    page.on('console', msg => {
      const txt = msg.text();
      if (txt.includes('google') || txt.includes('bugsnag') || txt.includes('Facebook')) return;
      console.log(`[Page Console] ${txt}`);
    });

    page.on('requestfailed', req => {
      if (req.url().includes('challenges')) {
        console.warn(`[Network Fail] Turnstile request failed: ${req.url()} - ${req.failure().errorText}`);
      }
    });

    page.on('response', res => {
      if (res.url().includes('challenges') && res.status() >= 400) {
        console.warn(`[Network Block] Turnstile error ${res.status()}: ${res.url()}`);
      }
    });

    const url = buildUrl(matchId);
    console.log(`[Scraper] Navigating to: ${url}`);
    await page.goto(url, { waitUntil: "networkidle2" });
    await captureDebug(env, page, 'Initial Match Page', debugList);

    let content = await page.content();
    if (content.includes('requires a free account')) {
      console.log('[Scraper] Auth required. Logging in...');
      await performLogin(page, env, debugList);
      console.log(`[Scraper] Returning to match: ${url}`);
      await page.goto(url, { waitUntil: "networkidle2" });
      content = await page.content();
      await captureDebug(env, page, 'Returned to Match', debugList);
    }

    console.log('[Scraper] Looking for registration alerts...');
    const data = await page.evaluate(() => {
      const alerts = Array.from(document.querySelectorAll('.alert-info, .alert-warning, .alert-danger'));
      const textLog = alerts.map(a => a.innerText.trim());

      const target = alerts.find(a =>
        /spot|remain|full|waitlist|registration opens|requires a free account/i.test(a.innerText)
      );

      if (!target) return { status: 'missing', found: textLog };

      const text = target.innerText.replace(/×/g, '').trim();
      const lower = text.toLowerCase();

      if (text.includes('requires a free account')) return { status: 'error', found: textLog };
      if (lower.includes('full') || lower.includes('wait list')) return { status: 'full', remaining: 0, raw: text };
      if (lower.includes('registration opens')) return { status: 'upcoming', remaining: null, raw: text };

      const match = text.match(/(\d+)/);
      return { status: 'open', remaining: match ? parseInt(match[1], 10) : null, raw: text };
    });

    if (!data || data.status === 'error' || data.status === 'missing') {
      if (data?.found) console.log(`[Debug] Alerts found on page: ${JSON.stringify(data.found)}`);
      throw new Error(data?.status === 'error' ? 'Login failed (session invalid)' : 'No registration alert box found');
    }

    const res = {
      id: matchId,
      remaining: data.remaining,
      status: data.status,
      raw: data.raw,
      updated: new Date().toISOString()
    };

    await env.MATCH_DATA.put(matchId, JSON.stringify(res));
    return res;
  } catch (err) {
    console.error(`[Scraper] Single Scrape Error: ${err.message}`);
    throw err;
  } finally {
    if (browser) await browser.close();
  }
}
