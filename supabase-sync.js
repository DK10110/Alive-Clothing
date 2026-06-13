/**
 * ═══════════════════════════════════════════════════════════════
 *  ALIVE Clothing — Supabase Persistent Storage Sync
 *  BROWSER-READY VERSION (uses Supabase JS CDN, NOT ES modules)
 *
 *  HOW IT WORKS:
 *  • ALL shared data (products, videos, offers, clients, orders)
 *    is saved to Supabase as the PRIMARY store.
 *  • localStorage is used only as a temporary cache/fallback.
 *  • Per-user data (cart, session, favourites) stays in localStorage.
 *  • Exposes window.AliveDB so every page can call the Supabase
 *    functions directly.
 *
 *  SETUP (one time):
 *  1. Create a free project at https://supabase.com
 *  2. Run the SQL schema in the Supabase SQL Editor
 *  3. Replace the two constants below with your project values:
 *       SUPABASE_URL          →  Project Settings → API → Project URL
 *       SUPABASE_SERVICE_KEY  →  Project Settings → API → service_role key
 *       SUPABASE_ANON_KEY     →  Project Settings → API → anon/public key
 *  4. Load this script AFTER the Supabase CDN on every page:
 *       <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
 *       <script src="supabase-sync.js"></script>
 * ═══════════════════════════════════════════════════════════════
 */

/* ───────────────────────────────────────────────
   SUPABASE CONFIG
─────────────────────────────────────────────── */

const SUPABASE_URL = "https://jkqzbxxigjojahvvrcix.supabase.co";

const SUPABASE_SERVICE_KEY = ""; // leave empty

const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImprcXpieHhpZ2pvamFodnZyY2l4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA2NTE2ODIsImV4cCI6MjA5NjIyNzY4Mn0.TFOVO194wuLziJxpsOz6J1xqstNktR0npFobK7_A81Q";

/* ───────────────────────────────────────────────
   DUAL-KEY STRATEGY
─────────────────────────────────────────────── */
const _usingServiceKey = SUPABASE_SERVICE_KEY !== "PASTE_YOUR_SERVICE_ROLE_KEY_HERE" && SUPABASE_SERVICE_KEY.length > 20;
const _activeKey = _usingServiceKey ? SUPABASE_SERVICE_KEY : SUPABASE_ANON_KEY;

if (!_usingServiceKey) {
  console.warn(
    "%c[AliveDB] Using anon key with RLS policies. " +
    "Make sure you have run the updated supabase-setup.sql with RLS policies. " +
    "If writes fail, run the SQL schema again or add the service_role key.",
    "font-size:14px;color:#f39c12;background:#1a1000;padding:8px 16px;"
  );
}

// Create the Supabase client
const _sb = window.supabase
  ? window.supabase.createClient(SUPABASE_URL, _activeKey)
  : null;

if (!_sb) {
  console.error(
    "[AliveDB] Supabase JS library not loaded! " +
    "Make sure <script src='https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2'></script> " +
    "is included BEFORE supabase-sync.js"
  );
} else {
  console.log(
    `[AliveDB] Connected with ${_usingServiceKey ? 'service_role (full access)' : 'anon key (RLS restricted — admin writes will fail!)'}`
  );
}

/* ───────────────────────────────────────────────
   UUID HELPER
─────────────────────────────────────────────── */
function _uuidV4() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

