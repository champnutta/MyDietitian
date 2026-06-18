#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const args = parseArgs(process.argv.slice(2));
const file = path.resolve(args.file || "docs/MANUAL_UAT_EVIDENCE.md");

main();

function main() {
  const text = fs.readFileSync(file, "utf8");
  const table = extractTableRows(text, "## Rollback/Cutover Values");
  const values = Object.fromEntries(table.map((row) => [stripMarkdown(row[0]), stripMarkdown(row[1])]));
  const checks = [
    check("Current GAS webhook URL", values, (value) => isHttpsUrl(value), "Record the current production GAS webhook URL from LINE Developers Console."),
    check("Firebase webhook URL", values, (value) => isHttpsUrl(value) && value.includes("lineWebhook"), "Must be the Firebase lineWebhook URL."),
    check("LINE channel", values, hasValue, "Record the exact LINE OA/channel name or ID being tested."),
    check("Operator", values, hasValue, "Record the person responsible for rollback."),
    check("Latest commit SHA", values, (value) => /^[a-f0-9]{7,40}$/i.test(value), "Must be a Git commit SHA."),
    check("Latest Google Sheet source fingerprint", values, (value) => /^[a-f0-9]{64}$/i.test(value), "Must be the 64-character migration dry-run fingerprint.")
  ];
  const failures = checks.filter((item) => !item.ok);
  const report = {
    ok: failures.length === 0,
    evidenceFile: file,
    checks,
    failures: failures.map((item) => `${item.item}: ${item.hint}`)
  };
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exit(1);
}

function check(item, values, validate, hint) {
  const value = values[item] || "";
  return {
    item,
    ok: validate(value),
    value,
    hint
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
    .filter((cells) => cells.length >= 2 && !/^item$/i.test(cells[0]));
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
