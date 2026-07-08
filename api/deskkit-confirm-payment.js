/**
 * /api/deskkit-confirm-payment
 * POST — verify a PaymentIntent actually succeeded (checked directly with Stripe,
 * never trusting the client's claim), then flip the task from pending_payment to pending.
 */
const { Resend } = require("resend");

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
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const authHeader = req.headers.authorization || "";
    const sessionToken = authHeader.replace("Bearer ", "").trim();
    const email = await validateSession(sessionToken);
    if (!email) return res.status(401).json({ error: "Unauthorized" });

    const { taskId, paymentIntentId } = req.body || {};
    if (!taskId || !paymentIntentId) return res.status(400).json({ error: "Missing taskId or paymentIntentId" });

    const task = await getFromKV("deskkit_task:" + taskId);
    if (!task) return res.status(404).json({ error: "Task not found" });
    if (task.email !== email) return res.status(403).json({ error: "Forbidden" });
    if (task.paymentIntentId !== paymentIntentId) return res.status(400).json({ error: "Payment mismatch" });

    // Already confirmed — don't double-process
    if (task.status !== "pending_payment") {
      return res.status(200).json({ success: true, alreadyConfirmed: true });
    }

    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) return res.status(500).json({ error: "Stripe not configured" });

    // Ask Stripe directly whether this PaymentIntent actually succeeded —
    // never trust the client's word alone.
    const verifyResponse = await fetch(`https://api.stripe.com/v1/payment_intents/${paymentIntentId}`, {
      headers: { Authorization: "Bearer " + stripeKey }
    });
    const verifyData = await verifyResponse.json();

    if (verifyData.error) return res.status(400).json({ error: verifyData.error.message });
    if (verifyData.status !== "succeeded") {
      return res.status(400).json({ error: "Payment has not completed.", status: verifyData.status });
    }

    // Payment confirmed — release the task to be worked on
    const updated = Object.assign({}, task, {
      status: "pending",
      confirmedAt: new Date().toISOString()
    });
    await saveToKV("deskkit_task:" + taskId, updated);

    // Notify Jen now that this is a real, paid task
    try {
      const resend = new Resend(process.env.RESEND_API_KEY);
      await resend.emails.send({
        from: "DeskKit <" + (process.env.FROM_EMAIL || "reports@compassbizsolutions.com") + ">",
        to: "reports@compassbizsolutions.com",
        subject: `Paid DeskKit Task — ${task.tier} $${task.price} — ${email}`,
        html: `<div style="font-family:sans-serif;max-width:500px;">
          <h2 style="color:#C8701A;">New Paid DeskKit Task</h2>
          <p><strong>Customer:</strong> ${email}</p>
          <p><strong>Tier:</strong> ${task.tier} ($${task.price})</p>
          <p><strong>File:</strong> ${task.filename || "No file"}</p>
          <p><strong>Task:</strong></p>
          <pre style="background:#f5f5f5;padding:12px;border-radius:6px;font-size:13px;line-height:1.6">${task.desc}</pre>
          <p><strong>Task ID:</strong> ${taskId}</p>
        </div>`
      });
    } catch(emailErr) { console.error("Notify email error:", emailErr.message); }

    return res.status(200).json({ success: true });

  } catch(err) {
    console.error("deskkit-confirm-payment error:", err.message);
    return res.status(500).json({ error: "Server error" });
  }
};
