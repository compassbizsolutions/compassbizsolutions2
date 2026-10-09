/**
 * /api/fieldkit-founding-details
 * The "Tell Jen about your business" form on /trades/fieldkit/reserved/.
 *
 * GET  ?session_id=cs_...           -> { email, name, biz, phone, details } to prefill
 * POST { session_id, ...answers }   -> saves the answers on the reservation
 * POST { email, ...answers }        -> same, when the page was opened without a
 *                                      session_id; only fills in a reservation that
 *                                      has no answers yet
 *
 * The reservation itself lives at fieldkit:founding:<email>, written by the FixKit
 * Stripe webhook (same Upstash database). If the form beats the webhook, the
 * answers are saved first and the webhook fills in the payment when it lands.
 */

function kvCreds() {
  return {
    url: process.env.lime_KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL,
    token: process.env.lime_KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN,
  };
}
async function getFromKV(key) {
  const { url, token } = kvCreds();
  const r = await fetch(url + "/get/" + encodeURIComponent(key), { headers: { Authorization: "Bearer " + token } });
  const d = await r.json();
  try { return d.result ? JSON.parse(d.result) : null; } catch (e) { return null; }
}
async function saveToKV(key, value) {
  const { url, token } = kvCreds();
  await fetch(url + "/set/" + encodeURIComponent(key), {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify(value),
  });
}
function emailKey(email) {
  return String(email || "").toLowerCase().trim().replace(/[^a-z0-9@._-]/g, "");
}
function clean(v, max) {
  return String(v == null ? "" : v).replace(/[<>]/g, "").trim().slice(0, max || 200);
}
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

// Look up a paid FieldKit Founding checkout and return the buyer's email + what Stripe has
async function founderFromSession(sessionId) {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key || !/^cs_[A-Za-z0-9_]+$/.test(sessionId || "")) return null;
  const r = await fetch("https://api.stripe.com/v1/checkout/sessions/" + sessionId + "?expand[]=line_items", {
    headers: { Authorization: "Bearer " + key },
  });
  if (!r.ok) return null;
  const s = await r.json();
  if (s.payment_status !== "paid" && s.payment_status !== "no_payment_required") return null;
  const desc = ((s.line_items && s.line_items.data) || []).map(li => li.description || "").join(" ");
  if (!/fieldkit\s+founding/i.test(desc)) return null;
  const cd = s.customer_details || {};
  if (!cd.email && !s.customer_email) return null;
  return { email: (cd.email || s.customer_email).toLowerCase().trim(), name: cd.name || "", phone: cd.phone || "" };
}

async function sendEmail(to, subject, html) {
  if (!process.env.RESEND_API_KEY) return;
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: "Bearer " + process.env.RESEND_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ from: "FieldKit by Compass <reports@compassbizsolutions.com>", to, subject, html }),
  });
}

const FIELDS = {
  name: 120, biz: 160, phone: 40, trade: 80, techs: 20, office: 20, software: 160,
  best_time: 120, notes: 1500,
};

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    if (req.method === "GET") {
      const f = await founderFromSession(String(req.query.session_id || ""));
      if (!f) return res.status(404).json({ error: "not_found" });
      const rec = (await getFromKV("fieldkit:founding:" + emailKey(f.email))) || {};
      // Step 1 answers (given before paying), in case the webhook hasn't merged them yet
      const st = (await getFromKV("fieldkit:started:" + emailKey(f.email))) || {};
      const pre = rec.prepay || {};
      return res.status(200).json({
        email: f.email,
        name: rec.name || st.name || f.name, biz: rec.biz || st.biz || "", phone: rec.phone || st.phone || f.phone,
        trade: pre.trade || st.trade || "", techs: pre.techs || st.techs || "",
        details: rec.details || null,
      });
    }
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    const b = req.body || {};
    let email = "", verified = false, stripeInfo = null;
    if (b.session_id) {
      stripeInfo = await founderFromSession(String(b.session_id));
      if (!stripeInfo) return res.status(404).json({ error: "We couldn't find that reservation. Email support@compassbizsolutions.com and Jen will sort it out." });
      email = stripeInfo.email; verified = true;
    } else {
      email = String(b.email || "").toLowerCase().trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: "Enter the email you used to pay." });
    }

    const key = "fieldkit:founding:" + emailKey(email);
    const prior = await getFromKV(key);
    if (!verified) {
      // Opened without the Stripe link: only fill in a real reservation, and only once
      if (!prior) return res.status(404).json({ error: "We couldn't find a reservation for that email. Use the email you paid with, or email support@compassbizsolutions.com." });
      if (prior.details) return res.status(409).json({ error: "We already have your details. To change them, email support@compassbizsolutions.com." });
    }

    const d = {};
    Object.keys(FIELDS).forEach(k => { d[k] = clean(b[k], FIELDS[k]); });
    d.interests = (Array.isArray(b.interests) ? b.interests : []).map(x => clean(x, 60)).filter(Boolean).slice(0, 12);
    if (!d.name || !d.biz || !d.phone) return res.status(400).json({ error: "Name, business name and phone are required." });
    d.submitted_at = new Date().toISOString();

    const rec = Object.assign({}, prior || { email, status: "reserved", reserved_at: d.submitted_at }, {
      email: (prior && prior.email) || email,
      name: d.name, biz: d.biz, phone: d.phone,
      details: d,
    });
    await saveToKV(key, rec);

    const row = (label, v) => v ? `<tr><td style="padding:4px 12px 4px 0;color:#5A7291;vertical-align:top">${label}</td><td style="padding:4px 0">${esc(v)}</td></tr>` : "";
    await sendEmail(
      "reports@compassbizsolutions.com",
      "FieldKit founding details — " + d.biz,
      `<div style="font-family:Helvetica,sans-serif;max-width:560px;color:#1B2E4B">
        <h2 style="color:#C8701A;margin:0 0 12px">FieldKit founding member: business details</h2>
        <table style="font-size:14px;border-collapse:collapse">
          ${row("Name", d.name)}${row("Business", d.biz)}${row("Email", email)}${row("Phone", d.phone)}
          ${row("Trade", d.trade)}${row("Field techs", d.techs)}${row("Office staff", d.office)}
          ${row("Uses today", d.software)}${row("Most interested in", d.interests.join(", "))}
          ${row("Best time for setup call", d.best_time)}${row("Notes", d.notes)}
          ${row("Plan", prior && prior.product)}
        </table>
        <p style="font-size:13px;color:#5A7291">Also in the admin dashboard under FieldKit.</p>
      </div>`
    ).catch(() => {});

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("fieldkit-founding-details error:", err.message);
    return res.status(500).json({ error: "Something went wrong saving your details. Email support@compassbizsolutions.com and Jen will take them by email." });
  }
};
