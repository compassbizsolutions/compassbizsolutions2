/**
 * /api/generate-docs
 * Generates personalized .docx files for each customer at intake completion.
 * Called in parallel with send-plan.js — non-blocking.
 *
 * Strategy:
 * - Guides (#1-#10): AI rewrites the example story with customer's trade/numbers,
 *   pre-fills Step 1 honest answers and Key Numbers tables from intake data.
 * - Process templates (Appointment, Follow-Up, Handbook, etc.): fills all
 *   [bracketed fields] with customer's actual business data.
 * - Stores each generated doc as base64 in Upstash KV under doc:{emailHash}:{docKey}
 * - Auth for retrieval uses email hash (Option A)
 */

const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, BorderStyle, WidthType, ShadingType, LevelFormat
} = require("docx");
const crypto = require("crypto");

// ─── KV HELPERS ──────────────────────────────────────────────────────────────
function emailHash(email) {
  return crypto.createHash("sha256").update(email.toLowerCase().trim()).digest("hex").slice(0, 32);
}

async function saveDocToKV(email, docKey, base64, filename) {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) return;
  const key = "doc:" + emailHash(email) + ":" + docKey;
  // Store with 90-day TTL (in seconds)
  await fetch(url + "/set/" + encodeURIComponent(key), {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify({ base64, filename, generatedAt: new Date().toISOString() })
  }).catch(function(e) { console.error("KV save error:", e.message); });
  // Set expiry
  await fetch(url + "/expire/" + encodeURIComponent(key) + "/7776000", {
    method: "POST",
    headers: { Authorization: "Bearer " + token }
  }).catch(function() {});
}

// ─── DOC STYLE HELPERS ───────────────────────────────────────────────────────
const NAVY = "1B2E4B";
const AMBER = "C8701A";
const RED = "B84C2E";
const SLATE = "3D6B9E";
const WARM_BG = "F7F5F2";
const WHITE = "FFFFFF";
const LIGHT_GRAY = "F0EFED";

const border = { style: BorderStyle.SINGLE, size: 1, color: "D8D4CD" };
const borders = { top: border, bottom: border, left: border, right: border };
const noBorder = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
const noBorders = { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder };

function pageProps() {
  return {
    page: {
      size: { width: 12240, height: 15840 },
      margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 }
    }
  };
}

function headerBar(line1, line2, subtitle) {
  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [9360],
    rows: [new TableRow({
      children: [new TableCell({
        borders: noBorders,
        shading: { fill: NAVY, type: ShadingType.CLEAR },
        margins: { top: 200, bottom: 200, left: 300, right: 300 },
        width: { size: 9360, type: WidthType.DXA },
        children: [
          new Paragraph({ children: [new TextRun({ text: "COMPASS BUSINESS SOLUTIONS", font: "Arial", size: 16, bold: true, color: "AABBCC", characterSpacing: 80 })] }),
          new Paragraph({ children: [new TextRun({ text: line1, font: "Arial", size: 36, bold: true, color: AMBER })] }),
          new Paragraph({ children: [new TextRun({ text: line2, font: "Arial", size: 22, bold: true, color: WHITE })] }),
          subtitle ? new Paragraph({ spacing: { before: 60 }, children: [new TextRun({ text: subtitle, font: "Arial", size: 18, color: "AABBCC", italics: true })] }) : new Paragraph({ children: [new TextRun("")] }),
        ]
      })]
    })]
  });
}

function sectionHeader(text, color) {
  return new Paragraph({
    spacing: { before: 320, after: 100 },
    border: { left: { style: BorderStyle.SINGLE, size: 14, color: color || AMBER, space: 8 } },
    indent: { left: 200 },
    children: [new TextRun({ text: text.toUpperCase(), font: "Arial", size: 22, bold: true, color: color || AMBER, characterSpacing: 60 })]
  });
}

function bodyText(text, bold) {
  return new Paragraph({
    spacing: { before: 80, after: 80 },
    children: [new TextRun({ text: text, font: "Arial", size: 20, bold: bold || false, color: "222222" })]
  });
}

function calloutBox(text, color) {
  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [9360],
    rows: [new TableRow({
      children: [new TableCell({
        borders: { top: border, bottom: border, left: { style: BorderStyle.SINGLE, size: 8, color: color || AMBER }, right: border },
        shading: { fill: WARM_BG, type: ShadingType.CLEAR },
        margins: { top: 120, bottom: 120, left: 200, right: 200 },
        width: { size: 9360, type: WidthType.DXA },
        children: [new Paragraph({
          children: [new TextRun({ text: text, font: "Arial", size: 19, color: "333333", italics: true })]
        })]
      })]
    })]
  });
}

function twoColTable(rows, headerRow) {
  const tableRows = [];
  if (headerRow) {
    tableRows.push(new TableRow({
      children: headerRow.map(function(h, i) {
        return new TableCell({
          borders,
          shading: { fill: NAVY, type: ShadingType.CLEAR },
          margins: { top: 80, bottom: 80, left: 120, right: 120 },
          width: { size: i === 0 ? 5760 : 3600, type: WidthType.DXA },
          children: [new Paragraph({ children: [new TextRun({ text: h, font: "Arial", size: 19, bold: true, color: WHITE })] })]
        });
      })
    }));
  }
  rows.forEach(function(row) {
    tableRows.push(new TableRow({
      children: row.map(function(cell, i) {
        const isFilled = cell && !cell.startsWith("$___") && !cell.startsWith("___") && cell !== "$" && cell !== "";
        return new TableCell({
          borders,
          shading: { fill: isFilled ? "FEFCF8" : WHITE, type: ShadingType.CLEAR },
          margins: { top: 80, bottom: 80, left: 120, right: 120 },
          width: { size: i === 0 ? 5760 : 3600, type: WidthType.DXA },
          children: [new Paragraph({
            children: [new TextRun({ text: cell || "", font: "Arial", size: 19, bold: i === 0 && cell && cell === cell.toUpperCase(), color: isFilled && i === 1 ? NAVY : "333333" })]
          })]
        });
      })
    }));
  });
  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [5760, 3600],
    rows: tableRows
  });
}

function spacer(before) {
  return new Paragraph({ spacing: { before: before || 160, after: 0 }, children: [new TextRun("")] });
}

function footerNote() {
  return [
    spacer(400),
    new Paragraph({ border: { top: { style: BorderStyle.SINGLE, size: 2, color: "D8D4CD" } }, spacing: { before: 0, after: 80 }, children: [new TextRun("")] }),
    new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "Compass Business Solutions  ·  compassbizsolutions.com", font: "Arial", size: 16, color: AMBER })] })
  ];
}

// ─── AI CALL HELPER ──────────────────────────────────────────────────────────
async function aiPersonalize(systemPrompt, userPrompt) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1200,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }]
    })
  });
  const data = await response.json();
  return data.content ? data.content.map(function(b) { return b.text || ""; }).join("") : "";
}

// Parse AI JSON response safely
function parseJSON(text) {
  try {
    const clean = text.replace(/```json|```/g, "").trim();
    return JSON.parse(clean);
  } catch(e) {
    return {};
  }
}

// ─── INTAKE DATA EXTRACTOR ───────────────────────────────────────────────────
function extractIntakeData(answers, multiAnswers) {
  const all = Object.assign({}, answers || {});
  Object.keys(multiAnswers || {}).forEach(function(k) {
    all[k] = (multiAnswers[k] || []).join(", ");
  });
  return all;
}

// ─── DOC BUILDERS ────────────────────────────────────────────────────────────

