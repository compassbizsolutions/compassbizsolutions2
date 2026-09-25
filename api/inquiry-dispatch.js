/**
 * /api/inquiry-dispatch — runs every minute (Vercel cron).
 *
 * analyze  Triage the sender's unanswered message(s), save a draft, and schedule
 *          what happens next (holding message for escalations, auto-reply if enabled).
 * holding  Jen hasn't answered an escalation in time: send the holding message.
 * reply    Send an auto-reply (only when INQUIRY_AUTO_SEND=true).
 *
 * Every job is skipped if Jen has replied to the sender since the message arrived,
 * or if a newer message from the same sender superseded it.
 * At 7am Eastern, Jen gets a digest of escalations still waiting on her.
 */
const { getJSON, setJSON, scanKeys, emailKey, redis } = require("./_lib/kv");
const { ESCALATIONS, enqueue, cancel, due, claim } = require("./_lib/inquiry-queue");
const { analyzeInquiry } = require("./_lib/inquiry-ai");
const { buildPersonContext } = require("./_lib/person-context");
const { sendCustomerEmail, alertJen, esc } = require("./_lib/inquiry-mail");
const { isOpen, replySendTime, localParts } = require("./_lib/business-hours");
const cfg = require("./_lib/inquiry-config");

const MAX_ATTEMPTS = 3;
const BATCH_WINDOW_MS = 24 * 3600000;
const FIRST_CONTACT_WINDOW_MS = 30 * 24 * 3600000;

const autoSendEnabled = () => process.env.INQUIRY_AUTO_SEND === "true";

function subjectFor(record) {
  const s = record.subject || "";
  return /^re:/i.test(s) ? s : "Re: " + s;
}

// Latest time anyone (Jen or the assistant) replied to this sender.
async function lastReplyAt(ek) {
  const keys = await scanKeys("outreach:" + ek + ":reply:*");
  const logs = await Promise.all(keys.map(getJSON));
  return logs.filter(Boolean).reduce((t, l) => Math.max(t, new Date(l.sentAt).getTime() || 0), 0);
}

async function alreadyHandled(record, ek) {
  if (!record || record.repliedAt || record.supersededBy) return true;
  return (await lastReplyAt(ek)) > new Date(record.receivedAt).getTime();
}

async function logReply(ek, to, subject, extra) {
  await setJSON("outreach:" + ek + ":reply:" + Date.now(), Object.assign({
    to, subject, sentAt: new Date().toISOString(), isReply: true,
  }, extra));
}

async function analyze(inboundKey) {
  const record = await getJSON(inboundKey);
  if (!record || record.isPortalRequest) return;
  const ek = emailKey(record.from);
  if (await alreadyHandled(record, ek)) return;

  // Batch every unanswered message from this sender in the last 24h into one reply.
  const since = Date.now() - BATCH_WINDOW_MS;
  const lastReply = await lastReplyAt(ek);
  const siblings = (await Promise.all((await scanKeys("inbound:" + ek + ":*")).map(async k => [k, await getJSON(k)])))
    .filter(([, r]) => r && !r.repliedAt && !r.supersededBy && !r.isPortalRequest)
    .filter(([, r]) => { const t = new Date(r.receivedAt).getTime(); return t > since && t > lastReply; })
    .sort((a, b) => new Date(a[1].receivedAt) - new Date(b[1].receivedAt));
  const [latestKey, latest] = siblings.length ? siblings[siblings.length - 1] : [inboundKey, record];
  if (latestKey !== inboundKey) return; // a newer message will be analyzed instead

  const holdingAlreadySent = siblings.some(([, r]) => r.holdingSentAt);
  for (const [k, r] of siblings.slice(0, -1)) {
    await cancel("holding", k);
    await cancel("reply", k);
    await setJSON(k, Object.assign({}, r, { supersededBy: latestKey }));
  }

  const messages = siblings.map(([, r]) =>
    `[${r.receivedAt}] Subject: ${r.subject}\n${r.textBody || (r.htmlBody || "").replace(/<[^>]*>/g, " ")}`
  ).join("\n\n---\n\n");

  const result = await analyzeInquiry({
    messages,
    personContext: await buildPersonContext(record.from),
    voice: autoSendEnabled() ? "team" : "jen",
  });

  const isFirst = !lastReply || lastReply < Date.now() - FIRST_CONTACT_WINDOW_MS;
  const delay = isFirst ? cfg.FIRST_REPLY_DELAY_MIN : cfg.FOLLOW_UP_DELAY_MIN;
  const receivedAt = new Date(record.receivedAt);
  const escalate = result.escalate || ["billing_refund", "complaint"].includes(result.category);

  await setJSON(inboundKey, Object.assign({}, record, {
    category: result.category,
    escalate,
    escalationReason: result.escalation_reason || "",
    askedIfAutomated: result.asked_if_automated,
    aiDraft: result.reply || null,
    analyzedAt: new Date().toISOString(),
  }));

  if (result.category === "vendor_spam") return;

  if (escalate) {
    await redis(["ZADD", ESCALATIONS, receivedAt.getTime(), inboundKey]);
    if (!holdingAlreadySent) {
      await enqueue("holding", inboundKey, new Date(receivedAt.getTime() + delay * 60000));
    }
    await alertJen({
      subject: "⚠ Needs you: " + record.subject,
      lines: [
        `<strong>From:</strong> ${esc(record.fromName ? record.fromName + " <" + record.from + ">" : record.from)}`,
        `<strong>Why:</strong> ${esc(result.escalation_reason || result.category)}`,
        holdingAlreadySent
          ? "They already got the \"we'll be in touch\" note."
          : `If you haven't replied in ${delay} minutes, they'll get a short "we'll be in touch" note.`,
        result.reply ? "<strong>Suggested draft:</strong>" : "",
      ],
      draft: result.reply,
    });
    return;
  }

  if (autoSendEnabled() && cfg.AUTO_SEND_CATEGORIES.includes(result.category) && result.reply) {
    await enqueue("reply", inboundKey, replySendTime(receivedAt, delay));
  }
}

