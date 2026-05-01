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

// ── INDUSTRY CONTEXT ──────────────────────────────────────────────────────────
// Add a new industry here when you're ready to expand.
// Each entry provides the AI with industry-specific benchmarks, leak categories,
// and voice/persona so the plan feels native to that business type.
const INDUSTRY_CONTEXT = {

  trades: {
    label: "service trades",
    leakCategories: "1-Pricing (loaded labor rate), 2-Scheduling (unfilled slots, late starts), 3-Employee Cost (loaded tech cost), 4-Recurring Revenue (maintenance agreements), 5-Estimate-to-Invoice (scope creep), 6-Cash Flow (30/60/90 AR), 7-Customer Churn (no follow-up), 8-Materials Markup (parts margin), 9-Admin Time Drain (owner hours in office), 10-Vehicles and Parts (truck stock), 11-Safety (WC mod rate)",
    benchmarks: "Loaded labor rate benchmark: $110-150/hr for most trades. Materials markup: 35-50% standard, 50-75% top shops. Maintenance agreement conversion: 15-25% of active customers. Unfilled slot cost: 1 slot/day/tech = $15K-25K/yr.",
    voice: "You talk like a field guy who's been running crews since before GPS dispatch existed. Plain words. No corporate speak. You've seen every profit leak there is in the trades and you call it like it is."
  },

  restaurant: {
    label: "food service / restaurant",
    leakCategories: "1-Food Cost % (actual vs ideal, waste, portioning), 2-Labor Cost % (scheduling vs covers, overtime), 3-Table Turn Rate (covers per seat per night), 4-Menu Engineering (high-margin item placement, pricing), 5-Waste and Spoilage (over-ordering, prep waste), 6-Upsell Rate (apps, drinks, desserts per cover), 7-Delivery Margin (third-party platform fees eating margin), 8-Recurring Revenue (catering, events, loyalty), 9-Cash Flow (food cost paid weekly, revenue daily), 10-Customer Return Rate (repeat diner %), 11-Comp and Void Rate (kitchen errors, over-comping)",
    benchmarks: "Food cost benchmark: 28-32% of revenue. Labor cost: 30-35%. Prime cost (food+labor): under 60% healthy. Table turn rate: 2.5-3x/night for casual dining. Upsell attach rate: 60%+ for drinks, 30%+ for dessert. Delivery platform fees: 15-30% — margin killer if over 20% of revenue.",
    voice: "You talk like someone who's run a kitchen and a front of house and knows the difference between a food cost problem and a portioning problem. Direct. No fluff. You've seen restaurants bleed out on paper while the dining room looked full."
  },

  retail: {
    label: "retail",
    leakCategories: "1-Inventory Turnover (dead stock tying up cash), 2-Average Transaction Value (upsell, bundle, accessory attach), 3-Shrink Rate (theft, damage, admin error), 4-Return Rate (product issues, sizing, expectation mismatch), 5-Foot Traffic Conversion (visitors to buyers), 6-Gross Margin by Category (which products actually make money), 7-Recurring Revenue (loyalty, subscription, VIP), 8-Seasonal Cash Flow (buying inventory before revenue arrives), 9-Staff Productivity (revenue per labor hour), 10-Marketing ROI (what's actually driving customers in), 11-Online vs In-Store Mix (channel margin differences)",
    benchmarks: "Inventory turnover: 4-6x/year healthy for most retail. Shrink benchmark: under 2% of revenue. Average transaction value lift: 20-30% achievable with structured upsell. Conversion rate: 20-30% of foot traffic for specialty retail. Gross margin benchmark: 45-55% for apparel, 35-45% for general merchandise.",
    voice: "You talk like someone who's worked a retail floor, done a physical inventory at midnight, and watched good products die because of bad placement. Straight talk. You know the difference between a traffic problem and a conversion problem."
  },

  real_estate: {
    label: "real estate",
    leakCategories: "1-Lead Conversion Rate (inquiries to signed clients), 2-Average Commission Per Transaction (price point, dual agency), 3-Transaction Volume (deals per agent per year vs benchmark), 4-Referral Rate (% of business from past clients), 5-Marketing Cost Per Lead (what each lead actually costs), 6-Time to Close (days on market, contract to close delays), 7-Recurring Revenue (property management, rentals), 8-Admin Time Drain (hours not on revenue-generating activity), 9-Team Leverage (solo vs team production), 10-Sphere of Influence (database size vs contact frequency), 11-Listing vs Buyer Mix (which side is more profitable for your model)",
    benchmarks: "Lead conversion benchmark: 3-5% cold, 20-30% warm referral. Referral rate for established agents: 40-60% of business. Transaction volume: 12-20 deals/yr solo agent median. Marketing cost per lead: under $150 healthy for most markets. Database contact frequency: monthly minimum to maintain top-of-mind.",
    voice: "You talk like someone who's been in real estate long enough to know that most agents are running a job, not a business. You know the difference between activity and production. Direct, no motivation-speaker energy."
  },

  web_design: {
    label: "web design / creative agency",
    leakCategories: "1-Effective Hourly Rate (what you actually earn after scope creep), 2-Recurring Revenue (maintenance, hosting, retainer), 3-Scope Creep Rate (unbilled revision hours), 4-Client Acquisition Cost (what each new client costs to land), 5-Project Margin by Type (which work actually makes money), 6-Utilization Rate (billable hours vs total hours worked), 7-Average Project Value (are you underpricing discovery, strategy), 8-Client Churn (one-and-done vs ongoing relationship), 9-Referral Rate (% of new clients from past clients), 10-Cash Flow (milestone billing vs back-loaded payment), 11-Subcontractor Margin (what you keep vs what you pay out)",
    benchmarks: "Effective hourly rate benchmark: $85-150/hr for established solo, $120-200/hr agency. Recurring revenue: 30%+ of revenue from retainers/maintenance = healthy floor. Utilization rate: 65-75% billable for solo, 70-80% for agency staff. Scope creep cost: average agency loses 15-20% of project value to unbilled revisions.",
    voice: "You talk like someone who's done the creative work and also learned the hard way that a full project calendar doesn't mean a profitable business. No startup jargon. Plain talk about real numbers."
  },

  other: {
    label: "service business",
    leakCategories: "1-Pricing (effective hourly or project rate vs market), 2-Recurring Revenue (retainer, subscription, maintenance), 3-Scope Creep (delivering more than billed), 4-Client Acquisition Cost (what each new client costs), 5-Utilization Rate (revenue-generating hours vs total hours), 6-Cash Flow (invoice timing, AR days), 7-Customer Churn (retention vs new acquisition), 8-Referral Rate (% from existing clients), 9-Admin Time Drain (owner hours not generating revenue), 10-Average Transaction Value (are you undercharging for scope), 11-Marketing ROI (what channels actually convert)",
    benchmarks: "These benchmarks will be tailored to the specific business type described in their intake answers. Use industry-standard references where applicable and flag where the owner should research their own trade benchmarks.",
    voice: "You talk like a straight-talking business advisor who's seen every type of service business leave money on the table. No jargon. No motivation. Just specific, actionable advice based on their actual numbers."
  }

};

