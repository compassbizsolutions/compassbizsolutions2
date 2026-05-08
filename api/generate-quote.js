/**
 * /api/generate-quote
 * POST — AI analyzes work request and generates a quote
 * Called after work request is submitted
 */

const PACKAGES = [
  {
    id: "single_task",
    name: "Single Task Plan",
    price: 250,
    interval: "month",
    stripe_price_id: "STRIPE_SINGLE_TASK", // wire in when ready
    description: "One recurring task handled for you every week or month — start to finish. Best for ongoing needs like weekly reports, social posts, or regular data work.",
    covers: ["spreadsheet","data","report","summary","social","email","invoice","receipt","research","content","post","caption"],
    hours: "up to 3 hrs/task",
    turnaround: "delivered by your requested deadline",
    highlight: "Most Popular for recurring tasks"
  },
  {
    id: "small_biz_admin",
    name: "Small Business Admin",
    price: 450,
    interval: "month",
    stripe_price_id: "STRIPE_SMALL_BIZ_ADMIN",
    description: "Up to 5 hours of admin support per month across multiple task types. Perfect for small business owners who need a little help with everything — spreadsheets, emails, reports, social, and more.",
    covers: ["spreadsheet","data","report","summary","social","email","invoice","receipt","research","content","presentation","marketing","website"],
    hours: "up to 5 hrs/month",
    turnaround: "48-hour turnaround on most tasks",
    highlight: "Best Value for mixed needs"
  },
  {
    id: "full_admin",
    name: "Full Admin Support",
    price: 799,
    interval: "month",
    stripe_price_id: "STRIPE_FULL_ADMIN",
    description: "Unlimited task submissions with priority turnaround. Your dedicated business support — submit anything, anytime. We handle it so you can focus on running your business.",
    covers: ["all"],
    hours: "unlimited submissions",
    turnaround: "priority 24-hour turnaround",
    highlight: "Best for busy owners who need consistent support"
  }
];

const { AD_HOC_PRICING, COMPLEXITY_SIGNALS } = require("./pricing");

const COMPLEXITY_DESCRIPTIONS = {
  simple:   "Straightforward task, under 2 hours, minimal back and forth",
  standard: "Moderate scope, 2–5 hours, some coordination needed",
  complex:  "Custom work, 5+ hours, multiple rounds or strategy involved"
};

async function getFromKV(key) {
  const url   = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  try {
    const r = await fetch(url + "/get/" + encodeURIComponent(key), {
      headers: { Authorization: "Bearer " + token }
    });
    const d = await r.json();
    return d.result ? JSON.parse(d.result) : null;
  } catch(e) { return null; }
}

async function saveToKV(key, value) {
  const url   = process.env.KV_REST_API_URL;
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
  const session = await getFromKV("portal_session:" + token)
               || await getFromKV("session:" + token);
  return session ? session.email : null;
}

