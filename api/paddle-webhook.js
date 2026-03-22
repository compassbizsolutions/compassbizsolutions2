/**
 * /api/paddle-webhook
 * Handles all Paddle purchase events
 */
const crypto = require("crypto");
const { Resend } = require("resend");

// Tell Vercel not to parse the body so we can verify the raw signature
module.exports.config = { api: { bodyParser: false } };

const PRODUCT_MAP = {
  "pri_01km957nv9t0wgnb7rxrpzmrkv": "30day",
  "pri_01km95651yv87n7bkktk2fmzna": "bundle",
  "pri_01km95mpfwh9q8fq66wy2tjrgx": "60day",
  "pri_01km95s0pyqvwkq6x4jtdd0n02": "90day",
};

function getRawBody(req) {
  return new Promise(function(resolve, reject) {
    var chunks = [];
    req.on("data", function(chunk) { chunks.push(chunk); });
    req.on("end", function() { resolve(Buffer.concat(chunks).toString("utf8")); });
    req.on("error", reject);
  });
}

async function saveToKV(key, data) {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) return;
  await fetch(url + "/set/" + encodeURIComponent(key), {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify(data)
  }).catch(function() {});
}

async function getFromKV(key) {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  try {
    const res = await fetch(url + "/get/" + encodeURIComponent(key), {
      headers: { Authorization: "Bearer " + token }
    });
    const data = await res.json();
    return data.result ? JSON.parse(data.result) : null;
  } catch(e) { return null; }
}

