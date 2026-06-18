#!/usr/bin/env node

const { spawnSync } = require("node:child_process");

const args = parseArgs(process.argv.slice(2));
const projectId = args.project || "mydietitian";
const serviceAccount = args.serviceAccount;
const evidenceFile = args.evidenceFile || args["evidence-file"] || "docs/MANUAL_UAT_EVIDENCE.md";
const includeSmokeWrite = Boolean(args.smokeWrite || args["smoke-write"]);
const useLineSecretManager = Boolean(args.useLineSecretManager || args["use-line-secret-manager"]);
const lineSecretName = args.lineSecretName || args["line-secret-name"] || "LINE_CHANNEL_SECRET";
const jsonOnly = Boolean(args.json);

if (args.help || args.h) {
  printHelp();
  process.exit(0);
}

main();

function main() {
  const readinessArgs = [
    "tools/final_migration_readiness_packet.js",
    "--project",
    projectId,
    "--evidence-file",
    evidenceFile
  ];
  if (serviceAccount) readinessArgs.push("--serviceAccount", serviceAccount);
  if (includeSmokeWrite) readinessArgs.push("--smoke-write");
  if (useLineSecretManager) readinessArgs.push("--useLineSecretManager", "--lineSecretName", lineSecretName);

  const readiness = runNodeJson("readiness-packet", readinessArgs);
  const remaining = runNodeJson("uat-remaining", [
    "tools/summarize_manual_uat_remaining.js",
    "--file",
    evidenceFile,
    "--phase",
    "pre-migration"
  ]);
  const operatorChecklist = runNodeJson("operator-checklist", [
    "tools/pre_migration_operator_checklist.js",
    "--file",
    evidenceFile,
    "--phase",
    "pre-migration",
    "--json"
  ]);
  const gitStatus = run("git", ["status", "--short", "--branch"]);

  const report = buildSummary({ readiness, remaining, operatorChecklist, gitStatus });
  if (jsonOnly) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(renderText(report));
  }

  if (!report.readyForDataMigrationWindow) process.exit(1);
}

function buildSummary({ readiness, remaining, operatorChecklist, gitStatus }) {
  const packet = readiness.json || {};
  const decision = packet.decision || {};
  const migrationSnapshot = packet.migrationSnapshot || {};
  const targetSnapshot = migrationSnapshot.firestoreTargetSnapshot || {};
  const blockerSample = Array.isArray(decision.blockers)
    ? decision.blockers.slice(0, 8).map((blocker) => truncate(blocker, 500))
    : [];
  const remainingGroups = remaining.json?.remainingGroups || [];

  return {
    ok: Boolean(readiness.ok && packet.ok),
    status: decision.status || "unknown",
    readyForDataMigrationWindow: Boolean(decision.readyForDataMigrationWindow),
    blockerCount: Array.isArray(decision.blockers) ? decision.blockers.length : null,
    blockerSample,
    automated: {
      preCutoverOk: Boolean(packet.automated?.preCutoverOk),
      noSkippedChecks: Boolean(packet.automated?.noSkippedChecks),
      skippedChecks: packet.automated?.skippedChecks || []
    },
    evidence: {
      file: evidenceFile,
      ok: Boolean(packet.evidenceCheck?.ok),
      remainingCount: remaining.json?.remainingCount ?? null,
      remainingGroups: remainingGroups.map((group) => ({
        name: group.name,
        missingCount: Array.isArray(group.missing) ? group.missing.length : 0,
        sample: Array.isArray(group.missing) ? group.missing.slice(0, 3) : []
      }))
    },
    operatorChecklist: {
      ok: Boolean(operatorChecklist.json?.ok),
      freshnessChecks: operatorChecklist.json?.freshnessChecks || [],
      actionCount: Array.isArray(operatorChecklist.json?.actions) ? operatorChecklist.json.actions.length : null,
      nextActions: Array.isArray(operatorChecklist.json?.actions)
        ? operatorChecklist.json.actions.slice(0, 5).map((item) => item.title)
        : []
    },
    migrationSnapshot: {
      totalPlannedDocuments: migrationSnapshot.totalPlannedDocuments ?? null,
      sourceTreeClean: Boolean(migrationSnapshot.sourceTreeClean),
      sourceCommit: migrationSnapshot.sourceCommit || migrationSnapshot.importManifest?.migrationCommit || null,
      sourceFingerprint: migrationSnapshot.sourceFingerprint?.value || null,
      firestoreRisk: targetSnapshot.riskLevel || null,
      legacyImportedDocuments: targetSnapshot.legacyImportedDocuments ?? null,
      dataQualityOk: Boolean(migrationSnapshot.dataQuality?.okToPreviewImport)
    },
    git: {
      ok: gitStatus.status === 0,
      status: gitStatus.stdout.trim().split(/\r?\n/).filter(Boolean)
    },
    commandErrors: [readiness, remaining, operatorChecklist, gitStatus]
      .filter((item) => item.status !== 0 && !["uat-remaining", "operator-checklist"].includes(item.name))
      .map((item) => truncate(`${item.name}: ${item.stderr || item.stdout || item.error || "failed"}`.trim(), 800))
  };
}

