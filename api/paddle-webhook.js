/**
 * /api/paddle-webhook
 * Handles all Paddle purchase events:
 *   - PADDLE_LINK_249_30DAY  → sends intake link email, awaits intake completion
 *   - PADDLE_LINK_599        → sends intake link email, awaits intake completion
 *   - PADDLE_LINK_249_60DAY  → pulls stored answers, generates phase 2 plan, sends email with docs
 *   - PADDLE_LINK_249_90DAY  → pulls stored answers, generates phase 3 plan, sends email with docs
 */
const crypto = require("crypto");
const { Resend } = require("resend");
const fs = require("fs");
const path = require("path");

// ─── PRODUCT ID → PLAN TYPE MAP ──────────────────────────────────────────────
// Fill these in once you create products in Paddle dashboard
const PRODUCT_MAP = {
  "pri_01km957nv9t0wgnb7rxrpzmrkv": "30day",   // 1-30 Quick Wins — $249
  "pri_01km95651yv87n7bkktk2fmzna": "bundle",  // 30/60/90 Bundle — $599
  "pri_01km95mpfwh9q8fq66wy2tjrgx": "60day",   // 31-60 Quick Wins — $249
  "pri_01km95s0pyqvwkq6x4jtdd0n02": "90day",   // 61-90 Quick Wins — $249
};

// ─── KV HELPERS ──────────────────────────────────────────────────────────────
function kvKey(email) {
  return "customer:" + email.toLowerCase().replace(/[^a-z0-9@._-]/g, "");
}

async function getFromKV(email) {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  try {
    const res = await fetch(url + "/get/" + encodeURIComponent(kvKey(email)), {
      headers: { Authorization: "Bearer " + token }
    });
    const data = await res.json();
    return data.result ? JSON.parse(data.result) : null;
  } catch(e) { return null; }
}

async function saveToKV(email, data) {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) return;
  await fetch(url + "/set/" + encodeURIComponent(kvKey(email)), {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify(data)
  }).catch(function() {});
}

// ─── DOC ATTACHMENT HELPERS ──────────────────────────────────────────────────
const DOC_MAP = {
  "pricing worksheet": "CBS_Pricing_Worksheet_Rate_Calculator.docx",
  "rate calculator": "CBS_Pricing_Worksheet_Rate_Calculator.docx",
  "pricing leak fix": "CBS_Guide_1_The_Pricing_Leak_Fix.docx",
  "guide #1": "CBS_Guide_1_The_Pricing_Leak_Fix.docx",
  "guide 1": "CBS_Guide_1_The_Pricing_Leak_Fix.docx",
  "scheduling black hole": "CBS_Guide_2_The_Scheduling_Black_Hole.docx",
  "guide #2": "CBS_Guide_2_The_Scheduling_Black_Hole.docx",
  "guide 2": "CBS_Guide_2_The_Scheduling_Black_Hole.docx",
  "appointment confirmation": "CBS_Appointment_Confirmation_Process.docx",
  "employee cost leak": "CBS_Guide_3_The_Employee_Cost_Leak.docx",
  "guide #3": "CBS_Guide_3_The_Employee_Cost_Leak.docx",
  "guide 3": "CBS_Guide_3_The_Employee_Cost_Leak.docx",
  "employee handbook": "CBS_Employee_Handbook.docx",
  "onboarding handbook": "CBS_Employee_Handbook.docx",
  "new hire training": "CBS_New_Hire_Training_Documentation.docx",
  "recurring revenue": "CBS_Guide_4_The_Recurring_Revenue_Gap.docx",
  "guide #4": "CBS_Guide_4_The_Recurring_Revenue_Gap.docx",
  "guide 4": "CBS_Guide_4_The_Recurring_Revenue_Gap.docx",
  "service agreement": "CBS_Service_Agreement_Maintenance_Contract.docx",
  "maintenance contract": "CBS_Service_Agreement_Maintenance_Contract.docx",
  "estimate-to-invoice": "CBS_Guide_5_The_Estimate_to_Invoice_Leak.docx",
  "estimate to invoice": "CBS_Guide_5_The_Estimate_to_Invoice_Leak.docx",
  "guide #5": "CBS_Guide_5_The_Estimate_to_Invoice_Leak.docx",
  "guide 5": "CBS_Guide_5_The_Estimate_to_Invoice_Leak.docx",
  "change order": "CBS_Change_Order_Template.docx",
  "job completion": "CBS_Job_Completion_Invoicing_Process.docx",
  "invoicing process": "CBS_Job_Completion_Invoicing_Process.docx",
  "cash flow": "CBS_Guide_6_The_Cash_Flow_Blind_Spot.docx",
  "guide #6": "CBS_Guide_6_The_Cash_Flow_Blind_Spot.docx",
  "guide 6": "CBS_Guide_6_The_Cash_Flow_Blind_Spot.docx",
  "customer churn": "CBS_Guide_7_The_Customer_Churn_Leak.docx",
  "guide #7": "CBS_Guide_7_The_Customer_Churn_Leak.docx",
  "guide 7": "CBS_Guide_7_The_Customer_Churn_Leak.docx",
  "customer follow-up": "CBS_Customer_Followup_Sequence.docx",
  "follow-up sequence": "CBS_Customer_Followup_Sequence.docx",
  "referral": "CBS_Referral_Review_Request_System.docx",
  "review request": "CBS_Referral_Review_Request_System.docx",
  "materials markup": "CBS_Guide_8_The_Materials_Markup_Fix.docx",
  "guide #8": "CBS_Guide_8_The_Materials_Markup_Fix.docx",
  "guide 8": "CBS_Guide_8_The_Materials_Markup_Fix.docx",
  "parts & supply": "CBS_Parts_Supply_Ordering_Process.docx",
  "parts and supply": "CBS_Parts_Supply_Ordering_Process.docx",
  "supply ordering": "CBS_Parts_Supply_Ordering_Process.docx",
  "truck restocking": "CBS_Truck_Restocking_Checklist.docx",
  "admin time": "CBS_Guide_9_The_Admin_Time_Drain.docx",
  "guide #9": "CBS_Guide_9_The_Admin_Time_Drain.docx",
  "guide 9": "CBS_Guide_9_The_Admin_Time_Drain.docx",
  "vehicles & parts": "CBS_Guide_10_The_Vehicles___Parts_Leak.docx",
  "vehicles and parts": "CBS_Guide_10_The_Vehicles___Parts_Leak.docx",
  "guide #10": "CBS_Guide_10_The_Vehicles___Parts_Leak.docx",
  "guide 10": "CBS_Guide_10_The_Vehicles___Parts_Leak.docx",
  "safety": "CBS_Safety_Job_Site_Procedures.docx",
  "job site procedures": "CBS_Safety_Job_Site_Procedures.docx",
};

