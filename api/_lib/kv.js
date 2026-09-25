/**
 * Upstash/Vercel KV REST helpers (same store as api/inbound-email.js).
 */

function creds() {
  return { url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN };
}

// Run one Redis command, e.g. redis(["ZADD", "key", 123, "member"]).
async function redis(command) {
  const { url, token } = creds();
  if (!url || !token) throw new Error("KV_REST_API_URL / KV_REST_API_TOKEN not set");
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify(command),
  });
  const data = await res.json();
  if (data.error) throw new Error("KV " + command[0] + ": " + data.error);
  return data.result;
}

async function getJSON(key) {
  const raw = await redis(["GET", key]);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}

async function setJSON(key, value) {
  await redis(["SET", key, JSON.stringify(value)]);
}

async function scanKeys(pattern) {
  let cursor = "0", keys = [];
  do {
    const [next, batch] = await redis(["SCAN", cursor, "MATCH", pattern, "COUNT", 100]);
    cursor = String(next);
    keys = keys.concat(batch || []);
  } while (cursor !== "0");
  return keys;
}

function emailKey(email) {
  return (email || "").toLowerCase().replace(/[^a-z0-9@._-]/g, "");
}

module.exports = { redis, getJSON, setJSON, scanKeys, emailKey };
