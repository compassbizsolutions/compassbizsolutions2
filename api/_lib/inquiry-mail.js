/**
 * Outbound email for the inquiry assistant: customer replies and alerts to Jen.
 */
const { Resend } = require("resend");
const { TEAM_FROM, REPLY_TO, ALERT_FROM, JEN_EMAIL } = require("./inquiry-config");

const resend = new Resend(process.env.RESEND_API_KEY);

function esc(s) {
  return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Same branded layout as manual replies sent from the admin.
async function sendCustomerEmail({ to, subject, body }) {
  const html = body.split("\n").map(line =>
    line.trim() === "" ? "<br>" :
    `<p style="margin:0 0 10px;font-family:Arial,sans-serif;font-size:14px;color:#1A2332;line-height:1.75;">${esc(line)}</p>`
  ).join("");
  const result = await resend.emails.send({
    from: TEAM_FROM,
    to,
    reply_to: REPLY_TO,
    subject,
    text: body,
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
      <div style="background:#1B2E4B;padding:18px 28px;border-radius:8px 8px 0 0;">
        <div style="font-size:9px;color:rgba(255,255,255,0.35);letter-spacing:3px;">COMPASS BUSINESS SOLUTIONS</div>
      </div>
      <div style="background:#F7F5F2;padding:22px 28px;border-radius:0 0 8px 8px;border:1px solid #D8D4CD;border-top:none;">
        ${html}
      </div>
    </div>`,
  });
  if (result.error) throw new Error(result.error.message);
}

async function alertJen({ subject, lines, draft }) {
  const result = await resend.emails.send({
    from: ALERT_FROM,
    to: JEN_EMAIL,
    subject,
    html: `<div style="font-family:Arial,sans-serif;max-width:520px;font-size:13px;color:#1A2332;line-height:1.7;">
      ${lines.map(l => `<p style="margin:0 0 6px;">${l}</p>`).join("")}
      ${draft ? `<div style="background:#F7F5F2;border-left:3px solid #C8701A;padding:14px;margin:12px 0;white-space:pre-wrap;">${esc(draft)}</div>` : ""}
      <a href="https://admin.compassbizsolutions.com" style="display:inline-block;background:#1B2E4B;color:white;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:bold;">Open Admin →</a>
    </div>`,
  });
  if (result.error) throw new Error(result.error.message);
}

module.exports = { sendCustomerEmail, alertJen, esc };
