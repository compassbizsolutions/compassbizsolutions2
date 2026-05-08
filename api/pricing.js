/**
 * Compass Business Solutions — Ad Hoc Pricing
 * Single source of truth for customer-facing pricing AND AI quoting
 *
 * simple: null = service starts at Standard (no simple tier exists)
 */

const AD_HOC_PRICING = {

  // ── ADMIN & DATA ──────────────────────────────────────────────────────────

  "Spreadsheet / Data Work": {
    simple:   79,
    standard: 149,
    complex:  299,
    what_we_do: "Build, clean, format, and organize spreadsheets. We work in Excel, Google Sheets, or CSV.",
    simple_includes:   "Clean up or reformat an existing spreadsheet. Fix broken formulas. Merge two sheets with the same structure. Apply consistent formatting.",
    standard_includes: "Build a new tracking sheet from scratch. Combine and reconcile multiple files. Add pivot tables, VLOOKUP/XLOOKUP, conditional formatting, or dropdown lists.",
    complex_includes:  "Full dashboard with multiple interconnected sheets, automated calculations, charts, and summaries built from multiple data sources.",
    not_included:      "Live database integrations, API connections, macros or VBA scripting, Power BI, Tableau.",
  },

  "Data Entry & Cleanup": {
    simple:   79,
    standard: 129,
    complex:  249,
    what_we_do: "Enter, organize, and clean up lists, records, and data sets in spreadsheets, Airtable, Notion, or any system we can access.",
    simple_includes:   "Enter a provided list of contacts, products, or records into a spreadsheet. Reformat dates, phone numbers, or addresses to a consistent style.",
    standard_includes: "Deduplicate and clean a full customer or contact list. Standardize fields, fill in missing data from provided sources, merge records.",
    complex_includes:  "Large-scale data migration or import across systems. Cleaning and normalizing data from multiple inconsistent sources.",
    not_included:      "Sourcing or finding data not provided. Scraping websites. Building integrations or automations.",
  },

  "Payroll Processing Help": {
    simple:   null,
    standard: 199,
    complex:  349,
    what_we_do: "Organize, format, and prepare payroll data so it is ready to run. We prepare the numbers — we do not submit payroll to a processor or issue checks.",
    standard_includes: "Full payroll prep for a team — calculate gross pay, deductions summary, and net pay from provided time records. Produce a run-ready summary sheet.",
    complex_includes:  "Multi-period payroll reconciliation. Correcting prior runs. Quarterly summary reports. Tracking PTO, overtime, and adjustments across multiple pay periods.",
    not_included:      "Submitting payroll through any processor (ADP, Gusto, Paychex, etc.). Filing payroll taxes. Issuing checks or direct deposits.",
  },

  "Receipt / Expense Organization": {
    simple:   79,
    standard: 149,
    complex:  249,
    what_we_do: "Sort, categorize, and summarize receipts and expenses into organized reports from uploaded files or photos.",
    simple_includes:   "Categorize and total a single month of receipts into a clean summary. Match receipts to a provided transaction list.",
    standard_includes: "Full quarter expense report — categorized by type, totaled by category, formatted for your accountant or bookkeeper. Mileage log formatting included.",
    complex_includes:  "Multi-month reconciliation across multiple accounts or cards. Reimbursement reports for a team. Expense tracking system setup.",
    not_included:      "Bookkeeping, tax filing, or accounting software entries unless access is provided.",
  },

  "Invoice & Estimate Follow-Up": {
    simple:   79,
    standard: 149,
    complex:  249,
    what_we_do: "Write and send follow-up communications for outstanding invoices, overdue accounts, or pending estimates.",
    simple_includes:   "Draft and send a single round of follow-up emails for outstanding invoices or estimates.",
    standard_includes: "Full AR aging review — identify overdue accounts, draft tiered follow-ups by age (30/60/90 day), and send.",
    complex_includes:  "Full collections follow-up process — escalating message sequences, final notice templates, and a tracking system for responses.",
    not_included:      "Collecting payments, issuing credits, or contacting clients by phone.",
  },

  "Research & Competitive Analysis": {
    simple:   null,
    standard: 199,
    complex:  349,
    what_we_do: "Research a topic, competitor, market, or question and deliver a clear organized summary with sources.",
    standard_includes: "Full competitive analysis — 3 to 5 competitors compared across pricing, services, positioning, and online presence. Delivered as a summary document.",
    complex_includes:  "Deep market research report — multiple sources, trend analysis, pricing landscape, opportunity summary, and recommendations. Multi-section document.",
    not_included:      "Primary research such as surveys or interviews. Legal or financial advice.",
  },

  "Reporting & Summaries": {
    simple:   79,
    standard: 149,
    complex:  279,
    what_we_do: "Turn raw data, notes, or documents into clean readable reports and summaries.",
    simple_includes:   "Summarize a single document, set of meeting notes, or dataset into a clear written summary.",
    standard_includes: "Weekly or monthly business performance report from provided data. Narrative summary plus key metrics in a clean formatted document.",
    complex_includes:  "Multi-source report pulling from multiple data inputs — narrative, charts, tables, and a recommendations section.",
    not_included:      "Sourcing data not provided. Live dashboard builds (see Spreadsheet / Data Work).",
  },

  "Database Build or Cleanup": {
    simple:   null,
    standard: 199,
    complex:  399,
    what_we_do: "Build or clean up organized databases in spreadsheets, Airtable, Notion, or basic CRM systems such as HubSpot free or Zoho.",
    standard_includes: "Full CRM or database setup — custom fields, categories, views, and filters. Import existing data and organize for daily use.",
    complex_includes:  "Large-scale database build with relationships, automation rules, and multiple views. Data import, deduplication, and normalization across sources.",
    not_included:      "Enterprise CRM development. Code-based database work. API integrations.",
  },

  // ── EMAIL & OUTREACH ──────────────────────────────────────────────────────

  "Email Management / Outreach": {
    simple:   79,
    standard: 149,
    complex:  279,
    what_we_do: "Write, format, and schedule outbound emails and outreach. We write the copy and prepare it to send — we do not manage inbox replies.",
    simple_includes:   "Write a single outreach email or response template. Formatted and ready to send.",
    standard_includes: "Write and schedule a batch of outreach emails up to 10. Subject line variants, personalization tokens, formatted and ready to send.",
    complex_includes:  "Full outreach campaign — segmented list, personalized sequences, scheduled sends, and follow-up emails.",
    not_included:      "Managing inbox replies. List building or lead sourcing. Full email platform setup beyond what is needed for the send.",
  },

  "Customer Follow-Up Sequences": {
    simple:   null,
    standard: 199,
    complex:  349,
    what_we_do: "Write and set up follow-up email or text sequences for after a job, purchase, or appointment.",
    standard_includes: "3-touch post-service sequence — thank you, review request, and referral ask. Written, formatted, and set up in your platform if access is provided.",
    complex_includes:  "Full multi-touch sequence — 5 or more touchpoints, conditional timing, and segmentation by job type or customer category. Platform setup included.",
    not_included:      "Building the email platform from scratch. SMS automation without platform access.",
  },

  "Review & Referral Outreach": {
    simple:   79,
    standard: 149,
    complex:  249,
    what_we_do: "Write and send outreach to generate reviews on Google, Yelp, or Facebook and encourage referrals.",
    simple_includes:   "Single review request email or text template with a direct link to your review page.",
    standard_includes: "2 to 3 touchpoint campaign — initial ask, one follow-up, and a referral prompt. Written and formatted for your platform.",
    complex_includes:  "Full review and referral system — automated sequence, segmented by customer type, with tracking.",
    not_included:      "Responding to existing reviews. Removing or flagging negative reviews.",
  },

  "New Customer Welcome Campaigns": {
    simple:   null,
    standard: 199,
    complex:  349,
    what_we_do: "Write and set up a sequence of communications that welcome a new customer after their first purchase or appointment.",
    standard_includes: "3-part welcome sequence — introduction, value delivery, and next steps. Written, formatted, and set up in your platform.",
    complex_includes:  "Full onboarding campaign — segmented by customer type, 5 or more touchpoints, with automated triggers and platform setup.",
    not_included:      "Building the email platform from scratch. Loyalty program setup.",
  },

  "Seasonal Re-Engagement Campaign": {
    simple:   null,
    standard: 199,
    complex:  349,
    what_we_do: "Write and send a campaign to re-engage customers who have not purchased or booked in a while.",
    standard_includes: "2 to 3 email seasonal campaign with an offer or reason to return. Written, formatted, and scheduled.",
    complex_includes:  "Full segmented re-engagement campaign — multiple customer segments, 4 or more touchpoints, with tracking and a follow-up sequence.",
    not_included:      "List building. Paid advertising. Incentive fulfillment.",
  },

  "Appointment Confirmation Setup": {
    simple:   null,
    standard: 199,
    complex:  349,
    what_we_do: "Write and set up confirmation and reminder messages for appointments or service calls.",
    standard_includes: "Confirmation plus day-before and day-of reminders. Written for email or text and set up in your booking or messaging platform.",
    complex_includes:  "Full 5-touch confirmation system — booking confirmation, reminder sequence, reschedule option, and no-show follow-up. Platform setup included.",
    not_included:      "Booking platform setup from scratch. Phone call reminders.",
  },

  // ── MARKETING & SOCIAL ────────────────────────────────────────────────────

  "Social Media Management": {
    simple:   99,
    standard: 199,
    complex:  349,
    what_we_do: "Write captions, copy, and post content to your social platforms. We write and schedule — we do not create graphics or photography.",
    simple_includes:   "Write captions and hashtags for 5 posts. Formatted and ready to copy-paste or hand off.",
    standard_includes: "Full week of content — 7 posts with captions, hashtags, and posting schedule. Posted to your platforms if access is provided.",
    complex_includes:  "Monthly content calendar — 30 days of content across platforms, with themes, captions, hashtags, and a scheduling queue.",
    not_included:      "Graphic design, photography, or video editing. Responding to comments or DMs. Paid advertising.",
  },

  "Marketing Campaign Setup": {
    simple:   null,
    standard: 299,
    complex:  499,
    what_we_do: "Plan, write, and set up a marketing campaign across email and social. Delivered ready to launch.",
    standard_includes: "Multi-channel campaign — email copy, social post copy, and a send schedule. Formatted and set up in your platforms.",
    complex_includes:  "Full campaign strategy — audience segmentation, multi-channel copy, scheduling, tracking setup, and a post-campaign summary template.",
    not_included:      "Paid advertising management. Graphic design. Building platforms from scratch.",
  },

  // ── CREATIVE ──────────────────────────────────────────────────────────────

  "Presentation / Deck": {
    simple:   149,
    standard: 299,
    complex:  449,
    overage_rate: 20,        // per slide over 15
    overage_threshold: 15,   // slides included in complex
    what_we_do: "Build or reformat presentations in PowerPoint or Google Slides. Clear, professional, on-brand.",
    simple_includes:   "Clean up and reformat an existing presentation under 10 slides. Fix layout, fonts, and flow.",
    standard_includes: "Build a 10 to 15 slide deck from your outline or notes. Structure, copy, and formatting included.",
    complex_includes:  "Full presentation built from scratch up to 15 slides — structure, copy, data visualization, and design direction. Decks over 15 slides are invoiced at $20 per additional slide.",
    not_included:      "Custom graphic design or illustration. Animation or video.",
  },

  "Marketing Materials": {
    simple:   99,
    standard: 199,
    complex:  349,
    what_we_do: "Write and format marketing collateral — flyers, one-pagers, sell sheets, and promotional pieces. Copy and layout, delivered as a document or PDF.",
    simple_includes:   "Single flyer, one-pager, or promotional piece. Copy written and formatted.",
    standard_includes: "Small set of 2 to 3 coordinated marketing pieces with consistent copy and formatting.",
    complex_includes:  "Full marketing collateral package — 4 or more pieces, coordinated copy and messaging, formatted and ready to print or share.",
    not_included:      "Custom graphic design or brand identity. Print production.",
  },

  "Proposal or One-Pager": {
    simple:   99,
    standard: 199,
    complex:  349,
    what_we_do: "Write and format business proposals, project scopes, and summary documents. Professional copy, clean layout.",
    simple_includes:   "Single-page summary or simple proposal from notes or bullet points you provide.",
    standard_includes: "Full business proposal — executive summary, scope of work, pricing, and terms. Written and formatted.",
    complex_includes:  "Custom multi-section proposal with research, tailored content, competitive positioning, and a designed layout.",
    not_included:      "Legal contract drafting. Pricing strategy consultation.",
  },

  // ── WEBSITE ───────────────────────────────────────────────────────────────

  "Website Updates & Fixes": {
    simple:   null,
    standard: 299,
    complex:  499,
    what_we_do: "Update content, fix issues, and make changes to your website. We work in any CMS (WordPress, Squarespace, Wix, Webflow, or custom code).",
    standard_includes: "Content updates, photo swaps, new page or section, form updates, navigation changes. Anything that does not require rebuilding the site structure.",
    complex_includes:  "Multi-page overhaul, new features, third-party tool integration, automation setup, or significant layout changes. Requires platform access.",
    not_included:      "Full website redesign or rebuild from scratch. Domain or hosting setup. SEO strategy (basic on-page fixes included at complex tier).",
  },

};

// Complexity signals to help AI quoting
const COMPLEXITY_SIGNALS = {
  simple: [
    "single", "one", "quick", "small", "basic", "simple", "just", "minor",
    "update", "fix", "change", "template", "draft", "format", "reformat",
    "clean up", "one page", "one email", "5 posts",
  ],
  complex: [
    "full", "complete", "all", "entire", "multiple", "system", "automate",
    "automation", "integration", "campaign", "strategy", "build from scratch",
    "migrate", "reconcile", "quarterly", "annual", "large", "many",
    "ongoing", "multi", "segmented", "sequence", "platform setup",
  ],
};

// Services that have no Simple tier — minimum is Standard
const STANDARD_MINIMUM = [
  "Payroll Processing Help",
  "Research & Competitive Analysis",
  "Database Build or Cleanup",
  "Customer Follow-Up Sequences",
  "New Customer Welcome Campaigns",
  "Seasonal Re-Engagement Campaign",
  "Appointment Confirmation Setup",
  "Marketing Campaign Setup",
  "Website Updates & Fixes",
];

module.exports = { AD_HOC_PRICING, COMPLEXITY_SIGNALS, STANDARD_MINIMUM };
