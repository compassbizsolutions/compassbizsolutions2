/**
 * /api/send-diagnostic
 * Sends the diagnostic report to the user AND a copy to Jen
 */
const { Resend } = require("resend");

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { name, email, biz, phone, trade, answers, report } = req.body;
    if (!email || !report) return res.status(400).json({ error: "Missing required fields" });

    const resend = new Resend(process.env.RESEND_API_KEY);
    const firstName = name || "there";

    function getTag(text, tag) {
      const m = text.match(new RegExp("\\[" + tag + "\\]([\\s\\S]*?)(?=\\[|$)"));
      return m ? m[1].trim() : "";
    }

    const headline    = getTag(report, "HEADLINE");
    const whatWeSee   = getTag(report, "WHAT_WE_SEE");
    const topLeak     = getTag(report, "TOP_LEAK");
    const secondLeak  = getTag(report, "SECOND_LEAK");
    const thirdLeak   = getTag(report, "THIRD_LEAK");
    const day30       = getTag(report, "30_DAY");
    const day60       = getTag(report, "60_DAY");
    const day90       = getTag(report, "90_DAY");
    const howWeHelp   = getTag(report, "HOW_WE_HELP");

    const leakBlock = (label, content, color) => content ? `
      <div style="background:white;border-left:4px solid ${color};border-radius:0 8px 8px 0;padding:14px 16px;margin-bottom:10px;border-top:1px solid #D8D4CD;border-right:1px solid #D8D4CD;border-bottom:1px solid #D8D4CD;">
        <div style="font-size:10px;font-weight:bold;color:${color};letter-spacing:2px;margin-bottom:6px;">${label}</div>
        <p style="font-size:13px;color:#3E4E63;line-height:1.75;margin:0;white-space:pre-line;">${content}</p>
      </div>` : "";

    const planBlock = (label, period, content, color) => content ? `
      <div style="background:white;border-radius:8px;padding:14px 16px;border:1px solid #D8D4CD;border-top:3px solid ${color};">
        <div style="font-size:14px;font-weight:bold;color:${color};font-family:Arial,sans-serif;">${period}</div>
        <div style="font-size:11px;color:#6B7A90;margin-bottom:8px;">${label}</div>
        <div style="font-size:12px;color:#3E4E63;line-height:1.7;white-space:pre-line;">${content}</div>
      </div>` : "";

    const html = `
      <div style="font-family:Arial,sans-serif;max-width:620px;margin:0 auto;color:#3E4E63;">
        <div style="background:#1B2E4B;padding:32px 36px;border-radius:8px 8px 0 0;">
          <div style="font-size:10px;color:rgba(255,255,255,0.35);letter-spacing:3px;margin-bottom:10px;">COMPASS BUSINESS SOLUTIONS — FREE DIAGNOSTIC</div>
          ${headline ? `<div style="font-size:22px;font-weight:bold;color:#C8701A;line-height:1.3;">${headline}</div>` : '<div style="font-size:22px;font-weight:bold;color:#C8701A;">Your Business Diagnostic Report</div>'}
          <div style="font-size:13px;color:rgba(255,255,255,0.45);margin-top:8px;">Prepared for ${firstName} — ${biz}</div>
        </div>

        <div style="background:#F7F5F2;padding:32px 36px;border-radius:0 0 8px 8px;border:1px solid #D8D4CD;">
          <p style="font-size:15px;color:#1A2332;font-weight:600;margin-top:0;">Hi ${firstName},</p>
          <p style="color:#3E4E63;line-height:1.7;margin-top:0;">Here is your free diagnostic report for <strong>${biz}</strong>${trade ? " — " + trade : ""}. This is based on everything you shared with us.</p>

          ${whatWeSee ? `<div style="background:white;border-radius:8px;padding:16px 18px;margin-bottom:16px;border:1px solid #D8D4CD;">
            <div style="font-size:10px;font-weight:bold;color:#3D6B9E;letter-spacing:2px;margin-bottom:8px;">WHAT WE SEE</div>
            <p style="font-size:13px;color:#3E4E63;line-height:1.8;margin:0;">${whatWeSee}</p>
          </div>` : ""}

          ${leakBlock("#1 BIGGEST LEAK", topLeak, "#B84C2E")}
          ${leakBlock("#2 LEAK", secondLeak, "#C8701A")}
          ${leakBlock("#3 LEAK", thirdLeak, "#A8782A")}

          <div style="font-size:13px;font-weight:700;color:#1A2332;letter-spacing:1px;margin:24px 0 12px;">YOUR 30/60/90-DAY PLAN</div>
          <div style="display:grid;gap:10px;">
            ${planBlock("Quick Wins", "Days 1-30", day30, "#1E6B45")}
            ${planBlock("Build Systems", "Days 31-60", day60, "#3D6B9E")}
            ${planBlock("Growth Moves", "Days 61-90", day90, "#C8701A")}
          </div>

          ${howWeHelp ? `<div style="background:#1B2E4B;border-radius:8px;padding:16px 18px;margin-top:20px;">
            <div style="font-size:10px;font-weight:bold;color:#C8701A;letter-spacing:2px;margin-bottom:8px;">HOW COMPASS CAN HELP</div>
            <p style="font-size:13px;color:rgba(255,255,255,0.65);line-height:1.8;margin:0;">${howWeHelp}</p>
          </div>` : ""}

          <div style="margin-top:24px;">
            <a href="https://compassbizsolutions.com" style="display:block;text-align:center;background:#C8701A;color:white;font-weight:bold;font-size:14px;padding:14px;border-radius:9px;text-decoration:none;margin-bottom:10px;">See the Fix-It Guides and Templates →</a>
          </div>

          <p style="font-size:13px;color:#6B7A90;margin-bottom:4px;margin-top:20px;">Questions? Reply to this email — I read every one.</p>
          <p style="margin:0;color:#3E4E63;font-size:13px;">— Jen, Compass Business Solutions</p>
        </div>

        <div style="text-align:center;padding:16px;font-size:11px;color:#A0ABBE;">
          Compass Business Solutions &nbsp;·&nbsp; compassbizsolutions.com<br>
          You're receiving this because you completed a free business diagnostic.
        </div>
      </div>`;

    // Send to user
    await resend.emails.send({
      from: process.env.FROM_EMAIL || "reports@compassbizsolutions.com",
      to: email,
      subject: "Your Free Business Diagnostic — " + (biz || "Your Business"),
      html
    });

    // Send copy to Jen with full answers
    const answerDump = Object.entries(answers).map(([k, v]) => `${k}: ${v}`).join("\n");
    await resend.emails.send({
      from: process.env.FROM_EMAIL || "reports@compassbizsolutions.com",
      to: "jen@compassbizsolutions.com",
      subject: "New Diagnostic Lead — " + (biz || "Unknown") + " — " + (answers.trade || "Unknown trade"),
      html: `<pre style="font-family:monospace;font-size:13px;line-height:1.6;">
NEW DIAGNOSTIC SUBMISSION

Name: ${name}
Email: ${email}
Business: ${biz}
Phone: ${phone}
Trade: ${trade}

--- ANSWERS ---
${answerDump}

--- AI REPORT ---
${report}
      </pre>`
    });

    return res.status(200).json({ success: true });
  } catch(err) {
    console.error("send-diagnostic error:", err);
    return res.status(500).json({ error: "Failed", detail: err.message });
  }
};
