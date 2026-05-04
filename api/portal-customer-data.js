/**
 * /api/portal-customer-data
 * GET — fetch all portal data for logged in customer
 */

async function getFromKV(key) {
  const url   = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
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
  // Check portal_session: first, then fall back to FixKit session: format
  const session = await getFromKV("portal_session:" + token)
               || await getFromKV("session:" + token);
  return session ? session.email : null;
}

function emailKey(email) {
  return email.toLowerCase().trim().replace(/[^a-z0-9@._-]/g, "");
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.replace("Bearer ", "").trim();
    const email = await validateSession(token);
    if (!email) return res.status(401).json({ error: "Unauthorized" });

    const eKey = emailKey(email);

    const [customer, requests, tickets, messages] = await Promise.all([
      getFromKV("customer:" + eKey),
      getFromKV("portal_requests:" + eKey),
      getFromKV("portal_tickets:" + eKey),
      getFromKV("portal_messages:" + eKey),
    ]);

    // Determine active products
    const products = [];
    if (customer?.purchases?.includes("snapshot") || customer?.purchases?.includes("30day") || customer?.purchases?.includes("bundle")) {
      products.push("fixkit");
    }
    if (customer?.fieldkit_active) products.push("fieldkit");
    if (customer?.buildkit_active) products.push("buildkit");

    return res.status(200).json({
      customer: {
        name:    customer?.name    || "",
        company: customer?.biz     || customer?.company || "",
        email:   email,
        plan:    customer?.plan_type || "",
      },
      requests: requests || [],
      tickets:  tickets  || [],
      messages: messages || [],
      products,
    });

  } catch(err) {
    console.error("portal-customer-data error:", err.message);
    return res.status(500).json({ error: "Failed to load data" });
  }
};
