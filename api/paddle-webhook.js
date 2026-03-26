/**
 * /api/paddle-webhook
 * Handles Paddle purchase events
 * On payment: creates customer record, sends FixKit welcome email
 * No more intake token or intake email — everything happens in FixKit
 */
const { Resend } = require("resend");
const crypto = require("crypto");

const FIXKIT_URL = process.env.FIXKIT_URL || "https://fixkit.compassbizsolutions.com";

const PRODUCT_MAP = {
  "pri_01km957nv9t0wgnb7rxrpzmrkv": "30day",
  "pri_01km95651yv87n7bkktk2fmzna": "bundle",
  "pri_01km95mpfwh9q8fq66wy2tjrgx": "60day",
  "pri_01km95s0pyqvwkq6x4jtdd0n02": "90day",
};

const PLAN_LABELS = {
  "30day":  "30-Day Quick Win Plan",
  "60day":  "60-Day Plan",
  "90day":  "90-Day Plan",
  "bundle": "Complete 30/60/90-Day Plan",
};

async function saveToKV(key, value) {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) return;
  try {
    await fetch(url + "/set/" + encodeURIComponent(key), {
      method: "POST",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify(value)
    });
  } catch(e) { console.error("KV error:", e.message); }
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const event = req.body;
    if (!event || event.event_type !== "transaction.completed") {
      return res.status(200).json({ received: true });
    }

    const resend = new Resend(process.env.RESEND_API_KEY);
    const data = event.data || {};
    const items = data.items || [];
    const priceId = items[0]?.price?.id || "";
    const planType = PRODUCT_MAP[priceId] || "";
    const planLabel = PLAN_LABELS[planType] || "Plan";
    const customerId = data.customer_id || "";
    const transactionId = data.id || "";
    const payments = data.payments || [];
    const cardholderName = payments[0]?.method_details?.card?.cardholder_name || "";
    const customData = data.custom_data || {};

    let customerEmail = customData.customer_email || customData.email || "";
    let customerName = cardholderName || customData.name || "";

    console.log("Plan:", planType, "Email:", customerEmail || "NONE", "Name:", customerName);

    // No email — alert Jen manually
    if (!customerEmail) {
      await resend.emails.send({
        from: process.env.FROM_EMAIL || "reports@compassbizsolutions.com",
        to: "jen@compassbizsolutions.com",
        subject: "ACTION NEEDED — New " + planType + " purchase — no email retrieved",
        html: "<p><b>New " + planType + " purchase but could not retrieve customer email.</b></p>"
          + "<p>Customer ID: <b>" + customerId + "</b></p>"
          + "<p>Transaction ID: <b>" + transactionId + "</b></p>"
          + "<p>Cardholder name: <b>" + cardholderName + "</b></p>"
          + "<p>Look up customer in <a href='https://sandbox-vendors.paddle.com/customers'>Paddle sandbox customers</a>.</p>"
          + "<p>Send them to: <a href='" + FIXKIT_URL + "'>" + FIXKIT_URL + "</a></p>"
      });
      return res.status(200).json({ received: true });
    }

    // Save customer record to KV
    const now = new Date().toISOString();
    const firstName = customerName.split(" ")[0] || "there";
    const emailKey = customerEmail.toLowerCase().replace(/[^a-z0-9@._-]/g, "");

    await saveToKV("customer:" + emailKey, {
      email: customerEmail,
      name: customerName,
      plan_type: planType,
      phase_current: 1,
      phase_1_date: now,
      intake_complete: false,
      updated: now,
    });

    // Send FixKit welcome email
    await resend.emails.send({
      from: process.env.FROM_EMAIL || "reports@compassbizsolutions.com",
      to: customerEmail,
      subject: "You're in — set up your FixKit account",
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
          <div style="background:#1B2E4B;padding:28px 32px;border-radius:8px 8px 0 0;">
            <div style="font-size:10px;color:rgba(255,255,255,0.35);letter-spacing:3px;margin-bottom:10px;">COMPASS BUSINESS SOLUTIONS</div>
            <div style="font-size:22px;font-weight:bold;color:#C8701A;">Payment confirmed. You're in.</div>
          </div>
          <div style="background:#F7F5F2;padding:28px 32px;border-radius:0 0 8px 8px;border:1px solid #D8D4CD;">
            <p style="font-size:14px;color:#1A2332;font-weight:600;margin-top:0;">Hi ${firstName},</p>
            <p style="font-size:13px;color:#3E4E63;line-height:1.75;">Your <strong>${planLabel}</strong> is confirmed. Everything — your personalized plan, your documents, your daily tasks, and your progress tracker — lives in one place:</p>

            <div style="background:#1B2E4B;border-radius:10px;padding:20px 24px;margin:24px 0;text-align:center;">
              <div style="font-size:11px;color:rgba(255,255,255,0.4);letter-spacing:3px;margin-bottom:8px;">YOUR PORTAL</div>
              <div style="font-size:20px;font-weight:bold;color:#C8701A;margin-bottom:16px;">fixkit.compassbizsolutions.com</div>
              <a href="${FIXKIT_URL}" style="display:inline-block;background:#C8701A;color:white;font-weight:bold;font-size:15px;padding:14px 36px;border-radius:10px;text-decoration:none;">Set Up My FixKit Account →</a>
            </div>

            <p style="font-size:13px;color:#3E4E63;line-height:1.75;"><strong>What happens next:</strong></p>
            <p style="font-size:13px;color:#3E4E63;line-height:1.75;margin-top:0;">
              1. Click the button above and create your password using this email address<br>
              2. Answer a few questions about your business (takes about 15 minutes)<br>
              3. We build your customized plan — you'll see it immediately
            </p>

            <p style="font-size:13px;color:#3E4E63;line-height:1.75;">Your plan, your documents, and your daily tasks are all waiting on the other side. Come back any time — everything saves automatically.</p>

            <div style="background:white;border:1px solid #D8D4CD;border-radius:8px;padding:14px 18px;margin-top:20px;">
              <p style="font-size:12px;color:#6B7A90;margin:0;line-height:1.7;">Questions? Hit reply — I read every one. Or use the Ask Jen button inside FixKit once you're set up.</p>
            </div>

            <p style="margin:20px 0 0;color:#3E4E63;font-size:13px;">— Jen, Compass Business Solutions</p>
          </div>
          <div style="text-align:center;padding:16px;font-size:11px;color:#A0ABBE;">
            Compass Business Solutions · compassbizsolutions.com
          </div>
        </div>`
    });

    console.log("FixKit welcome email sent to:", customerEmail);

    // Copy to Jen
    resend.emails.send({
      from: process.env.FROM_EMAIL || "reports@compassbizsolutions.com",
      to: "jen@compassbizsolutions.com",
      subject: "New " + planType + " purchase — " + customerEmail,
      html: "<p>New <b>" + planLabel + "</b> from <b>" + customerEmail + "</b> (" + customerName + ")</p>"
        + "<p>FixKit welcome email sent. They'll complete intake on first login.</p>"
        + "<p>Customer ID: " + customerId + "</p>"
    }).catch(e => console.error("Jen copy:", e.message));

    return res.status(200).json({ received: true });

  } catch(err) {
    console.error("Webhook error:", err.message);
    return res.status(200).json({ received: true, error: err.message });
  }
};
