/**
 * /api/portal-reset
 * POST { email } — sends password reset link
 * POST { token, password } — sets new password
 */
const crypto = require("crypto");
const { Resend } = require("resend");

function emailKey(email) {
  return email.toLowerCase().trim().replace(/[^a-z0-9@._-]/g, "");
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, "sha512").toString("hex");
  return salt + ":" + hash;
}

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

async function deleteFromKV(key) {
  const { url, token } = getKV();
  if (!url || !token) return;
  await fetch(url + "/del/" + encodeURIComponent(key), {
    method: "POST", headers: { Authorization: "Bearer " + token }
  });
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { email, token, password } = req.body || {};

    // ── STEP 1: Request reset link ──────────────────────────────
    if (email && !token) {
      const eKey = emailKey(email);
      const customer = await getFromKV("customer:" + eKey);

      // Always return success to prevent email enumeration
      if (!customer) {
        return res.status(200).json({ success: true, message: "If an account exists for that email, a reset link is on its way." });
      }

      // Generate reset token (1 hour expiry)
      const resetToken = crypto.randomBytes(32).toString("hex");
      await saveToKV("reset:" + resetToken, {
        email: email.toLowerCase().trim(),
        created: new Date().toISOString()
      }, 3600);

      const resetUrl = `https://www.compassbizsolutions.com/portal/app?reset=${resetToken}`;
      const firstName = customer.firstName || customer.name?.split(" ")[0] || "there";

      const resend = new Resend(process.env.RESEND_API_KEY);
      await resend.emails.send({
        from: "Compass Business Solutions <" + (process.env.FROM_EMAIL || "reports@compassbizsolutions.com") + ">",
        to: email,
        subject: "Reset your DeskKit password",
        html: `
        <div style="font-family:sans-serif;max-width:520px;margin:0 auto;background:#0D1B2A;color:#E2EAF2;">
          <div style="background:#0F1E2E;padding:24px 28px;border-bottom:1px solid rgba(255,255,255,0.06);">
            <div style="font-size:9px;letter-spacing:4px;text-transform:uppercase;color:#C8701A;font-weight:700;">Compass Business Solutions</div>
            <div style="font-size:22px;font-weight:700;color:#fff;margin-top:6px;">Reset your password</div>
          </div>
          <div style="padding:28px;">
            <p style="font-size:15px;color:#8AAAC8;line-height:1.7;margin-bottom:24px;">Hi ${firstName} — click the button below to reset your DeskKit password. This link expires in 1 hour.</p>
            <div style="text-align:center;margin:28px 0;">
              <a href="${resetUrl}" style="background:#C8701A;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px;display:inline-block;">Reset My Password →</a>
            </div>
            <p style="font-size:12px;color:#5A7A9A;line-height:1.6;">If you didn't request this, ignore this email — your password won't change.</p>
            <p style="font-size:12px;color:#5A7A9A;margin-top:16px;">Or copy this link: <a href="${resetUrl}" style="color:#C8701A;">${resetUrl}</a></p>
          </div>
        </div>`
      });

      return res.status(200).json({ success: true, message: "If an account exists for that email, a reset link is on its way." });
    }

    // ── STEP 2: Set new password ────────────────────────────────
    if (token && password) {
      if (password.length < 8) {
        return res.status(400).json({ error: "Password must be at least 8 characters." });
      }

      const resetData = await getFromKV("reset:" + token);
      if (!resetData) {
        return res.status(401).json({ error: "This reset link has expired or already been used." });
      }

      const eKey = emailKey(resetData.email);
      const customer = await getFromKV("customer:" + eKey);
      if (!customer) {
        return res.status(404).json({ error: "Account not found." });
      }

      // Update password
      await saveToKV("customer:" + eKey, Object.assign({}, customer, {
        password_hash: hashPassword(password),
        password_reset_at: new Date().toISOString()
      }));

      // Delete reset token
      await deleteFromKV("reset:" + token);

      // Create new session
      const sessionToken = crypto.randomBytes(32).toString("hex");
      const sessionData = { email: resetData.email, created: new Date().toISOString() };
      await saveToKV("session:" + sessionToken, sessionData, 60 * 60 * 24 * 30);
      await saveToKV("portal_session:" + sessionToken, sessionData, 60 * 60 * 24 * 30);

      return res.status(200).json({
        success: true,
        token: sessionToken,
        name: customer.name || "",
        email: resetData.email
      });
    }

    return res.status(400).json({ error: "Email or reset token required." });

  } catch(err) {
    console.error("portal-reset error:", err.message);
    return res.status(500).json({ error: "Server error." });
  }
};
