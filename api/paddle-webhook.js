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
  if (!url || !token) { console.log("KV not configured"); return; }
  try {
    const r = await fetch(url + "/set/" + encodeURIComponent(key), {
      method: "POST",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify(value)
    });
    console.log("KV save status:", r.status);
  } catch(e) { console.error("KV error:", e.message); }
}

module.exports = async function handler(req, res) {
  console.log("Webhook hit — method:", req.method);

  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const event = req.body;
    console.log("Event type:", event && event.event_type);
    console.log("Full event:", JSON.stringify(event).substring(0, 500));

    if (!event || event.event_type !== "transaction.completed") {
      return res.status(200).json({ received: true });
    }

    const customerEmail = event.data && event.data.customer && event.data.customer.email;
    const customerName  = (event.data && event.data.customer && event.data.customer.name) || "";
    const priceId = event.data && event.data.items && event.data.items[0] && event.data.items[0].price && event.data.items[0].price.id || "";
    const planType = PRODUCT_MAP[priceId] || "";

    console.log("Customer:", customerEmail, "Price:", priceId, "Plan:", planType);

    if (!customerEmail) {
      console.error("No customer email found");
      return res.status(200).json({ received: true });
    }

    if (!planType) {
      console.error("Unknown price ID:", priceId);
      return res.status(200).json({ received: true });
    }

    const resend = new Resend(process.env.RESEND_API_KEY);
    const now = new Date().toISOString();
    const firstName = customerName.split(" ")[0] || "there";

    if (planType === "30day" || planType === "bundle") {
      const intakeToken = crypto.randomBytes(32).toString("hex");
      const intakeUrl = "https://www.compassbizsolutions.com?page=intake&token=" + intakeToken;

      // Save to KV — don't await, don't let it block email
      saveToKV("intake_token:" + intakeToken, {
        token: intakeToken, email: customerEmail, name: customerName,
        planType: planType, used: false, createdAt: now
      });
      saveToKV("customer:" + customerEmail.toLowerCase().replace(/[^a-z0-9@._-]/g, ""), {
        email: customerEmail, name: customerName, plan_type: planType,
        phase_current: 1, phase_1_date: now, updated: now
      });

      // Send email
      console.log("Sending intake email to:", customerEmail);
      const emailResult = await resend.emails.send({
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
      console.log("Email result:", JSON.stringify(emailResult));

      // Copy to Jen
      resend.emails.send({
        from: process.env.FROM_EMAIL || "reports@compassbizsolutions.com",
        to: "jen@compassbizsolutions.com",
        subject: "New purchase — " + planType + " — " + customerEmail,
        html: "<p>New <b>" + planType + "</b> purchase from " + customerEmail + " (" + customerName + ")</p><p>Token: " + intakeToken + "</p><p><a href='" + intakeUrl + "'>Intake URL</a></p>"
      }).catch(function(e) { console.error("Jen copy failed:", e.message); });

    } else if (planType === "60day" || planType === "90day") {
      resend.emails.send({
        from: process.env.FROM_EMAIL || "reports@compassbizsolutions.com",
        to: "jen@compassbizsolutions.com",
        subject: "Phase purchase — " + planType + " — " + customerEmail,
        html: "<p>" + customerEmail + " purchased " + planType + ". Manual plan generation needed until phase 2/3 is fully automated.</p>"
      }).catch(function(e) { console.error("Phase email failed:", e.message); });
    }

    return res.status(200).json({ received: true });

  } catch(err) {
    console.error("Webhook error:", err.message, err.stack);
    return res.status(200).json({ received: true, error: err.message });
  }
};
