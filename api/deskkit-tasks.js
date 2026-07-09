/**
 * /api/deskkit-tasks
 * GET — fetch task history or single task result
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
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    const authHeader = req.headers.authorization || "";
    const sessionToken = authHeader.replace("Bearer ", "").trim();
    const email = await validateSession(sessionToken);
    if (!email) return res.status(401).json({ error: "Unauthorized" });

    const emailKey = email.toLowerCase().replace(/[^a-z0-9@._-]/g, "");
    const { id } = req.query || {};

    // Single task
    if (id) {
      const task = await getFromKV("deskkit_task:" + id);
      if (!task || task.email !== email) return res.status(404).json({ error: "Not found" });
      return res.status(200).json(task);
    }

    // All tasks
    const taskIds = await getFromKV("deskkit_tasks:" + emailKey) || [];
    const tasks = await Promise.all(
      taskIds.slice(0, 50).map(id => getFromKV("deskkit_task:" + id))
    );

    return res.status(200).json({
      tasks: tasks.filter(Boolean).map(t => ({
        id: t.id,
        desc: t.desc,
        tier: t.tier,
        price: t.price,
        filename: t.filename,
        status: t.status,
        createdAt: t.createdAt,
        toolName: t.toolName || "General Task",
        toolPath: t.toolPath || "/portal/app"
      }))
    });

  } catch(err) {
    console.error("deskkit-tasks error:", err.message);
    return res.status(500).json({ error: "Server error" });
  }
};
