/**
 * /api/send-diagnostic
 * Sends the free diagnostic report to user + copy to Jen
 * Stores answers in Vercel KV for future check-ins
 * Tags user in Mailchimp as "free-diagnostic"
 */
const { Resend } = require("resend");

async function storeInKV(email, data) {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) return;
  const key = "diagnostic:" + email.toLowerCase().replace(/[^a-z0-9@._-]/g, "");
  await fetch(url + "/set/" + encodeURIComponent(key), {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify(data)
  });
}

async function tagMailchimp(email, name, trade) {
  const dc = process.env.MAILCHIMP_DC || "us3";
  const listId = process.env.MAILCHIMP_AUDIENCE_ID;
  const apiKey = process.env.MAILCHIMP_API_KEY;
  if (!apiKey || !listId) return;
  const url = "https://" + dc + ".api.mailchimp.com/3.0/lists/" + listId + "/members";
  await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Basic " + Buffer.from("anystring:" + apiKey).toString("base64")
    },
    body: JSON.stringify({
      email_address: email,
      status: "subscribed",
      merge_fields: { FNAME: name || "", TRADE: trade || "" },
      tags: ["free-diagnostic"]
    })
  }).catch(function() {});
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { name, email, biz, phone, trade, answers, report, utm_source, utm_campaign, utm_medium } = req.body;
    if (!email || !report) return res.status(400).json({ error: "Missing required fields" });

    const resend = new Resend(process.env.RESEND_API_KEY);

    // Store lead in KV (non-blocking — don't let KV failure stop email)
    storeInKV(email, {
      name, email, biz, phone, trade,
      top_leak: answers?.leak1 || '',
      source: 'free-diagnostic',
      utm_source: utm_source || '',
      utm_campaign: utm_campaign || '',
      created_at: new Date().toISOString()
    });
    const firstName = name || "there";

    function getTag(text, tag) {
      const m = text.match(new RegExp("\\[" + tag + "\\]([\\s\\S]*?)(?=\\[|$)"));
      return m ? m[1].trim() : "";
    }

    const headline   = getTag(report, "HEADLINE");
    const whatWeSee  = getTag(report, "WHAT_WE_SEE");
    const topLeak    = stripThirdBullet(getTag(report, "TOP_LEAK"));
    const secondLeak = stripThirdBullet(getTag(report, "SECOND_LEAK"));
    const thirdLeak  = stripThirdBullet(getTag(report, "THIRD_LEAK"));
    const howWeHelp  = getTag(report, "HOW_WE_HELP");
    const additionalLeaksRaw = getTag(report, "ADDITIONAL_LEAKS") || "";
    const additionalLeaks = additionalLeaksRaw
      .split("\n")
      .map(l => l.trim())
      .filter(l => l && /—/.test(l) && !l.toLowerCase().includes("have a specific"))
      .map(l => {
        const parts = l.split(" — ");
        return { name: (parts[0] || "").replace(/^\d+\.\s*/, "").trim(), detail: (parts[1] || "").trim() };
      });

    // Hard strip any third bullet from leak blocks regardless of AI output
    function stripThirdBullet(text) {
      if (!text) return text;
      var lines = text.split("\n");
      var bulletCount = 0;
      var result = [];
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i];
        if (/^-\s+/.test(line.trim())) {
          bulletCount++;
          if (bulletCount >= 3) continue; // skip 3rd bullet and beyond
        }
        result.push(line);
      }
      return result.join("\n");
    }

    // Two render functions:
    // renderBoldHeadline = for use inside amber headline (strong stays amber)
    // renderBold = for use in body text (strong stays navy)
    function renderBoldHeadline(text) {
      if (!text) return "";
      return String(text).replace(/\*\*(.+?)\*\*/g, '<strong style="color:#C8701A;font-weight:700">$1</strong>');
    }
    function renderBold(text) {
      if (!text) return "";
      return String(text).replace(/\*\*(.+?)\*\*/g, '<strong style="color:#1A2332;font-weight:700">$1</strong>');
    }

    // Convert bullet lines (- item\n- item) to stacked HTML divs + apply bold
    function renderContent(text) {
      if (!text) return "";
      return text.split("\n")
        .map(function(line) { return line.trim(); })
        .filter(function(line) { return line.length > 0; })
        .map(function(line) {
          var isBullet = /^-\s+/.test(line);
          var clean    = renderBold(isBullet ? line.replace(/^-\s+/, "") : line);
          return isBullet
            ? '<div style="padding:5px 0 5px 18px;position:relative;font-size:15px;color:#1A2332;line-height:1.7;margin-bottom:10px">'
              + '<span style="position:absolute;left:0;top:10px;width:6px;height:6px;background:#C8701A;border-radius:50%;display:inline-block"></span>&nbsp;&nbsp;'
              + clean + '</div>'
            : '<div style="font-size:15px;color:#1A2332;line-height:1.7;margin-bottom:6px">' + clean + '</div>';
        })
        .join("");
    }

    const leakBlock = (label, content, color) => !content ? "" : `
      <div style="background:white;border-left:4px solid ${color};border-radius:0 8px 8px 0;padding:16px 18px;margin-bottom:12px;border:1px solid #D8D4CD;border-left:4px solid ${color};">
        <div style="font-size:11px;font-weight:bold;color:${color};letter-spacing:2px;margin-bottom:10px;">${label}</div>
        ${renderContent(content)}
      </div>`;

    // Check for no admin staff — triggers Business Support upsell
    const officeStaffVal = answers && (answers.office_staff || answers.admin || "0");
    const noAdmin = parseInt(officeStaffVal) === 0 ||
      String(officeStaffVal).toLowerCase().includes("none") ||
      String(officeStaffVal).trim() === "0" ||
      !officeStaffVal;

    const html = `
      <div style="font-family:Arial,sans-serif;max-width:620px;margin:0 auto;color:#1A2332;">
        <div style="background:#1B2E4B;padding:32px 36px;border-radius:8px 8px 0 0;">
          <div style="font-size:11px;color:rgba(255,255,255,0.35);letter-spacing:3px;margin-bottom:10px;">COMPASS BUSINESS SOLUTIONS — FREE DIAGNOSTIC</div>
          ${headline ? `<div style="font-size:26px;font-weight:bold;color:#C8701A;line-height:1.3;">${renderBoldHeadline(headline)}</div>` : `<div style="font-size:26px;font-weight:bold;color:#C8701A;">Your Business Diagnostic</div>`}
          <div style="font-size:15px;color:rgba(255,255,255,0.5);margin-top:8px;">Prepared for ${firstName} — ${biz}</div>
        </div>
        <div style="background:#F7F5F2;padding:32px 36px;border-radius:0 0 8px 8px;border:1px solid #D8D4CD;">
          <p style="font-size:17px;color:#1A2332;font-weight:600;margin-top:0;">Hi ${firstName},</p>
          <p style="font-size:15px;color:#3E4E63;line-height:1.7;margin-top:0;">Here is your free diagnostic for <strong>${biz}</strong>${trade ? " — " + trade : ""}.</p>
          ${whatWeSee ? `<div style="background:white;border-radius:8px;padding:18px 20px;margin-bottom:18px;border:1px solid #D8D4CD;">
            <div style="font-size:11px;font-weight:bold;color:#3D6B9E;letter-spacing:2px;margin-bottom:12px;">WHAT WE SEE</div>
            ${renderContent(whatWeSee)}
          </div>` : ""}
          ${leakBlock("#1 BIGGEST LEAK", topLeak, "#B84C2E")}
          ${leakBlock("#2 LEAK", secondLeak, "#C8701A")}
          ${leakBlock("#3 LEAK", thirdLeak, "#A8782A")}
          ${howWeHelp ? `<p style="font-size:15px;color:#3E4E63;line-height:1.8;margin:20px 0 0;">${renderBold(howWeHelp)}</p>` : ""}

          <!-- What to do next -->
          <div style="margin:24px 0;">
            <div style="font-size:12px;font-weight:bold;color:#1A2332;letter-spacing:2px;margin-bottom:18px;">YOUR NEXT STEP — THREE OPTIONS:</div>

            <!-- Snapshot tier -->
            <div style="background:#F7F5F2;border:1px solid #D8D4CD;border-top:3px solid #1B2E4B;border-radius:8px;padding:18px 20px;margin-bottom:12px;">
              <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px;">
                <div>
                  <div style="font-size:15px;font-weight:bold;color:#1A2332;">DIY Profit Leak Snapshot</div>
                  <div style="font-size:13px;color:#6B7A90;margin-top:2px;">Your top 3 leaks, the math, what to fix, and the tools to do it.</div>
                </div>
                <div style="font-size:24px;font-weight:bold;color:#1B2E4B;flex-shrink:0;margin-left:12px;">$99</div>
              </div>
              <div style="font-size:14px;color:#3E4E63;line-height:1.75;margin-bottom:12px;">
                Deep intake → your top 3 leaks with exact math, 2-3 specific fixes for each one, and Fix-It Guides matched to your leaks. Your <strong>$99 is credited</strong> toward any FixKit plan.
              </div>
              <a href="https://buy.stripe.com/6oU28kfwo27GbWT2l8dZ608" style="display:inline-block;background:#1B2E4B;color:white;font-weight:bold;font-size:14px;padding:11px 24px;border-radius:8px;text-decoration:none;">Get My Snapshot — $99 →</a>
            </div>

            <!-- 30-Day Plan -->
            <div style="background:white;border:2px solid #C8701A;border-radius:8px;padding:18px 20px;margin-bottom:12px;position:relative;">
              <div style="display:inline-block;background:#C8701A;color:white;font-size:10px;font-weight:bold;letter-spacing:1.5px;padding:2px 10px;border-radius:99px;margin-bottom:10px;">MOST POPULAR</div>
              <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px;">
                <div>
                  <div style="font-size:15px;font-weight:bold;color:#1A2332;">FixKit — 30-Day Plan</div>
                  <div style="font-size:13px;color:#6B7A90;margin-top:2px;">Daily tasks. Built-in calculators. AI support.</div>
                </div>
                <div style="font-size:24px;font-weight:bold;color:#C8701A;flex-shrink:0;margin-left:12px;">$299</div>
              </div>
              <div style="font-size:14px;color:#3E4E63;line-height:1.75;margin-bottom:12px;">
                30 days of daily tasks (15 min/day) built around your specific leaks and your numbers. Calculators pre-loaded. Fix-It Guides matched to your leaks. Ask Jen AI advisor. <strong>$99 credited from Snapshot.</strong>
              </div>
              <a href="https://buy.stripe.com/14A28k9809A8gd9gbYdZ609" style="display:inline-block;background:#C8701A;color:white;font-weight:bold;font-size:14px;padding:11px 24px;border-radius:8px;text-decoration:none;">Get the 30-Day Plan — $299 →</a>
            </div>

            <!-- Full Bundle -->
            <div style="background:white;border:1px solid #C8701A;border-radius:8px;padding:18px 20px;margin-bottom:12px;position:relative;">
              <div style="display:inline-block;background:#1B2E4B;color:white;font-size:10px;font-weight:bold;letter-spacing:1.5px;padding:2px 10px;border-radius:99px;margin-bottom:10px;">BEST VALUE — SAVES $298</div>
              <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px;">
                <div>
                  <div style="font-size:15px;font-weight:bold;color:#1A2332;">FixKit — Complete 30/60/90-Day Plan</div>
                  <div style="font-size:13px;color:#6B7A90;margin-top:2px;">All three phases. Every leak addressed.</div>
                </div>
                <div style="font-size:24px;font-weight:bold;color:#C8701A;flex-shrink:0;margin-left:12px;">$599</div>
              </div>
              <div style="font-size:14px;color:#3E4E63;line-height:1.75;margin-bottom:12px;">
                All 90 days unlocked from day one. Every doc and calculator included. Saves $298 vs buying phases separately. <strong>$99 credited from Snapshot.</strong>
              </div>
              <a href="https://buy.stripe.com/6oU00c1Fy7s0bWT2l8dZ60f" style="display:inline-block;background:#C8701A;color:white;font-weight:bold;font-size:14px;padding:11px 24px;border-radius:8px;text-decoration:none;">Get the Full Bundle — $599 →</a>
            </div>

            ${noAdmin ? `
            <!-- No-Admin Upsell -->
            <div style="background:#EEF3F8;border:1px solid #3D6B9E;border-left:4px solid #3D6B9E;border-radius:8px;padding:18px 20px;margin-bottom:12px;">
              <div style="font-size:11px;font-weight:bold;color:#3D6B9E;letter-spacing:2px;margin-bottom:8px;">ONE MORE THING</div>
              <div style="font-size:15px;font-weight:bold;color:#1A2332;margin-bottom:6px;">You're running without admin support</div>
              <div style="font-size:14px;color:#3E4E63;line-height:1.75;margin-bottom:12px;">
                That means follow-ups, confirmations, invoicing, and outreach are all landing on you. A full-time admin runs $3,000–4,000/month. Our Business Support plans start at $250/month and handle the recurring work for you — done, every week, without you touching it.
              </div>
              <a href="https://www.compassbizsolutions.com/pricing" style="display:inline-block;background:#3D6B9E;color:white;font-weight:bold;font-size:14px;padding:11px 24px;border-radius:8px;text-decoration:none;">See Business Support Plans →</a>
            </div>` : ""}

            <!-- Done For You -->
            <div style="background:#F7F5F2;border:1px solid #D8D4CD;border-radius:8px;padding:16px 18px;text-align:center;">
              <div style="font-size:14px;color:#6B7A90;margin-bottom:10px;">Rather have us handle it? We scope, build, and implement the systems for you.</div>
              <a href="https://calendly.com/jvoiselle612-s9gb/free-scoping-call" style="display:inline-block;background:#1B2E4B;color:white;font-weight:bold;font-size:14px;padding:10px 22px;border-radius:8px;text-decoration:none;">Book a Free Scoping Call →</a>
            </div>
          </div>
          <p style="font-size:14px;color:#6B7A90;margin-bottom:4px;">Questions? Reply to this email — I read every one.</p>

          <p style="margin:0;color:#3E4E63;font-size:15px;">— Jen, Compass Business Solutions</p>
        </div>
        <div style="text-align:center;padding:16px;font-size:12px;color:#A0ABBE;">
          Compass Business Solutions &nbsp;·&nbsp; compassbizsolutions.com
        </div>
      </div>`;

    // Send to user
    await resend.emails.send({
      from: "Compass Business Solutions <" + (process.env.FROM_EMAIL || "reports@compassbizsolutions.com") + ">",
      to: email,
      subject: "Your Free Business Diagnostic — " + (biz || "Your Business"),
      html
    });

    // Copy to Jen with full answers
    const answerDump = Object.keys(answers).map(k => k + ": " + answers[k]).join("\n");
    resend.emails.send({
      from: "Compass Business Solutions <" + (process.env.FROM_EMAIL || "reports@compassbizsolutions.com") + ">",
      to: "jen@compassbizsolutions.com",
      subject: "New Diagnostic — " + (biz || "Unknown") + " (" + (trade || "Unknown trade") + ") — " + phone,
      html: "<pre style='font-family:monospace;font-size:13px;line-height:1.6;'>NEW DIAGNOSTIC SUBMISSION\n\nName: " + name + "\nEmail: " + email + "\nBusiness: " + biz + "\nPhone: " + phone + "\nTrade: " + trade + "\n\n--- ANSWERS ---\n" + answerDump + "\n\n--- REPORT ---\n" + report + "</pre>"
    }).catch(function() {});

    // Store answers in KV for check-ins
    storeInKV(email, {
      name, email, biz, phone, trade,
      answers,
      report,
      diagnosticDate: new Date().toISOString(),
      planPurchased: null
    }).catch(function() {});

    // Store lead record for admin dashboard
    const emailKey = email.toLowerCase().replace(/[^a-z0-9@._-]/g, "");
    const topLeakMatch = report.match(/\[LEAK_RANKING\]\s*1\.\s*([^\n—]+)/);
    const topLeakText = topLeakMatch ? topLeakMatch[1].trim() : "";

    storeInKV("lead:" + emailKey, {
      email, name, biz, phone, trade,
      top_leak: topLeakText,
      created_at: new Date().toISOString(),
      utm_source: utm_source || "",
      utm_campaign: utm_campaign || "",
      utm_medium: utm_medium || "",
      source: utm_source || "direct",
      diagnostic_answers: answers || {},
      outreach_tags: noAdmin ? ["no_admin_staff"] : [],
      outreach_opportunity: noAdmin ? "Business Support Services — no admin staff reported" : "",
    }).catch(function() {});

    // Write to outreach queue if no admin staff
    if (noAdmin) {
      storeInKV("outreach:no-admin:" + emailKey, {
        email, name, biz, trade,
        plan: "lead",
        tagged_at: new Date().toISOString(),
        reason: "Reported 0 office/admin staff on free diagnostic",
        campaign: "business_support_services",
        status: "pending",
      }).catch(function() {});
    }

    // Tag in Mailchimp
    tagMailchimp(email, name, trade).catch(function() {});

    return res.status(200).json({ success: true });

  } catch(err) {
    console.error("send-diagnostic error:", err);
    return res.status(500).json({ error: "Failed", detail: err.message });
  }
};
