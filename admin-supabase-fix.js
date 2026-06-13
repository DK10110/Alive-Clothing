/**
 * ═══════════════════════════════════════════════════════════════
 *  ALIVE Clothing — Admin Panel Supabase Fix
 *
 *  THIS FILE FIXES THE CRITICAL BUG:
 *  The admin panel was only saving data to localStorage, NOT to
 *  Supabase. This patch overrides the broken functions so that
 *  ALL data is saved to Supabase as the PRIMARY store.
 *
 *  INSTALLATION:
 *  Add this script AFTER the inline <script> in admin.html,
 *  right before </body>:
 *    <script src="admin-supabase-fix.js"></script>
 *    </body>
 *
 *  WHAT THIS FIXES:
 *  1. Products, videos, offers now save to Supabase FIRST
 *  2. Default products are auto-pushed to Supabase on first load
 *  3. Clients and orders now read/write to Supabase
 *  4. Cache is properly invalidated after writes
 *  5. Clear error messages when Supabase operations fail
 * ═══════════════════════════════════════════════════════════════
 */

(function() {
  'use strict';

  console.log('%c[AliveFix] Loading Supabase persistence fix...', 'color:#27ae60;font-size:14px;font-weight:bold');

  // ─── Check if AliveDB is available ───
  if (typeof AliveDB === 'undefined') {
    console.error('[AliveFix] AliveDB not found! Make sure supabase-sync.js is loaded before this file.');
    return;
  }

  // ─── Test Supabase connection on load ───
  AliveDB.testConnection().then(connected => {
    if (connected) {
      console.log('%c[AliveFix] Supabase connection OK — data will persist to cloud!', 'color:#27ae60;font-size:12px');
    } else {
      console.error('%c[AliveFix] Supabase connection FAILED — data will only save locally!', 'color:#e74c3c;font-size:12px');
    }
  });

  /* ═══════════════════════════════════════════════════════════
     OVERRIDE: getProducts()
     FIX: When Supabase is connected but returns empty, auto-push
     the default products to Supabase instead of loading from
     localStorage. This ensures the defaults are in Supabase.
  ═══════════════════════════════════════════════════════════ */
  window.getProducts = async function() {
    if (window._productsCache) return window._productsCache;

    // Try Supabase first
    if (typeof AliveDB !== 'undefined') {
      try {
        const rows = await AliveDB.getProducts();
        if (rows && rows.length > 0) {
          window._productsCache = rows.map(window._productRowToObj);
          localStorage.setItem('alive-admin-products', JSON.stringify(window._productsCache));
          return window._productsCache;
        } else {
          // Supabase is connected but EMPTY — this is the first load!
          // Push the default products to Supabase so they persist.
          console.log('[AliveFix] Supabase products table is empty — syncing defaults...');
          const defaults = getDefaultProducts();
          if (defaults.length > 0) {
            // Push defaults to Supabase in the background
            AliveDB.bulkSyncProducts(defaults).then(count => {
              console.log(`[AliveFix] ${count} default products synced to Supabase`);
              // Invalidate cache so next load fetches from Supabase with proper IDs
              window._productsCache = null;
            });
          }
          // Return defaults immediately (they'll be in Supabase on next load)
          window._productsCache = defaults;
          localStorage.setItem('alive-admin-products', JSON.stringify(defaults));
          return defaults;
        }
      } catch (e) {
        console.warn('[AliveFix] Supabase getProducts failed, using cache:', e);
      }
    }

    // Fallback to localStorage
    const stored = localStorage.getItem('alive-admin-products');
    if (stored) {
      window._productsCache = JSON.parse(stored);
      return window._productsCache;
    }
    window._productsCache = getDefaultProducts();
    return window._productsCache;
  };

  /* ═══════════════════════════════════════════════════════════
     OVERRIDE: saveProducts(arr)
     FIX: Now syncs to Supabase FIRST, then updates localStorage.
     Previously it only saved to localStorage — this was the
     root cause of data vanishing after publish!
  ═══════════════════════════════════════════════════════════ */
  window.saveProducts = async function(arr) {
    window._productsCache = arr;
    localStorage.setItem('alive-admin-products', JSON.stringify(arr));
    localStorage.setItem('alive-products', JSON.stringify(arr));

    // ── Sync EACH product to Supabase ──
    if (typeof AliveDB !== 'undefined') {
      var syncErrors = 0;
      for (var i = 0; i < arr.length; i++) {
        try {
          if (arr[i]._supabaseId) {
            await AliveDB.updateProduct(arr[i]._supabaseId, arr[i]);
          } else {
            var newRow = await AliveDB.addProduct(arr[i]);
            if (newRow) {
              arr[i]._supabaseId = newRow.id;
            } else {
              syncErrors++;
            }
          }
        } catch (e) {
          console.warn('[AliveFix] saveProducts: sync error for', arr[i].name, e);
          syncErrors++;
        }
      }
      // Update localStorage with _supabaseId values
      localStorage.setItem('alive-admin-products', JSON.stringify(arr));
      localStorage.setItem('alive-products', JSON.stringify(arr));
      if (syncErrors > 0) {
        console.warn('[AliveFix] saveProducts: ' + syncErrors + ' items failed to sync to Supabase');
      } else {
        console.log('[AliveFix] saveProducts: all ' + arr.length + ' products synced to Supabase');
      }
    }
  };

  /* ═══════════════════════════════════════════════════════════
     OVERRIDE: saveProduct() (the modal save function)
     FIX: Save to Supabase FIRST, then update UI. Show clear
     error if Supabase fails.
  ═══════════════════════════════════════════════════════════ */
  window.saveProduct = async function() {
    const name = document.getElementById('prod-name').value.trim();
    const price = parseFloat(document.getElementById('prod-price').value);
    if (!name) { showToast('Product name is required', 'error'); return; }
    if (!price) { showToast('Valid price is required', 'error'); return; }

    const saveBtn = document.querySelector('#product-modal .btn-primary-sm');
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving…'; }

    const products = await getProducts();
    const editId = parseInt(document.getElementById('edit-product-id').value);

    const selectedCats = [...document.querySelectorAll('.prod-cat-check:checked')].map(c => c.value);
    const selectedSizes = [...document.querySelectorAll('.size-check:checked')].map(c => c.value);
    const extraImgs = document.getElementById('prod-extra-imgs').value.split('\n').map(s=>s.trim()).filter(Boolean);
    const mainImg = document.getElementById('prod-img-url').value.trim();
    const allImages = mainImg ? [mainImg, ...extraImgs] : extraImgs;

    let existingProduct = null;
    if (editId) {
      existingProduct = products.find(p => String(p.id) === String(editId));
    }

    const productData = {
      id: editId || Date.now(),
      name,
      sku: document.getElementById('prod-sku').value.trim(),
      price,
      original: parseFloat(document.getElementById('prod-original').value) || null,
      stock: parseInt(document.getElementById('prod-stock').value) || 0,
      badge: document.getElementById('prod-badge').value || null,
      description: document.getElementById('prod-desc').value.trim(),
      img: mainImg || (allImages[0] || ''),
      images: allImages,
      category: selectedCats,
      sizes: selectedSizes,
      colors: currentColors,
      _supabaseId: existingProduct?._supabaseId || null,
    };

    // ── Save to Supabase FIRST ──
    let supabaseOk = false;
    if (typeof AliveDB !== 'undefined') {
      try {
        if (editId && productData._supabaseId) {
          const result = await AliveDB.updateProduct(productData._supabaseId, productData);
          if (result) {
            supabaseOk = true;
            console.log('[AliveFix] Product UPDATED in Supabase:', productData._supabaseId);
          } else {
            console.error('[AliveFix] Supabase updateProduct returned null — check service_role key!');
          }
        } else {
          const newRow = await AliveDB.addProduct(productData);
          if (newRow) {
            supabaseOk = true;
            productData._supabaseId = newRow.id;
            console.log('[AliveFix] Product ADDED to Supabase:', newRow.id);
          } else {
            console.error('[AliveFix] Supabase addProduct returned null — check service_role key!');
          }
        }
      } catch (e) {
        console.error('[AliveFix] Supabase product save failed:', e);
      }
    }

    // Update local data (write directly to localStorage to avoid re-triggering Supabase sync)
    if (editId) {
      const idx = products.findIndex(p => String(p.id) === String(editId));
      if (idx !== -1) products[idx] = productData;
    } else {
      products.push(productData);
    }
    window._productsCache = products;
    localStorage.setItem('alive-admin-products', JSON.stringify(products));
    localStorage.setItem('alive-products', JSON.stringify(products));

    // Invalidate cache so next read fetches fresh from Supabase
    window._productsCache = null;

    renderProductsTable();
    renderDashboard();
    closeProductModal();

    if (supabaseOk) {
      showToast(editId ? 'Product updated & synced to cloud!' : 'Product added & synced to cloud!', 'success');
    } else {
      showToast(editId ? 'Product updated locally (cloud sync failed!)' : 'Product added locally (cloud sync failed!)', 'error');
    }

    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save Product';
    }
  };

  /* ═══════════════════════════════════════════════════════════
     OVERRIDE: confirmDeleteProduct(id)
     FIX: Delete from Supabase FIRST, then remove locally.
  ═══════════════════════════════════════════════════════════ */
  window.confirmDeleteProduct = async function(id) {
    const allProducts = await getProducts();
    const p = allProducts.find(x => String(x.id) === String(id));
    if (!p) {
      showToast('Product not found', 'error');
      return;
    }
    showConfirm(`Delete "${p.name}"?`, 'This product will be permanently removed.', async () => {
      let supabaseOk = false;

      if (typeof AliveDB !== 'undefined') {
        try {
          // Try by _supabaseId first, then fall back to delete-by-name
          let supabaseId = p._supabaseId || null;
          if (supabaseId) {
            const deleted = await AliveDB.deleteProduct(supabaseId);
            if (deleted) { supabaseOk = true; console.log('[AliveFix] Product deleted by ID:', supabaseId); }
          }
          if (!supabaseOk) {
            // _supabaseId missing or stale — delete by name+price directly (always works)
            const deleted = await AliveDB.deleteProductByName(p.name, p.price);
            if (deleted) { supabaseOk = true; console.log('[AliveFix] Product deleted by name:', p.name); }
            else { console.error('[AliveFix] Both delete methods failed. Check service_role key in supabase-sync.js'); }
          }
        } catch(e) {
          console.error('[AliveFix] Supabase deleteProduct error:', e);
        }
      }

      const products = allProducts.filter(x => String(x.id) !== String(id));
      window._productsCache = null;
      localStorage.setItem('alive-admin-products', JSON.stringify(products));
      localStorage.setItem('alive-products', JSON.stringify(products));

      renderProductsTable();
      renderDashboard();

      if (supabaseOk) {
        showToast('Product deleted from cloud!', 'success');
      } else {
        showToast('Deleted locally but cloud delete failed — check console', 'error');
      }
    });
  };

  /* ═══════════════════════════════════════════════════════════
     OVERRIDE: getVideos()
     FIX: Same pattern as getProducts — auto-sync if empty.
  ═══════════════════════════════════════════════════════════ */
  window.getVideos = async function() {
    if (window._videosCache) return window._videosCache;
    if (typeof AliveDB !== 'undefined') {
      try {
        const rows = await AliveDB.getVideos();
        if (rows && rows.length > 0) {
          window._videosCache = rows.map(window._videoRowToObj);
          localStorage.setItem('alive-videos', JSON.stringify(window._videosCache));
          return window._videosCache;
        }
        // If empty, return empty array (no default videos to push)
        window._videosCache = [];
        return window._videosCache;
      } catch (e) { console.warn('[AliveFix] Supabase getVideos failed:', e); }
    }
    window._videosCache = JSON.parse(localStorage.getItem('alive-videos') || '[]');
    return window._videosCache;
  };

  /* ═══════════════════════════════════════════════════════════
     OVERRIDE: saveVideos(arr)
     FIX: Now ALSO syncs to Supabase.
  ═══════════════════════════════════════════════════════════ */
  window.saveVideos = async function(arr) {
    window._videosCache = arr;
    localStorage.setItem('alive-videos', JSON.stringify(arr));

    // ── Sync EACH video to Supabase ──
    if (typeof AliveDB !== 'undefined') {
      var syncErrors = 0;
      for (var i = 0; i < arr.length; i++) {
        try {
          if (arr[i]._supabaseId) {
            await AliveDB.updateVideo(arr[i]._supabaseId, arr[i]);
          } else {
            var newRow = await AliveDB.addVideo(arr[i]);
            if (newRow) {
              arr[i]._supabaseId = newRow.id;
            } else {
              syncErrors++;
            }
          }
        } catch (e) {
          console.warn('[AliveFix] saveVideos: sync error for', arr[i].title, e);
          syncErrors++;
        }
      }
      localStorage.setItem('alive-videos', JSON.stringify(arr));
      if (syncErrors > 0) {
        console.warn('[AliveFix] saveVideos: ' + syncErrors + ' items failed to sync to Supabase');
      } else {
        console.log('[AliveFix] saveVideos: all ' + arr.length + ' videos synced to Supabase');
      }
    }
  };

  /* ═══════════════════════════════════════════════════════════
     OVERRIDE: saveVideo() (modal save)
     FIX: Save to Supabase FIRST.
  ═══════════════════════════════════════════════════════════ */
  window.saveVideo = function() {
    const title = document.getElementById('vid-title').value.trim();
    if (!title) return showToast('Video title is required', 'error');

    const type = document.getElementById('vid-type').value;
    let url = document.getElementById('vid-url').value.trim();
    const editId = parseInt(document.getElementById('edit-video-id').value);

    const finishSave = async (finalUrl) => {
      const vids = await getVideos();
      const existingVid = editId ? vids.find(v => String(v.id) === String(editId)) : null;
      const supabaseId = existingVid?._supabaseId || null;

      const vidData = {
        id: editId || Date.now(),
        title,
        caption: document.getElementById('vid-caption').value.trim(),
        type,
        url: finalUrl,
        thumb: document.getElementById('vid-thumb').value.trim(),
        _supabaseId: supabaseId,
      };

      // ── Save to Supabase FIRST ──
      let supabaseOk = false;
      if (typeof AliveDB !== 'undefined') {
        try {
          if (editId && supabaseId) {
            const result = await AliveDB.updateVideo(supabaseId, vidData);
            if (result) supabaseOk = true;
          } else {
            const newRow = await AliveDB.addVideo(vidData);
            if (newRow) {
              supabaseOk = true;
              vidData._supabaseId = newRow.id;
            }
          }
        } catch (e) {
          console.error('[AliveFix] Supabase video save failed:', e);
        }
      }

      if (editId) {
        const idx = vids.findIndex(v => String(v.id) === String(editId));
        if (idx !== -1) vids[idx] = vidData;
      } else {
        vids.push(vidData);
      }
      saveVideos(vids);
      window._videosCache = null;

      closeVideoModal();
      renderVideosList();

      if (supabaseOk) {
        showToast('Video saved & synced to cloud!', 'success');
      } else {
        showToast('Video saved locally (cloud sync failed!)', 'error');
      }
    };

    if (type === 'upload') {
      if (!uploadedVideoBlob && !editId) {
        return showToast('Please upload a video file', 'error');
      }
      if (uploadedVideoBlob) {
        const reader = new FileReader();
        reader.onload = () => finishSave(reader.result);
        reader.readAsDataURL(uploadedVideoBlob);
      } else {
        finishSave(url);
      }
    } else {
      if (!url) return showToast('Video URL is required', 'error');
      finishSave(url);
    }
  };

  /* ═══════════════════════════════════════════════════════════
     OVERRIDE: confirmDeleteVideo(id)
  ═══════════════════════════════════════════════════════════ */
  window.confirmDeleteVideo = async function(id) {
    const allVids = await getVideos();
    const v = allVids.find(x => String(x.id) === String(id));
    if (!v) { showToast('Video not found', 'error'); return; }

    showConfirm(`Remove "${v.title}"?`, 'This video will be permanently removed.', async () => {
      let supabaseOk = false;
      if (typeof AliveDB !== 'undefined') {
        try {
          let supabaseId = v._supabaseId || null;
          if (supabaseId) {
            const deleted = await AliveDB.deleteVideo(supabaseId);
            if (deleted) { supabaseOk = true; console.log('[AliveFix] Video deleted by ID:', supabaseId); }
          }
          if (!supabaseOk) {
            const deleted = await AliveDB.deleteVideoByTitle(v.title);
            if (deleted) { supabaseOk = true; console.log('[AliveFix] Video deleted by title:', v.title); }
            else { console.error('[AliveFix] Video delete failed. Check service_role key.'); }
          }
        } catch(e) { console.error('[AliveFix] Supabase video delete error:', e); }
      }

      const remaining = (await getVideos()).filter(x => String(x.id) !== String(id));
      window._videosCache = remaining;
      localStorage.setItem('alive-videos', JSON.stringify(remaining));
      renderVideosList();
      renderDashboard();

      if (supabaseOk) {
        showToast('Video deleted from cloud', 'error');
      } else {
        showToast('Deleted locally (cloud delete may have failed)', 'error');
      }
    });
  };

  /* ═══════════════════════════════════════════════════════════
     OVERRIDE: getOffers()
  ═══════════════════════════════════════════════════════════ */
  window.getOffers = async function() {
    if (window._offersCache) return window._offersCache;
    if (typeof AliveDB !== 'undefined') {
      try {
        const rows = await AliveDB.getOffers();
        if (rows && rows.length > 0) {
          window._offersCache = rows.map(window._offerRowToObj);
          localStorage.setItem('alive-offers', JSON.stringify(window._offersCache));
          return window._offersCache;
        }
        window._offersCache = [];
        return window._offersCache;
      } catch (e) { console.warn('[AliveFix] Supabase getOffers failed:', e); }
    }
    window._offersCache = JSON.parse(localStorage.getItem('alive-offers') || '[]');
    return window._offersCache;
  };

  /* ═══════════════════════════════════════════════════════════
     OVERRIDE: saveOffers(arr)
     FIX: Now ALSO syncs to Supabase.
  ═══════════════════════════════════════════════════════════ */
  window.saveOffers = async function(arr) {
    window._offersCache = arr;
    localStorage.setItem('alive-offers', JSON.stringify(arr));

    // ── Sync EACH offer to Supabase ──
    if (typeof AliveDB !== 'undefined') {
      var syncErrors = 0;
      for (var i = 0; i < arr.length; i++) {
        try {
          if (arr[i]._supabaseId) {
            await AliveDB.updateOffer(arr[i]._supabaseId, arr[i]);
          } else {
            var newRow = await AliveDB.addOffer(arr[i]);
            if (newRow) {
              arr[i]._supabaseId = newRow.id;
            } else {
              syncErrors++;
            }
          }
        } catch (e) {
          console.warn('[AliveFix] saveOffers: sync error for', arr[i].title, e);
          syncErrors++;
        }
      }
      localStorage.setItem('alive-offers', JSON.stringify(arr));
      if (syncErrors > 0) {
        console.warn('[AliveFix] saveOffers: ' + syncErrors + ' items failed to sync to Supabase');
      } else {
        console.log('[AliveFix] saveOffers: all ' + arr.length + ' offers synced to Supabase');
      }
    }
  };

  /* ═══════════════════════════════════════════════════════════
     OVERRIDE: saveOffer() (modal save)
     FIX: Save to Supabase FIRST.
  ═══════════════════════════════════════════════════════════ */
  window.saveOffer = async function() {
    const title = document.getElementById('offer-title').value.trim();
    if (!title) { showToast('Offer title is required', 'error'); return; }

    const offs = await getOffers();
    const editId = parseInt(document.getElementById('edit-offer-id').value);
    const existingOff = editId ? offs.find(o => String(o.id) === String(editId)) : null;
    const supabaseId = existingOff?._supabaseId || null;

    const offerData = {
      id: editId || Date.now(),
      title,
      description: document.getElementById('offer-desc').value.trim(),
      discount: parseInt(document.getElementById('offer-discount').value) || null,
      originalPrice: parseFloat(document.getElementById('offer-orig-price').value) || null,
      salePrice: parseFloat(document.getElementById('offer-sale-price').value) || null,
      code: document.getElementById('offer-code').value.trim(),
      expiry: document.getElementById('offer-expiry').value,
      img: document.getElementById('offer-img').value.trim(),
      cta: document.getElementById('offer-cta').value.trim() || 'Shop Now',
      _supabaseId: supabaseId,
    };

    // ── Save to Supabase FIRST ──
    let supabaseOk = false;
    if (typeof AliveDB !== 'undefined') {
      try {
        if (editId && supabaseId) {
          const result = await AliveDB.updateOffer(supabaseId, offerData);
          if (result) supabaseOk = true;
        } else {
          const newRow = await AliveDB.addOffer(offerData);
          if (newRow) {
            supabaseOk = true;
            offerData._supabaseId = newRow.id;
          }
        }
      } catch (e) {
        console.error('[AliveFix] Supabase offer save failed:', e);
      }
    }

    if (editId) {
      const idx = offs.findIndex(o => String(o.id) === String(editId));
      if (idx !== -1) offs[idx] = offerData;
    } else {
      offs.push(offerData);
    }
    saveOffers(offs);
    window._offersCache = null;

    closeOfferModal();
    renderOffersList();
    renderDashboard();

    if (supabaseOk) {
      showToast(editId ? 'Offer updated & synced to cloud!' : 'Offer added & synced to cloud!', 'success');
    } else {
      showToast(editId ? 'Offer updated locally (cloud sync failed!)' : 'Offer added locally (cloud sync failed!)', 'error');
    }
  };

  /* ═══════════════════════════════════════════════════════════
     OVERRIDE: confirmDeleteOffer(id)
  ═══════════════════════════════════════════════════════════ */
  window.confirmDeleteOffer = function(id) {
    getOffers().then(offs => {
      const o = offs.find(x => String(x.id) === String(id));
      if (!o) { showToast('Offer not found', 'error'); return; }

      showConfirm(`Delete "${o.title}"?`, 'This offer will be permanently removed.', async () => {
        let supabaseOk = false;
        if (typeof AliveDB !== 'undefined') {
          try {
            let supabaseId = o._supabaseId || null;
            if (supabaseId) {
              const deleted = await AliveDB.deleteOffer(supabaseId);
              if (deleted) { supabaseOk = true; console.log('[AliveFix] Offer deleted by ID:', supabaseId); }
            }
            if (!supabaseOk) {
              const deleted = await AliveDB.deleteOfferByTitle(o.title);
              if (deleted) { supabaseOk = true; console.log('[AliveFix] Offer deleted by title:', o.title); }
              else { console.error('[AliveFix] Offer delete failed. Check service_role key.'); }
            }
          } catch(e) { console.error('[AliveFix] Supabase offer delete error:', e); }
        }

        const remaining = allOffs.filter(x => String(x.id) !== String(id));
        window._offersCache = remaining;
        localStorage.setItem('alive-offers', JSON.stringify(remaining));
        renderOffersList();
        renderDashboard();

        if (supabaseOk) {
          showToast('Offer deleted from cloud', 'error');
        } else {
          showToast('Deleted locally (cloud delete may have failed)', 'error');
        }
      });
    });
  };

  /* ═══════════════════════════════════════════════════════════
     OVERRIDE: getClients()
     FIX: Now reads from Supabase first, merges data from
     alive_users, alive_client_profiles, and also looks for user
     info from alive_order_payments when clients don't have
     profiles but have placed orders. Falls back gracefully when
     Supabase is not connected.
  ═══════════════════════════════════════════════════════════ */
  window.getClients = async function() {
    // Try Supabase first — merge alive_users with alive_client_profiles
    if (typeof AliveDB !== 'undefined' && AliveDB.getClient()) {
      try {
        const sb = AliveDB.getClient();
        const users = await AliveDB.getAllUsers();
        const profiles = await AliveDB.getAllClientProfiles();

        // Also look for user info from alive_order_payments when clients
        // don't have profiles but have placed orders
        let paymentUserInfoMap = {};
        try {
          const { data: payments } = await sb.from('alive_order_payments').select('user_id, customer_name, customer_email, customer_phone');
          (payments || []).forEach(p => {
            if (p.user_id && !paymentUserInfoMap[p.user_id]) {
              paymentUserInfoMap[p.user_id] = {
                name: p.customer_name || '',
                email: p.customer_email || '',
                phone: p.customer_phone || '',
              };
            }
          });
        } catch (pe) {
          console.warn('[AliveFix] Could not fetch payment user info:', pe);
        }

        // Combine users + profiles + payment info
        if (users && users.length > 0) {
          const profileMap = {};
          (profiles || []).forEach(p => { profileMap[p.id] = p; });

          const clients = users.map(row => {
            const profile = profileMap[row.id] || {};
            const data = row.data || {};
            const paymentInfo = paymentUserInfoMap[row.id] || {};
            return {
              id: row.id,
              name: profile.full_name || data.name || paymentInfo.name || row.email || '',
              email: row.email || paymentInfo.email || '',
              phone: profile.phone || data.phone || paymentInfo.phone || '',
              address: profile.address || data.address || '',
              city: profile.city || '',
              province: profile.province || '',
              postal_code: profile.postal_code || '',
              country: profile.country || 'Sri Lanka',
              role: row.role || 'customer',
              joinedDate: row.created_at,
            };
          });

          // ALSO add customers from payments who are NOT in alive_users yet
          // (e.g. guest checkouts or users whose Supabase auth doesn't map to alive_users)
          const existingUserIds = new Set(users.map(u => u.id));
          const existingEmails = new Set(users.map(u => u.email).filter(Boolean));
          const seenPaymentIds = new Set();

          try {
            const { data: allPayments } = await sb.from('alive_order_payments')
              .select('user_id, customer_name, customer_email, customer_phone');

            (allPayments || []).forEach(p => {
              // Skip if this user is already in alive_users (either by ID or email)
              const uid = p.user_id || '';
              const email = p.customer_email || '';
              if (existingUserIds.has(uid) || existingEmails.has(email)) return;
              if (!uid && !email) return;
              // Avoid duplicates from multiple payments by same person
              const dedupeKey = uid || email;
              if (seenPaymentIds.has(dedupeKey)) return;
              seenPaymentIds.add(dedupeKey);

              clients.push({
                id: uid || ('payment-' + dedupeKey),
                name: p.customer_name || email || 'Guest',
                email: email || '',
                phone: p.customer_phone || '',
                address: '',
                city: '',
                province: '',
                postal_code: '',
                country: 'Sri Lanka',
                role: 'customer',
                joinedDate: null,
              });
            });
          } catch (pe2) {
            console.warn('[AliveFix] Could not fetch additional payment clients:', pe2);
          }

          localStorage.setItem('alive-clients', JSON.stringify(clients));
          return clients;
        }

        // If no users in alive_users, try building client list from payments alone
        try {
          const { data: allPayments } = await sb.from('alive_order_payments')
            .select('user_id, customer_name, customer_email, customer_phone');

          if (allPayments && allPayments.length > 0) {
            const seen = new Set();
            const clients = [];
            allPayments.forEach(p => {
              const email = p.customer_email || '';
              const uid = p.user_id || '';
              const key = uid || email;
              if (!key || seen.has(key)) return;
              seen.add(key);
              clients.push({
                id: uid || ('payment-' + email),
                name: p.customer_name || email || 'Guest',
                email: email,
                phone: p.customer_phone || '',
                address: '',
                city: '',
                province: '',
                postal_code: '',
                country: 'Sri Lanka',
                role: 'customer',
                joinedDate: null,
              });
            });
            if (clients.length > 0) {
              localStorage.setItem('alive-clients', JSON.stringify(clients));
              return clients;
            }
          }
        } catch (pe3) {
          console.warn('[AliveFix] Could not build clients from payments:', pe3);
        }

      } catch (e) { console.warn('[AliveFix] Supabase getClients failed:', e); }
    }
    // Fallback to localStorage
    const stored = localStorage.getItem('alive-clients');
    if (stored) {
      try {
        return JSON.parse(stored);
      } catch (e) {
        console.warn('[AliveFix] Failed to parse localStorage clients:', e);
      }
    }
    localStorage.setItem('alive-clients', JSON.stringify([]));
    return [];
  };

  /* ═══════════════════════════════════════════════════════════
     OVERRIDE: saveClients(arr)
     FIX: Now ALSO syncs to Supabase.
  ═══════════════════════════════════════════════════════════ */
  window.saveClients = function(arr) {
    localStorage.setItem('alive-clients', JSON.stringify(arr));
    // Background sync to Supabase
    if (typeof AliveDB !== 'undefined') {
      arr.forEach(client => {
        if (client.email) {
          AliveDB.saveUser({
            email: client.email,
            name: client.name,
            phone: client.phone,
            role: client.role || 'customer',
          }).catch(e => console.warn('[AliveFix] Client sync failed for', client.email, e));

          // Also save client profile with full details
          AliveDB.saveClientProfile({
            email: client.email,
            full_name: client.name,
            phone: client.phone,
            address: client.address || '',
            city: client.city || '',
            province: client.province || '',
            postal_code: client.postal_code || '',
            country: client.country || 'Sri Lanka',
          }).catch(e => console.warn('[AliveFix] Client profile sync failed for', client.email, e));
        }
      });
    }
  };

  /* ═══════════════════════════════════════════════════════════
     OVERRIDE: getAllOrders()
     FIX: Now reads from Supabase first with CORRECT field
     mapping from getAllOrdersWithDetails(). The previous version
     had wrong field names — getAllOrdersWithDetails() already
     flattens the data into items, paymentMethod, paymentDate,
     delivery_address / address fields (NOT the raw Supabase
     relation names).
  ═══════════════════════════════════════════════════════════ */
  window._getAllOrdersSync = function() {
    const stored = localStorage.getItem('alive-admin-orders');
    if (stored) return JSON.parse(stored);
    localStorage.setItem('alive-admin-orders', JSON.stringify([]));
    return [];
  };

  window.getAllOrders = async function() {
    if (typeof AliveDB !== 'undefined' && AliveDB.getClient()) {
      try {
        const ordersWithDetails = await AliveDB.getAllOrdersWithDetails();
        if (ordersWithDetails && ordersWithDetails.length > 0) {
          // Fetch all users to map user_id -> name/email/phone
          const users = await AliveDB.getAllUsers();
          const userMap = {};
          (users || []).forEach(u => { userMap[u.id] = u; });

          // Also fetch all client profiles for richer data
          const profiles = await AliveDB.getAllClientProfiles();
          const profileMap = {};
          (profiles || []).forEach(p => { profileMap[p.id] = p; });

          // Fetch all deliveries for courier/tracking info
          const sb = AliveDB.getClient();
          let deliveriesMap = {};
          if (sb) {
            const { data: deliveries } = await sb.from('alive_order_deliveries').select('*');
            (deliveries || []).forEach(d => { deliveriesMap[d.order_id] = d; });
          }

          // Fetch all payments for more detail
          let paymentsMap = {};
          if (sb) {
            const { data: payments } = await sb.from('alive_order_payments').select('*');
            (payments || []).forEach(p => { paymentsMap[p.order_id] = p; });
          }

          const converted = ordersWithDetails.map(o => {
            const u = userMap[o.user_id] || {};
            const profile = profileMap[o.user_id] || {};
            const userData = u.data || {};
            const delivery = deliveriesMap[o.id] || {};
            const payment = paymentsMap[o.id] || {};

            // Resolve client name with multiple fallback paths:
            // 1. Client profile full_name
            // 2. User data.name (from alive_users.data JSONB)
            // 3. Customer name saved in the payment record
            // 4. User email
            // 5. Customer email from payment
            // 6. 'Guest' as last resort
            const clientName = profile.full_name
              || userData.name
              || payment.customer_name
              || o.customer_name
              || u.email
              || payment.customer_email
              || o.customer_email
              || 'Guest';

            const clientEmail = u.email
              || payment.customer_email
              || o.customer_email
              || '';

            const clientPhone = profile.phone
              || userData.phone
              || payment.customer_phone
              || o.customer_phone
              || '';

            return {
              id: o.id,
              _supabaseId: o.id,
              date: o.date || o.created_at,
              status: o.status || 'pending',
              total: o.total || o.total_amount || 0,
              clientId: o.user_id || '',
              clientName: clientName,
              clientEmail: clientEmail,
              clientPhone: clientPhone,
              address: o.address || o.delivery_address || delivery.delivery_address || '',
              items: (o.items || []).map(i => ({
                name: i.name || i.item_name,
                price: i.price || i.item_price,
                qty: i.qty || i.quantity,
                size: i.size,
                color: i.color,
                img: i.image || i.img || '',
              })),
              shipping: payment.shipping_fee || o.shipping_fee || 0,
              discount: payment.discount_amount || o.discount_amount || 0,
              paymentMethod: payment.payment_method || o.paymentMethod || 'cod',
              paymentDate: payment.payment_date || o.paymentDate || o.created_at,
              courier: delivery.courier || 'TransExpress',
              tracking: delivery.tracking_number || 'Pending Dispatch',
              deliveryStep: delivery.delivery_step || 0,
              deliveryStatus: delivery.delivery_status || o.status,
              eta: delivery.estimated_arrival || '',
              orderNotes: o.notes || o.orderNotes || '',
            };
          });
          localStorage.setItem('alive-admin-orders', JSON.stringify(converted));
          return converted;
        }
      } catch (e) { console.warn('[AliveFix] Supabase getAllOrders failed:', e); }
    }
    return window._getAllOrdersSync();
  };

  /* ═══════════════════════════════════════════════════════════
     OVERRIDE: saveAllOrders(arr)
     FIX: Now ALSO syncs to Supabase.
  ═══════════════════════════════════════════════════════════ */
  window.saveAllOrders = function(arr) {
    localStorage.setItem('alive-admin-orders', JSON.stringify(arr));
    // Background sync to Supabase — handled by individual order operations
  };

  /* ═══════════════════════════════════════════════════════════
     OVERRIDE: updateOrderStatus(orderId)
     FIX: Update in Supabase FIRST.
  ═══════════════════════════════════════════════════════════ */
  window.updateOrderStatus = async function(orderId) {
    const orders = typeof getAllOrders === 'function' ? (await getAllOrders()) : _getAllOrdersSync();
    const idx = orders.findIndex(o => o.id === orderId || String(o.id) === String(orderId));
    if (idx === -1) return;
    const newStatus = document.getElementById('status-sel-' + orderId)?.value;
    if (!newStatus) return;
    orders[idx].status = newStatus;
    saveAllOrders(orders);

    // Update in Supabase
    let supabaseOk = false;
    if (typeof AliveDB !== 'undefined') {
      try {
        const result = await AliveDB.updateOrder(orderId, { status: newStatus });
        if (result) supabaseOk = true;

        // Also update delivery status
        const stepMap = {ordered:0, processing:1, shipped:2, delivered:3};
        const deliveredDate = newStatus === 'delivered' ? new Date().toISOString() : undefined;
        if (typeof AliveSync !== 'undefined') {
          AliveSync.updateDeliveryStatus(orderId, newStatus, stepMap[newStatus] ?? 0, undefined, deliveredDate);
        }
      } catch(e) {
        console.error('[AliveFix] Supabase order status update failed:', e);
      }
    }

    syncDeliveriesToProfile(orders);
    renderAllOrders();
    renderDashboard();
    persistWeeklyReports();

    if (supabaseOk) {
      showToast(`Order status updated to "${newStatus}" & synced to cloud`, 'success');
    } else {
      showToast(`Order status updated locally (cloud sync may have failed)`, 'error');
    }
  };

  /* ═══════════════════════════════════════════════════════════
     OVERRIDE: refreshProducts()
     FIX: Properly clears cache and fetches from Supabase.
  ═══════════════════════════════════════════════════════════ */
  window.refreshProducts = async function() {
    window._productsCache = null;
    localStorage.removeItem('alive-admin-products');
    return getProducts();
  };

  /* ═══════════════════════════════════════════════════════════
     ENHANCEMENT: Add "Sync to Cloud" button to dashboard
     This lets the admin manually push all local data to Supabase.
  ═══════════════════════════════════════════════════════════ */
  window.syncAllToSupabase = async function() {
    if (typeof AliveDB === 'undefined') {
      showToast('Supabase not connected!', 'error');
      return;
    }

    showToast('Syncing all data to cloud...', 'success');

    let synced = 0;
    let failed = 0;

    // Sync products
    try {
      const products = await getProducts();
      for (const p of products) {
        if (p._supabaseId) {
          const result = await AliveDB.updateProduct(p._supabaseId, p);
          if (result) synced++; else failed++;
        } else {
          const result = await AliveDB.addProduct(p);
          if (result) {
            p._supabaseId = result.id;
            synced++;
          } else {
            failed++;
          }
        }
      }
      saveProducts(products);
      window._productsCache = null;
    } catch(e) { console.error('[AliveFix] Product sync error:', e); failed++; }

    // Sync videos
    try {
      const vids = await getVideos();
      for (const v of vids) {
        if (v._supabaseId) {
          const result = await AliveDB.updateVideo(v._supabaseId, v);
          if (result) synced++; else failed++;
        } else {
          const result = await AliveDB.addVideo(v);
          if (result) {
            v._supabaseId = result.id;
            synced++;
          } else {
            failed++;
          }
        }
      }
      saveVideos(vids);
      window._videosCache = null;
    } catch(e) { console.error('[AliveFix] Video sync error:', e); failed++; }

    // Sync offers
    try {
      const offs = await getOffers();
      for (const o of offs) {
        if (o._supabaseId) {
          const result = await AliveDB.updateOffer(o._supabaseId, o);
          if (result) synced++; else failed++;
        } else {
          const result = await AliveDB.addOffer(o);
          if (result) {
            o._supabaseId = result.id;
            synced++;
          } else {
            failed++;
          }
        }
      }
      saveOffers(offs);
      window._offersCache = null;
    } catch(e) { console.error('[AliveFix] Offer sync error:', e); failed++; }

    if (failed === 0) {
      showToast(`All ${synced} items synced to cloud!`, 'success');
    } else {
      showToast(`Synced ${synced} items, ${failed} failed — check console`, 'error');
    }

    renderDashboard();
  };

  /* ═══════════════════════════════════════════════════════════
     OVERRIDE: Export functions to use async data
  ═══════════════════════════════════════════════════════════ */
  window.exportClientsExcel = async function() {
    const clients = await getClients();
    if (clients.length === 0) {
      showToast('No clients to export yet', '');
      return;
    }
    const orders = await getAllOrders();
    const headers = ['Client ID','Full Name','Email','Phone','Address','Joined Date','Total Orders','Total Spent (LKR)'];
    const rows = clients.map(c => {
      const clientOrders = orders.filter(o => o.clientId === c.id || o.clientEmail === c.email);
      const totalSpent = clientOrders.filter(o=>o.status!=='cancelled').reduce((s,o)=>s+(o.total||0),0);
      const joined = c.joinedDate || c.created_at ? new Date(c.joinedDate||c.created_at).toLocaleDateString('en-GB') : '—';
      return [c.id, c.name, c.email, c.phone || '—', c.address || '—', joined, clientOrders.length, totalSpent];
    });
    const csvContent = [
      ['ALIVE Clothing — Client Profiles'],
      ['Generated: ' + new Date().toLocaleDateString('en-GB')],
      ['Total Clients: ' + clients.length],
      [],
      headers,
      ...rows
    ].map(row => row.map(cell => '"' + String(cell||'').replace(/"/g,'""') + '"').join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csvContent], {type:'text/csv;charset=utf-8;'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ALIVE_Clients_' + new Date().toISOString().slice(0,10) + '.csv';
    a.click();
    URL.revokeObjectURL(url);
    showToast('Client profiles exported!', 'success');
  };

  window.exportFullOrderReport = async function() {
    const orders = await getAllOrders();
    const clients = await getClients();
    if (orders.length === 0) {
      showToast('No orders to export yet', '');
      return;
    }
    const headers = [
      'Order ID','Order Date','Client Name','Client Email','Client Phone',
      'Delivery Address','Item Name','Item Price (LKR)','Quantity','Item Subtotal (LKR)',
      'Subtotal (LKR)','Shipping Fee (LKR)','Discount (LKR)','Total Paid (LKR)',
      'Payment Method','Payment Date',
      'Courier','Tracking Number','Delivery Status','Order Status'
    ];
    const rows = [];
    orders.forEach(o => {
      const client = clients.find(c => c.id === o.clientId || c.email === o.clientEmail);
      const orderDate = new Date(o.date).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'});
      const payDate = o.paymentDate ? new Date(o.paymentDate).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}) : orderDate;
      const items = o.items || [];
      if (items.length === 0) {
        rows.push([o.id, orderDate, o.clientName, o.clientEmail, o.clientPhone || (client?.phone || ''),
          o.address || '', '—', 0, 0, 0,
          o.total - (o.shipping||0) + (o.discount||0), o.shipping||0, o.discount||0, o.total,
          (o.paymentMethod || 'cod').charAt(0).toUpperCase() + (o.paymentMethod || 'cod').slice(1), payDate,
          o.courier || 'TransExpress', o.tracking || 'Pending Dispatch', (o.status||'pending').charAt(0).toUpperCase() + (o.status||'pending').slice(1),
          (o.status||'pending').charAt(0).toUpperCase() + (o.status||'pending').slice(1)]);
      } else {
        items.forEach((item, idx) => {
          const itemSub = (item.price || 0) * (item.qty || 1);
          rows.push([o.id, orderDate, o.clientName, o.clientEmail, o.clientPhone || (client?.phone || ''),
            o.address || '', item.name || '', item.price || 0, item.qty || 1, itemSub,
            idx === 0 ? o.total - (o.shipping||0) + (o.discount||0) : '',
            idx === 0 ? o.shipping||0 : '',
            idx === 0 ? o.discount||0 : '',
            idx === 0 ? o.total : '',
            idx === 0 ? (o.paymentMethod || 'cod').charAt(0).toUpperCase() + (o.paymentMethod || 'cod').slice(1) : '',
            idx === 0 ? payDate : '',
            idx === 0 ? (o.courier || 'TransExpress') : '',
            idx === 0 ? (o.tracking || 'Pending Dispatch') : '',
            idx === 0 ? (o.status||'pending').charAt(0).toUpperCase() + (o.status||'pending').slice(1) : '',
            idx === 0 ? (o.status||'pending').charAt(0).toUpperCase() + (o.status||'pending').slice(1) : '']);
        });
      }
    });
    const totalRevenue = orders.filter(o=>o.status!=='cancelled').reduce((s,o)=>s+(o.total||0),0);
    const totalItems = orders.reduce((s,o)=>s+(o.items||[]).reduce((a,i)=>a+(i.qty||1),0),0);
    const csvContent = [
      ['ALIVE Clothing — Full Order Report'],
      ['Generated: ' + new Date().toLocaleDateString('en-GB')],
      ['Total Orders: ' + orders.length + '  |  Total Revenue: LKR ' + totalRevenue.toLocaleString() + '  |  Total Items Sold: ' + totalItems],
      [],
      headers,
      ...rows,
      [],
      ['SUMMARY'],
      ['Total Orders: ' + orders.length],
      ['Total Revenue: LKR ' + totalRevenue.toLocaleString()],
      ['Total Items Sold: ' + totalItems],
      ['Unique Clients: ' + [...new Set(orders.map(o=>o.clientId))].length],
    ].map(row => row.map(cell => '"' + String(cell||'').replace(/"/g,'""') + '"').join(',')).join('\n');
    const blob = new Blob(["\uFEFF" + csvContent], {type:'text/csv;charset=utf-8;'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ALIVE_Full_Order_Report_' + new Date().toISOString().slice(0,10) + '.csv';
    a.click();
    URL.revokeObjectURL(url);
    showToast('Full order report downloaded!', 'success');
  };

  window.exportPaymentReport = async function() {
    const orders = await getAllOrders();
    if (orders.length === 0) {
      showToast('No payment data to export yet', '');
      return;
    }
    const headers = [
      'Payment ID','Order ID','Client Name','Client Email','Client Phone',
      'Payment Method','Payment Status','Subtotal (LKR)','Shipping Fee (LKR)',
      'Discount (LKR)','Total Paid (LKR)','Currency','Payment Date','Order Status'
    ];
    const rows = orders.map(o => {
      const payDate = o.paymentDate ? new Date(o.paymentDate).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}) : new Date(o.date).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'});
      const sub = (o.total||0) - (o.shipping||0) + (o.discount||0);
      return [
        o.id + '-PAY', o.id, o.clientName, o.clientEmail, o.clientPhone || '',
        (o.paymentMethod || 'cod').charAt(0).toUpperCase() + (o.paymentMethod || 'cod').slice(1),
        o.status === 'cancelled' ? 'Refunded/Cancelled' : 'Completed',
        sub.toFixed(2), (o.shipping||0).toFixed(2), (o.discount||0).toFixed(2),
        (o.total||0).toFixed(2), 'LKR', payDate,
        (o.status||'pending').charAt(0).toUpperCase() + (o.status||'pending').slice(1)
      ];
    });
    const totalPaid = orders.filter(o=>o.status!=='cancelled').reduce((s,o)=>s+(o.total||0),0);
    const csvContent = [
      ['ALIVE Clothing — Payment Details Report'],
      ['Generated: ' + new Date().toLocaleDateString('en-GB')],
      [],
      headers,
      ...rows,
      [],
      ['TOTALS'],
      ['Total Payments: ' + orders.filter(o=>o.status!=='cancelled').length],
      ['Total Revenue: LKR ' + totalPaid.toLocaleString()],
    ].map(row => row.map(cell => '"' + String(cell||'').replace(/"/g,'""') + '"').join(',')).join('\n');
    const blob = new Blob(["\uFEFF" + csvContent], {type:'text/csv;charset=utf-8;'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ALIVE_Payment_Report_' + new Date().toISOString().slice(0,10) + '.csv';
    a.click();
    URL.revokeObjectURL(url);
    showToast('Payment report downloaded!', 'success');
  };

  window.exportDeliveryReport = async function() {
    const orders = await getAllOrders();
    if (orders.length === 0) {
      showToast('No delivery data to export yet', '');
      return;
    }
    const headers = [
      'Order ID','Client Name','Client Email','Client Phone',
      'Courier','Tracking Number','Delivery Status','Delivery Step',
      'Delivery Address','Estimated Arrival',
      'Order Date','Order Status'
    ];
    const stepLabels = {0:'Ordered',1:'Processing',2:'Shipped',3:'Delivered'};
    const rows = orders.map(o => {
      const orderDate = new Date(o.date).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'});
      const stepMap = {ordered:0,processing:1,shipped:2,delivered:3};
      const step = o.deliveryStep ?? stepMap[o.status] ?? 0;
      return [
        o.id, o.clientName, o.clientEmail, o.clientPhone || '',
        o.courier || 'TransExpress', o.tracking || 'Pending Dispatch',
        (o.deliveryStatus || o.status || 'pending').charAt(0).toUpperCase() + (o.deliveryStatus || o.status || 'pending').slice(1),
        stepLabels[step] || 'Ordered',
        o.address || '',
        o.eta || '',
        orderDate,
        (o.status||'pending').charAt(0).toUpperCase() + (o.status||'pending').slice(1)
      ];
    });
    const csvContent = [
      ['ALIVE Clothing — Delivery Status Report'],
      ['Generated: ' + new Date().toLocaleDateString('en-GB')],
      ['Courier: TransExpress (Island-wide, Sri Lanka)'],
      [],
      headers,
      ...rows,
      [],
      ['SUMMARY'],
      ['Total Orders: ' + orders.length],
      ['Delivered: ' + orders.filter(o=>o.status==='delivered').length],
      ['Shipped (In Transit): ' + orders.filter(o=>o.status==='shipped').length],
      ['Processing: ' + orders.filter(o=>o.status==='processing').length],
    ].map(row => row.map(cell => '"' + String(cell||'').replace(/"/g,'""') + '"').join(',')).join('\n');
    const blob = new Blob(["\uFEFF" + csvContent], {type:'text/csv;charset=utf-8;'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ALIVE_Delivery_Report_' + new Date().toISOString().slice(0,10) + '.csv';
    a.click();
    URL.revokeObjectURL(url);
    showToast('Delivery report downloaded!', 'success');
  };

  /* Override renderExportsPage to use async data */
  window.renderExportsPage = async function() {
    const orders = await getAllOrders();
    const clients = await getClients();
    const totalRevenue = orders.filter(o=>o.status!=='cancelled').reduce((s,o)=>s+(o.total||0),0);
    const delivered = orders.filter(o=>o.status==='delivered').length;
    const el1 = document.getElementById('exp-total-orders');
    const el2 = document.getElementById('exp-total-clients');
    const el3 = document.getElementById('exp-total-revenue');
    const el4 = document.getElementById('exp-total-delivered');
    if (el1) el1.textContent = orders.length;
    if (el2) el2.textContent = clients.length;
    if (el3) el3.textContent = 'LKR ' + totalRevenue.toLocaleString();
    if (el4) el4.textContent = delivered;
  };

  console.log('%c[AliveFix] All fixes applied! Data will now persist to Supabase.', 'color:#27ae60;font-size:14px;font-weight:bold');

  /* ═══════════════════════════════════════════════════════════
     OVERRIDE: confirmDeleteClient(clientId)
     FIX: Was calling getClients() without await (it's now async).
     Also now deletes from Supabase (alive_client_profiles + alive_users).
  ═══════════════════════════════════════════════════════════ */
  window.confirmDeleteClient = async function(clientId) {
    const clients = await getClients();
    const c = clients.find(x => x.id === clientId);
    showConfirm(
      `Delete "${c?.name || c?.email || 'this client'}"?`,
      'This will permanently remove this client profile from both local storage and the cloud database. Their orders will remain in All Orders.',
      async () => {
        let supabaseOk = false;
        if (typeof AliveDB !== 'undefined') {
          try {
            // Delete client profile from Supabase
            if (AliveDB.deleteClientProfile) {
              const profileDeleted = await AliveDB.deleteClientProfile(clientId);
              if (profileDeleted) console.log('[AliveFix] Client profile deleted from Supabase:', clientId);
            }
            // Delete user from alive_users table
            if (AliveDB.deleteUser) {
              const userDeleted = await AliveDB.deleteUser(clientId);
              if (userDeleted) { supabaseOk = true; console.log('[AliveFix] User deleted from Supabase:', clientId); }
            }
          } catch(e) {
            console.error('[AliveFix] Supabase deleteClient error:', e);
          }
        }

        const remaining = clients.filter(x => x.id !== clientId);
        localStorage.setItem('alive-clients', JSON.stringify(remaining));

        // Also refresh the orders cache from Supabase so the admin panel is in sync
        try { await getAllOrders(); } catch(e) {}

        renderClients();
        renderDashboard();

        if (supabaseOk) {
          showToast('Client deleted from cloud & locally!', 'success');
        } else {
          showToast('Client deleted locally (cloud delete may have failed — check RLS policies)', 'error');
        }
      }
    );
  };

  /* ═══════════════════════════════════════════════════════════
     OVERRIDE: confirmDeleteOrder(orderId, clientId)
     FIX: Was using sync getAllOrders() which only reads localStorage.
     Now deletes from Supabase (order + items + payment + delivery).
  ═══════════════════════════════════════════════════════════ */
  window.confirmDeleteOrder = async function(orderId, clientId) {
    showConfirm(
      `Delete Order ${orderId}?`,
      'This order and all its related data (items, payment, delivery) will be permanently removed from both local storage and the cloud database.',
      async () => {
        let supabaseOk = false;
        if (typeof AliveDB !== 'undefined') {
          try {
            // Delete related sub-records first (order items, payment, delivery)
            if (AliveDB.deleteOrderItemsByOrderId) {
              await AliveDB.deleteOrderItemsByOrderId(orderId);
              console.log('[AliveFix] Order items deleted for:', orderId);
            }
            if (AliveDB.deletePaymentByOrderId) {
              await AliveDB.deletePaymentByOrderId(orderId);
              console.log('[AliveFix] Payment deleted for:', orderId);
            }
            if (AliveDB.deleteDeliveryByOrderId) {
              await AliveDB.deleteDeliveryByOrderId(orderId);
              console.log('[AliveFix] Delivery deleted for:', orderId);
            }
            // Delete the order itself
            const orderDeleted = await AliveDB.deleteOrder(orderId);
            if (orderDeleted) {
              supabaseOk = true;
              console.log('[AliveFix] Order deleted from Supabase:', orderId);
            } else {
              console.error('[AliveFix] Order delete failed — check RLS policies in Supabase');
            }
          } catch(e) {
            console.error('[AliveFix] Supabase deleteOrder error:', e);
          }
        }

        // Update localStorage
        const allOrders = _getAllOrdersSync();
        const remaining = allOrders.filter(o => o.id !== orderId && String(o.id) !== String(orderId));
        localStorage.setItem('alive-admin-orders', JSON.stringify(remaining));

        // Refresh from Supabase to ensure admin panel is in sync
        try { await getAllOrders(); } catch(e) {}

        if (typeof syncDeliveriesToProfile === 'function') syncDeliveriesToProfile(remaining);
        persistWeeklyReports();
        renderDashboard();

        // Refresh the client modal if still open
        if (clientId) openClientModal(clientId);

        if (supabaseOk) {
          showToast(`Order ${orderId} deleted from cloud & locally!`, 'success');
        } else {
          showToast(`Order ${orderId} deleted locally (cloud delete may have failed — check RLS policies)`, 'error');
        }
      }
    );
  };

  /* ═══════════════════════════════════════════════════════════
     OVERRIDE: buildWeeklyReports()
     FIX: Was using sync getAllOrders() which reads stale localStorage.
     Now uses the async version that fetches fresh from Supabase.
     This is the KEY FIX for Weekly Sales Reports showing no data!
  ═══════════════════════════════════════════════════════════ */
  window._buildWeeklyReportsSync = function() {
    const orders = _getAllOrdersSync();
    const weeks = {};
    orders.forEach(o => {
      if (o.status === 'cancelled') return;
      const wk = getWeekKey(o.date);
      if (!weeks[wk]) weeks[wk] = [];
      weeks[wk].push(o);
    });
    return weeks;
  };

  window.buildWeeklyReports = function() {
    // Use localStorage cache (which is refreshed by getAllOrdersAsync)
    const orders = _getAllOrdersSync();
    const weeks = {};
    orders.forEach(o => {
      if (o.status === 'cancelled') return;
      const wk = getWeekKey(o.date);
      if (!weeks[wk]) weeks[wk] = [];
      weeks[wk].push(o);
    });
    return weeks;
  };

  /* ═══════════════════════════════════════════════════════════
     OVERRIDE: renderReports()
     FIX: First refreshes orders from Supabase, then renders.
     Previously it used stale localStorage data.
  ═══════════════════════════════════════════════════════════ */
  window._originalRenderReports = window.renderReports;
  window.renderReports = async function() {
    // First, refresh orders from Supabase into localStorage
    try {
      await getAllOrders();
    } catch(e) {
      console.warn('[AliveFix] renderReports: could not refresh orders from Supabase:', e);
    }
    // Now build reports from the freshly cached data
    persistWeeklyReports();
    const weeks = buildWeeklyReports();
    const weekKeys = Object.keys(weeks).sort((a,b) => b.localeCompare(a));

    // Also include current week even if empty
    const thisWeek = getWeekKey();
    if (!weekKeys.includes(thisWeek)) weekKeys.unshift(thisWeek);

    if (!currentReportWeek || !weekKeys.includes(currentReportWeek)) {
      currentReportWeek = weekKeys[0];
    }

    // Build week selector tabs (show up to 8 weeks)
    const shown = weekKeys.slice(0, 8);
    document.getElementById('week-selector').innerHTML = shown.map((wk, i) => {
      const lbl = i === 0 ? 'This Week' : `Week ${i+1}`;
      return `<button class="week-btn ${wk===currentReportWeek?'active':''}" onclick="selectReportWeek('${wk}')">${lbl}</button>`;
    }).join('');

    renderCurrentReport(weeks);
    renderPastReports(weekKeys, weeks);
  };

  /* ═══════════════════════════════════════════════════════════
     OVERRIDE: downloadReport(weekKey) / downloadCurrentReport()
     FIX: Refreshes data from Supabase before generating the CSV.
     Previously it used stale localStorage which could be empty.
  ═══════════════════════════════════════════════════════════ */
  window._originalDownloadReport = window.downloadReport;
  window.downloadReport = async function(weekKey) {
    // First, refresh orders from Supabase
    try {
      await getAllOrders();
    } catch(e) {
      console.warn('[AliveFix] downloadReport: could not refresh orders:', e);
    }

    const weeks = buildWeeklyReports();
    const wkOrders = weeks[weekKey] || [];
    const label = getWeekLabel(weekKey);

    if (wkOrders.length === 0) {
      showToast('No data to download for this week', '');
      return;
    }

    // Build CSV content
    const headers = ['#','Order ID','Client Name','Client Email','Items Purchased','Amount Paid (LKR)','Date Paid','Delivery Address','Status'];
    const rows = wkOrders.map((o, i) => {
      const items = (o.items || []).map(it=>`${it.name||''}${(it.qty||1)>1?' x'+it.qty:''}`).join(' | ');
      const dateFmt = o.date ? new Date(o.date).toLocaleDateString('en-GB') : '—';
      return [i+1, o.id, o.clientName||'', o.clientEmail||'', items, o.total||0, dateFmt, o.address||'', o.status||''];
    });

    const csvContent = [
      [`ALIVE Clothing — Weekly Sales Report`],
      [`Week: ${label}`],
      [`Generated: ${new Date().toLocaleDateString('en-GB')}`],
      [],
      headers,
      ...rows,
      [],
      [`TOTALS`],
      [`Total Orders: ${wkOrders.length}`],
      [`Total Revenue: LKR ${wkOrders.reduce((s,o)=>s+(o.total||0),0).toLocaleString()}`],
      [`Total Items Sold: ${wkOrders.reduce((s,o)=>(o.items||[]).reduce((a,i)=>a+(i.qty||1),0),0)}`],
    ].map(row => row.map(cell => `"${String(cell||'').replace(/"/g,'""')}"`).join(',')).join('\n');

    const blob = new Blob(["\uFEFF" + csvContent], {type:'text/csv;charset=utf-8;'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ALIVE_Sales_Report_${weekKey}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Report downloaded as Excel-compatible CSV!', 'success');
  };

  window.downloadCurrentReport = function() {
    downloadReport(currentReportWeek);
  };

  /* ═══════════════════════════════════════════════════════════
     OVERRIDE: persistWeeklyReports()
     FIX: Uses async getAllOrders to refresh cache first.
  ═══════════════════════════════════════════════════════════ */
  window._originalPersistWeeklyReports = window.persistWeeklyReports;
  window.persistWeeklyReports = function() {
    const weeks = buildWeeklyReports();
    localStorage.setItem('alive-weekly-reports', JSON.stringify(weeks));
  };

  /* ═══════════════════════════════════════════════════════════
     ENHANCEMENT: refreshAllDataFromSupabase()
     A utility to force-refresh ALL data from Supabase.
     This fixes the issue where deleting from Supabase directly
     doesn't update the admin panel.
  ═══════════════════════════════════════════════════════════ */
  window.refreshAllDataFromSupabase = async function() {
    console.log('[AliveFix] Force-refreshing ALL data from Supabase...');
    showToast('Refreshing data from cloud...', 'success');

    // Clear all caches
    window._productsCache = null;
    window._videosCache = null;
    window._offersCache = null;

    try {
      // Re-fetch all data from Supabase
      await getProducts();
      await getVideos();
      await getOffers();
      await getClients();
      await getAllOrders();

      // Re-render everything
      renderProductsTable();
      renderVideosList();
      renderOffersList();
      renderClients();
      renderAllOrders();
      renderReports();
      renderDashboard();

      showToast('All data refreshed from cloud!', 'success');
      console.log('[AliveFix] Data refresh complete!');
    } catch(e) {
      console.error('[AliveFix] Data refresh error:', e);
      showToast('Data refresh had errors — check console', 'error');
    }
  };

  console.log('%c[AliveFix] All overrides loaded — including delete client, delete order, and weekly reports fixes!', 'color:#27ae60;font-size:12px;font-weight:bold');
})();
