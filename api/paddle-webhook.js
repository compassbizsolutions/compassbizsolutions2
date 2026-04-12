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
  // Snapshot price ID — add when created in Paddle
  "pri_01knjhs5ve0q3gxn8th0g3br9c": "snapshot",
  // Upgrade discounted price IDs
  "pri_01knjhxqg290q6q1h9m56j8tkc": "30day",
  "pri_01knjj1nr64jy967rgg4d8z49s": "bundle",
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
        from: "Compass Business Solutions <" + (process.env.FROM_EMAIL || "reports@compassbizsolutions.com") + ">",
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

    const now = new Date().toISOString();
    const firstName = customerName.split(" ")[0] || "there";
    const emailKey = customerEmail.toLowerCase().replace(/[^a-z0-9@._-]/g, "");

    // Handle Snapshot purchase — create FixKit customer with snapshot plan type
    if (planType === "snapshot") {
      await saveToKV("customer:" + emailKey, {
        email: customerEmail,
        name: customerName,
        plan_type: "snapshot",
        phase_current: 1,
        phase_1_date: now,
        intake_complete: false,
        snapshot_purchased: true,
        updated: now,
        utm_source: customData.utm_source || "",
        utm_campaign: customData.utm_campaign || "",
        utm_medium: customData.utm_medium || "",
        source: customData.utm_source || "direct",
      });

      await resend.emails.send({
        from: "Compass Business Solutions <" + (process.env.FROM_EMAIL || "reports@compassbizsolutions.com") + ">",
        to: customerEmail,
        subject: "Your Profit Leak Snapshot is ready to build",
        html: `
          <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
            <div style="background:#1B2E4B;padding:28px 32px;border-radius:8px 8px 0 0;">
              <div style="font-size:10px;color:rgba(255,255,255,0.35);letter-spacing:3px;margin-bottom:10px;">COMPASS BUSINESS SOLUTIONS</div>
              <div style="font-size:22px;font-weight:bold;color:#C8701A;">Payment confirmed. Let's find your leaks.</div>
            </div>
            <div style="background:#F7F5F2;padding:28px 32px;border-radius:0 0 8px 8px;border:1px solid #D8D4CD;">
              <p style="font-size:14px;color:#1A2332;font-weight:600;margin-top:0;">Hi ${firstName},</p>
              <p style="font-size:13px;color:#3E4E63;line-height:1.75;">Your <strong>Profit Leak Snapshot</strong> is ready to build. Answer a few questions about how your business runs — takes about 10 minutes. The more specific you are, the more accurate your numbers.</p>
              <div style="background:#1B2E4B;border-radius:10px;padding:20px 24px;margin:24px 0;text-align:center;">
                <div style="font-size:11px;color:rgba(255,255,255,0.4);letter-spacing:3px;margin-bottom:16px;">BUILD YOUR SNAPSHOT</div>
                <a href="${FIXKIT_URL}" style="display:inline-block;background:#C8701A;color:white;font-weight:bold;font-size:15px;padding:14px 36px;border-radius:10px;text-decoration:none;">Start My Snapshot →</a>
              </div>
              <p style="font-size:13px;color:#3E4E63;line-height:1.75;">You'll get your top 3 profit leaks with the specific dollar math, step-by-step fixes, and personalized templates for your trade — all in one printable report.</p>
              <div style="background:white;border:1px solid #D8D4CD;border-radius:8px;padding:18px 20px;margin-top:16px;">
                <div style="font-size:11px;font-weight:bold;color:#1A2332;letter-spacing:2px;margin-bottom:12px;">WANT THE FULL EXPERIENCE?</div>
                <p style="font-size:12px;color:#6B7A90;margin:0 0 14px;line-height:1.7;">Your Snapshot includes a <strong>$100 upgrade credit</strong> toward FixKit. Use code <strong>SNAPSHOT-UPGRADE</strong> at checkout.</p>
                <div style="display:flex;gap:10px;flex-wrap:wrap;">
                  <a href="https://www.compassbizsolutions.com/?buy=snapshot-upgrade" style="display:inline-block;background:#C8701A;color:white;font-weight:bold;font-size:12px;padding:9px 18px;border-radius:7px;text-decoration:none;">FixKit 30-Day — $199 →</a>
                  <a href="https://www.compassbizsolutions.com/?buy=snapshot-upgrade" style="display:inline-block;background:#1B2E4B;color:white;font-weight:bold;font-size:12px;padding:9px 18px;border-radius:7px;text-decoration:none;">Full Bundle — $499 →</a>
                </div>
              </div>
              <p style="margin:20px 0 0;color:#3E4E63;font-size:13px;">— Jen, Compass Business Solutions</p>
            </div>
            <div style="text-align:center;padding:16px;font-size:11px;color:#A0ABBE;">Compass Business Solutions · compassbizsolutions.com</div>
          </div>`
      });

      resend.emails.send({
        from: "Compass Business Solutions <" + (process.env.FROM_EMAIL || "reports@compassbizsolutions.com") + ">",
        to: "jen@compassbizsolutions.com",
        subject: "New Snapshot purchase — " + customerEmail,
        html: "<p>New <b>Profit Leak Snapshot ($99)</b> from <b>" + customerEmail + "</b> (" + customerName + ")</p>"
      }).catch(() => {});

      return res.status(200).json({ received: true });
    }

    // Handle FixKit purchases (30day, bundle, etc.)
    // Check if upgrading from snapshot — preserve intake and existing data
    const existingCustomer = await (async () => {
      try {
        const r = await fetch(process.env.KV_REST_API_URL + "/get/" + encodeURIComponent("customer:" + emailKey), {
          headers: { Authorization: "Bearer " + process.env.KV_REST_API_TOKEN }
        });
        const d = await r.json();
        return d.result ? JSON.parse(d.result) : null;
      } catch(e) { return null; }
    })();

    const isUpgrade = existingCustomer?.plan_type === "snapshot";

    await saveToKV("customer:" + emailKey, Object.assign({}, existingCustomer || {}, {
      email: customerEmail,
      name: customerName || existingCustomer?.name,
      plan_type: planType,
      phase_current: 1,
      phase_1_date: isUpgrade ? existingCustomer.phase_1_date : now,
      intake_complete: isUpgrade ? (existingCustomer.intake_complete || false) : false,
      phase_1_report: isUpgrade && existingCustomer.intake_complete ? null : existingCustomer?.phase_1_report,
      snapshot_purchased: true,
      upgraded_from_snapshot: isUpgrade,
      upgraded_at: isUpgrade ? now : undefined,
      updated: now,
      utm_source: customData.utm_source || existingCustomer?.utm_source || "",
      utm_campaign: customData.utm_campaign || existingCustomer?.utm_campaign || "",
      utm_medium: customData.utm_medium || existingCustomer?.utm_medium || "",
      source: customData.utm_source || existingCustomer?.source || "direct",
    }));

    // Send FixKit welcome email — different message for upgrades
    const upgradeIntro = isUpgrade
      ? `Your Snapshot has been upgraded to the <strong>${planLabel}</strong>. Log back into your FixKit account — your intake answers are already saved. We'll generate your full plan automatically when you log in.`
      : `Your <strong>${planLabel}</strong> is confirmed. Everything — your personalized plan, your documents, your daily tasks, and your progress tracker — lives in one place:`;

    const upgradeSteps = isUpgrade
      ? `Log back into your existing FixKit account using this email address. Your intake is already complete — your full plan will generate automatically.`
      : `1. Click the button above and create your password using this email address<br>2. Answer a few questions about your business (takes about 15 minutes)<br>3. We build your customized plan — you'll see it immediately`;

    await resend.emails.send({
      from: "Compass Business Solutions <" + (process.env.FROM_EMAIL || "reports@compassbizsolutions.com") + ">",
      to: customerEmail,
      subject: isUpgrade ? "You've upgraded — your FixKit plan is being built" : "You're in — set up your FixKit account",
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
          <div style="background:#1B2E4B;padding:28px 32px;border-radius:8px 8px 0 0;">
            <div style="font-size:10px;color:rgba(255,255,255,0.35);letter-spacing:3px;margin-bottom:10px;">COMPASS BUSINESS SOLUTIONS</div>
            <div style="font-size:22px;font-weight:bold;color:#C8701A;">${isUpgrade ? "Upgrade confirmed. Welcome to FixKit." : "Payment confirmed. You're in."}</div>
          </div>
          <div style="background:#F7F5F2;padding:28px 32px;border-radius:0 0 8px 8px;border:1px solid #D8D4CD;">
            <p style="font-size:14px;color:#1A2332;font-weight:600;margin-top:0;">Hi ${firstName},</p>
            <p style="font-size:13px;color:#3E4E63;line-height:1.75;">${upgradeIntro}</p>

            <div style="background:#1B2E4B;border-radius:10px;padding:20px 24px;margin:24px 0;text-align:center;">
              <div style="font-size:11px;color:rgba(255,255,255,0.4);letter-spacing:3px;margin-bottom:16px;">YOUR PORTAL</div>
              <a href="${FIXKIT_URL}" style="display:inline-block;background:#C8701A;color:white;font-weight:bold;font-size:15px;padding:14px 36px;border-radius:10px;text-decoration:none;">${isUpgrade ? "Go to My FixKit Portal →" : "Set Up My FixKit Account →"}</a>
            </div>

            <p style="font-size:13px;color:#3E4E63;line-height:1.75;margin-top:0;">${upgradeSteps}</p>

            <div style="background:white;border:1px solid #D8D4CD;border-radius:8px;padding:14px 18px;margin-top:20px;">
              <p style="font-size:12px;color:#6B7A90;margin:0;line-height:1.7;">Questions? Hit reply — I read every one.</p>
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
      from: "Compass Business Solutions <" + (process.env.FROM_EMAIL || "reports@compassbizsolutions.com") + ">",
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
