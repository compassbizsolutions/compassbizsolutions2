/**
 * /api/deskkit-save
 * POST — save task result or update status
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

    const { taskId, result, status, error } = req.body || {};
    if (!taskId) return res.status(400).json({ error: "Task ID required" });

    const task = await getFromKV("deskkit_task:" + taskId);
    if (!task) return res.status(404).json({ error: "Task not found" });

    // Verify ownership
    if (task.email !== email) return res.status(403).json({ error: "Forbidden" });

    // Update task
    const updated = Object.assign({}, task, {
      status: status || task.status,
      result: result || task.result,
      error: error || null,
      updatedAt: new Date().toISOString()
    });

    await saveToKV("deskkit_task:" + taskId, updated);

    return res.status(200).json({ success: true });

  } catch(err) {
    console.error("deskkit-save error:", err.message);
    return res.status(500).json({ error: "Server error" });
  }
};
