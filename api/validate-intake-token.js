/**
 * /api/validate-intake-token
 * Validates a one-time intake access token
 * Returns: { valid, email, planType } or { valid: false }
 * Does NOT burn the token — that happens on intake completion
 */
const crypto = require("crypto");

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

async function deleteFromKV(key) {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) return;
  await fetch(url + "/del/" + encodeURIComponent(key), {
    method: "POST",
    headers: { Authorization: "Bearer " + token }
  }).catch(function() {});
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ valid: false });

  try {
    const { token, burn } = req.body;
    if (!token) return res.status(400).json({ valid: false });

    const key = "intake_token:" + token;
    const record = await getFromKV(key);

    if (!record) return res.status(200).json({ valid: false, reason: "Token not found or expired" });
    if (record.used) return res.status(200).json({ valid: false, reason: "Token already used" });

    // If burn=true, mark as used (called after intake completion)
    if (burn) {
      record.used = true;
      record.usedAt = new Date().toISOString();
      const url = process.env.KV_REST_API_URL;
      const kvToken = process.env.KV_REST_API_TOKEN;
      if (url && kvToken) {
        await fetch(url + "/set/" + encodeURIComponent(key), {
          method: "POST",
          headers: { Authorization: "Bearer " + kvToken, "Content-Type": "application/json" },
          body: JSON.stringify(record)
        }).catch(function() {});
      }
    }

    return res.status(200).json({
      valid: true,
      email: record.email,
      planType: record.planType,
      name: record.name || ""
    });

  } catch(err) {
    console.error("validate-intake-token error:", err);
    return res.status(500).json({ valid: false });
  }
};
