/**
 * /api/send-plan
 * Delivers the paid 30-day or 30/60/90 plan
 * Docs delivered as download links (more reliable than attachments in serverless)
 * Stores customer record in Vercel KV
 * Tags in Mailchimp
 */
const { Resend } = require("resend");

const SITE_URL = process.env.SITE_URL || "https://www.compassbizsolutions.com";

// ─── DOC FILENAME LOOKUP ─────────────────────────────────────────────────────
const DOC_MAP = {
  "pricing worksheet":            { file: "CBS_Pricing_Worksheet_Rate_Calculator.docx",     label: "Pricing Worksheet & Rate Calculator" },
  "rate calculator":              { file: "CBS_Pricing_Worksheet_Rate_Calculator.docx",     label: "Pricing Worksheet & Rate Calculator" },
  "pricing leak fix":             { file: "CBS_Guide_1_The_Pricing_Leak_Fix.docx",          label: "Guide #1: The Pricing Leak Fix" },
  "guide #1":                     { file: "CBS_Guide_1_The_Pricing_Leak_Fix.docx",          label: "Guide #1: The Pricing Leak Fix" },
  "guide 1":                      { file: "CBS_Guide_1_The_Pricing_Leak_Fix.docx",          label: "Guide #1: The Pricing Leak Fix" },
  "scheduling black hole":        { file: "CBS_Guide_2_The_Scheduling_Black_Hole.docx",     label: "Guide #2: The Scheduling Black Hole" },
  "guide #2":                     { file: "CBS_Guide_2_The_Scheduling_Black_Hole.docx",     label: "Guide #2: The Scheduling Black Hole" },
  "guide 2":                      { file: "CBS_Guide_2_The_Scheduling_Black_Hole.docx",     label: "Guide #2: The Scheduling Black Hole" },
  "appointment confirmation":     { file: "CBS_Appointment_Confirmation_Process.docx",      label: "Appointment Confirmation Process" },
  "employee cost leak":           { file: "CBS_Guide_3_The_Employee_Cost_Leak.docx",        label: "Guide #3: The Employee Cost Leak" },
  "guide #3":                     { file: "CBS_Guide_3_The_Employee_Cost_Leak.docx",        label: "Guide #3: The Employee Cost Leak" },
  "guide 3":                      { file: "CBS_Guide_3_The_Employee_Cost_Leak.docx",        label: "Guide #3: The Employee Cost Leak" },
  "employee handbook":            { file: "CBS_Employee_Handbook.docx",                     label: "Employee Onboarding Handbook" },
  "onboarding handbook":          { file: "CBS_Employee_Handbook.docx",                     label: "Employee Onboarding Handbook" },
  "new hire training":            { file: "CBS_New_Hire_Training_Documentation.docx",       label: "New Hire Training Documentation" },
  "recurring revenue":            { file: "CBS_Guide_4_The_Recurring_Revenue_Gap.docx",     label: "Guide #4: The Recurring Revenue Gap" },
  "guide #4":                     { file: "CBS_Guide_4_The_Recurring_Revenue_Gap.docx",     label: "Guide #4: The Recurring Revenue Gap" },
  "guide 4":                      { file: "CBS_Guide_4_The_Recurring_Revenue_Gap.docx",     label: "Guide #4: The Recurring Revenue Gap" },
  "service agreement":            { file: "CBS_Service_Agreement_Maintenance_Contract.docx",label: "Service Agreement & Maintenance Contract" },
  "maintenance contract":         { file: "CBS_Service_Agreement_Maintenance_Contract.docx",label: "Service Agreement & Maintenance Contract" },
  "estimate-to-invoice":          { file: "CBS_Guide_5_The_Estimate_to_Invoice_Leak.docx",  label: "Guide #5: The Estimate-to-Invoice Leak" },
  "estimate to invoice":          { file: "CBS_Guide_5_The_Estimate_to_Invoice_Leak.docx",  label: "Guide #5: The Estimate-to-Invoice Leak" },
  "guide #5":                     { file: "CBS_Guide_5_The_Estimate_to_Invoice_Leak.docx",  label: "Guide #5: The Estimate-to-Invoice Leak" },
  "guide 5":                      { file: "CBS_Guide_5_The_Estimate_to_Invoice_Leak.docx",  label: "Guide #5: The Estimate-to-Invoice Leak" },
  "change order":                 { file: "CBS_Change_Order_Template.docx",                 label: "Change Order Template" },
  "job completion":               { file: "CBS_Job_Completion_Invoicing_Process.docx",      label: "Job Completion & Invoicing Process" },
  "invoicing process":            { file: "CBS_Job_Completion_Invoicing_Process.docx",      label: "Job Completion & Invoicing Process" },
  "cash flow":                    { file: "CBS_Guide_6_The_Cash_Flow_Blind_Spot.docx",      label: "Guide #6: The Cash Flow Blind Spot" },
  "guide #6":                     { file: "CBS_Guide_6_The_Cash_Flow_Blind_Spot.docx",      label: "Guide #6: The Cash Flow Blind Spot" },
  "guide 6":                      { file: "CBS_Guide_6_The_Cash_Flow_Blind_Spot.docx",      label: "Guide #6: The Cash Flow Blind Spot" },
  "customer churn":               { file: "CBS_Guide_7_The_Customer_Churn_Leak.docx",       label: "Guide #7: The Customer Churn Leak" },
  "guide #7":                     { file: "CBS_Guide_7_The_Customer_Churn_Leak.docx",       label: "Guide #7: The Customer Churn Leak" },
  "guide 7":                      { file: "CBS_Guide_7_The_Customer_Churn_Leak.docx",       label: "Guide #7: The Customer Churn Leak" },
  "customer follow-up":           { file: "CBS_Customer_Followup_Sequence.docx",            label: "Customer Follow-Up Sequence" },
  "follow-up sequence":           { file: "CBS_Customer_Followup_Sequence.docx",            label: "Customer Follow-Up Sequence" },
  "referral":                     { file: "CBS_Referral_Review_Request_System.docx",        label: "Referral & Review Request System" },
  "review request":               { file: "CBS_Referral_Review_Request_System.docx",        label: "Referral & Review Request System" },
  "materials markup":             { file: "CBS_Guide_8_The_Materials_Markup_Fix.docx",      label: "Guide #8: The Materials Markup Fix" },
  "guide #8":                     { file: "CBS_Guide_8_The_Materials_Markup_Fix.docx",      label: "Guide #8: The Materials Markup Fix" },
  "guide 8":                      { file: "CBS_Guide_8_The_Materials_Markup_Fix.docx",      label: "Guide #8: The Materials Markup Fix" },
  "parts & supply":               { file: "CBS_Parts_Supply_Ordering_Process.docx",         label: "Parts & Supply Ordering Process" },
  "parts and supply":             { file: "CBS_Parts_Supply_Ordering_Process.docx",         label: "Parts & Supply Ordering Process" },
  "supply ordering":              { file: "CBS_Parts_Supply_Ordering_Process.docx",         label: "Parts & Supply Ordering Process" },
  "truck restocking":             { file: "CBS_Truck_Restocking_Checklist.docx",            label: "Truck Restocking Checklist" },
  "admin time":                   { file: "CBS_Guide_9_The_Admin_Time_Drain.docx",          label: "Guide #9: The Admin Time Drain" },
  "guide #9":                     { file: "CBS_Guide_9_The_Admin_Time_Drain.docx",          label: "Guide #9: The Admin Time Drain" },
  "guide 9":                      { file: "CBS_Guide_9_The_Admin_Time_Drain.docx",          label: "Guide #9: The Admin Time Drain" },
  "vehicles & parts":             { file: "CBS_Guide_10_The_Vehicles___Parts_Leak.docx",    label: "Guide #10: Vehicles & Parts Leak" },
  "vehicles and parts":           { file: "CBS_Guide_10_The_Vehicles___Parts_Leak.docx",    label: "Guide #10: Vehicles & Parts Leak" },
  "guide #10":                    { file: "CBS_Guide_10_The_Vehicles___Parts_Leak.docx",    label: "Guide #10: Vehicles & Parts Leak" },
  "guide 10":                     { file: "CBS_Guide_10_The_Vehicles___Parts_Leak.docx",    label: "Guide #10: Vehicles & Parts Leak" },
  "safety":                       { file: "CBS_Safety_Job_Site_Procedures.docx",            label: "Safety & Job Site Procedures" },
  "job site procedures":          { file: "CBS_Safety_Job_Site_Procedures.docx",            label: "Safety & Job Site Procedures" },
};

