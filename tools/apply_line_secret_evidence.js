#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const args = parseArgs(process.argv.slice(2));
const evidenceFile = path.resolve(args.file || args.evidenceFile || args["evidence-file"] || "docs/MANUAL_UAT_EVIDENCE.md");
const secretReportFile = path.resolve(args.report || args.secretReport || args["secret-report"] || "docs/LINE_SECRET_ROTATION_EVIDENCE.json");
const dryRun = Boolean(args.dryRun || args["dry-run"]);

const SECURITY_CASE = "LINE channel secret rotated after exposure";

main();

function main() {
  const evidenceText = fs.readFileSync(evidenceFile, "utf8");
  const report = readJson(secretReportFile);
  const readiness = validateSecretReport(report);
  let output = evidenceText;
  const applied = [];

  if (readiness.ok) {
    const note = buildEvidenceNote(report);
    output = replaceSecurityRow(output, "pass", note);
    if (output === evidenceText) {
      readiness.ok = false;
      readiness.failures.push("Security Preflight row was not found in the evidence file.");
    } else {
      applied.push({ case: SECURITY_CASE, note });
    }
  }

  if (!dryRun && readiness.ok) fs.writeFileSync(evidenceFile, output, "utf8");

  const result = {
    ok: readiness.ok,
    dryRun,
    evidenceFile,
    secretReportFile,
    generatedAt: new Date().toISOString(),
    applied,
    failures: readiness.failures,
    latestEnabledVersion: report.latestEnabledVersion || null,
    secretValuePrinted: report.secretValuePrinted ?? null,
    signedWebhookContractOk: Boolean(report.signedWebhookContract?.ok)
  };
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exit(1);
}

function validateSecretReport(report) {
  const failures = [];
  if (!report || typeof report !== "object") failures.push("Secret report JSON is missing or invalid.");
  if (report?.ok !== true) failures.push("Secret report ok must be true.");
  if (report?.secretValuePrinted !== false) failures.push("secretValuePrinted must be false.");
  if (!report?.latestEnabledVersion?.versionId) failures.push("latestEnabledVersion.versionId is required.");
  if (String(report?.latestEnabledVersion?.state || "").toUpperCase() !== "ENABLED") failures.push("latest enabled secret version must be ENABLED.");
  if (report?.signedWebhookContract?.ok !== true) failures.push("signed webhook contract must pass.");
  if (report?.signedWebhookContract?.mode !== "line-webhook-contract-dry-run") failures.push("signed webhook contract mode must be line-webhook-contract-dry-run.");
  return { ok: failures.length === 0, failures };
}

function buildEvidenceNote(report) {
  const version = report.latestEnabledVersion || {};
  return [
    report.evidenceText || "pass: line secret rotation evidence validated",
    `secret=${report.secretName || "LINE_CHANNEL_SECRET"}`,
    `version=${version.versionId}`,
    `created=${version.createTime || "-"}`,
    "secretValuePrinted=false",
    `contractMode=${report.signedWebhookContract?.mode || "-"}`
  ].join("; ");
}

function replaceSecurityRow(text, result, note) {
  const sectionHeading = "## Security Preflight";
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
    if (!cells || normalize(cells[0]) !== normalize(SECURITY_CASE)) return line;
    changed = true;
    cells[cells.length - 2] = result;
    cells[cells.length - 1] = note;
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
