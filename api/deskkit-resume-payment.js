/**
 * /api/deskkit-resume-payment
 * POST — resume an abandoned pending_payment task at its already-quoted price.
 * Creates a fresh PaymentIntent for the exact same amount rather than re-running
 * the analyze step, since the customer already saw and accepted that price.
 */

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

    const { taskId } = req.body || {};
    if (!taskId) return res.status(400).json({ error: "Missing taskId" });

    const task = await getFromKV("deskkit_task:" + taskId);
    if (!task) return res.status(404).json({ error: "Task not found" });
    if (task.email !== email) return res.status(403).json({ error: "Forbidden" });

    if (task.status !== "pending_payment") {
      return res.status(400).json({ error: "This task isn't waiting on payment anymore." });
    }

    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) return res.status(500).json({ error: "Stripe not configured" });

    const amountCents = Math.round(task.price * 100);

    const paymentResponse = await fetch("https://api.stripe.com/v1/payment_intents", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + stripeKey,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        amount: String(amountCents),
        currency: "usd",
        description: `DeskKit ${task.tier} task (resumed) - ${(task.desc || "").slice(0, 100)}`,
        "automatic_payment_methods[enabled]": "true",
        "metadata[taskId]": taskId,
        "metadata[email]": email,
        "metadata[tier]": task.tier,
        "metadata[resumed]": "true"
      })
    });

    const paymentData = await paymentResponse.json();
    if (paymentData.error) return res.status(400).json({ error: paymentData.error.message });

    await saveToKV("deskkit_task:" + taskId, Object.assign({}, task, {
      paymentIntentId: paymentData.id,
      updatedAt: new Date().toISOString()
    }));

    return res.status(200).json({
      success: true,
      taskId,
      clientSecret: paymentData.client_secret,
      paymentIntentId: paymentData.id,
      price: task.price,
      desc: task.desc,
      tier: task.tier
    });

  } catch(err) {
    console.error("deskkit-resume-payment error:", err.message);
    return res.status(500).json({ error: "Server error" });
  }
};