function extractDocs(docsText) {
  if (!docsText) return [];
  const lower = docsText.toLowerCase();
  const found = new Map();
  Object.keys(DOC_MAP).forEach(function(keyword) {
    if (lower.includes(keyword)) {
      const doc = DOC_MAP[keyword];
      found.set(doc.file, doc);
    }
  });
  return Array.from(found.values());
}

function docLinksHtml(docs, color) {
  if (!docs || !docs.length) return "";
  return docs.map(function(doc) {
    const url = SITE_URL + "/public/downloads/" + encodeURIComponent(doc.file);
    return '<div style="display:flex;gap:10px;margin-bottom:8px;align-items:center;">'
      + '<span style="color:' + color + ';font-weight:bold;flex-shrink:0;">→</span>'
      + '<a href="' + url + '" style="font-size:13px;color:' + color + ';font-family:Arial,sans-serif;font-weight:600;text-decoration:none;">' + doc.label + ' ↓</a>'
      + '</div>';
  }).join("");
}

// ─── KV HELPERS ──────────────────────────────────────────────────────────────
async function saveToKV(email, data) {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) return;
  const key = "customer:" + email.toLowerCase().replace(/[^a-z0-9@._-]/g, "");
  await fetch(url + "/set/" + encodeURIComponent(key), {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify(data)
  }).catch(function() {});
}

