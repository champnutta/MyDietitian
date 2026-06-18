#!/usr/bin/env node

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const args = parseArgs(process.argv.slice(2));
const evidenceFile = args.file || args.evidenceFile || args["evidence-file"] || "docs/MANUAL_UAT_EVIDENCE.md";
const phase = args.phase || "pre-migration";
const outFile = args.out ? path.resolve(args.out) : null;
const jsonOnly = Boolean(args.json);

if (args.help || args.h) {
  printHelp();
  process.exit(0);
}

main();

function main() {
  const remaining = runNodeJson("uat remaining", [
    "tools/summarize_manual_uat_remaining.js",
    "--file",
    evidenceFile,
    "--phase",
    phase
  ]);
  const rollback = runNodeJson("rollback values", [
    "tools/check_rollback_values.js",
    "--file",
    evidenceFile
  ]);
  const report = buildReport(remaining, rollback);
  const output = jsonOnly ? JSON.stringify(report, null, 2) : renderMarkdown(report);

  console.log(output);
  if (outFile) {
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, `${output}\n`, "utf8");
  }

  if (!report.ok) process.exit(1);
}

function buildReport(remaining, rollback) {
  const groups = remaining.json?.remainingGroups || [];
  const rollbackChecks = rollback.json?.checks || [];
  const currentCommit = currentGitCommit();
  const freshnessChecks = buildFreshnessChecks(rollbackChecks, currentCommit);
  const actions = buildActions(groups, rollbackChecks, freshnessChecks);
  return {
    ok: Boolean(remaining.json?.ok),
    generatedAt: new Date().toISOString(),
    evidenceFile,
    phase,
    currentCommit,
    remainingCount: remaining.json?.remainingCount ?? null,
    groups: groups.map((group) => ({
      name: group.name,
      missingCount: Array.isArray(group.missing) ? group.missing.length : 0,
      missing: group.missing || []
    })),
    rollbackChecks,
    freshnessChecks,
    actions,
    commandErrors: [remaining, rollback]
      .filter((item) => !item.json)
      .map((item) => `${item.name}: ${item.error || item.stdout || item.stderr || "failed"}`)
  };
}

function buildFreshnessChecks(rollbackChecks, currentCommit) {
  const commitCheck = rollbackChecks.find((check) => check.item === "Latest commit SHA");
  const recordedCommit = stripMarkdown(commitCheck?.value || "");
  return [
    {
      item: "Latest commit SHA matches current HEAD",
      ok: Boolean(currentCommit) && Boolean(recordedCommit) && currentCommit.startsWith(recordedCommit),
      expected: currentCommit,
      actual: recordedCommit,
      hint: "Regenerate or update docs/MANUAL_UAT_EVIDENCE.md after the latest commit before requesting migration approval."
    }
  ];
}

function buildActions(groups, rollbackChecks, freshnessChecks) {
  const names = new Set(groups.map((group) => group.name));
  const actions = [];

  if (names.has("Session fields")) {
    actions.push({
      title: "Prepare local evidence session fields",
      command: "npm run uat:prepare-evidence -- --project mydietitian --force --useLineSecretManager --tester \"<YOUR_NAME>\" --lineChannel \"<STAGING_LINE_CHANNEL>\" --testLineUserId \"<TEST_LINE_USER_ID>\" --currentGasWebhookUrl \"<CURRENT_GAS_WEBHOOK_URL_FROM_LINE_CONSOLE>\" --operator \"<ROLLBACK_OPERATOR>\""
    });
  }
  if (names.has("Real LINE media UAT") || names.has("Real LIFF auth UAT")) {
    actions.push({
      title: "Run staging real LINE/LIFF UAT and collect Firestore evidence",
      command: "npm run uat:firestore-evidence -- --user \"<TEST_LINE_USER_ID>\" --since-hours 24 --require-all --out docs\\UAT_FIRESTORE_EVIDENCE.json --markdown-out docs\\UAT_FIRESTORE_EVIDENCE.md"
    });
  }
  if (names.has("Real LIFF auth UAT")) {
    actions.push({
      title: "Run controlled LIFF invalid token negative test",
      command: "npm run uat:liff-invalid-token -- --user \"<TEST_LINE_USER_ID>\""
    });
  }
  if (names.has("Security preflight")) {
    actions.push({
      title: "After rotating LINE channel secret, collect safe secret metadata evidence",
      command: "npm run uat:line-secret-evidence -- --project mydietitian --markdown-out docs\\LINE_SECRET_ROTATION_EVIDENCE.md --out docs\\LINE_SECRET_ROTATION_EVIDENCE.json"
    });
  }
  if (rollbackChecks.some((check) => !check.ok) || freshnessChecks.some((check) => !check.ok)) {
    actions.push({
      title: "Fix rollback values in docs/MANUAL_UAT_EVIDENCE.md",
      command: "npm run uat:rollback-values -- --file docs\\MANUAL_UAT_EVIDENCE.md"
    });
  }
  actions.push({
    title: "Recheck compact pre-migration gate",
    command: "npm run gate:pre-migration -- --project mydietitian --serviceAccount \"C:\\Users\\champ\\AppData\\Roaming\\firebase\\znak_iiz_gmail.com_application_default_credentials.json\" --smoke-write --useLineSecretManager --evidence-file docs\\MANUAL_UAT_EVIDENCE.md"
  });

  return actions;
}