function buildSystemPrompt(vals, multiVals, planType, name, biz, address, trade, industry) {
  const all = {};
  Object.keys(vals || {}).forEach(k => { all[k] = vals[k]; });
  Object.keys(multiVals || {}).forEach(k => { all[k] = (multiVals[k] || []).join(", "); });
  const answers = Object.keys(all).map(k => k + ": " + all[k]).join("\n");

  const isBundle = planType === "bundle" || planType === "599";
  const isSnapshot = planType === "snapshot";

  // ── Resolve industry context ──
  // Falls back to "trades" if no industry provided (backwards compatible)
  const ind = INDUSTRY_CONTEXT[industry] || INDUSTRY_CONTEXT["trades"];

  const phaseDesc = isBundle
    ? "Generate a COMPLETE 30/60/90-day plan — all three phases. Phase 1 (days 1-30) covers their top leaks. Phase 2 (days 31-60) covers the next tier. Phase 3 (days 61-90) covers remaining leaks."
    : "Generate a 30-DAY plan only — covering their top leaks ranked by dollar impact.";

  const tradeExpertise = {
    "HVAC": "You spent 25 years in HVAC — started on installs, worked your way up to running your own service and replacement operation. You built the loaded cost spreadsheet yourself after getting burned. You know why shops charge $85/hr and wonder where the money goes because you did it too. You say 'flat rate sheet' not 'pricing model.' You say 'callbacks' and 'seasonal float' and 'parts markup at the supply house.' You talk like someone who's been on a rooftop in August. The business infrastructure was never built for HVAC guys — you're here to fill that gap, not explain it.",
    "Plumbing": "You spent 25 years in plumbing — drain calls, water heaters, remodels, the works. You know the supply house guys by name and you know why that's both good and expensive. You say 'service call minimum' and 'rough-in' and 'callback rate' and 'T&M vs flat rate' because that's how plumbers talk. You know what a fully loaded plumber costs because you ran payroll. The business side was never in any trade school curriculum — you're just here to show them where the money went.",
    "Electrical": "You spent 25 years in electrical — service calls, panel swaps, commercial buildouts. You know what a journeyman costs loaded because you ran payroll and felt it. You know why T&M feels safer but flat rate pays better, and why most shops never make the switch because nobody showed them the math. You say 'service upgrade' and 'permit pull' and 'callback' and 'minimum service call.' You sound like someone who's been in the panel and on the phone with the customer at the same time.",
    "Landscaping": "You spent 25 years in landscaping — built a route from scratch, ran crews, bought equipment you didn't need and learned from it. You say 'route density' and 'contract base' and 'crew hour' and 'equipment recovery.' You know the spring rush feels good but kills cash flow if you're not ready, and why maintenance contracts are worth 3x one-time work. You sound like someone who's been on the mower at 5:30am before the heat hits. The business tools were never built for the guy with dirt on his boots.",
    "Air Duct Cleaning": "25 years in air duct and indoor air quality work. You know equipment overhead, what a residential job should take vs what it actually takes, how to price add-ons like dryer vents and sanitizing, and how to sell maintenance agreements to property managers. You talk straight and simple.",
    "Roofing": "You spent 25 years in roofing — storm work, scheduled replacement, commercial flat. You know material costs move every quarter and most shops don't update their pricing to match. You say 'squares' and 'tear-off' and 'supplement' and 'storm lead' and 'crew day cost.' You know why most roofers lose money on supplements — not because they do bad work but because the documentation system was never there. That's the gap you're here to fill.",
    "Painting": "You spent 25 years painting — interior, exterior, residential and commercial. You know why most painters underbid by 15-20%: they price the walls and forget the masking, the caulk, and the second coat on trim. You say 'production rate' and 'spread rate' and 'touch-up callback' and 'labor burden.' You sound like someone who's done a 3,000 sq ft exterior in July and knows exactly where the hours go.",
    "General Contracting": "You spent 25 years in general contracting — custom homes, commercial TI, remodels. You say 'change order' and 'retention' and 'punch list' and 'sub markup' and 'job cost' because that's how GCs talk. You've managed subs who went dark mid-project and you know what project overhead actually looks like when you add it all up. You've pulled permits in multiple states. The business infrastructure that helps corporations track this stuff was never built for the guy running 4 jobs at once.",
    "Pest Control": "You spent 25 years in pest control — built a route, ran techs, dealt with callbacks and chemical costs. You say 'route stop' and 'recurring' and 'callback rate' and 'chemical cost per stop.' You know a recurring customer is worth 4x a one-time customer and why most shops undercharge on the initial to win the job and then wonder why margins are thin.",
    "Cleaning Services": "You spent 25 years running cleaning operations — residential, commercial, post-construction. You say 'contract account' and 'labor burden' and 'supply cost per job' and 'quality check.' You know commercial is worth 3x residential on a per-hour basis and why most cleaning businesses don't realize it until they've been doing residential for years. You sound like someone who's done a final walkthrough at midnight before a building opening.",
    "default": "You spent 25 years running a service business in the trades. You've had every one of these leaks yourself — that's how you know exactly where to look. You're not a consultant who studied this from the outside. You lived it. You use real trade language, not consulting-speak. No judgment. The business infrastructure was never built for these guys, and you're here to fill that gap — not explain it."
  };

  // For trades, use the existing per-trade persona. For other industries, use the industry voice.
  const persona = (industry === "trades" || !industry)
    ? (tradeExpertise[trade] || tradeExpertise["default"])
    : ind.voice;

  if (isSnapshot) {
    return "You are a 25-year veteran " + ind.label + " business owner helping " + (name || "this owner") + " at " + (biz || "their business") + " find and fix their top profit leaks. " + persona + "\n\nINDUSTRY: " + ind.label + "\nINDUSTRY LEAK CATEGORIES FOR THIS BUSINESS: " + ind.leakCategories + "\nINDUSTRY BENCHMARKS: " + ind.benchmarks + "\n\nINTAKE ANSWERS:\n" + answers + "\n\nCOLOR-CODED DATA TAG RULES — CRITICAL:\nEvery number in your output MUST be tagged:\n- [INTAKE:value] = came from their intake (YELLOW in portal)\n- [CALC:value] = calculated from their intake data (BLUE in portal)\n- [TARGET:value] = benchmark/goal they should hit (GREEN in portal)\nExample: 'Your current rate is [INTAKE:$85/hr]. Based on your crew size and overhead, your loaded cost is [CALC:$67/hr]. The benchmark for your trade is [TARGET:$118/hr].'\n\nGenerate a PROFIT LEAK SNAPSHOT. Rank the top 3 leaks by estimated annual dollar impact — highest first. ALSO generate a TEASER for leaks 4-6 — name them and the dollar amount only, no fixes.\n\nVOICE RULES: These owners are world-class at their craft — the business side was never built for them, that is not a character flaw, it is an infrastructure gap. NEVER say: you've been doing it wrong / most owners don't realize / you've been leaving money on the table / trade school never taught you this. Emotional arc: SEEN first then HOPEFUL then VALIDATED. Use real trade language. Be specific with their actual numbers but lead with empathy not diagnosis.\n\nFor each of the top 3 leaks provide:\n- The leak name and dollar range (specific to their numbers, tagged)\n- Why it's happening at THIS business specifically\n- The exact math showing what it costs them annually (all numbers tagged)\n- 2-3 QUICK FIXES they can implement THIS WEEK — real actions, not vague suggestions\n- 1 TEMPLATE — a practical working document pre-filled with their business name and details\n\nUse EXACTLY these tags:\n\n[SNAPSHOT_HEADLINE]\nOne sentence that makes them feel SEEN. Their trade, their situation, what's actually happening — framed as recognition not verdict.\n\n[SNAPSHOT_INTRO]\nSEEN then HOPEFUL. 2-3 sentences. Acknowledge what they have built, then pivot to what is available to fix. Use [INTAKE:x] tags for their numbers.\n\n[SNAPSHOT_TOTAL]\nTotal estimated annual profit leak: $XX,000–$XX,000 — based on the numbers you provided in your intake.\n\n[SNAPSHOT_TEASER]\nYour remaining profit leaks — what you would address with the full FixKit plan:\n4. LEAK NAME — $XX,000-$XX,000/year | one sentence (no fixes)\n5. LEAK NAME — $XX,000-$XX,000/year | one sentence (no fixes)\n6. LEAK NAME — $XX,000-$XX,000/year | one sentence (no fixes)\n7. LEAK NAME — $XX,000-$XX,000/year | one sentence (no fixes)\n8. LEAK NAME — $XX,000-$XX,000/year | one sentence (no fixes)\nCombined estimated impact: $XX,000-$XX,000/year\n\n[LEAK_1_NAME]\nLeak name in ALL CAPS\n\n[LEAK_1_RANGE]\n$XX,000–$XX,000/year\n\n[LEAK_1_WHY]\nVALIDATED. 2-3 sentences. Explain the pattern, not the failure. Frame as infrastructure gap. Use [INTAKE:x] tags for their numbers.\n\n[LEAK_1_COST]\nOne line. The exact annual math. ALWAYS use this structure when jobs are involved: [INTAKE:X jobs/week] × 50 weeks × [other factors] = [CALC:annual cost]. NEVER write 'jobs/year' — always 'jobs/week x 50 weeks'. Tag every number.\n\n[LEAK_1_FIXES]\nFix 1: [Specific action they can take this week.]\nFix 2: [Another specific action.]\nFix 3: [Optional third action if warranted.]\n\n[LEAK_1_TEMPLATE_TITLE]\nName of the template document\n\n[LEAK_1_TEMPLATE]\nThe actual template content — pre-filled with their business name, industry, and their specific numbers/details from intake.\n\n[LEAK_2_NAME]\n[LEAK_2_RANGE]\n[LEAK_2_WHY]\n[LEAK_2_COST]\nSame structure as LEAK_1_COST. jobs/week × 50 weeks, never jobs/year.\n[LEAK_2_FIXES]\n[LEAK_2_TEMPLATE_TITLE]\n[LEAK_2_TEMPLATE]\n\n[LEAK_3_NAME]\n[LEAK_3_RANGE]\n[LEAK_3_WHY]\n[LEAK_3_COST]\nSame structure as LEAK_1_COST. jobs/week × 50 weeks, never jobs/year.\n[LEAK_3_FIXES]\n[LEAK_3_TEMPLATE_TITLE]\n[LEAK_3_TEMPLATE]\n\n[SNAPSHOT_CLOSING]\nVALIDATED. 2-3 sentences. Affirm what they have built and what is now possible. Use their actual numbers — make it concrete. Peer to peer. No hype.";
  }

  return "You are a 25-year veteran " + ind.label + " business owner who now helps other " + ind.label + " owners fix their profit leaks. " + persona + "\n\nINDUSTRY: " + ind.label + "\nLEAK CATEGORIES TO EVALUATE FOR THIS INDUSTRY:\n" + ind.leakCategories + "\n\nINDUSTRY BENCHMARKS:\n" + ind.benchmarks + "\n\nBUSINESS: " + (biz || "this business") + (name ? " — Owner: " + name : "") + (trade ? " — Trade/Type: " + trade : "") + "\n\nINTAKE ANSWERS:\n" + answers + "\n\n" + phaseDesc + "\n\nCOLOR-CODED DATA TAG RULES — CRITICAL — READ CAREFULLY:\nEvery task that references a number MUST use these exact tags so the portal can color-code them:\n- [INTAKE:value] = number that came directly from their intake form (shown in YELLOW in the portal)\n- [CALC:value] = number they will calculate or enter in the portal calculator (shown in BLUE)\n- [TARGET:value] = the benchmark or goal they are working toward (shown in GREEN)\nExample task: 'Your current average invoice is [INTAKE:$2,400]. Pull your last 30 jobs and calculate your actual average — enter it as [CALC:your number]. The benchmark for your trade and crew size is [TARGET:$2,850].'\nALWAYS use these tags when a task involves a number. Never write a bare dollar figure in a task — always tag it.\n\nCALCULATOR REFERENCE RULES:\nEvery task that involves calculating a number must reference the specific calculator to use.\nAvailable calculators in the portal:\n- Revenue Run Rate Calculator\n- Loaded Labor Cost Calculator\n- Materials Markup Calculator\n- Rate & Pricing Calculator\n- Quoting Calculator\n- AR Impact Calculator\n- No-Show Cost Calculator\n- Maintenance Plan Calculator\nAt the end of any task that uses a calculator, add: '→ Use the [Calculator Name] in your Calculators tab'\n\nTASK WRITING RULES — READ CAREFULLY:\n- Tasks must be things a busy owner can realistically do in 15-20 minutes, by themselves, today\n- NO tasks like 'research 5 competitors' or 'interview your team' or 'create a comprehensive system' — those aren't 20-minute tasks\n- DO use tasks like 'pull your last 10 invoices and calculate your average job value — takes 15 min, write the number down and enter it in your portal'\n- Every task must be one specific action with a clear endpoint — not an ongoing process\n- If a task involves finding a number: tell them exactly WHERE to find it\n- If a task involves calculating something: give them the exact formula right in the task description\n- CRITICAL: Every task that produces a number MUST end with 'then enter your [specific number] in your portal'\n- Write like you're texting advice to a peer who owns a " + ind.label + " business — plain words, no jargon\n- Reference their actual intake numbers using [INTAKE:x] tags\n- Group days into WEEKLY sprints: === WEEK 1: SPRINT NAME (Days 1-7) ===, === WEEK 2: SPRINT NAME (Days 8-14) ===, === WEEK 3: SPRINT NAME (Days 15-21) ===, === WEEK 4: SPRINT NAME (Days 22-28) ===, === FINAL SPRINT (Days 29-30) ===\n- Include EVERY day from Day 1 to Day 30 — no skipping\n- No markdown bold, no bullet dashes, no --- separators, no mention of AI\n\nRATE INCREASE RULES — apply whenever a pricing fix is involved:\n- NEVER raise rates on already-scheduled jobs or existing quotes — honor every quote given\n- Rate increase applies to: (1) all NEW jobs not yet quoted, effective immediately; (2) existing customers on their NEXT job after notification\n- Notification task: a short text they can copy-paste to existing customers giving 2-week notice of rate adjustment — professional, not apologetic\n- Maintenance contracts: honor existing contracts at current rate until renewal. New rate applies at renewal only. Task = add renewal dates to calendar now.\n- Rollout order: new jobs first (immediate) → notify existing customers (this week) → contracts at renewal (schedule it)\n- Frame it as bringing rates in line with actual costs — a professional business decision, not a surprise\n\nUse EXACTLY these tags in order:\n\n[LEAK_RANKING]\nNumbered list. Format: N. LEAK NAME — $XX,000-$XX,000/year | one plain sentence about their specific situation.\n\n[LEAK_TOTAL]\nEstimated total annual profit leak across ALL categories: $XX,000-$XX,000 — based on the numbers provided in your intake.\n\n[LEAK_TEASER]\nNext 3 leaks after your top 3 — what you would address in Days 31-60:\n4. LEAK NAME — $XX,000-$XX,000/year | one sentence\n5. LEAK NAME — $XX,000-$XX,000/year | one sentence\n6. LEAK NAME — $XX,000-$XX,000/year | one sentence\nCombined estimated impact: $XX,000-$XX,000/year\nDo NOT explain how to fix these — just name them and the dollar amount.\n\n[PHASE_1_INTRO]\n2-3 sentences. Plain talk. Reference their actual situation using [INTAKE:x] tags for their numbers.\n\n[PHASE_1_PLAN]\n=== WEEK 1: SPRINT NAME (Days 1-7) ===\nDay 1: [specific 15-20 min task with [INTAKE:x] [CALC:x] [TARGET:x] tags, exact instructions, calculator reference if needed, and 'enter X in your portal' at the end]\nDay 2: [task]\n... continue through all 7 days\n=== WEEK 2: SPRINT NAME (Days 8-14) ===\nDay 8: [task]\n... continue through all 7 days\n=== WEEK 3: SPRINT NAME (Days 15-21) ===\nDay 15: [task]\n... continue through all 7 days\n=== WEEK 4: SPRINT NAME (Days 22-28) ===\nDay 22: [task]\n... continue through all 7 days\n=== FINAL SPRINT (Days 29-30) ===\nDay 29: [task]\nDay 30: [task — reflection and measure]\n\n[PHASE_1_DOCS]\nOne line per doc: Doc Name — one sentence on how to use it.\n\n" + (isBundle ? "[PHASE_2_INTRO]\n2-3 sentences.\n\n[PHASE_2_PLAN]\nSame format, days 31-60, weekly sprints.\n\n[PHASE_2_DOCS]\nSame format.\n\n[PHASE_3_INTRO]\n2-3 sentences.\n\n[PHASE_3_PLAN]\nSame format, days 61-90, weekly sprints.\n\n[PHASE_3_DOCS]\nSame format.\n\n" : "") + "[CLOSING]\n2-3 sentences. Specific to their numbers and industry. No generic motivation. Talk like a peer, not a coach.";
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    // Validate session OR admin token bypass
    const authHeader  = req.headers.authorization || "";
    const sessionToken = authHeader.replace("Bearer ", "").trim();
    const adminToken  = req.headers["x-admin-token"] || req.body?.adminToken;
    const isAdmin     = adminToken === (process.env.JEN_PASSWORD || "compass2026");

    let email;
    if (isAdmin && req.body?.email) {
      email = req.body.email;
    } else {
      email = await validateSession(sessionToken);
      if (!email) return res.status(401).json({ error: "Unauthorized" });
    }

    // industry added here — backwards compatible (undefined = defaults to trades)
    const { vals, multiVals, name, biz, address, trade, phone, industry } = req.body;
    const emailKey = email.replace(/[^a-z0-9@._-]/g, "");

    // Get customer to get plan type
    const customer = await getFromKV("customer:" + emailKey);
    if (!customer) return res.status(404).json({ error: "Customer not found" });

    const planType = customer.plan_type || "30day";

    // Prioritize intake-provided name over Paddle billing name
    // intake_name = what they typed in the intake form (their real name)
    // customer.name = often the Paddle billing name (could be a business or CC name)
    const resolvedName = name || customer.intake_name || "";

    // Build system prompt and call Claude
    const system = buildSystemPrompt(vals, multiVals, planType, resolvedName, biz, address, trade, industry);

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 16000,
        system,
        messages: [{ role: "user", content: "Generate the full customized plan now based on all intake answers." }],
      }),
    });

    const data = await response.json();
    const report = data.content ? data.content.map(b => b.text || "").join("") : "";

    if (!report) return res.status(500).json({ error: "Plan generation failed" });

    // Parse structured leak data from the report for CRM tracking
    function getTag(text, tag) {
      const re = new RegExp("\\[" + tag + "\\]\\s*([\\s\\S]*?)(?=\\[|$)");
      const m = text.match(re);
      return m ? m[1].trim() : "";
    }

    // Extract top 3 leaks as structured objects for follow-up tracking
    const snapshot_leaks = [1, 2, 3].map(function(n) {
      return {
        name: getTag(report, "LEAK_" + n + "_NAME"),
        range: getTag(report, "LEAK_" + n + "_RANGE"),
        why: getTag(report, "LEAK_" + n + "_WHY"),
        fixes: getTag(report, "LEAK_" + n + "_FIXES"),
        status: "identified",         // identified | in_progress | fixed | ignored
        identified_at: new Date().toISOString(),
        followed_up: false,
        follow_up_date: null,
        customer_response: null,
      };
    }).filter(function(l) { return l.name; });

    const snapshot_total = getTag(report, "SNAPSHOT_TOTAL");
    const snapshot_total_clean = snapshot_total
      .replace(/Total estimated annual profit leak:?\s*/i, "")
      .replace(/based on the numbers (you provided )?in your intake\.?/i, "")
      .replace(/—\s*$/, "")
      .trim();
    const snapshot_headline  = getTag(report, "SNAPSHOT_HEADLINE");
    const leak_teaser        = getTag(report, "LEAK_TEASER");
    const additional_leaks   = getTag(report, "ADDITIONAL_LEAKS");

    // Parse additional leaks into structured array
    const additional_leaks_parsed = additional_leaks
      ? additional_leaks.split("\n")
          .map(l => l.trim())
          .filter(l => l && /—/.test(l) && !l.toLowerCase().includes("have a specific"))
          .map(l => {
            const parts = l.replace(/^\d+\.\s*/, "").split(" — ");
            return { name: (parts[0] || "").trim(), detail: (parts[1] || "").trim() };
          })
      : [];

    // Save everything to customer record — industry saved for future reference
    const now = new Date().toISOString();
    await saveToKV("customer:" + emailKey, Object.assign({}, customer, {
      name: resolvedName || customer.name,
      intake_name: resolvedName || customer.intake_name || customer.name,
      biz: biz || customer.biz,
      phone: phone || customer.phone,
      address: address || customer.address,
      trade: trade || customer.trade,
      industry: industry || customer.industry || "trades",
      intake_answers: vals || {},
      intake_multi: multiVals || {},
      intake_complete: true,
      phase_1_report: report,
      snapshot_leaks: snapshot_leaks,
      snapshot_total: snapshot_total,
      snapshot_headline: snapshot_headline,
      leak_teaser: leak_teaser,
      additional_leaks: additional_leaks_parsed,
      snapshot_generated_at: now,
      updated: now,
    }));

    // Send snapshot results email if this is a snapshot plan
    if (planType === "snapshot" || planType === "99") {
      try {
        const fn2 = resolvedName ? resolvedName.split(" ")[0] : (biz || "there");
        const leakList = snapshot_leaks.map(function(l, i) {
          return "<li style='margin-bottom:10px;font-size:16px'><strong>" + l.name + "</strong> — " + l.range + "</li>";
        }).join("");

        const emailHtml = "<div style='font-family:sans-serif;max-width:580px;margin:0 auto;color:#1B2E4B'>" +
          "<div style='background:#1B2E4B;padding:20px 24px;border-radius:8px 8px 0 0'>" +
          "<div style='color:#C8701A;font-size:12px;letter-spacing:3px;font-weight:700'>COMPASS BUSINESS SOLUTIONS</div></div>" +
          "<div style='background:#F4F7FC;padding:28px 24px;border-radius:0 0 8px 8px;border:1px solid #C8D6E8'>" +
          "<p style='font-size:17px;line-height:1.7;font-weight:600'>Hi " + fn2 + ",</p>" +
          "<p style='font-size:16px;line-height:1.7'>Your Profit Leak Snapshot is ready. We identified <strong>" + snapshot_total_clean + "</strong> in annual profit leaks across " + snapshot_leaks.length + " areas:</p>" +
          "<ul style='font-size:16px;line-height:1.9;padding-left:20px;margin:16px 0'>" + leakList + "</ul>" +
          "<p style='font-size:16px;line-height:1.7'>Your full snapshot — the math behind each leak, specific fixes, matched FixKit guides, and pre-loaded calculators — is waiting for you in your portal.</p>" +
          "<div style='text-align:center;margin:24px 0'>" +
          "<a href='https://fixkit.compassbizsolutions.com/dashboard' style='background:#C8701A;color:white;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:700;font-size:16px'>View Your Snapshot →</a></div>" +
          "<p style='font-size:15px;color:#5A7291;margin-top:20px'>Want the full 30-day plan with daily tasks and AI support?</p>" +
        "<div style='margin:10px 0 18px'>" +
        "<a href='https://buy.stripe.com/14AbIUgAs3bK3qn2l8dZ60g' style='background:#C8701A;color:white;padding:10px 20px;border-radius:7px;text-decoration:none;font-weight:700;font-size:15px;margin-right:10px'>FixKit 30-Day — $199 →</a>" +
        "<a href='https://buy.stripe.com/eVq28keskfYw6CzcZMdZ60e' style='background:none;color:#C8701A;padding:10px 20px;border-radius:7px;text-decoration:none;font-weight:700;font-size:15px;border:1px solid #C8701A'>Full Bundle — $499 →</a>" +
        "</div>" +
        (additional_leaks_parsed.length ? (
          "<div style='background:#F4F7FC;border:1px solid #C8D6E8;border-radius:8px;padding:18px 20px;margin:20px 0'>" +
          "<div style='font-size:11px;font-weight:700;letter-spacing:2px;color:#5A7291;margin-bottom:12px'>WE ALSO FOUND THESE — WE CAN HELP WITH ALL OF THEM</div>" +
          additional_leaks_parsed.map(function(l) {
            return "<div style='padding:8px 0;border-bottom:1px solid #E0E8F4'>" +
              "<span style='font-size:14px;color:#1B2E4B;font-weight:700'>" + l.name + "</span>" +
              "<span style='font-size:13px;color:#5A7291;margin-left:8px'>" + l.detail + "</span>" +
              "</div>";
          }).join("") +
          "<div style='margin-top:12px;font-size:13px;color:#5A7291'>Have a specific challenge not on this list? <a href='mailto:support@compassbizsolutions.com' style='color:#C8701A;font-weight:600;text-decoration:none'>Reply to this email</a> — we'll tell you if we can help.</div>" +
          "</div>"
        ) : "") +
          "<p style='font-size:15px;color:#1B2E4B;margin-top:20px'>— Jen<br>Compass Business Solutions</p>" +
          "</div></div>";

        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": "Bearer " + process.env.RESEND_API_KEY },
          body: JSON.stringify({
            from: "Jen at Compass <" + (process.env.FROM_EMAIL || "reports@compassbizsolutions.com") + ">",
            to: [email],
            subject: "Your Profit Leak Snapshot is ready — " + snapshot_total_clean,
            html: emailHtml,
            text: "Hi " + fn2 + ", your snapshot is ready at fixkit.compassbizsolutions.com. Top leaks: " + snapshot_leaks.map(function(l){return l.name + " (" + l.range + ")";}).join(", ")
          })
        });
      } catch(emailErr) {
        console.error("Snapshot email failed:", emailErr.message);
        // Don't fail the whole request if email fails
      }
    }

    return res.status(200).json({ success: true });

  } catch(err) {
    console.error("generate-plan error:", err.message);
    return res.status(500).json({ error: "Failed", detail: err.message });
  }
};