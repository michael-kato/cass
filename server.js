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
  const environment = env.ENVIRONMENT || 'development';
  console.error(`[${environment.toUpperCase()} ERROR] ${message}`, details);

  try {
    await env.DB?.prepare('INSERT INTO cass_logs (environment, message, details) VALUES (?, ?, ?)')
      .bind(environment, message, JSON.stringify(details))
      .run();
  } catch (e) {
    console.error('[logError] D1 write failed:', e.message);
  }
}

async function logInfo(message, env, details = {}) {
  const environment = env.ENVIRONMENT || 'development';
  console.log(`[${environment.toUpperCase()} INFO] ${message}`, details);

  await env.DB?.prepare('INSERT INTO cass_logs (environment, message, details) VALUES (?, ?, ?)')
    .bind(environment, message, JSON.stringify(details))
    .run()
    .catch(e => console.error('Failed to log info to D1:', e.message));
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
/**
 * Maps our cart items to Printify's line_items format using the product TOML.
 */
function mapCartItemsToPrintify(cartItems, productList) {
  return cartItems.map(item => {
    // Find the product by checking which ID in our TOML is a prefix of the cart item ID
    const product = productList
      .sort((a, b) => b.id.length - a.id.length)
      .find(p => item.id.startsWith(p.id));

    if (!product) {
      console.warn(`[Mapping] Product not found in TOML for item ID: ${item.id}`);
      return null;
    }

    // Extract color and size from the remainder (e.g. "Vintage Black-M")
    const remainder = item.id.replace(product.id, '').replace(/^-/, '');
    const variantId = product.variants?.[remainder] || product.printifyVariantId || 0;

    console.log(`[Mapping] ${item.id} -> Variant: ${variantId}`);

    return {
      blueprint_id: Number(product.printifyBlueprintId) || 0,
      print_provider_id: Number(product.printifyPrintProviderId) || 1, 
      variant_id: Number(variantId) || 0,
      quantity: item.qty
    };
  }).filter(li => li !== null);
}

async function fulfillPrintifyOrder(orderData, env) {
  if (!env.PRINTIFY_API_KEY || !env.PRINTIFY_SHOP_ID) {
    await logError('Printify config missing.', env);
    return;
  }

  // 1. Fetch products and map items
  const baseUrl = env.SITE_URL || 'https://cass.cass-account.workers.dev';
  const merchRes = await fetch(`${baseUrl}/assets/merch.toml`);
  if (!merchRes.ok) throw new Error('Failed to load merch.toml for fulfillment');
  const merchText = await merchRes.text();
  const products = TOML.parse(merchText).products || [];

  const lineItems = mapCartItemsToPrintify(orderData.items, products);
  if (lineItems.length === 0) {
    await logError('Printify: No valid line items mapped.', env, { orderId: orderData.internalOrderId });
    return;
  }

  // 2. Transmit to Printify
  const printifyPayload = {
    external_id: orderData.internalOrderId,
    label: 'CASS Website Order',
    line_items: lineItems,
    shipping_method: 1,
    send_shipping_notification: true,
    address_to: orderData.shippingAddress
  };

  console.log(`[Printify] Transmitting Order ${orderData.internalOrderId}...`);
  console.log(`[Printify] Payload:`, JSON.stringify(printifyPayload));

  try {
    const res = await fetch(`https://api.printify.com/v1/shops/${env.PRINTIFY_SHOP_ID}/orders.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${env.PRINTIFY_API_KEY}`
      },
      body: JSON.stringify(printifyPayload)
    });

    if (!res.ok) {
      const errorText = await res.text();
      await logError('Printify Fulfillment Failed', env, { status: res.status, error: errorText, orderId: orderData.internalOrderId });
    } else {
      const result = await res.json();
      console.log('Printify Order Created successfully:', result.id);
      await logInfo('Printify Order Success', env, { printifyId: result.id, orderId: orderData.internalOrderId });
    }
  } catch (err) {
    await logError('Printify Network Crash', env, { error: err.message, orderId: orderData.internalOrderId });
  }
}

/**
 * Maps Stripe session.shipping_details to Printify address_to format.
 */
function mapStripeAddress(session) {
  const details = session.shipping_details || {};
  const addr = details.address || {};
  const customer = session.customer_details || {};

  return {
    first_name: (details.name || customer.name || 'Customer').split(' ')[0],
    last_name: (details.name || customer.name || '').split(' ').slice(1).join(' '),
    email: customer.email || '',
    phone: customer.phone || '',
    country: addr.country || 'US',
    region: addr.state || '',
    address1: addr.line1 || '',
    address2: addr.line2 || '',
    city: addr.city || '',
    zip: addr.postal_code || ''
  };
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
      return_url: toAbsoluteUrl('/checkout-success.html', baseUrl),
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
    await logError('PayPal Order Creation Failed', env, { details: order });
    return json({ error: 'Failed to create PayPal order', details: order }, 500);
  }

  await logInfo('PayPal Order Created', env, { orderId: order.id });
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

    // We explicitly log PayPal transaction capture prior to triggering fulfillment
    await logInfo('PayPal Order Captured', env, { orderId: result.id, status: result.status });

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
    success_url: toAbsoluteUrl('/checkout-success.html', baseUrl),
    cancel_url: toAbsoluteUrl('/merch.html', baseUrl),
    shipping_address_collection: { allowed_countries: ['US'] },
    billing_address_collection: 'auto',
    // Store cart data in metadata so the webhook can see it later
    metadata: {
      cart_json: JSON.stringify(items.map(i => ({ id: i.id, qty: i.quantity })))
    }
  });

  const totalAmount = lineItems.reduce((sum, li) => sum + li.price_data.unit_amount * li.quantity, 0);
  await logInfo('Stripe Checkout Session Created', env, {
    sessionId: session.id,
    totalUsd: (totalAmount / 100).toFixed(2),
    itemCount: items.length,
    items: items.map(i => ({ name: i.name, qty: i.quantity, price: i.price }))
  });
  return json({ url: session.url });
}

