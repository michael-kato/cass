/* cart.js — CASS shopping cart
   Manages cart state in localStorage.
   Injects a slide-out drawer into every page.
   shared.js calls initCart() after building the nav.
*/

const CART_KEY = 'cass_cart';

// ── State ──────────────────────────────────────────────

function getCart() {
  try { return JSON.parse(localStorage.getItem(CART_KEY)) || []; }
  catch { return []; }
}

function saveCart(cart) {
  localStorage.setItem(CART_KEY, JSON.stringify(cart));
  updateBadge();
  renderDrawerItems();
}

function addToCart(product) {
  const cart = getCart();
  const existing = cart.find(i => i.id === product.id);
  const quantityToAdd = Math.max(1, Number(product.quantity) || 1);
  if (existing) {
    existing.quantity += quantityToAdd;
  } else {
    cart.push({ ...product, quantity: quantityToAdd });
  }
  saveCart(cart);
  openDrawer();
}

function removeFromCart(id) {
  saveCart(getCart().filter(i => String(i.id) !== String(id)));
}

function updateQuantity(id, quantity) {
  const cart = getCart();
  const item = cart.find(i => String(i.id) === String(id));
  if (!item) return;
  if (quantity <= 0) { removeFromCart(id); return; }
  item.quantity = quantity;
  saveCart(cart);
}

function clearCart() {
  localStorage.removeItem(CART_KEY);
  updateBadge();
  renderDrawerItems();
}

function cartTotal() {
  return getCart().reduce((sum, i) => {
    const price = parseFloat(i.price.replace(/[^0-9.]/g, ''));
    return sum + price * i.quantity;
  }, 0);
}

function cartCount() {
  return getCart().reduce((sum, i) => sum + i.quantity, 0);
}

// ── Badge ──────────────────────────────────────────────

function updateBadge() {
  const count = cartCount();
  document.querySelectorAll('[data-cart-badge="true"]').forEach(badge => {
    badge.textContent = count;
    badge.style.display = count > 0 ? 'flex' : 'none';
  });
}

// ── Drawer ─────────────────────────────────────────────

function buildDrawer() {
  const el = document.createElement('div');
  el.innerHTML = `
    <div id="cart-backdrop" style="
      display:none; position:fixed; inset:0; z-index:299;
      background:rgba(0,0,0,0.4);
    "></div>

    <div id="cart-drawer" style="
      position:fixed; top:0; right:0; bottom:0; z-index:300;
      width:380px; max-width:100vw;
      background:#f5f0e8;
      display:flex; flex-direction:column;
      transform:translateX(100%);
      transition:transform 0.3s ease;
      box-shadow:-4px 0 24px rgba(0,0,0,0.15);
    ">
      <div style="
        display:flex; align-items:center; justify-content:space-between;
        padding:1.25rem 1.5rem;
        border-bottom:1px solid #b8cfb0;
        background:#121212;
      ">
        <span style="font-family:Assistant,sans-serif;font-weight:700;font-size:1rem;color:#fff;letter-spacing:0.06em;text-transform:uppercase;">Your Cart</span>
        <button id="cart-close" aria-label="Close cart" style="
          background:none;border:none;cursor:pointer;color:rgba(255,255,255,0.7);padding:0.25rem;
        ">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>

      <div id="cart-items" style="flex:1;overflow-y:auto;padding:1rem 1.5rem;"></div>

      <div id="cart-footer" style="
        padding:1.25rem 1.5rem;
        border-top:1px solid #b8cfb0;
        background:#f5f0e8;
      ">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;">
          <span style="font-family:Assistant,sans-serif;font-weight:600;font-size:0.9rem;color:#3a3a38;">Total</span>
          <span id="cart-total" style="font-family:Assistant,sans-serif;font-weight:700;font-size:1.1rem;color:#121212;"></span>
        </div>
        <button id="cart-checkout-btn" style="
          width:100%;padding:0.85rem;
          background:#121212;color:#fff;
          font-family:Assistant,sans-serif;font-weight:700;font-size:0.95rem;
          letter-spacing:0.06em;text-transform:uppercase;
          border:none;cursor:pointer;
          transition:background 0.2s;
        ">Checkout</button>
        <div id="cart-checkout-error" style="
          display:none;margin-top:0.6rem;
          font-size:0.8rem;color:#c0392b;text-align:center;
          font-family:Assistant,sans-serif;
        "></div>
      </div>
    </div>
  `;
  document.body.appendChild(el);

  document.getElementById('cart-close').addEventListener('click', closeDrawer);
  document.getElementById('cart-backdrop').addEventListener('click', closeDrawer);
  document.getElementById('cart-checkout-btn').addEventListener('click', startCheckout);
  document.getElementById('cart-items').addEventListener('click', handleDrawerClick);
}

