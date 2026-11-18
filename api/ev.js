/**
 * /api/ev — counts a step someone took on the site (no personal info).
 * track.js sends {e, src, p} with sendBeacon. Counts land in KV hashes by day:
 *   ev:<YYYY-MM-DD>     field <event>           → how many times
 *   evsrc:<YYYY-MM-DD>  field <source>|<event>  → for the steps that matter most
 * Sam (the weekly marketing review in the admin) reads these to show where
 * people drop off between a post click and a sign-up.
 */
const ALLOWED = /^(visitor|view:[a-z0-9\/_-]{1,50}|check_(start|q\d{1,2}|email|submit|results)|bizcheck_(start|q\d{1,2}|email|submit|results)|buy_click(:[a-z0-9_-]{1,30})?|call_click|course_click|fieldkit_click|reviewkit_click)$/;
const KEY_EVENTS = /^(visitor|check_start|check_results|bizcheck_start|bizcheck_results|buy_click|call_click)/;
const BOT = /bot|crawl|spider|slurp|preview|facebookexternalhit|headless|lighthouse|monitor/i;

function kv() {
  return {
    url: process.env.lime_KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL,
    token: process.env.lime_KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN,
  };
}
async function kvCall(path) {
  const { url, token } = kv();
  if (!url || !token) return null;
  const r = await fetch(url + path, { method: "POST", headers: { Authorization: "Bearer " + token } });
  return (await r.json()).result;
}
async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") { try { return JSON.parse(req.body); } catch (e) { return {}; } }
  const raw = await new Promise(resolve => {
    let d = ""; req.on("data", c => { d += c; if (d.length > 2000) req.destroy(); }); req.on("end", () => resolve(d)); req.on("error", () => resolve(""));
  });
  try { return JSON.parse(raw || "{}"); } catch (e) { return {}; }
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).end();
  try {
    const host = String(req.headers.host || "");
    if (!/compassbizsolutions\.com$/.test(host) && !process.env.EV_ANY_HOST) return res.status(204).end();
    if (BOT.test(String(req.headers["user-agent"] || ""))) return res.status(204).end();
    const b = await readBody(req);
    const e = String(b.e || "").toLowerCase().slice(0, 60);
    if (!ALLOWED.test(e)) return res.status(204).end();
    const src = String(b.src || "direct").toLowerCase().replace(/[^a-z0-9._-]/g, "").slice(0, 40) || "direct";
    const day = new Date().toISOString().slice(0, 10);
    const ttl = 60 * 60 * 24 * 400;
    const jobs = [
      kvCall("/hincrby/" + encodeURIComponent("ev:" + day) + "/" + encodeURIComponent(e) + "/1"),
      kvCall("/expire/" + encodeURIComponent("ev:" + day) + "/" + ttl),
    ];
    if (KEY_EVENTS.test(e)) {
      jobs.push(kvCall("/hincrby/" + encodeURIComponent("evsrc:" + day) + "/" + encodeURIComponent(src + "|" + e) + "/1"));
      jobs.push(kvCall("/expire/" + encodeURIComponent("evsrc:" + day) + "/" + ttl));
    }
    await Promise.all(jobs);
  } catch (err) { /* counting never breaks the page */ }
  return res.status(204).end();
};
