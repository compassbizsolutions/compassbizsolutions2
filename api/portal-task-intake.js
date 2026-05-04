/**
 * /api/portal-task-intake
 * POST — captures delivery preferences after purchase
 * GET  — fetch task intake for a specific order
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

// Calculate next delivery date (at least 24hrs before deadline)
function getDeliveryTarget(frequency, deliveryDay, deliveryTime, oneTimeDeadline) {
  const now = new Date();

  if (frequency === "one-time" && oneTimeDeadline) {
    const deadline = new Date(oneTimeDeadline);
    const deliveryTarget = new Date(deadline.getTime() - 24 * 60 * 60 * 1000);
    return {
      next_delivery: deliveryTarget.toISOString(),
      deadline: deadline.toISOString(),
      is_recurring: false
    };
  }

  // Recurring — find next occurrence of deliveryDay at least 24hrs before deliveryTime
  const days = ["sunday","monday","tuesday","wednesday","thursday","friday","saturday"];
  const targetDay = days.indexOf((deliveryDay || "friday").toLowerCase());
  const [hours, minutes] = (deliveryTime || "09:00").split(":").map(Number);

  // Work backward — delivery is 24hrs before their desired time
  let deliveryDate = new Date();
  deliveryDate.setHours(hours - 24 < 0 ? hours + 24 : hours - 24, minutes, 0, 0);
  if (hours < 24) deliveryDate.setDate(deliveryDate.getDate() - 1);

  // Find the next occurrence of targetDay
  let daysUntil = (targetDay - now.getDay() + 7) % 7;
  if (daysUntil === 0 && now.getHours() >= hours - 24) daysUntil = 7;
  const nextDeadline = new Date(now);
  nextDeadline.setDate(now.getDate() + daysUntil);
  nextDeadline.setHours(hours, minutes, 0, 0);

  const nextDelivery = new Date(nextDeadline.getTime() - 24 * 60 * 60 * 1000);

  return {
    next_delivery: nextDelivery.toISOString(),
    deadline: nextDeadline.toISOString(),
    is_recurring: true,
    frequency: frequency,
    delivery_day: deliveryDay,
    delivery_time: deliveryTime,
  };
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const authHeader = req.headers.authorization || "";
    const sessionToken = authHeader.replace("Bearer ", "").trim();
    const email = await validateSession(sessionToken);
    if (!email) return res.status(401).json({ error: "Unauthorized" });

    const eKey = emailKey(email);

    if (req.method === "GET") {
      const intakes = await getFromKV("portal_task_intakes:" + eKey) || [];
      return res.status(200).json({ intakes });
    }

    if (req.method === "POST") {
      const {
        quote_id, service_type, stripe_session_id,
        frequency,          // one-time | weekly | monthly
        delivery_day,       // monday–sunday (for recurring)
        delivery_time,      // HH:MM (24hr, their local)
        one_time_deadline,  // date string (for one-time)
        specific_details,   // additional details after purchase
        access_info,        // logins, links, access needed
        files,              // Google Drive link
        attachment,         // base64 file
      } = req.body || {};

      if (!frequency) return res.status(400).json({ error: "Frequency required" });

      const schedule = getDeliveryTarget(frequency, delivery_day, delivery_time, one_time_deadline);

      const intake = {
        id:               "intake_" + Date.now(),
        quote_id,
        service_type,
        stripe_session_id,
        frequency,
        delivery_day,
        delivery_time,
        one_time_deadline,
        specific_details,
        access_info,
        files,
        attachment:       attachment ? { name: attachment.name, size: attachment.size, type: attachment.type } : null,
        schedule,
        status:           "active",
        created_at:       new Date().toISOString(),
      };

      // Save task intake
      const existing = await getFromKV("portal_task_intakes:" + eKey) || [];
      await saveToKV("portal_task_intakes:" + eKey, [intake, ...existing]);

      // Save to admin active tasks
      const adminTasks = await getFromKV("admin_active_tasks") || [];
      await saveToKV("admin_active_tasks", [{
        ...intake,
        customer_email: email,
        eKey,
      }, ...adminTasks]);

      // Email confirmation to customer
      try {
        const scheduleMsg = schedule.is_recurring
          ? `Delivered every ${frequency} by ${delivery_day} at ${delivery_time} (at least 24 hours before your deadline)`
          : `One-time delivery by ${new Date(schedule.next_delivery).toLocaleDateString("en-US", { weekday:"long", month:"long", day:"numeric" })}`;

        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: "Bearer " + process.env.RESEND_API_KEY, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: "Compass Business Solutions <reports@compassbizsolutions.com>",
            to: email,
            subject: `You're all set — ${service_type}`,
            html: `
            <div style="font-family:sans-serif;max-width:580px;margin:0 auto;background:#F4F7FC;">
              <div style="background:#111E31;padding:24px 28px;border-radius:8px 8px 0 0;">
                <div style="font-size:10px;letter-spacing:3px;color:#C8701A;text-transform:uppercase;font-weight:700;margin-bottom:4px;">Compass Business Solutions</div>
                <div style="font-size:22px;font-weight:900;color:#F4F7FC;text-transform:uppercase;letter-spacing:1px;">You're All Set!</div>
              </div>
              <div style="background:white;padding:28px;border:1px solid #C8D6E8;border-top:none;">
                <p style="font-size:15px;color:#1B2E4B;line-height:1.6;">Your <strong>${service_type}</strong> task is confirmed and scheduled. Here's what to expect:</p>
                <div style="background:#F4F7FC;border-radius:8px;padding:18px;margin:16px 0;">
                  <div style="font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#8aa5c0;margin-bottom:12px;">YOUR SCHEDULE</div>
                  <div style="font-size:15px;font-weight:600;color:#1E6B45;margin-bottom:8px;">✓ ${scheduleMsg}</div>
                  <div style="font-size:14px;color:#5A7291;">First delivery: ${new Date(schedule.next_delivery).toLocaleDateString("en-US", { weekday:"long", month:"long", day:"numeric", hour:"2-digit", minute:"2-digit" })}</div>
                </div>
                <p style="font-size:14px;color:#1B2E4B;line-height:1.6;">We'll deliver your completed work to your portal and send you an email notification when it's ready. Log in to download and review.</p>
                <div style="text-align:center;margin:24px 0;">
                  <a href="https://www.compassbizsolutions.com/portal" style="background:#C8701A;color:white;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px;display:inline-block;">Go to My Portal →</a>
                </div>
                <p style="font-size:12px;color:#8aa5c0;">Questions? Reply to this email or message us in your portal.</p>
              </div>
            </div>`
          })
        });

        // Notify Jen with full details
        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: "Bearer " + process.env.RESEND_API_KEY, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: "Compass Portal <reports@compassbizsolutions.com>",
            to: "reports@compassbizsolutions.com",
            subject: `New Active Task — ${service_type} (${email})`,
            html: `<div style="font-family:sans-serif;max-width:500px;">
              <h2 style="color:#C8701A;">New Active Task</h2>
              <p><strong>Customer:</strong> ${email}</p>
              <p><strong>Service:</strong> ${service_type}</p>
              <p><strong>Frequency:</strong> ${frequency}</p>
              <p><strong>Schedule:</strong> ${scheduleMsg}</p>
              <p><strong>Next delivery due:</strong> ${new Date(schedule.next_delivery).toLocaleString()}</p>
              ${specific_details ? `<p><strong>Additional details:</strong> ${specific_details}</p>` : ""}
              ${access_info ? `<p><strong>Access info:</strong> ${access_info}</p>` : ""}
              ${files ? `<p><strong>Files:</strong> <a href="${files}">${files}</a></p>` : ""}
              ${attachment ? `<p><strong>Attachment:</strong> ${attachment.name} (${(attachment.size/1024).toFixed(1)} KB)</p>` : ""}
            </div>`
          })
        });
      } catch(emailErr) {
        console.error("Task intake email error:", emailErr.message);
      }

      return res.status(200).json({ success: true, intake, schedule });
    }

  } catch(err) {
    console.error("portal-task-intake error:", err.message);
    return res.status(500).json({ error: "Server error" });
  }
};
