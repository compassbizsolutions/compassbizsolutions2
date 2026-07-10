/**
 * /api/deskkit-escalate
 * POST — customer says a result wasn't what they expected. Notify Jen directly
 * by email with full task context so she can call the customer and either fix
 * it personally or issue a refund. Flips the task to needs_review.
 */
const { Resend } = require("resend");

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

function escapeHtml(str) {
  return String(str || "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
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

    const { taskId, reason } = req.body || {};
    if (!taskId) return res.status(400).json({ error: "Missing taskId" });

    const task = await getFromKV("deskkit_task:" + taskId);
    if (!task) return res.status(404).json({ error: "Task not found" });
    if (task.email !== email) return res.status(403).json({ error: "Forbidden" });

    await saveToKV("deskkit_task:" + taskId, Object.assign({}, task, {
      status: "needs_review",
      escalatedReason: reason || "",
      updatedAt: new Date().toISOString()
    }));

    try {
      const resend = new Resend(process.env.RESEND_API_KEY);
      await resend.emails.send({
        from: "DeskKit <" + (process.env.FROM_EMAIL || "reports@compassbizsolutions.com") + ">",
        to: "reports@compassbizsolutions.com",
        subject: `Customer needs help — ${task.toolName || "DeskKit task"} — ${email}`,
        html: `<div style="font-family:sans-serif;max-width:520px;">
          <h2 style="color:#C8701A;">A customer wasn't happy with a result</h2>
          <p><strong>Customer:</strong> ${escapeHtml(email)}</p>
          <p><strong>Task:</strong> ${escapeHtml(task.toolName || "General Task")}</p>
          <p><strong>Price paid:</strong> $${task.price || 0}</p>
          <p><strong>Task ID:</strong> ${escapeHtml(taskId)}</p>
          <p><strong>What they said was wrong:</strong><br/>${escapeHtml(reason) || "(No details given)"}</p>
          <hr style="border:none;border-top:1px solid #eee;margin:16px 0;"/>
          <p style="color:#888;font-size:12px;">Call them, fix it personally, or issue a refund — whatever gets it right.</p>
        </div>`
      });
    } catch(emailErr) {
      console.error("Escalation email error:", emailErr.message);
    }

    // Text alert — email can sit unread for hours, this actually reaches Jen right away
    try {
      const sid = process.env.TWILIO_ACCOUNT_SID;
      const authToken = process.env.TWILIO_AUTH_TOKEN;
      const fromNumber = process.env.TWILIO_FROM_NUMBER;
      const alertToNumber = process.env.TWILIO_ALERT_TO_NUMBER;

      if (sid && authToken && fromNumber && alertToNumber) {
        const smsBody = `DeskKit: ${email} needs help with "${task.toolName || "a task"}" ($${task.price || 0}). ${reason ? 'Said: ' + reason.slice(0, 100) : 'No details given.'} Check email for full info.`;

        await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
          method: "POST",
          headers: {
            Authorization: "Basic " + Buffer.from(`${sid}:${authToken}`).toString("base64"),
            "Content-Type": "application/x-www-form-urlencoded"
          },
          body: new URLSearchParams({
            To: alertToNumber,
            From: fromNumber,
            Body: smsBody
          })
        });
      } else {
        console.log("Twilio not configured — skipping SMS alert (email still sent)");
      }
    } catch(smsErr) {
      console.error("Escalation SMS error:", smsErr.message);
    }

    return res.status(200).json({ success: true });

  } catch(err) {
    console.error("deskkit-escalate error:", err.message);
    return res.status(500).json({ error: "Server error" });
  }
};
