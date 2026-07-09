/**
 * /api/deskkit-charge
 * POST — create a DeskKit task + Stripe PaymentIntent (unconfirmed)
 * Returns a client_secret so the frontend can collect card details via Stripe Elements.
 * Payment is NOT considered complete until /api/deskkit-confirm-payment verifies it server-side.
 */
const crypto = require("crypto");

// Tier pricing (cents) — generic DeskKit tasks
const TIER_PRICES = { simple: 1500, moderate: 3500, complex: 7500, bulk: 12500 };

// Collection Letter bundle pricing (cents)
const BUNDLE_PRICES = {
  single: 1500, triple: 3500, starter: 4900,
  business: 8900, bulk: 14900, enterprise: 24900
};

function getKV() {
  return {
    url:   process.env.UPSTASH_REDIS_REST_URL || process.env.lime_KV_REST_API_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN || process.env.lime_KV_REST_API_TOKEN
  };
}

async function getFromKV(key) {
  const { url, token } = getKV();
  if (!url || !token) return null;
  try {
    const r = await fetch(url + "/get/" + encodeURIComponent(key), {
      headers: { Authorization: "Bearer " + token }
    });
    const d = await r.json();
    return d.result ? JSON.parse(d.result) : null;
  } catch(e) { return null; }
}

async function saveToKV(key, value, ttl) {
  const { url, token } = getKV();
  if (!url || !token) return;
  await fetch(url + "/set/" + encodeURIComponent(key), {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify(value)
  });
  if (ttl) {
    await fetch(url + "/expire/" + encodeURIComponent(key) + "/" + ttl, {
      method: "POST", headers: { Authorization: "Bearer " + token }
    });
  }
}

async function validateSession(token) {
  if (!token) return null;
  const session = await getFromKV("session:" + token);
  return session ? session.email : null;
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const authHeader = req.headers.authorization || "";
    const sessionToken = authHeader.replace("Bearer ", "").trim();
    const email = await validateSession(sessionToken);
    if (!email) return res.status(401).json({ error: "Unauthorized" });

    const { tier, price, desc, filename, kind, promoCode, toolName, toolPath } = req.body || {};
    if (!tier || !desc) return res.status(400).json({ error: "Missing required fields" });

    // Determine which pricing table applies and validate the tier/bundle server-side
    // (never trust the price sent from the client — look it up ourselves)
    const isBundle = kind === "collection_letter";
    const priceTable = isBundle ? BUNDLE_PRICES : TIER_PRICES;
    if (!priceTable.hasOwnProperty(tier)) return res.status(400).json({ error: "Invalid tier" });
    let amountCents = priceTable[tier];
    const originalAmountCents = amountCents;

    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) return res.status(500).json({ error: "Stripe not configured" });

    // Look up and apply a promo code, if one was given. Stripe doesn't auto-apply
    // promotion codes to a raw PaymentIntent (that's only automatic with Checkout
    // Sessions/Subscriptions), so we validate it and compute the discount ourselves.
    let appliedPromo = null;
    if (promoCode) {
      // Testing override — always available regardless of Stripe's coupon setup,
      // so testing isn't blocked on debugging the real promo code integration.
      if (promoCode.trim().toUpperCase() === "DESKKITTEST") {
        amountCents = 50;
        appliedPromo = { code: promoCode, testOverride: true };
      } else {
      const promoResponse = await fetch(
        `https://api.stripe.com/v1/promotion_codes?code=${encodeURIComponent(promoCode)}&active=true&limit=1&expand[]=data.coupon`,
        { headers: { Authorization: "Bearer " + stripeKey } }
      );
      const promoData = await promoResponse.json();

      if (promoData.error) {
        console.error("Stripe promotion_codes error:", promoData.error);
        return res.status(400).json({ error: "Could not look up that promo code. Please try again." });
      }

      const match = promoData.data && promoData.data[0];
      if (!match) {
        return res.status(400).json({ error: "That promo code isn't valid or has expired." });
      }

      // Coupon data can live directly on the promotion code, or nested under a
      // "promotion" field depending on API version — check both rather than
      // assuming one shape.
      const coupon = match.coupon || (match.promotion && match.promotion.coupon);
      if (!coupon) {
        console.error("Promo code matched but no coupon data found:", JSON.stringify(match));
        return res.status(400).json({ error: "That promo code couldn't be applied. Please contact support." });
      }

      console.log("Promo lookup result:", JSON.stringify({ code: promoCode, couponKeys: Object.keys(coupon), percent_off: coupon.percent_off, amount_off: coupon.amount_off }));

      if (coupon.percent_off) {
        amountCents = Math.round(amountCents * (1 - coupon.percent_off / 100));
        appliedPromo = { code: promoCode, percentOff: coupon.percent_off };
      } else if (coupon.amount_off) {
        amountCents = Math.max(0, amountCents - coupon.amount_off);
        appliedPromo = { code: promoCode, amountOff: coupon.amount_off };
      } else {
        console.error("Coupon found but has neither percent_off nor amount_off:", JSON.stringify(coupon));
      }
      }

      // Stripe requires at least $0.50 USD for any card charge — floor it here
      // rather than letting the PaymentIntent call fail with an opaque error.
      if (amountCents < 50) amountCents = 50;
    }

    const taskId = "dsk_" + Date.now().toString(36) + crypto.randomBytes(4).toString("hex");

    // Create the PaymentIntent — NOT confirmed yet. The frontend collects card
    // details via Stripe Elements using the client_secret returned below.
    const paymentResponse = await fetch("https://api.stripe.com/v1/payment_intents", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + stripeKey,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        amount: String(amountCents),
        currency: "usd",
        description: `DeskKit ${isBundle ? "Collection Letter " + tier : tier} task - ${desc.slice(0, 100)}`,
        "automatic_payment_methods[enabled]": "true",
        "metadata[taskId]": taskId,
        "metadata[email]": email,
        "metadata[tier]": tier,
        "metadata[kind]": isBundle ? "collection_letter" : "task",
        "metadata[promoCode]": promoCode || ""
      })
    });

    const paymentData = await paymentResponse.json();
    if (paymentData.error) return res.status(400).json({ error: paymentData.error.message });

    // Save task in a pending-payment state — work does NOT begin until payment is confirmed
    await saveToKV("deskkit_task:" + taskId, {
      id: taskId,
      email,
      tier,
      kind: isBundle ? "collection_letter" : "task",
      toolName: toolName || "General Task",
      toolPath: toolPath || "/portal/app",
      price: amountCents / 100,
      originalPrice: originalAmountCents / 100,
      promo: appliedPromo,
      desc,
      filename: filename || null,
      status: "pending_payment",
      paymentIntentId: paymentData.id,
      createdAt: new Date().toISOString(),
      result: null
    });

    const emailKey = email.toLowerCase().replace(/[^a-z0-9@._-]/g, "");
    const taskList = await getFromKV("deskkit_tasks:" + emailKey) || [];
    taskList.unshift(taskId);
    await saveToKV("deskkit_tasks:" + emailKey, taskList);

    return res.status(200).json({
      success: true,
      taskId,
      clientSecret: paymentData.client_secret,
      paymentIntentId: paymentData.id,
      amountCharged: amountCents / 100,
      promoApplied: appliedPromo
    });

  } catch(err) {
    console.error("deskkit-charge error:", err.message);
    return res.status(500).json({ error: "Server error" });
  }
};
