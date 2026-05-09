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
    sensitive_data,
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
    sensitive_data:   sensitive_data   || false,
    attachment:       attachment ? { name: attachment.name, size: attachment.size, type: attachment.type } : null,
    status:           "submitted",
    created_at:       now,
  };

  await saveToKV("portal_requests:" + eKey, [newRequest, ...existing]);

  // Also write to admin inbox in KV
  const adminInbox = await getFromKV("admin_work_requests") || [];
  var newAdminReq = Object.assign({}, newRequest, { customer_email: email, eKey: eKey });
  adminInbox.unshift(newAdminReq);
  if (adminInbox.length > 200) adminInbox = adminInbox.slice(0, 200);
  await saveToKV("admin_work_requests", adminInbox);

  // Also write an inbound-style record so it shows in the admin inbox with a body
  const inboundKey = "inbound:" + eKey + ":" + Date.now();
  const bodyText = [
    "Service: " + service_type,
    "Priority: " + (priority || "normal"),
    "Frequency: " + (frequency || "one-time"),
    deadline ? "Deadline: " + deadline : "",
    delivery_day ? "Deliver by: " + delivery_day + " at " + (delivery_time || "9:00 AM") : "",
    "",
    "Description:",
    description || "",
    audience ? "\nAudience: " + audience : "",
    tone ? "Tone: " + tone : "",
    output_format ? "Output format: " + output_format : "",
    exclusions ? "Exclusions: " + exclusions : "",
    files ? "Files: " + files : "",
    notes ? "Additional notes: " + notes : "",
    newRequest.credentials && newRequest.credentials.length ? "\nCredentials provided: " + newRequest.credentials.length + " (view in Portal tab)" : "",
    sensitive_data ? "\n⚠ SENSITIVE DATA FLAGGED" : "",
  ].filter(Boolean).join("\n");

  await saveToKV(inboundKey, {
    inboundKey,
    id: "portal_req_" + newRequest.id,
    from: email,
    fromName: (customer && customer.name) || email,
    subject: "Work Request — " + service_type + " (" + (priority || "normal") + ")",
    textBody: bodyText,
    htmlBody: "",
    receivedAt: now,
    status: "unread",
    isPortalRequest: true,
    requestId: newRequest.id,
    aiDraft: null,
    repliedAt: null,
  });

  // Notify Jen
  try {
    var jenRows = [
        "<h2 style=\"color:#C8701A;\">New Work Request</h2>",
        "<p><strong>Customer:</strong> " + email + "</p>",
        "<p><strong>Service:</strong> " + service_type + " &mdash; " + (priority||"normal") + "</p>",
        "<p><strong>Frequency:</strong> " + (frequency||"one-time") + "</p>",
        deadline ? "<p><strong>Deadline:</strong> " + deadline + "</p>" : "",
        delivery_day ? "<p><strong>Deliver by:</strong> " + delivery_day + " at " + (delivery_time||"9:00 AM") + "</p>" : "",
        "<p><strong>Description:</strong></p>",
        "<p style=\"background:#f5f5f5;padding:12px;border-radius:4px;\">" + (description||"") + "</p>",
        audience ? "<p><strong>Audience:</strong> " + audience + "</p>" : "",
        tone ? "<p><strong>Tone:</strong> " + tone + "</p>" : "",
        output_format ? "<p><strong>Output format:</strong> " + output_format + "</p>" : "",
        exclusions ? "<p><strong>Exclusions:</strong> " + exclusions + "</p>" : "",
        approver_name ? "<p><strong>Approval contact:</strong> " + approver_name + (approver_contact ? " &mdash; " + approver_contact : "") + "</p>" : "",
        files ? "<p><strong>Files:</strong> <a href=\"" + files + "\">" + files + "</a></p>" : "",
        brand_link ? "<p><strong>Brand guidelines:</strong> <a href=\"" + brand_link + "\">" + brand_link + "</a></p>" : "",
        examples ? "<p><strong>Examples:</strong> " + examples + "</p>" : "",
        notes ? "<p><strong>Additional notes:</strong> " + notes + "</p>" : "",
        attachment ? "<p><strong>Attachment:</strong> " + attachment.name + " (" + (attachment.size/1024).toFixed(1) + " KB)</p>" : "",
        newRequest.credentials && newRequest.credentials.length ? "<p><strong>&#9888; Credentials provided (" + newRequest.credentials.length + "):</strong> View in admin dashboard under Portal &rsaquo; Work Requests.</p>" : "",
        sensitive_data ? "<p style=\"background:rgba(184,76,46,0.1);border:1px solid rgba(184,76,46,0.3);padding:10px;border-radius:4px;\"><strong>&#9888; SENSITIVE DATA FLAGGED</strong> &mdash; Customer indicated sensitive data. They should have shared via Bitwarden Send. Do not forward unencrypted.</p>" : "",
        "<p><strong>Delivery method:</strong> " + (delivery_method||"portal_email") + "</p>",
      ].filter(Boolean).join("");
      await sendEmail(
        "reports@compassbizsolutions.com",
        "New Work Request — " + service_type + " (" + (priority||"normal") + ")",
        "<div style=\"font-family:sans-serif;max-width:560px;\">" + jenRows + "</div>"
      );
    // Confirmation to customer
    await sendEmail(email, `Work Request Received — ${service_type}`,
      `<div style="font-family:sans-serif;max-width:560px;margin:0 auto;">
        <div style="background:#0F1E30;padding:24px 28px;border-radius:8px 8px 0 0;border-bottom:1px solid rgba(120,160,200,0.15);">
          <div style="font-size:9px;letter-spacing:4px;text-transform:uppercase;color:#D4820F;font-weight:700;margin-bottom:4px;">Compass Business Solutions</div>
          <div style="font-family:Georgia,serif;font-size:20px;font-weight:700;color:#FAFCFE;">We received your request.</div>
        </div>
        <div style="background:#162840;padding:24px 28px;border-radius:0 0 8px 8px;">
          <p style="font-size:14px;color:#c8d8e8;line-height:1.7;margin-bottom:24px;">Your <strong style="color:#FAFCFE;">${service_type}</strong> request has been received. Here is what happens next:</p>

          <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:24px;">
            <tr>
              <td style="padding:12px 0;border-bottom:1px solid rgba(120,160,200,0.12);">
                <span style="display:inline-block;background:#D4820F;color:#0C1520;font-size:10px;font-weight:700;padding:2px 8px;border-radius:3px;margin-bottom:6px;letter-spacing:1px;">STEP 1</span><br/>
                <strong style="font-size:14px;color:#FAFCFE;">We review your request</strong><br/>
                <span style="font-size:13px;color:#7A95B0;line-height:1.6;">We look at what you need, review any files you uploaded, and scope the work.</span>
              </td>
            </tr>
            <tr>
              <td style="padding:12px 0;border-bottom:1px solid rgba(120,160,200,0.12);">
                <span style="display:inline-block;background:#D4820F;color:#0C1520;font-size:10px;font-weight:700;padding:2px 8px;border-radius:3px;margin-bottom:6px;letter-spacing:1px;">STEP 2</span><br/>
                <strong style="font-size:14px;color:#FAFCFE;">You receive a quote</strong><br/>
                <span style="font-size:13px;color:#7A95B0;line-height:1.6;">We send you a quote within 24 hours. You review and approve it in your portal before any work begins.</span>
              </td>
            </tr>
            <tr>
              <td style="padding:12px 0;border-bottom:1px solid rgba(120,160,200,0.12);">
                <span style="display:inline-block;background:#D4820F;color:#0C1520;font-size:10px;font-weight:700;padding:2px 8px;border-radius:3px;margin-bottom:6px;letter-spacing:1px;">STEP 3</span><br/>
                <strong style="font-size:14px;color:#FAFCFE;">Payment</strong><br/>
                <span style="font-size:13px;color:#7A95B0;line-height:1.6;">Once you approve the quote, payment is collected securely through your portal. Work begins immediately after.</span>
              </td>
            </tr>
            <tr>
              <td style="padding:12px 0;border-bottom:1px solid rgba(120,160,200,0.12);">
                <span style="display:inline-block;background:#D4820F;color:#0C1520;font-size:10px;font-weight:700;padding:2px 8px;border-radius:3px;margin-bottom:6px;letter-spacing:1px;">STEP 4</span><br/>
                <strong style="font-size:14px;color:#FAFCFE;">Work is completed</strong><br/>
                <span style="font-size:13px;color:#7A95B0;line-height:1.6;">We complete your request and review it before it leaves our desk.</span>
              </td>
            </tr>
            <tr>
              <td style="padding:12px 0;">
                <span style="display:inline-block;background:#D4820F;color:#0C1520;font-size:10px;font-weight:700;padding:2px 8px;border-radius:3px;margin-bottom:6px;letter-spacing:1px;">STEP 5</span><br/>
                <strong style="font-size:14px;color:#FAFCFE;">Delivered to your portal</strong><br/>
                <span style="font-size:13px;color:#7A95B0;line-height:1.6;">You will receive an email notification when your completed work is ready to download${delivery_method === 'email' ? ' — and it will also be emailed to you directly' : delivery_method === 'gdrive' ? ' — and saved to your Google Drive' : ''}.</span>
              </td>
            </tr>
          </table>

          <a href="https://www.compassbizsolutions.com/portal/app" style="display:inline-block;background:#D4820F;color:#0C1520;padding:12px 24px;border-radius:5px;text-decoration:none;font-weight:600;font-size:14px;">View in My Portal →</a>
          <p style="font-size:12px;color:#4A6580;margin-top:16px;line-height:1.6;">Questions? Reply to this email — we read every one.</p>
        </div>
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
  adminTickets.unshift(Object.assign({}, newTicket, { customer_email: email, eKey: eKey }));
  await saveToKV("admin_tickets", adminTickets.slice(0, 200));

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
