const { Resend } = require("resend");
const crypto = require("crypto");

const PRODUCT_MAP = {
  "pri_01km957nv9t0wgnb7rxrpzmrkv": "30day",
  "pri_01km95651yv87n7bkktk2fmzna": "bundle",
  "pri_01km95mpfwh9q8fq66wy2tjrgx": "60day",
  "pri_01km95s0pyqvwkq6x4jtdd0n02": "90day",
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
    console.log("Event type:", event && event.event_type);

    if (!event || event.event_type !== "transaction.completed") {
      return res.status(200).json({ received: true });
    }

    const data = event.data || {};
    const items = data.items || [];
    const priceId = items[0] && items[0].price && items[0].price.id || "";
    const planType = PRODUCT_MAP[priceId] || "";

    // Get email from payments array — cardholder details
    const payments = data.payments || [];
    const payment = payments[0] || {};
    const methodDetails = payment.method_details || {};

    // Try every possible location in the payload
    const customData = data.custom_data || {};
    let customerEmail = customData.email || customData.customer_email || "";
    let customerName = customData.name || customData.customer_name || "";

    // Try billing details
    if (!customerEmail && data.billing_details) {
      customerEmail = data.billing_details.email || "";
      customerName = data.billing_details.name || customerName;
    }

    // Try cardholder name from payment method as name fallback
    if (!customerName && methodDetails.card) {
      customerName = methodDetails.card.cardholder_name || "";
    }

    console.log("Price ID:", priceId, "Plan:", planType);
    console.log("Email found:", customerEmail || "NONE");
    console.log("Name found:", customerName || "NONE");
    console.log("Customer ID:", data.customer_id || "NONE");

    if (!planType) {
      console.error("Unknown price ID:", priceId);
      return res.status(200).json({ received: true });
    }

    const resend = new Resend(process.env.RESEND_API_KEY);
    const now = new Date().toISOString();

    // If we still have no email, send Jen a manual action alert
    if (!customerEmail) {
      console.error("No email found — sending manual alert to Jen");
      await resend.emails.send({
        from: process.env.FROM_EMAIL || "reports@compassbizsolutions.com",
        to: "jen@compassbizsolutions.com",
        subject: "ACTION NEEDED — Purchase with no email — " + planType,
        html: "<p><b>A customer purchased " + planType + " but we could not retrieve their email.</b></p>"
          + "<p>Customer ID: " + (data.customer_id || "unknown") + "</p>"
          + "<p>Transaction ID: " + (data.id || "unknown") + "</p>"
          + "<p>Cardholder: " + (customerName || "unknown") + "</p>"
          + "<p>Look up the customer in Paddle sandbox by their Customer ID and send them their intake link manually.</p>"
      });
      return res.status(200).json({ received: true });
    }

    const firstName = customerName.split(" ")[0] || "there";
    const intakeToken = crypto.randomBytes(32).toString("hex");
    const intakeUrl = "https://www.compassbizsolutions.com?page=intake&token=" + intakeToken;

    // Save to KV
    saveToKV("intake_token:" + intakeToken, {
      token: intakeToken, email: customerEmail, name: customerName,
      planType: planType, used: false, createdAt: now
    });
    saveToKV("customer:" + customerEmail.toLowerCase().replace(/[^a-z0-9@._-]/g, ""), {
      email: customerEmail, name: customerName, plan_type: planType,
      phase_current: 1, phase_1_date: now, updated: now
    });

    // Send intake link email
    console.log("Sending intake email to:", customerEmail);
    await resend.emails.send({
      from: process.env.FROM_EMAIL || "reports@compassbizsolutions.com",
      to: customerEmail,
      subject: "You're in — complete your intake to get your plan",
      html: "<div style='font-family:Arial,sans-serif;max-width:600px;margin:0 auto;'>"
        + "<div style='background:#1B2E4B;padding:28px 32px;border-radius:8px 8px 0 0;'>"
        + "<div style='font-size:20px;font-weight:bold;color:#C8701A;'>Payment confirmed. Let's build your plan.</div>"
        + "</div>"
        + "<div style='background:#F7F5F2;padding:28px 32px;border-radius:0 0 8px 8px;border:1px solid #D8D4CD;'>"
        + "<p style='font-size:14px;color:#1A2332;font-weight:600;'>Hi " + firstName + ",</p>"
        + "<p style='font-size:13px;color:#3E4E63;line-height:1.75;'>Your payment is confirmed. Click below to complete your intake — takes about 15 minutes. The more specific your answers, the more precise your plan.</p>"
        + "<div style='text-align:center;margin:28px 0;'>"
        + "<a href='" + intakeUrl + "' style='display:inline-block;background:#C8701A;color:white;font-weight:bold;font-size:16px;padding:18px 44px;border-radius:10px;text-decoration:none;'>Complete Your Intake &rarr;</a>"
        + "</div>"
        + "<p style='font-size:12px;color:#6B7A90;'>This link is unique to your account and expires in 7 days. Questions? Just reply to this email.</p>"
        + "<p style='margin:0;color:#3E4E63;font-size:13px;'>— Jen, Compass Business Solutions</p>"
        + "</div></div>"
    });
    console.log("Intake email sent successfully to:", customerEmail);

    // Copy to Jen
    resend.emails.send({
      from: process.env.FROM_EMAIL || "reports@compassbizsolutions.com",
      to: "jen@compassbizsolutions.com",
      subject: "New purchase — " + planType + " — " + customerEmail,
      html: "<p>New <b>" + planType + "</b> purchase from " + customerEmail + " (" + customerName + ")</p><p><a href='" + intakeUrl + "'>Intake URL</a></p>"
    }).catch(function(e) { console.error("Jen copy failed:", e.message); });

    return res.status(200).json({ received: true });

  } catch(err) {
    console.error("Webhook error:", err.message);
    return res.status(200).json({ received: true, error: err.message });
  }
};