// GUIDES: AI personalizes the example story + pre-fills Step 1 answers
async function buildGuide(docKey, guideTitle, guideSeries, guideSubtitle, templateContent, intakeData, biz, name, trade) {
  const intakeSummary = Object.keys(intakeData).map(function(k) { return k + ": " + intakeData[k]; }).join("\n");

  const aiResult = parseJSON(await aiPersonalize(
    "You personalize business workbooks for blue-collar service business owners. Return ONLY valid JSON, no markdown, no explanation.",
    `Business: ${biz}, Owner: ${name}, Trade: ${trade}

Intake answers:
${intakeSummary}

Workbook: ${guideTitle}

Task: Return a JSON object with these keys:
{
  "example_story": "Rewrite the main example story in this workbook (the 'Real Example' box) using the owner's actual trade, realistic numbers from their intake, and their business situation. 3-5 sentences. Use a fictional name for the example owner. Make it feel like it was written specifically for someone in their trade.",
  "step1_answers": "2-3 sentences summarizing what their intake answers reveal about THIS specific leak category — honest, specific to their numbers.",
  "key_insight": "1-2 sentences: the most important insight from this guide for THIS owner based on their specific situation and numbers.",
  "action_commitment": "Complete this sentence for their specific situation: 'Based on your answers, the single most important thing you can do this week is...'"
}`
  ));

  const children = [
    headerBar(guideTitle, guideSeries, guideSubtitle),
    spacer(240),
    new Table({
      width: { size: 9360, type: WidthType.DXA },
      columnWidths: [9360],
      rows: [new TableRow({
        children: [new TableCell({
          borders,
          shading: { fill: LIGHT_GRAY, type: ShadingType.CLEAR },
          margins: { top: 160, bottom: 160, left: 240, right: 240 },
          width: { size: 9360, type: WidthType.DXA },
          children: [
            new Paragraph({ children: [new TextRun({ text: "Prepared for: " + biz, font: "Arial", size: 20, bold: true, color: NAVY })] }),
            new Paragraph({ children: [new TextRun({ text: "Owner: " + name + "  ·  Trade: " + trade, font: "Arial", size: 18, color: "555555" })] }),
            new Paragraph({ children: [new TextRun({ text: "Generated: " + new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }), font: "Arial", size: 16, color: "888888" })] }),
          ]
        })]
      })]
    }),
    spacer(240),
  ];

  // What we see from your intake
  if (aiResult.step1_answers) {
    children.push(sectionHeader("What Your Intake Tells Us", SLATE));
    children.push(spacer(80));
    children.push(calloutBox(aiResult.step1_answers, SLATE));
    children.push(spacer(160));
  }

  // Key insight
  if (aiResult.key_insight) {
    children.push(sectionHeader("The Key Insight For Your Business", AMBER));
    children.push(spacer(80));
    children.push(calloutBox(aiResult.key_insight, AMBER));
    children.push(spacer(160));
  }

  // Personalized example
  if (aiResult.example_story) {
    children.push(sectionHeader("A Business Like Yours", RED));
    children.push(spacer(80));
    children.push(new Table({
      width: { size: 9360, type: WidthType.DXA },
      columnWidths: [9360],
      rows: [new TableRow({
        children: [new TableCell({
          borders: noBorders,
          shading: { fill: "FDF3E7", type: ShadingType.CLEAR },
          margins: { top: 160, bottom: 160, left: 240, right: 240 },
          width: { size: 9360, type: WidthType.DXA },
          children: [new Paragraph({
            children: [new TextRun({ text: aiResult.example_story, font: "Arial", size: 19, color: "333333", italics: true })]
          })]
        })]
      })]
    }));
    children.push(spacer(160));
  }

  // The full workbook content (formatted from template)
  children.push(sectionHeader("Your Workbook — Work Through These Steps", NAVY));
  children.push(spacer(80));
  children.push(bodyText("Use this workbook with your actual numbers. The fields below are yours to fill in.", false));
  children.push(spacer(120));

  // Render template content as readable paragraphs
  const lines = templateContent.split("\n");
  lines.forEach(function(line) {
    const trimmed = line.trim();
    if (!trimmed) return;
    if (trimmed.startsWith("STEP ") || trimmed.startsWith("YOUR ACTION PLAN") || trimmed.startsWith("MY KEY NUMBERS")) {
      children.push(spacer(160));
      children.push(sectionHeader(trimmed, NAVY));
    } else if (trimmed.startsWith("Fix #") || trimmed.startsWith("What to Say") || trimmed.startsWith("The ")) {
      children.push(bodyText(trimmed, true));
    } else {
      children.push(new Paragraph({
        spacing: { before: 60, after: 0 },
        children: [new TextRun({ text: trimmed, font: "Arial", size: 19, color: "333333" })]
      }));
    }
  });

  // Action commitment
  if (aiResult.action_commitment) {
    children.push(spacer(240));
    children.push(sectionHeader("Your #1 Priority This Week", RED));
    children.push(spacer(80));
    children.push(new Table({
      width: { size: 9360, type: WidthType.DXA },
      columnWidths: [9360],
      rows: [new TableRow({
        children: [new TableCell({
          borders: noBorders,
          shading: { fill: "FAE8E4", type: ShadingType.CLEAR },
          margins: { top: 160, bottom: 160, left: 240, right: 240 },
          width: { size: 9360, type: WidthType.DXA },
          children: [new Paragraph({
            children: [new TextRun({ text: aiResult.action_commitment, font: "Arial", size: 20, bold: true, color: RED })]
          })]
        })]
      })]
    }));
  }

  children.push(...footerNote());

  const doc = new Document({
    styles: { default: { document: { run: { font: "Arial", size: 20 } } } },
    sections: [{ properties: pageProps(), children }]
  });

  return Packer.toBuffer(doc);
}

