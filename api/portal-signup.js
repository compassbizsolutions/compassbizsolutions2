/**
 * /api/portal-signup
 * POST — create a new portal customer account
 * Used by non-FixKit customers signing up directly
 */
const crypto = require("crypto");

function emailKey(email) {
  return email.toLowerCase().trim().replace(/[^a-z0-9@._-]/g, "");
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, "sha512").toString("hex");
  return salt + ":" + hash;
}

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

async function saveToKV(key, value) {
  const url   = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) return;
  await fetch(url + "/set/" + encodeURIComponent(key), {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify(value)
  });
}

function generateToken() {
  return crypto.randomBytes(32).toString("hex");
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const {
      name, firstName, lastName, biz, industry,
      phone, state, email, password, prefs
    } = req.body || {};

    if (!email || !password || !name) {
      return res.status(400).json({ error: "Name, email, and password are required." });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: "Password must be at least 8 characters." });
    }

    const eKey = emailKey(email);

    // Check if account already exists
    const existing = await getFromKV("customer:" + eKey);
    if (existing && existing.password_hash) {
      return res.status(409).json({ error: "An account already exists for this email. Please log in instead." });
    }

    const now = new Date().toISOString();
    const passwordHash = hashPassword(password);

    // Create customer record
    const customer = {
      email:         email.toLowerCase().trim(),
      name:          name || (firstName + " " + lastName),
      firstName:     firstName || "",
      lastName:      lastName  || "",
      biz:           biz       || "",
      industry:      industry  || "",
      phone:         phone     || "",
      state:         state     || "",
      password_hash: passwordHash,
      portal_signup: true,
      prefs:         prefs     || {},
      created_at:    now,
      updated:       now,
      plan_type:     null,
      purchases:     [],
      source:        "portal_signup",
    };

    await saveToKV("customer:" + eKey, customer);

    // Create session (30 day TTL)
    const token = generateToken();
    await saveToKV("portal_session:" + token, {
      email: email.toLowerCase().trim(),
      created: now
    });
    // Also write as session: for FixKit compatibility
    await saveToKV("session:" + token, {
      email: email.toLowerCase().trim(),
      created: now
    });

    // Send welcome email
    try {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + process.env.RESEND_API_KEY,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          from: "Compass Business Solutions <reports@compassbizsolutions.com>",
          to: email,
          subject: "Welcome to the Compass Client Portal",
          html: `
          <div style="font-family:sans-serif;max-width:560px;margin:0 auto;background:#0C1520;color:#FAFCFE;">
            <div style="background:#0F1E30;padding:24px 28px;border-bottom:1px solid rgba(120,160,200,0.15);">
              <div style="font-size:9px;letter-spacing:4px;text-transform:uppercase;color:#D4820F;margin-bottom:4px;font-weight:600;">Compass Business Solutions</div>
              <div style="font-family:Georgia,serif;font-size:22px;font-weight:700;color:#FAFCFE;">Welcome, ${firstName || name.split(" ")[0]}.</div>
            </div>
            <div style="padding:28px;">
              <p style="font-size:15px;color:#c8d8e8;line-height:1.7;margin-bottom:20px;">Your Compass Client Portal account is ready. You can now submit work requests, get AI-powered quotes, pay securely, and track every deliverable in one place.</p>
              <div style="background:rgba(212,130,15,0.08);border:1px solid rgba(212,130,15,0.2);border-radius:6px;padding:18px;margin-bottom:24px;">
                <div style="font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#D4820F;margin-bottom:12px;">Your portal</div>
                <p style="font-size:13px;color:#7A95B0;margin-bottom:0;line-height:1.6;">Log in at <a href="https://www.compassbizsolutions.com/portal/app" style="color:#D4820F;text-decoration:none;font-weight:600;">compassbizsolutions.com/portal/app</a> with your email and the password you just created.</p>
              </div>
              <p style="font-size:13px;color:#7A95B0;line-height:1.6;">Ready to get something off your plate? Submit your first request — you'll get a custom quote in minutes.</p>
              <div style="text-align:center;margin:28px 0;">
                <a href="https://www.compassbizsolutions.com/portal/app" style="background:#D4820F;color:#0C1520;padding:13px 28px;border-radius:5px;text-decoration:none;font-weight:600;font-size:14px;display:inline-block;">Go to My Portal →</a>
              </div>
              <p style="font-size:12px;color:#4A6580;line-height:1.6;">Questions? Reply to this email or reach out at <a href="mailto:jen@compassbizsolutions.com" style="color:#D4820F;">jen@compassbizsolutions.com</a></p>
            </div>
          </div>`
        })
      });

      // Notify Jen
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: "Bearer " + process.env.RESEND_API_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: "Compass Portal <reports@compassbizsolutions.com>",
          to: "reports@compassbizsolutions.com",
          subject: `New Portal Signup — ${name} (${biz || "no biz listed"})`,
          html: `<div style="font-family:sans-serif;max-width:500px;">
            <h2 style="color:#D4820F;">New Portal Account</h2>
            <p><strong>Name:</strong> ${name}</p>
            <p><strong>Business:</strong> ${biz || "—"}</p>
            <p><strong>Industry:</strong> ${industry || "—"}</p>
            <p><strong>Email:</strong> ${email}</p>
            <p><strong>Phone:</strong> ${phone || "—"}</p>
            <p><strong>State:</strong> ${state || "—"}</p>
            <p><strong>Source:</strong> Direct portal signup</p>
            <p><strong>Referral:</strong> ${prefs?.referral || "—"}</p>
          </div>`
        })
      });
    } catch(emailErr) {
      console.error("Signup email error:", emailErr.message);
    }

    return res.status(200).json({
      success: true,
      token,
      name,
      company: biz || "",
      email: email.toLowerCase().trim(),
    });

  } catch(err) {
    console.error("portal-signup error:", err.message);
    return res.status(500).json({ error: "Failed to create account. Please try again." });
  }
};
