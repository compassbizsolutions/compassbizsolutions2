/**
 * /api/portal-request-access
 * POST — sends access request to Jen, saves to KV
 */

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

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { name, email, company, needs } = req.body || {};
    if (!name || !email) return res.status(400).json({ error: "Name and email required" });

    const now = new Date().toISOString();

    // Save to KV
    const existing = await getFromKV("portal_access_requests") || [];
    await saveToKV("portal_access_requests", [{
      name, email, company: company || "", needs: needs || "",
      requested_at: now, status: "pending"
    }, ...existing]);

    // Email Jen
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + process.env.RESEND_API_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: "Compass Portal <reports@compassbizsolutions.com>",
        to: "reports@compassbizsolutions.com",
        subject: `Portal Access Request — ${name} (${company || email})`,
        html: `<div style="font-family:sans-serif;max-width:500px;">
          <h2 style="color:#C8701A;">New Portal Access Request</h2>
          <p><strong>Name:</strong> ${name}</p>
          <p><strong>Email:</strong> ${email}</p>
          <p><strong>Company:</strong> ${company || "Not provided"}</p>
          <p><strong>What they need:</strong></p>
          <p style="background:#f5f5f5;padding:12px;border-radius:4px;">${needs || "Not provided"}</p>
          <p><strong>Requested:</strong> ${new Date(now).toLocaleString()}</p>
          <hr/>
          <p style="color:#666;font-size:13px;">Set up their account in the admin dashboard, then send them their login details.</p>
        </div>`
      })
    });

    // Confirmation to requester
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + process.env.RESEND_API_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: "Compass Business Solutions <reports@compassbizsolutions.com>",
        to: email,
        subject: "Portal Access Request Received",
        html: `<div style="font-family:sans-serif;max-width:500px;background:#111E31;padding:32px;border-radius:8px;color:#F4F7FC;">
          <p style="font-size:11px;letter-spacing:3px;color:#C8701A;text-transform:uppercase;font-weight:700;">Compass Business Solutions</p>
          <h2 style="color:#F4F7FC;">Got it, ${name.split(' ')[0]}!</h2>
          <p style="color:#c8d8e8;">Your portal access request has been received. We'll get you set up within 24 hours and send you your login details.</p>
          <p style="color:#c8d8e8;">Questions in the meantime? Email <a href="mailto:jen@compassbizsolutions.com" style="color:#C8701A;">jen@compassbizsolutions.com</a></p>
          <p style="color:#8aa5c0;margin-top:24px;font-size:13px;">© 2026 Compass Business Solutions</p>
        </div>`
      })
    });

    return res.status(200).json({ success: true });

  } catch(err) {
    console.error("portal-request-access error:", err.message);
    return res.status(500).json({ error: "Failed to submit request" });
  }
};
