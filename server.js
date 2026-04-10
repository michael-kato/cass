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

async function logError(message, env, details = {}) {
  const environment = env.ENVIRONMENT || 'development'; // Default to 'development' if not set
  console.error(`[${environment.toUpperCase()} ERROR] ${message}`, details);

  if (env.DB) {
    try {
      await env.DB.prepare(
        'INSERT INTO error_logs (environment, message, details) VALUES (?, ?, ?)'
      ).bind(
        environment,
        message,
        JSON.stringify(details)
      ).run();
    } catch (e) {
      console.error('Failed to log error to D1:', e.message);
    }
  }
}

function logInfo(message, env, details = {}) {
  const environment = env.ENVIRONMENT || 'development';
  console.log(`[${environment.toUpperCase()} INFO] ${message}`, details);
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
 * Normalizes name splitting for Printify's first_name/last_name fields.
 */
function splitName(fullName) {
  const parts = (fullName || '').trim().split(/\s+/);
  return {
    first_name: parts[0] || '',
    last_name: parts.slice(1).join(' ') || ''
  };
}

/**
 * Maps Stripe Shipping Details to Printify Address Format
 */
function mapStripeAddress(session) {
  const { name, address } = session.shipping_details || {};
  const { first_name, last_name } = splitName(name);
  return {
    first_name,
    last_name,
    email: session.customer_details?.email || '',
    address1: address?.line1 || '',
    address2: address?.line2 || '',
    city: address?.city || '',
    state: address?.state || '',
    country: address?.country || '',
    zip: address?.postal_code || ''
  };
}

/**
 * Maps PayPal Order Details to Printify Address Format
 */
function mapPaypalAddress(order) {
  const shipping = order.purchase_units[0].shipping;
  const { first_name, last_name } = splitName(shipping.name.full_name);
  const addr = shipping.address;
  return {
    first_name,
    last_name,
    email: order.payer?.email_address || '',
    address1: addr.address_line_1 || '',
    address2: addr.address_line_2 || '',
    city: addr.admin_area_2 || '',
    state: addr.admin_area_1 || '',
    country: addr.country_code || '',
    zip: addr.postal_code || ''
  };
}

/**
 * Printify Fulfillment Helper
 */
async function fulfillPrintifyOrder(orderData, env) {
  if (!env.PRINTIFY_API_KEY || !env.PRINTIFY_SHOP_ID) {
    await logError('Printify config missing.', env);
    return;
  }

  const printifyPayload = {
    external_id: orderData.internalOrderId, // Your DB ID
    label: 'CASS Website Order',
    line_items: orderData.items.map(item => ({
      blueprint_id: item.printifyBlueprintId,
      variant_id: item.printifyVariantId,
      quantity: item.quantity
    })),
    shipping_method: 1,
    send_shipping_notification: true,
    address_to: orderData.shippingAddress // Format: first_name, last_name, address1, city, zip, country, state
  };

  const res = await fetch(`https://api.printify.com/v1/shops/${env.PRINTIFY_SHOP_ID}/orders.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${env.PRINTIFY_API_KEY}`
    },
    body: JSON.stringify(printifyPayload)
  });

  if (!res.ok) {
    const error = await res.text();
    await logError('Printify Fulfillment Failed:', env, { error });
  } else {
    console.log('Printify Order Created successfully.');
  }
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
  
  if (res.ok && result.status === 'COMPLETED') {
    const shippingAddress = mapPaypalAddress(result);
    const items = result.purchase_units[0].items.map(i => {
      // We rely on the 'sku' or similar to hold Printify IDs if you set them during creation
      // For now, this assumes fulfillPrintifyOrder will be called with the right data structure
      return JSON.parse(i.sku || '{}'); 
    });

    // TODO: Record in D1 Database (Order ID: result.id)

    await fulfillPrintifyOrder({
      internalOrderId: result.id,
      items: items,
      shippingAddress
    }, env);
  }

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
    billing_address_collection: 'auto',
    // Store cart data in metadata so the webhook can see it later
    metadata: {
      cart_json: JSON.stringify(items.map(i => ({ id: i.id, qty: i.quantity })))
    }
  });

  return json({ url: session.url });
}

/**
 * Stripe Webhook Handler
 * Required to automate fulfillment because redirects can be unreliable.
 */
async function handleStripeWebhook(request, env) {
  const signature = request.headers.get('stripe-signature');
  const body = await request.text();
  const stripe = new Stripe(env.STRIPE_SECRET_KEY);

  let event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    await logError('Stripe Webhook Signature Verification Failed', env, { error: err.message });
    return new Response(`Webhook Error: ${err.message}`, { status: 400 });
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    console.log('Payment Succeeded for Session:', session.id);
    
    // 1. Reconstruct order from session metadata
    // 2. Extract shipping address from session.shipping_details
    // 3. Record in D1 Database
    // 4. Trigger Printify
    // await fulfillPrintifyOrder({ ... }, env);
  } else if (event.type === 'checkout.session.expired') {
    const session = event.data.object;
    console.log(`[Stripe] Checkout Session Expired (Abandoned): ${session.id}`);
    
  } else if (event.type === 'checkout.session.async_payment_failed') {
    const session = event.data.object;
    console.log(`[Stripe] Async Payment Failed: ${session.id}`);
    
  } else if (event.type === 'account.external_account.created') {
    console.log(`[Stripe] External Account Created: ${event.data.object.id}`);
    
  } else {
    console.log(`[Stripe] Handled other event type: ${event.type}`);
  }

  return json({ received: true });
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

      if (url.pathname === '/api/stripe-webhook' && request.method === 'POST') {
        return await handleStripeWebhook(request, env);
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
      await logError('Unhandled Server Error', env, { error: err.message, stack: err.stack, url: url.toString() });
      return json({ error: err.message }, 500);
    }
  }
};
