/**
 * Vercel Serverless Function: /api/send-full-report
 *
 * The $399 Full DIY Package delivery function.
 *
 * Flow:
 *   1. Validates the token against Vercel KV (one final check)
 *   2. Calls Anthropic to generate the full 10-category diagnostic
 *   3. Generates a customized prioritized to-do list
 *   4. Sends email with report + all 10 Fix-It Guides + all 8 Process Doc templates
 *   5. Marks the token as used in KV
 *
 * ENVIRONMENT VARIABLES:
 *   KV_REST_API_URL        — auto-added by Vercel KV
 *   KV_REST_API_TOKEN      — auto-added by Vercel KV
 *   ANTHROPIC_API_KEY      — from console.anthropic.com
 *   RESEND_API_KEY         — from resend.com
 *   FROM_EMAIL             — reports@compassbizsolutions.com
 *
 * NOTE ON ATTACHMENTS:
 *   Resend supports attachments via base64-encoded content.
 *   The guide and template files need to be accessible at build time.
 *   See ATTACHMENT SETUP section below for how to add your actual files.
 *
 * ATTACHMENT SETUP:
 *   1. Add your 18 .docx files to /public/downloads/ in your repo
 *   2. They'll be accessible at runtime via the filesystem
 *   3. The readFileSync calls below will load them automatically
 *   4. File names must match exactly what's listed in GUIDE_FILES / DOC_FILES
 */

const { createClient } = require("@vercel/kv");
const { Resend }       = require("resend");
const fs               = require("fs");
const path             = require("path");

// ── File manifest ────────────────────────────────────────────────────────────
const GUIDE_FILES = [
  { name: "Guide 1 — The Pricing Leak Fix.docx",           file: "CBS_Guide_1_The_Pricing_Leak_Fix.docx" },
  { name: "Guide 2 — The Scheduling Black Hole.docx",      file: "CBS_Guide_2_The_Scheduling_Black_Hole.docx" },
  { name: "Guide 3 — The Employee Cost Leak.docx",         file: "CBS_Guide_3_The_Employee_Cost_Leak.docx" },
  { name: "Guide 4 — The Recurring Revenue Gap.docx",      file: "CBS_Guide_4_The_Recurring_Revenue_Gap.docx" },
  { name: "Guide 5 — The Estimate to Invoice Leak.docx",   file: "CBS_Guide_5_The_Estimate_to_Invoice_Leak.docx" },
  { name: "Guide 6 — The Cash Flow Blind Spot.docx",       file: "CBS_Guide_6_The_Cash_Flow_Blind_Spot.docx" },
  { name: "Guide 7 — The Customer Churn Leak.docx",        file: "CBS_Guide_7_The_Customer_Churn_Leak.docx" },
  { name: "Guide 8 — The Materials Markup Fix.docx",       file: "CBS_Guide_8_The_Materials_Markup_Fix.docx" },
  { name: "Guide 9 — The Admin Time Drain.docx",           file: "CBS_Guide_9_The_Admin_Time_Drain.docx" },
  { name: "Guide 10 — The Vehicles & Parts Leak.docx",     file: "CBS_Guide_10_The_Vehicles___Parts_Leak.docx" },
];

const DOC_FILES = [
  { name: "Template — Truck Restocking Checklist.docx",          file: "CBS_Truck_Restocking_Checklist.docx" },
  { name: "Template — Appointment Confirmation Process.docx",    file: "CBS_Appointment_Confirmation_Process.docx" },
  { name: "Template — Employee Handbook.docx",                   file: "CBS_Employee_Handbook.docx" },
  { name: "Template — Job Completion & Invoicing Process.docx",  file: "CBS_Job_Completion_Invoicing_Process.docx" },
  { name: "Template — Customer Follow-Up Sequence.docx",         file: "CBS_Customer_Followup_Sequence.docx" },
  { name: "Template — Parts & Supply Ordering Process.docx",     file: "CBS_Parts_Supply_Ordering_Process.docx" },
  { name: "Template — New Hire Training Documentation.docx",     file: "CBS_New_Hire_Training_Documentation.docx" },
  { name: "Template — Safety & Job Site Procedures.docx",        file: "CBS_Safety_Job_Site_Procedures.docx" },
];

const DOWNLOADS_DIR = path.join(process.cwd(), "public", "downloads");

function loadAttachments(fileList) {
  const attachments = [];
  for (const f of fileList) {
    const filePath = path.join(DOWNLOADS_DIR, f.file);
    try {
      const content = fs.readFileSync(filePath).toString("base64");
      attachments.push({
        filename: f.name,
        content,
        contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      });
    } catch (e) {
      console.warn(`Could not load attachment: ${f.file} — ${e.message}`);
      // Skip missing files rather than failing the whole email
    }
  }
  return attachments;
}