// PROCESS TEMPLATES: fill all [bracketed fields] with customer data
async function buildProcessTemplate(docKey, templateTitle, templateContent, intakeData, biz, name, trade) {
  const intakeSummary = Object.keys(intakeData).map(function(k) { return k + ": " + intakeData[k]; }).join("\n");

  const aiResult = parseJSON(await aiPersonalize(
    "You fill in business process document templates for blue-collar service business owners. Return ONLY valid JSON, no markdown, no explanation.",
    `Business: ${biz}, Owner: ${name}, Trade: ${trade}

Intake answers:
${intakeSummary}

Template: ${templateTitle}

Task: Return a JSON object with these keys (fill in realistic values based on their intake data — if info isn't available, use sensible defaults for their trade):
{
  "business_name": "${biz}",
  "owner_name": "${name}",
  "trade": "${trade}",
  "phone": "extract from intake or use [phone number]",
  "custom_intro": "2-3 sentences customizing the 'Why This Matters' section for their specific business situation and trade. Reference their actual numbers or situation where possible.",
  "field_overrides": {
    "[bracketed field name]": "filled value"
  }
}

For field_overrides, identify every [bracketed placeholder] in the template and provide a realistic filled value based on their intake data. Common fields: dollar amounts, time windows, responsible person names, thresholds, trade-specific items.`
  ));

  // Apply field overrides to template content
  let personalizedContent = templateContent
    .replace(/\[YOUR BUSINESS NAME\]/g, biz || "[Business Name]")
    .replace(/\[BUSINESS NAME\]/g, biz || "[Business Name]")
    .replace(/\[Your Name\]/g, name || "[Owner Name]")
    .replace(/\[Business Name\]/g, biz || "[Business Name]");

  if (aiResult.field_overrides) {
    Object.keys(aiResult.field_overrides).forEach(function(placeholder) {
      const value = aiResult.field_overrides[placeholder];
      if (value) {
        const escaped = placeholder.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        personalizedContent = personalizedContent.replace(new RegExp(escaped, "g"), value);
      }
    });
  }

  // Build the doc
  const children = [
    headerBar(biz || "Your Business", templateTitle, "Provided by Compass Business Solutions"),
    spacer(200),
    new Table({
      width: { size: 9360, type: WidthType.DXA },
      columnWidths: [9360],
      rows: [new TableRow({
        children: [new TableCell({
          borders,
          shading: { fill: LIGHT_GRAY, type: ShadingType.CLEAR },
          margins: { top: 140, bottom: 140, left: 240, right: 240 },
          width: { size: 9360, type: WidthType.DXA },
          children: [
            new Paragraph({ children: [new TextRun({ text: "Owner: " + name + "  ·  Trade: " + trade, font: "Arial", size: 18, color: "555555" })] }),
            new Paragraph({ children: [new TextRun({ text: "Personalized: " + new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }), font: "Arial", size: 16, color: "888888" })] }),
          ]
        })]
      })]
    }),
    spacer(200),
  ];

  // Customized Why This Matters
  if (aiResult.custom_intro) {
    children.push(sectionHeader("Why This Matters — For " + (biz || "Your Business"), AMBER));
    children.push(spacer(80));
    children.push(calloutBox(aiResult.custom_intro, AMBER));
    children.push(spacer(160));
  }

  // Render personalized content
  const lines = personalizedContent.split("\n");
  let inTable = false;
  lines.forEach(function(line) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (inTable) inTable = false;
      return;
    }
    // Section headers (ALL CAPS lines)
    if (trimmed === trimmed.toUpperCase() && trimmed.length > 4 && !trimmed.startsWith("|") && !trimmed.startsWith("-")) {
      children.push(spacer(160));
      children.push(sectionHeader(trimmed, NAVY));
    } else if (trimmed.startsWith("|")) {
      // Table rows — render as structured paragraphs
      const cells = trimmed.split("|").map(function(c) { return c.trim(); }).filter(Boolean);
      if (cells.length >= 2 && !cells[0].match(/^-+$/)) {
        children.push(new Table({
          width: { size: 9360, type: WidthType.DXA },
          columnWidths: [4680, 4680],
          rows: [new TableRow({
            children: [
              new TableCell({
                borders,
                margins: { top: 60, bottom: 60, left: 120, right: 120 },
                width: { size: 4680, type: WidthType.DXA },
                children: [new Paragraph({ children: [new TextRun({ text: cells[0], font: "Arial", size: 19, bold: true, color: NAVY })] })]
              }),
              new TableCell({
                borders,
                shading: { fill: cells[1] && cells[1] !== "" ? "FEFCF8" : WHITE, type: ShadingType.CLEAR },
                margins: { top: 60, bottom: 60, left: 120, right: 120 },
                width: { size: 4680, type: WidthType.DXA },
                children: [new Paragraph({ children: [new TextRun({ text: cells[1] || "", font: "Arial", size: 19, color: "333333" })] })]
              })
            ]
          })]
        }));
        children.push(spacer(40));
      }
    } else if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
      children.push(new Paragraph({
        spacing: { before: 60, after: 0 },
        indent: { left: 360 },
        children: [
          new TextRun({ text: "\u2022  ", font: "Arial", size: 19, color: AMBER, bold: true }),
          new TextRun({ text: trimmed.replace(/^[-*]\s+/, ""), font: "Arial", size: 19, color: "333333" })
        ]
      }));
    } else {
      children.push(new Paragraph({
        spacing: { before: 80, after: 0 },
        children: [new TextRun({ text: trimmed, font: "Arial", size: 19, color: "333333" })]
      }));
    }
  });

  children.push(...footerNote());

  const doc = new Document({
    styles: { default: { document: { run: { font: "Arial", size: 20 } } } },
    sections: [{ properties: pageProps(), children }]
  });

  return Packer.toBuffer(doc);
}

