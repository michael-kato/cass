import Stripe from 'stripe';
import TOML from '@iarna/toml';
import { marked } from 'marked';

marked.setOptions({
  gfm: true,
  breaks: true,
});

function renderMarkdownFields(value, markdownFields) {
  if (Array.isArray(value)) {
    return value.map(item => renderMarkdownFields(item, markdownFields));
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  const next = {};

  for (const [key, child] of Object.entries(value)) {
    next[key] = renderMarkdownFields(child, markdownFields);

    if (markdownFields.has(key) && typeof child === 'string') {
      next[`${key}Html`] = marked.parse(child);
    }
  }

  return next;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const stripe = new Stripe(env.STRIPE_SECRET_KEY);

    // ── Handle API Routes ──
    if (url.pathname === '/api/create-checkout-session' && request.method === 'POST') {
      try {
        const { items } = await request.json();

        const line_items = items.map(item => ({
          price_data: {
            currency: 'usd',
            product_data: {
              name: item.name,
              ...(item.image ? { images: [`${env.SITE_URL || 'http://localhost:3000'}/${item.image}`] } : {}),
            },
            unit_amount: Math.round(parseFloat(item.price.replace(/[^0-9.]/g, '')) * 100),
          },
          quantity: item.quantity,
        }));

        const session = await stripe.checkout.sessions.create({
          payment_method_types: ['card'],
          line_items,
          mode: 'payment',
          success_url: `${env.SITE_URL}/checkout-success.html`,
          cancel_url:  `${env.SITE_URL}/merch.html`,
          shipping_address_collection: { allowed_countries: ['US'] },
        });

        return new Response(JSON.stringify({ url: session.url }), {
          headers: { 'Content-Type': 'application/json' }
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500 });
      }
    }

    if (url.pathname === '/api/toml' && request.method === 'GET') {
      try {
        const requestedPath = url.searchParams.get('path');
        const markdownFields = new Set(
          (url.searchParams.get('markdown') || '')
            .split(',')
            .map(field => field.trim())
            .filter(Boolean)
        );

        if (!requestedPath || !requestedPath.startsWith('assets/') || !requestedPath.endsWith('.toml')) {
          return new Response(JSON.stringify({ error: 'Invalid TOML path.' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        const assetUrl = new URL(`/${requestedPath}`, url);
        const assetResponse = await env.ASSETS.fetch(new Request(assetUrl.toString(), { method: 'GET' }));

        if (!assetResponse.ok) {
          return new Response(JSON.stringify({ error: `Asset not found: ${requestedPath}` }), {
            status: assetResponse.status,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        const parsed = renderMarkdownFields(TOML.parse(await assetResponse.text()), markdownFields);
        return new Response(JSON.stringify(parsed), {
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    // ── Fallback: Serve Static Assets ──
    // In a "Static" project, Cloudflare handles this automatically if 
    // the file exists in your "assets.directory" (e.g. /public).
    return env.ASSETS.fetch(request);
  }
};