// ── AI prompt ────────────────────────────────────────────────────────────────
function buildFullSystem(name, company, location, trade) {
  const biz = company || "their business";
  const loc  = location ? ` in ${location}` : "";
  const tradeType = trade || "service business";

  // Trade-specific context injected into the prompt
  const tradeContext = {
    "Electrical": {
      jobTypes: "service calls, panel upgrades, new construction rough-in, troubleshooting, EV charger installs",
      partsChallenges: "breakers, wire, conduit, fixtures — often sourced from multiple suppliers mid-job",
      schedulingIssues: "permit delays, inspection scheduling, multi-day jobs that disrupt weekly booking",
      pricingPitfalls: "flat-rate vs T&M confusion, undercharging on troubleshooting time, not billing travel",
      recurringOpportunities: "annual safety inspections, whole-home surge protection agreements, panel maintenance contracts",
      cashFlowIssues: "large commercial jobs with net-30 billing, holding deposits on materials",
      employeeIssues: "apprentice productivity, journeyman licensing, OSHA compliance documentation",
      retentionOpportunities: "annual whole-home electrical checkups, generator maintenance, smoke detector replacement programs"
    },
    "Plumbing": {
      jobTypes: "drain cleaning, water heater installs, leak repair, remodels, emergency service calls",
      partsChallenges: "pipe fittings, fixtures, water heaters — high-ticket items that tie up truck inventory",
      schedulingIssues: "emergency calls disrupting booked schedule, multi-day repipe jobs",
      pricingPitfalls: "underpricing emergency premiums, not charging for diagnostic time, flat-rate gaps on remodels",
      recurringOpportunities: "annual water heater flush/inspection programs, drain maintenance agreements, backflow testing contracts",
      cashFlowIssues: "large remodel jobs, material costs front-loaded before milestone payments",
      employeeIssues: "license requirements by state, helper productivity, cross-training on drain vs service work",
      retentionOpportunities: "annual plumbing inspections, water quality testing, fixture upgrade programs"
    },
    "HVAC": {
      jobTypes: "seasonal tune-ups, equipment installs, emergency repairs, duct cleaning, IAQ assessments",
      partsChallenges: "refrigerant management, compressor cores, blower motors — expensive and time-sensitive",
      schedulingIssues: "extreme seasonal demand spikes, maintenance agreement scheduling in shoulder season",
      pricingPitfalls: "undercharging on refrigerant, not billing diagnostic time, flat install prices that miss complexity",
      recurringOpportunities: "maintenance agreements are the gold standard — spring AC and fall heat tune-ups on contract",
      cashFlowIssues: "equipment costs on installs, seasonal revenue concentration",
      employeeIssues: "EPA 608 certification, NATE certification, technician shortage, seasonal staffing",
      retentionOpportunities: "maintenance agreements, filter subscription programs, IAQ upsell on every tune-up"
    },
    "Landscaping": {
      jobTypes: "mowing, cleanups, planting, hardscaping, irrigation, snow removal",
      partsChallenges: "mulch, plants, sod — perishable materials with weather-dependent demand",
      schedulingIssues: "weather disruptions, seasonal compression, crew routing inefficiency",
      pricingPitfalls: "underpricing maintenance contracts, not adjusting for fuel/material cost increases, giving away design time",
      recurringOpportunities: "weekly/bi-weekly maintenance contracts are the foundation — stack snow removal, aeration, overseeding",
      cashFlowIssues: "seasonal revenue, material front-loading in spring, equipment financing",
      employeeIssues: "seasonal workforce, H-2B visa management, bilingual communication, equipment operation training",
      retentionOpportunities: "annual lawn care programs, spring/fall cleanup packages, holiday lighting installs"
    },
    "Pool & Spa": {
      jobTypes: "weekly service, openings/closings, equipment repair, replastering, new construction",
      partsChallenges: "chemical inventory management, pump/motor/heater parts, variable demand by weather",
      schedulingIssues: "route density, chemical service timing, emergency equipment calls disrupting route",
      pricingPitfalls: "underpricing chemical service, not charging for extra labor on green pools, flat opening/closing prices",
      recurringOpportunities: "weekly chemical service routes are extremely sticky recurring revenue — protect and grow them",
      cashFlowIssues: "spring equipment purchases, seasonal concentration, construction payment milestones",
      employeeIssues: "CPO certification, chemical handling training, route tech consistency",
      retentionOpportunities: "annual service agreements, equipment protection plans, winterization programs"
    },
    "General Contracting": {
      jobTypes: "remodels, additions, new construction, project management, subcontractor coordination",
      partsChallenges: "material procurement timing, subcontractor scheduling, change order management",
      schedulingIssues: "permit delays, inspection scheduling, subcontractor availability, weather",
      pricingPitfalls: "change orders not captured, underestimating labor hours, not accounting for project management time",
      recurringOpportunities: "maintenance contracts for commercial clients, preferred contractor agreements, property management relationships",
      cashFlowIssues: "large material front-loads, milestone billing delays, retainage on commercial jobs",
      employeeIssues: "licensed subcontractor management, OSHA compliance, documentation for permit inspections",
      retentionOpportunities: "annual maintenance programs for past remodel clients, referral programs, commercial repeat relationships"
    }
  };

  const ctx = tradeContext[tradeType] || {
    jobTypes: "service calls and project work",
    partsChallenges: "inventory management and supplier coordination",
    schedulingIssues: "appointment management and job scheduling",
    pricingPitfalls: "underpricing and untracked overhead",
    recurringOpportunities: "maintenance agreements and service contracts",
    cashFlowIssues: "invoice timing and material costs",
    employeeIssues: "training, standards, and accountability",
    retentionOpportunities: "follow-up systems and loyalty programs"
  };

  return `You are a senior business consultant who specializes in ${tradeType} companies. You have deep operational expertise in this specific trade. You understand the real-world challenges of running a ${tradeType} business including: ${ctx.jobTypes}. You know the specific parts and inventory challenges (${ctx.partsChallenges}), the scheduling pressure points (${ctx.schedulingIssues}), where owners typically underprice (${ctx.pricingPitfalls}), the best recurring revenue opportunities (${ctx.recurringOpportunities}), the cash flow dynamics (${ctx.cashFlowIssues}), the employee management realities (${ctx.employeeIssues}), and the highest-value customer retention strategies (${ctx.retentionOpportunities}).

You are reviewing a paid $399 full diagnostic for ${name || "the owner"} at ${biz}${loc}. Give everything — hold nothing back. Use trade-specific language, examples, and fixes that are realistic for a ${tradeType} business of their size. Do NOT give generic small business advice. Every recommendation must be grounded in how ${tradeType} businesses actually operate.

Use EXACTLY these tags in order:

[SUMMARY]
4–5 sentences. Address them by name. Honest, direct assessment of what their numbers reveal. Use ${tradeType}-specific context. What this means for their day-to-day life and take-home pay.

[LEAK_BREAKDOWN]
For each of the 5 analyzed categories, use this exact format:
CATEGORY: [Name]
ESTIMATED LEAK: $[amount]/year
WHY IT'S HAPPENING: [2 sentences — specific to their numbers AND specific to how this leak shows up in ${tradeType} businesses]
THE FIX: [3–4 concrete steps, written for a ${tradeType} business owner, that they can start this week]
POTENTIAL RECOVERY: $[reduced amount]/year if fixed

[UNANALYZED_CATEGORIES]
List the 5 categories not covered by this scan. For each, give a realistic dollar range for a ${tradeType} business their size and a one-sentence explanation of where this leak typically hides in ${tradeType} operations specifically.

[CURRENT_VS_POTENTIAL]
Current confirmed leak (5 categories): $[X]/year
Estimated full leak (all 10 categories): $[Y]–$[Z]/year
Fix 50% of confirmed leaks: +$[A]/year | +$[B]/month
Fix 80% of confirmed leaks: +$[C]/year | +$[D]/month

[PRIORITY_ACTION_PLAN]
Numbered list of 10 priorities. Easiest, highest-impact wins first. Written specifically for a ${tradeType} business.
For each:
PRIORITY [N]: [Action title]
WHY NOW: [One sentence — grounded in ${tradeType} business reality]
HOW LONG: [Realistic time estimate]
WHICH GUIDE: [Guide number and name from the Fix-It Guide Bundle]

[QUICK_WINS]
3 things they can do this week at zero cost. Specific to a ${tradeType} business. Numbered. No fluff.

[CLOSING]
2 sentences. What to do first and exactly why it matters for their specific ${tradeType} operation.`;
}

