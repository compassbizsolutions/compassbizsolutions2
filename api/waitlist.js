/**
 * /api/waitlist
 * Saves a waitlist email to KV
 */
const { Resend } = require("resend");

async function saveToKV(key, value) {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) return;
  await fetch(url + "/set/" + encodeURIComponent(key), {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify(value)
  });
}

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
    const { email, name, trade, source } = req.body;
    if (!email || !email.includes("@")) return res.status(400).json({ error: "Valid email required" });

    const emailKey = email.toLowerCase().replace(/[^a-z0-9@._-]/g, "");
    const now = new Date().toISOString();

    // Check if already on waitlist
    const existing = await getFromKV("waitlist:" + emailKey);
    if (existing) return res.status(200).json({ success: true, already: true });

    // Save to KV
    await saveToKV("waitlist:" + emailKey, {
      email,
      name: name || "",
      trade: trade || "",
      source: source || "website",
      created_at: now,
    });

    // Confirm email to user
    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({
      from: "Compass Business Solutions <" + (process.env.FROM_EMAIL || "reports@compassbizsolutions.com") + ">",
      to: email,
      subject: "You're on the list — Compass App early access",
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
          <div style="background:#1B2E4B;padding:28px 32px;border-radius:8px 8px 0 0;">
            <div style="font-size:10px;color:rgba(255,255,255,0.35);letter-spacing:3px;margin-bottom:10px;">COMPASS BUSINESS SOLUTIONS</div>
            <div style="font-size:22px;font-weight:bold;color:#C8701A;">You're on the early access list.</div>
          </div>
          <div style="background:#F7F5F2;padding:28px 32px;border-radius:0 0 8px 8px;border:1px solid #D8D4CD;">
            <p style="font-size:14px;color:#1A2332;font-weight:600;margin-top:0;">Hi${name ? " " + name.split(" ")[0] : ""},</p>
            <p style="font-size:13px;color:#3E4E63;line-height:1.75;">We're building something that doesn't exist yet — a field service app with the Compass profit methodology built directly into the workflow. AI-assisted quoting based on your actual loaded cost. Scheduling, dispatch, invoicing, inventory, and payroll records all in one place. Built specifically for trades.</p>
            <p style="font-size:13px;color:#3E4E63;line-height:1.75;">You'll hear from us first when early access opens. If you're already a FixKit customer, your numbers and trade profile carry over automatically — onboarding takes minutes, not hours.</p>
            <div style="background:#1B2E4B;border-radius:8px;padding:16px 20px;margin:20px 0;">
              <p style="font-size:12px;color:rgba(255,255,255,0.6);margin:0;line-height:1.7;">Questions or want to share what you'd need from a tool like this? Hit reply — we build based on what owners actually ask for.</p>
            </div>
            <p style="margin:20px 0 0;color:#3E4E63;font-size:13px;">— Jen, Compass Business Solutions</p>
          </div>
          <div style="text-align:center;padding:16px;font-size:11px;color:#A0ABBE;">
            Compass Business Solutions · compassbizsolutions.com
          </div>
        </div>`
    });

    // Alert Jen
    resend.emails.send({
      from: "Compass Business Solutions <" + (process.env.FROM_EMAIL || "reports@compassbizsolutions.com") + ">",
      to: "jen@compassbizsolutions.com",
      subject: "New app waitlist signup — " + email,
      html: "<p>New waitlist signup: <b>" + email + "</b>" + (name ? " (" + name + ")" : "") + (trade ? " — " + trade : "") + "</p>"
    }).catch(() => {});

    return res.status(200).json({ success: true });

  } catch(err) {
    console.error("waitlist error:", err.message);
    return res.status(500).json({ error: "Failed", detail: err.message });
  }
};
