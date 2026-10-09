/**
 * /go/<code>  →  /api/go?c=<code>
 * Short tracked links for social posts (compassbizsolutions.com/go/fb-p1).
 * Counts the click, then sends the visitor on:
 *   - to our own pages with ?src=<code>&utm_* so track.js remembers the post
 *   - to Calendly with utm_* (Calendly keeps them on the booking)
 *   - to Etsy or anywhere else as-is
 * Where each code goes lives in golink:<code> (seeded by the admin's Marketing
 * section); Etsy codes point at etsylink:<kit>, pasted in there once a listing
 * is live. Unknown codes, or an Etsy kit with no link yet, go to the home page,
 * still counted.
 */
const HOME = "https://www.compassbizsolutions.com/";
const KNOWN = {
  check: "https://www.compassbizsolutions.com/trades?start=1",
  call: "https://calendly.com/jvoiselle612-s9gb/free-scoping-call",
  reviewkit: "https://www.compassbizsolutions.com/reviewkit",
  fieldkit: "https://www.compassbizsolutions.com/fieldkit",
  home: HOME,
};

function kv() {
  return {
    url: process.env.lime_KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL,
    token: process.env.lime_KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN,
  };
}
async function kvCall(path, method) {
  const { url, token } = kv();
  if (!url || !token) return null;
  const r = await fetch(url + path, { method: method || "GET", headers: { Authorization: "Bearer " + token } });
  return (await r.json()).result;
}

module.exports = async function handler(req, res) {
  const code = String(req.query.c || "").toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 40);
  let dest = HOME;
  try {
    if (code) {
      const raw = await kvCall("/get/" + encodeURIComponent("golink:" + code));
      let link = null; try { link = raw ? JSON.parse(raw) : null; } catch (e) { link = null; }
      let d = (link && link.dest) || "";
      // "etsy:price" etc. → the listing link saved in the admin's Marketing section
      if (/^etsy:[a-z]+$/.test(d)) {
        const e = (await kvCall("/get/" + encodeURIComponent("etsylink:" + d.slice(5)))) || "";
        try { d = JSON.parse(e); } catch (x) { d = e; }
        if (d && typeof d === "object") d = d.url || "";
      }
      dest = KNOWN[d] || (/^https:\/\/[^\s]+$/.test(d) ? d : HOME);
      // Count it (total + today), never blocking the redirect for long
      const day = new Date().toISOString().slice(0, 10);
      await Promise.all([
        kvCall("/incr/" + encodeURIComponent("goclicks:" + code), "POST"),
        kvCall("/incr/" + encodeURIComponent("goclicks:" + code + ":" + day), "POST"),
      ]).catch(() => {});
    }
  } catch (e) { dest = HOME; }

  let to = dest;
  try {
    const u = new URL(dest);
    const platform = code.split("-")[0] || "link";
    if (code && /(^|\.)compassbizsolutions\.com$/.test(u.hostname)) {
      u.searchParams.set("src", code);
      u.searchParams.set("utm_source", platform);
      u.searchParams.set("utm_medium", "social");
      u.searchParams.set("utm_campaign", code);
    } else if (code && /calendly\.com$/.test(u.hostname)) {
      u.searchParams.set("utm_source", platform);
      u.searchParams.set("utm_medium", "social");
      u.searchParams.set("utm_campaign", code);
    }
    to = u.toString();
  } catch (e) { to = HOME; }

  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Location", to);
  return res.status(302).end();
};
