/**
 * /api/stripe-webhook
 * Handles Stripe purchase events
 * On payment: creates customer record in KV, sends welcome/access email
 * Captures email + business name, stores purchase type
 */
const { Resend } = require("resend");
const crypto = require("crypto");

const FIXKIT_URL = process.env.FIXKIT_URL || "https://fixkit.compassbizsolutions.com";

// Map Stripe product IDs to plan types
const STRATEGY_CALL_LINK  = "https://calendly.com/jvoiselle612-s9gb/strategy-call";
const WORKING_SESSION_LINK = "https://calendly.com/jvoiselle612-s9gb/working-session";

const PRODUCT_MAP = {
  // Consulting calls
  "prod_UNB2oYvnCupMC1": "strategy_call",
  "prod_UNB3jVNRxpBTgh": "working_session",
  // Core products
  "prod_UMpDhh7m3whCEX": "snapshot",
  "prod_UMpDPKbpZPNnqT": "30day",
  "prod_UMpDKwYPGVTFjq": "3160",
  "prod_UMpDvHT8CFxOu1": "6190",
  "prod_UMpDb1QADgIpr5": "bundle",
  // Upgrade paths
  "prod_UMpDobMklPMP6m": "30day",   // snapshot → 30day upgrade
  "prod_UMpDthf1rnqW0W": "bundle",  // snapshot → bundle upgrade
};

const PLAN_LABELS = {
  "strategy_call":   "Strategy Call (30 min)",
  "working_session": "Working Session (60 min)",
  "snapshot": "DIY Profit Leak Snapshot",
  "30day":    "FixKit 30-Day Plan",
  "3160":     "FixKit Days 31-60",
  "6190":     "FixKit Days 61-90",
  "bundle":   "FixKit Complete 30/60/90-Day Bundle",
};

// Stripe upgrade links for portal upsells
const UPGRADE_LINKS = {
  "snapshot": {
    label30: "Upgrade to FixKit 30-Day — $199",
    url30:   "https://buy.stripe.com/14AbIUgAs3bK3qn2l8dZ60g",
    labelBundle: "Upgrade to Full Bundle — $499",
    urlBundle:   "https://buy.stripe.com/eVq28keskfYw6CzcZMdZ60e",
  },
  "30day": {
    label3160: "Add Days 31-60 — $299",
    url3160:   "https://buy.stripe.com/aFacMYesk7s06Czf7UdZ60a",
    labelBundle: "Upgrade to Full Bundle",
    urlBundle:   "https://buy.stripe.com/6oU00c1Fy7s0bWT2l8dZ60f",
  },
  "3160": {
    label6190: "Add Days 61-90 — $299",
    url6190:   "https://buy.stripe.com/eVqaEQdog27G0ebe3QdZ60d",
  },
};

async function saveToKV(key, value) {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) { console.warn("KV not configured"); return; }
  try {
    await fetch(url + "/set/" + encodeURIComponent(key), {
      method: "POST",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify(value)
    });
  } catch(e) { console.error("KV save error:", e.message); }
}

async function getFromKV(key) {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  try {
    const r = await fetch(url + "/get/" + encodeURIComponent(key), {
      headers: { Authorization: "Bearer " + token }
    });
    const d = await r.json();
    if (!d.result) return null;
    try { return JSON.parse(d.result); } catch(e) { return d.result; }
  } catch(e) { return null; }
}

