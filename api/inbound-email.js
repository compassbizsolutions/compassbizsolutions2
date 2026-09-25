/**
 * /api/inbound-email
 * Receives inbound emails from Resend webhook
 * Saves to KV, flags in admin for response
 * Generates AI draft reply in Jen's voice on request
 */

const { Resend } = require("resend");
const { analyzeInquiry } = require("./_lib/inquiry-ai");
const { buildPersonContext } = require("./_lib/person-context");
const { enqueue } = require("./_lib/inquiry-queue");
const FROM = "Jen Voiselle <jen@compassbizsolutions.com>";

async function getFromKV(key) {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  try {
    const res = await fetch(url + "/get/" + encodeURIComponent(key), { headers: { Authorization: "Bearer " + token } });
    const data = await res.json();
    return data.result ? JSON.parse(data.result) : null;
  } catch(e) { return null; }
}

async function saveToKV(key, value) {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) return;
  try {
    await fetch(url + "/set/" + encodeURIComponent(key), {
      method: "POST",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify(value)
    });
  } catch(e) { console.error("KV save:", e.message); }
}

async function scanKV(pattern) {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) return [];
  try {
    let cursor = 0, keys = [];
    do {
      const res = await fetch(url + "/scan/" + cursor + "?match=" + encodeURIComponent(pattern) + "&count=100", { headers: { Authorization: "Bearer " + token } });
      const data = await res.json();
      cursor = parseInt(data.result?.[0] || "0");
      keys = keys.concat(data.result?.[1] || []);
    } while (cursor !== 0);
    return keys;
  } catch(e) { return []; }
}

async function validateSession(token) {
  if (!token) return false;
  return !!(await getFromKV("admin_session:" + token));
}

function emailKey(email) {
  return (email || "").toLowerCase().replace(/[^a-z0-9@._-]/g, "");
}

// Extract plain text from email body
function extractText(body) {
  if (!body) return "";
  // Strip HTML tags
  return body.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().substring(0, 2000);
}

