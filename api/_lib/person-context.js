/**
 * What we already know about a sender, for the AI's context.
 */
const { getJSON, scanKeys, emailKey } = require("./kv");
const getFromKV = getJSON;
const scanKV = scanKeys;

// Build context about this person for the AI
async function buildPersonContext(fromEmail) {
  const ek = emailKey(fromEmail);
  const [contact, lead, customer, notes, outreachHistory] = await Promise.all([
    getFromKV("contact:" + ek),
    getFromKV("lead:" + ek),
    getFromKV("customer:" + ek),
    getFromKV("person_notes:" + ek),
    (async () => {
      const keys = await scanKV("outreach:" + ek + ":*");
      const logs = await Promise.all(keys.map(k => getFromKV(k)));
      return logs.filter(Boolean).sort((a,b) => new Date(a.sentAt) - new Date(b.sentAt));
    })()
  ]);

  const parts = [];

  if (contact) {
    parts.push(`CONTACT INFO: ${contact.firstName||""} ${contact.lastName||""}, Trade: ${contact.trade||"unknown"}, Business: ${contact.biz||"unknown"}, Source: ${contact.source||"unknown"}`);
  }

  if (lead) {
    parts.push(`DIAGNOSTIC: They ran the free diagnostic. Estimated annual profit leak: ${lead.leak_total || lead.leakTotal || "unknown"}. Top leak: ${lead.top_leak || "unknown"}`);
  }

  if (customer) {
    parts.push(`CUSTOMER: Purchased ${customer.plan_type} plan on ${customer.phase_1_date ? new Date(customer.phase_1_date).toLocaleDateString() : "unknown date"}. Intake ${customer.intake_complete ? "complete" : "not yet complete"}.`);
    if (customer.intake_answers && Object.keys(customer.intake_answers).length > 0) {
      const answers = Object.entries(customer.intake_answers)
        .filter(([k,v]) => v)
        .slice(0, 10)
        .map(([k,v]) => `${k}: ${v}`)
        .join(", ");
      parts.push(`INTAKE ANSWERS (key ones): ${answers}`);
    }
  }

  if (outreachHistory.length > 0) {
    const emailsSent = outreachHistory.map(e => `"${e.subject}" on ${new Date(e.sentAt).toLocaleDateString()}`).join("; ");
    parts.push(`EMAILS SENT TO THEM: ${emailsSent}`);
  }

  if (notes?.list?.length > 0) {
    const noteText = notes.list.slice(0,3).map(n => n.text).join(" | ");
    parts.push(`YOUR NOTES: ${noteText}`);
  }

  return parts.join("\n\n");
}

module.exports = { buildPersonContext };
