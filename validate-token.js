/**
 * Vercel Serverless Function: /api/validate-token
 *
 * Called by the browser after Paddle redirects back with ?token=&email=
 * Checks Vercel KV that the token:
 *   - Exists
 *   - Has not been used
 *   - Belongs to the provided email
 *
 * Returns { valid: true, name, email } or { valid: false, reason }
 *
 * Does NOT mark the token as used — that happens in /api/send-full-report
 * after the report is successfully generated and emailed.
 *
 * ENVIRONMENT VARIABLES (auto-added by Vercel KV provisioning):
 *   KV_REST_API_URL
 *   KV_REST_API_TOKEN
 */

const { createClient } = require("@vercel/kv");

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin",  "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")   return res.status(405).json({ error: "Method not allowed" });

  try {
    const { token, email } = req.body;

    if (!token || !email) {
      return res.status(400).json({ valid: false, reason: "Missing token or email" });
    }

    const kv = createClient({
      url:   process.env.KV_REST_API_URL,
      token: process.env.KV_REST_API_TOKEN,
    });

    const tokenKey = `scan_token:${token}`;
    const record = await kv.get(tokenKey);

    if (!record) {
      return res.status(200).json({ valid: false, reason: "Token not found or expired" });
    }

    if (record.used) {
      return res.status(200).json({ valid: false, reason: "Token already used" });
    }

    if (record.email.toLowerCase() !== email.toLowerCase()) {
      return res.status(200).json({ valid: false, reason: "Email does not match token" });
    }

    return res.status(200).json({
      valid: true,
      name:  record.name  || "",
      email: record.email,
    });

  } catch (err) {
    console.error("validate-token error:", err);
    return res.status(500).json({ valid: false, reason: "Server error", detail: err.message });
  }
};
