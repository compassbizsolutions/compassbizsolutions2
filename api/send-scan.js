/**
 * Vercel Serverless Function: /api/send-scan
 *
 * 1. Sends the Free Quick Scan results email via Resend
 * 2. Subscribes the user to Mailchimp with merge tags for personalization
 *
 * ENVIRONMENT VARIABLES (Vercel dashboard):
 *   RESEND_API_KEY        — from resend.com
 *   FROM_EMAIL            — reports@compassbizsolutions.com
 *   MAILCHIMP_API_KEY     — from mailchimp.com → Account → Extras → API Keys
 *   MAILCHIMP_AUDIENCE_ID — 570585
 *   MAILCHIMP_DC          — us3
 */

const { Resend } = require("resend");

// ── Mailchimp subscribe ──────────────────────────────────────────────────────
async function subscribeToMailchimp({ email, firstName, company, location, trade, leakAmount }) {
  const dc     = process.env.MAILCHIMP_DC || "us3";
  const listId = process.env.MAILCHIMP_AUDIENCE_ID;
  const apiKey = process.env.MAILCHIMP_API_KEY;

  if (!apiKey || !listId) {
    console.warn("Mailchimp env vars not set — skipping subscribe");
    return;
  }

  const url  = `https://${dc}.api.mailchimp.com/3.0/lists/${listId}/members`;
  const body = {
    email_address: email,
    status:        "subscribed",
    merge_fields: {
      FNAME:    firstName  || "",
      COMPANY:  company   || "",
      LOCATION: location  || "",
      TRADE:    trade     || "",
      LEAK:     leakAmount || "",
    },
    tags: ["free-scan", trade || "unknown-trade"],
  };

  const response = await fetch(url, {
    method:  "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Basic ${Buffer.from(`anystring:${apiKey}`).toString("base64")}`,
    },
    body: JSON.stringify(body),
  });

  const data = await response.json();

  if (!response.ok && data.title !== "Member Exists") {
    console.error("Mailchimp error:", data.title, data.detail);
  } else {
    console.log(`Mailchimp: ${data.title === "Member Exists" ? "already subscribed" : "subscribed"} — ${email}`);
  }
}

// ── Tag parser — extracts content between [TAG] markers ─────────────────────
function getTag(text, tag) {
  const m = text.match(new RegExp(`\\[${tag}\\]([\\s\\S]*?)(?=\\[|$)`));
  return m ? m[1].trim() : "";
}

