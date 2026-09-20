/**
 * /api/reviewkit-onboarding-save
 * POST { businessId, businessName, tone, negativeReviewPolicy, signoffStyle, customInstruction }
 * Saves the onboarding form (reviewkit/onboarding.html) — the real business name and the
 * tone-quiz answers that were previously left as placeholders by the checkout webhook.
 *
 * Upserts tone_profiles (unique on business_id, so this works whether the webhook already
 * inserted a default row or not) rather than assuming one exists.
 */

const ALLOWED_TONES = ["friendly", "professional", "warm"];
const ALLOWED_POLICIES = ["apologize_and_offer_fix", "defer_to_contact_us", "custom"];

async function supabaseRequest(path, options) {
  const base = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not configured");
  const res = await fetch(`${base}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: key,
      Authorization: "Bearer " + key,
      "Content-Type": "application/json",
      ...(options && options.headers)
    }
  });
  if (!res.ok) {
    throw new Error(`Supabase ${(options && options.method) || "GET"} ${path} failed (${res.status}): ${await res.text()}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { businessId, businessName, tone, negativeReviewPolicy, signoffStyle, customInstruction } = req.body || {};

    if (!businessId || !businessName || !businessName.trim()) {
      return res.status(400).json({ error: "Business name is required." });
    }
    const safeTone = ALLOWED_TONES.includes(tone) ? tone : "friendly";
    const safePolicy = ALLOWED_POLICIES.includes(negativeReviewPolicy) ? negativeReviewPolicy : "apologize_and_offer_fix";

    await supabaseRequest(`businesses?id=eq.${businessId}`, {
      method: "PATCH",
      body: JSON.stringify({ name: businessName.trim(), updated_at: new Date().toISOString() })
    });

    // Upsert on the tone_profiles.business_id unique constraint — works whether the
    // checkout webhook already created a default row or not. on_conflict must name that
    // constraint's column for PostgREST to treat this as an update rather than erroring
    // on the duplicate key.
    await supabaseRequest("tone_profiles?on_conflict=business_id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify({
        business_id: businessId,
        tone: safeTone,
        negative_review_policy: safePolicy,
        custom_instruction: safePolicy === "custom" ? (customInstruction || "").trim() || null : null,
        signoff_style: (signoffStyle || "").trim() || null,
        updated_at: new Date().toISOString()
      })
    });

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("reviewkit-onboarding-save error:", err.message);
    return res.status(500).json({ error: "Couldn't save that — please try again or email support@compassbizsolutions.com." });
  }
};
