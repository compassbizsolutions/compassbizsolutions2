/**
 * /api/portal-login
 * POST — Compass customer portal login
 * Checks customer record in KV (from FixKit, FieldKit, or direct onboard)
 */
const crypto = require("crypto");

function emailKey(email) {
  return email.toLowerCase().trim().replace(/[^a-z0-9@._-]/g, "");
}

function verifyPassword(password, stored) {
  try {
    if (!stored) return false;
    if (stored.includes(":")) {
      const [salt, hash] = stored.split(":");
      const verify = crypto.pbkdf2Sync(password, salt, 100000, 64, "sha512").toString("hex");
      return verify === hash;
    }
    return password === stored;
  } catch(e) { return false; }
}

function generateToken() {
  return crypto.randomBytes(32).toString("hex");
}

async function getFromKV(key) {
  const url   = process.env.UPSTASH_REDIS_REST_URL || process.env.lime_KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.lime_KV_REST_API_TOKEN;
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
  const url   = process.env.UPSTASH_REDIS_REST_URL || process.env.lime_KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.lime_KV_REST_API_TOKEN;
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

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: "Email and password required" });

    const eKey    = emailKey(email);
    const customer = await getFromKV("customer:" + eKey);

    if (!customer) return res.status(401).json({ error: "No account found for this email." });
    if (!customer.password_hash) return res.status(401).json({ error: "Account setup not complete. Please check your email.", redirect: "/create-account" });

    if (!verifyPassword(password, customer.password_hash)) {
      return res.status(401).json({ error: "Incorrect password." });
    }

    // Create portal session (30 day TTL)
    // Also write to session: key so FixKit and portal share auth
    const token = generateToken();
    await saveToKV("session:" + token, {
      email: email.toLowerCase().trim(),
      created: new Date().toISOString()
    }, 60 * 60 * 24 * 30);
    await saveToKV("portal_session:" + token, {
      email: email.toLowerCase().trim(),
      created: new Date().toISOString()
    }, 60 * 60 * 24 * 30);

    // Update last login
    await saveToKV("customer:" + eKey, Object.assign({}, customer, {
      last_portal_login: new Date().toISOString()
    }));

    return res.status(200).json({
      success: true,
      token,
      name:    customer.name    || "",
      company: customer.biz     || customer.company || "",
      email:   email.toLowerCase().trim(),
    });

  } catch(err) {
    console.error("portal-login error:", err.message);
    return res.status(500).json({ error: "Server error" });
  }
};
