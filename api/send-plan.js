/**
 * /api/send-plan
 * Delivers the paid 30-day or 30/60/90 plan to the customer
 * Stores full intake answers in KV
 * Tags in Mailchimp for check-in sequence
 */
const { Resend } = require("resend");

async function storeInKV(email, data) {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) return;
  const key = "plan:" + email.toLowerCase().replace(/[^a-z0-9@._-]/g, "");
  await fetch(url + "/set/" + encodeURIComponent(key), {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify(data)
  }).catch(function() {});
}

async function tagMailchimp(email, planType) {
  const dc = process.env.MAILCHIMP_DC || "us3";
  const listId = process.env.MAILCHIMP_AUDIENCE_ID;
  const apiKey = process.env.MAILCHIMP_API_KEY;
  if (!apiKey || !listId) return;
  const tag = planType === "599" ? "purchased-bundle" : "purchased-30day";
  await fetch("https://" + dc + ".api.mailchimp.com/3.0/lists/" + listId + "/members", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Basic " + Buffer.from("anystring:" + apiKey).toString("base64")
    },
    body: JSON.stringify({
      email_address: email,
      status: "subscribed",
      tags: [tag, "plan-customer"]
    })
  }).catch(function() {});
}

function getTag(text, tag) {
  const m = text.match(new RegExp("\\[" + tag + "\\]([\\s\\S]*?)(?=\\[|$)"));
  return m ? m[1].trim() : "";
}

function dayBlock(content, color) {
  if (!content) return "";
  const lines = content.split("\n").filter(function(l) { return l.trim(); });
  return lines.map(function(line) {
    const isDayLine = line.match(/^Day \d+:/i);
    return isDayLine
      ? `<div style="display:flex;gap:10px;margin-bottom:8px;align-items:flex-start;">
          <div style="background:${color};color:white;font-size:9px;font-weight:bold;font-family:Arial,sans-serif;padding:3px 8px;border-radius:99px;flex-shrink:0;margin-top:2px;white-space:nowrap;">${line.match(/^Day \d+/i)[0].toUpperCase()}</div>
          <div style="font-size:12px;color:#3E4E63;line-height:1.6;font-family:Arial,sans-serif;">${line.replace(/^Day \d+:\s*/i, "")}</div>
        </div>`
      : `<div style="font-size:12px;color:#3E4E63;line-height:1.6;font-family:Arial,sans-serif;margin-bottom:6px;padding-left:4px;">${line}</div>`;
  }).join("");
}

