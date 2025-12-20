(function () {
  const root = document.querySelector('[data-jh]');
  if (!root) return;

  const productsEl = root.querySelector('[data-products-json]');
  const products = productsEl ? JSON.parse(productsEl.textContent || '[]') : [];

  const heroBase = root.querySelector('[data-hero-base]');
  const heroOverlay = root.querySelector('[data-hero-overlay]');

  const titleEl = root.querySelector('[data-title]');
  const priceEl = root.querySelector('[data-price]');

  const col1 = root.querySelector('[data-info-col-1]');
  const col2 = root.querySelector('[data-info-col-2]');
  const sizesEl = root.querySelector('[data-sizes]');

  const prevBtn = root.querySelector('[data-prev]');
  const nextBtn = root.querySelector('[data-next]');
  const addBtn = root.querySelector('[data-add-to-cart]');

  const dropzone = root.querySelector('[data-dropzone]');
  const thumbs = Array.from(root.querySelectorAll('[data-thumb]'));

  const cartOpenBtn = root.querySelector('[data-cart-open]');
  const cartCloseBtn = root.querySelector('[data-cart-close]');
  const cartBackBtn = root.querySelector('[data-cart-back]');
  const cartItemsEl = root.querySelector('[data-cart-items]');
  const cartSubtotalEl = root.querySelector('[data-cart-subtotal]');
  const cartNoticeEl = root.querySelector('[data-cart-notice]');

  const sizeChartModal = root.querySelector('[data-sizechart-modal]');
  const sizeChartOpenBtn = root.querySelector('[data-sizechart-open]');
  const sizeChartCloseBtns = Array.from(root.querySelectorAll('[data-sizechart-close]'));

  let currentIndex = 0;
  let selectedVariantId = null;

  // Build a lookup: variantId -> variant metadata (inventory policy, etc.)
  const variantById = new Map();
  products.forEach(p => {
    (p.variants || []).forEach(v => {
      variantById.set(String(v.id), v);
    });
  });

  function safeTextFromHtml(html) {
    const div = document.createElement('div');
    div.innerHTML = html || '';
    div.querySelectorAll('br').forEach(br => br.replaceWith('\n'));
    return (div.innerText || '').trim();
  }

  function splitToLines(text) {
    return String(text || '')
      .split('\n')
      .map(s => s.trim())
      .filter(Boolean);
  }

  function setActiveThumb(index) {
    thumbs.forEach(t => t.classList.remove('is-active'));
    if (thumbs[index]) thumbs[index].classList.add('is-active');
  }

  function setCartOpen(isOpen) {
    root.classList.toggle('is-cartOpen', isOpen);
    const cartEl = root.querySelector('[data-cart]');
    if (cartEl) cartEl.hidden = !isOpen;
  }

  function formatMoney(cents) {
    if (window.Shopify && typeof window.Shopify.formatMoney === 'function') {
      return window.Shopify.formatMoney(cents);
    }
    return `$${(cents / 100).toFixed(2)}`;
  }

  function showCartNotice(message) {
    if (!cartNoticeEl) return;
    const msg = String(message || '').trim();
    if (!msg) {
      cartNoticeEl.hidden = true;
      cartNoticeEl.textContent = '';
      return;
    }
    cartNoticeEl.hidden = false;
    cartNoticeEl.textContent = msg;
  }

  function inventoryIsEnforced(variantId) {
    const v = variantById.get(String(variantId));
    if (!v) return null;

    // If inventoryManagement is null, Shopify is not tracking inventory.
    // If inventoryPolicy is "continue", Shopify will allow overselling/backorders.
    const tracked = v.inventoryManagement && String(v.inventoryManagement).toLowerCase() === 'shopify';
    const deny = String(v.inventoryPolicy).toLowerCase() === 'deny';

    return tracked && deny;
  }

  async function getCart() {
    const res = await fetch('/cart.js', { headers: { Accept: 'application/json' } });
    return await res.json();
  }

  async function changeLine(line, quantity) {
    const res = await fetch('/cart/change.js', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ line, quantity })
    });
    // Even when clamped, Shopify returns 200 + cart JSON.
    if (!res.ok) {
      try {
        const data = await res.json();
        throw new Error(data?.description || data?.message || 'Unable to update cart.');
      } catch (_) {
        throw new Error('Unable to update cart.');
      }
    }
    return await res.json();
  }

  async function addToCart(variantId) {
    const res = await fetch('/cart/add.js', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ id: Number(variantId), quantity: 1 })
    });
    return res;
  }

  function renderCart(cartData) {
    cartItemsEl.innerHTML = '';

    if (!cartData.items || cartData.items.length === 0) {
      cartItemsEl.innerHTML = `<div style="padding:10px;">Your cart is empty.</div>`;
      cartSubtotalEl.textContent = formatMoney(0);
      return;
    }

    cartSubtotalEl.textContent = formatMoney(cartData.total_price);

    cartData.items.forEach((item, idx) => {
      const line = idx + 1;
      const row = document.createElement('div');
      row.className = 'jh__cartRow';

      row.innerHTML = `
        <div>
          ${item.image ? `<img class="jh__cartImg" src="${item.image}" alt="">` : ''}
        </div>
        <div>
          <div class="jh__cartLineTitle">${item.product_title || ''}</div>
          ${item.variant_title ? `<div class="jh__cartLineVariant">${item.variant_title}</div>` : ''}
          <div class="jh__cartLinePrice">${formatMoney(item.final_line_price)}</div>
        </div>
        <div style="display:grid; gap:8px; justify-items:end;">
          <input class="jh__qty" type="number" min="0" value="${item.quantity}" data-line="${line}">
          <button class="jh__remove" type="button" data-remove data-line="${line}">remove</button>
        </div>
      `;

      cartItemsEl.appendChild(row);
    });
  }

  async function refreshCart() {
    const cartData = await getCart();
    renderCart(cartData);
    return cartData;
  }

  function findSizeOptionIndex(product) {
    const names = Array.isArray(product.optionNames) ? product.optionNames : [];
    return names.findIndex(n => String(n).toLowerCase() === 'size');
  }

  function getSizeMapFromVariants(product) {
    const variants = Array.isArray(product.variants) ? product.variants : [];
    const sizeIdx = findSizeOptionIndex(product);
    if (sizeIdx < 0) return [];

    const map = variants
      .map(v => {
        const label = (v.options && v.options[sizeIdx]) ? String(v.options[sizeIdx]) : '';
        return { label, variantId: v.id, available: !!v.available, priceText: v.priceText || '' };
      })
      .filter(x => x.label);

    const seen = new Set();
    const uniq = [];
    for (const x of map) {
      if (seen.has(x.label)) continue;
      seen.add(x.label);
      uniq.push(x);
    }

    const allNum = uniq.length && uniq.every(x => !Number.isNaN(Number(x.label)));
    if (allNum) uniq.sort((a, b) => Number(a.label) - Number(b.label));

    return uniq;
  }

  function renderSizePicker(product) {
    if (!sizesEl) return;

    const sizeMap = getSizeMapFromVariants(product);

    if (!sizeMap.length) {
      sizesEl.innerHTML = '';
      selectedVariantId = product.variantId || null;
      return;
    }

    const defaultChoice = sizeMap.find(x => x.available) || sizeMap[0];
    selectedVariantId = defaultChoice.variantId;
    if (defaultChoice.priceText) priceEl.textContent = defaultChoice.priceText;

    sizesEl.innerHTML = sizeMap.map(x => {
      const active = x.variantId === selectedVariantId ? 'is-active' : '';
      const sold = x.available ? '' : 'is-soldout';
      const disabledAttr = x.available ? '' : 'disabled aria-disabled="true"';
      return `<button class="jh__sizeBtn ${active} ${sold}" type="button" data-size-variant="${x.variantId}" ${disabledAttr}>${x.label}</button>`;
    }).join('');
  }

  function fillColumns(product) {
    const featuresText = safeTextFromHtml(product.descriptionHtml);
    const featuresLines = splitToLines(featuresText);
    col1.innerHTML = featuresLines.map(x => `<div>${x}</div>`).join('');

    const modelLines = splitToLines(product.modelInfo);
    col2.innerHTML = modelLines.map(x => `<div>${x}</div>`).join('');
  }

  function render(index) {
    if (!products.length) return;

    currentIndex = (index + products.length) % products.length;
    const p = products[currentIndex];

    const baseSrc = (p.images && p.images[0]) || '';
    heroBase.src = baseSrc;
    heroBase.alt = p.title || '';

    heroOverlay.style.opacity = 0;
    heroOverlay.src = '';
    heroOverlay.alt = '';

    titleEl.textContent = p.title || '';
    priceEl.textContent = p.priceText || '';

    fillColumns(p);
    renderSizePicker(p);
    setActiveThumb(currentIndex);

    if (addBtn) {
      addBtn.disabled = false;
      addBtn.setAttribute('aria-disabled', 'false');
    }
  }

  function setSizeChartOpen(isOpen) {
    if (!sizeChartModal) return;
    sizeChartModal.hidden = !isOpen;
    sizeChartModal.setAttribute('aria-hidden', String(!isOpen));
    document.body.style.overflow = isOpen ? 'hidden' : '';
  }

  thumbs.forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.getAttribute('data-index'));
      if (!Number.isNaN(idx)) render(idx);
    });

    btn.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', btn.getAttribute('data-index') || '0');
      e.dataTransfer.effectAllowed = 'copy';
    });
  });

  prevBtn?.addEventListener('click', () => render(currentIndex - 1));
  nextBtn?.addEventListener('click', () => render(currentIndex + 1));

  dropzone?.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });

  dropzone?.addEventListener('drop', (e) => {
    e.preventDefault();
    const idx = Number(e.dataTransfer.getData('text/plain'));
    if (!Number.isNaN(idx)) render(idx);
  });

  sizesEl?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-size-variant]');
    if (!btn) return;
    if (btn.disabled) return;

    selectedVariantId = Number(btn.getAttribute('data-size-variant'));
    sizesEl.querySelectorAll('.jh__sizeBtn').forEach(b => b.classList.remove('is-active'));
    btn.classList.add('is-active');

    // Clear any cart notices when changing size
    showCartNotice('');
  });

  addBtn?.addEventListener('click', async () => {
    const p = products[currentIndex];
    const vid = selectedVariantId || (p ? p.variantId : null);
    if (!p || !vid) return;

    showCartNotice('');

    // If inventory isn't enforced, tell you immediately (this matches your current behavior).
    const enforced = inventoryIsEnforced(vid);
    if (enforced === false) {
      showCartNotice(
        "Inventory isn’t enforced for this item (variant is set to continue selling or inventory isn’t tracked). Turn OFF “Continue selling when out of stock” and enable “Track quantity” on the variant."
      );
    }

    addBtn.disabled = true;

    try {
      const res = await addToCart(vid);

      if (!res.ok) {
        let msg = 'Unable to add item.';
        try {
          const data = await res.json();
          msg = data?.description || data?.message || msg;
        } catch (_) {}
        showCartNotice(msg);
        throw new Error(msg);
      }

      setCartOpen(true);
      await refreshCart();

      const old = addBtn.textContent;
      addBtn.textContent = 'added';
      setTimeout(() => (addBtn.textContent = old), 800);
    } catch (err) {
      console.error(err);
      const old = addBtn.textContent;
      addBtn.textContent = 'error';
      setTimeout(() => (addBtn.textContent = old), 900);
    } finally {
      addBtn.disabled = false;
    }
  });

  cartOpenBtn?.addEventListener('click', async (e) => {
    e.preventDefault();
    setCartOpen(true);
    showCartNotice('');
    await refreshCart();
  });

  cartCloseBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    setCartOpen(false);
    showCartNotice('');
  });

  cartBackBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    setCartOpen(false);
    showCartNotice('');
  });

  cartItemsEl?.addEventListener('change', async (e) => {
    const qtyInput = e.target.closest('.jh__qty');
    if (!qtyInput) return;

    const line = Number(qtyInput.dataset.line);
    const requested = Math.max(0, Number(qtyInput.value || 0));

    try {
      showCartNotice('');
      const cart = await changeLine(line, requested);
      renderCart(cart);

      const item = cart.items && cart.items[line - 1] ? cart.items[line - 1] : null;

      // If Shopify clamps (Policy A), requested will differ from actual quantity.
      if (requested > 0 && item && Number(item.quantity) < requested) {
        showCartNotice(`Limited stock — quantity updated to ${item.quantity}.`);
        return;
      }

      // If it did NOT clamp, but inventory isn't enforced, explain why (so you’re not guessing).
      if (requested > 0 && item) {
        const enforced = inventoryIsEnforced(item.variant_id);
        if (enforced === false) {
          showCartNotice(
            "Note: inventory isn’t being enforced for this item (variant set to continue selling or inventory isn’t tracked). Policy A requires Track quantity ON + Continue selling OFF."
          );
        }
      }

      if (requested > 0 && !item) {
        showCartNotice('Item unavailable — cart updated.');
      }
    } catch (err) {
      console.error(err);
      showCartNotice('Unable to update quantity.');
      await refreshCart();
    }
  });

  cartItemsEl?.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-remove]');
    if (!btn) return;

    const line = Number(btn.dataset.line);

    try {
      showCartNotice('');
      const cart = await changeLine(line, 0);
      renderCart(cart);
    } catch (err) {
      console.error(err);
      showCartNotice('Unable to update cart.');
      await refreshCart();
    }
  });

  sizeChartOpenBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    if (sizeChartOpenBtn.disabled) return;
    setSizeChartOpen(true);
  });

  sizeChartCloseBtns.forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      setSizeChartOpen(false);
    });
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') setSizeChartOpen(false);
  });

  if (products.length) render(0);
})();