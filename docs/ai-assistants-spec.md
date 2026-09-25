# AI Assistants — Working Spec

Internal planning doc. Not deployed (excluded via `.vercelignore`).

Status: **email inquiry assistant built** (draft mode); social pending Jen's
Facebook cleanup. Decisions below are confirmed; open questions marked ❓.

## Built: email inquiry assistant

- `api/inbound-email.js` — queues every inbound email for the assistant.
- `api/inquiry-dispatch.js` — Vercel cron, every minute: triage + draft,
  holding messages for unanswered escalations, optional auto-replies,
  7am digest of escalations still waiting.
- `api/_lib/` — shared config (business facts, off-limits, hours, wording),
  business-hours math, Claude call, KV/queue helpers, email helpers.

Env vars: `CRON_SECRET` (required — cron is rejected without it),
`ANTHROPIC_API_KEY` (already set), `INQUIRY_AUTO_SEND=true` to let it send
new-lead / pricing replies on its own (default: drafts only).

Known limits:
- Only email that reaches the Resend inbound webhook is seen. Today that is
  replies to emails sent from the admin; mail sent straight to jen@ is not,
  unless it's forwarded to the Resend inbound address.
- Replies Jen sends from her own mail app aren't detected; only replies sent
  from the admin cancel pending holding messages / auto-replies.


---

## Shared foundation

- **Knowledge base:** one "about the business" source both assistants read from
  (services, Foundation $499 / Full Stack $999 plans, lead-flow diagnostic,
  free call, DeskKit, ReviewKit, Jen's voice).
- **Oversight:** everything lands in the admin area; daily digest of activity
  and items waiting on Jen.
- **Tech prerequisite:** `api/inbound-email.js` reads `KV_REST_API_*` while
  DeskKit/escalation code reads `UPSTASH_REDIS_REST_*` / `lime_KV_REST_API_*`.
  Confirm these point at the same store before building.

**Off-limits (DRAFT — Jen to confirm).** Never answered; escalate instead:
- Refunds, cancellations, billing disputes, failed payments
- Custom pricing, discounts, promo codes not published on the site
- Guarantees or promised results ("will this get me X more jobs?")
- Legal, tax, HR/employment, or insurance advice
- Anything about a specific client or their results
- Complaints or frustrated/angry tone
- Partnership, press, hiring, or vendor proposals
- Anything the assistant isn't confident about
❓ Urgent alert channel (email, text, both)
❓ Coverage when Jen is away

---

## Customer inquiry assistant

**Channels:** email to jen@ (Resend, exists), site forms, Facebook Page and
Instagram DMs/comments (see Social below).

**Triage categories:** new lead · pricing/plan question · existing customer ·
billing/refund · complaint · vendor/spam.

**Handling:**

| Category | Handling |
|---|---|
| New lead | Reply + booking link to our calendar |
| Pricing / plan question | Answer from knowledge base |
| Existing customer | Draft with account context for Jen |
| Billing / refund | Never answered — alert Jen immediately |
| Complaint | Never answered — alert Jen immediately |
| Vendor / spam | Archive, no reply |

❓ Lead follow-up cadence (email, since DMs close after Meta's 24h window)
❓ What marks a lead closed

---

## Reply rules (confirmed)

**Voice**
- Speak as the business: "we", "our calendar", "our team".
- No disclaimer about being an assistant.
- Never claim to be Jen, never sign Jen's name, never "I'll personally…".
- Only if someone asks directly whether they're talking to a bot/assistant:
  answer honestly (e.g. "I'm Compass's assistant — want Jen to reach out
  directly?") and alert Jen.

**Timing**
- First reply in a conversation: **15 minutes** after the inbound message.
- Subsequent replies: **8 minutes** after the latest inbound message.
- Multiple messages during the wait: batch into one reply; timer resets from
  the last inbound message.
- If Jen replies manually during the wait, the pending auto-reply is cancelled.
- **Outside business hours:** hold until opening. Answer oldest first, spread
  across the first 30–45 minutes (not all at opening time).
- Message arriving too close to close for the delay to land in-hours: reply
  next business morning.

**Business hours:** 7am–7pm, every day (including weekends).
Time zone: Eastern (America/New_York — follows daylight saving).

**Escalations Jen doesn't answer**
- Jen responds only when available; the customer should never be left silent.
- When the normal reply time is reached (15 min for a first message, 8 min
  after that) and Jen hasn't replied, send a holding message instead:
  - *In hours:* "Thanks for reaching out — we want to make sure you get the
    right answer on this, so we've passed it along to the right person and
    they'll be in touch with you shortly."
  - *After hours:* "Thanks so much for reaching out! We've wrapped up for the
    evening, but your message is at the top of our list and we'll be in touch
    as soon as we're back in the morning."
- Jen keeps getting reminders until she responds. Next morning, any escalation
  still unanswered goes to the top of her digest.
- Non-escalation messages after hours are still held and answered from 7am.
Booking link: https://calendly.com/jvoiselle612-s9gb/free-scoping-call
(free call only; paid Strategy Call / Working Session are described and sent
to checkout, never linked to Calendly directly).

**Escalate to Jen instead of replying:** bookings beyond the calendar link,
complaints, billing/refunds, custom pricing, anything low-confidence.

---

## Social media

**Auto-reply support by platform**

| Platform | DMs | Comments |
|---|---|---|
| Facebook Page | Yes (Meta app review) | Yes |
| Instagram Business/Creator | Yes (same Meta app) | Yes |
| Google Business Profile | No (chat discontinued 2024) | Review replies |
| LinkedIn | No | Partner approval required |
| TikTok | No | No |

**Integration options**
- **A — Build on site:** Meta webhooks → inquiry assistant → Graph API.
  Single queue/history. Requires Meta app review (1–4 weeks).
- **B — ManyChat:** no app review, live in ~a day; calls our API for replies.
  Recommended to start.

**Account allowlist (hard rule):** only the Compass Facebook Page ID and the
Compass Instagram account ID are ever accepted. Webhooks, tokens or messages
for any other Page/account are rejected and logged, never processed or
replied to. When authorizing ManyChat or a Meta app, grant access to the
Compass Page/Instagram only — never "all current and future Pages".

**Meta constraints:** free-form replies only within 24h of the user's last
message; must offer a path to a human.

Accounts: Compass Facebook Page + Compass Instagram (Business), linked together in Meta Business Suite. ✅
❓ Option A or B
❓ Draft-approval vs auto-send for simple questions at launch

**Content assistant (posting)**
❓ Platforms and cadence
❓ Canva brand kit / brand assets
❓ Permission to use client results/testimonials
❓ Auto-publish vs scheduler (Buffer / Meta Business Suite)
❓ Primary success metric (calls booked, diagnostics, followers)

---

## Known gaps

1. Social DMs/comments need an owner → routed into the inquiry assistant.
2. Off-limits topic list must exist before any auto-send.
3. Lead follow-up rules undefined.
4. KV env var mismatch to verify.
5. No away/backup plan.
