/**
 * /api/portal-data
 * GET  — fetch customer's full portal data (progress, before/after, docs, plan)
 * POST — save progress or before/after numbers
 */
const crypto = require("crypto");

function emailHash(email) {
  return crypto.createHash("sha256").update(email.toLowerCase().trim()).digest("hex").slice(0, 32);
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

async function saveToKV(key, value, ttl) {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) return;
  await fetch(url + "/set/" + encodeURIComponent(key), {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify(value)
  });
  if (ttl) {
    await fetch(url + "/expire/" + encodeURIComponent(key) + "/" + ttl, {
      method: "POST",
      headers: { Authorization: "Bearer " + token }
    });
  }
}

async function validateSession(token) {
  if (!token) return null;
  const sessionKey = "session:" + token;
  const session = await getFromKV(sessionKey);
  return session ? session.email : null;
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();

  // Validate session
  const authHeader = req.headers.authorization || "";
  const token = authHeader.replace("Bearer ", "").trim();
  const email = await validateSession(token);
  if (!email) return res.status(401).json({ error: "Unauthorized" });

  const emailKey = email.replace(/[^a-z0-9@._-]/g, "");
  const eh = emailHash(email);

  // ── GET — fetch all portal data ──────────────────────────────────────────
  if (req.method === "GET") {
    try {
      const [customer, progress, beforeAfter, savedNumbers] = await Promise.all([
        getFromKV("customer:" + emailKey),
        getFromKV("progress:" + emailKey),
        getFromKV("beforeafter:" + emailKey),
        getFromKV("numbers:" + emailKey),
      ]);

      // Parse plan tags from stored report for day list — all phases
      let days = [];
      const isBundle = customer?.plan_type === "bundle" || customer?.plan_type === "599";

      function parsePhaseDays(report, phaseNum) {
        if (!report) return [];
        const tag = "PHASE_" + phaseNum + "_PLAN";
        const match = report.match(new RegExp("\\[" + tag + "\\]([\\s\\S]*?)(?=\\[|$)"));
        if (!match) return [];
        const lines = match[1].split("\n").filter(l => l.trim());
        const phaseDays = [];
        lines.forEach(function(line) {
          const dayMatch = line.match(/^(Day \d+):\s*(.+)$/i);
          const sprintMatch = line.match(/^===(.+)===$/);
          if (dayMatch) phaseDays.push({ day: dayMatch[1], task: dayMatch[2], phase: phaseNum });
          if (sprintMatch) phaseDays.push({ sprint: sprintMatch[1].trim(), phase: phaseNum });
        });
        return phaseDays;
      }

      const report = customer?.phase_1_report || "";
      const phase1Days = parsePhaseDays(report, 1);
      const phase2Days = isBundle ? parsePhaseDays(report, 2) : [];
      const phase3Days = isBundle ? parsePhaseDays(report, 3) : [];

      // For 30-day customers, generate placeholder locked days for phases 2 & 3
      const lockedPhase2 = !isBundle ? Array.from({ length: 30 }, (_, i) => ({
        day: "Day " + (31 + i), task: "Unlock Phase 2 to access your days 31-60 plan.", phase: 2, locked: true
      })) : [];
      const lockedPhase3 = !isBundle ? Array.from({ length: 30 }, (_, i) => ({
        day: "Day " + (61 + i), task: "Unlock Phase 3 to access your days 61-90 plan.", phase: 3, locked: true
      })) : [];

      days = [
        ...phase1Days,
        ...(isBundle ? phase2Days : lockedPhase2),
        ...(isBundle ? phase3Days : lockedPhase3),
      ];

      // Check which docs are available
      const DOC_KEYS = [
        "CBS_Guide_1_The_Pricing_Leak_Fix",
        "CBS_Guide_2_The_Scheduling_Black_Hole",
        "CBS_Guide_3_The_Employee_Cost_Leak",
        "CBS_Guide_4_The_Recurring_Revenue_Gap",
        "CBS_Guide_5_The_Estimate_to_Invoice_Leak",
        "CBS_Guide_6_The_Cash_Flow_Blind_Spot",
        "CBS_Guide_7_The_Customer_Churn_Leak",
        "CBS_Guide_8_The_Materials_Markup_Fix",
        "CBS_Guide_9_The_Admin_Time_Drain",
        "CBS_Guide_10_The_Vehicles___Parts_Leak",
        "CBS_Pricing_Worksheet_Rate_Calculator",
        "CBS_Appointment_Confirmation_Process",
        "CBS_Customer_Followup_Sequence",
        "CBS_Employee_Handbook",
        "CBS_Job_Completion_Invoicing_Process",
        "CBS_New_Hire_Training_Documentation",
        "CBS_Parts_Supply_Ordering_Process",
        "CBS_Safety_Job_Site_Procedures",
        "CBS_Truck_Restocking_Checklist",
      ];

      const docChecks = await Promise.all(
        DOC_KEYS.map(key => getFromKV("doc:" + eh + ":" + key).then(d => ({ key, available: !!d })))
      );
      const availableDocs = docChecks.filter(d => d.available).map(d => d.key);

      // Update last_seen
      if (customer) {
        saveToKV("customer:" + emailKey, Object.assign({}, customer, { last_seen: new Date().toISOString() }));
      }

      return res.status(200).json({
        customer: {
          name: customer?.name || "",
          biz: customer?.biz || "",
          plan_type: customer?.plan_type || "30day",
          phase_current: customer?.phase_current || 1,
          phase_1_date: customer?.phase_1_date || null,
          trade: customer?.trade || "",
          intake_answers: customer?.intake_answers || {},
          is_bundle: isBundle,
          intake_complete: customer?.intake_complete || false,
        },
        progress: progress || { completed: [], last_updated: null },
        beforeAfter: beforeAfter || { before: {}, after: {} },
        savedNumbers: savedNumbers || {},
        days,
        availableDocs,
        eh,
        siteUrl: process.env.SITE_URL || "https://www.compassbizsolutions.com",
      });

    } catch(err) {
      console.error("portal-data GET error:", err.message);
      return res.status(500).json({ error: "Failed to load data" });
    }
  }

  // ── POST — save progress or before/after ─────────────────────────────────
  if (req.method === "POST") {
    try {
      const { action, data } = req.body;

      if (action === "save_progress") {
        const existing = await getFromKV("progress:" + emailKey) || { completed: [] };
        const updated = Object.assign({}, existing, {
          completed: data.completed,
          last_updated: new Date().toISOString()
        });
        await saveToKV("progress:" + emailKey, updated);
        return res.status(200).json({ success: true });
      }

      if (action === "save_numbers") {
        const existing = await getFromKV("numbers:" + emailKey) || {};
        const updated = Object.assign({}, existing, data.numbers, { last_updated: new Date().toISOString() });
        await saveToKV("numbers:" + emailKey, updated);
        return res.status(200).json({ success: true });
      }

      if (action === "save_beforeafter") {
        const existing = await getFromKV("beforeafter:" + emailKey) || { before: {}, after: {} };
        const updated = Object.assign({}, existing, {
          [data.phase]: Object.assign({}, existing[data.phase] || {}, data.numbers),
          last_updated: new Date().toISOString()
        });
        await saveToKV("beforeafter:" + emailKey, updated);
        return res.status(200).json({ success: true });
      }

      return res.status(400).json({ error: "Unknown action" });

    } catch(err) {
      console.error("portal-data POST error:", err.message);
      return res.status(500).json({ error: "Failed to save data" });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
};
