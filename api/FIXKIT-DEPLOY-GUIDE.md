# FixKit Launch — Deploy Guide

**Ship target:** Tonight / tomorrow  
**File:** `generate-report.js` (drop-in replacement for whatever stub is currently at `/api/generate-report`)

---

## 1. Where This File Goes

Your trades page (`trades/index.html` in `compassbizsolutions2`) calls `www.compassbizsolutions.com/api/generate-report`. So:

```
compassbizsolutions2/
  api/
    generate-report.js   ← this file
```

Deploy via GitHub upload (per your deploy notes for compassbizsolutions2 — that repo is not CLI-deploy).

If a stub `generate-report.js` already exists in that location, this fully replaces it.

---

## 2. Environment Variable Check

Needed in the **compassbizsolutions2** Vercel project:

- `ANTHROPIC_API_KEY` — you already have this set. Verify it's still there before deploy.

Nothing else is needed for this endpoint. (Resend, KV, Mailchimp all live in the `send-diagnostic` endpoint and stay in the fixkit project.)

---

## 3. Frontend Contract

`/api/generate-report` expects a POST with:

```json
{
  "name": "Jim Rooney",
  "biz": "Rooney HVAC",
  "trade": "HVAC",
  "answers": {
    "q1": "HVAC",
    "q2": ["Residential calls", "Emergency calls"],
    "q3": "10-20 years",
    "q4": "4-6",
    "q5": "2-3",
    "q6": "20-40",
    "q7": "$400-$800",
    "q8": "Hourly",
    "q9": "Paper/memory",
    "q10": "Daily",
    "q11": "Whenever I get to it",
    "q12": "Mostly new",
    "q13": "5+ years ago",
    "q14": "3-5",
    "q15": ["Paperwork/admin", "Scheduling", "Chasing invoices"],
    "q16": "Working 7 days a week and my wife is pissed"
  }
}
```

It returns:

```json
{ "report": "[HEADLINE]...[/HEADLINE]\n[WHAT_WE_SEE]...[LEAK_RANKING]..." }
```

**If your current frontend sends answer keys other than `q1`..`q16`** (e.g., it sends `trade`, `services`, `years`, etc.), open `generate-report.js` and edit the `QUESTION_LABELS` constant at the top — that's the only place the key mapping lives.

---

## 4. Frontend Wiring (what the trades page should do)

Pseudocode for the submit handler after the user finishes question 16:

```js
// Step 1: generate the report
const genRes = await fetch("/api/generate-report", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ name, biz, trade, answers })
});
const { report } = await genRes.json();

// Step 2: show on page immediately
displayReportOnPage(report);  // parse the [TAG] blocks the same way the email does

// Step 3: fire-and-forget the email + storage
fetch("https://fixkit.compassbizsolutions.com/api/send-diagnostic", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    name, email, biz, phone, trade,
    answers,
    report,
    utm_source, utm_campaign, utm_medium
  })
});
```

