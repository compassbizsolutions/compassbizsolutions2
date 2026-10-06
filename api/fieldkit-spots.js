/**
 * /api/fieldkit-spots
 * How many FieldKit Founding Member spots are left. The FixKit Stripe webhook
 * adds each founding purchase to "fieldkit:founding:<email>" and keeps the
 * count in "fieldkit:founding:count" (same Upstash database as this site).
 */
const TOTAL = 15;

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "public, max-age=60");
  const url = process.env.lime_KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.lime_KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  let taken = 0;
  try {
    if (url && token) {
      const r = await fetch(url + "/get/" + encodeURIComponent("fieldkit:founding:count"), { headers: { Authorization: "Bearer " + token } });
      const d = await r.json();
      taken = parseInt(d.result, 10) || 0;
    }
  } catch (e) {
    return res.status(503).json({ error: "unavailable" });
  }
  return res.status(200).json({ total: TOTAL, taken, left: Math.max(0, TOTAL - taken) });
};