function extractDocFiles(docsText) {
  if (!docsText) return [];
  const lower = docsText.toLowerCase();
  const found = new Set();
  Object.keys(DOC_MAP).forEach(function(k) { if (lower.includes(k)) found.add(DOC_MAP[k]); });
  return Array.from(found);
}

function buildAttachments(docFiles) {
  const docsDir = path.join(process.cwd(), "public", "downloads");
  return docFiles.map(function(filename) {
    try {
      const content = fs.readFileSync(path.join(docsDir, filename)).toString("base64");
      return { filename, content };
    } catch(e) { return null; }
  }).filter(Boolean);
}

// ─── GENERATE NEXT PHASE PLAN ────────────────────────────────────────────────
async function generatePhasePlan(record, phaseNumber) {
  const answers = record.intake_answers || {};
  const multiAnswers = record.intake_multi || {};
  const allAnswers = Object.keys(answers).map(function(k) { return k + ": " + answers[k]; }).join("\n")
    + "\n" + Object.keys(multiAnswers).map(function(k) { return k + ": " + (multiAnswers[k]||[]).join(", "); }).join("\n");

  const phaseLabel = phaseNumber === 2 ? "31-60" : "61-90";
  const phaseName  = phaseNumber === 2 ? "PHASE 2: BUILD SYSTEMS" : "PHASE 3: GROWTH MOVES";

  const system = "You are a business consultant specializing in blue-collar service businesses. You know all 10 profit leak categories.\n\nBUSINESS: " + (record.biz||"") + (record.address ? " — " + record.address : "") + "\n\nINTAKE ANSWERS:\n" + allAnswers + "\n\nPHASE 1 ADDRESSED: " + (record.phase_1_report ? "Yes — see below" : "Not available") + "\n\nNow generate " + phaseName + " covering days " + phaseLabel + ". Focus on the next tier of leaks not fully addressed in phase 1. Use the same format:\n\n[PHASE_" + phaseNumber + "_INTRO]\n2-3 sentences on what this phase addresses.\n\n[PHASE_" + phaseNumber + "_PLAN]\nDay-by-day plan days " + phaseLabel + ". Same format: === SPRINT HEADERS ===, Day N: task (15-20 min max, name specific Compass doc/worksheet by name). No markdown.\n\n[PHASE_" + phaseNumber + "_DOCS]\nBullet list of guides and templates for this phase only.\n\n[CLOSING]\n2-3 sentences specific to their situation.";

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 2000,
      system,
      messages: [{ role: "user", content: "Generate the phase " + phaseNumber + " plan now." }]
    })
  });
  const data = await response.json();
  return data.content?.map(function(b) { return b.text || ""; }).join("") || "";
}