// ─── DOC REGISTRY ────────────────────────────────────────────────────────────
// Maps each doc file key to its builder config
const DOC_REGISTRY = {
  "CBS_Guide_1_The_Pricing_Leak_Fix": {
    type: "guide",
    title: "THE PRICING LEAK FIX",
    series: "Profit Leak Repair Series · #1",
    subtitle: "Are you charging enough — or just staying busy?",
    template: `STEP 1 — LET'S GET HONEST
When did you last raise your prices?
How did you come up with your current rate?
Do you ever finish a job and feel like you barely broke even?
Do you know your actual profit margin per job?

STEP 2 — FIND YOUR REAL MINIMUM RATE
Your Overhead Cost Per Hour
Insurance (all policies — divide annual by 12): $
Vehicle costs (payments + fuel + maintenance): $
Tools, equipment, repairs: $
Phone, technology & improvement: $
Licensing, certifications, compliance: $
Marketing, advertising: $
Admin, bookkeeping, office expenses: $
TOTAL MONTHLY OVERHEAD: $
÷ Monthly billable hours (all trucks combined): hrs
= OVERHEAD COST PER BILLABLE HOUR: $/hr

Now Build Your Real Cost Per Hour
Hourly wage paid per tech: $/hr
Payroll taxes on that wage (~12-15%): $/hr
Overhead cost per billable hour (from above): $/hr
TOTAL COST PER BILLABLE HOUR: $/hr

Your Minimum Profitable Rate
My Total Cost Per Hour: $ ÷ _______ = My Minimum Rate: $
20% is a reasonable floor. Established businesses with strong reputations often run 25-35%.

STEP 3 — CHECK YOUR LAST 3 JOBS
Pull up 3 recent invoices. For each one, fill in what you charged, how long it actually took, and what materials cost you.
Job 1: $ Charged | Hours | Materials $ | Net After Costs $
Job 2: $ Charged | Hours | Materials $ | Net After Costs $
Job 3: $ Charged | Hours | Materials $ | Net After Costs $

STEP 4 — HOW TO RAISE YOUR PRICES WITHOUT DRAMA
Under 10% increase: Do it now. Most customers won't even mention it.
10-20% increase: Give 30 days notice. Send a quick text or email.
Over 20% increase: Two steps, 6 months apart.

YOUR ACTION PLAN
My new minimum rate is $___________
I will update my quotes to reflect this rate
I will notify existing customers of the change
I will review pricing again in 6 months

MY KEY NUMBERS — KEEP THIS PAGE
My true cost per hour: $
My minimum profitable rate: $
My new rate going forward: $
My estimated annual pricing leak (before fix): $
What fixing it puts back in my pocket per year: $`
  },

  "CBS_Guide_2_The_Scheduling_Black_Hole": {
    type: "guide",
    title: "THE SCHEDULING BLACK HOLE",
    series: "Profit Leak Repair Series · #2",
    subtitle: "Stop losing jobs before they start",
    template: `STEP 1 — LET'S GET HONEST
How many jobs do you book per week on average?
How many don't happen? (cancels, no-shows, empty slots)
Do you confirm appointments the day before?
When a job cancels same-day, do you fill the slot?
How far out is your calendar typically full?
Do you track your cancellation rate?

STEP 2 — FIND YOUR SCHEDULING LEAK
Jobs you could complete in a full week (capacity): ___
Jobs you actually complete on average: ___
Difference (unfilled or lost slots per week): ___
Your average job value ($): $
Weekly revenue lost (difference × job value): $
Annual scheduling leak (weekly loss × 50 weeks): $

STEP 3 — AUDIT YOUR LAST TWO WEEKS
Review your last 14 days. For each missed job, note why it was lost.
Common causes: Customer no-show/forgot | Customer cancelled last minute | Job ran long | Tech called out | Part not available

STEP 4 — CLOSE THE BLACK HOLE
Fix #1: The Afternoon-Before Confirmation — Call the afternoon before. Text immediately after. Require an actual reply.
Fix #2: Build a Fill-In List — Keep a running list of customers who said 'call me if you have a cancellation.'
Fix #3: Minimum Cancellation Window — Set a policy: cancellations with less than [X] hours notice are subject to a cancellation fee.

YOUR ACTION PLAN
My weekly slot loss is ___ jobs / $___ revenue
My annual scheduling leak estimate is $___
I will start confirming appointments the afternoon before
I will build a fill-in list of ___ customers
I will set a cancellation policy of ___ hours notice
I will track my slot fill rate weekly

MY KEY NUMBERS — KEEP THIS PAGE
Jobs lost per week (avg): ___
Average job value: $
Weekly revenue lost: $
Annual scheduling leak: $
Potential annual recovery: $`
  },

  "CBS_Guide_3_The_Employee_Cost_Leak": {
    type: "guide",
    title: "THE EMPLOYEE COST LEAK",
    series: "Profit Leak Repair Series · #3",
    subtitle: "What your labor is really costing you",
    template: `STEP 1 — LET'S GET HONEST
How many techs do you have (including yourself)?
What's your average tech wage per hour?
What % of each tech's day is actually billable work?
Hours lost per week to tardiness across all trucks?
Hours per week of overtime paid?
How many techs have you hired/replaced in 12 months?

STEP 2 — FIND YOUR EMPLOYEE COST LEAK
The Tardiness Leak
Crew hours lost to tardiness per week: ___ hrs
Average crew size per truck: ___ people
Your billing rate: $/hr
Billable hours lost per week: ___ hrs
Weekly tardiness leak: $
Annual tardiness leak (weekly × 50 weeks): $

The Productivity Gap
Hours per day per tech (paid): ___ hrs
Billable % (how much of the day is on a job): ___%
Billable hours per tech per day: ___ hrs
Non-billable hours per tech per day (paid): ___ hrs
Number of techs: ___
Daily productivity leak: $
Annual productivity leak (× 5 days × 50 weeks): $

The Turnover Leak
Techs replaced in the last 12 months: ___
Your estimated cost to replace one tech: $
Annual turnover cost: $

STEP 3 — CHECK YOUR LAST PAYROLL
Review last 2 weeks of payroll: hours paid vs hours billed, billable %, overtime.

STEP 4 — CLOSE THE EMPLOYEE COST LEAK
Fix #1: Tardiness Policy — Set clear start time. Two late arrivals in 90 days triggers a conversation. Three triggers written warning.
Fix #2: Daily Billable Hours Target — Give every tech a daily billable hours target. Track it weekly. Post it.
Fix #3: Reduce Non-Billable Time — Proper truck stocking, better dispatch routing, mobile invoicing.

YOUR ACTION PLAN
My annual tardiness leak estimate is $___
My annual productivity gap estimate is $___
My annual turnover cost estimate is $___
I will implement a clear tardiness policy
I will set daily billable hours targets for each tech
I will track billable % weekly for the next 30 days

MY KEY NUMBERS — KEEP THIS PAGE
Annual tardiness leak: $
Annual productivity gap: $
Annual turnover cost: $
Total employee cost leak: $
Potential annual recovery (fix 70%): $`
  },

  "CBS_Guide_4_The_Recurring_Revenue_Gap": {
    type: "guide",
    title: "THE RECURRING REVENUE GAP",
    series: "Profit Leak Repair Series · #4",
    subtitle: "Build income that shows up every month",
    template: `STEP 1 — LET'S GET HONEST
Do you currently offer any maintenance plans or contracts?
If yes — how many active maintenance customers?
Monthly revenue from those contracts?
How severe are your seasonal swings?
What do you do in your slow season?
Do any customers pay annually upfront for service?

STEP 2 — FIND YOUR RECURRING REVENUE GAP
Current monthly recurring revenue (contracts/plans): $
Current annual recurring revenue: $
% of total revenue that's recurring: ___%
Customers who use you regularly (estimate): ___
% who might buy a maintenance plan: ___%
Potential maintenance customers: ___
Realistic monthly plan price for your trade: $
Potential monthly recurring revenue: $
YOUR RECURRING REVENUE GAP: $

STEP 3 — DESIGN YOUR MAINTENANCE PLAN
Plan name (e.g. Annual Care Plan): ___
What's included (services, visits, priority): ___
What's discounted (repairs, parts, labor): ___
Price — annual upfront: $
Price — monthly option (optional): $/mo
Contract length: Annual / Month-to-month

STEP 4 — CLOSE THE RECURRING REVENUE GAP
Identify top 20 existing customers to call first — This week
Design and price your maintenance plan — This week
Offer at the end of every job going forward — Starting now
Add plan option to all estimates and invoices — This month
Set up annual auto-renewal reminders — This month

MY KEY NUMBERS — KEEP THIS PAGE
Current monthly recurring revenue: $
Target maintenance customers: ___
Plan price (annual): $
Potential annual recurring revenue: $
Annual recurring revenue gap: $`
  },

  "CBS_Guide_5_The_Estimate_to_Invoice_Leak": {
    type: "guide",
    title: "THE ESTIMATE-TO-INVOICE LEAK",
    series: "Profit Leak Repair Series · #5",
    subtitle: "Close the gap between what you quote and collect",
    template: `STEP 1 — LET'S GET HONEST
How often do techs do extra work not on the original scope?
When extra work happens, does it get billed?
Do you use written change orders when scope changes?
Are all materials used on a job captured and billed?
Do you mark up parts and materials?
Avg dollar value of extras NOT billed per job (your gut)?

STEP 2 — FIND YOUR ESTIMATE-TO-INVOICE LEAK
Average dollar value of unbilled extras per job: $
Jobs completed per week: ___
Weekly unbilled extras leak: $
Annual unbilled extras leak (weekly × 50 weeks): $

Materials Markup Leak
Average weekly materials spend (what you pay): $
Current markup % on materials: ___%
Standard industry markup for your trade (15-35%): ___%
Gap in markup %: ___%
Weekly materials revenue lost to under-markup: $
Annual materials leak (weekly × 50 weeks): $

STEP 3 — AUDIT FOUR RECENT JOBS
Review 4 recent invoices. Compare estimate vs final invoice. Note any extra work done, whether it was billed, and whether materials were marked up.

STEP 4 — CLOSE THE ESTIMATE-TO-INVOICE LEAK
Fix #1: Change Order Rule — Any additional work over $[your threshold] requires verbal or written change order before proceeding.
Fix #2: End-of-Job Extras Check — Before leaving every job: did anything happen beyond original scope? If yes — it goes on the invoice.
Fix #3: Set Your Materials Markup — Pick your % from the trade standard table and apply it to every part, every job, without exception.

YOUR ACTION PLAN
My annual unbilled extras leak estimate is $___
My annual materials markup leak estimate is $___
I will implement a change order threshold of $___
I will add an extras check to every job closeout
I will set my standard materials markup to ___%

MY KEY NUMBERS — KEEP THIS PAGE
Annual unbilled extras leak: $
Annual materials markup leak: $
Total estimate-to-invoice leak: $
New materials markup %: ___%
Potential annual recovery: $`
  },

  "CBS_Guide_6_The_Cash_Flow_Blind_Spot": {
    type: "guide",
    title: "THE CASH FLOW BLIND SPOT",
    series: "Profit Leak Repair Series · #6",
    subtitle: "Why profitable businesses still feel broke",
    template: `STEP 1 — LET'S GET HONEST
How many weeks of operating expenses do you have in reserve?
How many days after a job do you typically invoice?
How long does it take customers to pay after invoicing?
What % of your invoices end up paid late?
Do you have a business line of credit?
Do you know your profit margin on an average job?

STEP 2 — FIND YOUR CASH FLOW BLIND SPOT
Average weekly revenue (jobs × avg job value): $
Days between job completion and invoice sent: ___ days
Days between invoice sent and payment received: ___ days
Total cash cycle (days between job and payment): ___ days
Cash 'float' tied up in receivables at any time: $
Total value of outstanding invoices: $
Value of invoices more than 30 days past due: $

Seasonality Gap
Your busiest month (revenue estimate): $
Your slowest month (revenue estimate): $
Seasonal revenue swing: $
Fixed monthly expenses regardless of season: $
Months your slow season runs: ___ months
Cash needed to cover slow season shortfall: $

STEP 3 — AUDIT YOUR RECEIVABLES RIGHT NOW
Categorize outstanding invoices by age: 0-7 days, 8-14 days, 15-21 days, 22-30 days, 31-60 days, 60+ days.

STEP 4 — CLOSE THE CASH FLOW BLIND SPOT
Invoice same day — Send before leaving the driveway.
Collect partial upfront — Require 30-50% deposit on jobs over $[amount].
Set payment terms clearly — Print on every invoice.
Slow season reserve fund — Put 10-15% of every payment aside during peak.
Follow-up system — 7-day reminder, 14-day call, 21-day letter.

MY KEY NUMBERS — KEEP THIS PAGE
Current cash cycle (days): ___ days
Current outstanding receivables: $
Outstanding > 30 days: $
Seasonal shortfall to cover: $
Slow season reserve target: $`
  },

  "CBS_Guide_7_The_Customer_Churn_Leak": {
    type: "guide",
    title: "THE CUSTOMER CHURN LEAK",
    series: "Profit Leak Repair Series · #7",
    subtitle: "The customers you have are your best growth",
    template: `STEP 1 — LET'S GET HONEST
Do you follow up with customers after a job?
Do you ask customers for reviews?
Do you have a referral program or incentive?
How many customers have you lost in the last 12 months?
How many times does a good customer use you per year?
What % of your jobs are new vs. repeat customers?

STEP 2 — FIND YOUR CHURN LEAK
Customers lost or gone quiet in the last 12 months: ___
Average times a customer uses you per year: ___ times
Average job value: $
Annual value of one lost customer: $
Annual churn cost (lost customers × annual value): $

No-Follow-Up Cost
Total customers you've done work for (estimate): ___
Customers who used you more than once: ___
% who came back: ___%
Your gap (how many more should be coming back): ___
Annual value of that gap: $

STEP 3 — AUDIT YOUR CUSTOMER LIST
Categorize customers: Active (used 2+ times this year), One-time, Lapsed, Lost.

STEP 4 — CLOSE THE CHURN LEAK
Post-job same-day text — After every job.
Day 3 review request — 3 days after every job.
30-day check-in call — 1 month after each job.
Annual seasonal reminder — Once per year per customer.
Personal re-engagement of lapsed customers — This week.

MY KEY NUMBERS — KEEP THIS PAGE
Annual churn cost (lost customers): $
Lapsed customers to re-engage: ___
Current repeat rate: ___%
Target repeat rate: ___%
Potential annual recovery: $`
  },

  "CBS_Guide_8_The_Materials_Markup_Fix": {
    type: "guide",
    title: "THE MATERIALS MARKUP FIX",
    series: "Profit Leak Repair Series · #8",
    subtitle: "Stop giving away margin on every job",
    template: `STEP 1 — LET'S GET HONEST
Do you currently mark up materials and parts?
If yes — what's your current markup %?
Do you know the standard markup for your trade?
Do you track what you spend on materials per job?
Have you ever lost money on a job because of material costs?
Do you charge for small parts, consumables, shop supplies?

STEP 2 — FIND YOUR MATERIALS MARKUP LEAK
Standard markup by trade: Plumbing 20-35%, HVAC 15-30%, Electrical 15-25%, General contracting 10-25%, Landscaping 20-40%, Pool & spa 20-35%

Average weekly spend on materials (all jobs, all trucks): $
Your current markup % (0 if billing at cost): ___%
Standard markup for your trade: ___%
Gap in markup %: ___%
Additional revenue per week at standard markup: $
Annual materials markup leak (weekly × 50 weeks): $

STEP 3 — AUDIT FIVE RECENT JOBS
For each of 5 recent jobs: Materials Cost (what you paid) vs Materials Billed (what you charged). Calculate markup % and gap $.

STEP 4 — SET YOUR MARKUP AND HOLD IT
Fix #1: Set a Standard Markup and Put It in Every Quote — Pick your % and apply it to every part, every job, without exception.
Fix #2: Add a Shop Supply / Materials Fee — A flat per-job fee ($15-35) for small consumables, fasteners, tape, connectors.
Fix #3: Track Materials Per Job — Even a simple note on the invoice: 'materials: $X'.

YOUR ACTION PLAN
My current markup % is ___. Standard for my trade is ___%
My annual materials markup leak estimate is $___
I will set my standard markup to ___% in my invoicing software
I will add a $___ shop supply fee to every job
I will track materials cost on every invoice going forward

MY KEY NUMBERS — KEEP THIS PAGE
Current materials markup %: ___%
Target materials markup %: ___%
Average weekly materials spend: $
Annual materials markup leak: $
Potential annual recovery: $`
  },

  "CBS_Guide_9_The_Admin_Time_Drain": {
    type: "guide",
    title: "THE ADMIN TIME DRAIN",
    series: "Profit Leak Repair Series · #9",
    subtitle: "Reclaim billable hours hiding in your back office",
    template: `STEP 1 — LET'S GET HONEST
How many hours per week do you personally spend on admin?
How many hours per week does your team spend on admin?
What's your billing rate (what you charge per hour on a job)?
Do you invoice same-day or batch them later?
Do you use invoicing software or paper/spreadsheet?
Do customers frequently call to ask about scheduling or status?

STEP 2 — FIND YOUR ADMIN TIME DRAIN
Invoicing & billing (creating, sending, following up): ___ hrs/week
Scheduling (calls, texts, rearranging, confirmations): ___ hrs/week
Estimates & quotes: ___ hrs/week
Chasing payments / collections: ___ hrs/week
Ordering parts & supplies: ___ hrs/week
Payroll & HR paperwork: ___ hrs/week
Customer calls & questions: ___ hrs/week
Job photos, notes, documentation: ___ hrs/week
TOTAL ADMIN HOURS PER WEEK: ___ hrs

Total admin hours per week: ___ hrs
Your billing rate: $/hr
Weekly revenue opportunity cost of admin time: $
Annual admin time drain (weekly × 50 weeks): $
Realistic % that could be recovered with better systems: ___%
Potential annual recovery: $

STEP 3 — SORT YOUR ADMIN INTO THREE BUCKETS
Automate: Invoicing, confirmation texts, payment reminders, payroll calculations, customer status updates.
Delegate: Scheduling calls, ordering common parts, customer questions.
Streamline: Estimates (templates cut time 60-70%), documentation with mobile apps.

STEP 4 — CLOSE THE ADMIN TIME DRAIN
Same-day mobile invoicing — Jobber, ServiceTitan, Housecall Pro, or even Square. 1 day setup.
Automated payment reminders — Built into most invoicing apps. 1 hr setup.
Appointment confirmation texts — Text automation or a simple script. This week.
Online booking — Calendly or built into scheduling software. 1 day setup.

MY KEY NUMBERS — KEEP THIS PAGE
Total admin hours per week: ___ hrs
Annual cost of admin time (at billing rate): $
Realistic recoverable hours per week: ___ hrs
Potential annual recovery: $`
  },

  "CBS_Guide_10_The_Vehicles___Parts_Leak": {
    type: "guide",
    title: "THE VEHICLES & PARTS LEAK",
    series: "Profit Leak Repair Series · #10",
    subtitle: "What your fleet is really costing you",
    template: `STEP 1 — LET'S GET HONEST
How many trucks in your fleet?
How many unplanned parts runs per truck per week?
Average round-trip time for a parts run?
How many miles does each truck average per week?
Do you have a standard truck stocking list?
Do techs restock their trucks daily or weekly?
Do you track fuel spend per truck?

STEP 2 — FIND YOUR VEHICLES & PARTS LEAK
The Parts Run Leak
Unplanned parts runs per truck per week: ___ runs
Number of trucks: ___ trucks
Total parts runs per week: ___ runs
Average time per round trip (drive + shop + drive): ___ hrs
Billable hours lost per week to parts runs: ___ hrs
Your billing rate: $/hr
Weekly revenue lost to parts runs: $
Annual parts run leak (weekly × 50 weeks): $

Monthly Vehicle Cost Per Truck
Truck payment (or depreciation estimate): $/mo
Fuel: $/mo
Insurance (commercial auto — divide annual by 12): $/mo
Maintenance, oil changes, tires: $/mo
Repairs (average monthly estimate): $/mo
TOTAL MONTHLY COST PER TRUCK: $/mo
÷ Billable hours per truck per month: hrs/mo
= VEHICLE COST PER BILLABLE HOUR: $/hr

STEP 3 — AUDIT YOUR FLEET FOR ONE WEEK
Have every tech track their parts runs and drive time for one week.

STEP 4 — CLOSE THE VEHICLES & PARTS LEAK
Fix #1: Build a Standard Truck Stocking List — List every part, fitting, and supply that should be on every truck at the start of every day.
Fix #2: End-of-Day Restock Routine — Ten minutes at end of every day. Tech checks stocking list, notes what's low.
Fix #3: Know Your Vehicle Cost Per Hour — Do the math and make sure that number is in your billing rate.

MY KEY NUMBERS — KEEP THIS PAGE
Parts runs per truck per week (current): ___
Annual parts run billing time lost: $
Vehicle cost per billable hour: $/hr
Annual fleet operating cost (all trucks): $
Potential annual recovery (fix parts runs): $`
  },

  "CBS_Appointment_Confirmation_Process": {
    type: "template",
    title: "APPOINTMENT CONFIRMATION PROCESS",
    template: null // will use extracted text from context
  },

  "CBS_Customer_Followup_Sequence": {
    type: "template",
    title: "CUSTOMER FOLLOW-UP SEQUENCE",
    template: null
  },

  "CBS_Employee_Handbook": {
    type: "template",
    title: "EMPLOYEE HANDBOOK",
    template: null
  },

  "CBS_Job_Completion_Invoicing_Process": {
    type: "template",
    title: "JOB COMPLETION & INVOICING PROCESS",
    template: null
  },

  "CBS_New_Hire_Training_Documentation": {
    type: "template",
    title: "NEW HIRE TRAINING DOCUMENTATION",
    template: null
  },

  "CBS_Parts_Supply_Ordering_Process": {
    type: "template",
    title: "PARTS & SUPPLY ORDERING PROCESS",
    template: null
  },

  "CBS_Safety_Job_Site_Procedures": {
    type: "template",
    title: "SAFETY & JOB SITE PROCEDURES",
    template: null
  },

  "CBS_Truck_Restocking_Checklist": {
    type: "template",
    title: "TRUCK RESTOCKING CHECKLIST",
    template: null
  },

  "CBS_Pricing_Worksheet_Rate_Calculator": {
    type: "template",
    title: "PRICING WORKSHEET & RATE CALCULATOR",
    template: `STEP 1: Annual Labor Costs
Total gross wages (all technicians): $
Payroll taxes (est. 7.65% of wages): $
Workers compensation insurance: $
Health insurance / benefits: $
Paid time off (vacation, sick days): $
Uniforms / PPE: $
Training & licensing costs: $
TOTAL LABOR COSTS: $

STEP 2: Vehicle & Equipment Costs
Truck payments / lease costs: $
Fuel (all vehicles): $
Vehicle insurance: $
Maintenance & repairs: $
Registration & inspections: $
Tools & equipment purchases: $
Tool maintenance & replacement: $
TOTAL VEHICLE & EQUIPMENT COSTS: $

STEP 3: Overhead Costs
Office / shop rent or mortgage: $
Utilities (office, shop, phone): $
Business insurance (general liability): $
Accounting / bookkeeping: $
Software & subscriptions: $
Advertising & marketing: $
Office supplies & admin costs: $
Professional memberships / licenses: $
Bank fees & merchant processing: $
Owner's salary / draw: $
TOTAL OVERHEAD COSTS: $

STEP 4: Calculate Your Billable Hours
Total working days per year (typically 250): ___ days
Working hours per day: ___ hours
Gross available hours (days × hours): ___ hours
Less: non-billable time (admin, drive, breaks — est. 25-35%): ___ hours
TOTAL ANNUAL BILLABLE HOURS: ___ hours

STEP 5: Calculate Your Break-Even Rate
Total Labor Costs (from Step 1): $
Total Vehicle & Equipment Costs (from Step 2): $
Total Overhead Costs (from Step 3): $
TOTAL ANNUAL COSTS: $
Divide by Billable Hours (from Step 4): ÷
YOUR BREAK-EVEN HOURLY RATE: $___/hr

STEP 6: Add Your Profit Margin
10% profit margin: Break-even rate ÷ 0.90 = $___/hr
15% profit margin: Break-even rate ÷ 0.85 = $___/hr
20% profit margin (recommended): Break-even rate ÷ 0.80 = $___/hr
25% profit margin: Break-even rate ÷ 0.75 = $___/hr
YOUR TARGET BILLING RATE: $_______ per hour

STEP 7: Compare to Your Current Rate
Your current billing rate: $___/hr
Your calculated target rate: $___/hr
Gap (positive = underpricing): $___/hr
Annual impact of the gap (gap × billable hours): $___/yr`
  }
};

