#!/usr/bin/env node

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const args = parseArgs(process.argv.slice(2));
const projectId = args.project || "mydietitian";
const serviceAccount = args.serviceAccount;
const outFile = args.out ? path.resolve(args.out) : null;
const includeSmokeWrite = Boolean(args.smokeWrite || args["smoke-write"]);

const REQUIRED_MANUAL_GATES = [
  {
    gate: "Real LINE media UAT",
    status: "manual-required",
    evidence: "Food image, leftover image, payment slip, and BIA image/file require real LINE messageIds.",
    template: "docs/MANUAL_UAT_EVIDENCE_TEMPLATE.md"
  },
  {
    gate: "Real LIFF auth UAT",
    status: "manual-required",
    evidence: "authVerified=true needs a real LIFF session and LINE ID token.",
    template: "docs/MANUAL_UAT_EVIDENCE_TEMPLATE.md"
  },
  {
    gate: "Dashboard parity against GAS",
    status: "manual-after-import",
    evidence: "Run after preview/final import using sampleUsersForDashboardParity from migration dry-run.",
    template: "docs/MANUAL_UAT_EVIDENCE_TEMPLATE.md"
  },
  {
    gate: "Production webhook cutover approval",
    status: "manual-final-step",
    evidence: "Keep production LINE OA on GAS until all UAT and data parity checks pass.",
    template: "docs/MANUAL_UAT_EVIDENCE_TEMPLATE.md",
    runbook: "docs/PRODUCTION_CUTOVER_ROLLBACK_RUNBOOK.md"
  }
];

main();

function main() {
  const auditArgs = ["tools/pre_migration_readiness_audit.js", "--project", projectId];
  if (serviceAccount) auditArgs.push("--serviceAccount", serviceAccount);
  if (includeSmokeWrite) auditArgs.push("--smoke-write");

  const audit = runNodeJson("pre-migration audit", auditArgs);
  const migration = runNodeJson("migration dry-run", ["tools/migrate_sheet_to_firestore.js", "--sampleLimit", "5"]);
  const dashboard = runNodeJson("dashboard contract", ["tools/dashboard_contract_check.js"]);
  const lineUat = runNodeJson("LINE UAT dry-run", ["tools/line_staging_uat_report.js"]);
  const firestoreSnapshotArgs = ["tools/firestore_target_snapshot.js", "--project", projectId];
  if (serviceAccount) firestoreSnapshotArgs.push("--serviceAccount", serviceAccount);
  const firestoreSnapshot = runNodeJson("Firestore target snapshot", firestoreSnapshotArgs);

  const automatedChecks = [audit, migration, dashboard, lineUat, firestoreSnapshot];
  const failed = automatedChecks.filter((check) => !check.ok);
  const migrationReadiness = migration.json?.migrationReadiness || {};
  const report = {
    ok: failed.length === 0,
    generatedAt: new Date().toISOString(),
    projectId,
    automatedChecks: automatedChecks.map(summarizeAutomatedCheck),
    migrationSnapshot: {
      totalPlannedDocuments: migration.json?.total ?? null,
      countByCollection: migration.json?.countByCollection || null,
      dataQuality: migrationReadiness.dataQuality || null,
      sourceSummary: migrationReadiness.sourceSummary || null,
      sampleUsersForDashboardParity: migrationReadiness.sampleUsersForDashboardParity || [],
      firestoreTargetSnapshot: firestoreSnapshot.json?.summary || null
    },
    manualGatesRemaining: REQUIRED_MANUAL_GATES
  };

  const json = JSON.stringify(report, null, 2);
  console.log(json);

  if (outFile) {
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, `${renderMarkdown(report)}\n`, "utf8");
  }

  if (!report.ok) process.exit(1);
}

function runNodeJson(name, nodeArgs) {
  const result = spawnSync(process.execPath, nodeArgs, {
    cwd: process.cwd(),
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024
  });

  const output = `${result.stdout || ""}\n${result.stderr || ""}`;
  const json = parseLastJsonObject(output);
  return {
    name,
    ok: result.status === 0 && Boolean(json) && Boolean(json.ok ?? true),
    status: result.status,
    json,
    error: result.status === 0 ? null : output.trim()
  };
}

function summarizeAutomatedCheck(check) {
  return {
    name: check.name,
    ok: check.ok,
    status: check.status,
    summary: summarizeJson(check.name, check.json),
    error: check.error
  };
}

function summarizeJson(name, json) {
  if (!json) return null;
  if (name === "pre-migration audit") {
    return {
      passed: json.passed,
      failed: json.failed,
      skipped: json.skipped
    };
  }
  if (name === "migration dry-run") {
    return {
      total: json.total,
      countByCollection: json.countByCollection,
      okToPreviewImport: json.migrationReadiness?.dataQuality?.okToPreviewImport
    };
  }
  if (name === "dashboard contract") {
    return {
      status: json.status,
      labels: json.labels,
      failedChecks: Array.isArray(json.checks) ? json.checks.filter((check) => !check.ok).map((check) => check.name) : []
    };
  }
  if (name === "LINE UAT dry-run") {
    return json.summary;
  }
  if (name === "Firestore target snapshot") {
    return json.summary;
  }
  return null;
}

function renderMarkdown(report) {
  const lines = [
    "# MyDietitian Pre-Cutover Report",
    "",
    `Generated: ${report.generatedAt}`,
    `Project: ${report.projectId}`,
    "",
    "## Automated Checks",
    "",
    "| Check | Status | Summary |",
    "| --- | --- | --- |"
  ];

  for (const check of report.automatedChecks) {
    lines.push(`| ${check.name} | ${check.ok ? "pass" : "fail"} | ${escapeTable(JSON.stringify(check.summary || check.error || {}))} |`);
  }

  lines.push(
    "",
    "## Migration Snapshot",
    "",
    `Total planned documents: ${report.migrationSnapshot.totalPlannedDocuments ?? "-"}`,
    `Firestore tracked documents before migration: ${report.migrationSnapshot.firestoreTargetSnapshot?.totalDocumentsInTrackedCollections ?? "-"}`,
    `Existing legacy imported documents: ${report.migrationSnapshot.firestoreTargetSnapshot?.legacyImportedDocuments ?? "-"}`,
    "",
    "Suggested sample users for dashboard parity:"
  );

  for (const user of report.migrationSnapshot.sampleUsersForDashboardParity || []) {
    lines.push(`- ${user.userId} (${user.name}): meals=${user.mealRows}, exercise=${user.exerciseRows}, weights=${user.weightRows}, active=${user.activeSubscription}`);
  }

  lines.push(
    "",
    "## Manual Gates Remaining",
    "",
    "| Gate | Status | Evidence | Template | Runbook |",
    "| --- | --- | --- | --- | --- |"
  );

  for (const gate of report.manualGatesRemaining) {
    lines.push(`| ${gate.gate} | ${gate.status} | ${escapeTable(gate.evidence)} | ${gate.template || "-"} | ${gate.runbook || "-"} |`);
  }

  return lines.join("\n");
}

function parseLastJsonObject(text) {
  const end = text.lastIndexOf("}");
  if (end < 0) return null;
  for (let start = text.lastIndexOf("{", end); start >= 0; start = text.lastIndexOf("{", start - 1)) {
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      // Keep scanning left until we find the outermost valid final JSON object.
    }
  }
  return null;
}

function parseArgs(argv) {
  const out = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg.startsWith("--")) {
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
  }
  return out;
}

function toCamelCase(value) {
  return value.replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
}

function escapeTable(value) {
  return String(value).replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");
}
