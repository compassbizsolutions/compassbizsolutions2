/**
 * /api/portal-review
 * POST — Jen approves, edits, or rejects completed work before customer delivery
 * Called from admin dashboard review screen
 * 
 * Actions:
 *   approve  — mark work as approved, deliver to customer portal
 *   edit     — update the deliverable content before delivery
 *   reject   — send back for rework with notes
 *   deliver  — actually push to customer portal + notify them
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

function emailKey(email) {
  return email.toLowerCase().trim().replace(/[^a-z0-9@._-]/g, "");
}

async function sendEmail(to, subject, html) {
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: "Bearer " + process.env.RESEND_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ from: "Compass Business Solutions <reports@compassbizsolutions.com>", to, subject, html })
  });
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-admin-token");
  if (req.method === "OPTIONS") return res.status(200).end();

  // Admin auth only
  const adminToken = req.headers["x-admin-token"] || req.query.token;
  if (adminToken !== (process.env.JEN_PASSWORD || "compass2026")) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    // GET — fetch pending review queue
    if (req.method === "GET") {
      const queue = await getFromKV("admin_review_queue") || [];
      return res.status(200).json({ queue });
    }

    const { action, task_id, customer_email, deliverable, review_notes } = req.body || {};
    if (!action || !task_id || !customer_email) {
      return res.status(400).json({ error: "action, task_id, and customer_email required" });
    }

    const eKey = emailKey(customer_email);
    const now  = new Date().toISOString();

    // Get current review queue
    const queue = await getFromKV("admin_review_queue") || [];
    const taskIdx = queue.findIndex(function(t) { return t.id === task_id; });
    const task = queue[taskIdx];
    if (!task) return res.status(404).json({ error: "Task not found in review queue" });

    // approve_quote — admin edits and approves a quote, sends to customer
    if (action === "approve_quote") {
      const { quote_id, ad_hoc_price, complexity, quote_summary } = req.body || {};
      const eKey = emailKey(customer_email);
      const quotes = await getFromKV("portal_quotes:" + eKey) || [];
      const adminQuotes = await getFromKV("admin_quotes") || [];
      const updated = quotes.map(function(q) {
        return q.id === quote_id ? Object.assign({}, q, {
          ad_hoc_price: ad_hoc_price || q.ad_hoc_price,
          complexity:   complexity   || q.complexity,
          quote_summary: quote_summary || q.quote_summary,
          status: "pending",
          reviewed_at: now,
        }) : q;
      });
      const updatedAdmin = adminQuotes.map(function(q) {
        return q.id === quote_id ? Object.assign({}, q, {
          ad_hoc_price: ad_hoc_price || q.ad_hoc_price,
          complexity:   complexity   || q.complexity,
          quote_summary: quote_summary || q.quote_summary,
          reviewed_at: now,
        }) : q;
      });
      await saveToKV("portal_quotes:" + eKey, updated);
      await saveToKV("admin_quotes", updatedAdmin);
      // Notify customer their quote is ready
      try {
        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: "Bearer " + process.env.RESEND_API_KEY, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: "Compass Business Solutions <reports@compassbizsolutions.com>",
            to: customer_email,
            subject: "Your quote is ready",
            html: "<div style=\"font-family:sans-serif;max-width:560px;background:#0F1E30;padding:28px;border-radius:8px;color:#FAFCFE;\">"
              + "<p style=\"font-size:9px;letter-spacing:3px;text-transform:uppercase;color:#D4820F;font-weight:700;margin-bottom:8px;\">Compass Business Solutions</p>"
              + "<h2 style=\"color:#FAFCFE;margin-bottom:12px;\">Your quote is ready.</h2>"
              + "<p style=\"font-size:14px;color:#c8d8e8;line-height:1.7;margin-bottom:16px;\">" + (quote_summary||"We've reviewed your request and your quote is ready for review.") + "</p>"
              + "<div style=\"background:rgba(212,130,15,0.1);border:1px solid rgba(212,130,15,0.2);border-radius:6px;padding:16px;margin-bottom:20px;\">"
              + "<div style=\"font-size:28px;font-weight:800;color:#D4820F;\">$" + (ad_hoc_price||"") + "</div>"
              + "<div style=\"font-size:12px;color:#7A95B0;margin-top:4px;\">" + (complexity||"") + " complexity &middot; one-time</div>"
              + "</div>"
              + "<a href=\"https://www.compassbizsolutions.com/portal/app\" style=\"background:#D4820F;color:#0C1520;padding:12px 24px;border-radius:5px;text-decoration:none;font-weight:600;font-size:14px;display:inline-block;\">Review & Accept Quote &rarr;</a>"
              + "<p style=\"font-size:11px;color:#4A6580;margin-top:16px;\">Quote valid for 7 days. Questions? Reply to this email.</p>"
              + "</div>"
          })
        });
      } catch(e) { console.error("Quote notify error:", e.message); }
      return res.status(200).json({ success: true, action: "quote_approved", quote_id });
    }

    if (action === "approve" || action === "deliver") {
      // Mark as approved
      queue[taskIdx] = Object.assign({}, task, {
        status:        "approved",
        approved_at:   now,
        deliverable:   deliverable || task.deliverable || "",
        review_notes:  review_notes || "",
      });
      await saveToKV("admin_review_queue", queue);

      // Add to customer's delivered work
      const deliveries = await getFromKV("portal_deliveries:" + eKey) || [];
      const delivery = {
        id:            task_id,
        request_id:    task.request_id,
        service_type:  task.service_type,
        deliverable:   deliverable || task.deliverable || "",
        review_notes:  review_notes || "",
        status:        "delivered",
        delivered_at:  now,
      };
      await saveToKV("portal_deliveries:" + eKey, [delivery, ...deliveries]);

      // Update request status
      const requests = await getFromKV("portal_requests:" + eKey) || [];
      const updatedRequests = requests.map(function(r) {
        return r.id === task.request_id
          ? Object.assign({}, r, { status: "delivered", delivered_at: now })
          : r;
      });
      await saveToKV("portal_requests:" + eKey, updatedRequests);

      // Notify customer
      try {
        await sendEmail(customer_email,
          "Your work is ready — " + task.service_type,
          `<div style="font-family:sans-serif;max-width:560px;background:#0C1520;color:#FAFCFE;">
            <div style="background:#0F1E30;padding:24px 28px;border-bottom:1px solid rgba(120,160,200,0.15);">
              <div style="font-size:9px;letter-spacing:4px;text-transform:uppercase;color:#D4820F;font-weight:600;margin-bottom:4px;">Compass Business Solutions</div>
              <div style="font-family:Georgia,serif;font-size:22px;font-weight:700;color:#FAFCFE;">Your work is ready.</div>
            </div>
            <div style="padding:28px;">
              <p style="font-size:15px;color:#c8d8e8;line-height:1.7;margin-bottom:20px;">Your <strong>${task.service_type}</strong> request has been completed and is waiting for you in your portal.</p>
              ${review_notes ? `<div style="background:rgba(212,130,15,0.08);border:1px solid rgba(212,130,15,0.2);border-radius:6px;padding:16px;margin-bottom:20px;font-size:13px;color:#7A95B0;line-height:1.7;"><strong style="color:#D4820F;display:block;margin-bottom:6px;">Notes from Jen:</strong>${review_notes}</div>` : ""}
              <div style="text-align:center;margin:28px 0;">
                <a href="https://www.compassbizsolutions.com/portal/app" style="background:#D4820F;color:#0C1520;padding:13px 28px;border-radius:5px;text-decoration:none;font-weight:600;font-size:14px;display:inline-block;">View in My Portal →</a>
              </div>
              <p style="font-size:12px;color:#4A6580;line-height:1.6;">Need revisions? Log in to your portal and submit a revision request. We make it right.</p>
            </div>
          </div>`
        );
      } catch(e) { console.error("Delivery email error:", e.message); }

      return res.status(200).json({ success: true, action: "delivered", task_id });
    }

    if (action === "reject") {
      // Send back for rework
      queue[taskIdx] = Object.assign({}, task, {
        status:       "rework",
        rework_at:    now,
        review_notes: review_notes || "",
      });
      await saveToKV("admin_review_queue", queue);
      return res.status(200).json({ success: true, action: "sent_for_rework", task_id });
    }

    if (action === "edit") {
      // Update deliverable content without delivering yet
      queue[taskIdx] = Object.assign({}, task, {
        deliverable:  deliverable || task.deliverable,
        review_notes: review_notes || task.review_notes || "",
        edited_at:    now,
      });
      await saveToKV("admin_review_queue", queue);
      return res.status(200).json({ success: true, action: "edited", task_id });
    }

    return res.status(400).json({ error: "Unknown action: " + action });

  } catch(err) {
    console.error("portal-review error:", err.message);
    return res.status(500).json({ error: "Server error" });
  }
};
