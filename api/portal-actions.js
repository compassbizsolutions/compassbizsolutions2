/**
 * /api/portal-submit-work
 * /api/portal-submit-ticket
 * /api/portal-send-message
 * POST — handle customer portal submissions
 */

async function getFromKV(key) {
  const url   = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
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
  const url   = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) return;
  await fetch(url + "/set/" + encodeURIComponent(key), {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify(value)
  });
}

async function validateSession(token) {
  if (!token) return null;
  const session = await getFromKV("portal_session:" + token)
               || await getFromKV("session:" + token);
  return session ? session.email : null;
}

function emailKey(email) {
  return email.toLowerCase().trim().replace(/[^a-z0-9@._-]/g, "");
}

async function sendEmail(to, subject, html) {
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + process.env.RESEND_API_KEY,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: "Compass Portal <reports@compassbizsolutions.com>",
      to,
      subject,
      html
    })
  });
}

async function handleSubmitWork(req, res, email) {
  const {
    service_type, description, deadline, priority, files, attachment,
    frequency, delivery_day, delivery_time, audience, tone, output_format,
    exclusions, approver_name, approver_contact, brand_link, examples,
    delivery_method, gdrive_folder, notes, credentials, cred_authorized,
  } = req.body || {};
  if (!service_type || !description) return res.status(400).json({ error: "Service type and description required" });

  const eKey = emailKey(email);
  const existing = await getFromKV("portal_requests:" + eKey) || [];
  const now = new Date().toISOString();

  const newRequest = {
    id:               "req_" + Date.now(),
    service_type:     service_type,
    description:      description,
    frequency:        frequency        || "one-time",
    deadline:         deadline         || null,
    delivery_day:     delivery_day     || null,
    delivery_time:    delivery_time    || null,
    priority:         priority         || "normal",
    audience:         audience         || null,
    tone:             tone             || null,
    output_format:    output_format    || null,
    exclusions:       exclusions       || null,
    approver_name:    approver_name    || null,
    approver_contact: approver_contact || null,
    files:            files            || null,
    brand_link:       brand_link       || null,
    examples:         examples         || null,
    delivery_method:  delivery_method  || "portal",
    gdrive_folder:    gdrive_folder    || null,
    notes:            notes            || null,
    credentials:      cred_authorized && credentials?.length
                        ? credentials.map(function(c) { return {
                            platform: c.platform, url: c.url,
                            username: c.username, password: c.password,
                            level: c.level, expiry: c.expiry, notes: c.notes
                          }; })
                        : [],
    cred_authorized:  cred_authorized  || false,
    attachment:       attachment ? { name: attachment.name, size: attachment.size, type: attachment.type } : null,
    status:           "submitted",
    created_at:       now,
  };

  await saveToKV("portal_requests:" + eKey, [newRequest, ...existing]);

  // Also write to admin inbox in KV
  const adminInbox = await getFromKV("admin_work_requests") || [];
  await saveToKV("admin_work_requests", [{
    ...newRequest,
    customer_email: email,
    eKey,
  }, ...adminInbox]);

  // Notify Jen
  try {
    await sendEmail(
      "reports@compassbizsolutions.com",
      `New Work Request — ${service_type} (${priority})`,
`<div style="font-family:sans-serif;max-width:560px;">
        <h2 style="color:#C8701A;">New Work Request</h2>
        <p><strong>Customer:</strong> ${email}</p>
        <p><strong>Service:</strong> ${service_type} — <em>${priority}</em></p>
        <p><strong>Frequency:</strong> ${frequency || "one-time"}</p>
        ${deadline ? `<p><strong>Deadline:</strong> ${deadline}</p>` : ""}
        ${delivery_day ? `<p><strong>Deliver by:</strong> ${delivery_day} at ${delivery_time || "9:00 AM"}</p>` : ""}
        <p><strong>Description:</strong></p>
        <p style="background:#f5f5f5;padding:12px;border-radius:4px;">${description}</p>
        ${audience ? `<p><strong>Audience:</strong> ${audience}</p>` : ""}
        ${tone ? `<p><strong>Tone:</strong> ${tone}</p>` : ""}
        ${output_format ? `<p><strong>Output format:</strong> ${output_format}</p>` : ""}
        ${exclusions ? `<p><strong>Exclusions:</strong> ${exclusions}</p>` : ""}
        ${approver_name ? `<p><strong>Approval contact:</strong> ${approver_name} — ${approver_contact || ""}</p>` : ""}
        ${files ? `<p><strong>Files:</strong> <a href="${files}">${files}</a></p>` : ""}
        ${brand_link ? `<p><strong>Brand guidelines:</strong> <a href="${brand_link}">${brand_link}</a></p>` : ""}
        ${examples ? `<p><strong>Examples:</strong> ${examples}</p>` : ""}
        ${notes ? `<p><strong>Additional notes:</strong> ${notes}</p>` : ""}
        ${attachment ? `<p><strong>Attachment:</strong> ${attachment.name} (${(attachment.size/1024).toFixed(1)} KB)</p>` : ""}
        ${newRequest.credentials?.length ? `<p><strong>⚠️ Credentials provided (${newRequest.credentials.length}):</strong> View in admin dashboard — stored in KV.</p>` : ""}
        <p><strong>Delivery method:</strong> ${delivery_method || "portal"}</p>
      </div>`
    );
    // Confirmation to customer
    await sendEmail(email, `Work Request Received — ${service_type}`,
      `<div style="font-family:sans-serif;max-width:500px;background:#111E31;padding:32px;border-radius:8px;color:#F4F7FC;">
        <p style="font-size:11px;letter-spacing:3px;color:#C8701A;text-transform:uppercase;font-weight:700;">Compass Business Solutions</p>
        <h2 style="color:#F4F7FC;">We got your request!</h2>
        <p style="color:#c8d8e8;">Your <strong>${service_type}</strong> request has been received. We'll review it and get back to you within 24 hours with a timeline and quote if applicable.</p>
        <p style="color:#8aa5c0;margin-top:24px;">Questions? Reply to this email or message us directly in your portal.</p>
      </div>`
    );
  } catch(e) { console.error("Email error:", e.message); }

  return res.status(200).json({ success: true, request: newRequest });
}