/**
 * Stripe Webhook Handler
 * Required to automate fulfillment because redirects can be unreliable.
 */
async function handleStripeWebhook(request, env) {
  console.log(`\n============== [WEBHOOK] INCOMING STRIPE EVENT ==============`);
  const signature = request.headers.get('stripe-signature');
  const body = await request.text();
  const stripe = new Stripe(env.STRIPE_SECRET_KEY);

  let event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, signature, env.STRIPE_WEBHOOK_SECRET);
    console.log(`[WEBHOOK] Successfully verified signature for event: ${event.type}`);
  } catch (err) {
    await logError('Stripe Webhook Signature Verification Failed', env, { error: err.message });
    return new Response(`Webhook Error: ${err.message}`, { status: 400 });
  }

  if (event.type === 'checkout.session.completed') {
    const slimSession = event.data.object;
    const stripe = new Stripe(env.STRIPE_SECRET_KEY);
    
    // FETCH THE FULL SESSION: This guarantees we get metadata and shipping_details
    const session = await stripe.checkout.sessions.retrieve(slimSession.id, {
      expand: ['shipping_details']
    });

    console.log(`[Webhook] Payment succeeded for session: ${session.id}`);
    
    const metadata = session.metadata || {};
    console.log(`[Webhook] Cart metadata: ${metadata.cart_json || 'MISSING'}`);
    
    const items = JSON.parse(metadata.cart_json || '[]');
    console.log(`[Webhook] Parsed ${items.length} item(s) from cart`);

    const shippingAddress = mapStripeAddress(session);
    if (!shippingAddress.address1) {
      console.warn(`[Webhook] No shipping address found on session: ${session.id}`);
    }

    try {
      await fulfillPrintifyOrder({
        internalOrderId: session.id,
        items,
        shippingAddress
      }, env);

      // Log a complete order record to D1 for support / dispute resolution
      await logInfo('Order Fulfilled', env, {
        sessionId: session.id,
        customerEmail: session.customer_details?.email,
        amountPaidUsd: ((session.amount_total || 0) / 100).toFixed(2),
        itemCount: items.length,
        shippingCity: shippingAddress.city,
        shippingState: shippingAddress.region,
        shippingCountry: shippingAddress.country
      });
    } catch (err) {
      await logError('Webhook: Fulfillment Crashed', env, {
        sessionId: session.id,
        error: err.message,
        stack: err.stack
      });
    }
  } else if (event.type === 'charge.refunded') {
    const charge = event.data.object;
    await logInfo('Stripe Refund Issued', env, {
      chargeId: charge.id,
      amountRefundedUsd: ((charge.amount_refunded || 0) / 100).toFixed(2),
      customerEmail: charge.billing_details?.email,
      reason: charge.refunds?.data?.[0]?.reason || 'unspecified'
    });
  } else if (event.type === 'checkout.session.expired') {
    const session = event.data.object;
    await logInfo('Stripe Checkout Abandoned', env, { sessionId: session.id });
  } else if (event.type === 'checkout.session.async_payment_failed') {
    const session = event.data.object;
    await logError('Stripe Async Payment Failed', env, { sessionId: session.id });
  } else if (event.type === 'account.external_account.created') {
    await logInfo('Stripe External Account Created', env, { accountId: event.data.object.id });
  } else {
    console.log(`[Stripe] Handled other event type: ${event.type}`);
  }

  return json({ received: true });
}

async function handleClientErrorLogging(request, env) {
  const errorData = await request.json();
  await logError(`Frontend JS Error: ${errorData.message || 'Unknown'}`, env, errorData);
  return json({ success: true });
}

/**
 * Global error handler — wraps any async fetch handler.
 * Guarantees ALL unhandled exceptions are logged to D1 + console.
 * Note: the Stripe webhook has its own local catch because Stripe
 * must receive a 200 even when fulfillment fails (to prevent retries).
 */
function withErrorHandling(handler) {
  return async (request, env, ctx) => {
    try {
      return await handler(request, env, ctx);
    } catch (err) {
      await logError('Unhandled Server Error', env, {
        error: err.message,
        stack: err.stack,
        url: request.url
      });
      return json({ error: 'Internal Server Error' }, 500);
    }
  };
}

async function handleRequest(request, env, ctx) {
  const url = new URL(request.url);
  console.log(`[Request] ${request.method} ${url.pathname}`);

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

  if (url.pathname === '/api/log-client' && request.method === 'POST') {
    return await handleClientErrorLogging(request, env);
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
}

export default {
  fetch: withErrorHandling(handleRequest)
};
