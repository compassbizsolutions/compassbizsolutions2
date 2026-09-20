/**
 * /api/reviewkit-session-lookup
 * GET ?session_id=cs_...
 * Used by reviewkit/onboarding.html right after checkout to figure out which business
 * record (created by the webhook) this visitor should be filling in the onboarding form
 * for — without asking them to log in or re-enter their email.
 *
 * Retrieves the Checkout Session from Stripe to get the customer's email, then looks up
 * the matching businesses row that the webhook already created (by owner_email, most
 * recent). If the webhook hasn't finished yet (there's a small race between the browser
 * landing on this page and Stripe's webhook delivery), the frontend retries a couple of
 * times rather than this endpoint waiting/blocking.
 */

async function supabaseRequest(path) {
  const base = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not configured");
  const res = await fetch(`${base}/rest/v1/${path}`, {
    headers: { apikey: key, Authorization: "Bearer " + key }
  });
  if (!res.ok) throw new Error(`Supabase lookup failed (${res.status}): ${await res.text()}`);
  return res.json();
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    const sessionId = req.query.session_id;
    if (!sessionId) return res.status(400).json({ error: "Missing session_id" });

    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) return res.status(500).json({ error: "Stripe not configured" });

    const sessionRes = await fetch(`https://api.stripe.com/v1/checkout/sessions/${sessionId}`, {
      headers: { Authorization: "Bearer " + stripeKey }
    });
    const session = await sessionRes.json();
    if (session.error) return res.status(400).json({ error: "Could not look up that checkout session." });

    const email = session.customer_details && session.customer_details.email;
    if (!email) return res.status(404).json({ error: "No email on this checkout session yet." });

    const rows = await supabaseRequest(
      `businesses?owner_email=eq.${encodeURIComponent(email)}&order=created_at.desc&limit=1&select=id,name,owner_email`
    );
    const business = rows && rows[0];

    if (!business) {
      // Webhook likely hasn't run yet — tell the frontend to retry shortly rather than
      // treating this as a hard failure.
      return res.status(202).json({ pending: true });
    }

    return res.status(200).json({
      businessId: business.id,
      email: business.owner_email,
      // Only pass the placeholder name back if it hasn't been set yet, so the form
      // starts blank instead of showing "New ReviewKit customer (...) — needs setup".
      name: business.name && business.name.startsWith("New ReviewKit customer") ? "" : business.name
    });
  } catch (err) {
    console.error("reviewkit-session-lookup error:", err.message);
    return res.status(500).json({ error: "Server error" });
  }
};