async function handleSubmitTicket(req, res, email) {
  const { subject, category, details } = req.body || {};
  if (!subject || !details) return res.status(400).json({ error: "Subject and details required" });

  const eKey = emailKey(email);
  const existing = await getFromKV("portal_tickets:" + eKey) || [];
  const now = new Date().toISOString();

  const newTicket = {
    id: "tix_" + Date.now(),
    subject,
    category: category || "General Question",
    details,
    status: "open",
    created_at: now,
  };

  await saveToKV("portal_tickets:" + eKey, [newTicket, ...existing]);

  // Admin inbox
  const adminTickets = await getFromKV("admin_tickets") || [];
  await saveToKV("admin_tickets", [{ ...newTicket, customer_email: email, eKey }, ...adminTickets]);

  // Notify Jen
  try {
    await sendEmail(
      "reports@compassbizsolutions.com",
      `New Support Ticket — ${subject}`,
      `<div style="font-family:sans-serif;max-width:500px;">
        <h2 style="color:#C8701A;">New Support Ticket</h2>
        <p><strong>Customer:</strong> ${email}</p>
        <p><strong>Subject:</strong> ${subject}</p>
        <p><strong>Category:</strong> ${category}</p>
        <p><strong>Details:</strong></p>
        <p style="background:#f5f5f5;padding:12px;border-radius:4px;">${details}</p>
      </div>`
    );
    await sendEmail(email, `Support Ticket Received — ${subject}`,
      `<div style="font-family:sans-serif;max-width:500px;background:#111E31;padding:32px;border-radius:8px;color:#F4F7FC;">
        <p style="font-size:11px;letter-spacing:3px;color:#C8701A;text-transform:uppercase;font-weight:700;">Compass Business Solutions</p>
        <h2 style="color:#F4F7FC;">Ticket Received</h2>
        <p style="color:#c8d8e8;">Your support ticket "<strong>${subject}</strong>" has been submitted. We'll respond within 24 hours.</p>
      </div>`
    );
  } catch(e) { console.error("Email error:", e.message); }

  return res.status(200).json({ success: true, ticket: newTicket });
}

async function handleSendMessage(req, res, email) {
  const { text } = req.body || {};
  if (!text) return res.status(400).json({ error: "Message text required" });

  const eKey = emailKey(email);
  const existing = await getFromKV("portal_messages:" + eKey) || [];
  const now = new Date().toISOString();

  const newMsg = { id: "msg_" + Date.now(), text, from: "customer", read: true, created_at: now };
  await saveToKV("portal_messages:" + eKey, [...existing, newMsg]);

  // Notify Jen
  try {
    await sendEmail(
      "reports@compassbizsolutions.com",
      `Portal Message from ${email}`,
      `<div style="font-family:sans-serif;max-width:500px;">
        <h2 style="color:#C8701A;">Portal Message</h2>
        <p><strong>From:</strong> ${email}</p>
        <p style="background:#f5f5f5;padding:12px;border-radius:4px;">${text}</p>
        <p><small>Reply via the admin dashboard or email directly.</small></p>
      </div>`
    );
  } catch(e) { console.error("Email error:", e.message); }

  return res.status(200).json({ success: true });
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.replace("Bearer ", "").trim();
    const email = await validateSession(token);
    if (!email) return res.status(401).json({ error: "Unauthorized" });

    // Route by action field OR by URL path (supports both patterns)
    const path   = req.url || "";
    const action = req.body?.action || "";

    if (path.includes("submit-work")   || action === "submit-work")   return handleSubmitWork(req, res, email);
    if (path.includes("submit-ticket") || action === "submit-ticket") return handleSubmitTicket(req, res, email);
    if (path.includes("send-message")  || action === "send-message")  return handleSendMessage(req, res, email);

    // Fallback: if single endpoint file, try to infer from body fields
    if (req.body?.service_type || req.body?.description) return handleSubmitWork(req, res, email);
    if (req.body?.subject && req.body?.details)          return handleSubmitTicket(req, res, email);
    if (req.body?.text)                                   return handleSendMessage(req, res, email);

    return res.status(404).json({ error: "Unknown action. Pass action: submit-work | submit-ticket | send-message" });

  } catch(err) {
    console.error("portal-actions error:", err.message);
    return res.status(500).json({ error: "Server error" });
  }
};
