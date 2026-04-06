/**
 * /api/validate-upgrade
 * Validates a snapshot upgrade code + email combination
 * Returns discount amount if valid
 */

async function getFromKV(key) {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  try {
    const res = await fetch(url + "/get/" + encodeURIComponent(key), {
      headers: { Authorization: "Bearer " + token }
    });
    const data = await res.json();
    return data.result ? JSON.parse(data.result) : null;
  } catch(e) { return null; }
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { email, code } = req.body;
    if (!email || !code) return res.status(400).json({ error: "Email and code required" });

    // Validate the code format
    const normalizedCode = code.trim().toUpperCase().replace(/[\s-]/g, "");
    const validCode = "SNAPSHOTUPGRADE";
    if (normalizedCode !== validCode) {
      return res.status(200).json({ valid: false, reason: "Invalid code" });
    }

    // Check if this email actually purchased a snapshot
    const emailKey = email.toLowerCase().replace(/[^a-z0-9@._-]/g, "");
    const lead = await getFromKV("lead:" + emailKey);
    const customer = await getFromKV("customer:" + emailKey);

    const hasPurchasedSnapshot = (lead?.snapshot_purchased || customer?.snapshot_purchased) === true;

    if (!hasPurchasedSnapshot) {
      return res.status(200).json({
        valid: false,
        reason: "No Snapshot purchase found for this email. Please use the email address you purchased with."
      });
    }

    // Check if they've already upgraded (don't want double discounts)
    const hasFixKit = !!customer;
    if (hasFixKit) {
      return res.status(200).json({
        valid: false,
        reason: "Looks like you already have a FixKit account! Head to fixkit.compassbizsolutions.com to log in."
      });
    }

    // Valid — return discount info
    return res.status(200).json({
      valid: true,
      email,
      discount: 100, // $100 off
      thirtyDayPrice: 199,  // $299 - $100
      bundlePrice: 499,     // $599 - $100
      thirtyDayPriceId: process.env.PADDLE_PRICE_SNAPSHOT_UPGRADE_30 || "",
      bundlePriceId: process.env.PADDLE_PRICE_SNAPSHOT_UPGRADE_BUNDLE || "",
      message: "Snapshot purchase confirmed — your $100 discount is applied."
    });

  } catch(err) {
    console.error("validate-upgrade error:", err.message);
    return res.status(500).json({ error: "Failed", detail: err.message });
  }
};
