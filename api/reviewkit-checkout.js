/**
 * /api/reviewkit-checkout
 * POST { tier: "starter" | "growth" | "multilocation" }
 * Creates a Stripe Checkout Session in subscription mode and returns its URL.
 *
 * Looks up each tier's default price directly from the Stripe Product at request time
 * (rather than hardcoding price_... IDs here) so a price can be changed in the Stripe
 * Dashboard without a code deploy — as long as the product's default price is kept current.
 *
 * Uses plain fetch() against the Stripe REST API, matching the rest of this codebase
 * (see deskkit-charge.js) rather than adding the `stripe` npm package as a new dependency.
 */

const TIER_PRODUCTS = {
  starter: "prod_VIQ4JLihx8IIkh",
  growth: "prod_VIQ7ip6KxBiy2H",
  multilocation: "prod_VIQ8zAYrq3EL9s"
};

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { tier } = req.body || {};
    const productId = TIER_PRODUCTS[tier];
    if (!productId) {
      return res.status(400).json({ error: "Invalid tier" });
    }

    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) return res.status(500).json({ error: "Stripe not configured" });

    // Look up the product's default price. Every ReviewKit product should have exactly
    // one recurring price set as its default when created in the Stripe Dashboard.
    const productRes = await fetch(
      `https://api.stripe.com/v1/products/${productId}?expand[]=default_price`,
      { headers: { Authorization: "Bearer " + stripeKey } }
    );
    const product = await productRes.json();

    if (product.error) {
      console.error("reviewkit-checkout: product lookup failed", product.error);
      return res.status(500).json({ error: "Could not look up pricing. Please try again." });
    }

    const price = product.default_price;
    if (!price || !price.id) {
      console.error("reviewkit-checkout: product has no default_price set", productId);
      return res.status(500).json({ error: "This plan isn't fully set up yet — please email support@compassbizsolutions.com." });
    }

    const siteUrl = process.env.SITE_URL || "https://www.compassbizsolutions.com";

    const sessionRes = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + stripeKey,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        mode: "subscription",
        "line_items[0][price]": price.id,
        "line_items[0][quantity]": "1",
        success_url: `${siteUrl}/reviewkit/onboarding?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${siteUrl}/reviewkit`,
        "metadata[tier]": tier,
        "metadata[product_id]": productId,
        "subscription_data[metadata][tier]": tier,
        allow_promotion_codes: "true"
      })
    });

    const session = await sessionRes.json();
    if (session.error) {
      console.error("reviewkit-checkout: session creation failed", session.error);
      return res.status(400).json({ error: session.error.message });
    }

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error("reviewkit-checkout error:", err.message);
    return res.status(500).json({ error: "Server error" });
  }
};
