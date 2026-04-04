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
    const { name, email, biz, phone, trade, answers, report } = req.body;
    if (!email || !report) return res.status(400).json({ error: "Missing required fields" });

    const resend = new Resend(process.env.RESEND_API_KEY);
    const firstName = name || "there";

    function getTag(text, tag) {
      const m = text.match(new RegExp("\\[" + tag + "\\]([\\s\\S]*?)(?=\\[|$)"));
      return m ? m[1].trim() : "";
    }

    const headline   = getTag(report, "HEADLINE");
    const whatWeSee  = getTag(report, "WHAT_WE_SEE");
    const topLeak    = getTag(report, "TOP_LEAK");
    const secondLeak = getTag(report, "SECOND_LEAK");
    const thirdLeak  = getTag(report, "THIRD_LEAK");
    const howWeHelp  = getTag(report, "HOW_WE_HELP");

    const leakBlock = (label, content, color) => !content ? "" : `
      <div style="background:white;border-left:4px solid ${color};border-radius:0 8px 8px 0;padding:14px 16px;margin-bottom:10px;border:1px solid #D8D4CD;border-left:4px solid ${color};">
        <div style="font-size:10px;font-weight:bold;color:${color};letter-spacing:2px;margin-bottom:6px;">${label}</div>
        <p style="font-size:13px;color:#3E4E63;line-height:1.75;margin:0;white-space:pre-line;">${content}</p>
      </div>`;

    const html = `
      <div style="font-family:Arial,sans-serif;max-width:620px;margin:0 auto;color:#3E4E63;">
        <div style="background:#1B2E4B;padding:32px 36px;border-radius:8px 8px 0 0;">
          <div style="font-size:10px;color:rgba(255,255,255,0.35);letter-spacing:3px;margin-bottom:10px;">COMPASS BUSINESS SOLUTIONS — FREE DIAGNOSTIC</div>
          ${headline ? `<div style="font-size:22px;font-weight:bold;color:#C8701A;line-height:1.3;">${headline}</div>` : `<div style="font-size:22px;font-weight:bold;color:#C8701A;">Your Business Diagnostic</div>`}
          <div style="font-size:13px;color:rgba(255,255,255,0.45);margin-top:8px;">Prepared for ${firstName} — ${biz}</div>
        </div>
        <div style="background:#F7F5F2;padding:32px 36px;border-radius:0 0 8px 8px;border:1px solid #D8D4CD;">
          <p style="font-size:15px;color:#1A2332;font-weight:600;margin-top:0;">Hi ${firstName},</p>
          <p style="color:#3E4E63;line-height:1.7;margin-top:0;">Here is your free diagnostic for <strong>${biz}</strong>${trade ? " — " + trade : ""}.</p>
          ${whatWeSee ? `<div style="background:white;border-radius:8px;padding:16px 18px;margin-bottom:16px;border:1px solid #D8D4CD;">
            <div style="font-size:10px;font-weight:bold;color:#3D6B9E;letter-spacing:2px;margin-bottom:8px;">WHAT WE SEE</div>
            <p style="font-size:13px;color:#3E4E63;line-height:1.8;margin:0;">${whatWeSee}</p>
          </div>` : ""}
          ${leakBlock("#1 BIGGEST LEAK", topLeak, "#B84C2E")}
          ${leakBlock("#2 LEAK", secondLeak, "#C8701A")}
          ${leakBlock("#3 LEAK", thirdLeak, "#A8782A")}
          ${howWeHelp ? `<p style="font-size:13px;color:#3E4E63;line-height:1.8;margin:20px 0 0;">${howWeHelp}</p>` : ""}

          <!-- What to do next -->
          <div style="margin:20px 0;">
            <div style="font-size:11px;font-weight:bold;color:#1A2332;letter-spacing:2px;margin-bottom:16px;">YOUR NEXT STEP — TWO OPTIONS:</div>

            <!-- 30-Day Plan -->
            <div style="background:white;border:1px solid #D8D4CD;border-top:3px solid #C8701A;border-radius:8px;padding:18px 20px;margin-bottom:12px;">
              <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px;">
                <div>
                  <div style="font-size:13px;font-weight:bold;color:#1A2332;">30-Day Quick Win Plan</div>
                  <div style="font-size:12px;color:#6B7A90;margin-top:2px;">Start here. See results fast.</div>
                </div>
                <div style="font-size:22px;font-weight:bold;color:#C8701A;flex-shrink:0;margin-left:12px;">$249</div>
              </div>
              <div style="font-size:12px;color:#3E4E63;line-height:1.75;margin-bottom:12px;">
                Tell us about your operation — we build a customized 30-day action plan targeting your specific leaks. Your plan, daily tasks, guides, and progress tracker all live in <strong>FixKit</strong>, your personal business portal. Log in from your phone, check off tasks as you go, and ask questions anytime.<br><br>
                No email chains. No PDFs to hunt through. Everything in one place.
              </div>
              <a href="https://www.compassbizsolutions.com/?buy=30day" style="display:inline-block;background:#C8701A;color:white;font-weight:bold;font-size:13px;padding:11px 24px;border-radius:8px;text-decoration:none;">Get My 30-Day Plan — $249 →</a>
            </div>

            <!-- Full Bundle -->
            <div style="background:white;border:1px solid #C8701A;border-top:3px solid #C8701A;border-radius:8px;padding:18px 20px;margin-bottom:12px;position:relative;">
              <div style="display:inline-block;background:#C8701A;color:white;font-size:9px;font-weight:bold;letter-spacing:1.5px;padding:2px 10px;border-radius:99px;margin-bottom:10px;">BEST VALUE — SAVES $147</div>
              <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px;">
                <div>
                  <div style="font-size:13px;font-weight:bold;color:#1A2332;">Complete 30/60/90-Day Plan</div>
                  <div style="font-size:12px;color:#6B7A90;margin-top:2px;">All three phases. One portal. Full roadmap.</div>
                </div>
                <div style="font-size:22px;font-weight:bold;color:#C8701A;flex-shrink:0;margin-left:12px;">$599</div>
              </div>
              <div style="font-size:12px;color:#3E4E63;line-height:1.75;margin-bottom:12px;">
                Everything in the 30-day plan, plus your full 60 and 90-day roadmap — all three phases customized to your business and loaded into FixKit from day one. Your biggest leaks first, next tier second, remaining third. One payment, all 90 days, saves $147.<br><br>
                Your portal, your plan, your progress. All in one place from start to finish.
              </div>
              <a href="https://www.compassbizsolutions.com/?buy=bundle" style="display:inline-block;background:#C8701A;color:white;font-weight:bold;font-size:13px;padding:11px 24px;border-radius:8px;text-decoration:none;">Get the Full 30/60/90 Bundle — $599 →</a>
            </div>

            <!-- Done For You -->
            <div style="background:#F7F5F2;border:1px solid #D8D4CD;border-radius:8px;padding:14px 18px;text-align:center;">
              <div style="font-size:12px;color:#6B7A90;margin-bottom:8px;">Rather have us handle it? We scope, build, and implement the systems for you.</div>
              <a href="https://calendly.com/jvoiselle612-s9gb/free-scoping-call" style="display:inline-block;background:#1B2E4B;color:white;font-weight:bold;font-size:12px;padding:9px 20px;border-radius:8px;text-decoration:none;">Book a Free Scoping Call →</a>
            </div>
          </div>
          <p style="font-size:13px;color:#6B7A90;margin-bottom:4px;">Questions? Reply to this email — I read every one.</p>
          <p style="margin:0;color:#3E4E63;font-size:13px;">— Jen, Compass Business Solutions</p>
        </div>
        <div style="text-align:center;padding:16px;font-size:11px;color:#A0ABBE;">
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
    }).catch(function() {});

    // Tag in Mailchimp
    tagMailchimp(email, name, trade).catch(function() {});

    return res.status(200).json({ success: true });

  } catch(err) {
    console.error("send-diagnostic error:", err);
    return res.status(500).json({ error: "Failed", detail: err.message });
  }
};