async function getFromKV(email) {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  const key = "customer:" + email.toLowerCase().replace(/[^a-z0-9@._-]/g, "");
  try {
    const res = await fetch(url + "/get/" + encodeURIComponent(key), {
      headers: { Authorization: "Bearer " + token }
    });
    const data = await res.json();
    return data.result ? JSON.parse(data.result) : null;
  } catch(e) { return null; }
}

async function tagMailchimp(email, name, tag) {
  const dc = process.env.MAILCHIMP_DC || "us3";
  const listId = process.env.MAILCHIMP_AUDIENCE_ID;
  const apiKey = process.env.MAILCHIMP_API_KEY;
  if (!apiKey || !listId) return;
  await fetch("https://" + dc + ".api.mailchimp.com/3.0/lists/" + listId + "/members", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Basic " + Buffer.from("anystring:" + apiKey).toString("base64") },
    body: JSON.stringify({ email_address: email, status: "subscribed", merge_fields: { FNAME: name || "" }, tags: [tag, "plan-customer"] })
  }).catch(function() {});
}

// ─── EMAIL RENDERING ─────────────────────────────────────────────────────────
function getTag(text, tag) {
  const m = text.match(new RegExp("\\[" + tag + "\\]([\\s\\S]*?)(?=\\[|$)"));
  return m ? m[1].trim() : "";
}

function renderPlan(content, color) {
  if (!content) return "";
  const lines = content.replace(/\*\*/g, "").replace(/^---$/gm, "").split("\n").filter(function(l) { return l.trim(); });
  return lines.map(function(line) {
    if (line.match(/^===.*===$/)) {
      const label = line.replace(/===/g, "").trim();
      return '<div style="background:' + color + '18;border-left:3px solid ' + color + ';border-radius:0 6px 6px 0;padding:8px 12px;margin:16px 0 10px;font-size:11px;font-weight:bold;color:' + color + ';letter-spacing:1.5px;font-family:Arial,sans-serif;">' + label + '</div>';
    }
    const dayMatch = line.match(/^(Day \d+):\s*(.+)$/i);
    if (dayMatch) {
      return '<div style="display:flex;gap:10px;margin-bottom:10px;align-items:flex-start;"><div style="background:' + color + ';color:white;font-size:9px;font-weight:bold;font-family:Arial,sans-serif;padding:4px 8px;border-radius:99px;flex-shrink:0;margin-top:2px;white-space:nowrap;">' + dayMatch[1].toUpperCase() + '</div><div style="font-size:13px;color:#3E4E63;line-height:1.65;font-family:Arial,sans-serif;">' + dayMatch[2] + '</div></div>';
    }
    return '<div style="font-size:12px;color:#6B7A90;line-height:1.6;font-family:Arial,sans-serif;margin-bottom:5px;">' + line + '</div>';
  }).join("");
}