function renderDrawerItems() {
  const itemsEl = document.getElementById('cart-items');
  const totalEl = document.getElementById('cart-total');
  if (!itemsEl) return;

  const cart = getCart();

  if (cart.length === 0) {
    itemsEl.innerHTML = `
      <div style="text-align:center;padding:3rem 1rem;color:#6a6a68;font-family:Assistant,sans-serif;font-size:0.9rem;">
        Your cart is empty
      </div>`;
    if (totalEl) totalEl.textContent = '$0.00';
    return;
  }

  itemsEl.innerHTML = cart.map(item => `
    <div style="
      display:flex;gap:0.75rem;padding:0.9rem 0;
      border-bottom:1px solid #b8cfb0;
    ">
      <div style="
        width:64px;height:64px;flex-shrink:0;
        background:url('${item.image}') center/cover #b8cfb0;
      "></div>
      <div style="flex:1;min-width:0;">
        <div style="font-family:Assistant,sans-serif;font-weight:600;font-size:0.85rem;color:#1a1a18;line-height:1.3;margin-bottom:0.35rem;">${item.name}</div>
        <div style="font-size:0.82rem;color:#4a5e3a;font-weight:600;margin-bottom:0.5rem;">${item.price}</div>
        <div style="display:flex;align-items:center;gap:0.5rem;">
          <button type="button" data-cart-action="decrease" data-cart-id="${escapeCartAttr(item.id)}" style="
            width:24px;height:24px;border:1px solid #1a1a18;background:transparent;
            cursor:pointer;font-size:0.9rem;display:flex;align-items:center;justify-content:center;
          ">−</button>
          <span style="font-family:Assistant,sans-serif;font-size:0.85rem;min-width:20px;text-align:center;">${item.quantity}</span>
          <button type="button" data-cart-action="increase" data-cart-id="${escapeCartAttr(item.id)}" style="
            width:24px;height:24px;border:1px solid #1a1a18;background:transparent;
            cursor:pointer;font-size:0.9rem;display:flex;align-items:center;justify-content:center;
          ">+</button>
          <button type="button" data-cart-action="remove" data-cart-id="${escapeCartAttr(item.id)}" style="
            margin-left:auto;background:none;border:none;cursor:pointer;
            color:#6a6a68;padding:0.1rem;
          ">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
            </svg>
          </button>
        </div>
      </div>
    </div>`).join('');

  if (totalEl) totalEl.textContent = `$${cartTotal().toFixed(2)}`;
}

function escapeCartAttr(value) {
  return String(value).replace(/"/g, '&quot;');
}

function handleDrawerClick(event) {
  const actionButton = event.target.closest('[data-cart-action]');
  if (!actionButton) return;

  const id = actionButton.dataset.cartId;
  if (!id) return;

  const cart = getCart();
  const item = cart.find(cartItem => String(cartItem.id) === String(id));
  if (!item) return;

  const action = actionButton.dataset.cartAction;
  if (action === 'increase') {
    updateQuantity(id, item.quantity + 1);
  } else if (action === 'decrease') {
    updateQuantity(id, item.quantity - 1);
  } else if (action === 'remove') {
    removeFromCart(id);
  }
}

function openDrawer() {
  const drawer = document.getElementById('cart-drawer');
  const backdrop = document.getElementById('cart-backdrop');
  if (!drawer) return;
  backdrop.style.display = 'block';
  drawer.style.transform = 'translateX(0)';
  document.body.style.overflow = 'hidden';
  renderDrawerItems();
}

function closeDrawer() {
  const drawer = document.getElementById('cart-drawer');
  const backdrop = document.getElementById('cart-backdrop');
  if (!drawer) return;
  drawer.style.transform = 'translateX(100%)';
  backdrop.style.display = 'none';
  document.body.style.overflow = '';
}

// ── Checkout ───────────────────────────────────────────

async function startCheckout() {
  const btn = document.getElementById('cart-checkout-btn');
  const errEl = document.getElementById('cart-checkout-error');
  const cart = getCart();

  if (cart.length === 0) return;

  btn.textContent = 'Redirecting…';
  btn.disabled = true;
  errEl.style.display = 'none';

  try {
    const res = await fetch('/api/create-checkout-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: cart }),
    });

    const data = await res.json();

    if (!res.ok) throw new Error(data.error || 'Checkout failed');

    window.location.href = data.url;

  } catch (err) {
    errEl.textContent = err.message;
    errEl.style.display = 'block';
    btn.textContent = 'Checkout';
    btn.disabled = false;
  }
}

// ── Init ───────────────────────────────────────────────

function initCart() {
  buildDrawer();
  updateBadge();

  // Wire the nav cart icon to open the drawer
  document.querySelectorAll('.cart-trigger').forEach(cartBtn => {
    cartBtn.addEventListener('click', openDrawer);
  });
}
