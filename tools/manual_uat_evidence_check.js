#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const args = parseArgs(process.argv.slice(2));
const evidenceFile = path.resolve(args.file || "docs/MANUAL_UAT_EVIDENCE_TEMPLATE.md");

if (args.help || args.h) {
  printHelp();
  process.exit(0);
}

main();

function main() {
  const text = fs.readFileSync(evidenceFile, "utf8");
  const report = buildReport(text);
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exit(1);
}

function buildReport(text) {
  const session = checkSessionFields(text);
  const preRun = checkPreRunCommands(text);
  const lineMedia = checkLineMediaEvidence(text);
  const liffAuth = checkLiffEvidence(text);
  const rollbackValues = checkRollbackValues(text);
  const decisions = checkCutoverDecision(text);
  const failures = [
    ...session.filter((item) => !item.ok).map((item) => item.message),
    ...preRun.filter((item) => !item.ok).map((item) => item.message),
    ...lineMedia.filter((item) => !item.ok).map((item) => item.message),
    ...liffAuth.filter((item) => !item.ok).map((item) => item.message),
    ...rollbackValues.filter((item) => !item.ok).map((item) => item.message),
    ...decisions.filter((item) => !item.ok).map((item) => item.message)
  ];

  return {
    ok: failures.length === 0,
    generatedAt: new Date().toISOString(),
    evidenceFile,
    session,
    preRun,
    lineMedia,
    liffAuth,
    rollbackValues,
    decisions,
    failures
  };
}

function checkSessionFields(text) {
  const required = [
    "Date/time (Asia/Bangkok)",
    "Tester",
    "Staging LINE OA/channel",
    "Test LINE user ID"
  ];
  const table = extractTableRows(text, "## Test Session");
  return required.map((field) => {
    const row = table.find((item) => normalize(item[0]) === normalize(field));
    const value = row?.[1]?.trim() || "";
    return {
      field,
      ok: Boolean(value),
      value,
      message: `${field} is blank in Test Session.`
    };
  });
}

function checkCutoverDecision(text) {
  const required = [
    "Automated pre-cutover report",
    "Real LINE media UAT",
    "Real LIFF auth UAT",
    "Rollback plan reviewed",
    "Final data migration window approved"
  ];
  const table = extractTableRows(text, "## Cutover Decision");
  return required.map((gate) => {
    const row = table.find((item) => normalize(item[0]) === normalize(gate));
    const actual = row?.[2]?.trim() || "";
    const signoff = row?.[3]?.trim() || "";
    const actualPass = /^pass\b/i.test(stripMarkdown(actual));
    const signed = Boolean(stripMarkdown(signoff));
    return {
      gate,
      ok: Boolean(row) && actualPass && signed,
      actual,
      ownerSignoff: signoff,
      message: row
        ? `${gate} must have Actual result pass and Owner sign-off.`
        : `${gate} row is missing from Cutover Decision.`
    };
  });
}

function checkPreRunCommands(text) {
  const required = [
    "Pre-cutover report",
    "Pre-migration audit",
    "LINE text dry-run",
    "Signed LINE webhook contract",
    "Dashboard contract",
    "Migration dry-run"
  ];
  const table = extractTableRows(text, "## Pre-Run Commands");
  return required.map((check) => {
    const row = table.find((item) => normalize(item[0]) === normalize(check));
    const actual = row?.[2]?.trim() || "";
    const actualPass = /pass|ok=true|13\/13|mode=line-webhook-contract-dry-run|okToPreviewImport=true/i.test(stripMarkdown(actual));
    return {
      check,
      ok: Boolean(row) && actualPass,
      actual,
      message: row
        ? `${check} Actual must include a passing result.`
        : `${check} row is missing from Pre-Run Commands.`
    };
  });
}

function checkLineMediaEvidence(text) {
  const required = [
    "Food image",
    "Leftover image",
    "Payment slip image",
    "Admin approve",
    "Admin reject",
    "BIA image/PDF",
    "BIA confirm"
  ];
  const table = extractTableRows(text, "## Real LINE Media UAT");
  return required.map((testCase) => checkEvidenceCase(table, testCase, "Real LINE Media UAT"));
}