function _uuidFromEmail(email) {
  if (!email) return _uuidV4();
  let hash = 0;
  for (let i = 0; i < email.length; i++) {
    const char = email.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  const h = Math.abs(hash).toString(16).padStart(8, '0');
  return `${h.slice(0,8)}-${h.slice(0,4)}-4${h.slice(1,4)}-a${h.slice(0,3)}-${h.slice(0,4).padStart(12, '0')}`;
}

/**
 * Global helper — wraps the Supabase client so every page
 * can call  window.AliveDB.getProducts()  etc.
 */
window.AliveDB = (function () {
  const sb = _sb;

  /* ───────── helper ───────── */
  function _log(op, table, error) {
    if (error) {
      console.error(`[AliveDB] ${op} ${table} error:`, error.message || error);
      if (error.code === '42501' || (error.message && error.message.includes('policy'))) {
        console.error(
          `%c[AliveDB] RLS POLICY BLOCKED THIS OPERATION! ` +
          `You MUST use the service_role key in supabase-sync.js for writes to work.`,
          "font-size:12px;color:#ff3a3a;background:#1a0000;padding:6px 12px;"
        );
      }
    } else {
      console.log(`[AliveDB] ${op} ${table} OK`);
    }
  }

  /* ═══════════════════════════════════════════
     CONNECTION TEST
  ═══════════════════════════════════════════ */
  async function testConnection() {
    if (!sb) {
      console.error("[AliveDB] No Supabase client available");
      return false;
    }
    try {
      const { data, error } = await sb.from("alive_products").select("id").limit(1);
      if (error) {
        console.error("[AliveDB] Connection test failed:", error.message);
        return false;
      }
      console.log("[AliveDB] Connection test PASSED — Supabase is reachable");
      return true;
    } catch (e) {
      console.error("[AliveDB] Connection test exception:", e);
      return false;
    }
  }

  /* ═══════════════════════════════════════════
     PRODUCTS
  ═══════════════════════════════════════════ */

  async function getProducts() {
    if (!sb) return [];
    const { data, error } = await sb
      .from("alive_products")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) _log("GET", "alive_products", error);
    return data || [];
  }

  async function addProduct(product) {
    if (!sb) return null;
    const row = {
      name:        product.name,
      description: product.description || "",
      price:       product.price,
      image:       product.img || product.image || "",
      stock:       product.stock || 0,
      category:    Array.isArray(product.category) ? product.category.join(",") : (product.category || ""),
      data:        product,
    };
    const { data, error } = await sb.from("alive_products").insert(row).select();
    _log("INSERT", "alive_products", error);
    return data ? data[0] : null;
  }

  async function updateProduct(id, product) {
    if (!sb) return null;
    const row = {
      name:        product.name,
      description: product.description || "",
      price:       product.price,
      image:       product.img || product.image || "",
      stock:       product.stock || 0,
      category:    Array.isArray(product.category) ? product.category.join(",") : (product.category || ""),
      data:        product,
      updated_at:  new Date().toISOString(),
    };
    const { data, error } = await sb
      .from("alive_products")
      .update(row)
      .eq("id", id)
      .select();
    _log("UPDATE", "alive_products", error);
    return data ? data[0] : null;
  }

  async function deleteProduct(id) {
    if (!sb) return false;
    const { error } = await sb.from("alive_products").delete().eq("id", id);
    _log("DELETE", "alive_products", error);
    return !error;
  }

  /**
   * Bulk sync: push an array of product objects to Supabase.
   * Used by admin-fix.js to push default/initial products.
   * Returns the number of products successfully inserted.
   */

  async function deleteProductByName(name, price) {
    if (!sb) return false;
    let query = sb.from("alive_products").delete().eq("name", name);
    if (price !== undefined && price !== null) query = query.eq("price", price);
    const { error } = await query;
    _log("DELETE-BY-NAME", "alive_products", error);
    return !error;
  }

  async function deleteVideoByTitle(title) {
    if (!sb) return false;
    const { error } = await sb.from("alive_videos").delete().eq("title", title);
    _log("DELETE-BY-TITLE", "alive_videos", error);
    return !error;
  }

  async function deleteOfferByTitle(title) {
    if (!sb) return false;
    const { error } = await sb.from("alive_offers").delete().eq("title", title);
    _log("DELETE-BY-TITLE", "alive_offers", error);
    return !error;
  }
  async function bulkSyncProducts(products) {
    if (!sb || !products || products.length === 0) return 0;
    let inserted = 0;
    for (const product of products) {
      try {
        const result = await addProduct(product);
        if (result) inserted++;
      } catch (e) {
        console.warn("[AliveDB] bulkSyncProducts: failed for", product.name, e);
      }
    }
    console.log(`[AliveDB] bulkSyncProducts: ${inserted}/${products.length} products synced`);
    return inserted;
  }

  /* ═══════════════════════════════════════════
     VIDEOS
  ═══════════════════════════════════════════ */

  async function getVideos() {
    if (!sb) return [];
    const { data, error } = await sb
      .from("alive_videos")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) _log("GET", "alive_videos", error);
    return data || [];
  }

  async function addVideo(video) {
    if (!sb) return null;
    const row = {
      title:     video.title,
      url:       video.url || "",
      thumbnail: video.thumb || video.thumbnail || "",
      category:  video.type || video.category || "youtube",
      data:      video,     // FIX: Store full video data in JSONB
    };
    const { data, error } = await sb.from("alive_videos").insert(row).select();
    _log("INSERT", "alive_videos", error);
    return data ? data[0] : null;
  }

  async function updateVideo(id, video) {
    if (!sb) return null;
    const row = {
      title:      video.title,
      url:        video.url || "",
      thumbnail:  video.thumb || video.thumbnail || "",
      category:   video.type || video.category || "youtube",
      data:       video,    // FIX: Store full video data in JSONB
      updated_at: new Date().toISOString(),
    };
    const { data, error } = await sb
      .from("alive_videos")
      .update(row)
      .eq("id", id)
      .select();
    _log("UPDATE", "alive_videos", error);
    return data ? data[0] : null;
  }

  async function deleteVideo(id) {
    if (!sb) return false;
    const { error } = await sb.from("alive_videos").delete().eq("id", id);
    _log("DELETE", "alive_videos", error);
    return !error;
  }

  /* ═══════════════════════════════════════════
     OFFERS
  ═══════════════════════════════════════════ */

  async function getOffers() {
    if (!sb) return [];
    const { data, error } = await sb
      .from("alive_offers")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) _log("GET", "alive_offers", error);
    return data || [];
  }

  async function addOffer(offer) {
    if (!sb) return null;
    const row = {
      title:            offer.title,
      description:      offer.description || "",
      discount_percent: offer.discount || null,
      active:           offer.active !== undefined ? offer.active : true,
      start_date:       new Date().toISOString(),
      end_date:         offer.expiry ? new Date(offer.expiry).toISOString() : null,
      data:             offer,   // FIX: Store full offer data in JSONB (code, img, cta, etc.)
    };
    const { data, error } = await sb.from("alive_offers").insert(row).select();
    _log("INSERT", "alive_offers", error);
    return data ? data[0] : null;
  }

  async function updateOffer(id, offer) {
    if (!sb) return null;
    const row = {
      title:            offer.title,
      description:      offer.description || "",
      discount_percent: offer.discount || null,
      end_date:         offer.expiry ? new Date(offer.expiry).toISOString() : null,
      active:           offer.active !== undefined ? offer.active : true,
      data:             offer,   // FIX: Store full offer data in JSONB
      updated_at:       new Date().toISOString(),
    };
    const { data, error } = await sb
      .from("alive_offers")
      .update(row)
      .eq("id", id)
      .select();
    _log("UPDATE", "alive_offers", error);
    return data ? data[0] : null;
  }

  async function deleteOffer(id) {
    if (!sb) return false;
    const { error } = await sb.from("alive_offers").delete().eq("id", id);
    _log("DELETE", "alive_offers", error);
    return !error;
  }

  /* ═══════════════════════════════════════════
     USERS
  ═══════════════════════════════════════════ */

  async function saveUser(user) {
    if (!sb) return null;
    const { data: existing } = await sb
      .from("alive_users")
      .select("id")
      .eq("email", user.email)
      .maybeSingle();

    const userId = existing ? existing.id : _uuidV4();

    const { data, error } = await sb.from("alive_users").upsert({
      id:         userId,
      email:      user.email,
      role:       user.role || "customer",
      data:       user,
      updated_at: new Date().toISOString(),
    }).select();

    if (error) _log("UPSERT", "alive_users", error);
    else console.log("[AliveDB] Saved user:", user.email, "→ Supabase ID:", userId);
    return data ? data[0] : null;
  }

  async function getUser(userId) {
    if (!sb) return null;
    const { data, error } = await sb
      .from("alive_users")
      .select("*")
      .eq("id", userId)
      .single();
    if (error) _log("GET", "alive_users", error);
    return data;
  }

  async function getUserByEmail(email) {
    if (!sb) return null;
    const { data, error } = await sb
      .from("alive_users")
      .select("*")
      .eq("email", email)
      .maybeSingle();
    if (error) _log("GET", "alive_users (by email)", error);
    return data;
  }

  async function getAllUsers() {
    if (!sb) return [];
    const { data, error } = await sb
      .from("alive_users")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) _log("GET", "alive_users (all)", error);
    return data || [];
  }

  /* ═══════════════════════════════════════════
     ORDERS
  ═══════════════════════════════════════════ */

  async function createOrder(order) {
    if (!sb) return null;
    const row = {
      status:       order.status || "pending",
      total_amount: order.total,
    };
    if (order.userId && /^[0-9a-f]{8}-[0-9a-f]{4}/.test(order.userId)) {
      row.user_id = order.userId;
    }
    const { data, error } = await sb.from("alive_orders").insert(row).select();
    if (error) _log("INSERT", "alive_orders", error);
    else console.log("[AliveDB] Created order:", data?.[0]?.id);
    return data ? data[0] : null;
  }

  async function getOrdersByUser(userId) {
    if (!sb) return [];
    const { data, error } = await sb
      .from("alive_orders")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (error) _log("GET", "alive_orders", error);
    return data || [];
  }

  async function getAllOrders() {
    if (!sb) return [];
    const { data, error } = await sb
      .from("alive_orders")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) _log("GET", "alive_orders (all)", error);
    return data || [];
  }

  async function updateOrder(id, updates) {
    if (!sb) return null;
    const row = { ...updates, updated_at: new Date().toISOString() };
    const { data, error } = await sb
      .from("alive_orders")
      .update(row)
      .eq("id", id)
      .select();
    if (error) _log("UPDATE", "alive_orders", error);
    return data ? data[0] : null;
  }

  async function deleteOrder(id) {
    if (!sb) return false;
    const { error } = await sb.from("alive_orders").delete().eq("id", id);
    _log("DELETE", "alive_orders", error);
    return !error;
  }

  /* ═══════════════════════════════════════════
     ORDER ITEMS
  ═══════════════════════════════════════════ */

  async function addOrderItems(orderId, items) {
    if (!sb) return null;
    const formatted = items.map((item) => ({
      order_id:   orderId,
      product_id: item.productId || null,
      item_name:  item.name,
      item_price: item.price,
      quantity:   item.qty,
      size:       item.size,
      color:      item.color,
      image:      item.image,
      subtotal:   item.price * item.qty,
    }));
    const { data, error } = await sb.from("alive_order_items").insert(formatted).select();
    if (error) _log("INSERT", "alive_order_items", error);
    return data;
  }

  async function getOrderItems(orderId) {
    if (!sb) return [];
    const { data, error } = await sb
      .from("alive_order_items")
      .select("*")
      .eq("order_id", orderId);
    if (error) _log("GET", "alive_order_items", error);
    return data || [];
  }

  /* ═══════════════════════════════════════════
     PAYMENTS
  ═══════════════════════════════════════════ */

  async function savePayment(payment) {
    if (!sb) return null;
    const row = {
      order_id:        payment.orderId,
      payment_method:  payment.method,
      payment_status:  payment.status || "pending",
      subtotal:        payment.subtotal,
      shipping_fee:    payment.shipping,
      discount_amount: payment.discount,
      total_paid:      payment.total,
      currency:        "LKR",
      payment_date:    new Date().toISOString(),
    };
    if (payment.userId && /^[0-9a-f]{8}-[0-9a-f]{4}/.test(payment.userId)) {
      row.user_id = payment.userId;
    }
    // Save customer contact info so admin can see the client's name
    if (payment.customer_name) row.customer_name = payment.customer_name;
    if (payment.customer_email) row.customer_email = payment.customer_email;
    if (payment.customer_phone) row.customer_phone = payment.customer_phone;
    const { data, error } = await sb.from("alive_order_payments").insert(row).select();
    if (error) _log("INSERT", "alive_order_payments", error);
    return data ? data[0] : null;
  }

  /* ═══════════════════════════════════════════
     DELIVERIES
  ═══════════════════════════════════════════ */

  async function createDelivery(delivery) {
    if (!sb) return null;
    const row = {
      courier:          delivery.courier || "TransExpress",
      tracking_number:  delivery.tracking || "Pending",
      delivery_status:  delivery.status || "processing",
      delivery_step:    0,
      delivery_address: delivery.address,
      estimated_arrival: delivery.eta,
    };
    if (delivery.orderId && /^[0-9a-f]{8}-[0-9a-f]{4}/.test(delivery.orderId)) {
      row.order_id = delivery.orderId;
    }
    if (delivery.userId && /^[0-9a-f]{8}-[0-9a-f]{4}/.test(delivery.userId)) {
      row.user_id = delivery.userId;
    }
    const { data, error } = await sb.from("alive_order_deliveries").insert(row).select();
    if (error) _log("INSERT", "alive_order_deliveries", error);
    return data ? data[0] : null;
  }

  async function updateDeliveryStatus(orderId, status, step) {
    if (!sb) return null;
    const { data, error } = await sb
      .from("alive_order_deliveries")
      .update({
        delivery_status: status,
        delivery_step:  step,
        updated_at:     new Date().toISOString(),
      })
      .eq("order_id", orderId)
      .select();
    if (error) _log("UPDATE", "alive_order_deliveries", error);
    return data ? data[0] : null;
  }

  async function getDeliveriesByUser(userId) {
    if (!sb) return [];
    const { data, error } = await sb
      .from("alive_order_deliveries")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (error) _log("GET", "alive_order_deliveries (by user)", error);
    return data || [];
  }

  async function getDeliveryByOrderId(orderId) {
    if (!sb) return null;
    const { data, error } = await sb
      .from("alive_order_deliveries")
      .select("*")
      .eq("order_id", orderId)
      .maybeSingle();
    if (error) _log("GET", "alive_order_deliveries (by order)", error);
    return data;
  }

  /* ═══════════════════════════════════════════
     CLIENT PROFILES
  ═══════════════════════════════════════════ */

  async function saveClientProfile(profile) {
    if (!sb) return null;

    let profileId = profile.id;

    if (!profileId || !/^[0-9a-f]{8}-[0-9a-f]{4}/.test(profileId)) {
      if (profile.email) {
        const existingUser = await getUserByEmail(profile.email);
        if (existingUser) {
          profileId = existingUser.id;
        } else {
          const newUser = await saveUser({
            email: profile.email,
            name: profile.full_name,
            phone: profile.phone,
          });
          if (newUser) {
            profileId = newUser.id;
          } else {
            console.error("[AliveDB] Cannot save client profile: failed to create user");
            return null;
          }
        }
      } else {
        console.error("[AliveDB] Cannot save client profile: no valid ID and no email");
        return null;
      }
    }

    const { data, error } = await sb.from("alive_client_profiles").upsert({
      id:          profileId,
      full_name:   profile.full_name,
      phone:       profile.phone,
      address:     profile.address,
      city:        profile.city,
      province:    profile.province,
      postal_code: profile.postal_code,
      country:     profile.country || "Sri Lanka",
    }).select();
    if (error) _log("UPSERT", "alive_client_profiles", error);
    else console.log("[AliveDB] Saved client profile for:", profile.full_name || profile.email);
    return data ? data[0] : null;
  }

  async function getClientProfile(userId) {
    if (!sb) return null;
    const { data, error } = await sb
      .from("alive_client_profiles")
      .select("*")
      .eq("id", userId)
      .single();
    if (error) _log("GET", "alive_client_profiles", error);
    return data;
  }

  async function getAllClientProfiles() {
    if (!sb) return [];
    const { data, error } = await sb
      .from("alive_client_profiles")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) _log("GET", "alive_client_profiles (all)", error);
    return data || [];
  }

  async function deleteClientProfile(userId) {
    if (!sb) return false;
    const { error } = await sb.from("alive_client_profiles").delete().eq("id", userId);
    _log("DELETE", "alive_client_profiles", error);
    return !error;
  }

  async function deleteUser(userId) {
    if (!sb) return false;
    const { error } = await sb.from("alive_users").delete().eq("id", userId);
    _log("DELETE", "alive_users", error);
    return !error;
  }

  async function deleteOrderItemsByOrderId(orderId) {
    if (!sb) return false;
    const { error } = await sb.from("alive_order_items").delete().eq("order_id", orderId);
    _log("DELETE", "alive_order_items (by order)", error);
    return !error;
  }

  async function deletePaymentByOrderId(orderId) {
    if (!sb) return false;
    const { error } = await sb.from("alive_order_payments").delete().eq("order_id", orderId);
    _log("DELETE", "alive_order_payments (by order)", error);
    return !error;
  }

  async function deleteDeliveryByOrderId(orderId) {
    if (!sb) return false;
    const { error } = await sb.from("alive_order_deliveries").delete().eq("order_id", orderId);
    _log("DELETE", "alive_order_deliveries (by order)", error);
    return !error;
  }

  /* ═══════════════════════════════════════════
     FULL ORDER SAVE
  ═══════════════════════════════════════════ */

  async function saveFullOrder(order) {
    if (!sb) {
      console.warn("[AliveDB] Cannot save full order: Supabase not connected");
      return null;
    }

    try {
      console.log("[AliveDB] Saving full order to Supabase...");

      let supabaseUserId = null;
      if (order.clientEmail) {
        const existingUser = await getUserByEmail(order.clientEmail);
        if (existingUser) {
          supabaseUserId = existingUser.id;
        } else {
          const newUser = await saveUser({
            email: order.clientEmail,
            name: order.clientName,
            phone: order.clientPhone,
          });
          if (newUser) supabaseUserId = newUser.id;
        }
      }

      const orderRow = {
        status:       order.status || "pending",
        total_amount: order.total,
        notes:        order.notes || order.orderNotes || '',
      };
      if (supabaseUserId) orderRow.user_id = supabaseUserId;
      const { data: orderData, error: orderError } = await sb
        .from("alive_orders")
        .insert(orderRow)
        .select();
      if (orderError) {
        _log("INSERT", "alive_orders (fullOrder)", orderError);
        return null;
      }
      const savedOrder = orderData[0];
      const orderId = savedOrder.id;

      if (order.items && order.items.length > 0) {
        const formattedItems = order.items.map(item => ({
          order_id:   orderId,
          product_id: item.productId || null,
          item_name:  item.name,
          item_price: item.price,
          quantity:   item.qty,
          size:       item.size || null,
          color:      item.color || null,
          image:      item.image || null,
          subtotal:   item.price * item.qty,
        }));
        const { error: itemsError } = await sb.from("alive_order_items").insert(formattedItems);
        if (itemsError) _log("INSERT", "alive_order_items (fullOrder)", itemsError);
      }

      const paymentRow = {
        order_id:        orderId,
        payment_method:  order.paymentMethod || order.payment_method || "cod",
        payment_status:  order.status === "awaiting_payment" ? "pending" : "paid",
        subtotal:        order.subtotal || order.total,
        shipping_fee:    order.shipping || 0,
        discount_amount: order.discount || 0,
        total_paid:      order.total,
        currency:        "LKR",
        payment_date:    new Date().toISOString(),
        customer_name:   order.clientName || '',
        customer_email:  order.clientEmail || '',
        customer_phone:  order.clientPhone || '',
      };
      if (supabaseUserId) paymentRow.user_id = supabaseUserId;
      const { error: paymentError } = await sb.from("alive_order_payments").insert(paymentRow);
      if (paymentError) _log("INSERT", "alive_order_payments (fullOrder)", paymentError);

      const deliveryRow = {
        order_id:          orderId,
        courier:           order.courier || "TransExpress",
        tracking_number:   "Pending Dispatch",
        delivery_status:   "processing",
        delivery_step:     0,
        delivery_address:  order.address || "",
        estimated_arrival: order.eta || null,
      };
      if (supabaseUserId) deliveryRow.user_id = supabaseUserId;
      const { error: deliveryError } = await sb.from("alive_order_deliveries").insert(deliveryRow);
      if (deliveryError) _log("INSERT", "alive_order_deliveries (fullOrder)", deliveryError);

      // Auto-create client profile so the admin panel shows this client
      if (supabaseUserId && (order.clientName || order.clientPhone || order.address)) {
        try {
          await saveClientProfile({
            id:        supabaseUserId,
            email:     order.clientEmail || '',
            full_name: order.clientName || '',
            phone:     order.clientPhone || '',
            address:   order.address || '',
            city:      order.city || '',
            province:  order.province || '',
            postal_code: order.postal_code || '',
            country:   order.country || 'Sri Lanka',
          });
          console.log("[AliveDB] Auto-created client profile for:", order.clientName || order.clientEmail);
        } catch (profileErr) {
          console.warn("[AliveDB] Could not auto-create client profile:", profileErr);
        }
      }

      console.log("[AliveDB] Full order saved successfully:", orderId);
      return savedOrder;

    } catch (e) {
      console.error("[AliveDB] saveFullOrder exception:", e);
      return null;
    }
  }

  /* ═══════════════════════════════════════════
     RAW CLIENT
  ═══════════════════════════════════════════ */


  async function getAllOrdersWithDetails() {
    if (!sb) return [];
    // Fetch orders with their items in one go
    const { data: orders, error } = await sb
      .from("alive_orders")
      .select("*, alive_order_items(*), alive_order_payments(*), alive_order_deliveries(*)")
      .order("created_at", { ascending: false });
    if (error) _log("GET", "alive_orders (with details)", error);
    return (orders || []).map(o => ({
      id:            o.id,
      user_id:       o.user_id || null,
      date:          o.created_at,
      status:        o.status,
      total:         o.total_amount,
      total_amount:  o.total_amount,
      notes:         o.notes || '',
      items:         (o.alive_order_items || []).map(i => ({
        name:     i.item_name,
        price:    i.item_price,
        qty:      i.quantity,
        quantity: i.quantity,
        size:     i.size,
        color:    i.color,
        image:    i.image,
        img:      i.image,
        subtotal: i.subtotal,
      })),
      paymentMethod:  (o.alive_order_payments?.[0]?.payment_method) || '',
      paymentDate:    (o.alive_order_payments?.[0]?.payment_date) || o.created_at,
      delivery_address: (o.alive_order_deliveries?.[0]?.delivery_address) || '',
      address:        (o.alive_order_deliveries?.[0]?.delivery_address) || '',
      customer_name:  (o.alive_order_payments?.[0]?.customer_name) || '',
      customer_email: (o.alive_order_payments?.[0]?.customer_email) || '',
      customer_phone: (o.alive_order_payments?.[0]?.customer_phone) || '',
    }));
  }

  function getClient() {
    return sb;
  }

  /* ───────────────────────────────────────────
     PUBLIC API
  ─────────────────────────────────────────── */
  return {
    getClient,
    testConnection,

    // Products
    getProducts,
    addProduct,
    updateProduct,
    deleteProduct,
    deleteProductByName,
    deleteVideoByTitle,
    deleteOfferByTitle,
    bulkSyncProducts,

    // Videos
    getVideos,
    addVideo,
    updateVideo,
    deleteVideo,

    // Offers
    getOffers,
    addOffer,
    updateOffer,
    deleteOffer,

    // Users
    saveUser,
    getUser,
    getUserByEmail,
    getAllUsers,

    // Orders
    createOrder,
    getOrdersByUser,
    getAllOrders,
    getAllOrdersWithDetails,
    updateOrder,
    deleteOrder,

    // Full Order
    saveFullOrder,

    // Order Items
    addOrderItems,
    getOrderItems,

    // Payments
    savePayment,

    // Deliveries
    createDelivery,
    updateDeliveryStatus,
    getDeliveriesByUser,
    getDeliveryByOrderId,

    // Client Profiles
    saveClientProfile,
    getClientProfile,
    getAllClientProfiles,
    deleteClientProfile,

    // Users (delete)
    deleteUser,

    // Order sub-table deletes
    deleteOrderItemsByOrderId,
    deletePaymentByOrderId,
    deleteDeliveryByOrderId,
  };
})();