function renderLeakRanking(content) {
  if (!content) return "";
  const lines = content.replace(/\*\*/g, "").replace(/^---$/gm, "").split("\n").filter(function(l) { return l.trim(); });
  return lines.map(function(line) {
    const match = line.match(/^(\d+)\.\s+([^—–]+)[—–]\s*(\$[\d,]+[^|]+?)(?:\|\s*(.+))?$/);
    if (match) {
      return '<div style="display:flex;gap:10px;margin-bottom:10px;align-items:flex-start;padding:10px 12px;background:white;border-radius:6px;border:1px solid #D8D4CD;">'
        + '<div style="width:24px;height:24px;border-radius:50%;background:#1B2E4B;color:white;font-size:11px;font-weight:bold;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-family:Arial,sans-serif;">' + match[1] + '</div>'
        + '<div><div style="font-size:12px;font-weight:bold;color:#1A2332;font-family:Arial,sans-serif;">' + match[2].trim() + ' <span style="color:#B84C2E;">' + match[3].trim() + '</span></div>'
        + (match[4] ? '<div style="font-size:11px;color:#6B7A90;line-height:1.5;font-family:Arial,sans-serif;margin-top:2px;">' + match[4].trim() + '</div>' : '')
        + '</div></div>';
    }
    return '<div style="font-size:12px;color:#3E4E63;line-height:1.6;font-family:Arial,sans-serif;margin-bottom:6px;">' + line.replace(/^[-•\d+\.]\s*/, "") + '</div>';
  }).join("");
}

function phaseSection(number, label, color, intro, plan, docsText) {
  if (!plan && !intro) return "";
  const docs = extractDocs(docsText);
  return '<div style="margin-bottom:32px;">'
    + '<div style="background:' + color + ';padding:14px 20px;border-radius:8px 8px 0 0;">'
    + '<div style="font-size:10px;color:rgba(255,255,255,0.65);letter-spacing:2px;margin-bottom:4px;font-family:Arial,sans-serif;">PHASE ' + number + '</div>'
    + '<div style="font-size:16px;font-weight:bold;color:white;font-family:Arial,sans-serif;">' + label + '</div>'
    + '</div>'
    + '<div style="background:white;border:1px solid #D8D4CD;border-top:none;border-radius:0 0 8px 8px;padding:20px;">'
    + (intro ? '<p style="font-size:13px;color:#3E4E63;line-height:1.75;margin:0 0 16px;font-family:Arial,sans-serif;">' + intro + '</p>' : '')
    + '<div style="font-size:10px;font-weight:bold;color:' + color + ';letter-spacing:2px;margin-bottom:12px;font-family:Arial,sans-serif;">DAY-BY-DAY PLAN</div>'
    + (plan ? renderPlan(plan, color) : '<p style="font-size:12px;color:#6B7A90;font-family:Arial,sans-serif;">Plan generation in progress — check your inbox for an update.</p>')
    + (docs.length ? '<div style="margin-top:18px;padding-top:16px;border-top:1px solid #E8E4DC;">'
      + '<div style="font-size:10px;font-weight:bold;color:' + color + ';letter-spacing:2px;margin-bottom:12px;font-family:Arial,sans-serif;">YOUR DOCUMENTS FOR THIS PHASE — CLICK TO DOWNLOAD</div>'
      + docLinksHtml(docs, color)
      + '</div>' : '')
    + '</div></div>';
}

