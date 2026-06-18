#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const args = parseArgs(process.argv.slice(2));
const evidenceFile = path.resolve(args.file || args.evidenceFile || args["evidence-file"] || "docs/MANUAL_UAT_EVIDENCE.md");
const firestoreReportFile = path.resolve(args.report || args.firestoreReport || args["firestore-report"] || "docs/UAT_FIRESTORE_EVIDENCE.json");
const dryRun = Boolean(args.dryRun || args["dry-run"]);

const CASE_TO_SECTION = {
  "Food image": "Real LINE Media UAT",
  "Leftover image": "Real LINE Media UAT",
  "Payment slip image": "Real LINE Media UAT",
  "Admin approve": "Real LINE Media UAT",
  "Admin reject": "Real LINE Media UAT",
  "BIA image/PDF": "Real LINE Media UAT",
  "BIA confirm": "Real LINE Media UAT",
  "LIFF settings opens": "Real LIFF Auth UAT",
  "LINE ID token sent": "Real LIFF Auth UAT"
};

main();

function main() {
  const evidenceText = fs.readFileSync(evidenceFile, "utf8");
  const firestoreReport = readJson(firestoreReportFile);
  const hints = Array.isArray(firestoreReport.checklistHints) ? firestoreReport.checklistHints : [];
  const passingHints = hints.filter((hint) => hint.ok && CASE_TO_SECTION[hint.case]);
  const generatedAt = firestoreReport.generatedAt || new Date().toISOString();
  const userId = firestoreReport.userId || "-";

  let output = evidenceText;
  const applied = [];
  const skipped = [];

  for (const hint of passingHints) {
    const note = buildEvidenceNote(hint, firestoreReport, generatedAt, userId);
    const next = replaceCaseResult(output, CASE_TO_SECTION[hint.case], hint.case, "pass", note);
    if (next === output) {
      skipped.push({ case: hint.case, reason: "matching evidence row not found" });
      continue;
    }
    output = next;
    applied.push({ case: hint.case, section: CASE_TO_SECTION[hint.case], note });
  }

  if (!dryRun) fs.writeFileSync(evidenceFile, output, "utf8");

  const report = {
    ok: skipped.length === 0,
    dryRun,
    evidenceFile,
    firestoreReportFile,
    generatedAt: new Date().toISOString(),
    sourceReportGeneratedAt: generatedAt,
    userId,
    applied,
    skipped,
    notReady: hints
      .filter((hint) => !hint.ok && CASE_TO_SECTION[hint.case])
      .map((hint) => ({ case: hint.case, reason: hint.evidence }))
  };
  console.log(JSON.stringify(report, null, 2));
  if (skipped.length) process.exit(1);
}

function buildEvidenceNote(hint, report, generatedAt, userId) {
  const ids = String(hint.evidence || "").trim();
  const collectionNotes = summarizeCollections(report, hint.case);
  return [
    `auto-applied from ${path.basename(firestoreReportFile)}`,
    `user=${userId}`,
    `report=${generatedAt}`,
    ids && ids !== "present" ? ids : null,
    collectionNotes
  ].filter(Boolean).join("; ");
}

function summarizeCollections(report, testCase) {
  const wanted = collectionsForCase(testCase);
  const summary = Array.isArray(report.summary) ? report.summary : [];
  return wanted
    .map((collection) => {
      const item = summary.find((entry) => entry.collection === collection);
      const docs = Array.isArray(item?.latest) ? item.latest : [];
      const latest = docs.slice(0, 2).map((doc) => {
        const status = doc.fields?.status ? `:${doc.fields.status}` : "";
        const type = doc.fields?.type ? `:${doc.fields.type}` : "";
        return doc.id ? `${doc.id}${status}${type}` : null;
      }).filter(Boolean);
      return latest.length ? `${collection}[${latest.join(",")}]` : null;
    })
    .filter(Boolean)
    .join("; ");
}

function collectionsForCase(testCase) {
  switch (testCase) {
    case "Food image":
    case "Leftover image":
      return ["mealLogs", "aiRuns"];
    case "Payment slip image":
      return ["paymentReviews", "subscriptionEvents"];
    case "Admin approve":
      return ["subscriptionEvents", "subscriptions", "paymentReviews"];
    case "Admin reject":
      return ["subscriptionEvents", "paymentReviews"];
    case "BIA image/PDF":
      return ["biaReports", "profileEvents", "weightLogs"];
    case "BIA confirm":
      return ["profileEvents", "profiles"];
    case "LIFF settings opens":
      return ["profiles"];
    case "LINE ID token sent":
      return ["profileAuthEvents"];
    default:
      return [];
  }
}

function replaceCaseResult(text, sectionName, caseName, result, note) {
  const sectionHeading = sectionName === "Real LINE Media UAT" ? "## Real LINE Media UAT" : "## Real LIFF Auth UAT";
  const start = text.indexOf(sectionHeading);
  if (start < 0) return text;
  const restStart = start + sectionHeading.length;
  const rest = text.slice(restStart);
  const nextHeadingRelative = rest.search(/\n##\s+/);
  const sectionEnd = nextHeadingRelative >= 0 ? restStart + nextHeadingRelative : text.length;
  const before = text.slice(0, start);
  const section = text.slice(start, sectionEnd);
  const after = text.slice(sectionEnd);
  let changed = false;
  const updatedSection = section.split(/\r?\n/).map((line) => {
    const cells = parseTableLine(line);
    if (!cells || normalize(cells[0]) !== normalize(caseName)) return line;
    changed = true;
    const resultColumn = cells.length - 2;
    const notesColumn = cells.length - 1;
    cells[resultColumn] = result;
    cells[notesColumn] = note;
    return formatTableLine(cells);
  }).join("\n");
  return changed ? `${before}${updatedSection}${after}` : text;
}

function parseTableLine(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|") || !trimmed.endsWith("|") || trimmed.includes("---")) return null;
  return trimmed.slice(1, -1).split("|").map((cell) => cell.trim());
}

function formatTableLine(cells) {
  return `| ${cells.map((cell) => escapeCell(cell)).join(" | ")} |`;
}

function escapeCell(value) {
  return String(value ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();
}

function normalize(value) {
  return String(value || "").replace(/`/g, "").trim().toLowerCase().replace(/\s+/g, " ");
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
}

function parseArgs(argv) {
  const out = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      out[key] = true;
      out[toCamelCase(key)] = true;
    } else {
      out[key] = value;
      out[toCamelCase(key)] = value;
      index += 1;
    }
  }
  return out;
}

function toCamelCase(value) {
  return value.replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
}
