/**
 * Vercel Serverless Function: /api/send-scan
 *
 * Sends the Free Quick Scan results email via Resend.
 * No attachments — just a clean HTML email with their teaser report.
 *
 * SETUP:
 *   Environment variables required in Vercel dashboard:
 *     RESEND_API_KEY  — from resend.com
 *     FROM_EMAIL      — reports@compassbizsolutions.com
 */

const { Resend } = require("resend");

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin",  "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")   return res.status(405).json({ error: "Method not allowed" });

  try {
    const { name, email, company, location, trade, total, teaser } = req.body;

    if (!email || !teaser) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const resend = new Resend(process.env.RESEND_API_KEY);
    const firstName = name || "there";
    const bizName = company || "your business";
    const bizLocation = location ? ` — ${location}` : "";
    const tradeName = trade || "Service Business";
    const leakAmount = total ? `$${Math.round(total).toLocaleString()}` : "a significant amount";

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #3E4E63;">

        <!-- Header -->
        <div style="background: #1B2E4B; padding: 32px 36px; border-radius: 8px 8px 0 0;">
          <div style="font-size: 10px; color: rgba(255,255,255,0.35); letter-spacing: 3px; margin-bottom: 10px;">COMPASS BUSINESS SOLUTIONS</div>
          <div style="font-size: 22px; font-weight: bold; color: #C8701A; line-height: 1.3;">Your Free Profit Leak Scan Results</div>
          <div style="font-size: 13px; color: rgba(255,255,255,0.45); margin-top: 8px;">Here's what we found — and what to do about it.</div>
        </div>

        <!-- Body -->
        <div style="background: #F7F5F2; padding: 32px 36px; border-radius: 0 0 8px 8px; border: 1px solid #D8D4CD;">

          <p style="font-size: 15px; color: #1A2332; font-weight: 600; margin-top: 0;">Hi ${firstName},</p>
          <p style="color: #3E4E63; line-height: 1.7; margin-top: 0;">Here are your Free Profit Leak Scan results for <strong>${bizName}${bizLocation}</strong> — ${tradeName}.</p>

          <!-- Leak number callout -->
          <div style="background: #1B2E4B; border-radius: 10px; padding: 24px; text-align: center; margin: 0 0 24px;">
            <div style="font-size: 11px; color: rgba(255,255,255,0.35); letter-spacing: 3px; margin-bottom: 8px;">YOUR ESTIMATED ANNUAL PROFIT LEAK</div>
            <div style="font-size: 52px; font-weight: 900; color: #C8701A; line-height: 1;">${leakAmount}</div>
            <div style="font-size: 11px; color: rgba(255,255,255,0.3); margin-top: 8px;">Based on 5 of 10 leak categories — the real number is likely higher.</div>
          </div>

          <!-- AI teaser content -->
          <div style="background: white; border-radius: 8px; padding: 20px 24px; margin-bottom: 20px; border: 1px solid #D8D4CD; white-space: pre-line; font-size: 13px; line-height: 1.75; color: #3E4E63;">
${teaser}
          </div>

          <!-- CTA — Full DIY Package -->
          <div style="background: white; border-left: 4px solid #C8701A; border-radius: 0 8px 8px 0; padding: 18px 20px; margin-bottom: 20px; border-top: 1px solid #D8D4CD; border-right: 1px solid #D8D4CD; border-bottom: 1px solid #D8D4CD;">
            <div style="font-size: 11px; font-weight: bold; color: #C8701A; letter-spacing: 2px; margin-bottom: 8px;">WANT THE FULL PICTURE?</div>
            <p style="margin: 0 0 12px; font-size: 13px; color: #3E4E63; line-height: 1.65;">
              This scan covers 5 of 10 leak categories. The <strong>Full DIY Package</strong> covers all 10 — leaks ranked by dollar amount, a customized prioritized to-do list, all 10 Fix-It Guides, and all 8 Process Doc templates. Everything delivered to your inbox.
            </p>
            <a href="https://compassbizsolutions.com" style="display: inline-block; background: #C8701A; color: white; font-weight: bold; font-size: 13px; padding: 10px 20px; border-radius: 7px; text-decoration: none;">Get the Full DIY Package — $399 →</a>
          </div>

          <!-- CTA — DIY Guides -->
          <div style="background: white; border-radius: 8px; padding: 18px 20px; margin-bottom: 24px; border: 1px solid #D8D4CD;">
            <div style="font-size: 11px; font-weight: bold; color: #3D6B9E; letter-spacing: 2px; margin-bottom: 8px;">RATHER FIX IT YOURSELF?</div>
            <p style="margin: 0 0 12px; font-size: 13px; color: #3E4E63; line-height: 1.65;">
              The <strong>Fix-It Guide Bundle</strong> gives you all 10 plain-language guides — one for each leak category. Read it, apply it, done.
            </p>
            <a href="https://compassbizsolutions.com" style="display: inline-block; background: #3D6B9E; color: white; font-weight: bold; font-size: 13px; padding: 10px 20px; border-radius: 7px; text-decoration: none;">Get the Fix-It Bundle — $199 →</a>
          </div>

          <p style="font-size: 13px; color: #6B7A90; margin-bottom: 4px;">Questions? Reply to this email — I read every one.</p>
          <p style="margin: 0; color: #3E4E63; font-size: 13px;">— Compass Business Solutions</p>
        </div>

        <!-- Footer -->
        <div style="text-align: center; padding: 16px; font-size: 11px; color: #A0ABBE;">
          Compass Business Solutions &nbsp;·&nbsp; compassbizsolutions.com
          <br>You're receiving this because you ran a Free Profit Leak Scan.
        </div>

      </div>
    `;

    await resend.emails.send({
      from:    process.env.FROM_EMAIL || "reports@compassbizsolutions.com",
      to:      email,
      subject: `Your ${tradeName} Profit Leak Scan — ${bizName} — ${leakAmount} estimated`,
      html,
    });

    return res.status(200).json({ success: true });

  } catch (err) {
    console.error("send-scan error:", err);
    return res.status(500).json({ error: "Failed to send email", detail: err.message });
  }
}
