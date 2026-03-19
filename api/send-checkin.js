/**
 * /api/send-checkin
 * Called by Mailchimp automation OR manually triggered
 * Sends day 7, 15, 21, 28 check-in emails
 * body: { email, day }
 */
const { Resend } = require("resend");

async function getFromKV(email) {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  const key = "diagnostic:" + email.toLowerCase().replace(/[^a-z0-9@._-]/g, "");
  try {
    const res = await fetch(url + "/get/" + encodeURIComponent(key), {
      headers: { Authorization: "Bearer " + token }
    });
    const data = await res.json();
    return data.result ? JSON.parse(data.result) : null;
  } catch(e) { return null; }
}

const EMAILS = {
  7: {
    subject: "Day 7 check-in — how's it going?",
    heading: "One week in.",
    body: function(firstName, biz, topLeak) {
      return "You ran your free diagnostic a week ago" + (topLeak ? " and your biggest leak was " + topLeak + "." : ".") + " Just checking in to see if anything has moved.\n\nNo pressure — even knowing where the problem is puts you ahead of most. The ones who fix it fastest are the ones who pick one thing and start there, not ten things at once.\n\nIf you have not started yet, that is completely normal. If you have questions or hit a wall, just reply to this email.";
    }
  },
  15: {
    subject: "Day 15 — halfway through your first 30 days",
    heading: "Halfway there.",
    body: function(firstName, biz, topLeak) {
      return "Two weeks since your diagnostic. If you have been working on " + (topLeak || "your top leak") + ", you should be starting to see some movement by now — even small things like invoices going out same day or one fewer parts run a week add up fast.\n\nIf things have stalled, that is also normal. Most owners hit a wall around week two because the day-to-day gets in the way. That is exactly what the 30-day plan is designed to help with — specific, sequenced actions that do not require you to stop running the business.";
    }
  },
  21: {
    subject: "Nine days left in your first 30 — quick check",
    heading: "Nine days left.",
    body: function(firstName, biz, topLeak) {
      return "You are nine days from the end of your first 30-day window. How is it going?\n\nAt day 28 we will ask you one simple question about your progress. Based on your answer, we either move you into the 60-day phase — which picks up where you left off and addresses your next tier of leaks — or we get on a quick call to see what you need.\n\nNothing to do right now except keep going. If something is stuck or not making sense, just reply to this email.";
    }
  },
  28: {
    subject: "Your 30-day plan ends in 3 days — how did it go?",
    heading: "Three days left.",
    body: function(firstName, biz, topLeak) {
      return "Your first 30-day window closes in three days. Before we talk about what's next, one question:\n\nDid you feel like you made progress? Even partial progress counts — one thing implemented, one habit changed, one process that now runs without you thinking about it. Reply to this email and tell us what happened. A sentence or two is enough.\n\nBased on what you share, we'll either set you up with your 60-day plan or get on a quick call to figure out what got in the way. Either is fine — this isn't a test.";
    }
  }
};

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { email, day } = req.body;
    if (!email || !day) return res.status(400).json({ error: "Missing email or day" });

    const template = EMAILS[parseInt(day)];
    if (!template) return res.status(400).json({ error: "Invalid day" });

    // Pull their data from KV
    const stored = await getFromKV(email);
    const firstName = stored?.name || "there";
    const biz = stored?.biz || "your business";
    const topLeak = stored?.report ? (stored.report.match(/\[TOP_LEAK\]([\s\S]*?)(?=\[|$)/) || [])[1]?.trim()?.split("\n")[0] || "" : "";

    const resend = new Resend(process.env.RESEND_API_KEY);
    const bodyText = template.body(firstName, biz, topLeak);

    const html = `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#3E4E63;">
        <div style="background:#1B2E4B;padding:28px 36px;border-radius:8px 8px 0 0;">
          <div style="font-size:10px;color:rgba(255,255,255,0.35);letter-spacing:3px;margin-bottom:8px;">COMPASS BUSINESS SOLUTIONS — DAY ${day} CHECK-IN</div>
          <div style="font-size:20px;font-weight:bold;color:#C8701A;">${template.heading}</div>
        </div>
        <div style="background:#F7F5F2;padding:28px 36px;border-radius:0 0 8px 8px;border:1px solid #D8D4CD;">
          <p style="font-size:15px;color:#1A2332;font-weight:600;margin-top:0;">Hi ${firstName},</p>
          <p style="color:#3E4E63;line-height:1.8;white-space:pre-line;">${bodyText}</p>
          ${day >= 21 ? `
          <div style="margin:24px 0;">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td width="48%" style="padding-right:8px;">
                  <a href="https://compassbizsolutions.com" style="display:block;text-align:center;background:#C8701A;color:white;font-weight:bold;font-size:13px;padding:12px;border-radius:8px;text-decoration:none;">Get Days 31-60 Plan — $249</a>
                </td>
                <td width="48%" style="padding-left:8px;">
                  <a href="https://compassbizsolutions.com/calendly" style="display:block;text-align:center;background:rgba(27,46,75,0.8);color:white;font-weight:bold;font-size:13px;padding:12px;border-radius:8px;text-decoration:none;">Book a Call Instead</a>
                </td>
              </tr>
            </table>
          </div>` : ""}
          <p style="font-size:13px;color:#6B7A90;margin-bottom:4px;">Reply to this email any time — I read every one.</p>
          <p style="margin:0;color:#3E4E63;font-size:13px;">— Jen, Compass Business Solutions</p>
        </div>
        <div style="text-align:center;padding:14px;font-size:11px;color:#A0ABBE;">
          Compass Business Solutions &nbsp;·&nbsp; compassbizsolutions.com
        </div>
      </div>`;

    await resend.emails.send({
      from: process.env.FROM_EMAIL || "reports@compassbizsolutions.com",
      to: email,
      subject: template.subject,
      html
    });

    return res.status(200).json({ success: true });

  } catch(err) {
    console.error("send-checkin error:", err);
    return res.status(500).json({ error: "Failed", detail: err.message });
  }
};
