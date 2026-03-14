/**
 * Vercel Serverless Function: /api/generate-report
 *
 * Proxies the Anthropic API call server-side so the API key
 * is never exposed in the browser.
 *
 * SETUP:
 *   Environment variables required in Vercel dashboard:
 *     ANTHROPIC_API_KEY  — from console.anthropic.com
 */

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin",  "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")   return res.status(405).json({ error: "Method not allowed" });

  try {
    const { system, prompt, max_tokens } = req.body;

    if (!system || !prompt) {
      return res.status(400).json({ error: "Missing system or prompt" });
    }

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type":         "application/json",
        "x-api-key":            process.env.ANTHROPIC_API_KEY,
        "anthropic-version":    "2023-06-01",
      },
      body: JSON.stringify({
        model:      "claude-sonnet-4-6",
        max_tokens: max_tokens || 1000,
        system,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error("Anthropic API error:", err);
      return res.status(500).json({ error: "Anthropic API error", detail: err });
    }

    const data = await response.json();
    const text = data.content?.map(b => b.text || "").join("") || "";

    return res.status(200).json({ text });

  } catch (err) {
    console.error("generate-report error:", err);
    return res.status(500).json({ error: "Failed to generate report", detail: err.message });
  }
};
