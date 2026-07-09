/**
 * /api/deskkit-assist
 * POST — general-purpose server-side AI call for pre-payment helper tasks
 * (e.g. parsing an uploaded file into structured data before a task/payment exists).
 * Requires a valid session. Does NOT require a paid task — keep max_tokens modest
 * since this runs before any charge occurs.
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

    const { systemPrompt, userText, files, maxTokens } = req.body || {};
    if (!userText) return res.status(400).json({ error: "userText required" });

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return res.status(500).json({ error: "Server not configured" });

    const userContent = [];
    (files || []).slice(0, 5).forEach(f => {
      if (f.mediaType === "application/pdf" && f.data) {
        userContent.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: f.data } });
      } else if (f.mediaType && f.mediaType.startsWith("image/") && f.data) {
        userContent.push({ type: "image", source: { type: "base64", media_type: f.mediaType, data: f.data } });
      } else if (f.textContent) {
        userContent.push({ type: "text", text: `File: ${f.name || "upload"}\n\n${f.textContent}` });
      } else if (f.name) {
        userContent.push({ type: "text", text: `File uploaded: ${f.name} (content not readable in this format — only filename available)` });
      }
    });
    userContent.push({ type: "text", text: userText });

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: Math.min(maxTokens || 2000, 4000),
        system: systemPrompt || "You are a helpful assistant.",
        messages: [{ role: "user", content: userContent }]
      })
    });

    const data = await response.json();
    if (data.error) {
      console.error("Anthropic API error:", data.error);
      return res.status(502).json({ error: "Service error" });
    }

    return res.status(200).json({ text: data.content?.[0]?.text || "" });

  } catch(err) {
    console.error("deskkit-assist error:", err.message);
    return res.status(500).json({ error: "Server error" });
  }
};
