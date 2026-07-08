/**
 * /api/deskkit-analyze
 * POST — analyze a task's complexity/tier server-side (holds the real API key).
 * Requires a valid session but does not require payment — this runs before charging.
 */

function getKV() {
  return {
    url:   process.env.UPSTASH_REDIS_REST_URL || process.env.lime_KV_REST_API_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN || process.env.lime_KV_REST_API_TOKEN
  };
}

async function getFromKV(key) {
  const { url, token } = getKV();
  if (!url || !token) return null;
  try {
    const r = await fetch(url + "/get/" + encodeURIComponent(key), {
      headers: { Authorization: "Bearer " + token }
    });
    const d = await r.json();
    return d.result ? JSON.parse(d.result) : null;
  } catch(e) { return null; }
}

async function validateSession(token) {
  if (!token) return null;
  const session = await getFromKV("session:" + token);
  return session ? session.email : null;
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

    const { desc, analyzeContext, files } = req.body || {};
    if (!desc) return res.status(400).json({ error: "Description required" });

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return res.status(500).json({ error: "Server not configured" });

    const userContent = [];
    (files || []).slice(0, 10).forEach(f => {
      if (f.mediaType && f.mediaType.startsWith("image/") && f.data) {
        userContent.push({ type: "image", source: { type: "base64", media_type: f.mediaType, data: f.data } });
      } else if (f.name) {
        userContent.push({ type: "text", text: `File uploaded: ${f.name}` });
      }
    });
    userContent.push({
      type: "text",
      text: `Task request: ${desc}\n\nAnalyze this task and respond ONLY with a JSON object (no markdown, no backticks) in this exact format:\n{"tier":"simple|moderate|complex|bulk","reason":"one sentence why","steps":["step 1","step 2","step 3"]}`
    });

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 500,
        system: `You are a task complexity analyzer for DeskKit, an AI back office service for small businesses. ${analyzeContext || ""} Classify into exactly one tier: simple ($15, under 15 min), moderate ($35, 15-45 min), complex ($75, 45+ min or multiple documents/significant judgment), bulk ($125, high-volume batch). Respond ONLY with valid JSON, no markdown.`,
        messages: [{ role: "user", content: userContent }]
      })
    });

    const data = await response.json();
    if (data.error) {
      console.error("Anthropic API error:", data.error);
      return res.status(502).json({ error: "Analysis service error" });
    }

    const text = data.content?.[0]?.text || "";
    let analysis;
    try {
      analysis = JSON.parse(text.replace(/```json|```/g, "").trim());
    } catch(e) {
      analysis = { tier: "moderate", reason: "Standard task requiring analysis and completion.", steps: ["Read and analyze your file", "Complete the requested work", "Prepare your deliverable"] };
    }

    return res.status(200).json(analysis);

  } catch(err) {
    console.error("deskkit-analyze error:", err.message);
    return res.status(500).json({ error: "Server error" });
  }
};
