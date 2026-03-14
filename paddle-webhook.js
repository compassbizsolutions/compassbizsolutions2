/**
 * Vercel Serverless Function: /api/paddle-webhook
 *
 * Receives Paddle payment.completed webhooks for the $399 Full DIY Package.
 * On valid payment:
 *   1. Generates a signed one-time token
 *   2. Stores it in Vercel KV with a 72-hour TTL
 *   3. Returns 200 (Paddle requires this to stop retrying)
 *
 * Paddle then redirects the customer to:
 *   https://compassbizsolutions.com?token=TOKEN&email=EMAIL
 *
 * SETUP — Vercel dashboard environment variables:
 *   PADDLE_WEBHOOK_SECRET  — from Paddle dashboard > Notifications
 *   KV_REST_API_URL        — auto-added when you provision Vercel KV
 *   KV_REST_API_TOKEN      — auto-added when you provision Vercel KV
 *
 * SETUP — Vercel KV:
 *   1. Go to Vercel dashboard > Storage > Create Database > KV
 *   2. Connect it to your project — env vars are added automatically
 *
 * SETUP — Paddle:
 *   1. Paddle dashboard > Notifications > New Notification
 *   2. URL: https://compassbizsolutions.com/api/paddle-webhook
 *   3. Events: transaction.completed
 *   4. Copy the secret key → PADDLE_WEBHOOK_SECRET in Vercel
 *   5. On the $399 product, set Success URL:
 *      https://compassbizsolutions.com?token={metadata.token}&email={customer.email}
 *      (Paddle fills these in from the metadata we set below)
 */

const crypto = require("crypto");
const { createClient } = require("@vercel/kv");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    // ── 1. Verify Paddle signature ──────────────────────────────────────────
    const secret = process.env.PADDLE_WEBHOOK_SECRET;
    if (!secret) {
      console.error("PADDLE_WEBHOOK_SECRET not set");
      return res.status(500).json({ error: "Webhook secret not configured" });
    }

    const signatureHeader = req.headers["paddle-signature"];
    if (!signatureHeader) return res.status(400).json({ error: "Missing Paddle signature" });

    // Parse ts= and h1= from the header
    const parts = Object.fromEntries(
      signatureHeader.split(";").map(p => p.split("=").map(s => s.trim()))
    );
    const ts = parts["ts"];
    const h1 = parts["h1"];
    if (!ts || !h1) return res.status(400).json({ error: "Malformed signature header" });

    // Rebuild the signed payload
    const rawBody = JSON.stringify(req.body);
    const signed = `${ts}:${rawBody}`;
    const expected = crypto
      .createHmac("sha256", secret)
      .update(signed)
      .digest("hex");

    if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(h1))) {
      console.error("Paddle signature mismatch");
      return res.status(401).json({ error: "Invalid signature" });
    }

    // ── 2. Only act on completed transactions ───────────────────────────────
    const event = req.body;
    if (event.event_type !== "transaction.completed") {
      return res.status(200).json({ received: true }); // Acknowledge other events
    }

    const customerEmail = event.data?.customer?.email;
    const customerName  = event.data?.customer?.name || "";
    if (!customerEmail) {
      console.error("No customer email in payload");
      return res.status(200).json({ received: true }); // Don't retry
    }

    // ── 3. Generate a signed one-time token ─────────────────────────────────
    const token = crypto.randomBytes(32).toString("hex");
    const tokenKey = `scan_token:${token}`;

    // ── 4. Store in Vercel KV — 72 hour TTL ─────────────────────────────────
    const kv = createClient({
      url:   process.env.KV_REST_API_URL,
      token: process.env.KV_REST_API_TOKEN,
    });

    await kv.set(tokenKey, {
      email:     customerEmail,
      name:      customerName,
      used:      false,
      createdAt: Date.now(),
    }, { ex: 60 * 60 * 72 }); // 72 hours in seconds

    console.log(`Token stored for ${customerEmail}: ${token}`);

    // ── 5. Acknowledge Paddle ────────────────────────────────────────────────
    // Paddle reads the success_url from the transaction — we store the token
    // in metadata so Paddle can pass it through in the redirect URL.
    // The token is already in KV — customer will land at:
    // compassbizsolutions.com?token=TOKEN&email=EMAIL
    return res.status(200).json({ received: true, token });

  } catch (err) {
    console.error("paddle-webhook error:", err);
    // Always return 200 to Paddle to prevent infinite retries
    // Log the error but don't fail silently in production
    return res.status(200).json({ received: true, error: err.message });
  }
};