// Template text for process docs (pulled from context)
const TEMPLATE_CONTENT = {
  "CBS_Appointment_Confirmation_Process": `WHY THIS MATTERS
Not confirming appointments is the single most common source of preventable revenue loss in service businesses. A quick call or text the afternoon before drops no-shows by 25-35%.

THE CONFIRMATION WINDOW
Call or text the afternoon before — ideally between 2pm and 5pm. Not the morning of.
Monday jobs: Confirm Friday afternoon
Tuesday jobs: Confirm Monday afternoon
Wednesday jobs: Confirm Tuesday afternoon
Thursday jobs: Confirm Wednesday afternoon
Friday jobs: Confirm Thursday afternoon

Person responsible for daily confirmations: [Name/Role]

CONFIRMATION CALL SCRIPT
"Hi, this is [Your Name] calling from [Business Name]. Just reaching out to confirm your appointment tomorrow, [Day], between [Time Window]. We'll have a tech at your place right in that window. Does that still work for you?"

If yes: "Perfect — we'll see you then. If anything comes up, please give us a call at [phone] as soon as you can so we can fill that slot."
If reschedule needed: "No problem at all — let's find something that works better. I have [next available time] — would that work?"

TEXT MESSAGE VERSION
"Hi [Name], this is [Business Name] confirming your appointment tomorrow [Day] between [Time]. Reply YES to confirm or call us at [phone] to reschedule. Thanks!"

NO ANSWER PROTOCOL
- Leave a brief voicemail
- Send a text message immediately after
- If no response by end of business, call once more in the morning
- If still no response by 8am day-of, treat the slot as tentatively open
- Attempt one final call 30 minutes before the scheduled window

FILLING CANCELLED SLOTS
Keep a short list of customers who said 'call me if you have a cancellation.' Offer a small incentive for accepting a last-minute slot.

TRACKING
Track weekly: Confirmations Sent | Confirmed | Cancelled | No-Shows | Slots Filled`,

  "CBS_Customer_Followup_Sequence": `WHY THIS MATTERS
It costs 5-7 times more to acquire a new customer than to retain an existing one. A structured follow-up process that takes 10 minutes per job per week can add 20-30% to your repeat business over 12 months.

THE FOLLOW-UP SEQUENCE

Touch 1 — Same Day (Post-Job Text)
Send within 2 hours of job completion.
Script: "Hi [Name], thanks for having us out today. Let us know if you have any questions about the work — [Your Name] at [Business Name], [phone]."

Touch 2 — Day 3 (Review Request)
Script: "Hi [Name], hope everything is working great after our visit. If you had a good experience, we'd really appreciate a quick Google review — it helps a small business like ours more than you know. [Google review link]. Thanks — [Your Name]."

Touch 3 — Day 30 (Check-In)
Script: "Hi [Name], this is [Your Name] from [Business Name]. Just checking in about the work we did last month — everything still working well? Let us know if you need anything."

Touch 4 — Annual Reminder (Seasonal / Maintenance)
Script: "Hi [Name], just a heads up from [Business Name] — [season] is coming up and now's a good time to [relevant service]. We're booking [timeframe] — reply here or call [phone] if you'd like to schedule."

REFERRAL ASK
Script: "We're always looking for good customers like you, [Name]. If you know anyone who could use [your service], we'd love the introduction. We take great care of referrals."
Your referral incentive (if any): [incentive]

WHO TO PRIORITIZE
First-time customer: All 4 touches
Repeat customer: Touch 1, Touch 2 (if not recent), Touch 4
Large jobs (over $[amount]): All 4 touches
Problem/complaint resolved: Touch 1, Touch 2 at Day 7, Touch 3

Person responsible for follow-up: [Name/Role]`,

  "CBS_Employee_Handbook": `WELCOME TO [BUSINESS NAME]
This handbook covers how we operate, what we expect from every person on this team, and what you can expect from us.

OUR STANDARDS

Professionalism
- Show up in clean uniform every day.
- Treat every customer's home or property like it's your own — or better.
- No smoking on customer property.
- No personal calls or phone use in front of customers unless job-related.
- If a customer asks a question you don't know the answer to, say so and get them an answer.

Work Quality
- Do the job right the first time. Callbacks cost us money and damage our reputation.
- If something is beyond the original scope of work, stop and call the office before proceeding.
- Clean up your work area before leaving every job. Every time.
- Document your work with photos when required.

Communication
- If you're running late to a job, call the office immediately.
- If a job is taking longer than expected, update dispatch before the original finish time.
- Customer complaints go to the owner or manager the same day.

ATTENDANCE & TARDINESS
- Be at the shop (or your first job) at your scheduled start time — not walking in at start time.
- "On time" means ready to work: truck checked, tools loaded.
- If you know you're going to be late, call before your shift starts.
- Two or more no-call/no-show incidents in any 90-day period is grounds for termination.

Call-in number: [phone]
Call-in deadline time: [time]

VEHICLES & EQUIPMENT
- Company vehicles are for business use. Personal use requires explicit owner approval.
- You are responsible for the condition of the truck assigned to you.
- Any damage, incident, or mechanical issue must be reported same day.
- Trucks are restocked before the end of each shift. This is not optional.

PAY & HOURS
Pay period: [weekly/bi-weekly]
Pay day: [day]
Overtime policy: [policy]

CUSTOMER INTERACTIONS
- Never discuss pricing with a customer unless you've been authorized to quote.
- Never accept cash or personal payments directly from customers without going through the office.
- If a customer is unhappy, be polite, listen, and escalate to the owner or manager immediately.`,

  "CBS_Job_Completion_Invoicing_Process": `WHY THIS MATTERS
Every job that doesn't close cleanly is money at risk. Businesses that invoice same-day get paid an average of 40% faster than those that batch invoice weekly.

BEFORE LEAVING THE JOB SITE
Tech Closeout Checklist:
- Walk the job site — confirm all work is complete and matches the scope
- Take photos of completed work (required for any job over $[dollar amount])
- Clean up work area completely
- Note any additional work discovered but not completed
- Note any extras performed that were not on the original work order

Customer Sign-Off:
- Walk the customer through the completed work before leaving
- Get a signature on the work order confirming satisfactory completion
- If the customer is not available, take photos and note it on the work order

INVOICING — SAME DAY RULE
Invoice the same day the job is completed. Not tomorrow. Not Friday. The same day.

What Goes on Every Invoice:
- Customer name, address, and contact information
- Date of service
- Description of work performed — specific, not vague
- Parts and materials used, with markup applied
- Labor hours and rate, or flat rate as applicable
- Any additional work performed beyond original scope
- Total due and payment terms
- Payment methods accepted

Your standard payment terms: [terms]
Invoicing software / method used: [software]

EXTRAS & SCOPE CHANGES
Change Order Rule: Any additional work over $[dollar amount] requires a verbal or written change order approved by the customer before proceeding.
Change order threshold amount: $[amount]

FOLLOWING UP ON UNPAID INVOICES
1-7 days past due: Friendly reminder email or text — Office/admin
8-14 days past due: Phone call to customer — Owner or office
15-21 days past due: Second call + written notice — Owner
22-30 days past due: Final notice — payment or payment plan required — Owner
30+ days past due: Refer to collections or small claims — Owner decision`,

  "CBS_New_Hire_Training_Documentation": `PURPOSE
This document is the roadmap for bringing a new technician up to speed. It sets clear expectations and gives the trainer a consistent checklist to follow.

BEFORE DAY 1
Owner / Manager Checklist:
- Truck assigned and stocked
- Uniform / company gear ready
- Login credentials created (invoicing software, dispatch app, etc.)
- Employee handbook reviewed and signed
- Emergency contact information collected
- Direct deposit or pay setup completed
- Insurance / workers comp enrollment initiated
- Mentor or lead tech assigned for first two weeks

WEEK 1 — FOUNDATION
Goals: Safety, company standards, job site basics
Day 1: Facility and shop walkthrough
Day 1: Company standards and handbook review
Day 1: Truck inspection and restocking process
Day 1: Tools identification and care standards
Day 2: Safety procedures and PPE requirements
Day 2: Customer interaction standards
Day 2: Documentation: work orders and invoicing intro
Days 3-5: Ride-along with lead tech (observe only)
Days 3-5: Invoicing software walkthrough
Days 3-5: End-of-day truck restock protocol

WEEK 2 — SUPERVISED WORK
Areas to cover: Customer greeting, standard job setup, work documentation, job closeout, invoice completion (same day), parts request/restock log, route planning.
Competency scale: 1 = Needs guidance, 2 = Can do with prompting, 3 = Independent. Target 2+ on all core tasks by end of Week 2.

WEEKS 3-4 — INDEPENDENT WORK
Goals: Running jobs independently, handling common issues without escalation.
Milestones: Completes standard jobs independently, invoices same-day without reminder, truck restocked each day without prompting, handles customer questions appropriately.

30-DAY REVIEW
At the 30-day mark, the owner or manager meets with the new hire for a frank, two-way conversation.
30-day review date: [date]
Overall performance assessment: [assessment]
Areas needing continued development: [areas]
Goals for days 31-60: [goals]`,

  "CBS_Parts_Supply_Ordering_Process": `WHY THIS MATTERS
Shops with a defined ordering process typically spend 10-20% less on parts annually than those who order ad hoc. On $40,000/year in parts spend, that's $4,000-$8,000 left in your pocket.

WHO CAN ORDER WHAT
Standard stock reorder (under $[amount]): Any tech — No approval needed
Non-stock / special order (under $[amount]): Lead tech or manager — Owner or manager approval
Any order over $[amount]: Owner only
Emergency same-day order: Owner only — document reason

Owner name for approvals: [name]
Manager name (if applicable): [name]

PREFERRED SUPPLIERS
List your preferred suppliers with account numbers, rep names, phone numbers, and what they're best for.

Always use trade accounts when available. Cash or personal card purchases miss out on account pricing and create reconciliation headaches.

THE ORDER PROCESS
- Identify the need — restock trigger hit or job-specific part required
- Check the truck inventory first — is it actually out of stock, or just misplaced?
- Check if another truck has the part before placing an external order
- If ordering: confirm supplier, part number, and quantity before placing
- Get a confirmation number — note it on the parts log
- Mark the expected delivery date
- When parts arrive: verify against the order, update the truck stock log

PARTS LOG
Track: Date | Part/Item | Supplier | Order # | Cost | Truck | Job # | Received?

BULK BUYING & COMMON STOCK
For items used on nearly every job, bulk buying at the start of each month typically saves 10-25% over piece-by-piece purchasing.

Person responsible for parts tracking and returns: [name/role]`,

  "CBS_Safety_Job_Site_Procedures": `WHY THIS MATTERS
A single preventable incident can cost more in workers' comp, liability, downtime, and reputation damage than years of safety investment.

PRE-JOB SAFETY CHECKLIST
Complete before starting any job. Takes two minutes. Non-negotiable.
- Appropriate PPE for this job on hand
- Work area assessed for hazards
- Customer informed of any access restrictions
- Equipment in safe working condition
- First aid kit in truck
- Emergency contacts accessible
- [Trade-specific check 1]
- [Trade-specific check 2]

PPE REQUIREMENTS
General labor: Safety glasses, work boots
Power tools: Safety glasses, ear protection
Chemical handling: Gloves, eye protection
Elevated work: Hard hat, fall protection
[Trade-specific task]: [Required PPE]

CUSTOMER PROPERTY PROTECTION
- Lay down drop cloths or floor protection before starting any indoor work
- Photo-document the area before starting if there is any existing damage
- Clean the work area completely before leaving — including debris, dust, and packaging
- Walk the customer through the finished area before departure

INCIDENT REPORTING
If an Injury or Incident Occurs:
- Ensure the safety of everyone involved first. Stop work if necessary.
- Provide first aid as appropriate. Call 911 if the injury is serious.
- Call the owner immediately.
- Document everything: time, location, what happened, who was present.
- Complete the incident report form before end of business that day.

EMERGENCY CONTACTS
Owner (primary): [name] | [phone]
Owner (after-hours): [phone]
Manager: [name] | [phone]
Workers comp carrier: [carrier] | [phone]
Business insurance: [carrier] | [phone]
Nearest urgent care: [location] | [phone]`,

  "CBS_Truck_Restocking_Checklist": `WHY THIS MATTERS
A tech making $28/hr driving 45 minutes for a part costs roughly $21 in wages plus mileage. Do that 4 times a week across 2 trucks and you're looking at $8,000+ per year.

MORNING PRE-DEPARTURE CHECKLIST
Complete before leaving the shop each morning. Tech initials when done.
Items to check with minimum stock levels:
- Common fittings & connectors: [Set level]
- Fasteners & hardware: [Set level]
- Electrical supplies / wire: [Set level]
- Sealants, tape, adhesives: [Set level]
- PPE (gloves, safety glasses): [Set level]
- Invoice book / work orders: 5 blanks
- Business cards: 10
- Phone charger: 1
- First aid kit: Stocked
- [Trade-specific item 1]: [Set level]
- [Trade-specific item 2]: [Set level]
- [Trade-specific item 3]: [Set level]

END-OF-DAY RESTOCK PROTOCOL
Takes 10 minutes. Saves 45 minutes of running around tomorrow.
- Park the truck and do a quick visual walk of the cargo area
- Compare what you left with against what's there now
- Flag anything at or below minimum stock level
- Write the restock list on the clipboard in the truck before coming inside
- Hand the restock list to the parts/supply person (or complete yourself before next morning)
- Confirm tomorrow's truck is loaded and locked before clocking out

Person responsible for restocking: [name/role]
Restock completion deadline: [time]

ACCOUNTABILITY
Emergency Order Rule: Any part over $[dollar amount] requires owner or manager approval before ordering.
Track parts-run frequency for 30 days after implementing this checklist.

Reviewed and implemented by: [owner name]
Date implemented: [date]`
};