// ─── SEND PHASE EMAIL ────────────────────────────────────────────────────────
async function sendPhaseEmail(resend, record, phaseNumber, report) {
  function getTag(text, tag) {
    const m = text.match(new RegExp("\\[" + tag + "\\]([\\s\\S]*?)(?=\\[|$)"));
    return m ? m[1].trim() : "";
  }
  function renderPlan(content, color) {
    if (!content) return "";
    const lines = content.replace(/\*\*/g,"").replace(/^---$/gm,"").split("\n").filter(function(l){return l.trim();});
    return lines.map(function(line){
      if(line.match(/^===.*===$/)) return '<div style="background:'+color+'18;border-left:3px solid '+color+';padding:8px 12px;margin:16px 0 10px;font-size:11px;font-weight:bold;color:'+color+';font-family:Arial;">'+line.replace(/===/g,"").trim()+'</div>';
      const d = line.match(/^(Day \d+):\s*(.+)$/i);
      if(d) return '<div style="display:flex;gap:10px;margin-bottom:10px;"><div style="background:'+color+';color:white;font-size:9px;font-weight:bold;padding:4px 8px;border-radius:99px;flex-shrink:0;margin-top:2px;">'+d[1].toUpperCase()+'</div><div style="font-size:13px;color:#3E4E63;line-height:1.65;">'+d[2]+'</div></div>';
      return '<div style="font-size:12px;color:#6B7A90;margin-bottom:5px;">'+line+'</div>';
    }).join("");
  }
  function renderBullets(content, color) {
    if (!content) return "";
    return content.replace(/\*\*/g,"").replace(/^---$/gm,"").split("\n").filter(function(l){return l.trim();}).map(function(line){
      return '<div style="display:flex;gap:10px;margin-bottom:8px;"><span style="color:'+color+';font-weight:bold;">→</span><span style="font-size:13px;color:#3E4E63;line-height:1.6;">'+line.replace(/^[-•→\d+\.]\s*/,"")+'</span></div>';
    }).join("");
  }

  const phaseTag = "PHASE_" + phaseNumber;
  const intro = getTag(report, phaseTag + "_INTRO");
  const plan  = getTag(report, phaseTag + "_PLAN");
  const docs  = getTag(report, phaseTag + "_DOCS");
  const closing = getTag(report, "CLOSING");
  const color = phaseNumber === 2 ? "#C8701A" : "#3D6B9E";
  const label = phaseNumber === 2 ? "Days 31\u201360 \u2014 Build Systems" : "Days 61\u201390 \u2014 Growth Moves";
  const firstName = (record.name||"").split(" ")[0] || "there";

  const docFiles = extractDocFiles(docs);
  const attachments = buildAttachments(docFiles);

  const html = '<div style="font-family:Arial,sans-serif;max-width:680px;margin:0 auto;">'
    +'<div style="background:#1B2E4B;padding:32px 36px;border-radius:8px 8px 0 0;">'
    +'<div style="font-size:10px;color:rgba(255,255,255,0.35);letter-spacing:3px;margin-bottom:8px;">COMPASS BUSINESS SOLUTIONS</div>'
    +'<div style="font-size:22px;font-weight:bold;color:#C8701A;">YOUR PHASE ' + phaseNumber + ' PLAN \u2014 ' + label.toUpperCase() + '</div>'
    +'<div style="font-size:13px;color:rgba(255,255,255,0.4);margin-top:6px;">' + (record.biz||"") + '</div>'
    +'</div>'
    +'<div style="background:#F7F5F2;padding:28px 36px;border-radius:0 0 8px 8px;border:1px solid #D8D4CD;">'
    +'<p style="font-size:15px;color:#1A2332;font-weight:600;margin-top:0;">Hi ' + firstName + ',</p>'
    +'<p style="font-size:13px;color:#3E4E63;line-height:1.7;">Your Phase ' + phaseNumber + ' plan is attached along with ' + attachments.length + ' document' + (attachments.length !== 1 ? 's' : '') + ' for this phase.</p>'
    +'<div style="background:' + color + ';padding:14px 20px;border-radius:8px 8px 0 0;margin-bottom:0;">'
    +'<div style="font-size:10px;color:rgba(255,255,255,0.65);letter-spacing:2px;margin-bottom:4px;">PHASE ' + phaseNumber + '</div>'
    +'<div style="font-size:16px;font-weight:bold;color:white;">' + label + '</div>'
    +'</div>'
    +'<div style="background:white;border:1px solid #D8D4CD;border-top:none;border-radius:0 0 8px 8px;padding:20px;margin-bottom:24px;">'
    + (intro ? '<p style="font-size:13px;color:#3E4E63;line-height:1.75;margin:0 0 16px;">' + intro + '</p>' : '')
    +'<div style="font-size:10px;font-weight:bold;color:' + color + ';letter-spacing:2px;margin-bottom:12px;">DAY-BY-DAY PLAN</div>'
    + renderPlan(plan, color)
    + (docs ? '<div style="margin-top:18px;padding-top:16px;border-top:1px solid #E8E4DC;"><div style="font-size:10px;font-weight:bold;color:' + color + ';letter-spacing:2px;margin-bottom:12px;">YOUR GUIDES AND DOCS FOR THIS PHASE (' + attachments.length + ' attached)</div>' + renderBullets(docs, color) + '</div>' : '')
    +'</div>'
    + (closing ? '<div style="background:#1B2E4B;border-radius:8px;padding:16px 20px;margin-bottom:20px;"><p style="font-size:13px;color:rgba(255,255,255,0.65);line-height:1.8;margin:0;">' + closing.replace(/\*\*/g,"") + '</p></div>' : '')
    +'<p style="font-size:13px;color:#6B7A90;margin-bottom:4px;">Questions? Just reply to this email.</p>'
    +'<p style="margin:0;color:#3E4E63;font-size:13px;">\u2014 Jen, Compass Business Solutions</p>'
    +'</div>'
    +'<div style="text-align:center;padding:16px;font-size:11px;color:#A0ABBE;">Compass Business Solutions \u00b7 compassbizsolutions.com</div>'
    +'</div>';

  await resend.emails.send({
    from: process.env.FROM_EMAIL || "reports@compassbizsolutions.com",
    to: record.email,
    subject: "Your Phase " + phaseNumber + " Plan \u2014 Days " + (phaseNumber === 2 ? "31-60" : "61-90") + " \u2014 " + (record.biz||"Your Business"),
    html,
    attachments: attachments.length > 0 ? attachments : undefined
  });
}

