/**
 * /api/deskkit-generate
 * POST — do the actual task work server-side (holds the real API key).
 * Requires a valid session AND a task that has already been paid for (status: pending).
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

async function saveToKV(key, value) {
  const { url, token } = getKV();
  if (!url || !token) return;
  await fetch(url + "/set/" + encodeURIComponent(key), {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify(value)
  });
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

    const { taskId, desc, workSystem, files, mode, feedback, previousResult } = req.body || {};
    if (!taskId) return res.status(400).json({ error: "Missing taskId" });

    const task = await getFromKV("deskkit_task:" + taskId);
    if (!task) return res.status(404).json({ error: "Task not found" });
    if (task.email !== email) return res.status(403).json({ error: "Forbidden" });
    if (task.status === "pending_payment") return res.status(402).json({ error: "Payment not yet confirmed for this task" });

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return res.status(500).json({ error: "Server not configured" });

    let messages, systemPrompt;

    if (mode === "revise") {
      if (!feedback || !previousResult) return res.status(400).json({ error: "Missing feedback or previousResult" });
      systemPrompt = "Apply the requested revision and return the complete revised deliverable. If the original response included a QuickBooks CSV section separated by ===QUICKBOOKS_CSV===, keep that same structure and delimiter in your revised response.";
      messages = [{ role: "user", content: `Here is the current result:\n\n${previousResult}\n\nRevision request: ${feedback}` }];
    } else {
      if (!desc) return res.status(400).json({ error: "Missing description" });
      const userContent = [];
      (files || []).slice(0, 10).forEach(f => {
        if (f.mediaType && f.mediaType.startsWith("image/") && f.data) {
          userContent.push({ type: "image", source: { type: "base64", media_type: f.mediaType, data: f.data } });
        } else if (f.name) {
          userContent.push({ type: "text", text: `File: ${f.name}` });
        }
      });
      userContent.push({ type: "text", text: desc });
      messages = [{ role: "user", content: userContent }];
      systemPrompt = workSystem || "You are DeskKit, an AI back office assistant. Complete the requested task and give the complete finished deliverable, not instructions.";
    }

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 4000,
        system: systemPrompt,
        messages
      })
    });

    const data = await response.json();
    if (data.error) {
      console.error("Anthropic API error:", data.error);
      await saveToKV("deskkit_task:" + taskId, Object.assign({}, task, {
        status: "needs_review", error: data.error.message, updatedAt: new Date().toISOString()
      }));
      return res.status(502).json({ error: "Generation service error — flagged for manual review" });
    }

    const result = data.content?.[0]?.text || "";
    if (!result) {
      await saveToKV("deskkit_task:" + taskId, Object.assign({}, task, {
        status: "needs_review", error: "Empty result from generation", updatedAt: new Date().toISOString()
      }));
      return res.status(502).json({ error: "No result generated — flagged for manual review" });
    }

    await saveToKV("deskkit_task:" + taskId, Object.assign({}, task, {
      status: "preview", result, updatedAt: new Date().toISOString()
    }));

    return res.status(200).json({ success: true, result });

  } catch(err) {
    console.error("deskkit-generate error:", err.message);
    return res.status(500).json({ error: "Server error" });
  }
};