function emailKey(email) {
  return email.toLowerCase().replace(/[^a-z0-9@._-]/g, "");
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  // Read raw body from stream (required for Stripe signature verification)
  // vercel.json sets bodyParser:false for this function
  const rawBody = await new Promise(function(resolve, reject) {
    var chunks = [];
    req.on('data', function(chunk) { chunks.push(chunk); });
    req.on('end',  function() { resolve(Buffer.concat(chunks)); });
    req.on('error', reject);
  });

  // Also parse as JSON for fallback use
  let parsedBody;
  try { parsedBody = JSON.parse(rawBody.toString()); } catch(e) { parsedBody = {}; }

  try {
    // Verify Stripe webhook signature
    const sig = req.headers["stripe-signature"];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    let event;

    if (webhookSecret && sig) {
      try {
        const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
        event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
      } catch(e) {
        console.error("Webhook signature failed:", e.message);
        return res.status(400).json({ error: "Invalid signature" });
      }
    } else {
      // No signature verification (development/testing)
      event = parsedBody;
    }

    // Only handle completed checkouts
    if (!event || event.type !== "checkout.session.completed") {
      return res.status(200).json({ received: true });
    }

    const session = event.data && event.data.object;
    if (!session) return res.status(200).json({ received: true });

    const customerEmail = session.customer_details && session.customer_details.email;
    const customerName  = (session.customer_details && session.customer_details.name) || "";
    const bizName       = (session.metadata && session.metadata.business_name) || "";

    // Get product ID — line_items are NOT in the default webhook payload.
    // Must retrieve the session with expand to get them.
    let productId = "";

    // First try metadata (fastest, no extra API call)
    if (session.metadata && session.metadata.product_id) {
      productId = session.metadata.product_id;
    }

    // If no metadata, expand line_items via Stripe API
    if (!productId) {
      try {
        const stripeClient = require("stripe")(process.env.STRIPE_SECRET_KEY);
        const expanded = await stripeClient.checkout.sessions.retrieve(session.id, {
          expand: ["line_items.data.price.product"]
        });
        console.log("Expanded session line_items:", JSON.stringify(expanded.line_items));
        if (expanded.line_items && expanded.line_items.data && expanded.line_items.data[0]) {
          const price = expanded.line_items.data[0].price;
          productId = (price && price.product && price.product.id) || (price && price.product) || "";
          console.log("Found productId:", productId);
        }
      } catch(e) {
        console.error("Could not expand line_items:", e.message);
      }
    }

    console.log("productId:", productId, "planType:", PRODUCT_MAP[productId] || "NOT FOUND IN MAP");

    const planType  = PRODUCT_MAP[productId] || "";
    const planLabel = PLAN_LABELS[planType] || "Your Purchase";

    console.log("Stripe purchase:", planType, customerEmail, customerName);

    if (!customerEmail) {
      console.error("No email on Stripe session:", session.id);
      return res.status(200).json({ received: true });
    }

    const resend = new Resend(process.env.RESEND_API_KEY);
    const eKey   = emailKey(customerEmail);
    const firstName = customerName.split(" ")[0] || "there";

    // ── CONSULTING CALL purchase ──────────────────────────────────────
    if (planType === "strategy_call" || planType === "working_session") {
      const callLabel = planType === "strategy_call" ? "Strategy Call (30 min) — $79" : "Working Session (60 min) — $149";
      const callDuration = planType === "strategy_call" ? "30-minute strategy call" : "60-minute working session";

      await resend.emails.send({
        from: "Compass Business Solutions <" + (process.env.FROM_EMAIL || "reports@compassbizsolutions.com") + ">",
        to: customerEmail,
        subject: "You're booked — " + callLabel,
        html: `<div style="font-family:sans-serif;max-width:580px;margin:0 auto;color:#1B2E4B">
          <div style="background:#1B2E4B;padding:24px;border-radius:8px 8px 0 0">
            <div style="color:#C8701A;font-size:11px;letter-spacing:3px;font-weight:700">COMPASS BUSINESS SOLUTIONS</div>
          </div>
          <div style="background:#F4F7FC;padding:28px;border-radius:0 0 8px 8px;border:1px solid #C8D6E8">
            <p style="font-size:15px">Hey ${firstName},</p>
            <p style="font-size:15px;line-height:1.7">Payment received — thank you. You're confirmed for a <strong>${callDuration}</strong>.</p>
            <p style="font-size:15px;line-height:1.7">Click below to pick your time slot. You'll see my available times and can book whatever works best for you.</p>
            <div style="text-align:center;margin:24px 0">
              <a href="${planType === 'strategy_call' ? STRATEGY_CALL_LINK : WORKING_SESSION_LINK}" style="display:inline-block;background:#C8701A;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px">Book Your Time Slot →</a>
            </div>
            <p style="font-size:14px;color:#5A7291;line-height:1.7">If none of the available times work for you, reply to this email and we'll find something that does.</p>
            <p style="font-size:13px;color:#5A7291">Your $${planType === "strategy_call" ? "79" : "149"} is credited toward any Compass project if you decide to engage us after the call.</p>
            <p style="font-size:14px">— Jen<br>Compass Business Solutions</p>
          </div>
        </div>`
      });

      // Notify Jen
      await resend.emails.send({
        from: "Compass Business Solutions <" + (process.env.FROM_EMAIL || "reports@compassbizsolutions.com") + ">",
        to: process.env.FROM_EMAIL || "reports@compassbizsolutions.com",
        subject: "📅 New call booked — " + callLabel + " — " + customerEmail,
        html: "<p><b>New call booking:</b> " + callLabel + "</p><p>Email: " + customerEmail + "</p><p>Name: " + (customerName || "not provided") + "</p>"
      });

      return res.status(200).json({ received: true });
    }

    // ── SNAPSHOT purchase ──────────────────────────────────────────────
    if (planType === "snapshot") {
      const existing = await getFromKV("customer:" + eKey);

      await saveToKV("customer:" + eKey, {
        ...(existing || {}),
        email:              customerEmail,
        name:               customerName,
        biz:                bizName,
        plan:               "snapshot",
        plan_type:          "snapshot",
        purchases:          ["snapshot"],
        snapshot_purchased: true,
        phase_current:      1,
        intake_complete:    false,
        purchased_at:       new Date().toISOString(),
        stripe_session:     session.id,
      });

      console.log("Snapshot purchased:", customerEmail);

      await resend.emails.send({
        from: "Compass Business Solutions <" + (process.env.FROM_EMAIL || "reports@compassbizsolutions.com") + ">",
        to: customerEmail,
        subject: "You're in — set up your account to get started",
        html: `<div style="font-family:sans-serif;max-width:580px;margin:0 auto;color:#1B2E4B">
          <div style="background:#1B2E4B;padding:24px;border-radius:8px 8px 0 0">
            <div style="color:#C8701A;font-size:11px;letter-spacing:3px;font-weight:700">COMPASS BUSINESS SOLUTIONS</div>
          </div>
          <div style="background:#F4F7FC;padding:28px;border-radius:0 0 8px 8px;border:1px solid #C8D6E8">
            <p style="font-size:15px">Hey ${firstName},</p>
            <p style="font-size:15px;line-height:1.7">Payment received — you're in. Click below to set up your account and complete your intake form. Takes about 5 minutes and is what we use to build your personalized Profit Leak Snapshot.</p>
            <div style="text-align:center;margin:24px 0">
              <a href="${FIXKIT_URL}" style="display:inline-block;background:#C8701A;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px">Set Up My Account →</a>
            </div>
            <p style="font-size:13px;color:#5A7291">Use <strong>${customerEmail}</strong> when you sign in — that's the email tied to your purchase.</p>
            <p style="font-size:13px;color:#5A7291">Once your intake is submitted, you'll receive your Snapshot within 24 hours.</p>
            <p style="font-size:14px">— Jen<br>Compass Business Solutions</p>
          </div>
        </div>`
      });

      resend.emails.send({
        from: "Compass Business Solutions <" + (process.env.FROM_EMAIL || "reports@compassbizsolutions.com") + ">",
        to: process.env.FROM_EMAIL || "reports@compassbizsolutions.com",
        subject: "💰 New Snapshot purchase — " + customerEmail,
        html: "<p><b>New Snapshot purchase</b></p><p>Email: " + customerEmail + "</p><p>Name: " + (customerName || "not provided") + "</p><p>Stripe session: " + session.id + "</p>"
      }).catch(function() {});
    }

    // ── FIXKIT purchase (30day, bundle, 3160, 6190) ────────────────────
    else if (planType && planType !== "snapshot") {
      // Check if customer exists already
      const existing = await getFromKV("customer:" + eKey);
      // No auto-generated passwords — customers create their own via the portal

      // Determine what they now have access to
      let purchases = existing && existing.purchases ? existing.purchases : [];
      if (!purchases.includes(planType)) purchases.push(planType);

      // Store customer record — preserve existing intake/plan data for upgrades
      await saveToKV("customer:" + eKey, Object.assign({}, existing || {}, {
        email:      customerEmail,
        name:       customerName || (existing && existing.name) || "",
        biz:        bizName || (existing && existing.biz) || "",
        plan:       planType,
        plan_type:  planType,
        purchases:  purchases,
        phase_current: existing ? (existing.phase_current || 1) : 1,
        intake_complete: existing ? (existing.intake_complete || false) : false,
        snapshot_purchased: planType === "snapshot" || (existing && existing.snapshot_purchased),
        upgraded_from_snapshot: existing && existing.plan_type === "snapshot",
        purchased_at: new Date().toISOString(),
        stripe_session: session.id,
      }));

      // Trigger phase 2 or 3 generation for phase upgrades (fire and forget)
      if (planType === "3160" || planType === "6190") {
        const phaseNum = planType === "3160" ? 2 : 3;
        const FIXKIT_BASE = process.env.FIXKIT_URL || "https://fixkit.compassbizsolutions.com";
        fetch(FIXKIT_BASE + "/api/generate-phase", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-admin-token": process.env.JEN_PASSWORD || "compass2026",
          },
          body: JSON.stringify({ email: customerEmail, phase: phaseNum })
        }).then(function(r) {
          console.log("generate-phase " + phaseNum + " triggered, status:", r.status);
        }).catch(function(e) {
          console.error("generate-phase trigger failed:", e.message);
        });
      }
      const portalUrl = FIXKIT_URL;

      // Upgrade links for this plan
      const upgrades = UPGRADE_LINKS[planType] || {};

      let upgradeHtml = "";
      if (planType === "30day") {
        upgradeHtml = `<div style="background:#1B2E4B;border-radius:8px;padding:20px;margin:20px 0">
          <p style="color:rgba(255,255,255,0.7);font-size:13px;margin:0 0 12px">Keep going? Add Phase 2 when you're ready.</p>
          <a href="${upgrades.url3160}" style="display:inline-block;background:#C8701A;color:#fff;padding:10px 20px;border-radius:7px;text-decoration:none;font-weight:700;font-size:13px">Add Days 31-60 — $299 →</a>
        </div>`;
      } else if (planType === "3160") {
        upgradeHtml = `<div style="background:#1B2E4B;border-radius:8px;padding:20px;margin:20px 0">
          <p style="color:rgba(255,255,255,0.7);font-size:13px;margin:0 0 12px">One more phase to go.</p>
          <a href="${upgrades.url6190}" style="display:inline-block;background:#C8701A;color:#fff;padding:10px 20px;border-radius:7px;text-decoration:none;font-weight:700;font-size:13px">Add Days 61-90 — $299 →</a>
        </div>`;
      }

      await resend.emails.send({
        from: "Compass Business Solutions <" + (process.env.FROM_EMAIL || "reports@compassbizsolutions.com") + ">",
        to: customerEmail,
        subject: "Your FixKit is ready — " + planLabel,
        html: `<div style="font-family:sans-serif;max-width:580px;margin:0 auto;color:#1B2E4B">
          <div style="background:#1B2E4B;padding:24px;border-radius:8px 8px 0 0">
            <div style="color:#C8701A;font-size:11px;letter-spacing:3px;font-weight:700">COMPASS BUSINESS SOLUTIONS</div>
          </div>
          <div style="background:#F4F7FC;padding:28px;border-radius:0 0 8px 8px;border:1px solid #C8D6E8">
            <p style="font-size:15px">Hey ${firstName},</p>
            <p style="font-size:15px;line-height:1.7">You're in. Your <strong>${planLabel}</strong> is ready.</p>
            <p style="font-size:15px;line-height:1.7">One thing before you start: don't try to knock it all out at once. One task a day, 15-20 minutes. The plan is built around your numbers so the first week is aimed right at your biggest leak.</p>
            <div style="text-align:center;margin:24px 0">
              <a href="${portalUrl}" style="display:inline-block;background:#C8701A;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px">Go to Your FixKit →</a>
            </div>
            <p style="font-size:13px;color:#5A7291">Use <strong>${customerEmail}</strong> when you sign in — that's the email tied to your purchase.</p>
            ${upgradeHtml}
            <p style="font-size:13px;color:#5A7291;margin-bottom:12px">FixKit includes a free 20-minute strategy call. Book yours here:</p>
            <a href="https://calendly.com/jvoiselle612-s9gb/free-scoping-call" style="display:inline-block;background:#1B2E4B;color:#fff;padding:8px 18px;border-radius:7px;text-decoration:none;font-weight:600;font-size:13px">Book Your Free 20-Min Call →</a>
            <p style="font-size:14px">— Jen<br>Compass Business Solutions</p>
          </div>
        </div>`
      });

      // Notify Jen of new purchase
      await resend.emails.send({
        from: "Compass Business Solutions <" + (process.env.FROM_EMAIL || "reports@compassbizsolutions.com") + ">",
        to: process.env.FROM_EMAIL || "reports@compassbizsolutions.com",
        subject: "🎉 New FixKit purchase — " + planLabel + " — " + customerEmail,
        html: "<p><b>New purchase:</b> " + planLabel + "</p>"
          + "<p>Email: " + customerEmail + "</p>"
          + "<p>Name: " + (customerName || "not provided") + "</p>"
          + "<p>Business: " + (bizName || "not provided") + "</p>"
          + "<p>Stripe session: " + session.id + "</p>"
      });
    }

    return res.status(200).json({ received: true });

  } catch(err) {
    console.error("stripe-webhook error:", err);
    return res.status(500).json({ error: "Webhook handler failed", detail: err.message });
  }
};

// Tell Vercel not to parse the body — required for Stripe signature verification
module.exports.config = { api: { bodyParser: false } };