Order matters: generate first, display to the user, then email. If the email call hangs, the user has already seen their report. Show the user a loading state during step 1 (your site copy already says "Analyzing your business... This takes about 30 seconds" — that's perfect cover for a 15-25 second AI call).

---

## 5. Output Contract (what the AI returns)

Every report the AI produces contains these tags, in this order:

- `[HEADLINE]...[/HEADLINE]` — the orange heading in the email
- `[WHAT_WE_SEE]...[/WHAT_WE_SEE]` — the WHAT WE SEE callout
- `[TOP_LEAK]...[/TOP_LEAK]` — red-bordered leak block
- `[SECOND_LEAK]...[/SECOND_LEAK]` — orange-bordered leak block
- `[THIRD_LEAK]...[/THIRD_LEAK]` — tan-bordered leak block
- `[HOW_WE_HELP]...[/HOW_WE_HELP]` — the transition paragraph before the upsell
- `[LEAK_RANKING]...[/LEAK_RANKING]` — machine-readable ranking for your KV store

Your existing `send-diagnostic.js` tag parser works with or without closing tags (`[/TAG]`) because of how the regex is written, so the output is fully compatible with what's deployed.

The `LEAK_RANKING` block uses this exact format (your backend parses it for the admin dashboard's `top_leak` field):

```
[LEAK_RANKING]
1. Pricing — $108,000/year
2. Vehicles & Parts — $125,000/year
3. Recurring Revenue — $30-50,000/year
[/LEAK_RANKING]
```

Em-dashes (`—`), not hyphens. The prompt enforces this.

---

## 6. Test Plan (do this before going live)

Run these 4 intakes end-to-end and read the outputs cold. If any feel generic or off-tone, flag and tell me — we tune the prompt, not the code.

### Test A: Small shop, pricing disaster
- q1: HVAC, q3: 5-10 years, q4: 2-3, q5: 2-3, q6: 10-20, q7: $400-$800
- q8: Hourly, q13: Never, q14: Almost none
- Expected: Pricing should be #1, big dollar number, urgent tone

### Test B: Mid-size, operational mess
- q1: Plumbing, q3: 10-20, q4: 4-6, q5: 4-6, q6: 40-60, q7: $800-$1,500
- q9: Paper/memory, q10: Daily, q11: Weeks later, q15: select 4+ items
- Expected: Admin/ops/billing leaks dominate; pricing secondary

### Test C: Solo operator burnout
- q1: Electrical, q3: 2-5, q4: Just me, q6: 10-20, q7: $400-$800
- q14: 3-5, q15: 4+ items selected, q16: "Working 70 hours, wife is pissed, thinking about quitting"
- Expected: Acknowledges burnout briefly in WHAT_WE_SEE, focuses top 3 on scheduling/pricing/admin, points strongly to FixKit or scoping call (owner can't DIY this alone)

### Test D: Missing data
- Fill in q1-q5 only, skip everything else including q16
- Expected: AI should flag that it can't give specific dollar figures on some leaks and use cited industry benchmarks instead. Should NOT fabricate numbers.

Run each one twice and check that outputs are consistent (same top 3, similar dollar ranges). If the top 3 categories swap on identical inputs, lower the temperature from `0.7` to `0.5` in the file.

---

## 7. Cost Per Diagnostic

At current model pricing (`claude-sonnet-4-5`):
- ~3,500 input tokens (system + user message)
- ~900 output tokens (typical report)
- **Roughly $0.02-$0.03 per diagnostic**

Even 1,000 diagnostics a month = $20-30 in API costs. If volume explodes, we can move the system prompt to prompt caching or downshift to Haiku for another ~5x cost cut.

---

## 8. If Something Breaks at Launch

Rollback: just revert `generate-report.js` to whatever stub was there before. Your `send-diagnostic.js` is unchanged, so the email pipeline is safe.

Symptom → fix:
- **400 error "Missing answers"** → frontend isn't sending `answers` object. Check the POST body.
- **500 "AI service not configured"** → `ANTHROPIC_API_KEY` env var not set in compassbizsolutions2. Add it in Vercel dashboard, redeploy.
- **502 "AI generation failed"** → Anthropic API returned an error. Check Vercel function logs — most likely model name mismatch or rate limit.
- **Email sends but content looks wrong / tags missing** → AI didn't produce a clean tagged output. Check Vercel logs for the `report missing tags` warning line, then paste the actual output to me and we'll patch the prompt.

---

## 9. What's NOT in This Drop (for after launch)

- A second prompt for the $99 Snapshot PDF generation (fuller analysis, all 11 categories, step-by-step fixes, branded tool recs). I'd recommend writing this within 1-2 weeks of launch when you have real diagnostic outputs to calibrate against.
- A separate prompt for the FixKit daily-task generation (the paid $299/$599 tier).
- A scheduled re-engagement email that fires at 7 days if the diagnostic-recipient hasn't purchased.

All three are straightforward once this is live and we've seen real data.

---

## 10. Ping Me If Output Feels Off

Once this is deployed and you've run a few real intakes, paste me one raw AI output and I'll tell you what to tune. Common early-launch tweaks:
- "The numbers feel made up" → tighten the math-showing rules
- "Tone is too aggressive" / "too soft" → adjust VOICE RULES section
- "Missing category X too often" → adjust DIAGNOSE signals section
- "Not pushing the paid tiers enough" / "too much" → edit HOW_WE_HELP instructions

Every tweak is a 2-line change in the system prompt. Don't rebuild — tune.
