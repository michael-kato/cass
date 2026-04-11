// CASS Practiscore Scraper Worker
import puppeteer from "@cloudflare/puppeteer";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Check active browser sessions
    if (url.pathname === '/sessions') {
      try {
        const sessions = await puppeteer.sessions(env.BROWSER);
        return new Response(JSON.stringify({ 
          count: sessions.length,
          sessions: sessions 
        }, null, 2), { headers: { 'Content-Type': 'application/json' } });
      } catch (err) {
        return new Response(`Error fetching sessions: ${err.message}`, { status: 500 });
      }
    }

    // Force close all active sessions
    if (url.pathname === '/clear-sessions') {
      try {
        const sessions = await puppeteer.sessions(env.BROWSER);
        for (const s of sessions) {
          const b = await puppeteer.connect(env.BROWSER, s.sessionId);
          await b.close();
        }
        return new Response(`Cleared ${sessions.length} sessions.`, { status: 200 });
      } catch (err) {
        return new Response(`Error clearing: ${err.message}`, { status: 500 });
      }
    }

    if (url.pathname === '/scrape') {
      const slug = url.searchParams.get('slug');
      if (!slug) return new Response('Missing ?slug=', { status: 400 });

      try {
        console.log(`[Scraper] Starting Low-Fi Fetch for: ${slug}`);
        const lowFiResult = await scrapeLowFi(slug);
        
        if (lowFiResult.success && lowFiResult.spotsText) {
          return new Response(this.renderHtml(slug, lowFiResult, { lowFi: lowFiResult }), { headers: { 'Content-Type': 'text/html' } });
        }

        console.log(`[Scraper] Low-Fi failed. Waiting 2s before Browser Fallback to prevent 429 throttling...`);
        await new Promise(r => setTimeout(r, 2000)); // Protective delay

        const browserResult = await scrapeWithBrowser(env, slug);
        return new Response(this.renderHtml(slug, browserResult, { lowFi: lowFiResult, browser: browserResult }), { headers: { 'Content-Type': 'text/html' } });

      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500 });
      }
    }

    return new Response('CASS Scraper API', { status: 200 });
  },

  renderHtml(slug, result, diagnostics) {
    return `
      <div style="font-family:sans-serif; padding:20px;">
        <h3>Results for: ${slug}</h3>
        <p><strong>Primary Method Result:</strong> <span style="color:${result.success ? 'green' : 'red'}; font-weight:bold;">${result.spotsText || 'Not Found'}</span></p>
        <hr>
        <h4>Full Diagnostic Trace:</h4>
        <pre style="background:#f4f4f4; padding:15px; border-radius:5px;">${JSON.stringify(diagnostics, null, 2)}</pre>
      </div>
    `;
  }
};

// ── METHOD 1: Raw HTTP Fetch (Fast, No Limits) ──
async function scrapeLowFi(slug) {
  const url = `https://practiscore.com/${slug}/register`;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' }
    });
    const html = await res.text();

    // Targeted search: Extract all text from "alert alert-info" divs
    // These are where Practiscore places registration counts and status updates
    const alertRegex = /<div[^>]*class="[^"]*alert-info[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;
    let alerts = [];
    let m;
    
    while ((m = alertRegex.exec(html)) !== null) {
      // Clean tags out of the internal text
      let cleaned = m[1].replace(/<[^>]*>?/gm, '').trim();
      if (cleaned) alerts.push(cleaned);
    }

    // Heuristics to find the 'Registration' alert among others (like ads)
    // We look for keywords like registered, spots, open, or matches
    const registrationStatus = alerts.find(a => 
      /spots|registered|approved|open|closes|full|waitlist|registration/i.test(a)
    );

    // Capture the BODY content specifically for manual inspection
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
    const bodyContent = bodyMatch ? bodyMatch[1] : html;

    return {
      method: 'HTTP Fetch (Div Target)',
      spotsText: registrationStatus || null,
      allAlertsFound: alerts,
      success: !!registrationStatus,
      htmlSnippet: bodyContent.substring(0, 10000).replace(/</g, '&lt;'),
      scrapedAt: new Date().toISOString()
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ── METHOD 2: Headless Browser (Slow, Cloudflare Limits) ──
async function scrapeWithBrowser(env, slug) {
  let browser;
  try {
    browser = await puppeteer.launch(env.BROWSER);
    const page = await browser.newPage();
    await page.goto(`https://practiscore.com/${slug}/register`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    
    const spotsText = await page.evaluate(() => {
      const alerts = Array.from(document.querySelectorAll('.alert-info'));
      const found = alerts.find(a => /spot|remain|full|waitlist/i.test(a.innerText));
      return found ? found.innerText.trim() : null;
    });

    return {
      method: 'Headless Browser',
      spotsText,
      success: true,
      scrapedAt: new Date().toISOString()
    };
  } catch (err) {
    return {
      method: 'Headless Browser',
      success: false,
      error: err.message,
      scrapedAt: new Date().toISOString()
    };
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}