// ── Handler ──────────────────────────────────────────────────────────────────
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

    const resend      = new Resend(process.env.RESEND_API_KEY);
    const firstName   = name || "there";
    const bizName     = company || "your business";
    const bizLocation = location ? ` — ${location}` : "";
    const tradeName   = trade || "Service Business";
    const leakAmount  = total ? `$${Math.round(total).toLocaleString()}` : "a significant amount";

    const headline    = getTag(teaser, "HEADLINE");
    const whatFound   = getTag(teaser, "WHAT_WE_FOUND");
    const topLeak     = getTag(teaser, "TOP_LEAK");
    const secondLeak  = getTag(teaser, "SECOND_LEAK");
    const leakTotal   = getTag(teaser, "LEAK_TOTAL");
    const whatMissing = getTag(teaser, "WHATS_MISSING");
    const upgradeHook = getTag(teaser, "UPGRADE_HOOK");
    const docsHook    = getTag(teaser, "DOCS_HOOK");

    // Bullet rendering
    const bulletLines = (text) => text.split("\n").filter(l => l.trim()).map(line =>
      `<div style="display:flex;gap:8px;margin-bottom:6px;align-items:flex-start;">
        <span style="color:#3D6B9E;font-weight:bold;flex-shrink:0;">•</span>
        <span style="font-size:13px;color:#3E4E63;line-height:1.6;">${line.replace(/^•\s*/,"")}</span>
      </div>`
    ).join("");

    // Structured leak block
    const leakBlock = (label, content, color) => {
      if (!content) return "";
      const lines = content.split("\n").filter(l => l.trim());
      const title = lines[0] || "";
      const why   = lines[1] || "";
      const fix   = lines.find(l => l.startsWith("→")) || "";
      return `
        <div style="background:white;border-left:4px solid ${color};border-radius:0 8px 8px 0;padding:14px 16px;margin-bottom:10px;border:1px solid #D8D4CD;border-left:4px solid ${color};">
          <div style="font-size:10px;font-weight:bold;color:${color};letter-spacing:2px;margin-bottom:8px;">${label}</div>
          ${title ? `<div style="font-size:13px;font-weight:bold;color:#1A2332;margin-bottom:4px;">${title}</div>` : ""}
          ${why   ? `<div style="font-size:12px;color:#3E4E63;line-height:1.65;margin-bottom:6px;">${why}</div>` : ""}
          ${fix   ? `<div style="font-size:12px;color:${color};font-weight:700;padding-top:6px;border-top:1px solid #D8D4CD;">${fix}</div>` : ""}
        </div>`;
    };

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #3E4E63;">
        <div style="background: #1B2E4B; padding: 32px 36px; border-radius: 8px 8px 0 0;">
          <div style="font-size: 10px; color: rgba(255,255,255,0.35); letter-spacing: 3px; margin-bottom: 10px;">COMPASS BUSINESS SOLUTIONS</div>
          <div style="font-size: 22px; font-weight: bold; color: #C8701A; line-height: 1.3;">Your Free Profit Leak Scan Results</div>
          <div style="font-size: 13px; color: rgba(255,255,255,0.45); margin-top: 8px;">Here's what we found — and what to do about it.</div>
        </div>
        <div style="background: #F7F5F2; padding: 32px 36px; border-radius: 0 0 8px 8px; border: 1px solid #D8D4CD;">
          <p style="font-size: 15px; color: #1A2332; font-weight: 600; margin-top: 0;">Hi ${firstName},</p>
          <p style="color: #3E4E63; line-height: 1.7; margin-top: 0;">Here are your Free Profit Leak Scan results for <strong>${bizName}${bizLocation}</strong> — ${tradeName}.</p>

          <!-- Leak number callout -->
          <div style="background: #1B2E4B; border-radius: 10px; padding: 24px; text-align: center; margin: 0 0 24px;">
            <div style="font-size: 11px; color: rgba(255,255,255,0.35); letter-spacing: 3px; margin-bottom: 8px;">YOUR ESTIMATED ANNUAL PROFIT LEAK</div>
            <div style="font-size: 52px; font-weight: 900; color: #C8701A; line-height: 1;">${leakAmount}</div>
            <div style="font-size: 11px; color: rgba(255,255,255,0.3); margin-top: 8px;">Based on 5 of 10 leak categories — the real number is likely higher.</div>
          </div>

          ${headline ? `<p style="font-size: 16px; font-weight: 700; color: #1A2332; line-height: 1.5; margin-bottom: 16px;">${headline}</p>` : ""}

          ${whatFound ? `
          <div style="background: white; border-radius: 8px; padding: 18px 20px; margin-bottom: 16px; border: 1px solid #D8D4CD;">
            <div style="font-size: 10px; font-weight: bold; color: #3D6B9E; letter-spacing: 2px; margin-bottom: 10px;">WHAT WE FOUND</div>
            ${bulletLines(whatFound)}
          </div>` : ""}

          ${leakBlock("#1 BIGGEST LEAK", topLeak, "#B84C2E")}
          ${leakBlock("#2 BIGGEST LEAK", secondLeak, "#C8701A")}

          ${leakTotal ? `
          <div style="background:#B84C2E;border-radius:8px;padding:14px 18px;margin-bottom:16px;text-align:center;">
            <div style="font-size:10px;font-weight:bold;color:rgba(255,255,255,0.7);letter-spacing:2px;margin-bottom:4px;">BOTTOM LINE</div>
            <div style="font-size:16px;font-weight:bold;color:white;">${leakTotal}</div>
            <div style="font-size:10px;color:rgba(255,255,255,0.5);margin-top:4px;">Based on 5 of 10 leak categories — the real number is likely higher.</div>
          </div>` : ""}

          <!-- CTA — Full DIY Package -->
          <div style="background: white; border-left: 4px solid #C8701A; border-radius: 0 8px 8px 0; padding: 18px 20px; margin-bottom: 16px; border-top: 1px solid #D8D4CD; border-right: 1px solid #D8D4CD; border-bottom: 1px solid #D8D4CD;">
            <div style="font-size: 11px; font-weight: bold; color: #C8701A; letter-spacing: 2px; margin-bottom: 8px;">WANT THE FULL PICTURE?</div>
            ${upgradeHook ? `<p style="margin: 0 0 12px; font-size: 13px; color: #3E4E63; line-height: 1.65;">${upgradeHook}</p>` : `<p style="margin: 0 0 12px; font-size: 13px; color: #3E4E63; line-height: 1.65;">This scan covers 5 of 10 leak categories. The <strong>Full DIY Package</strong> covers all 10 — leaks ranked by dollar amount, a customized prioritized to-do list, all 10 Fix-It Guides, and all 12 Process Doc templates.</p>`}
            <a href="https://compassbizsolutions.com" style="display: inline-block; background: #C8701A; color: white; font-weight: bold; font-size: 13px; padding: 10px 20px; border-radius: 7px; text-decoration: none;">Get the Full DIY Package — $599 →</a>
          </div>

          ${docsHook ? `
          <div style="background: #EBF0F7; border-radius: 8px; padding: 16px 18px; margin-bottom: 16px; border: 1px solid #C0CFE0;">
            <div style="font-size: 10px; font-weight: bold; color: #1B2E4B; letter-spacing: 2px; margin-bottom: 6px;">📋 DOCUMENT THE PROCESS</div>
            <p style="font-size: 13px; color: #1B2E4B; line-height: 1.65; margin: 0 0 10px;">${docsHook}</p>
            <a href="https://compassbizsolutions.com" style="display: inline-block; background: #1B2E4B; color: white; font-weight: bold; font-size: 12px; padding: 8px 16px; border-radius: 6px; text-decoration: none;">See Process Docs →</a>
          </div>` : ""}

          <!-- CTA — DIY Guides -->
          <div style="background: white; border-radius: 8px; padding: 18px 20px; margin-bottom: 24px; border: 1px solid #D8D4CD;">
            <div style="font-size: 11px; font-weight: bold; color: #3D6B9E; letter-spacing: 2px; margin-bottom: 8px;">RATHER FIX IT YOURSELF?</div>
            <p style="margin: 0 0 12px; font-size: 13px; color: #3E4E63; line-height: 1.65;">The <strong>Fix-It Guide Bundle</strong> gives you all 10 plain-language guides — one for each leak category.</p>
            <a href="https://compassbizsolutions.com" style="display: inline-block; background: #3D6B9E; color: white; font-weight: bold; font-size: 13px; padding: 10px 20px; border-radius: 7px; text-decoration: none;">Get the Fix-It Bundle — $199 →</a>
          </div>

          <p style="font-size: 13px; color: #6B7A90; margin-bottom: 4px;">Questions? Reply to this email — I read every one.</p>
          <p style="margin: 0; color: #3E4E63; font-size: 13px;">— Jen, Compass Business Solutions</p>
        </div>
        <div style="text-align: center; padding: 16px; font-size: 11px; color: #A0ABBE;">
          Compass Business Solutions &nbsp;·&nbsp; compassbizsolutions.com<br>
          You're receiving this because you ran a Free Profit Leak Scan.
        </div>
      </div>
    `;

    await resend.emails.send({
      from:    process.env.FROM_EMAIL || "reports@compassbizsolutions.com",
      to:      email,
      subject: `Your ${tradeName} Profit Leak Scan — ${bizName} — ${leakAmount} estimated`,
      html,
    });

    // Fire and forget — don't block the response
    subscribeToMailchimp({ email, firstName, company, location, trade: tradeName, leakAmount })
      .catch(e => console.warn("Mailchimp failed:", e.message));

    return res.status(200).json({ success: true });

  } catch (err) {
    console.error("send-scan error:", err);
    return res.status(500).json({ error: "Failed to send email", detail: err.message });
  }
};
