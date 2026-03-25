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
    if (!event || event.event_type !== "transaction.completed") {
      return res.status(200).json({ received: true });
    }

    const data = event.data || {};
    const items = data.items || [];
    const priceId = items[0] && items[0].price && items[0].price.id || "";
    const planType = PRODUCT_MAP[priceId] || "";
    const customerId = data.customer_id || "";
    const transactionId = data.id || "";
    const payments = data.payments || [];
    const cardholderName = payments[0] && payments[0].method_details && payments[0].method_details.card && payments[0].method_details.card.cardholder_name || "";
    const customData = data.custom_data || {};

    // Email comes through custom_data when passed via Paddle.Checkout.open customer param
    let customerEmail = customData.customer_email || customData.email || "";
    let customerName = cardholderName || customData.name || "";

    console.log("Plan:", planType, "Email:", customerEmail || "NONE", "Name:", customerName, "CustomData:", JSON.stringify(customData));

    // If still no email — send Jen a manual alert with all details
    if (!customerEmail) {
      await resend.emails.send({
        from: process.env.FROM_EMAIL || "reports@compassbizsolutions.com",
        to: "jen@compassbizsolutions.com",
        subject: "ACTION NEEDED — New " + planType + " purchase — no email retrieved",
        html: "<p><b>New " + planType + " purchase but could not retrieve customer email.</b></p>"
          + "<p>Customer ID: <b>" + customerId + "</b></p>"
          + "<p>Transaction ID: <b>" + transactionId + "</b></p>"
          + "<p>Cardholder name: <b>" + cardholderName + "</b></p>"
          + "<p>Look up customer in <a href='https://sandbox-vendors.paddle.com/customers'>Paddle sandbox customers</a> and send them their intake link manually.</p>"
          + "<p>To generate their intake link manually, go to:<br>https://www.compassbizsolutions.com?page=intake&token=MANUAL</p>"
      });
      return res.status(200).json({ received: true });
    }

    // We have the email — proceed
    const now = new Date().toISOString();
    const firstName = customerName.split(" ")[0] || "there";
    const intakeToken = crypto.randomBytes(32).toString("hex");
    const intakeUrl = "https://www.compassbizsolutions.com?page=intake&token=" + intakeToken;

    saveToKV("intake_token:" + intakeToken, {
      token: intakeToken, email: customerEmail, name: customerName,
      planType: planType, used: false, createdAt: now
    });
    saveToKV("customer:" + customerEmail.toLowerCase().replace(/[^a-z0-9@._-]/g, ""), {
      email: customerEmail, name: customerName, plan_type: planType,
      phase_current: 1, phase_1_date: now, updated: now
    });

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
        + "<p style='font-size:13px;color:#3E4E63;line-height:1.75;'>Your payment is confirmed. Click below to complete your intake — takes about 15 minutes.</p>"
        + "<div style='text-align:center;margin:28px 0;'>"
        + "<a href='" + intakeUrl + "' style='display:inline-block;background:#C8701A;color:white;font-weight:bold;font-size:16px;padding:18px 44px;border-radius:10px;text-decoration:none;'>Complete Your Intake &rarr;</a>"
        + "</div>"
        + "<p style='font-size:12px;color:#6B7A90;'>This link expires in 7 days. Questions? Just reply to this email.</p>"
        + "<p style='margin:0;color:#3E4E63;font-size:13px;'>— Jen, Compass Business Solutions</p>"
        + "</div></div>"
    });
    console.log("Intake email sent to:", customerEmail);

    resend.emails.send({
      from: process.env.FROM_EMAIL || "reports@compassbizsolutions.com",
      to: "jen@compassbizsolutions.com",
      subject: "New " + planType + " purchase — " + customerEmail,
      html: "<p>New <b>" + planType + "</b> from " + customerEmail + " (" + customerName + ")</p><p><a href='" + intakeUrl + "'>Intake link</a></p>"
    }).catch(function(e) { console.error("Jen copy:", e.message); });

    return res.status(200).json({ received: true });

  } catch(err) {
    console.error("Webhook error:", err.message);
    return res.status(200).json({ received: true, error: err.message });
  }
};
