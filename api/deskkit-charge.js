/**
 * /api/deskkit-charge
 * POST — charge customer for a DeskKit task via Stripe
 * Creates task record in KV, processes payment
 */
const crypto = require("crypto");
const { Resend } = require("resend");

const PRICES = { simple: 1500, moderate: 3500, complex: 7500 }; // cents

// Replace with your actual Stripe price IDs
const STRIPE_PRICES = {
  simple:   process.env.DESKKIT_PRICE_SIMPLE,
  moderate: process.env.DESKKIT_PRICE_MODERATE,
  complex:  process.env.DESKKIT_PRICE_COMPLEX
};

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

    const { tier, price, desc, filename } = req.body || {};
    if (!tier || !price || !desc) return res.status(400).json({ error: "Missing required fields" });

    const validTiers = ["simple", "moderate", "complex"];
    if (!validTiers.includes(tier)) return res.status(400).json({ error: "Invalid tier" });

    // Create task ID
    const taskId = "dsk_" + Date.now().toString(36) + crypto.randomBytes(4).toString("hex");

    // Charge via Stripe
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) return res.status(500).json({ error: "Stripe not configured" });

    // Get customer's Stripe customer ID or create one
    const emailKey = email.toLowerCase().replace(/[^a-z0-9@._-]/g, "");
    const customer = await getFromKV("customer:" + emailKey);

    // Create payment intent
    const paymentResponse = await fetch("https://api.stripe.com/v1/payment_intents", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + stripeKey,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        amount: String(PRICES[tier]),
        currency: "usd",
        description: `DeskKit ${tier} task - ${desc.slice(0, 100)}`,
        "metadata[taskId]": taskId,
        "metadata[email]": email,
        "metadata[tier]": tier,
        confirm: "false"
      })
    });

    const paymentData = await paymentResponse.json();

    if (paymentData.error) {
      return res.status(400).json({ error: paymentData.error.message });
    }

    // Save task to KV
    await saveToKV("deskkit_task:" + taskId, {
      id: taskId,
      email,
      tier,
      price,
      desc,
      filename: filename || null,
      status: "pending",
      paymentIntentId: paymentData.id,
      createdAt: new Date().toISOString(),
      result: null
    });

    // Add to user's task list
    const taskList = await getFromKV("deskkit_tasks:" + emailKey) || [];
    taskList.unshift(taskId);
    await saveToKV("deskkit_tasks:" + emailKey, taskList);

    // Notify Jen
    const resend = new Resend(process.env.RESEND_API_KEY);
    resend.emails.send({
      from: "DeskKit <" + (process.env.FROM_EMAIL || "reports@compassbizsolutions.com") + ">",
      to: "jen@compassbizsolutions.com",
      subject: `New DeskKit Task — ${tier} $${price} — ${email}`,
      html: `<div style="font-family:sans-serif;max-width:500px;">
        <h2 style="color:#C8701A;">New DeskKit Task</h2>
        <p><strong>Customer:</strong> ${email}</p>
        <p><strong>Tier:</strong> ${tier} ($${price})</p>
        <p><strong>File:</strong> ${filename || "No file"}</p>
        <p><strong>Task:</strong></p>
        <pre style="background:#f5f5f5;padding:12px;border-radius:6px;font-size:13px;line-height:1.6">${desc}</pre>
        <p><strong>Task ID:</strong> ${taskId}</p>
      </div>`
    }).catch(() => {});

    return res.status(200).json({ success: true, taskId, paymentIntentId: paymentData.id });

  } catch(err) {
    console.error("deskkit-charge error:", err.message);
    return res.status(500).json({ error: "Server error" });
  }
};