// ─── MAIN HANDLER ────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { email, name, biz, phone, address, planType, answers, multiAnswers, report } = req.body;
    if (!email || !report) return res.status(400).json({ error: "Missing required fields" });

    const resend = new Resend(process.env.RESEND_API_KEY);
    const isBundle = planType === "599" || planType === "bundle";
    const firstName = (name || "").split(" ")[0] || "there";

    const leakRanking = getTag(report, "LEAK_RANKING");
    const leakTotal   = getTag(report, "LEAK_TOTAL");
    const p1Intro     = getTag(report, "PHASE_1_INTRO");
    const p1Plan      = getTag(report, "PHASE_1_PLAN");
    const p1Docs      = getTag(report, "PHASE_1_DOCS");
    const p2Intro     = isBundle ? getTag(report, "PHASE_2_INTRO") : "";
    const p2Plan      = isBundle ? getTag(report, "PHASE_2_PLAN") : "";
    const p2Docs      = isBundle ? getTag(report, "PHASE_2_DOCS") : "";
    const p3Intro     = isBundle ? getTag(report, "PHASE_3_INTRO") : "";
    const p3Plan      = isBundle ? getTag(report, "PHASE_3_PLAN") : "";
    const p3Docs      = isBundle ? getTag(report, "PHASE_3_DOCS") : "";
    const closing     = getTag(report, "CLOSING");
    const totalClean  = leakTotal.replace(/Estimated total annual profit leak:\s*/i, "").trim();

    // Count all docs across phases
    const allDocs = extractDocs(p1Docs + " " + p2Docs + " " + p3Docs);

    const html = '<div style="font-family:Arial,sans-serif;max-width:680px;margin:0 auto;color:#3E4E63;">'
      + '<div style="background:#1B2E4B;padding:32px 36px;border-radius:8px 8px 0 0;">'
      + '<div style="font-size:10px;color:rgba(255,255,255,0.35);letter-spacing:3px;margin-bottom:8px;">COMPASS BUSINESS SOLUTIONS</div>'
      + '<div style="font-size:22px;font-weight:bold;color:#C8701A;line-height:1.2;">' + (isBundle ? "YOUR COMPLETE 30/60/90-DAY PLAN" : "YOUR 30-DAY QUICK WIN PLAN") + '</div>'
      + '<div style="font-size:13px;color:rgba(255,255,255,0.4);margin-top:6px;">' + (biz || "") + (address ? " \u2014 " + address : "") + '</div>'
      + '</div>'
      + '<div style="background:#F7F5F2;padding:28px 36px;border-radius:0 0 8px 8px;border:1px solid #D8D4CD;">'
      + '<p style="font-size:15px;color:#1A2332;font-weight:600;margin-top:0;">Hi ' + firstName + ',</p>'
      + '<p style="font-size:13px;color:#3E4E63;line-height:1.7;margin-top:0;">Your customized plan is below. Your ' + allDocs.length + ' document' + (allDocs.length !== 1 ? "s" : "") + ' are linked at the bottom of each phase — click any link to download directly.</p>'

      + (totalClean ? '<div style="background:#B84C2E;border-radius:10px;padding:18px 24px;margin-bottom:24px;text-align:center;">'
        + '<div style="font-size:10px;color:rgba(255,255,255,0.65);letter-spacing:3px;margin-bottom:6px;">ESTIMATED ANNUAL PROFIT LEAK \u2014 ' + (biz || "YOUR BUSINESS").toUpperCase() + '</div>'
        + '<div style="font-size:36px;font-weight:bold;color:white;line-height:1;">' + totalClean + '</div>'
        + '<div style="font-size:10px;color:rgba(255,255,255,0.45);margin-top:6px;">Approximate amount not currently being captured. Consistent process improvements will positively impact profitability \u2014 results vary by business.</div>'
        + '</div>' : "")

      + (leakRanking ? '<div style="background:white;border-radius:8px;padding:18px 20px;margin-bottom:24px;border:1px solid #D8D4CD;">'
        + '<div style="font-size:10px;font-weight:bold;color:#3D6B9E;letter-spacing:2px;margin-bottom:14px;">YOUR LEAKS RANKED BY DOLLAR IMPACT</div>'
        + renderLeakRanking(leakRanking)
        + '</div>' : "")

      + phaseSection("1", "Days 1\u201330 \u2014 Quick Wins", "#B84C2E", p1Intro, p1Plan, p1Docs)
      + (isBundle ? phaseSection("2", "Days 31\u201360 \u2014 Build Systems", "#C8701A", p2Intro, p2Plan, p2Docs) : "")
      + (isBundle ? phaseSection("3", "Days 61\u201390 \u2014 Growth Moves", "#3D6B9E", p3Intro, p3Plan, p3Docs) : "")

      + (closing ? '<div style="background:#1B2E4B;border-radius:8px;padding:16px 20px;margin-bottom:20px;">'
        + '<p style="font-size:13px;color:rgba(255,255,255,0.65);line-height:1.8;margin:0;">' + closing.replace(/\*\*/g, "") + '</p>'
        + '</div>' : "")

      + '<div style="background:white;border:1px solid #D8D4CD;border-radius:8px;padding:16px 20px;margin-bottom:20px;text-align:center;">'
      + '<div style="font-size:11px;font-weight:bold;color:#1A2332;letter-spacing:1px;margin-bottom:6px;">WHAT HAPPENS NEXT</div>'
      + '<p style="font-size:12px;color:#6B7A90;line-height:1.7;margin:0;">You will hear from us at day 7 and day 15.' + (isBundle ? " And at day 21 and 28." : "") + ' Reply any time \u2014 Jen reads every one.</p>'
      + '</div>'

      + '<p style="font-size:13px;color:#6B7A90;margin-bottom:4px;">Questions? Just reply to this email.</p>'
      + '<p style="margin:0;color:#3E4E63;font-size:13px;">\u2014 Jen, Compass Business Solutions</p>'
      + '</div>'
      + '<div style="text-align:center;padding:16px;font-size:11px;color:#A0ABBE;">Compass Business Solutions \u00b7 compassbizsolutions.com</div>'
      + '</div>';

    // Generate the checklist .docx
    let checklistAttachment = null;
    try {
      const checklistRes = await fetch((process.env.SITE_URL || "https://www.compassbizsolutions.com") + "/api/generate-checklist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ biz, name, planType, report })
      });
      const checklistData = await checklistRes.json();
      if (checklistData.base64) {
        checklistAttachment = { filename: checklistData.filename, content: checklistData.base64 };
      }
    } catch(e) {
      console.warn("Checklist generation failed, sending without attachment:", e.message);
    }

    await resend.emails.send({
      from: process.env.FROM_EMAIL || "reports@compassbizsolutions.com",
      to: email,
      subject: isBundle ? "Your Complete 30/60/90-Day Plan \u2014 " + (biz || "Your Business") : "Your 30-Day Quick Win Plan \u2014 " + (biz || "Your Business"),
      html,
      attachments: checklistAttachment ? [checklistAttachment] : undefined
    });

    // Copy to Jen
    const allAnswers = Object.keys(answers || {}).map(function(k) { return k + ": " + answers[k]; }).join("\n");
    const allMulti = Object.keys(multiAnswers || {}).map(function(k) { return k + ": " + (multiAnswers[k] || []).join(", "); }).join("\n");
    const docNames = allDocs.map(function(d) { return d.label; }).join(", ");
    resend.emails.send({
      from: process.env.FROM_EMAIL || "reports@compassbizsolutions.com",
      to: "jen@compassbizsolutions.com",
      subject: (isBundle ? "$599 Bundle" : "$249 30-Day") + " \u2014 " + (biz || email) + " \u2014 " + (phone || "") + " \u2014 Docs: " + docNames,
      html: "<pre style='font-family:monospace;font-size:12px;line-height:1.6;white-space:pre-wrap;'>Name: " + name + "\nEmail: " + email + "\nPhone: " + phone + "\nBusiness: " + biz + "\nAddress: " + address + "\nPlan: " + planType + "\nDocs linked: " + docNames + "\n\nANSWERS:\n" + allAnswers + "\n\nMULTI:\n" + allMulti + "\n\nPLAN:\n" + report + "</pre>"
    }).catch(function() {});

    // Save to KV
    const existing = await getFromKV(email) || {};
    const now = new Date().toISOString();
    saveToKV(email, Object.assign({}, existing, {
      email, name, biz, phone, address,
      plan_type: isBundle ? "bundle" : "30day",
      phase_current: isBundle ? 3 : 1,
      phase_1_date: existing.phase_1_date || now,
      phase_2_date: isBundle ? (existing.phase_2_date || now) : null,
      phase_3_date: isBundle ? (existing.phase_3_date || now) : null,
      intake_answers: answers || existing.intake_answers,
      intake_multi: multiAnswers || existing.intake_multi,
      phase_1_report: report,
      phase_2_report: existing.phase_2_report || null,
      phase_3_report: existing.phase_3_report || null,
      updated: now
    }));

    tagMailchimp(email, name, isBundle ? "purchased-bundle" : "purchased-30day");

    return res.status(200).json({ success: true, docs_linked: allDocs.length });

  } catch(err) {
    console.error("send-plan error:", err);
    return res.status(500).json({ error: "Failed", detail: err.message });
  }
};
