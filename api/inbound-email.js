/**
 * /api/inbound-email
 * Receives inbound emails from Resend webhook
 * Saves to KV, flags in admin for response
 * Generates AI draft reply in Jen's voice on request
 */

const { Resend } = require("resend");
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

// Build context about this person for the AI
async function buildPersonContext(fromEmail) {
  const ek = emailKey(fromEmail);
  const [contact, lead, customer, notes, outreachHistory] = await Promise.all([
    getFromKV("contact:" + ek),
    getFromKV("lead:" + ek),
    getFromKV("customer:" + ek),
    getFromKV("person_notes:" + ek),
    (async () => {
      const keys = await scanKV("outreach:" + ek + ":*");
      const logs = await Promise.all(keys.map(k => getFromKV(k)));
      return logs.filter(Boolean).sort((a,b) => new Date(a.sentAt) - new Date(b.sentAt));
    })()
  ]);

  const parts = [];

  if (contact) {
    parts.push(`CONTACT INFO: ${contact.firstName||""} ${contact.lastName||""}, Trade: ${contact.trade||"unknown"}, Business: ${contact.biz||"unknown"}, Source: ${contact.source||"unknown"}`);
  }

  if (lead) {
    parts.push(`DIAGNOSTIC: They ran the free diagnostic. Estimated annual profit leak: ${lead.leak_total || lead.leakTotal || "unknown"}. Top leak: ${lead.top_leak || "unknown"}`);
  }

  if (customer) {
    parts.push(`CUSTOMER: Purchased ${customer.plan_type} plan on ${customer.phase_1_date ? new Date(customer.phase_1_date).toLocaleDateString() : "unknown date"}. Intake ${customer.intake_complete ? "complete" : "not yet complete"}.`);
    if (customer.intake_answers && Object.keys(customer.intake_answers).length > 0) {
      const answers = Object.entries(customer.intake_answers)
        .filter(([k,v]) => v)
        .slice(0, 10)
        .map(([k,v]) => `${k}: ${v}`)
        .join(", ");
      parts.push(`INTAKE ANSWERS (key ones): ${answers}`);
    }
  }

  if (outreachHistory.length > 0) {
    const emailsSent = outreachHistory.map(e => `"${e.subject}" on ${new Date(e.sentAt).toLocaleDateString()}`).join("; ");
    parts.push(`EMAILS SENT TO THEM: ${emailsSent}`);
  }

  if (notes?.list?.length > 0) {
    const noteText = notes.list.slice(0,3).map(n => n.text).join(" | ");
    parts.push(`YOUR NOTES: ${noteText}`);
  }

  return parts.join("\n\n");
}

// Generate AI draft reply
async function generateDraft(inboundEmail, personContext) {
  const prompt = `You are drafting an email reply for Jen Voiselle, founder of Compass Business Solutions. Jen helps service business owners (HVAC, plumbing, electrical, landscaping, etc.) identify and fix profit leaks in their operations.

ABOUT JEN'S VOICE:
- Direct, warm, and real. Talks like a person, not a marketer.
- Short sentences. No corporate speak. No fluff.
- Genuinely cares about helping these guys make more money.
- Signs off as "— Jen" or "— Jen Voiselle"
- Never says "I hope this email finds you well" or anything generic like that
- Gets to the point fast
- If they're asking about pricing, she's honest and direct about what things cost
- If they have a question she can't answer without more info, she asks one clear question
- If they're interested, she moves them toward the next step naturally without being pushy

CONTEXT ABOUT THIS PERSON:
${personContext || "No prior context — this is a new contact."}

INBOUND EMAIL RECEIVED:
From: ${inboundEmail.from}
Subject: ${inboundEmail.subject}
Message:
${inboundEmail.textBody || extractText(inboundEmail.htmlBody) || "(no body)"}

Write a reply email for Jen to send. Just the email body — no subject line, no "Here is a draft" preamble. Start directly with the greeting. Keep it under 150 words unless the question genuinely requires more. Match the tone to what they wrote — if they're brief, be brief. If they're detailed, be a bit more detailed.`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 500,
      messages: [{ role: "user", content: prompt }]
    })
  });

  const data = await response.json();
  return data.content?.[0]?.text || "";
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

      const personContext = await buildPersonContext(inbound.from);
      const draft = await generateDraft(inbound, personContext);

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
