/**
 * /api/generate-checklist
 * Generates a formatted .docx action plan checklist from the AI plan report
 * Returns base64-encoded docx for email attachment
 */

const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, HeadingLevel, BorderStyle, WidthType, ShadingType,
  LevelFormat, PageNumber, Header, Footer
} = require("docx");

// Navy: 1B2E4B, Amber: C8701A, Red: B84C2E, Slate: 3D6B9E
// Lighter tints for shading: E8EFF7 (navy light), FDF3E7 (amber light), FAE8E4 (red light)

function getTag(text, tag) {
  const m = text.match(new RegExp("\\[" + tag + "\\]([\\s\\S]*?)(?=\\[|$)"));
  return m ? m[1].trim() : "";
}

// Parse day lines and sprint headers from a phase plan
function parsePlan(planText) {
  if (!planText) return [];
  const lines = planText.replace(/\*\*/g, "").replace(/^---$/gm, "").split("\n").filter(l => l.trim());
  const items = [];
  lines.forEach(line => {
    if (line.match(/^===.*===$/)) {
      items.push({ type: "sprint", label: line.replace(/===/g, "").trim() });
    } else {
      const dayMatch = line.match(/^(Day \d+):\s*(.+)$/i);
      if (dayMatch) {
        items.push({ type: "day", day: dayMatch[1], task: dayMatch[2] });
      }
    }
  });
  return items;
}