function checkLiffEvidence(text) {
  const required = [
    "LIFF settings opens",
    "LINE ID token sent",
    "Invalid token rejected"
  ];
  const table = extractTableRows(text, "## Real LIFF Auth UAT");
  return required.map((testCase) => checkEvidenceCase(table, testCase, "Real LIFF Auth UAT"));
}

function checkRollbackValues(text) {
  const required = [
    {
      item: "Current GAS webhook URL",
      validate: isHttpsUrl,
      hint: "must be the current GAS webhook URL from LINE Developers Console"
    },
    {
      item: "Firebase webhook URL",
      validate: (value) => isHttpsUrl(value) && value.includes("lineWebhook"),
      hint: "must be the Firebase lineWebhook URL"
    },
    {
      item: "LINE channel",
      validate: hasValue,
      hint: "must identify the staging/production LINE channel"
    },
    {
      item: "Operator",
      validate: hasValue,
      hint: "must name the operator responsible for rollback"
    },
    {
      item: "Latest commit SHA",
      validate: (value) => /^[a-f0-9]{7,40}$/i.test(stripMarkdown(value)),
      hint: "must be a Git commit SHA"
    },
    {
      item: "Latest Google Sheet source fingerprint",
      validate: (value) => /^[a-f0-9]{64}$/i.test(stripMarkdown(value)),
      hint: "must be the 64-character migration dry-run source fingerprint"
    }
  ];
  const table = extractTableRows(text, "## Rollback/Cutover Values");
  return required.map((field) => {
    const row = table.find((item) => normalize(item[0]) === normalize(field.item));
    const value = row?.[1]?.trim() || "";
    return {
      item: field.item,
      ok: Boolean(row) && field.validate(value),
      value,
      message: row
        ? `${field.item} is invalid; ${field.hint}.`
        : `${field.item} row is missing from Rollback/Cutover Values.`
    };
  });
}

function checkEvidenceCase(table, testCase, section) {
  const row = table.find((item) => normalize(item[0]) === normalize(testCase));
  const result = row?.[row.length - 2]?.trim() || "";
  const notes = row?.[row.length - 1]?.trim() || "";
  const resultPass = /^pass\b/i.test(stripMarkdown(result));
  const hasNotes = Boolean(stripMarkdown(notes));
  return {
    section,
    case: testCase,
    ok: Boolean(row) && resultPass && hasNotes,
    result,
    notes,
    message: row
      ? `${section} / ${testCase} must have Result pass and evidence notes.`
      : `${section} / ${testCase} row is missing.`
  };
}

function extractTableRows(text, heading) {
  const start = text.indexOf(heading);
  if (start < 0) return [];
  const rest = text.slice(start + heading.length);
  const nextHeading = rest.search(/\n##\s+/);
  const section = nextHeading >= 0 ? rest.slice(0, nextHeading) : rest;
  return section
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("|") && line.endsWith("|"))
    .filter((line) => !/^\|\s*-+/.test(line) && !line.includes("---"))
    .map((line) => line.slice(1, -1).split("|").map((cell) => cell.trim()))
    .filter((cells) => cells.length >= 2 && !/^field$/i.test(cells[0]) && !/^gate$/i.test(cells[0]));
}

function normalize(value) {
  return stripMarkdown(value).toLowerCase().replace(/\s+/g, " ").trim();
}

function stripMarkdown(value) {
  return String(value || "").replace(/`/g, "").trim();
}

function hasValue(value) {
  return Boolean(stripMarkdown(value));
}

function isHttpsUrl(value) {
  try {
    return new URL(stripMarkdown(value)).protocol === "https:";
  } catch {
    return false;
  }
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
    } else {
      out[key] = value;
      index += 1;
    }
  }
  return out;
}

function printHelp() {
  console.log([
    "Manual UAT evidence check",
    "",
    "Usage:",
    "  npm run uat:evidence-check -- --file docs/MANUAL_UAT_EVIDENCE.md",
    "",
    "The evidence file must have Test Session fields filled and required Cutover Decision rows set to pass with owner sign-off."
  ].join("\n"));
}
