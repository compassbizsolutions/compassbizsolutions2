/**
 * /api/site-ai
 * AI for the website's public pages: the FieldKit demo (AI quoting, route
 * planning, receipt scanning, office and tech assistants) and the DeskKit
 * tools' "revise" buttons (invoices, payroll, letters). These used to call
 * Anthropic straight from the browser with no key, so they all failed. They now post the same request body
 * here; this adds the key server-side and returns Anthropic's response as-is,
 * so the page reads data.content[0].text exactly as before.
 *
 * Public pages, so: capped output, capped conversation length, and a daily
 * limit per visitor (IP) kept in Upstash.
 */
const MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 4000;
const DAILY_LIMIT = 60;

function kv() {
  return {
    url: process.env.lime_KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL,
    token: process.env.lime_KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN,
  };
}
async function overLimit(ip) {
  const { url, token } = kv();
  if (!url || !token) return false;
  try {
    const key = "site_ai:" + new Date().toISOString().slice(0, 10) + ":" + ip;
    const r = await fetch(url + "/incr/" + encodeURIComponent(key), { method: "POST", headers: { Authorization: "Bearer " + token } });
    const n = (await r.json()).result || 0;
    if (n === 1) fetch(url + "/expire/" + encodeURIComponent(key) + "/90000", { method: "POST", headers: { Authorization: "Bearer " + token } }).catch(() => {});
    return n > DAILY_LIMIT;
  } catch (e) { return false; }
}
const fail = (res, code, msg) => res.status(code).json({ type: "error", error: { type: "demo_error", message: msg } });

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, anthropic-version, anthropic-dangerous-direct-browser-access");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return fail(res, 405, "Method not allowed");
  if (!process.env.ANTHROPIC_API_KEY) return fail(res, 500, "AI isn't set up on this site yet.");

  const b = req.body || {};
  const messages = Array.isArray(b.messages) ? b.messages.slice(-30) : [];
  if (!messages.length || messages.some(m => !m || (m.role !== "user" && m.role !== "assistant"))) return fail(res, 400, "Bad request");
  if (messages[0].role !== "user") messages.shift();
  if (!messages.length) return fail(res, 400, "Bad request");

  const ip = String(req.headers["x-forwarded-for"] || req.headers["x-real-ip"] || "unknown").split(",")[0].trim().slice(0, 64);
  if (await overLimit(ip)) return fail(res, 429, "The demo's AI has hit its daily limit for you. Try again tomorrow, or book a call and Jen will walk you through it live.");

  const body = {
    model: MODEL,
    max_tokens: Math.min(Math.max(parseInt(b.max_tokens, 10) || 1000, 100), MAX_TOKENS),
    messages,
  };
  if (typeof b.system === "string" && b.system.trim()) body.system = b.system.slice(0, 20000);

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify(body),
    });
    const d = await r.json();
    if (!r.ok) {
      console.error("site-ai anthropic error:", r.status, JSON.stringify(d).slice(0, 300));
      return fail(res, 502, "The AI didn't answer just now. Try again in a moment.");
    }
    return res.status(200).json(d);
  } catch (e) {
    console.error("site-ai error:", e.message);
    return fail(res, 502, "The AI didn't answer just now. Try again in a moment.");
  }
};