function makeChecklist(biz, name, planType, leakTotal, leakRanking, phases) {
  const isBundle = planType === "599" || planType === "bundle";
  const title = isBundle ? "Complete 30/60/90-Day Action Plan" : "30-Day Quick Win Plan";
  const totalClean = leakTotal.replace(/Estimated total annual profit leak:\s*/i, "").trim();

  // Shared styles
  const navyHex = "1B2E4B";
  const amberHex = "C8701A";
  const redHex = "B84C2E";
  const slateHex = "3D6B9E";
  const warmBg = "F7F5F2";
  const white = "FFFFFF";

  const border = { style: BorderStyle.SINGLE, size: 1, color: "D8D4CD" };
  const borders = { top: border, bottom: border, left: border, right: border };
  const noBorder = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
  const noBorders = { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder };

  // Build children array
  const children = [];

  // ── COVER SECTION ──
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 480, after: 120 },
    children: [new TextRun({ text: "COMPASS BUSINESS SOLUTIONS", font: "Arial", size: 18, bold: true, color: navyHex, characterSpacing: 100 })]
  }));

  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 0, after: 80 },
    children: [new TextRun({ text: title.toUpperCase(), font: "Arial", size: 40, bold: true, color: amberHex })]
  }));

  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 0, after: 80 },
    children: [new TextRun({ text: biz || "Your Business", font: "Arial", size: 24, color: navyHex })]
  }));

  if (name) {
    children.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 0, after: 80 },
      children: [new TextRun({ text: "Prepared for: " + name, font: "Arial", size: 20, color: "555555" })]
    }));
  }

  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 0, after: 480 },
    children: [new TextRun({ text: "Generated: " + new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }), font: "Arial", size: 18, color: "888888" })]
  }));

  // ── ESTIMATED LEAK TOTAL ──
  if (totalClean) {
    children.push(new Table({
      width: { size: 9360, type: WidthType.DXA },
      columnWidths: [9360],
      rows: [new TableRow({
        children: [new TableCell({
          borders: noBorders,
          shading: { fill: redHex, type: ShadingType.CLEAR },
          margins: { top: 200, bottom: 200, left: 240, right: 240 },
          width: { size: 9360, type: WidthType.DXA },
          children: [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [new TextRun({ text: "ESTIMATED ANNUAL PROFIT LEAK", font: "Arial", size: 16, bold: true, color: "FFFFFF", characterSpacing: 80 })]
            }),
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [new TextRun({ text: totalClean, font: "Arial", size: 52, bold: true, color: "FFFFFF" })]
            }),
            new Paragraph({
              alignment: AlignmentType.CENTER,
              spacing: { before: 60 },
              children: [new TextRun({ text: "Approximate amount not currently being captured. Consistent process improvements will positively impact profitability.", font: "Arial", size: 14, color: "FFDDCC", italics: true })]
            }),
          ]
        })]
      })]
    }));
    children.push(new Paragraph({ spacing: { before: 240, after: 0 }, children: [new TextRun("")] }));
  }

  // ── LEAK RANKING ──
  if (leakRanking) {
    children.push(new Paragraph({
      spacing: { before: 240, after: 120 },
      children: [new TextRun({ text: "YOUR LEAKS RANKED BY DOLLAR IMPACT", font: "Arial", size: 22, bold: true, color: slateHex, characterSpacing: 60 })]
    }));
    children.push(new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: slateHex } }, spacing: { before: 0, after: 160 }, children: [new TextRun("")] }));

    const rankLines = leakRanking.replace(/\*\*/g, "").split("\n").filter(l => l.trim());
    rankLines.forEach(line => {
      const match = line.match(/^(\d+)\.\s+([^—–]+)[—–]\s*(\$[\d,]+[^|]+?)(?:\|\s*(.+))?$/);
      if (match) {
        children.push(new Table({
          width: { size: 9360, type: WidthType.DXA },
          columnWidths: [600, 8760],
          rows: [new TableRow({
            children: [
              new TableCell({
                borders: noBorders,
                shading: { fill: navyHex, type: ShadingType.CLEAR },
                margins: { top: 60, bottom: 60, left: 120, right: 120 },
                width: { size: 600, type: WidthType.DXA },
                verticalAlign: "center",
                children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: match[1], font: "Arial", size: 20, bold: true, color: white })] })]
              }),
              new TableCell({
                borders: noBorders,
                shading: { fill: warmBg, type: ShadingType.CLEAR },
                margins: { top: 60, bottom: 60, left: 160, right: 120 },
                width: { size: 8760, type: WidthType.DXA },
                children: [
                  new Paragraph({ children: [
                    new TextRun({ text: match[2].trim() + " ", font: "Arial", size: 20, bold: true, color: navyHex }),
                    new TextRun({ text: match[3].trim(), font: "Arial", size: 20, bold: true, color: redHex }),
                  ]}),
                  match[4] ? new Paragraph({ children: [new TextRun({ text: match[4].trim(), font: "Arial", size: 18, color: "555555", italics: true })] }) : new Paragraph({ children: [new TextRun("")] }),
                ]
              }),
            ]
          })]
        }));
        children.push(new Paragraph({ spacing: { before: 80, after: 0 }, children: [new TextRun("")] }));
      }
    });
  }

  // ── PHASES ──
  const phaseColors = ["B84C2E", "C8701A", "3D6B9E"];
  const phaseLightBg = ["FAE8E4", "FDF3E7", "E8EFF7"];

  phases.forEach((phase, idx) => {
    if (!phase.plan && !phase.intro) return;

    const color = phaseColors[idx] || amberHex;
    const lightBg = phaseLightBg[idx] || "F5F5F5";
    const items = parsePlan(phase.plan);

    children.push(new Paragraph({ pageBreakBefore: idx > 0, spacing: { before: idx === 0 ? 480 : 0, after: 0 }, children: [new TextRun("")] }));

    // Phase header
    children.push(new Table({
      width: { size: 9360, type: WidthType.DXA },
      columnWidths: [9360],
      rows: [new TableRow({
        children: [new TableCell({
          borders: noBorders,
          shading: { fill: color, type: ShadingType.CLEAR },
          margins: { top: 140, bottom: 140, left: 240, right: 240 },
          width: { size: 9360, type: WidthType.DXA },
          children: [
            new Paragraph({ children: [new TextRun({ text: "PHASE " + (idx + 1), font: "Arial", size: 16, bold: true, color: "FFFFFF", characterSpacing: 100 })] }),
            new Paragraph({ children: [new TextRun({ text: phase.label, font: "Arial", size: 28, bold: true, color: "FFFFFF" })] }),
          ]
        })]
      })]
    }));

    // Phase intro
    if (phase.intro) {
      children.push(new Paragraph({
        spacing: { before: 160, after: 160 },
        children: [new TextRun({ text: phase.intro, font: "Arial", size: 20, color: "333333", italics: true })]
      }));
    }

    // Day-by-day checklist
    items.forEach(item => {
      if (item.type === "sprint") {
        // Sprint header
        children.push(new Paragraph({
          spacing: { before: 240, after: 80 },
          border: { left: { style: BorderStyle.SINGLE, size: 12, color: color, space: 8 } },
          indent: { left: 280 },
          children: [new TextRun({ text: item.label, font: "Arial", size: 20, bold: true, color: color, characterSpacing: 60 })]
        }));
      } else {
        // Day row as a table for the checkbox layout
        children.push(new Table({
          width: { size: 9360, type: WidthType.DXA },
          columnWidths: [560, 600, 8200],
          rows: [new TableRow({
            children: [
              // Checkbox column
              new TableCell({
                borders: noBorders,
                margins: { top: 60, bottom: 40, left: 0, right: 80 },
                width: { size: 560, type: WidthType.DXA },
                verticalAlign: "center",
                children: [new Paragraph({
                  alignment: AlignmentType.CENTER,
                  children: [new TextRun({ text: "\u2610", font: "Arial Unicode MS", size: 24, color: color })]
                })]
              }),
              // Day pill column
              new TableCell({
                borders: noBorders,
                shading: { fill: color, type: ShadingType.CLEAR },
                margins: { top: 60, bottom: 40, left: 80, right: 80 },
                width: { size: 600, type: WidthType.DXA },
                verticalAlign: "center",
                children: [new Paragraph({
                  alignment: AlignmentType.CENTER,
                  children: [new TextRun({ text: item.day.replace("Day ", "D"), font: "Arial", size: 14, bold: true, color: white })]
                })]
              }),
              // Task column
              new TableCell({
                borders: { top: noBorder, bottom: { style: BorderStyle.SINGLE, size: 1, color: "E8E4DC" }, left: noBorder, right: noBorder },
                margins: { top: 60, bottom: 40, left: 160, right: 0 },
                width: { size: 8200, type: WidthType.DXA },
                children: [new Paragraph({
                  children: [new TextRun({ text: item.task, font: "Arial", size: 20, color: "222222" })]
                })]
              }),
            ]
          })]
        }));
        children.push(new Paragraph({ spacing: { before: 40, after: 0 }, children: [new TextRun("")] }));
      }
    });

    // Docs for this phase
    if (phase.docs) {
      const docLines = phase.docs.replace(/\*\*/g, "").split("\n").filter(l => l.trim());
      if (docLines.length) {
        children.push(new Paragraph({ spacing: { before: 240, after: 80 }, children: [new TextRun({ text: "YOUR DOCUMENTS FOR THIS PHASE", font: "Arial", size: 18, bold: true, color: color, characterSpacing: 60 })] }));
        docLines.forEach(line => {
          const clean = line.replace(/^[-•→\d+\.]\s*/, "");
          children.push(new Paragraph({
            spacing: { before: 60, after: 0 },
            children: [
              new TextRun({ text: "\u2192 ", font: "Arial", size: 20, bold: true, color: color }),
              new TextRun({ text: clean, font: "Arial", size: 20, color: "333333" }),
            ]
          }));
        });
      }
    }

    // Sign-off line at end of phase
    children.push(new Paragraph({ spacing: { before: 360, after: 80 }, children: [new TextRun({ text: "Phase " + (idx + 1) + " Complete:", font: "Arial", size: 20, bold: true, color: "888888" })] }));
    children.push(new Table({
      width: { size: 9360, type: WidthType.DXA },
      columnWidths: [4480, 400, 4480],
      rows: [new TableRow({
        children: [
          new TableCell({ borders: { top: noBorder, bottom: border, left: noBorder, right: noBorder }, margins: { bottom: 40 }, width: { size: 4480, type: WidthType.DXA }, children: [new Paragraph({ children: [new TextRun("")] })] }),
          new TableCell({ borders: noBorders, width: { size: 400, type: WidthType.DXA }, children: [new Paragraph({ children: [new TextRun("")] })] }),
          new TableCell({ borders: { top: noBorder, bottom: border, left: noBorder, right: noBorder }, margins: { bottom: 40 }, width: { size: 4480, type: WidthType.DXA }, children: [new Paragraph({ children: [new TextRun("")] })] }),
        ]
      })]
    }));
    children.push(new Paragraph({
      children: [
        new TextRun({ text: "Signature", font: "Arial", size: 16, color: "AAAAAA", italics: true }),
        new TextRun({ text: "                                                                        ", font: "Arial", size: 16 }),
        new TextRun({ text: "Date Completed", font: "Arial", size: 16, color: "AAAAAA", italics: true }),
      ]
    }));
  });

  // ── FOOTER NOTE ──
  children.push(new Paragraph({ spacing: { before: 480, after: 80 }, border: { top: { style: BorderStyle.SINGLE, size: 2, color: "D8D4CD" } }, children: [new TextRun("")] }));
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: "Questions? Reply to your plan email or contact hello@compassbizsolutions.com", font: "Arial", size: 16, color: "888888", italics: true })]
  }));
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 60 },
    children: [new TextRun({ text: "compassbizsolutions.com", font: "Arial", size: 16, color: amberHex })]
  }));

  return new Document({
    styles: {
      default: { document: { run: { font: "Arial", size: 20 } } }
    },
    sections: [{
      properties: {
        page: {
          size: { width: 12240, height: 15840 },
          margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 }
        }
      },
      children
    }]
  });
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { biz, name, planType, report } = req.body;
    if (!report) return res.status(400).json({ error: "Missing report" });

    const isBundle = planType === "599" || planType === "bundle";

    const leakTotal    = getTag(report, "LEAK_TOTAL");
    const leakRanking  = getTag(report, "LEAK_RANKING");

    const phases = [
      { label: "Days 1\u201330 \u2014 Quick Wins",    intro: getTag(report, "PHASE_1_INTRO"), plan: getTag(report, "PHASE_1_PLAN"), docs: getTag(report, "PHASE_1_DOCS") },
    ];
    if (isBundle) {
      phases.push({ label: "Days 31\u201360 \u2014 Build Systems", intro: getTag(report, "PHASE_2_INTRO"), plan: getTag(report, "PHASE_2_PLAN"), docs: getTag(report, "PHASE_2_DOCS") });
      phases.push({ label: "Days 61\u201390 \u2014 Growth Moves",  intro: getTag(report, "PHASE_3_INTRO"), plan: getTag(report, "PHASE_3_PLAN"), docs: getTag(report, "PHASE_3_DOCS") });
    }

    const doc = makeChecklist(biz, name, planType, leakTotal, leakRanking, phases);
    const buffer = await Packer.toBuffer(doc);
    const base64 = buffer.toString("base64");

    return res.status(200).json({ base64, filename: (biz || "Your-Business").replace(/\s+/g, "-") + "-Action-Plan.docx" });

  } catch(err) {
    console.error("generate-checklist error:", err);
    return res.status(500).json({ error: "Failed", detail: err.message });
  }
};
