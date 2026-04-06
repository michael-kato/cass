const express = require('express');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Serve all static site files from the project root
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

// ── POST /api/create-checkout-session ──
// Body: { items: [{ id, name, price, image, quantity }] }
app.post('/api/create-checkout-session', async (req, res) => {
  const { items } = req.body;

  if (!items || items.length === 0) {
    return res.status(400).json({ error: 'No items in cart' });
  }

  try {
    const line_items = items.map(item => ({
      price_data: {
        currency: 'usd',
        product_data: {
          name: item.name,
          // Stripe requires an absolute URL for images
          ...(item.image ? { images: [`${process.env.SITE_URL || 'http://localhost:3000'}/${item.image}`] } : {}),
        },
        // price in cents — strip '$', ' USD', commas, then multiply
        unit_amount: Math.round(parseFloat(item.price.replace(/[^0-9.]/g, '')) * 100),
      },
      quantity: item.quantity,
    }));

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items,
      mode: 'payment',
      success_url: `${process.env.SITE_URL || 'http://localhost:3000'}/checkout-success.html`,
      cancel_url:  `${process.env.SITE_URL || 'http://localhost:3000'}/merch.html`,
      shipping_address_collection: {
        allowed_countries: ['US'],
      },
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('Stripe error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`CASS server running at http://localhost:${PORT}`);
});
