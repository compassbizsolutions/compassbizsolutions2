/**
 * /api/deskkit-validate-promo
 * POST — check a promo code against a tier/bundle price and return the discounted
 * amount, WITHOUT creating a PaymentIntent or task. Lets the customer see the real
 * price before committing to "Accept & Submit".
 */

const TIER_PRICES = { simple: 1500, moderate: 3500, complex: 7500, bulk: 12500 };
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

    const { tier, kind, promoCode } = req.body || {};
    if (!tier || !promoCode) return res.status(400).json({ error: "Missing tier or promo code" });

    const isBundle = kind === "collection_letter";
    const priceTable = isBundle ? BUNDLE_PRICES : TIER_PRICES;
    if (!priceTable.hasOwnProperty(tier)) return res.status(400).json({ error: "Invalid tier" });
    const originalAmountCents = priceTable[tier];

    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) return res.status(500).json({ error: "Stripe not configured" });

    let amountCents = originalAmountCents;
    let discountLabel = "";

    // Testing override — always available regardless of Stripe's coupon setup.
    if (promoCode.trim().toUpperCase() === "DESKKITTEST") {
      amountCents = 50;
      discountLabel = "Test override";
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

      const coupon = match.coupon || (match.promotion && match.promotion.coupon);
      if (!coupon) {
        console.error("Promo code matched but no coupon data found:", JSON.stringify(match));
        return res.status(400).json({ error: "That promo code couldn't be applied. Please contact support." });
      }

      console.log("Promo lookup result:", JSON.stringify({ code: promoCode, couponKeys: Object.keys(coupon), percent_off: coupon.percent_off, amount_off: coupon.amount_off }));

      if (coupon.percent_off) {
        amountCents = Math.round(amountCents * (1 - coupon.percent_off / 100));
        discountLabel = `${coupon.percent_off}% off`;
      } else if (coupon.amount_off) {
        amountCents = Math.max(0, amountCents - coupon.amount_off);
        discountLabel = `$${(coupon.amount_off / 100).toFixed(2)} off`;
      } else {
        console.error("Coupon found but has neither percent_off nor amount_off:", JSON.stringify(coupon));
      }
    }

    const floored = amountCents < 50;
    if (floored) amountCents = 50;

    return res.status(200).json({
      valid: true,
      originalPrice: originalAmountCents / 100,
      discountedPrice: amountCents / 100,
      discountLabel,
      flooredToMinimum: floored
    });

  } catch(err) {
    console.error("deskkit-validate-promo error:", err.message);
    return res.status(500).json({ error: "Server error" });
  }
};
