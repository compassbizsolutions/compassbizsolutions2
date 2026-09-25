/**
 * Shared configuration for the inquiry assistant.
 * Business facts, reply rules and hours live here so every channel
 * (email today, Facebook/Instagram later) answers the same way.
 * Files under api/_lib are bundled with functions but never served as routes.
 */

const TIME_ZONE = "America/New_York";
const OPEN_HOUR = 7;   // 7am Eastern, every day
const CLOSE_HOUR = 19; // 7pm Eastern, every day

const FIRST_REPLY_DELAY_MIN = 15;
const FOLLOW_UP_DELAY_MIN = 8;
// Held overnight messages go out across this many minutes after opening,
// oldest first, so they don't all land at exactly 7:00.
const MORNING_SPREAD_MIN = 40;

const BOOKING_LINK = "https://calendly.com/jvoiselle612-s9gb/free-scoping-call";

const JEN_EMAIL = "jen@compassbizsolutions.com";
const TEAM_FROM = "Compass Business Solutions <jen@compassbizsolutions.com>";
const REPLY_TO = "replies@aldiiwenue.resend.app";
const ALERT_FROM = "Compass Admin <reports@compassbizsolutions.com>";

// Categories the assistant may send on its own when INQUIRY_AUTO_SEND=true.
// Everything else is drafted for Jen.
const AUTO_SEND_CATEGORIES = ["new_lead", "pricing_question"];

const BUSINESS_KNOWLEDGE = `
Compass Business Solutions helps trade and service business owners (HVAC, plumbing,
electrical, landscaping, roofing and similar) find and fix profit leaks in their
operations: missed leads, slow follow-up, pricing gaps, admin drag.

Monthly plans:
- Foundation: $499/month
- Full Stack: $999/month
Paid consulting:
- Strategy Call: $79, 30 minutes, one focused problem
- Working Session: $149, 60 minutes, map the problem and build an action plan
Free options:
- Free scoping call: ${BOOKING_LINK}
- Free lead-flow diagnostic on the website (compassbizsolutions.com)
Other products: DeskKit (done-for-you business documents and tasks through the
customer portal) and ReviewKit (review requests and responses).

Booking: the free scoping call link above is the only booking link to share.
For the paid Strategy Call or Working Session, describe them and point people to
compassbizsolutions.com to purchase; never send a Calendly link for paid calls.
`.trim();

const OFF_LIMITS = `
Never answer these yourself. Set escalate=true and give a short reason instead:
- Refunds, cancellations, billing disputes, failed payments
- Custom pricing, discounts, or promo codes not listed above
- Guarantees or promised results (e.g. "will this get me more jobs?")
- Legal, tax, HR/employment, or insurance advice
- Anything about a specific client or their results
- Complaints, or a frustrated or angry tone
- Partnership, press, hiring, or vendor proposals
- Anything you are not confident about
`.trim();

const HOLDING_IN_HOURS =
  "Thanks for reaching out — we want to make sure you get the right answer on this, " +
  "so we've passed it along to the right person and they'll be in touch with you shortly.";

const HOLDING_AFTER_HOURS =
  "Thanks so much for reaching out! We've wrapped up for the evening, but your message " +
  "is at the top of our list and we'll be in touch as soon as we're back in the morning.";

const TEAM_SIGNOFF = "— The Compass Business Solutions team";

module.exports = {
  TIME_ZONE, OPEN_HOUR, CLOSE_HOUR,
  FIRST_REPLY_DELAY_MIN, FOLLOW_UP_DELAY_MIN, MORNING_SPREAD_MIN,
  BOOKING_LINK, JEN_EMAIL, TEAM_FROM, REPLY_TO, ALERT_FROM,
  AUTO_SEND_CATEGORIES, BUSINESS_KNOWLEDGE, OFF_LIMITS,
  HOLDING_IN_HOURS, HOLDING_AFTER_HOURS, TEAM_SIGNOFF,
};
