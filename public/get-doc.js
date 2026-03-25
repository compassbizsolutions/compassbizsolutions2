/**
 * /api/get-doc
 * Authenticated download endpoint for personalized customer documents.
 *
 * Auth: Option A — email hash (sha256 of email, first 32 chars)
 *
 * Query params:
 *   ?eh={emailHash}&doc={docKey}
 *
 * Falls back to static file redirect if personalized version not found.
 */

const crypto = require("crypto");

const SITE_URL = process.env.SITE_URL || "https://www.compassbizsolutions.com";

// Maps docKey to static fallback filename
const STATIC_FALLBACK = {
  "CBS_Guide_1_The_Pricing_Leak_Fix":         "CBS_Guide_1_The_Pricing_Leak_Fix.docx",
  "CBS_Guide_2_The_Scheduling_Black_Hole":    "CBS_Guide_2_The_Scheduling_Black_Hole.docx",
  "CBS_Guide_3_The_Employee_Cost_Leak":       "CBS_Guide_3_The_Employee_Cost_Leak.docx",
  "CBS_Guide_4_The_Recurring_Revenue_Gap":    "CBS_Guide_4_The_Recurring_Revenue_Gap.docx",
  "CBS_Guide_5_The_Estimate_to_Invoice_Leak": "CBS_Guide_5_The_Estimate_to_Invoice_Leak.docx",
  "CBS_Guide_6_The_Cash_Flow_Blind_Spot":     "CBS_Guide_6_The_Cash_Flow_Blind_Spot.docx",
  "CBS_Guide_7_The_Customer_Churn_Leak":      "CBS_Guide_7_The_Customer_Churn_Leak.docx",
  "CBS_Guide_8_The_Materials_Markup_Fix":     "CBS_Guide_8_The_Materials_Markup_Fix.docx",
  "CBS_Guide_9_The_Admin_Time_Drain":         "CBS_Guide_9_The_Admin_Time_Drain.docx",
  "CBS_Guide_10_The_Vehicles___Parts_Leak":   "CBS_Guide_10_The_Vehicles___Parts_Leak.docx",
  "CBS_Pricing_Worksheet_Rate_Calculator":    "CBS_Pricing_Worksheet_Rate_Calculator.docx",
  "CBS_Appointment_Confirmation_Process":     "CBS_Appointment_Confirmation_Process.docx",
  "CBS_Customer_Followup_Sequence":           "CBS_Customer_Followup_Sequence.docx",
  "CBS_Employee_Handbook":                    "CBS_Employee_Handbook.docx",
  "CBS_Job_Completion_Invoicing_Process":     "CBS_Job_Completion_Invoicing_Process.docx",
  "CBS_New_Hire_Training_Documentation":      "CBS_New_Hire_Training_Documentation.docx",
  "CBS_Parts_Supply_Ordering_Process":        "CBS_Parts_Supply_Ordering_Process.docx",
  "CBS_Safety_Job_Site_Procedures":           "CBS_Safety_Job_Site_Procedures.docx",
  "CBS_Truck_Restocking_Checklist":           "CBS_Truck_Restocking_Checklist.docx",
  "CBS_Change_Order_Template":                "CBS_Change_Order_Template.docx",
  "CBS_Service_Agreement_Maintenance_Contract": "CBS_Service_Agreement_Maintenance_Contract.docx",
};

function emailHash(email) {
  return crypto.createHash("sha256").update(email.toLowerCase().trim()).digest("hex").slice(0, 32);
}

async function getDocFromKV(emailHashStr, docKey) {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  const key = "doc:" + emailHashStr + ":" + docKey;
  try {
    const res = await fetch(url + "/get/" + encodeURIComponent(key), {
      headers: { Authorization: "Bearer " + token }
    });
    const data = await res.json();
    return data.result ? JSON.parse(data.result) : null;
  } catch(e) {
    console.error("KV get error:", e.message);
    return null;
  }
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const { eh, doc } = req.query;

  if (!eh || !doc) {
    return res.status(400).json({ error: "Missing eh or doc parameter" });
  }

  // Validate eh is a 32-char hex string (basic sanity check)
  if (!/^[a-f0-9]{32}$/.test(eh)) {
    return res.status(400).json({ error: "Invalid token" });
  }

  // Look up personalized doc in KV
  const stored = await getDocFromKV(eh, doc);

  if (stored && stored.base64) {
    // Serve the personalized doc
    const buffer = Buffer.from(stored.base64, "base64");
    const filename = stored.filename || (doc + ".docx");
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.setHeader("Content-Disposition", 'attachment; filename="' + filename + '"');
    res.setHeader("Content-Length", buffer.length);
    return res.status(200).send(buffer);
  }

  // Fall back to static file
  const staticFile = STATIC_FALLBACK[doc];
  if (staticFile) {
    console.log("Personalized doc not found, falling back to static:", doc);
    return res.redirect(302, SITE_URL + "/public/downloads/" + encodeURIComponent(staticFile));
  }

  return res.status(404).json({ error: "Document not found" });
};