/**
 * ═══════════════════════════════════════════════════════════════
 *  AliveDataSync — AUTO-SYNC from Supabase → localStorage
 *
 *  THIS IS THE KEY FIX FOR DATA PERSISTENCE!
 *  On every page load, this module fetches products, offers,
 *  and videos from Supabase and writes them to localStorage.
 *  This ensures that ALL pages (index, shop, product, etc.)
 *  can read from localStorage and get the LATEST cloud data.
 *
 *  Usage in HTML pages:
 *    <script>
 *      // Wait for Supabase data to be synced before rendering
 *      AliveDataReady.then(() => {
 *        // your code that reads from localStorage
 *      });
 *    </script>
 * ═══════════════════════════════════════════════════════════════
 */
window.AliveDataReady = (async function() {
  const db = window.AliveDB;
  if (!db || !db.getClient()) {
    console.warn('[AliveDataSync] Supabase not connected — using localStorage data only');
    return;
  }

  // Helper: retry a Supabase fetch up to 2 times with a short delay
  async function _retryFetch(fetchFn, label, maxRetries) {
    maxRetries = maxRetries || 2;
    for (var attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        var result = await fetchFn();
        if (result && result.length > 0) return result;
        // Empty result is valid (no data yet) — return it
        if (result && result.length === 0) return result;
        // null/undefined — retry
        console.warn('[AliveDataSync] ' + label + ' returned null (attempt ' + attempt + '/' + maxRetries + ')');
      } catch (e) {
        console.warn('[AliveDataSync] ' + label + ' error (attempt ' + attempt + '/' + maxRetries + '):', e.message);
      }
      if (attempt < maxRetries) {
        await new Promise(function(r) { setTimeout(r, 500 * attempt); });
      }
    }
    return null;
  }

  try {
    console.log('[AliveDataSync] Syncing data from Supabase → localStorage...');

    // Skip explicit connection test — the actual fetches below prove connectivity.
    // The old testConnection() added an extra round-trip before even starting.

    // Fetch products, offers, and videos IN PARALLEL instead of sequentially
    var [products, offers, videos] = await Promise.all([
      _retryFetch(db.getProducts.bind(db), 'Products'),
      _retryFetch(db.getOffers.bind(db), 'Offers'),
      _retryFetch(db.getVideos.bind(db), 'Videos'),
    ]);

    // Process products
    if (products && products.length > 0) {
      var converted = products.map(function(row) {
        if (row.data && typeof row.data === 'object') {
          var p = Object.assign({}, row.data);
          p._supabaseId = row.id;
          if (!p.name) p.name = row.name;
          if (!p.price) p.price = parseFloat(row.price);
          if (!p.img && !p.image) { p.img = row.image; p.image = row.image; }
          if (!p.stock && p.stock !== 0) p.stock = row.stock;
          if (!p.description) p.description = row.description;
          return p;
        }
        return {
          id: row.id,
          name: row.name,
          description: row.description,
          price: parseFloat(row.price),
          img: row.image,
          image: row.image,
          stock: row.stock,
          category: row.category ? row.category.split(',').map(function(c) { return c.trim(); }) : [],
          _supabaseId: row.id,
        };
      });
      localStorage.setItem('alive-admin-products', JSON.stringify(converted));
      localStorage.setItem('alive-products', JSON.stringify(converted));
      console.log('[AliveDataSync] Synced ' + converted.length + ' products from Supabase');
    } else if (products && products.length === 0) {
      console.log('[AliveDataSync] No products in Supabase yet — keeping localStorage data');
    } else {
      console.error('[AliveDataSync] Could not fetch products from Supabase after retries — using localStorage fallback');
    }

    // Process offers
    if (offers && offers.length > 0) {
      var convertedOffers = offers.map(function(row) {
        if (row.data && typeof row.data === 'object') {
          var o = Object.assign({}, row.data);
          o._supabaseId = row.id;
          return o;
        }
        return {
          id: row.id,
          title: row.title,
          description: row.description,
          discount: row.discount_percent,
          active: row.active,
          expiry: row.end_date,
          _supabaseId: row.id,
        };
      });
      localStorage.setItem('alive-offers', JSON.stringify(convertedOffers));
      console.log('[AliveDataSync] Synced ' + convertedOffers.length + ' offers from Supabase');
    }

    // Process videos
    if (videos && videos.length > 0) {
      var convertedVideos = videos.map(function(row) {
        if (row.data && typeof row.data === 'object') {
          var v = Object.assign({}, row.data);
          v._supabaseId = row.id;
          return v;
        }
        return {
          id: row.id,
          title: row.title,
          url: row.url,
          thumb: row.thumbnail,
          type: row.category,
          _supabaseId: row.id,
        };
      });
      localStorage.setItem('alive-videos', JSON.stringify(convertedVideos));
      console.log('[AliveDataSync] Synced ' + convertedVideos.length + ' videos from Supabase');
    }

    console.log('%c[AliveDataSync] Data sync COMPLETE — all pages will now show cloud data!', 'color:#27ae60;font-size:12px;font-weight:bold');

  } catch (e) {
    console.error('[AliveDataSync] Sync failed — using localStorage data:', e);
  }
})();