async function sendHolding(inboundKey) {
  const record = await getJSON(inboundKey);
  const ek = emailKey(record && record.from);
  if (await alreadyHandled(record, ek)) return;

  const body = (isOpen(new Date()) ? cfg.HOLDING_IN_HOURS : cfg.HOLDING_AFTER_HOURS) + "\n\n" + cfg.TEAM_SIGNOFF;
  const subject = subjectFor(record);
  await sendCustomerEmail({ to: record.from, subject, body });
  // Not logged as a reply: Jen still owes them an answer.
  await setJSON(inboundKey, Object.assign({}, record, { holdingSentAt: new Date().toISOString() }));
  await alertJen({
    subject: "Reminder — still waiting on you: " + record.subject,
    lines: [
      `${esc(record.from)} got the holding message. They still need a real answer from you.`,
      `<strong>Why it needs you:</strong> ${esc(record.escalationReason || record.category)}`,
    ],
    draft: record.aiDraft,
  });
}

async function sendReply(inboundKey) {
  const record = await getJSON(inboundKey);
  const ek = emailKey(record && record.from);
  if (!autoSendEnabled() || record?.escalate || await alreadyHandled(record, ek)) return;
  if (!record.aiDraft) return;

  const subject = subjectFor(record);
  await sendCustomerEmail({ to: record.from, subject, body: record.aiDraft });
  const now = new Date().toISOString();
  await setJSON(inboundKey, Object.assign({}, record, {
    status: "replied", repliedAt: now, autoSentAt: now, replySent: record.aiDraft,
  }));
  await logReply(ek, record.from, subject, { auto: true });
}

async function morningDigest(now) {
  const p = localParts(now);
  if (p.hour !== cfg.OPEN_HOUR || p.minute > 4) return;
  const flag = `inquiry_digest:${p.year}-${p.month}-${p.day}`;
  if (!(await redis(["SET", flag, "1", "NX", "EX", 86400]))) return;

  const keys = (await redis(["ZRANGE", ESCALATIONS, 0, -1])) || [];
  const waiting = [];
  for (const k of keys) {
    const r = await getJSON(k);
    if (await alreadyHandled(r, emailKey(r && r.from))) {
      await redis(["ZREM", ESCALATIONS, k]);
    } else {
      waiting.push(r);
    }
  }
  if (!waiting.length) return;
  await alertJen({
    subject: `Good morning — ${waiting.length} message${waiting.length > 1 ? "s" : ""} still need you`,
    lines: waiting.map(r =>
      `• <strong>${esc(r.fromName || r.from)}</strong>: ${esc(r.subject)} <span style="color:#7d92ad;">(${esc(r.escalationReason || r.category)})</span>`),
  });
}

const HANDLERS = { analyze, holding: sendHolding, reply: sendReply };

module.exports = async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== "Bearer " + secret) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const now = new Date();
  const results = [];
  for (const member of await due(now)) {
    if (!(await claim(member))) continue;
    const [type, inboundKey] = [member.slice(0, member.indexOf("|")), member.slice(member.indexOf("|") + 1)];
    try {
      await HANDLERS[type](inboundKey);
      results.push({ member, ok: true });
    } catch (err) {
      console.error("inquiry-dispatch", member, err.message);
      const attemptsKey = "inquiry_attempts:" + member;
      const attempts = await redis(["INCR", attemptsKey]);
      await redis(["EXPIRE", attemptsKey, 86400]);
      if (attempts < MAX_ATTEMPTS) await enqueue(type, inboundKey, new Date(Date.now() + 5 * 60000));
      results.push({ member, ok: false, error: err.message, attempts });
    }
  }

  try { await morningDigest(now); } catch (err) { console.error("inquiry digest", err.message); }
  return res.status(200).json({ processed: results.length, results });
};
