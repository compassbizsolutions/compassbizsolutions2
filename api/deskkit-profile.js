/**
 * /api/deskkit-profile
 * GET  — load a saved profile (roster, business info, etc.) for this customer
 * POST — save/update a profile
 * Generic across tools: identified by a "type" (e.g. "payroll", "collection-letter")
 * so any tool can remember customer-specific data without re-entry each time.
 */

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

async function saveToKV(key, value) {
  const { url, token } = getKV();
  if (!url || !token) return;
  await fetch(url + "/set/" + encodeURIComponent(key), {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify(value)
  });
}

async function validateSession(token) {
  if (!token) return null;
  const session = await getFromKV("session:" + token);
  return session ? session.email : null;
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const authHeader = req.headers.authorization || "";
    const sessionToken = authHeader.replace("Bearer ", "").trim();
    const email = await validateSession(sessionToken);
    if (!email) return res.status(401).json({ error: "Unauthorized" });

    const emailKey = email.toLowerCase().replace(/[^a-z0-9@._-]/g, "");

    if (req.method === "GET") {
      const type = (req.query || {}).type;
      if (!type) return res.status(400).json({ error: "Missing type" });
      const profile = await getFromKV(`deskkit_profile:${type}:${emailKey}`);
      return res.status(200).json({ profile: profile || null });
    }

    if (req.method === "POST") {
      const { type, data } = req.body || {};
      if (!type || !data) return res.status(400).json({ error: "Missing type or data" });
      await saveToKV(`deskkit_profile:${type}:${emailKey}`, data);
      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: "Method not allowed" });

  } catch(err) {
    console.error("deskkit-profile error:", err.message);
    return res.status(500).json({ error: "Server error" });
  }
};
