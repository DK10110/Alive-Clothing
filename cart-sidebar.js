/* ═══════════════════════════════════════════════════════
   ALIVE — SHARED CART SIDEBAR  (cart-sidebar.js)
   Include this script on every page. Requires the
   cart-sidebar HTML snippet to be present in the page.
═══════════════════════════════════════════════════════ */

(function () {
  'use strict';

  /* ── helpers ── */
  function getCart() { return JSON.parse(localStorage.getItem('alive-cart') || '[]'); }
  function setCart(c) { localStorage.setItem('alive-cart', JSON.stringify(c)); }

  /* ── render ── */
  function renderCartSidebar() {
    const cart = getCart();
    const countEl  = document.getElementById('cart-count');
    const bodyEl   = document.getElementById('cart-body');
    const footerEl = document.getElementById('cart-footer');
    const totalEl  = document.getElementById('cart-total-display');
    const headerCountEl = document.getElementById('cart-header-count');

    const count = cart.reduce((s, c) => s + c.qty, 0);
    const total = cart.reduce((s, c) => s + c.price * c.qty, 0);

    if (countEl)      countEl.textContent = count;
    if (totalEl)      totalEl.textContent = 'LKR ' + total.toLocaleString();
    if (headerCountEl) headerCountEl.textContent = count + (count === 1 ? ' item' : ' items');

    if (!bodyEl) return;

    if (cart.length === 0) {
      bodyEl.innerHTML = `
        <div class="cart-empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
            <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4zM3 6h18"/>
            <path d="M16 10a4 4 0 01-8 0"/>
          </svg>
          <h4>Your bag is empty</h4>
          <p>Discover pieces you love</p>
          <a href="shop.html" class="btn-shop-empty">Shop Now</a>
        </div>`;
      if (footerEl) footerEl.style.display = 'none';
    } else {
      bodyEl.innerHTML = cart.map(item => `
        <div class="cart-item">
          <img class="cart-item-img" src="${item.img || ''}" alt="${item.name}"
               onerror="this.style.background='#e8e8e8';this.src=''">
          <div class="cart-item-details">
            <div class="cart-item-top">
              <div>
                <div class="cart-item-name">${item.name}</div>
                <div class="cart-item-variant">Size: ${item.size || 'M'}${item.color ? ` · <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${item.color};border:1px solid rgba(0,0,0,.2);vertical-align:middle"></span> ${item.color}` : ''} &nbsp;·&nbsp; LKR ${item.price.toLocaleString()}</div>
              </div>
              <button class="cart-item-remove" onclick="ALIVE_CART.remove(${item.id},'${item.size || ''}')" title="Remove">✕</button>
            </div>
            <div class="cart-item-controls">
              <div class="qty-ctrl">
                <button class="qty-btn" onclick="ALIVE_CART.changeQty(${item.id},'${item.size || ''}', -1)">−</button>
                <span class="qty-val">${item.qty}</span>
                <button class="qty-btn" onclick="ALIVE_CART.changeQty(${item.id},'${item.size || ''}', 1)">+</button>
              </div>
              <div class="cart-item-price">LKR ${(item.price * item.qty).toLocaleString()}</div>
            </div>
          </div>
        </div>`).join('');
      if (footerEl) footerEl.style.display = 'block';
    }
  }

  /* ── public API ── */
  window.ALIVE_CART = {
    open() {
      document.getElementById('cart-sidebar')?.classList.add('open');
      document.getElementById('cart-overlay')?.classList.add('open');
      document.body.style.overflow = 'hidden';
    },
    close() {
      document.getElementById('cart-sidebar')?.classList.remove('open');
      document.getElementById('cart-overlay')?.classList.remove('open');
      document.body.style.overflow = '';
    },
    add(product, qty, size, color) {
      const cart = getCart();
      const key = `${product.id}_${size}`;
      const existing = cart.find(c => c.id === product.id && c.size === size);
      if (existing) existing.qty += (qty || 1);
      else cart.push({ ...product, qty: qty || 1, size: size || product.sizes?.[0] || 'M', selectedColor: color, color: color || product.colors?.[0] || '' });
      setCart(cart);
      renderCartSidebar();
      ALIVE_CART.open();
      ALIVE_CART.toast(`${product.name} added to bag`);
    },
    remove(id, size) {
      const cart = getCart().filter(c => !(c.id == id && c.size === size));
      setCart(cart);
      renderCartSidebar();
      ALIVE_CART.toast('Item removed');
    },
    changeQty(id, size, delta) {
      const cart = getCart();
      const item = cart.find(c => c.id == id && c.size === size);
      if (item) {
        item.qty += delta;
        if (item.qty <= 0) { setCart(cart.filter(c => !(c.id == id && c.size === size))); }
        else setCart(cart);
      }
      renderCartSidebar();
    },
    goCheckout() {
      const loggedIn = localStorage.getItem('aliveSession') || localStorage.getItem('alive-user');
      if (!loggedIn) {
        ALIVE_CART.close();
        ALIVE_CART.toast('Please sign in to checkout');
        setTimeout(() => window.location.href = 'login.html', 800);
        return;
      }
      const cart = getCart();
      const sub = cart.reduce((s, c) => s + c.price * c.qty, 0);
      const shipping = sub >= 5000 ? 0 : 350;
      localStorage.setItem('alive-checkout', JSON.stringify({ items: cart, subtotal: sub, shipping, discount: 0, total: sub + shipping }));
      window.location.href = 'checkout.html';
    },
    toast(msg) {
      let t = document.getElementById('alive-toast');
      if (!t) {
        t = document.createElement('div');
        t.id = 'alive-toast';
        t.style.cssText = `position:fixed;bottom:30px;left:50%;transform:translateX(-50%) translateY(20px);
          background:#0a0a0a;color:#f8f8f8;font-family:'Barlow Condensed',sans-serif;
          font-size:13px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;
          padding:14px 28px;z-index:99999;opacity:0;transition:all .3s;pointer-events:none;
          white-space:nowrap;max-width:calc(100vw - 32px);overflow:hidden;text-overflow:ellipsis;
          text-align:center;`;
        document.body.appendChild(t);
      }
      t.textContent = msg;
      t.style.opacity = '1'; t.style.transform = 'translateX(-50%) translateY(0)';
      clearTimeout(t._tid);
      t._tid = setTimeout(() => { t.style.opacity = '0'; t.style.transform = 'translateX(-50%) translateY(20px)'; }, 3000);
    },
    render: renderCartSidebar
  };

  /* ── init ── */
  document.addEventListener('DOMContentLoaded', () => {
    renderCartSidebar();
    // close on overlay click
    document.getElementById('cart-overlay')?.addEventListener('click', ALIVE_CART.close);
  });

})();