// ─── MAIN HANDLER ────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    // Verify Paddle signature
    const secret = process.env.PADDLE_WEBHOOK_SECRET;
    if (secret) {
      const sigHeader = req.headers["paddle-signature"] || "";
      const parts = Object.fromEntries(sigHeader.split(";").map(function(p) { return p.split("=").map(function(s) { return s.trim(); }); }));
      const expected = crypto.createHmac("sha256", secret).update(parts.ts + ":" + JSON.stringify(req.body)).digest("hex");
      if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(parts.h1 || ""))) {
        return res.status(401).json({ error: "Invalid signature" });
      }
    }

    const event = req.body;
    if (event.event_type !== "transaction.completed") return res.status(200).json({ received: true });

    const customerEmail = event.data?.customer?.email;
    const customerName  = event.data?.customer?.name || "";
    const priceId = event.data?.items?.[0]?.price?.id || "";
    const planType = PRODUCT_MAP[priceId] || "";

    if (!customerEmail || !planType) {
      console.log("Unknown product or no email:", priceId, customerEmail);
      return res.status(200).json({ received: true });
    }

    const resend = new Resend(process.env.RESEND_API_KEY);
    const now = new Date().toISOString();

    if (planType === "30day" || planType === "bundle") {
      // Generate secure intake token
      const intakeToken = crypto.randomBytes(32).toString("hex");
      const tokenKey = "intake_token:" + intakeToken;
      const now = new Date().toISOString();

      // Store token in KV with 7-day TTL
      const kvUrl = process.env.KV_REST_API_URL;
      const kvToken = process.env.KV_REST_API_TOKEN;
      if (kvUrl && kvToken) {
        await fetch(kvUrl + "/set/" + encodeURIComponent(tokenKey), {
          method: "POST",
          headers: { Authorization: "Bearer " + kvToken, "Content-Type": "application/json" },
          body: JSON.stringify({
            token: intakeToken,
            email: customerEmail,
            name: customerName,
            planType,
            used: false,
            createdAt: now
          })
        }).catch(function() {});
      }

      // Save partial customer record to KV
      const existing = {};
      const record = Object.assign({}, existing, {
        email: customerEmail,
        name: customerName || "",
        plan_type: planType,
        phase_current: 1,
        phase_1_date: now,
        updated: now
      });
      await saveToKV(customerEmail, record);

      // Send intake link email with token
      const intakeUrl = "https://www.compassbizsolutions.com?page=intake&token=" + intakeToken;
      await resend.emails.send({
        from: process.env.FROM_EMAIL || "reports@compassbizsolutions.com",
        to: customerEmail,
        subject: "You're in — complete your intake to get your plan",
        html: '<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">'
          +'<div style="background:#1B2E4B;padding:28px 32px;border-radius:8px 8px 0 0;">'
          +'<div style="font-size:10px;color:rgba(255,255,255,0.35);letter-spacing:3px;margin-bottom:8px;">COMPASS BUSINESS SOLUTIONS</div>'
          +'<div style="font-size:20px;font-weight:bold;color:#C8701A;">Payment confirmed. Let\u2019s build your plan.</div>'
          +'</div>'
          +'<div style="background:#F7F5F2;padding:28px 32px;border-radius:0 0 8px 8px;border:1px solid #D8D4CD;">'
          +'<p style="font-size:14px;color:#1A2332;font-weight:600;margin-top:0;">Hi ' + (customerName.split(" ")[0]||"there") + ',</p>'
          +'<p style="font-size:13px;color:#3E4E63;line-height:1.7;">Your payment is confirmed. Now we need about 15 minutes of your time to complete the intake — the more specific your answers, the more precise your plan and documents will be.</p>'
          +'<div style="text-align:center;margin:24px 0;">'
          +'<a href="' + intakeUrl + '" style="display:inline-block;background:#C8701A;color:white;font-weight:bold;font-size:15px;padding:16px 40px;border-radius:10px;text-decoration:none;">Complete Your Intake \u2192</a>'
          +'</div>'
          +'<p style="font-size:12px;color:#6B7A90;line-height:1.7;">This link is unique to your account. Complete it at your own pace \u2014 it saves as you go. Questions? Just reply to this email.</p>'
          +'<p style="margin:0;color:#3E4E63;font-size:13px;">\u2014 Jen, Compass Business Solutions</p>'
          +'</div></div>'
      });

      // Notify Jen
      resend.emails.send({
        from: process.env.FROM_EMAIL || "reports@compassbizsolutions.com",
        to: "jen@compassbizsolutions.com",
        subject: "New purchase \u2014 " + planType + " \u2014 " + customerEmail,
        html: "<p>New " + planType + " purchase from " + customerEmail + " (" + customerName + ").</p><p>Intake link sent. Waiting for them to complete it.</p>"
      }).catch(function(){});

    } else if (planType === "60day" || planType === "90day") {
      // Phase 2 or 3 purchase — pull stored answers, generate plan, send email
      const phaseNumber = planType === "60day" ? 2 : 3;
      const record = await getFromKV(customerEmail);

      if (!record || !record.intake_answers) {
        // No record found — alert Jen
        resend.emails.send({
          from: process.env.FROM_EMAIL || "reports@compassbizsolutions.com",
          to: "jen@compassbizsolutions.com",
          subject: "Phase " + phaseNumber + " purchase \u2014 NO INTAKE RECORD \u2014 " + customerEmail,
          html: "<p>Customer " + customerEmail + " purchased phase " + phaseNumber + " but no intake record was found in KV. Manual follow-up needed.</p>"
        }).catch(function(){});
        return res.status(200).json({ received: true });
      }

      // Generate the new phase plan
      const report = await generatePhasePlan(record, phaseNumber);

      // Send the phase email with docs
      await sendPhaseEmail(resend, record, phaseNumber, report);

      // Update KV record
      const phaseKey = "phase_" + phaseNumber;
      const update = {};
      update[phaseKey + "_date"] = now;
      update[phaseKey + "_report"] = report;
      update.phase_current = phaseNumber;
      update.updated = now;
      await saveToKV(customerEmail, Object.assign({}, record, update));

      // Tag Mailchimp
      const tag = phaseNumber === 2 ? "purchased-60day" : "purchased-90day";
      resend.emails.send({
        from: process.env.FROM_EMAIL || "reports@compassbizsolutions.com",
        to: "jen@compassbizsolutions.com",
        subject: "Phase " + phaseNumber + " plan sent \u2014 " + (record.biz||customerEmail),
        html: "<p>Phase " + phaseNumber + " plan generated and sent to " + customerEmail + " (" + (record.biz||"") + ").</p>"
      }).catch(function(){});
    }

    return res.status(200).json({ received: true });

  } catch(err) {
    console.error("paddle-webhook error:", err);
    return res.status(200).json({ received: true, error: err.message });
  }
};
