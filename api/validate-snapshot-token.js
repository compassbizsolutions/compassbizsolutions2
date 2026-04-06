/**
 * /api/validate-snapshot-token
 * Validates a snapshot session token from the welcome email
 */

async function getFromKV(key) {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  try {
    const res = await fetch(url + "/get/" + encodeURIComponent(key), {
      headers: { Authorization: "Bearer " + token }
    });
    const data = await res.json();
    return data.result ? JSON.parse(data.result) : null;
  } catch(e) { return null; }
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ valid: false, error: "Token required" });

    const session = await getFromKV("snapshot_session:" + token);
    if (!session) return res.status(200).json({ valid: false, reason: "Token expired or invalid" });

    // Check expiry (7 days)
    const created = new Date(session.createdAt);
    const now = new Date();
    const daysDiff = (now - created) / (1000 * 60 * 60 * 24);
    if (daysDiff > 7) return res.status(200).json({ valid: false, reason: "Link expired" });

    return res.status(200).json({
      valid: true,
      email: session.email,
      name: session.name || "",
      biz: session.biz || "",
    });

  } catch(err) {
    console.error("validate-snapshot-token error:", err.message);
    return res.status(500).json({ valid: false, error: "Server error" });
  }
};
