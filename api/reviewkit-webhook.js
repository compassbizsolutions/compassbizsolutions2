/**
 * /api/reviewkit-webhook
 * Handles Stripe subscription lifecycle events for ReviewKit — a SEPARATE Stripe webhook
 * endpoint from /api/stripe-webhook (which handles Compass's other, one-time-payment
 * products). Register this as its own endpoint in the Stripe Dashboard pointing at
 * https://www.compassbizsolutions.com/api/reviewkit-webhook, and set its signing secret
 * as REVIEWKIT_STRIPE_WEBHOOK_SECRET (not the same value as STRIPE_WEBHOOK_SECRET).
 *
 * What it does, per event:
 *   - checkout.session.completed (subscription): creates a skeleton row in the
 *     reply-engine's `businesses` + `tone_profiles` tables (Supabase) so the account
 *     exists and pollReviews.js will eventually pick it up once a platform is connected.
 *     Business name/tone are placeholders here — the onboarding form (not built yet)
 *     is what fills those in properly. Emails the customer and notifies Jen.
 *   - customer.subscription.updated: keeps businesses.subscription_status in sync
 *     (active/trialing/past_due/canceled/unpaid) — this is what pollReviews.js checks
 *     before running, so a lapsed subscription actually stops the automation.
 *   - customer.subscription.deleted: marks subscription_status = 'canceled'.
 *
 * Talks to Supabase via plain REST (PostgREST) calls with the service-role key, rather
 * than adding @supabase/supabase-js as a dependency — same fetch-only style as the rest
 * of this codebase's /api functions.
 */

const crypto = require("crypto");
const { Resend } = require("resend");

const TIER_LABELS = {
  starter: "ReviewKit Starter ($79/mo)",
  growth: "ReviewKit Growth ($149/mo)",
  multilocation: "ReviewKit Multi-Location ($299/mo)"
};

// Stripe subscription statuses map fairly directly onto the businesses.subscription_status
// values the reply-engine pipeline already understands (trialing | active | past_due | canceled).
// "unpaid" and "incomplete_expired" both mean the pipeline should stop running for this
// business, same as canceled.
function mapSubscriptionStatus(stripeStatus) {
  if (stripeStatus === "trialing") return "trialing";
  if (stripeStatus === "active") return "active";
  if (stripeStatus === "past_due") return "past_due";
  if (stripeStatus === "canceled" || stripeStatus === "unpaid" || stripeStatus === "incomplete_expired") {
    return "canceled";
  }
  return "past_due"; // fail toward "needs attention" rather than silently staying active
}

function supabaseHeaders() {
  return {
    apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: "Bearer " + process.env.SUPABASE_SERVICE_ROLE_KEY,
    "Content-Type": "application/json"
  };
}