/**
 * AliveSync — Compatibility layer used by all website pages.
 */
window.AliveSync = (function () {
  const db = window.AliveDB;
  let _ready = false;
  const _readyCallbacks = [];

  // CRITICAL FIX: Wait for AliveDataReady (Supabase → localStorage sync)
  // before firing onReady callbacks. Previously, onReady fired immediately,
  // causing pages to render with empty localStorage data.
  Promise.resolve()
    .then(() => window.AliveDataReady)
    .then(() => {
      _ready = true;
      console.log("[AliveSync] Ready — Supabase data synced to localStorage");
      _readyCallbacks.forEach(cb => {
        try { cb(); } catch (e) { console.error("[AliveSync] onReady callback error:", e); }
      });
      _readyCallbacks.length = 0;
    })
    .catch((e) => {
      // Even if sync fails, still mark as ready so pages can use localStorage fallback
      console.warn("[AliveSync] Data sync had errors, proceeding with localStorage fallback:", e);
      _ready = true;
      _readyCallbacks.forEach(cb => {
        try { cb(); } catch (err) { console.error("[AliveSync] onReady callback error:", err); }
      });
      _readyCallbacks.length = 0;
    });

  function onReady(callback) {
    if (_ready) {
      try { callback(); } catch (e) { console.error("[AliveSync] onReady callback error:", e); }
    } else {
      _readyCallbacks.push(callback);
    }
  }

  async function saveUser(user) {
    if (!db) return null;
    return db.saveUser(user);
  }

  async function saveClientProfile(profile) {
    if (!db) return null;
    return db.saveClientProfile(profile);
  }

  async function saveOrder(order) {
    if (!db) return null;
    return db.createOrder(order);
  }

  async function saveFullOrder(order) {
    if (!db) return null;
    return db.saveFullOrder(order);
  }

  async function updateDeliveryStatus(orderId, status, step, _unused, deliveredDate) {
    if (!db) return null;
    const result = await db.updateDeliveryStatus(orderId, status, step);
    if (deliveredDate && db.getClient()) {
      try {
        await db.getClient()
          .from("alive_order_deliveries")
          .update({ delivered_date: deliveredDate })
          .eq("order_id", orderId);
      } catch (e) { console.warn("[AliveSync] Failed to set delivered_date:", e); }
    }
    return result;
  }

  async function forceWrite(key, data) {
    if (!db || !db.getClient()) return null;
    try {
      const sb = db.getClient();
      const { data: result, error } = await sb
        .from("alive_kv_store")
        .upsert({
          key: key,
          value: JSON.stringify(data),
          updated_at: new Date().toISOString(),
        })
        .select();
      if (error) {
        console.log("[AliveSync] forceWrite skipped for", key, "(table not available)");
        return null;
      }
      return result ? result[0] : null;
    } catch (e) {
      console.warn("[AliveSync] forceWrite error for", key, ":", e);
      return null;
    }
  }

  async function getAllClients() {
    if (!db || !db.getClient()) return [];
    try {
      const users = await db.getAllUsers();
      const profiles = await db.getAllClientProfiles();
      const profileMap = {};
      (profiles || []).forEach(p => { profileMap[p.id] = p; });
      return (users || []).map(row => {
        const profile = profileMap[row.id] || {};
        const data = row.data || {};
        return {
          id: row.id || ('CL-' + Date.now()),
          name: profile.full_name || data.name || row.email || '',
          email: row.email || '',
          phone: profile.phone || data.phone || '',
          address: profile.address || data.address || '',
          city: profile.city || '',
          province: profile.province || '',
          postal_code: profile.postal_code || '',
          country: profile.country || 'Sri Lanka',
          role: row.role || 'customer',
          joinedDate: row.created_at,
        };
      });
    } catch (e) { console.warn("[AliveSync] getAllClients error:", e); return []; }
  }

  async function getAllOrders() {
    if (!db) return [];
    try {
      return await db.getAllOrders();
    } catch (e) { console.warn("[AliveSync] getAllOrders error:", e); return []; }
  }

  return {
    onReady,
    saveUser,
    saveClientProfile,
    saveOrder,
    saveFullOrder,
    updateDeliveryStatus,
    forceWrite,
    getAllClients,
    getAllOrders,
    db: db,
  };
})();
