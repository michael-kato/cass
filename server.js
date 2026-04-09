import Stripe from 'stripe';
import TOML from '@iarna/toml';
import { marked } from 'marked';

marked.setOptions({
  gfm: true,
  breaks: true,
});

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function normalizePrice(value) {
  return Number.isFinite(value) ? value : 0;
}

function getBaseUrl(envSiteUrl, requestUrl) {
  if (envSiteUrl) {
    try {
      return new URL(envSiteUrl).toString();
    } catch {}
  }

  return new URL(requestUrl).origin;
}

function toAbsoluteUrl(path, baseUrl) {
  return new URL(path, baseUrl).toString();
}

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

/**
 * PayPal Helpers
 */
async function getPaypalAccessToken(env) {
  const auth = btoa(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`);
  const res = await fetch(`${env.PAYPAL_API_BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new Error('Failed to get PayPal access token');
  const data = await res.json();
  return data.access_token;
}

async function handleCreatePaypalOrder(request, env) {
  const { items } = await request.json();
  const baseUrl = getBaseUrl(env.SITE_URL, request.url);
  const accessToken = await getPaypalAccessToken(env);

  let totalValue = 0;
  const paypalItems = items.map(item => {
    const price = normalizePrice(item.price);
    const qty = Math.max(1, Number(item.quantity) || 1);
    totalValue += price * qty;
    return {
      name: item.name,
      quantity: qty.toString(),
      unit_amount: {
        currency_code: 'USD',
        value: price.toFixed(2),
      }
    };
  });

  const orderBody = {
    intent: 'CAPTURE',
    purchase_units: [{
      amount: {
        currency_code: 'USD',
        value: totalValue.toFixed(2),
        breakdown: {
          item_total: {
            currency_code: 'USD',
            value: totalValue.toFixed(2),
          }
        }
      },
      items: paypalItems,
    }],
    application_context: {
      return_url: toAbsoluteUrl('/assets/checkout-success.html', baseUrl),
      cancel_url: toAbsoluteUrl('/merch.html', baseUrl),
      shipping_preference: 'GET_FROM_FILE',
      user_action: 'PAY_NOW',
    }
  };

  const res = await fetch(`${env.PAYPAL_API_BASE}/v2/checkout/orders`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(orderBody),
  });

  const order = await res.json();
  const approveLink = order.links?.find(l => l.rel === 'approve');

  if (!approveLink) {
    return json({ error: 'Failed to create PayPal order', details: order }, 500);
  }

  return json({ url: approveLink.href });
}

async function handleCapturePaypalOrder(request, env) {
  const url = new URL(request.url);
  const orderId = url.searchParams.get('orderId');
  if (!orderId) return json({ error: 'Missing orderId' }, 400);

  const accessToken = await getPaypalAccessToken(env);
  const res = await fetch(`${env.PAYPAL_API_BASE}/v2/checkout/orders/${orderId}/capture`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  });

  const result = await res.json();
  return json({ success: res.ok, status: result.status });
}

async function handleCreateCheckoutSession(request, env) {
  if (!env.STRIPE_SECRET_KEY) {
    return json({ error: 'Missing STRIPE_SECRET_KEY.' }, 500);
  }

  const { items } = await request.json();
  if (!Array.isArray(items) || items.length === 0) {
    return json({ error: 'Cart is empty.' }, 400);
  }

  const baseUrl = getBaseUrl(env.SITE_URL, request.url);
  const stripe = new Stripe(env.STRIPE_SECRET_KEY);

  const lineItems = items.map(item => ({
    price_data: {
      currency: 'usd',
      product_data: {
        name: item.name,
        ...(item.image && baseUrl.startsWith('https://')
          ? { images: [toAbsoluteUrl(item.image, baseUrl)] }
          : {}),
      },
      unit_amount: Math.round(normalizePrice(item.price) * 100),
    },
    quantity: Math.max(1, Number(item.quantity) || 1),
  }));

  const session = await stripe.checkout.sessions.create({
    line_items: lineItems,
    mode: 'payment',
    success_url: toAbsoluteUrl('/assets/checkout-success.html', baseUrl),
    cancel_url: toAbsoluteUrl('/merch.html', baseUrl),
    shipping_address_collection: { allowed_countries: ['US'] },
    billing_address_collection: 'auto'
  });

  return json({ url: session.url });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    try {
      if (url.pathname === '/api/create-checkout-session' && request.method === 'POST') {
        return await handleCreateCheckoutSession(request, env);
      }

      if (url.pathname === '/api/create-paypal-order' && request.method === 'POST') {
        return await handleCreatePaypalOrder(request, env);
      }

      if (url.pathname === '/api/capture-paypal-order' && request.method === 'POST') {
        return await handleCapturePaypalOrder(request, env);
      }

      if (url.pathname === '/api/toml' && request.method === 'GET') {
        const requestedPath = url.searchParams.get('path');
        const markdownFields = new Set(
          (url.searchParams.get('markdown') || '')
            .split(',')
            .map(field => field.trim())
            .filter(Boolean)
        );

        if (!requestedPath || !requestedPath.startsWith('assets/') || !requestedPath.endsWith('.toml')) {
          return json({ error: 'Invalid TOML path.' }, 400);
        }

        const assetUrl = new URL(`/${requestedPath}`, url);
        const assetResponse = await env.ASSETS.fetch(new Request(assetUrl.toString(), { method: 'GET' }));

        if (!assetResponse.ok) {
          return json({ error: `Asset not found: ${requestedPath}` }, assetResponse.status);
        }

        const parsed = renderMarkdownFields(TOML.parse(await assetResponse.text()), markdownFields);
        return json(parsed);
      }

      return env.ASSETS.fetch(request);
    } catch (err) {
      return json({ error: err.message }, 500);
    }
  }
};