async function generatePhasePlan(record, phaseNumber) {
  const answers = record.intake_answers || {};
  const multiAnswers = record.intake_multi || {};
  const allAnswers = Object.keys(answers).map(function(k) { return k + ": " + answers[k]; }).join("\n")
    + "\n" + Object.keys(multiAnswers).map(function(k) { return k + ": " + (multiAnswers[k]||[]).join(", "); }).join("\n");
  const phaseLabel = phaseNumber === 2 ? "31-60" : "61-90";
  const phaseName  = phaseNumber === 2 ? "PHASE 2: BUILD SYSTEMS" : "PHASE 3: GROWTH MOVES";
  const system = "You are a business consultant specializing in blue-collar service businesses.\n\nBUSINESS: " + (record.biz||"") + "\n\nINTAKE ANSWERS:\n" + allAnswers + "\n\nGenerate " + phaseName + " covering days " + phaseLabel + ".\n\n[PHASE_" + phaseNumber + "_INTRO]\n2-3 sentences.\n\n[PHASE_" + phaseNumber + "_PLAN]\nAll days " + phaseLabel + ". Format: === SPRINT HEADER ===, Day N: task (15-20 min). No markdown.\n\n[PHASE_" + phaseNumber + "_DOCS]\nBullet list of guides and templates.\n\n[CLOSING]\n2-3 sentences.";
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 4000, system, messages: [{ role: "user", content: "Generate the plan now." }] })
  });
  const data = await response.json();
  return (data.content || []).map(function(b) { return b.text || ""; }).join("") || "";
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const rawBody = await getRawBody(req);
    const event = JSON.parse(rawBody);

    // Verify Paddle signature
    const secret = process.env.PADDLE_WEBHOOK_SECRET;
    if (secret) {
      const sigHeader = req.headers["paddle-signature"] || "";
      const parts = {};
      sigHeader.split(";").forEach(function(p) {
        const kv = p.split("=");
        if (kv.length >= 2) parts[kv[0].trim()] = kv.slice(1).join("=").trim();
      });
      if (parts.ts && parts.h1) {
        const expected = crypto.createHmac("sha256", secret).update(parts.ts + ":" + rawBody).digest("hex");
        try {
          if (!crypto.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(parts.h1, "hex"))) {
            console.error("Paddle signature mismatch");
            return res.status(401).json({ error: "Invalid signature" });
          }
        } catch(e) {
          console.error("Signature comparison error:", e.message);
          return res.status(401).json({ error: "Invalid signature" });
        }
      }
    }

    if (event.event_type !== "transaction.completed") {
      return res.status(200).json({ received: true });
    }

    const customerEmail = event.data && event.data.customer && event.data.customer.email;
    const customerName  = (event.data && event.data.customer && event.data.customer.name) || "";
    const priceId = event.data && event.data.items && event.data.items[0] && event.data.items[0].price && event.data.items[0].price.id || "";
    const planType = PRODUCT_MAP[priceId] || "";

    console.log("Webhook received — email:", customerEmail, "priceId:", priceId, "planType:", planType);

    if (!customerEmail || !planType) {
      console.log("Unknown product or no email — priceId:", priceId);
      return res.status(200).json({ received: true });
    }

    const resend = new Resend(process.env.RESEND_API_KEY);
    const now = new Date().toISOString();

    if (planType === "30day" || planType === "bundle") {
      // Generate secure intake token
      const intakeToken = crypto.randomBytes(32).toString("hex");
      const tokenKey = "intake_token:" + intakeToken;
      const customerKey = "customer:" + customerEmail.toLowerCase().replace(/[^a-z0-9@._-]/g, "");

      // Store token in KV
      await saveToKV(tokenKey, {
        token: intakeToken,
        email: customerEmail,
        name: customerName,
        planType: planType,
        used: false,
        createdAt: now
      });

      // Store customer record
      await saveToKV(customerKey, {
        email: customerEmail,
        name: customerName,
        plan_type: planType,
        phase_current: 1,
        phase_1_date: now,
        updated: now
      });

      const intakeUrl = "https://www.compassbizsolutions.com?page=intake&token=" + intakeToken;
      const firstName = customerName.split(" ")[0] || "there";

      // Send intake link to customer
      await resend.emails.send({
        from: process.env.FROM_EMAIL || "reports@compassbizsolutions.com",
        to: customerEmail,
        subject: "You\u2019re in \u2014 complete your intake to get your plan",
        html: '<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">'
          + '<div style="background:#1B2E4B;padding:28px 32px;border-radius:8px 8px 0 0;">'
          + '<div style="font-size:10px;color:rgba(255,255,255,0.35);letter-spacing:3px;margin-bottom:8px;">COMPASS BUSINESS SOLUTIONS</div>'
          + '<div style="font-size:20px;font-weight:bold;color:#C8701A;">Payment confirmed. Let\u2019s build your plan.</div>'
          + '</div>'
          + '<div style="background:#F7F5F2;padding:28px 32px;border-radius:0 0 8px 8px;border:1px solid #D8D4CD;">'
          + '<p style="font-size:14px;color:#1A2332;font-weight:600;margin-top:0;">Hi ' + firstName + ',</p>'
          + '<p style="font-size:13px;color:#3E4E63;line-height:1.75;margin-bottom:20px;">Your payment is confirmed. Click below to complete your intake \u2014 it takes about 15 minutes and is how we build your customized plan. The more specific your answers, the more precise your plan.</p>'
          + '<div style="text-align:center;margin:28px 0;">'
          + '<a href="' + intakeUrl + '" style="display:inline-block;background:#C8701A;color:white;font-weight:bold;font-size:16px;padding:18px 44px;border-radius:10px;text-decoration:none;letter-spacing:0.5px;">Complete Your Intake \u2192</a>'
          + '</div>'
          + '<p style="font-size:12px;color:#6B7A90;line-height:1.7;margin-bottom:16px;">This link is unique to your account. It expires in 7 days. Questions? Just reply to this email.</p>'
          + '<p style="margin:0;color:#3E4E63;font-size:13px;">\u2014 Jen, Compass Business Solutions</p>'
          + '</div>'
          + '<div style="text-align:center;padding:16px;font-size:11px;color:#A0ABBE;">compassbizsolutions.com</div>'
          + '</div>'
      });

      console.log("Intake email sent to:", customerEmail, "token:", intakeToken);

      // Notify Jen
      resend.emails.send({
        from: process.env.FROM_EMAIL || "reports@compassbizsolutions.com",
        to: "jen@compassbizsolutions.com",
        subject: "New purchase \u2014 " + planType + " \u2014 " + customerEmail,
        html: "<p>New <strong>" + planType + "</strong> purchase from " + customerEmail + " (" + customerName + ").</p><p>Intake link sent. Token: " + intakeToken + "</p><p>Intake URL: <a href='" + intakeUrl + "'>" + intakeUrl + "</a></p>"
      }).catch(function() {});

    } else if (planType === "60day" || planType === "90day") {
      const phaseNumber = planType === "60day" ? 2 : 3;
      const customerKey = "customer:" + customerEmail.toLowerCase().replace(/[^a-z0-9@._-]/g, "");
      const record = await getFromKV(customerKey);

      if (!record || !record.intake_answers) {
        resend.emails.send({
          from: process.env.FROM_EMAIL || "reports@compassbizsolutions.com",
          to: "jen@compassbizsolutions.com",
          subject: "Phase " + phaseNumber + " purchase \u2014 NO INTAKE RECORD \u2014 " + customerEmail,
          html: "<p>Customer " + customerEmail + " purchased phase " + phaseNumber + " but no intake record found. Manual follow-up needed.</p>"
        }).catch(function() {});
        return res.status(200).json({ received: true });
      }

      const report = await generatePhasePlan(record, phaseNumber);
      const update = { phase_current: phaseNumber, updated: now };
      update["phase_" + phaseNumber + "_date"] = now;
      update["phase_" + phaseNumber + "_report"] = report;
      await saveToKV(customerKey, Object.assign({}, record, update));

      resend.emails.send({
        from: process.env.FROM_EMAIL || "reports@compassbizsolutions.com",
        to: "jen@compassbizsolutions.com",
        subject: "Phase " + phaseNumber + " plan sent \u2014 " + (record.biz || customerEmail),
        html: "<p>Phase " + phaseNumber + " plan generated and sent to " + customerEmail + ".</p>"
      }).catch(function() {});
    }

    return res.status(200).json({ received: true });

  } catch(err) {
    console.error("paddle-webhook error:", err.message, err.stack);
    return res.status(200).json({ received: true, error: err.message });
  }
};