function docList(content, color) {
  if (!content) return "";
  const lines = content.split("\n").filter(function(l) { return l.trim(); });
  return lines.map(function(line) {
    return `<div style="display:flex;gap:8px;margin-bottom:6px;align-items:flex-start;">
      <span style="color:${color};font-weight:bold;flex-shrink:0;">→</span>
      <span style="font-size:12px;color:#3E4E63;line-height:1.5;font-family:Arial,sans-serif;">${line.replace(/^[-•→]\s*/, "")}</span>
    </div>`;
  }).join("");
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { email, planType, answers, multiAnswers, report } = req.body;
    if (!email || !report) return res.status(400).json({ error: "Missing required fields" });

    const resend = new Resend(process.env.RESEND_API_KEY);
    const isBundle = planType === "599";

    const leakRanking  = getTag(report, "LEAK_RANKING");
    const leakTotal    = getTag(report, "LEAK_TOTAL");
    const p1Intro      = getTag(report, "PHASE_1_INTRO");
    const p1Plan       = getTag(report, "PHASE_1_PLAN");
    const p1Docs       = getTag(report, "PHASE_1_DOCS");
    const p2Intro      = isBundle ? getTag(report, "PHASE_2_INTRO") : "";
    const p2Plan       = isBundle ? getTag(report, "PHASE_2_PLAN") : "";
    const p2Docs       = isBundle ? getTag(report, "PHASE_2_DOCS") : "";
    const p3Intro      = isBundle ? getTag(report, "PHASE_3_INTRO") : "";
    const p3Plan       = isBundle ? getTag(report, "PHASE_3_PLAN") : "";
    const p3Docs       = isBundle ? getTag(report, "PHASE_3_DOCS") : "";
    const closing      = getTag(report, "CLOSING");

    const phaseSection = (number, label, days, color, intro, plan, docs) => !plan ? "" : `
      <div style="margin-bottom:32px;">
        <div style="background:${color};padding:14px 20px;border-radius:8px 8px 0 0;">
          <div style="font-size:10px;color:rgba(255,255,255,0.65);letter-spacing:2px;margin-bottom:4px;">PHASE ${number}</div>
          <div style="font-size:16px;font-weight:bold;color:white;font-family:Arial,sans-serif;">${label}</div>
        </div>
        <div style="background:white;border:1px solid #D8D4CD;border-top:none;border-radius:0 0 8px 8px;padding:20px;">
          ${intro ? `<p style="font-size:13px;color:#3E4E63;line-height:1.75;margin:0 0 16px;font-family:Arial,sans-serif;">${intro}</p>` : ""}
          <div style="font-size:10px;font-weight:bold;color:${color};letter-spacing:2px;margin-bottom:12px;">DAY-BY-DAY PLAN</div>
          ${dayBlock(plan, color)}
          ${docs ? `<div style="margin-top:16px;padding-top:16px;border-top:1px solid #D8D4CD;">
            <div style="font-size:10px;font-weight:bold;color:${color};letter-spacing:2px;margin-bottom:10px;">YOUR GUIDES AND DOCS FOR THIS PHASE</div>
            ${docList(docs, color)}
          </div>` : ""}
        </div>
      </div>`;

    const html = `
      <div style="font-family:Arial,sans-serif;max-width:680px;margin:0 auto;color:#3E4E63;">
        <!-- Header -->
        <div style="background:#1B2E4B;padding:32px 36px;border-radius:8px 8px 0 0;">
          <div style="font-size:10px;color:rgba(255,255,255,0.35);letter-spacing:3px;margin-bottom:8px;">COMPASS BUSINESS SOLUTIONS</div>
          <div style="font-size:22px;font-weight:bold;color:#C8701A;line-height:1.2;">${isBundle ? "YOUR COMPLETE 30/60/90-DAY PLAN" : "YOUR 30-DAY QUICK WIN PLAN"}</div>
          <div style="font-size:13px;color:rgba(255,255,255,0.4);margin-top:8px;">Customized for your business — based on your intake answers</div>
        </div>

        <div style="background:#F7F5F2;padding:28px 36px;border-radius:0 0 8px 8px;border:1px solid #D8D4CD;">

          <!-- Leak ranking -->
          ${leakRanking ? `
          <div style="background:white;border-radius:8px;padding:18px 20px;margin-bottom:20px;border:1px solid #D8D4CD;">
            <div style="font-size:10px;font-weight:bold;color:#3D6B9E;letter-spacing:2px;margin-bottom:12px;">YOUR LEAKS RANKED BY DOLLAR IMPACT</div>
            ${leakRanking.split("\n").filter(function(l) { return l.trim(); }).map(function(line) {
              return `<div style="display:flex;gap:10px;margin-bottom:7px;align-items:flex-start;font-size:12px;color:#3E4E63;line-height:1.5;">${line}</div>`;
            }).join("")}
            ${leakTotal ? `<div style="margin-top:12px;padding-top:12px;border-top:1px solid #D8D4CD;background:#B84C2E;border-radius:6px;padding:10px 14px;text-align:center;">
              <div style="font-size:10px;color:rgba(255,255,255,0.7);letter-spacing:2px;margin-bottom:2px;">ESTIMATED TOTAL ANNUAL LEAK</div>
              <div style="font-size:15px;font-weight:bold;color:white;">${leakTotal.replace("Estimated total annual profit leak: ","")}</div>
            </div>` : ""}
          </div>` : ""}

          <!-- Phase 1 -->
          ${phaseSection("1", "Days 1–30 — Quick Wins", "30 days", "#B84C2E", p1Intro, p1Plan, p1Docs)}

          <!-- Phase 2 (bundle only) -->
          ${isBundle ? phaseSection("2", "Days 31–60 — Build Systems", "30 days", "#C8701A", p2Intro, p2Plan, p2Docs) : ""}

          <!-- Phase 3 (bundle only) -->
          ${isBundle ? phaseSection("3", "Days 61–90 — Growth Moves", "30 days", "#3D6B9E", p3Intro, p3Plan, p3Docs) : ""}

          <!-- Closing -->
          ${closing ? `
          <div style="background:#1B2E4B;border-radius:8px;padding:18px 20px;margin-bottom:20px;">
            <p style="font-size:13px;color:rgba(255,255,255,0.65);line-height:1.8;margin:0;font-family:Arial,sans-serif;">${closing}</p>
          </div>` : ""}

          <!-- Check-in note -->
          <div style="background:white;border:1px solid #D8D4CD;border-radius:8px;padding:16px 20px;margin-bottom:20px;text-align:center;">
            <div style="font-size:11px;font-weight:bold;color:#1A2332;letter-spacing:1px;margin-bottom:6px;">WHAT HAPPENS NEXT</div>
            <p style="font-size:12px;color:#6B7A90;line-height:1.7;margin:0;font-family:Arial,sans-serif;">You will hear from us at day 7 and day 15 to see how things are going.${isBundle ? " And again at day 21 and 28." : ""} Reply to any of those emails any time — Jen reads every one.</p>
          </div>

          <p style="font-size:13px;color:#6B7A90;margin-bottom:4px;">Questions? Just reply to this email.</p>
          <p style="margin:0;color:#3E4E63;font-size:13px;">— Jen, Compass Business Solutions</p>
        </div>

        <div style="text-align:center;padding:16px;font-size:11px;color:#A0ABBE;">
          Compass Business Solutions &nbsp;·&nbsp; compassbizsolutions.com
        </div>
      </div>`;

    // Send to customer
    await resend.emails.send({
      from: process.env.FROM_EMAIL || "reports@compassbizsolutions.com",
      to: email,
      subject: isBundle ? "Your Complete 30/60/90-Day Plan — Compass Business Solutions" : "Your 30-Day Quick Win Plan — Compass Business Solutions",
      html
    });

    // Copy to Jen
    const allAnswers = Object.keys(answers).map(function(k) { return k + ": " + answers[k]; }).join("\n");
    const allMulti = Object.keys(multiAnswers).map(function(k) { return k + ": " + (multiAnswers[k]||[]).join(", "); }).join("\n");
    resend.emails.send({
      from: process.env.FROM_EMAIL || "reports@compassbizsolutions.com",
      to: "jen@compassbizsolutions.com",
      subject: "Plan Delivered — " + email + " — " + (isBundle ? "$599 Bundle" : "$249 30-Day"),
      html: "<pre style='font-family:monospace;font-size:12px;line-height:1.6;'>" + allAnswers + "\n\n" + allMulti + "\n\n--- PLAN ---\n" + report + "</pre>"
    }).catch(function() {});

    // Store in KV
    storeInKV(email, {
      email, planType,
      answers, multiAnswers,
      report,
      planDate: new Date().toISOString(),
      phase: 1
    }).catch(function() {});

    // Tag in Mailchimp for check-in automation
    tagMailchimp(email, planType).catch(function() {});

    return res.status(200).json({ success: true });

  } catch(err) {
    console.error("send-plan error:", err);
    return res.status(500).json({ error: "Failed", detail: err.message });
  }
};