async function supabaseRequest(path, options) {
  const base = process.env.SUPABASE_URL;
  if (!base || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not configured");
  }
  const res = await fetch(`${base}/rest/v1/${path}`, {
    ...options,
    headers: { ...supabaseHeaders(), ...(options && options.headers) }
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase ${options && options.method ? options.method : "GET"} ${path} failed (${res.status}): ${text}`);
  }
  // Supabase returns an empty body for some successful writes.
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// Manual Stripe webhook signature verification — avoids adding the `stripe` npm package
// as a dependency just for this one check. Mirrors what stripe.webhooks.constructEvent does:
// https://docs.stripe.com/webhooks#verify-manually
function verifyStripeSignature(rawBody, sigHeader, secret) {
  if (!sigHeader || !secret) return false;

  const parts = Object.fromEntries(
    sigHeader.split(",").map((p) => {
      const [k, v] = p.split("=");
      return [k, v];
    })
  );
  const timestamp = parts.t;
  const signature = parts.v1;
  if (!timestamp || !signature) return false;

  // Reject anything older than 5 minutes — same tolerance Stripe's own SDK uses.
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (age > 300) return false;

  const signedPayload = `${timestamp}.${rawBody.toString("utf8")}`;
  const expected = crypto.createHmac("sha256", secret).update(signedPayload).digest("hex");

  try {
    return crypto.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(signature, "hex"));
  } catch (e) {
    return false; // length mismatch etc. — treat as invalid, not a crash
  }
}

async function notifyJen(subject, html) {
  const resend = new Resend(process.env.RESEND_API_KEY);
  await resend.emails.send({
    from: "Compass Business Solutions <" + (process.env.FROM_EMAIL || "reports@compassbizsolutions.com") + ">",
    to: process.env.FROM_EMAIL || "reports@compassbizsolutions.com",
    subject,
    html
  }).catch((e) => console.error("notifyJen failed:", e.message));
}

async function sendCustomerWelcome(email, tierLabel) {
  const resend = new Resend(process.env.RESEND_API_KEY);
  await resend.emails.send({
    from: "Compass Business Solutions <" + (process.env.FROM_EMAIL || "reports@compassbizsolutions.com") + ">",
    to: email,
    subject: "You're signed up for ReviewKit",
    html: `<div style="font-family:sans-serif;max-width:580px;margin:0 auto;color:#1B2E4B">
      <div style="background:#1B2E4B;padding:24px;border-radius:8px 8px 0 0">
        <div style="color:#C8701A;font-size:11px;letter-spacing:3px;font-weight:700">COMPASS BUSINESS SOLUTIONS</div>
      </div>
      <div style="background:#F4F7FC;padding:28px;border-radius:0 0 8px 8px;border:1px solid #C8D6E8">
        <p style="font-size:15px">Thanks for signing up for <strong>${tierLabel}</strong>.</p>
        <p style="font-size:15px;line-height:1.7">We're setting up your account now. Our team will follow up within one business day to connect your Google Business Profile (and Facebook/Yelp, if your plan includes them) and get your first replies flowing.</p>
        <p style="font-size:13px;color:#5A7291">Use <strong>${email}</strong> when you're asked to sign in — that's the email tied to your subscription.</p>
        <p style="font-size:14px">— Jen<br>Compass Business Solutions</p>
      </div>
    </div>`
  }).catch((e) => console.error("sendCustomerWelcome failed:", e.message));
}

async function handleCheckoutCompleted(session) {
  const email = session.customer_details && session.customer_details.email;
  const tier = (session.metadata && session.metadata.tier) || "starter";
  const tierLabel = TIER_LABELS[tier] || "ReviewKit";

  if (!email) {
    console.error("reviewkit-webhook: checkout.session.completed with no customer email, session:", session.id);
    await notifyJen(
      "🚨 ReviewKit signup with no email — needs manual follow-up",
      `<p>A ReviewKit checkout completed but no customer email came through.</p><p>Stripe session: ${session.id}</p>`
    );
    return;
  }

  // Businesses.name is required by the schema and unknown at this point — the onboarding
  // form (next build) is what collects and corrects it. A clearly-marked placeholder here
  // beats leaving the row half-built or guessing from the email address.
  const placeholderName = `New ReviewKit customer (${email}) — needs setup`;

  let business;
  try {
    const created = await supabaseRequest("businesses", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        owner_email: email,
        name: placeholderName,
        stripe_customer_id: session.customer,
        stripe_subscription_id: session.subscription,
        subscription_status: "active"
      })
    });
    business = created && created[0];
  } catch (err) {
    console.error("reviewkit-webhook: failed to create business row:", err.message);
    await notifyJen(
      "🚨 ReviewKit payment received but account setup failed — needs manual follow-up",
      `<p>Payment succeeded but creating the business record failed.</p>
       <p>Email: ${email}</p><p>Tier: ${tierLabel}</p><p>Stripe session: ${session.id}</p>
       <p>Error: ${err.message}</p>`
    );
    await sendCustomerWelcome(email, tierLabel);
    return;
  }

  if (business) {
    // Default tone profile — placeholders the onboarding quiz will overwrite. Inserted now
    // so the business has a complete, valid row set from the start rather than a dangling
    // foreign key the pipeline could trip over before onboarding happens.
    try {
      await supabaseRequest("tone_profiles", {
        method: "POST",
        body: JSON.stringify({
          business_id: business.id,
          tone: "friendly",
          negative_review_policy: "apologize_and_offer_fix"
        })
      });
    } catch (err) {
      console.error("reviewkit-webhook: failed to create default tone profile:", err.message);
      // Not fatal — the business row exists; onboarding can still create/fix this later.
    }
  }

  await sendCustomerWelcome(email, tierLabel);
  await notifyJen(
    `🎉 New ReviewKit signup — ${tierLabel} — ${email}`,
    `<p><b>New ReviewKit subscription</b></p>
     <p>Email: ${email}</p><p>Plan: ${tierLabel}</p>
     <p>Stripe customer: ${session.customer}</p><p>Stripe subscription: ${session.subscription}</p>
     <p>A skeleton business record was created — still needs: real business name, tone-quiz answers, and platform connection(s). Onboarding form isn't live yet, so this needs your manual follow-up for now.</p>`
  );
}

async function handleSubscriptionUpdated(subscription) {
  const status = mapSubscriptionStatus(subscription.status);
  try {
    await supabaseRequest(
      `businesses?stripe_subscription_id=eq.${subscription.id}`,
      {
        method: "PATCH",
        body: JSON.stringify({ subscription_status: status, updated_at: new Date().toISOString() })
      }
    );
  } catch (err) {
    console.error("reviewkit-webhook: failed to update subscription status:", err.message);
  }
}

async function handleSubscriptionDeleted(subscription) {
  try {
    await supabaseRequest(
      `businesses?stripe_subscription_id=eq.${subscription.id}`,
      {
        method: "PATCH",
        body: JSON.stringify({ subscription_status: "canceled", updated_at: new Date().toISOString() })
      }
    );
  } catch (err) {
    console.error("reviewkit-webhook: failed to mark subscription canceled:", err.message);
  }
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const rawBody = await new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });

  const sig = req.headers["stripe-signature"];
  const webhookSecret = process.env.REVIEWKIT_STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    console.error("reviewkit-webhook: REVIEWKIT_STRIPE_WEBHOOK_SECRET not set — refusing to process unverified events");
    return res.status(500).json({ error: "Webhook not configured" });
  }

  if (!verifyStripeSignature(rawBody, sig, webhookSecret)) {
    console.error("reviewkit-webhook: signature verification failed");
    return res.status(400).json({ error: "Invalid signature" });
  }

  let event;
  try {
    event = JSON.parse(rawBody.toString("utf8"));
  } catch (err) {
    return res.status(400).json({ error: "Invalid payload" });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        if (session.mode === "subscription") {
          await handleCheckoutCompleted(session);
        }
        break;
      }
      case "customer.subscription.updated":
        await handleSubscriptionUpdated(event.data.object);
        break;
      case "customer.subscription.deleted":
        await handleSubscriptionDeleted(event.data.object);
        break;
      default:
        // Ignore anything else — invoice events, payment_method events, etc.
        break;
    }
    return res.status(200).json({ received: true });
  } catch (err) {
    console.error("reviewkit-webhook error:", err.message);
    // Still 200 — Stripe will retry on non-2xx, and we've already logged/alerted what we can.
    // A retry storm on a bug we already know about doesn't help; the alert emails above do.
    return res.status(200).json({ received: true, error: err.message });
  }
};

// Tell Vercel not to parse the body — required for Stripe signature verification.
module.exports.config = { api: { bodyParser: false } };