function renderText(report) {
  const lines = [
    "Pre-migration gate summary",
    `Status: ${report.status}`,
    `Ready for data migration window: ${report.readyForDataMigrationWindow ? "yes" : "no"}`,
    `Blockers: ${report.blockerCount ?? "unknown"}`,
    "",
    "Automated",
    `- Pre-cutover: ${report.automated.preCutoverOk ? "pass" : "fail"}`,
    `- No skipped checks: ${report.automated.noSkippedChecks ? "yes" : "no"}`,
    `- Source tree clean: ${report.migrationSnapshot.sourceTreeClean ? "yes" : "no"}`,
    "",
    "Migration snapshot",
    `- Planned docs: ${report.migrationSnapshot.totalPlannedDocuments ?? "-"}`,
    `- Firestore risk: ${report.migrationSnapshot.firestoreRisk ?? "-"}`,
    `- Legacy imported docs: ${report.migrationSnapshot.legacyImportedDocuments ?? "-"}`,
    `- Source fingerprint: ${report.migrationSnapshot.sourceFingerprint ?? "-"}`,
    "",
    "Manual evidence",
    `- File: ${report.evidence.file}`,
    `- Evidence ok: ${report.evidence.ok ? "yes" : "no"}`,
    `- Remaining items: ${report.evidence.remainingCount ?? "-"}`,
  ];

  for (const group of report.evidence.remainingGroups) {
    lines.push(`- ${group.name}: ${group.missingCount} missing`);
    for (const item of group.sample) lines.push(`  sample: ${item}`);
  }

  if (report.blockerSample.length) {
    lines.push("", "Top blockers");
    for (const blocker of report.blockerSample) lines.push(`- ${blocker}`);
  }

  if (report.operatorChecklist.freshnessChecks.length || report.operatorChecklist.nextActions.length) {
    lines.push("", "Operator checklist");
    for (const check of report.operatorChecklist.freshnessChecks) {
      lines.push(`- ${check.item}: ${check.ok ? "pass" : "stale"}${check.ok ? "" : ` (actual=${check.actual || "-"} expected=${check.expected || "-"})`}`);
    }
    for (const action of report.operatorChecklist.nextActions) {
      lines.push(`- next: ${action}`);
    }
  }

  if (report.commandErrors.length) {
    lines.push("", "Command errors");
    for (const error of report.commandErrors) lines.push(`- ${error}`);
  }

  return lines.join("\n");
}

function runNodeJson(name, nodeArgs) {
  const result = spawnSync(process.execPath, nodeArgs, {
    cwd: process.cwd(),
    encoding: "utf8",
    maxBuffer: 40 * 1024 * 1024
  });
  const output = `${result.stdout || ""}\n${result.stderr || ""}`;
  return {
    name,
    status: result.status,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    error: result.error ? result.error.message : null,
    ok: result.status === 0,
    json: parseLastJsonObject(output)
  };
}

function run(name, commandArgs) {
  const result = spawnSync(name, commandArgs, {
    cwd: process.cwd(),
    encoding: "utf8"
  });
  return {
    name,
    status: result.status,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    error: result.error ? result.error.message : null
  };
}

function parseLastJsonObject(text) {
  const end = text.lastIndexOf("}");
  if (end < 0) return null;
  for (let start = text.lastIndexOf("{", end); start >= 0; start = text.lastIndexOf("{", start - 1)) {
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      // Continue scanning left until the outer JSON object parses.
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

function truncate(value, maxLength) {
  const text = String(value || "").replace(/\r?\n/g, " ").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}…`;
}

function printHelp() {
  console.log([
    "Pre-migration gate summary",
    "",
    "Usage:",
    "  npm run gate:pre-migration -- --project mydietitian --serviceAccount <path> --smoke-write --useLineSecretManager",
    "",
    "Options:",
    "  --evidence-file docs/MANUAL_UAT_EVIDENCE.md",
    "  --json",
    "  --useLineSecretManager",
    "  --lineSecretName LINE_CHANNEL_SECRET"
  ].join("\n"));
}
