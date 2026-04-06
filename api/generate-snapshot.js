/**
 * /api/generate-snapshot
 * Generates the $99 DIY Profit Leak Snapshot PDF content
 * Called from /snapshot page after intake completion
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

async function saveToKV(key, value, ttl) {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) return;
  const path = ttl ? `/setex/${encodeURIComponent(key)}/${ttl}` : `/set/${encodeURIComponent(key)}`;
  await fetch(url + path, {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify(value)
  });
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { token, vals, multiVals, name, biz, trade, phone } = req.body;
    if (!token) return res.status(400).json({ error: "Token required" });

    // Validate snapshot token
    const snapshotSession = await getFromKV("snapshot_session:" + token);
    if (!snapshotSession) return res.status(401).json({ error: "Invalid or expired token" });

    const email = snapshotSession.email;
    const emailKey = email.toLowerCase().replace(/[^a-z0-9@._-]/g, "");

    // Build answers string
    const all = {};
    Object.keys(vals || {}).forEach(k => { all[k] = vals[k]; });
    Object.keys(multiVals || {}).forEach(k => { all[k] = (multiVals[k] || []).join(", "); });
    const answers = Object.keys(all).filter(k => all[k]).map(k => k + ": " + all[k]).join("\n");

    const tradeExpertise = {
      "HVAC": "30 years in HVAC. You know what loaded tech cost looks like, what parts markup should be, how seasonal cash flow kills shops, and why most HVAC guys undercharge by $20-40/hr.",
      "Plumbing": "30 years in plumbing. You know supply house pricing, drain call margins vs water heater margins, what a licensed plumber costs loaded, and how scope creep kills remodel jobs.",
      "Electrical": "30 years in electrical. You know permit costs, flat-rate vs T&M, panel swap pricing, and what journeyman labor actually costs loaded.",
      "Air Duct Cleaning": "30 years in air duct and IAQ work. You know equipment overhead, job timing, add-on pricing for dryer vents and sanitizing, and how to sell maintenance agreements to property managers.",
      "Landscaping": "30 years running landscape crews. Equipment costs, weather and revenue predictability, route density, material markup, converting one-time to maintenance contracts.",
      "Roofing": "30 years in roofing. Material cost volatility, storm work vs scheduled replacement, crew day costs, supplement and change order losses.",
      "Painting": "30 years painting residential and commercial. Material costs, crew productivity, prep time eating margins, why most painters underbid by 15-20%.",
      "General Contracting": "30 years in general contracting. Sub markup schemes, project overhead, change orders, cash flow on a job site.",
      "Pest Control": "30 years in pest control. Chemical costs, route efficiency, recurring vs one-time pricing, why retention beats acquisition.",
      "Cleaning Services": "30 years running cleaning crews. Supply costs, labor turnover, commercial vs residential pricing, recurring contract value.",
      "default": "30 years running a service trade business. You've seen every profit leak there is and know what things actually cost in the field."
    };

    const persona = tradeExpertise[trade] || tradeExpertise["default"];

    const prompt = `You are a 30-year veteran ${trade || "service trade"} business owner helping ${name || "this owner"} at ${biz || "their business"} find their top profit leaks. ${persona}

INTAKE ANSWERS:
${answers}

Generate a PROFIT LEAK SNAPSHOT report. Be brutally specific to their actual numbers and trade. No generic advice. Talk like a peer, not a consultant. Short punchy sentences.

Use EXACTLY these tags:

[SNAPSHOT_HEADLINE]
One punchy sentence — their biggest problem in plain language. Reference their trade and situation.

[SNAPSHOT_INTRO]
2-3 sentences. What you found looking at their numbers. Be direct. Reference specific numbers they gave you.

[LEAK_1_NAME]
Leak category name in ALL CAPS (e.g. PRICING LEAK)

[LEAK_1_RANGE]
Dollar range: $XX,000–$XX,000/year

[LEAK_1_WHY]
2-3 sentences. Why this is happening in their specific situation. Use their actual numbers. Talk like you've seen this exact problem a hundred times.

[LEAK_1_COST]
One sentence with the specific math. Formula using their numbers to show the annual cost.

[LEAK_1_FIX]
3-4 specific numbered steps to fix this. Each step is one clear action they can take. No vague advice. Reference their actual situation.

[LEAK_1_THIS_WEEK]
One sentence. The single most important thing to do in the next 7 days to start fixing this.

[LEAK_2_NAME]
[LEAK_2_RANGE]
[LEAK_2_WHY]
[LEAK_2_COST]
[LEAK_2_FIX]
[LEAK_2_THIS_WEEK]

[LEAK_3_NAME]
[LEAK_3_RANGE]
[LEAK_3_WHY]
[LEAK_3_COST]
[LEAK_3_FIX]
[LEAK_3_THIS_WEEK]

[SNAPSHOT_TOTAL]
One line: Total estimated annual profit leak: $XX,000–$XX,000

[SNAPSHOT_CLOSING]
2-3 sentences. Direct, honest, specific to their numbers. Tell them what consistent implementation of these fixes is worth. Sound like a peer who's been there.`;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4000,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    const data = await response.json();
    const content = data.content ? data.content.map(b => b.text || "").join("") : "";
    if (!content) return res.status(500).json({ error: "Generation failed" });

    // Save snapshot to KV
    await saveToKV("snapshot:" + emailKey, {
      email, name, biz, trade, phone,
      content,
      intake: all,
      generatedAt: new Date().toISOString()
    });

    // Mark snapshot as completed on lead/customer record
    const lead = await getFromKV("lead:" + emailKey);
    if (lead) {
      await saveToKV("lead:" + emailKey, Object.assign({}, lead, {
        snapshot_completed: true,
        snapshot_date: new Date().toISOString()
      }));
    }

    return res.status(200).json({ success: true, content, name, biz, trade, email });

  } catch(err) {
    console.error("generate-snapshot error:", err.message);
    return res.status(500).json({ error: "Failed", detail: err.message });
  }
};
