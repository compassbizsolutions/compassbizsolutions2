/**
 * Triage + reply drafting for inbound inquiries, in one Claude call.
 */
const Anthropic = require("@anthropic-ai/sdk");
const { BUSINESS_KNOWLEDGE, OFF_LIMITS, TEAM_SIGNOFF } = require("./inquiry-config");

const client = new Anthropic();

const CATEGORIES = [
  "new_lead", "pricing_question", "existing_customer",
  "billing_refund", "complaint", "vendor_spam", "other",
];

const RESULT_SCHEMA = {
  type: "object",
  properties: {
    category: { type: "string", enum: CATEGORIES },
    escalate: { type: "boolean" },
    escalation_reason: { type: "string" },
    asked_if_automated: { type: "boolean" },
    reply: { type: "string" },
  },
  required: ["category", "escalate", "escalation_reason", "asked_if_automated", "reply"],
  additionalProperties: false,
};

const VOICES = {
  // Drafts Jen reviews and sends herself.
  jen: `Write as Jen Voiselle, the founder. Direct, warm and real; short sentences; no
corporate speak; never "I hope this email finds you well". Sign off "— Jen".`,
  // Replies the assistant may send on its own.
  team: `Write as the business, using "we", "our team", "our calendar". Never claim to be
Jen, never sign Jen's name, never say "I'll personally...". Do not mention being an
assistant or automated. Direct, warm and real; short sentences; no corporate speak.
Sign off "${TEAM_SIGNOFF}".`,
};

const SYSTEM = `You handle inbound customer inquiries for Compass Business Solutions.

ABOUT THE BUSINESS
${BUSINESS_KNOWLEDGE}

OFF-LIMITS
${OFF_LIMITS}
Billing/refund and complaint categories always escalate. For vendor_spam, reply is "".

IF ASKED WHETHER THEY ARE TALKING TO A BOT, AI, OR AUTOMATED SYSTEM
Set asked_if_automated=true and escalate=true. Answer honestly in the reply, e.g.
"I'm Compass's assistant — want Jen to reach out to you directly?" Never deny it.

REPLY
Under 150 words unless the question truly needs more. Match their length and tone.
Answer only from the facts above; if you'd need to guess, escalate instead. Move
interested people toward the free scoping call without being pushy. When escalating,
still write the best draft you can for Jen to edit. Reply body only: no subject line.`;

/**
 * @param {object} args
 * @param {string} args.messages  The unanswered inbound message(s), oldest first.
 * @param {string} args.personContext  What we already know about the sender.
 * @param {"jen"|"team"} args.voice
 * @returns {Promise<{category:string, escalate:boolean, escalation_reason:string, asked_if_automated:boolean, reply:string}>}
 */
async function analyzeInquiry({ messages, personContext, voice }) {
  const response = await client.beta.messages.create({
    model: "claude-opus-5",
    max_tokens: 4000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: {
      effort: "low",
      format: { type: "json_schema", schema: RESULT_SCHEMA },
    },
    system: SYSTEM + "\n\nVOICE\n" + VOICES[voice],
    messages: [{
      role: "user",
      content: `WHAT WE KNOW ABOUT THIS PERSON
${personContext || "No prior context. This is a new contact."}

THEIR MESSAGE(S)
${messages}`,
    }],
  });

  if (response.stop_reason === "refusal") {
    return {
      category: "other", escalate: true, asked_if_automated: false, reply: "",
      escalation_reason: "Assistant declined to handle this message",
    };
  }
  const text = response.content.find(b => b.type === "text")?.text || "{}";
  return JSON.parse(text);
}

module.exports = { analyzeInquiry, CATEGORIES };
