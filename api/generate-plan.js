/**
 * /api/generate-plan
 * Called from FixKit after customer completes intake
 * Generates customized plan via Claude, stores in KV
 * Same AI prompt as the original generate-report + buildIntakeSystem
 */

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

async function saveToKV(key, value) {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) return;
  await fetch(url + "/set/" + encodeURIComponent(key), {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify(value)
  });
}

async function validateSession(token) {
  if (!token) return null;
  const session = await getFromKV("session:" + token);
  return session ? session.email : null;
}

function buildSystemPrompt(vals, multiVals, planType, name, biz, address, trade) {
  const all = {};
  Object.keys(vals || {}).forEach(k => { all[k] = vals[k]; });
  Object.keys(multiVals || {}).forEach(k => { all[k] = (multiVals[k] || []).join(", "); });
  const answers = Object.keys(all).map(k => k + ": " + all[k]).join("\n");

  const isBundle = planType === "bundle" || planType === "599";
  const phaseDesc = isBundle
    ? "Generate a COMPLETE 30/60/90-day plan — all three phases. Phase 1 (days 1-30) covers their top leaks. Phase 2 (days 31-60) covers the next tier. Phase 3 (days 61-90) covers remaining leaks."
    : "Generate a 30-DAY plan only — covering their top leaks ranked by dollar impact.";

  return "You are a business consultant for blue-collar service businesses. You know all 10 profit leak categories: 1-Pricing, 2-Scheduling, 3-Employee Cost, 4-Recurring Revenue, 5-Estimate-to-Invoice, 6-Cash Flow, 7-Customer Churn, 8-Materials Markup, 9-Admin Time Drain, 10-Vehicles and Parts.\n\nBUSINESS: " + (biz || "this business") + (address ? " — " + address : "") + (name ? " — Owner: " + name : "") + (trade ? " — Trade: " + trade : "") + "\n\nINTAKE ANSWERS:\n" + answers + "\n\n" + phaseDesc + "\n\nRULES:\n- Keep each Day line to 1-2 sentences max — specific action, time estimate (15-20 min), doc/worksheet name if applicable\n- Group days into sprints: === DAYS 1-5: SPRINT NAME ===\n- Include EVERY day from Day 1 to Day 30 — no skipping, no blank days\n- Reference owner's actual numbers and trade throughout\n- No markdown bold, no bullet dashes, no --- separators, no mention of AI\n\nUse EXACTLY these tags in order:\n\n[LEAK_RANKING]\nNumbered list. Format: N. LEAK NAME — $XX,000-$XX,000/year | one specific sentence about their situation.\n\n[LEAK_TOTAL]\nEstimated total annual profit leak: $XX,000-$XX,000\n\n[PHASE_1_INTRO]\n2-3 sentences on what phase 1 targets and why.\n\n[PHASE_1_PLAN]\n=== DAYS 1-5: SPRINT NAME ===\nDay 1: [specific 15-20 min task — name the exact doc or worksheet if applicable]\nDay 2: [task]\n... continue through Day 30, every single day, grouped into 5-day sprints\n\n[PHASE_1_DOCS]\nOne line per doc: Doc Name — how it applies and which section to start.\n\n" + (isBundle ? "[PHASE_2_INTRO]\n2-3 sentences.\n\n[PHASE_2_PLAN]\nSame format, days 31-60, every day.\n\n[PHASE_2_DOCS]\nSame format.\n\n[PHASE_3_INTRO]\n2-3 sentences.\n\n[PHASE_3_PLAN]\nSame format, days 61-90, every day.\n\n[PHASE_3_DOCS]\nSame format.\n\n" : "") + "[CLOSING]\n2-3 sentences. Reference their specific numbers and situation. No generic motivation.";
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    // Validate session
    const authHeader = req.headers.authorization || "";
    const sessionToken = authHeader.replace("Bearer ", "").trim();
    const email = await validateSession(sessionToken);
    if (!email) return res.status(401).json({ error: "Unauthorized" });

    const { vals, multiVals, name, biz, address, trade, phone } = req.body;
    const emailKey = email.replace(/[^a-z0-9@._-]/g, "");

    // Get customer to get plan type
    const customer = await getFromKV("customer:" + emailKey);
    if (!customer) return res.status(404).json({ error: "Customer not found" });

    const planType = customer.plan_type || "30day";

    // Build system prompt and call Claude
    const system = buildSystemPrompt(vals, multiVals, planType, name, biz, address, trade);

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 8000,
        system,
        messages: [{ role: "user", content: "Generate the full customized plan now based on all intake answers." }],
      }),
    });

    const data = await response.json();
    const report = data.content ? data.content.map(b => b.text || "").join("") : "";

    if (!report) return res.status(500).json({ error: "Plan generation failed" });

    // Save everything to customer record
    const now = new Date().toISOString();
    await saveToKV("customer:" + emailKey, Object.assign({}, customer, {
      name: name || customer.name,
      biz: biz || customer.biz,
      phone: phone || customer.phone,
      address: address || customer.address,
      trade: trade || customer.trade,
      intake_answers: vals || {},
      intake_multi: multiVals || {},
      intake_complete: true,
      phase_1_report: report,
      updated: now,
    }));

    return res.status(200).json({ success: true });

  } catch(err) {
    console.error("generate-plan error:", err.message);
    return res.status(500).json({ error: "Failed", detail: err.message });
  }
};