// ── Email HTML ───────────────────────────────────────────────────────────────
function buildEmailHtml(firstName, bizName, bizLocation, tradeName, leakAmount, reportText, todoItems) {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 620px; margin: 0 auto; color: #3E4E63;">

      <!-- Header -->
      <div style="background: #1B2E4B; padding: 32px 36px; border-radius: 8px 8px 0 0;">
        <div style="font-size: 10px; color: rgba(255,255,255,0.35); letter-spacing: 3px; margin-bottom: 10px;">COMPASS BUSINESS SOLUTIONS — FULL DIY PACKAGE</div>
        <div style="font-size: 22px; font-weight: bold; color: #C8701A; line-height: 1.3;">Your Complete ${tradeName} Profit Leak Diagnostic</div>
        <div style="font-size: 13px; color: rgba(255,255,255,0.45); margin-top: 8px;">${bizName}${bizLocation} — Full 10-Category Analysis</div>
      </div>

      <!-- Body -->
      <div style="background: #F7F5F2; padding: 32px 36px; border-radius: 0 0 8px 8px; border: 1px solid #D8D4CD;">

        <p style="font-size: 15px; color: #1A2332; font-weight: 600; margin-top: 0;">Hi ${firstName},</p>
        <p style="color: #3E4E63; line-height: 1.7; margin-top: 0;">
          Your complete diagnostic is below, and all 18 files are attached — 10 Fix-It Guides and 8 Process Doc templates.
          Everything you need to find the leaks, understand what's causing them, and fix them yourself is in this email.
        </p>

        <!-- Leak callout -->
        <div style="background: #1B2E4B; border-radius: 10px; padding: 24px; text-align: center; margin: 0 0 24px;">
          <div style="font-size: 11px; color: rgba(255,255,255,0.35); letter-spacing: 3px; margin-bottom: 8px;">CONFIRMED ANNUAL PROFIT LEAK — 5 OF 10 CATEGORIES</div>
          <div style="font-size: 52px; font-weight: 900; color: #C8701A; line-height: 1;">${leakAmount}</div>
          <div style="font-size: 11px; color: rgba(255,255,255,0.35); margin-top: 8px;">Full 10-category estimate is in your diagnostic below.</div>
        </div>

        <!-- Full diagnostic -->
        <div style="background: white; border-radius: 8px; padding: 24px; margin-bottom: 20px; border: 1px solid #D8D4CD; white-space: pre-line; font-size: 13px; line-height: 1.85; color: #3E4E63;">
${reportText}
        </div>

        ${todoItems && todoItems.length ? `
        <!-- Prioritized to-do list -->
        <div style="background: white; border-left: 4px solid #1E6B45; border-radius: 0 8px 8px 0; padding: 20px 24px; margin-bottom: 20px; border-top: 1px solid #D8D4CD; border-right: 1px solid #D8D4CD; border-bottom: 1px solid #D8D4CD;">
          <div style="font-size: 11px; font-weight: bold; color: #1E6B45; letter-spacing: 2px; margin-bottom: 14px;">YOUR PERSONALIZED TO-DO LIST — START HERE</div>
          ${todoItems.map((item, i) => `
          <div style="display: flex; gap: 12px; margin-bottom: 12px; align-items: flex-start;">
            <div style="width: 24px; height: 24px; border-radius: 50%; background: #1E6B45; color: white; font-weight: bold; font-size: 11px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; margin-top: 1px;">${i + 1}</div>
            <div style="font-size: 13px; color: #3E4E63; line-height: 1.6;">${item}</div>
          </div>`).join("")}
        </div>` : ""}

        <!-- What's attached -->
        <div style="background: white; border-radius: 8px; padding: 20px 24px; margin-bottom: 20px; border: 1px solid #D8D4CD;">
          <div style="font-size: 11px; font-weight: bold; color: #3D6B9E; letter-spacing: 2px; margin-bottom: 12px;">WHAT'S ATTACHED — 18 FILES</div>
          <div style="font-size: 12px; color: #6B7A90; line-height: 2;">
            <strong style="color: #3E4E63;">10 Fix-It Guides</strong><br>
            Pricing Leak · Scheduling Black Hole · Employee Cost · Recurring Revenue · Estimate-to-Invoice · Cash Flow · Customer Churn · Materials Markup · Admin Time Drain · Vehicles & Parts
          </div>
          <div style="height: 1px; background: #E8E4DC; margin: 12px 0;"></div>
          <div style="font-size: 12px; color: #6B7A90; line-height: 2;">
            <strong style="color: #3E4E63;">8 Process Doc Templates</strong><br>
            Truck Restocking · Appointment Confirmation · Employee Handbook · Job Completion & Invoicing · Customer Follow-Up · Parts Ordering · New Hire Training · Safety & Job Site
          </div>
        </div>

        <!-- Need more help -->
        <div style="background: #1B2E4B; border-radius: 8px; padding: 20px 24px; margin-bottom: 24px; text-align: center;">
          <div style="font-size: 13px; color: rgba(255,255,255,0.6); margin-bottom: 12px; line-height: 1.6;">
            Want us to build these systems for you instead?<br>We scope the work first — no commitment.
          </div>
          <a href="https://calendly.com/jvoiselle612-s9gb/free-scoping-call" style="display: inline-block; background: #C8701A; color: white; font-weight: bold; font-size: 13px; padding: 10px 24px; border-radius: 7px; text-decoration: none;">Book a Free Scoping Call →</a>
        </div>

        <p style="font-size: 13px; color: #6B7A90; margin-bottom: 4px;">Questions? Reply to this email — I read every one.</p>
        <p style="margin: 0; color: #3E4E63; font-size: 13px;">— Compass Business Solutions</p>
      </div>

      <!-- Footer -->
      <div style="text-align: center; padding: 16px; font-size: 11px; color: #A0ABBE;">
        Compass Business Solutions &nbsp;·&nbsp; compassbizsolutions.com<br>
        You're receiving this because you purchased the Full DIY Package.
      </div>

    </div>
  `;
}

// ── Handler ──────────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin",  "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")   return res.status(405).json({ error: "Method not allowed" });

  try {
    const { token, email, name, company, location, trade, total, bizSummary } = req.body;

    if (!token || !email || !bizSummary) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // ── 1. Final token validation ────────────────────────────────────────────
    const kv = createClient({
      url:   process.env.KV_REST_API_URL,
      token: process.env.KV_REST_API_TOKEN,
    });

    const tokenKey = `scan_token:${token}`;
    const record   = await kv.get(tokenKey);

    if (!record)       return res.status(403).json({ error: "Token not found or expired" });
    if (record.used)   return res.status(403).json({ error: "Token already used" });
    if (record.email.toLowerCase() !== email.toLowerCase()) {
      return res.status(403).json({ error: "Email mismatch" });
    }

    // ── 2. Generate full AI report ───────────────────────────────────────────
    const system = buildFullSystem(name, company, location, trade);
    const prompt = `Name:${name||"Owner"}\nCompany:${company||"Unknown"}\nLocation:${location||"Unknown"}\nTrade:${trade||"Service Business"}\n${bizSummary}`;

    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type":      "application/json",
        "x-api-key":         process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model:      "claude-sonnet-4-20250514",
        max_tokens: 4000,
        system,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!anthropicRes.ok) {
      const err = await anthropicRes.text();
      console.error("Anthropic error:", err);
      return res.status(500).json({ error: "AI generation failed", detail: err });
    }

    const aiData     = await anthropicRes.json();
    const reportText = aiData.content?.map(b => b.text || "").join("") || "";

    // ── 3. Parse priority action plan into to-do list ────────────────────────
    const todoSection = reportText.match(/\[PRIORITY_ACTION_PLAN\]([\s\S]*?)(?=\[|$)/)?.[1]?.trim() || "";
    const todoItems   = todoSection
      .split(/PRIORITY \d+:/i)
      .map(s => s.trim())
      .filter(Boolean)
      .map(s => s.split("\n")[0].trim()) // Just the action title line
      .filter(Boolean);

    // ── 4. Load file attachments ─────────────────────────────────────────────
    const guideAttachments = loadAttachments(GUIDE_FILES);
    const docAttachments   = loadAttachments(DOC_FILES);
    const allAttachments   = [...guideAttachments, ...docAttachments];

    console.log(`Loaded ${allAttachments.length} of 18 attachments`);

    // ── 5. Send email ────────────────────────────────────────────────────────
    const resend      = new Resend(process.env.RESEND_API_KEY);
    const firstName   = name || "there";
    const bizName     = company || "your business";
    const bizLocation = location ? ` — ${location}` : "";
    const tradeName   = trade || "Service Business";
    const leakAmount  = total ? `$${Math.round(total).toLocaleString()}` : "significant";

    await resend.emails.send({
      from:        process.env.FROM_EMAIL || "reports@compassbizsolutions.com",
      to:          email,
      subject:     `Your Complete ${tradeName} Profit Leak Diagnostic — ${bizName} — Full Analysis Inside`,
      html:        buildEmailHtml(firstName, bizName, bizLocation, tradeName, leakAmount, reportText, todoItems),
      attachments: allAttachments,
    });

    // ── 6. Mark token as used ────────────────────────────────────────────────
    await kv.set(tokenKey, { ...record, used: true, usedAt: Date.now() }, { ex: 60 * 60 * 72 });

    console.log(`Full report sent and token marked used for ${email}`);
    return res.status(200).json({ success: true, reportText, todoItems });

  } catch (err) {
    console.error("send-full-report error:", err);
    return res.status(500).json({ error: "Failed to generate or send report", detail: err.message });
  }
};