function emailKey(email) {
  return email.toLowerCase().trim().replace(/[^a-z0-9@._-]/g, "");
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const authHeader = req.headers.authorization || "";
    const sessionToken = authHeader.replace("Bearer ", "").trim();
    const email = await validateSession(sessionToken);
    if (!email) return res.status(401).json({ error: "Unauthorized" });

    const { request_id, service_type, description, priority, slide_count } = req.body || {};
    if (!service_type || !description) return res.status(400).json({ error: "Service type and description required" });

    // Call Claude to analyze the request and determine complexity + recommendation
    const pricingRow = AD_HOC_PRICING[service_type] || { simple: 79, standard: 149, complex: 299 };
    const complexSignals = COMPLEXITY_SIGNALS;
    const aiPrompt = `You are a business operations consultant at Compass Business Solutions. Analyze this work request and determine:
1. Complexity level (simple/standard/complex) based on scope
2. Whether a monthly package would serve them better than ad hoc
3. A personalized quote explanation

SERVICE TYPE: ${service_type}
DESCRIPTION: ${description}
PRIORITY: ${priority || "normal"}

AD HOC PRICING FOR THIS SERVICE (use these exact prices):
Simple: $${pricingRow.simple} | Standard: $${pricingRow.standard} | Complex: $${pricingRow.complex}

COMPLEXITY SIGNALS — words that suggest simple: ${complexSignals.simple.join(', ')}
COMPLEXITY SIGNALS — words that suggest complex: ${complexSignals.complex.join(', ')}
If no strong signals, default to Standard.

MONTHLY PACKAGES:
- Single Task Plan ($250/mo): One recurring task weekly or monthly
- Small Business Admin ($450/mo): Up to 5 hours/month across multiple tasks
- Full Admin Support ($799/mo): Unlimited submissions, priority turnaround

Respond with ONLY valid JSON in this exact format:
{
  "complexity": "simple|standard|complex",
  "complexity_reason": "one sentence explaining why",
  "ad_hoc_price": 150,
  "recommend_package": true|false,
  "recommended_package_id": "single_task|small_biz_admin|full_admin|null",
  "package_reason": "one sentence on why the package makes sense for them (or null)",
  "savings_message": "e.g. A package saves you $X vs ad hoc over 3 months (or null)",
  "quote_summary": "2-3 sentences personalizing the quote to their specific request",
  "estimated_turnaround": "e.g. 2-3 business days",
  "is_recurring": true|false,
  "recurring_reason": "why this seems like a recurring need (or null)"
}`;

    const aiResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1000,
        messages: [{ role: "user", content: aiPrompt }]
      })
    });

    const aiData = await aiResponse.json();
    const aiText = aiData.content ? aiData.content.map(b => b.text || "").join("") : "";

    let analysis;
    try {
      const clean = aiText.replace(/```json|```/g, "").trim();
      analysis = JSON.parse(clean);
    } catch(e) {
      // Fallback if AI response isn't clean JSON
      analysis = {
        complexity: "standard",
        complexity_reason: "Based on the scope described",
        ad_hoc_price: AD_HOC_PRICING[service_type]?.standard || 200,
        recommend_package: false,
        recommended_package_id: null,
        package_reason: null,
        savings_message: null,
        quote_summary: "We can handle this for you. Review the quote below and accept to get started.",
        estimated_turnaround: "2-3 business days",
        is_recurring: false,
        recurring_reason: null
      };
    }

    // Build the full quote object
    let adHocPrice = (AD_HOC_PRICING[service_type] || {})[analysis.complexity] || analysis.ad_hoc_price || pricingRow.standard;

    // Handle per-unit overages (e.g. presentation slides over threshold)
    if (pricingRow.overage_rate && pricingRow.overage_threshold) {
      // Use explicit slide_count field first, fall back to parsing description
      const parsedFromDesc = parseInt((description || "").match(/(\d+)\s*slide/i)?.[1]) || 0;
      const resolvedCount  = slide_count || parsedFromDesc || 0;
      const basePrice      = (AD_HOC_PRICING[service_type] || {}).complex || pricingRow.complex;

      if (resolvedCount === 0) {
        // No slide count provided — flag for manual confirmation
        analysis.pending_info    = true;
        analysis.pending_message = "Slide count not provided. Please confirm the number of slides before approving this quote. Base rate is $" + basePrice + " for up to " + pricingRow.overage_threshold + " slides. Over " + pricingRow.overage_threshold + " slides = $" + pricingRow.overage_rate + " per additional slide.";
        analysis.quote_summary   = (analysis.quote_summary || "") + " NOTE: Slide count was not specified — this quote is pending your confirmation of the slide count before it is sent to the customer.";
      } else if (resolvedCount > pricingRow.overage_threshold) {
        const overageSlides = resolvedCount - pricingRow.overage_threshold;
        const overageFee    = overageSlides * pricingRow.overage_rate;
        adHocPrice          = basePrice + overageFee;
        analysis.overage_note = resolvedCount + " slides — base $" + basePrice + " + " + overageSlides + " slides over " + pricingRow.overage_threshold + " at $" + pricingRow.overage_rate + "/slide = $" + adHocPrice;
      } else if (resolvedCount > 0) {
        analysis.overage_note = resolvedCount + " slides — within the " + pricingRow.overage_threshold + "-slide threshold, flat rate applies.";
      }
    }
    const recommendedPackage = analysis.recommend_package && analysis.recommended_package_id
      ? PACKAGES.find(p => p.id === analysis.recommended_package_id)
      : null;

    const quote = {
      id: "quote_" + Date.now(),
      request_id,
      service_type,
      description,
      complexity:           analysis.complexity,
      complexity_reason:    analysis.complexity_reason,
      complexity_desc:      COMPLEXITY_DESCRIPTIONS[analysis.complexity],
      ad_hoc_price:         adHocPrice,
      recommend_package:    analysis.recommend_package,
      recommended_package:  recommendedPackage,
      package_reason:       analysis.package_reason,
      savings_message:      analysis.savings_message,
      quote_summary:        analysis.quote_summary,
      estimated_turnaround: analysis.estimated_turnaround,
      is_recurring:         analysis.is_recurring,
      pending_confirmation: analysis.pending_confirmation || null,
      recurring_reason:     analysis.recurring_reason,
      all_packages:         PACKAGES,
      status:               "pending",
      created_at:           new Date().toISOString(),
      expires_at:           new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    };

    // Save quote to KV
    const eKey = emailKey(email);
    const existing = await getFromKV("portal_quotes:" + eKey) || [];
    await saveToKV("portal_quotes:" + eKey, [quote, ...existing]);

    // Also save to admin quotes
    const adminQuotes = await getFromKV("admin_quotes") || [];
    await saveToKV("admin_quotes", [{ ...quote, customer_email: email }, ...adminQuotes]);

    // Send quote email to customer
    try {
      const packageSection = recommendedPackage ? `
        <div style="background:rgba(200,112,26,0.08);border:2px solid #C8701A;border-radius:8px;padding:20px;margin:16px 0;">
          <div style="font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#C8701A;margin-bottom:8px;">⭐ RECOMMENDED FOR YOU</div>
          <div style="font-size:18px;font-weight:800;color:#111E31;margin-bottom:4px;">${recommendedPackage.name} — $${recommendedPackage.price}/mo</div>
          <div style="font-size:13px;color:#5A7291;margin-bottom:8px;">${recommendedPackage.hours} · ${recommendedPackage.turnaround}</div>
          <div style="font-size:14px;color:#1B2E4B;margin-bottom:8px;">${recommendedPackage.description}</div>
          ${analysis.savings_message ? `<div style="font-size:13px;font-weight:600;color:#1E6B45;">${analysis.savings_message}</div>` : ""}
        </div>` : "";

      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + process.env.RESEND_API_KEY,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          from: "Compass Business Solutions <reports@compassbizsolutions.com>",
          to: email,
          subject: `Your Quote — ${service_type}`,
          html: `
          <div style="font-family:sans-serif;max-width:580px;margin:0 auto;background:#F4F7FC;">
            <div style="background:#111E31;padding:24px 28px;border-radius:8px 8px 0 0;">
              <div style="font-size:10px;letter-spacing:3px;color:#C8701A;text-transform:uppercase;font-weight:700;margin-bottom:4px;">Compass Business Solutions</div>
              <div style="font-size:22px;font-weight:900;color:#F4F7FC;text-transform:uppercase;letter-spacing:1px;">Your Quote Is Ready</div>
            </div>
            <div style="background:white;padding:28px;border:1px solid #C8D6E8;border-top:none;">
              <p style="font-size:15px;color:#1B2E4B;line-height:1.6;">${analysis.quote_summary}</p>
              
              <div style="background:#F4F7FC;border-radius:8px;padding:18px;margin:16px 0;">
                <div style="font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#8aa5c0;margin-bottom:8px;">REQUEST DETAILS</div>
                <div style="font-size:14px;color:#1B2E4B;margin-bottom:4px;"><strong>Service:</strong> ${service_type}</div>
                <div style="font-size:14px;color:#1B2E4B;margin-bottom:4px;"><strong>Complexity:</strong> ${analysis.complexity.charAt(0).toUpperCase() + analysis.complexity.slice(1)} — ${analysis.complexity_reason}</div>
                <div style="font-size:14px;color:#1B2E4B;"><strong>Estimated turnaround:</strong> ${analysis.estimated_turnaround}</div>
              </div>

              ${packageSection}

              <div style="border:1px solid #C8D6E8;border-radius:8px;padding:18px;margin:16px 0;">
                <div style="font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#8aa5c0;margin-bottom:8px;">AD HOC OPTION</div>
                <div style="font-size:28px;font-weight:900;color:#111E31;">$${adHocPrice}</div>
                <div style="font-size:13px;color:#5A7291;">One-time · ${COMPLEXITY_DESCRIPTIONS[analysis.complexity]}</div>
              </div>

              <div style="text-align:center;margin:24px 0;">
                <a href="https://www.compassbizsolutions.com/portal" style="background:#C8701A;color:white;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px;display:inline-block;">View & Accept Quote →</a>
              </div>
              <p style="font-size:12px;color:#8aa5c0;text-align:center;">Quote valid for 7 days. Questions? Reply to this email.</p>
            </div>
          </div>`
        })
      });

      // Notify Jen
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: "Bearer " + process.env.RESEND_API_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: "Compass Portal <reports@compassbizsolutions.com>",
          to: "reports@compassbizsolutions.com",
          subject: `Quote Generated — ${service_type} (${email})`,
          html: `<div style="font-family:sans-serif;max-width:500px;">
            <h2 style="color:#C8701A;">Quote Generated</h2>
            <p><strong>Customer:</strong> ${email}</p>
            <p><strong>Service:</strong> ${service_type}</p>
            <p><strong>Complexity:</strong> ${analysis.complexity}</p>
            <p><strong>Ad hoc price:</strong> $${adHocPrice}</p>
            <p><strong>Package recommended:</strong> ${recommendedPackage ? recommendedPackage.name + " ($" + recommendedPackage.price + "/mo)" : "No"}</p>
            <p><strong>Quote summary:</strong> ${analysis.quote_summary}</p>
          ${analysis.pending_confirmation ? `<p style="background:#fff3cd;border:1px solid #ffc107;padding:10px;border-radius:4px;color:#856404;"><strong>⚠️ ACTION NEEDED:</strong> ${analysis.pending_confirmation}</p>` : ""}
          </div>`
        })
      });
    } catch(emailErr) {
      console.error("Quote email error:", emailErr.message);
    }

    return res.status(200).json({ success: true, quote });

  } catch(err) {
    console.error("generate-quote error:", err.message);
    return res.status(500).json({ error: "Failed to generate quote" });
  }
};
