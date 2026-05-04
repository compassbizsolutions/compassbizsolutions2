/**
 * /api/create-stripe-invoice
 * POST — creates and sends a Stripe invoice for an accepted quote
 * Ad hoc = one-time invoice | Package = subscription
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

function toFormData(obj, prefix) {
  const parts = [];
  function encode(k, v) {
    if (v === null || v === undefined) return;
    if (typeof v === "object" && !Array.isArray(v)) {
      Object.entries(v).forEach(([sk, sv]) => encode(k + "[" + sk + "]", sv));
    } else if (Array.isArray(v)) {
      v.forEach((item, i) => encode(k + "[" + i + "]", item));
    } else {
      parts.push(encodeURIComponent(k) + "=" + encodeURIComponent(v));
    }
  }
  Object.entries(obj).forEach(([k, v]) => encode(prefix ? prefix + "[" + k + "]" : k, v));
  return parts.join("&");
}

async function stripe(method, path, body) {
  const sk = process.env.STRIPE_SECRET_KEY;
  if (!sk) throw new Error("STRIPE_SECRET_KEY not configured");
  const r = await fetch("https://api.stripe.com/v1" + path, {
    method,
    headers: {
      Authorization: "Bearer " + sk,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body ? toFormData(body) : undefined,
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error?.message || "Stripe error: " + r.status);
  return d;
}

async function getOrCreateCustomer(email, name, company) {
  const search = await stripe("GET", "/customers/search?query=" + encodeURIComponent('email:"' + email + '"'));
  if (search.data?.length > 0) return search.data[0].id;
  const c = await stripe("POST", "/customers", { email, name: name || email, description: company || "" });
  return c.id;
}

const PACKAGE_PRICES = {
  single_task:     process.env.STRIPE_PRICE_SINGLE_TASK     || null,
  small_biz_admin: process.env.STRIPE_PRICE_SMALL_BIZ_ADMIN || null,
  full_admin:      process.env.STRIPE_PRICE_FULL_ADMIN       || null,
};

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const authHeader = req.headers.authorization || "";
    const sessionToken = authHeader.replace("Bearer ", "").trim();
    const email = await validateSession(sessionToken);
    if (!email) return res.status(401).json({ error: "Unauthorized" });

    const { quote_id, quote_type, package_id, service_type, description, amount, complexity } = req.body || {};
    if (!quote_type) return res.status(400).json({ error: "quote_type required" });

    const eKey     = emailKey(email);
    const customer = await getFromKV("customer:" + eKey);
    const stripeId = await getOrCreateCustomer(email, customer?.name, customer?.biz);

    let invoiceId, invoiceUrl, invoiceStatus;

    if (quote_type === "package") {
      const priceId = PACKAGE_PRICES[package_id];
      if (!priceId) return res.status(400).json({
        error: "Package not yet available for online purchase.",
        action: "contact",
        message: "Please contact jen@compassbizsolutions.com to set up your package."
      });

      const sub = await stripe("POST", "/subscriptions", {
        customer: stripeId,
        "items[0][price]": priceId,
        payment_behavior: "default_incomplete",
        "payment_settings[payment_method_types][0]": "card",
        "payment_settings[save_default_payment_method]": "on_subscription",
        "metadata[quote_id]": quote_id || "",
        "metadata[service_type]": service_type || "",
        "metadata[source]": "compass_portal",
      });

      invoiceId     = sub.latest_invoice?.id || sub.id;
      invoiceStatus = sub.status;
      invoiceUrl    = sub.latest_invoice?.hosted_invoice_url || null;

    } else {
      // Ad hoc one-time invoice
      const cents = Math.round((parseFloat(amount) || 0) * 100);
      if (!cents) return res.status(400).json({ error: "Amount required" });

      const lineDesc = [service_type, complexity ? "(" + complexity + ")" : "", description ? "— " + String(description).substring(0, 100) : ""].filter(Boolean).join(" ");

      const inv = await stripe("POST", "/invoices", {
        customer:         stripeId,
        collection_method: "send_invoice",
        days_until_due:   7,
        description:      "Compass Business Solutions — " + service_type,
        "metadata[quote_id]":    quote_id     || "",
        "metadata[service_type]": service_type || "",
        "metadata[source]":      "compass_portal",
      });

      await stripe("POST", "/invoiceitems", {
        customer:    stripeId,
        invoice:     inv.id,
        amount:      cents,
        currency:    "usd",
        description: lineDesc,
      });

      const final = await stripe("POST", "/invoices/" + inv.id + "/finalize", {});
      await stripe("POST", "/invoices/" + inv.id + "/send", {});

      invoiceId     = final.id;
      invoiceStatus = final.status;
      invoiceUrl    = final.hosted_invoice_url;
    }

    // Store invoice in KV
    const record = {
      id:                  "inv_" + Date.now(),
      quote_id,
      quote_type,
      service_type,
      amount:              parseFloat(amount) || 0,
      complexity,
      stripe_invoice_id:   invoiceId,
      stripe_customer_id:  stripeId,
      stripe_invoice_url:  invoiceUrl,
      status:              invoiceStatus === "paid" ? "paid" : "pending",
      created_at:          new Date().toISOString(),
    };

    const existing = await getFromKV("portal_invoices:" + eKey) || [];
    await saveToKV("portal_invoices:" + eKey, [record, ...existing]);

    // Mark quote as accepted
    const quotes = await getFromKV("portal_quotes:" + eKey) || [];
    await saveToKV("portal_quotes:" + eKey, quotes.map(function(q) {
      return q.id === quote_id ? Object.assign({}, q, { status: "accepted", invoice_id: invoiceId }) : q;
    }));

    // Notify Jen
    try {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: "Bearer " + process.env.RESEND_API_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: "Compass Portal <reports@compassbizsolutions.com>",
          to: "reports@compassbizsolutions.com",
          subject: "Invoice Sent — " + service_type + " (" + email + ")",
          html: "<div style='font-family:sans-serif'><h2 style='color:#C8701A'>Invoice Created</h2>"
            + "<p><strong>Customer:</strong> " + email + "</p>"
            + "<p><strong>Service:</strong> " + service_type + "</p>"
            + "<p><strong>Amount:</strong> $" + amount + "</p>"
            + "<p><strong>Type:</strong> " + quote_type + "</p>"
            + (invoiceUrl ? "<p><a href='" + invoiceUrl + "'>View Invoice →</a></p>" : "")
            + "</div>"
        })
      });
    } catch(e) { console.error("Notify email error:", e.message); }

    return res.status(200).json({
      success:     true,
      invoice_id:  invoiceId,
      invoice_url: invoiceUrl,
      status:      invoiceStatus,
      message:     quote_type === "package"
        ? "Subscription created. Check your email to complete payment."
        : "Invoice sent to " + email + ". Payment due within 7 days.",
    });

  } catch(err) {
    console.error("create-stripe-invoice error:", err.message);
    return res.status(500).json({ error: err.message || "Failed to create invoice" });
  }
};
