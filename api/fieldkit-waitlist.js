/**
 * /api/fieldkit-waitlist
 * POST — saves waitlist signup to KV + sends confirmation email via Resend
 */

function emailKey(email) {
  return email.toLowerCase().replace(/[^a-z0-9@._-]/g, "");
}

async function saveToKV(key, value) {
  const url   = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) throw new Error("KV not configured");
  const r = await fetch(url + "/set/" + encodeURIComponent(key), {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify(value)
  });
  if (!r.ok) throw new Error("KV write failed");
}

async function sendEmail(to, subject, html) {
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + process.env.RESEND_API_KEY,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: "FieldKit by Compass <reports@compassbizsolutions.com>",
      to,
      subject,
      html
    })
  });
  if (!r.ok) {
    const err = await r.text();
    throw new Error("Resend failed: " + err);
  }
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { company, ownerName, email, phone, features = [] } = req.body || {};

    if (!company || !ownerName || !email || !phone) {
      return res.status(400).json({ error: "All fields are required" });
    }

    const eKey     = emailKey(email);
    const signedAt = new Date().toISOString();

    // Save to KV
    await saveToKV("waitlist:fieldkit:" + eKey, {
      company,
      ownerName,
      email: email.toLowerCase().trim(),
      phone,
      features,
      signedAt
    });

    const featuresHtml = features.length
      ? `<ul style="margin:8px 0 0;padding-left:20px;color:#c8d8e8;">${features.map(f => `<li style="margin-bottom:4px;">${f}</li>`).join("")}</ul>`
      : "<p style='color:#8aa5c0;'>No specific features selected</p>";

    // Confirmation email to signup
    await sendEmail(
      email.toLowerCase().trim(),
      "You're on the FieldKit Waitlist 🎉",
      `
      <div style="background:#111E31;padding:40px;font-family:'Barlow',Helvetica,sans-serif;max-width:600px;margin:0 auto;border-radius:8px;">
        <div style="margin-bottom:24px;">
          <p style="font-size:11px;font-weight:700;letter-spacing:3px;text-transform:uppercase;color:#C8701A;margin:0 0 4px;">Compass Business Solutions</p>
          <p style="font-size:28px;font-weight:900;text-transform:uppercase;letter-spacing:1px;color:#F4F7FC;margin:0;font-family:'Barlow Condensed',Helvetica,sans-serif;">FieldKit</p>
        </div>
        <h1 style="font-family:'Barlow Condensed',Helvetica,sans-serif;font-size:36px;font-weight:900;text-transform:uppercase;color:#F4F7FC;margin:0 0 16px;">You're In, ${ownerName}.</h1>
        <p style="font-size:16px;color:#c8d8e8;line-height:1.6;margin:0 0 24px;">We've saved your spot on the FieldKit waitlist. When we launch on <strong style="color:#C8701A;">May 18, 2026</strong>, you'll be first in line with two full weeks to get your team set up and your operation ready before Q3 kicks off.</p>
        <div style="background:#162440;border:1px solid rgba(61,107,158,0.25);border-radius:4px;padding:20px;margin-bottom:24px;">
          <p style="font-family:'Barlow Condensed',Helvetica,sans-serif;font-size:12px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#8aa5c0;margin:0 0 10px;">Your signup details</p>
          <p style="font-size:14px;color:#c8d8e8;margin:0 0 4px;"><strong style="color:#F4F7FC;">Company:</strong> ${company}</p>
          <p style="font-size:14px;color:#c8d8e8;margin:0 0 12px;"><strong style="color:#F4F7FC;">Features interested in:</strong></p>
          ${featuresHtml}
        </div>
        <p style="font-size:15px;color:#c8d8e8;line-height:1.6;margin:0 0 24px;">Questions before launch? Reply to this email or reach us at <a href="mailto:jen@compassbizsolutions.com" style="color:#C8701A;">jen@compassbizsolutions.com</a></p>
        <a href="https://www.compassbizsolutions.com/trades/fieldkit/" style="display:inline-block;background:#C8701A;color:#fff;text-decoration:none;border-radius:3px;padding:14px 28px;font-family:'Barlow Condensed',Helvetica,sans-serif;font-size:15px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;">Preview the Live Demo →</a>
        <p style="font-size:12px;color:#5A7291;margin-top:32px;">© 2026 Compass Business Solutions · <a href="https://www.compassbizsolutions.com" style="color:#5A7291;">compassbizsolutions.com</a></p>
      </div>
      `
    );

    // Notification to Jen
    await sendEmail(
      "reports@compassbizsolutions.com",
      `New FieldKit Waitlist Signup — ${company}`,
      `
      <div style="font-family:Helvetica,sans-serif;max-width:500px;">
        <h2 style="color:#C8701A;">New FieldKit Waitlist Signup</h2>
        <p><strong>Company:</strong> ${company}</p>
        <p><strong>Owner:</strong> ${ownerName}</p>
        <p><strong>Email:</strong> ${email}</p>
        <p><strong>Phone:</strong> ${phone}</p>
        <p><strong>Signed up:</strong> ${new Date(signedAt).toLocaleString()}</p>
        <p><strong>Features interested in:</strong></p>
        <ul>${features.map(f => `<li>${f}</li>`).join("") || "<li>None selected</li>"}</ul>
      </div>
      `
    );

    return res.status(200).json({ success: true });

  } catch(err) {
    console.error("fieldkit-waitlist error:", err.message);
    return res.status(500).json({ error: "Failed to save. Please try again." });
  }
};