// ─── MAIN HANDLER ────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { email, name, biz, trade, answers, multiAnswers, docKeys } = req.body;
    if (!email || !docKeys || !docKeys.length) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const intakeData = extractIntakeData(answers, multiAnswers);
    const tradeName = trade || intakeData["trade"] || intakeData["Trade"] || "Service Business";
    const results = [];

    // Process each requested doc
    for (const docKey of docKeys) {
      const config = DOC_REGISTRY[docKey];
      if (!config) {
        console.warn("Unknown doc key:", docKey);
        continue;
      }

      try {
        let buffer;
        const templateText = config.template || TEMPLATE_CONTENT[docKey] || "";

        if (config.type === "guide") {
          buffer = await buildGuide(
            docKey,
            config.title,
            config.series,
            config.subtitle,
            templateText,
            intakeData,
            biz,
            name,
            tradeName
          );
        } else {
          buffer = await buildProcessTemplate(
            docKey,
            config.title,
            templateText,
            intakeData,
            biz,
            name,
            tradeName
          );
        }

        const base64 = buffer.toString("base64");
        const filename = docKey + "_" + (biz || "YourBusiness").replace(/\s+/g, "-") + ".docx";
        await saveDocToKV(email, docKey, base64, filename);
        results.push({ docKey, success: true, filename });
        console.log("Generated doc:", docKey, "for", email);

      } catch(e) {
        console.error("Doc generation failed for", docKey, ":", e.message);
        results.push({ docKey, success: false, error: e.message });
      }
    }

    return res.status(200).json({ success: true, generated: results.filter(r => r.success).length, results });

  } catch(err) {
    console.error("generate-docs error:", err.message);
    return res.status(500).json({ error: "Failed", detail: err.message });
  }
};