function renderMarkdown(report) {
  const lines = [
    "# Pre-Migration Operator Checklist",
    "",
    `Generated: ${report.generatedAt}`,
    `Evidence file: ${report.evidenceFile}`,
    `Phase: ${report.phase}`,
    `Overall: ${report.ok ? "pass" : "hold"}`,
    `Remaining items: ${report.remainingCount ?? "-"}`,
    `Current HEAD: ${report.currentCommit || "-"}`,
    "",
    "## Missing Evidence",
    ""
  ];

  if (!report.groups.length) {
    lines.push("- None.");
  }
  for (const group of report.groups) {
    lines.push(`### ${group.name} (${group.missingCount})`);
    for (const item of group.missing) lines.push(`- [ ] ${item}`);
    lines.push("");
  }

  lines.push("## Rollback Values", "", "| Item | Status | Value / hint |", "| --- | --- | --- |");
  for (const check of report.rollbackChecks) {
    lines.push(`| ${escapeTable(check.item)} | ${check.ok ? "pass" : "missing"} | ${escapeTable(check.ok ? check.value : check.hint)} |`);
  }

  lines.push("", "## Freshness Checks", "", "| Item | Status | Expected | Actual / hint |", "| --- | --- | --- | --- |");
  for (const check of report.freshnessChecks) {
    lines.push(`| ${escapeTable(check.item)} | ${check.ok ? "pass" : "stale"} | ${escapeTable(check.expected || "-")} | ${escapeTable(check.ok ? check.actual : `${check.actual || "-"}; ${check.hint}`)} |`);
  }

  lines.push("", "## Suggested Next Commands", "");
  for (const action of report.actions) {
    lines.push(`### ${action.title}`, "", "```powershell", action.command, "```", "");
  }

  lines.push(
    "## Guardrail",
    "",
    "Do not run final data migration and do not switch the production LINE webhook from GAS until the compact gate says ready and the owner explicitly approves the migration window."
  );

  return lines.join("\n");
}

function runNodeJson(name, nodeArgs) {
  const result = spawnSync(process.execPath, nodeArgs, {
    cwd: process.cwd(),
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024
  });
  const output = `${result.stdout || ""}\n${result.stderr || ""}`;
  return {
    name,
    status: result.status,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    error: result.error ? result.error.message : null,
    json: parseLastJsonObject(output)
  };
}

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

function escapeTable(value) {
  return String(value || "").replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");
}

function currentGitCommit() {
  const result = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: process.cwd(),
    encoding: "utf8"
  });
  return result.status === 0 ? result.stdout.trim() : "";
}

function stripMarkdown(value) {
  return String(value || "").replace(/`/g, "").trim();
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

function printHelp() {
  console.log([
    "Pre-migration operator checklist",
    "",
    "Usage:",
    "  npm run uat:operator-checklist -- --file docs/MANUAL_UAT_EVIDENCE.md --out docs/PRE_MIGRATION_OPERATOR_CHECKLIST.md",
    "",
    "This produces a Markdown checklist from the same evidence checks used by the migration gate.",
    "It does not migrate data and does not change the LINE webhook."
  ].join("\n"));
}
