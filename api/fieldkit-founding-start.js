/**
 * /api/fieldkit-founding-start
 * Step 1 of reserving a FieldKit founding spot, before Stripe:
 * POST { plan, name, biz, email, phone, trade, techs }
 *   -> saves fieldkit:started:<email> (+ fieldkit:ref:<ref> -> email)
 *   -> returns { url } : the Stripe Payment Link with their email prefilled and
 *      client_reference_id=<ref>, so the FixKit Stripe webhook can match the
 *      payment back to these answers even if they change the email at checkout.
 * Anyone who starts but never pays shows in the admin as "Started, didn't pay".
 */
const crypto = require("crypto");

const LINKS = {
  deposit: { url: "https://buy.stripe.com/28E7sEckcbIgaSPgbYdZ60k", label: "$99 Founding Reservation" },
  base:    { url: "https://buy.stripe.com/00w4gsac48w49OL6BodZ60l", label: "Base — 2027 prepaid ($790)" },
  pro:     { url: "https://buy.stripe.com/bJedR21FyaEc4ur1h4dZ60m", label: "Pro — 2027 prepaid ($1,090)" },
  modules: { url: "https://buy.stripe.com/8x25kw2JCfYw1if4tgdZ60n", label: "Pro + Modules — 2027 prepaid ($1,490)" },
};

function kv() {
  return {
    url: process.env.lime_KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL,
    token: process.env.lime_KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN,
  };
}
async function getFromKV(key) {
  const { url, token } = kv();
  const r = await fetch(url + "/get/" + encodeURIComponent(key), { headers: { Authorization: "Bearer " + token } });
  const d = await r.json();
  try { return d.result ? JSON.parse(d.result) : null; } catch (e) { return null; }
}
async function saveToKV(key, value) {
  const { url, token } = kv();
  await fetch(url + "/set/" + encodeURIComponent(key), {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify(value),
  });
}
const emailKey = e => String(e || "").toLowerCase().trim().replace(/[^a-z0-9@._-]/g, "");
const clean = (v, max) => String(v == null ? "" : v).replace(/[<>]/g, "").trim().slice(0, max || 160);

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const b = req.body || {};
  const link = LINKS[b.plan];
  if (!link) return res.status(400).json({ error: "Pick a plan first." });
  const email = String(b.email || "").toLowerCase().trim();
  const f = { name: clean(b.name, 120), biz: clean(b.biz), phone: clean(b.phone, 40), trade: clean(b.trade, 80), techs: clean(b.techs, 20) };
  if (!f.name || !f.biz || !f.phone || !f.trade || !f.techs || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return res.status(400).json({ error: "Fill in every field so Jen can reach you." });
  }

  const ref = "fk_" + crypto.randomBytes(9).toString("hex");
  const pay = link.url + "?prefilled_email=" + encodeURIComponent(email) + "&client_reference_id=" + ref;
  try {
    const key = "fieldkit:started:" + emailKey(email);
    const prior = await getFromKV(key);
    await saveToKV(key, Object.assign({}, prior || {}, f, {
      email, plan: b.plan, plan_label: link.label, ref,
      attribution: (prior && prior.attribution) || (b.attribution && typeof b.attribution === "object" ? b.attribution : null),
      started_at: (prior && prior.started_at) || new Date().toISOString(),
      last_started_at: new Date().toISOString(),
    }));
    await saveToKV("fieldkit:ref:" + ref, { email });
  } catch (e) {
    // Never block a paying customer: send them on to Stripe anyway
    console.error("fieldkit-founding-start save failed:", e.message);
  }
  return res.status(200).json({ url: pay });
};