// AI draft for the admin "generate draft" button (same engine as the dispatcher)
async function generateDraft(inbound) {
  const result = await analyzeInquiry({
    messages: `Subject: ${inbound.subject}\n${inbound.textBody || extractText(inbound.htmlBody) || "(no body)"}`,
    personContext: await buildPersonContext(inbound.from),
    voice: process.env.INQUIRY_AUTO_SEND === "true" ? "team" : "jen",
  });
  return result.reply || "";
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-admin-token");
  if (req.method === "OPTIONS") return res.status(200).end();

  // ── INBOUND WEBHOOK FROM RESEND ──────────────────────────────────────────────
  if (req.method === "POST" && !req.headers["x-admin-token"]) {
    try {
      const payload = req.body;

      // Resend wraps inbound events: { type: "email.received", data: { ... } }
      const email = payload.data || payload;

      const fromRaw = email.from || "";
      const fromEmail = typeof fromRaw === "object" ? (fromRaw.address || fromRaw.email || "") : fromRaw;
      const fromName = typeof fromRaw === "object" ? (fromRaw.name || "") : (email.headers?.from?.match(/^"?([^"<]+)"?\s*</)?.[1]?.trim() || "");
      const subject = email.subject || "(no subject)";
      const textBody = email.text || "";
      const htmlBody = email.html || "";
      const messageId = email.message_id || email.id || ("msg_" + Date.now());
      const receivedAt = new Date().toISOString();

      if (!fromEmail || !fromEmail.includes("@")) {
        return res.status(200).json({ received: true, skipped: "no valid from address" });
      }

      // Skip automated/bounce emails
      const skipSenders = ["noreply", "no-reply", "mailer-daemon", "postmaster", "donotreply"];
      if (skipSenders.some(s => fromEmail.toLowerCase().includes(s))) {
        return res.status(200).json({ received: true, skipped: "automated sender" });
      }

      const ek = emailKey(fromEmail);
      const inboundKey = "inbound:" + ek + ":" + Date.now();

      // Save inbound email
      await saveToKV(inboundKey, {
        id: messageId,
        from: fromEmail,
        fromName,
        subject,
        textBody: textBody.substring(0, 5000),
        htmlBody: htmlBody.substring(0, 5000),
        receivedAt,
        status: "unread", // unread | read | replied | manual
        aiDraft: null,
        repliedAt: null,
      });

      // Hand off to the inquiry assistant (triage, draft, timed follow-through)
      if (!fromEmail.toLowerCase().endsWith("@compassbizsolutions.com")) {
        try { await enqueue("analyze", inboundKey, new Date()); }
        catch(e) { console.error("inquiry enqueue:", e.message); }
      }

      // Update person's last activity
      const contact = await getFromKV("contact:" + ek);
      if (contact) {
        await saveToKV("contact:" + ek, Object.assign({}, contact, {
          lastReply: receivedAt,
          hasUnreadReply: true
        }));
      }

      // Alert Jen via email
      const resend = new Resend(process.env.RESEND_API_KEY);
      resend.emails.send({
        from: "Compass Admin <reports@compassbizsolutions.com>",
        to: "jen@compassbizsolutions.com",
        subject: "Reply received: " + subject,
        html: `<div style="font-family:Arial,sans-serif;max-width:500px;">
          <p style="font-size:13px;color:#1A2332;"><strong>From:</strong> ${fromName ? fromName + " &lt;" + fromEmail + "&gt;" : fromEmail}</p>
          <p style="font-size:13px;color:#1A2332;"><strong>Subject:</strong> ${subject}</p>
          <div style="background:#F7F5F2;border-left:3px solid #C8701A;padding:14px;margin:12px 0;font-size:13px;color:#3E4E63;line-height:1.7;">${textBody.substring(0,500).replace(/\n/g,"<br>")}</div>
          <a href="https://admin.compassbizsolutions.com" style="display:inline-block;background:#1B2E4B;color:white;padding:10px 20px;border-radius:8px;text-decoration:none;font-size:13px;font-weight:bold;">View in Admin →</a>
        </div>`
      }).catch(() => {});

      console.log("Inbound email received from:", fromEmail);
      return res.status(200).json({ received: true });

    } catch(err) {
      console.error("Inbound webhook error:", err.message);
      return res.status(200).json({ received: true, error: err.message });
    }
  }

  // ── ADMIN API ─────────────────────────────────────────────────────────────────
  const adminToken = req.headers["x-admin-token"] || req.query.token;
  if (!await validateSession(adminToken)) return res.status(401).json({ error: "Unauthorized" });

  // GET — list all inbound emails
  if (req.method === "GET") {
    try {
      const { emailFilter } = req.query;
      const pattern = emailFilter ? "inbound:" + emailKey(emailFilter) + ":*" : "inbound:*";
      const keys = await scanKV(pattern);
      const emails = (await Promise.all(keys.map(k => getFromKV(k))))
        .filter(Boolean)
        .sort((a,b) => new Date(b.receivedAt) - new Date(a.receivedAt))
        .slice(0, 100);
      return res.status(200).json({ success: true, emails });
    } catch(err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { action, inboundKey, fromEmail } = req.body;

  // Generate AI draft
  if (action === "generate_draft") {
    try {
      const inbound = await getFromKV(inboundKey);
      if (!inbound) return res.status(404).json({ error: "Email not found" });

      const draft = await generateDraft(inbound);

      // Save draft to the inbound record
      await saveToKV(inboundKey, Object.assign({}, inbound, {
        aiDraft: draft,
        status: "read"
      }));

      return res.status(200).json({ success: true, draft });
    } catch(err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // Send reply
  if (action === "send_reply") {
    try {
      const { body, subject } = req.body;
      const inbound = await getFromKV(inboundKey);
      if (!inbound) return res.status(404).json({ error: "Email not found" });

      const resend = new Resend(process.env.RESEND_API_KEY);
      const html = body.split("\n").map(line =>
        line.trim() === "" ? "<br>" :
        `<p style="margin:0 0 10px;font-family:Arial,sans-serif;font-size:14px;color:#1A2332;line-height:1.75;">${line}</p>`
      ).join("");

      const result = await resend.emails.send({
        from: FROM,
        to: inbound.from,
        reply_to: "replies@aldiiwenue.resend.app",
        subject: subject || ("Re: " + inbound.subject),
        text: body,
        html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
          <div style="background:#1B2E4B;padding:18px 28px;border-radius:8px 8px 0 0;">
            <div style="font-size:9px;color:rgba(255,255,255,0.35);letter-spacing:3px;">COMPASS BUSINESS SOLUTIONS</div>
          </div>
          <div style="background:#F7F5F2;padding:22px 28px;border-radius:0 0 8px 8px;border:1px solid #D8D4CD;border-top:none;">
            ${html}
          </div>
        </div>`
      });

      if (result.error) return res.status(500).json({ error: result.error.message });

      // Mark as replied
      await saveToKV(inboundKey, Object.assign({}, inbound, {
        status: "replied",
        repliedAt: new Date().toISOString(),
        replySent: body
      }));

      // Log in outreach history
      const ek = emailKey(inbound.from);
      await saveToKV("outreach:" + ek + ":reply:" + Date.now(), {
        to: inbound.from,
        subject: subject || ("Re: " + inbound.subject),
        sentAt: new Date().toISOString(),
        isReply: true
      });

      return res.status(200).json({ success: true });
    } catch(err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // Mark as manual / read
  if (action === "mark_status") {
    try {
      const { status } = req.body;
      const inbound = await getFromKV(inboundKey);
      if (!inbound) return res.status(404).json({ error: "Not found" });
      await saveToKV(inboundKey, Object.assign({}, inbound, { status }));
      return res.status(200).json({ success: true });
    } catch(err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(400).json({ error: "Unknown action" });
};
