#!/usr/bin/env node

const { spawnSync } = require("node:child_process");

const args = parseArgs(process.argv.slice(2));
const file = args.file || "docs/MANUAL_UAT_EVIDENCE.md";
const phase = args.phase || "pre-migration";
const parityPlanJson = args.parityPlanJson || args["parity-plan-json"];

const command = ["tools/manual_uat_evidence_check.js", "--file", file, "--phase", phase];
if (parityPlanJson) command.push("--parity-plan-json", parityPlanJson);

const result = spawnSync(process.execPath, command, {
  cwd: process.cwd(),
  encoding: "utf8",
  maxBuffer: 20 * 1024 * 1024
});
const report = parseLastJsonObject(`${result.stdout || ""}\n${result.stderr || ""}`);
if (!report) {
  console.error("Unable to parse evidence check output.");
  process.exit(1);
}

const groups = [
  ["Session fields", report.session],
  ["Pre-run commands", report.preRun],
  ["Real LINE media UAT", report.lineMedia],
  ["Real LIFF auth UAT", report.liffAuth],
  ["Rollback values", report.rollbackValues],
  ["Dashboard parity", report.dashboardParity],
  ["Cutover decision", report.decisions]
]
  .map(([name, items]) => ({
    name,
    missing: Array.isArray(items) ? items.filter((item) => !item.ok).map((item) => item.message) : []
  }))
  .filter((group) => group.missing.length);

console.log(JSON.stringify({
  ok: report.ok,
  evidenceFile: report.evidenceFile,
  phase: report.phase,
  remainingGroups: groups,
  remainingCount: groups.reduce((sum, group) => sum + group.missing.length, 0)
}, null, 2));

if (!report.ok) process.exit(1);

function parseLastJsonObject(text) {
  const end = text.lastIndexOf("}");
  if (end < 0) return null;
  for (let start = text.lastIndexOf("{", end); start >= 0; start = text.lastIndexOf("{", start - 1)) {
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      // Keep scanning left.
    }
  }
  return null;
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
