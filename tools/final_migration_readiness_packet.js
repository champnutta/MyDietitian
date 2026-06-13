#!/usr/bin/env node

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const args = parseArgs(process.argv.slice(2));
const projectId = args.project || "mydietitian";
const serviceAccount = args.serviceAccount;
const outFile = args.out ? path.resolve(args.out) : null;
const jsonOutFile = args.jsonOut ? path.resolve(args.jsonOut) : null;
const evidenceFile = args.evidenceFile ? path.resolve(args.evidenceFile) : null;
const includeSmokeWrite = Boolean(args.smokeWrite || args["smoke-write"]);

const MANUAL_GATE_FLAGS = [
  {
    flag: "manualLineMediaPass",
    cli: "--manual-line-media-pass",
    label: "Real LINE media UAT",
    evidence: "Food image, leftover image, payment slip/admin approve/reject, and BIA image/file evidence recorded."
  },
  {
    flag: "manualLiffAuthPass",
    cli: "--manual-liff-auth-pass",
    label: "Real LIFF auth UAT",
    evidence: "Real LIFF settings submit returns authVerified=true; invalid token test is rejected."
  },
  {
    flag: "rollbackReviewed",
    cli: "--rollback-reviewed",
    label: "Rollback plan reviewed",
    evidence: "Current GAS webhook URL is recorded and rollback owner/operator are ready."
  },
  {
    flag: "ownerApproval",
    cli: "--owner-approval",
    label: "Owner approval for migration window",
    evidence: "Owner explicitly approves entering the final Google Sheet to Firestore migration window."
  }
];

if (args.help || args.h) {
  printHelp();
  process.exit(0);
}

main();

function main() {
  const preCutoverArgs = ["tools/pre_cutover_report.js", "--project", projectId];
  if (serviceAccount) preCutoverArgs.push("--serviceAccount", serviceAccount);
  if (includeSmokeWrite) preCutoverArgs.push("--smoke-write");

  const preCutover = runNodeJson("pre-cutover report", preCutoverArgs);
  const evidenceCheck = evidenceFile
    ? runNodeJson("manual UAT evidence check", ["tools/manual_uat_evidence_check.js", "--file", evidenceFile, "--phase", "pre-migration"])
    : null;
  const manualGates = MANUAL_GATE_FLAGS.map((gate) => ({
    label: gate.label,
    pass: Boolean(args[gate.flag]),
    requiredFlag: gate.cli,
    evidence: gate.evidence
  }));

  const automatedOk = Boolean(preCutover.ok && preCutover.json?.ok);
  const anyManualFlagProvided = manualGates.some((gate) => gate.pass);
  const evidenceOk = evidenceCheck ? Boolean(evidenceCheck.ok && evidenceCheck.json?.ok) : !anyManualFlagProvided;
  const manualOk = manualGates.every((gate) => gate.pass);
  const migrationSnapshot = preCutover.json?.migrationSnapshot || {};
  const firestoreSnapshot = migrationSnapshot.firestoreTargetSnapshot || {};
  const noLegacyImportPresent = firestoreSnapshot.legacyImportAlreadyPresent === false;
  const firestoreTargetOk = firestoreSnapshot.okToProceedBeforeMigration === true;
  const dataQualityOk = migrationSnapshot.dataQuality?.okToPreviewImport === true;
  const evidenceConsistency = evidenceCheck
    ? buildEvidenceConsistency(evidenceCheck.json, migrationSnapshot)
    : { ok: !anyManualFlagProvided, checks: [], failures: anyManualFlagProvided ? ["Manual gate flags require --evidence-file."] : [] };
  const evidenceConsistent = evidenceConsistency.ok;
  const readyForDataMigrationWindow = automatedOk && evidenceOk && evidenceConsistent && manualOk && noLegacyImportPresent && firestoreTargetOk && dataQualityOk;
  const blockers = buildBlockers({ automatedOk, evidenceOk, evidenceCheck, evidenceConsistency, evidenceFile, anyManualFlagProvided, manualGates, noLegacyImportPresent, firestoreTargetOk, dataQualityOk, preCutover });

  const report = {
    packetType: "final-migration-readiness-packet",
    schemaVersion: 1,
    ok: automatedOk,
    generatedAt: new Date().toISOString(),
    projectId,
    decision: {
      status: readyForDataMigrationWindow ? "ready-for-final-data-migration-window" : "hold-before-data-migration",
      readyForDataMigrationWindow,
      blockers
    },
    automated: {
      preCutoverOk: automatedOk,
      checks: preCutover.json?.automatedChecks || [],
      error: preCutover.error
    },
    evidenceCheck: evidenceCheck
      ? {
        ok: evidenceOk,
        evidenceFile,
        failures: evidenceCheck.json?.failures || [],
        consistency: evidenceConsistency,
        error: evidenceCheck.error
      }
      : {
        ok: evidenceOk,
        evidenceFile: null,
        failures: anyManualFlagProvided ? ["Manual gate flags require --evidence-file."] : [],
        consistency: evidenceConsistency
      },
    manualGates,
    migrationSnapshot: {
      totalPlannedDocuments: migrationSnapshot.totalPlannedDocuments ?? null,
      countByCollection: migrationSnapshot.countByCollection || null,
      importManifest: migrationSnapshot.importManifest || null,
      dataQuality: migrationSnapshot.dataQuality || null,
      sourceFingerprint: migrationSnapshot.sourceFingerprint || null,
      firestoreTargetSnapshot: firestoreSnapshot,
      sampleUsersForDashboardParity: migrationSnapshot.sampleUsersForDashboardParity || []
    },
    lockedFinalMigrationCommand: "npm run migrate:sheets:dry-run -- --project mydietitian --serviceAccount \"C:\\Users\\champ\\AppData\\Roaming\\firebase\\znak_iiz_gmail.com_application_default_credentials.json\" --commit --confirmFinalMigration --confirmText FINAL_MIGRATION_MYDIETITIAN --readinessPacket docs/FINAL_MIGRATION_READINESS_PACKET.json",
    postMigrationVerificationCommands: [
      "npm run migration:verify-import -- --project mydietitian --serviceAccount \"C:\\Users\\champ\\AppData\\Roaming\\firebase\\znak_iiz_gmail.com_application_default_credentials.json\" --readinessPacket docs/FINAL_MIGRATION_READINESS_PACKET.json",
      "npm run report:pre-cutover -- --project mydietitian --serviceAccount \"C:\\Users\\champ\\AppData\\Roaming\\firebase\\znak_iiz_gmail.com_application_default_credentials.json\" --smoke-write",
      "npm run dashboard:parity-plan -- --out docs/DASHBOARD_PARITY_PLAN_OUTPUT.md",
      "npm run uat:evidence-check -- --file docs/MANUAL_UAT_EVIDENCE.md --phase cutover"
    ],
    nextActions: readyForDataMigrationWindow
      ? [
        "Open the approved migration window.",
        "Run the locked final migration command exactly once.",
        "Run every postMigrationVerificationCommands entry.",
        "Do not switch the production LINE webhook until import verification, dashboard parity, cutover evidence, and owner approval all pass."
      ]
      : [
        "Do not run the final migration command yet.",
        "Complete the listed manual gate evidence.",
        "Re-run this packet with the matching manual gate flags only after evidence is recorded."
      ]
  };

  const json = JSON.stringify(report, null, 2);
  console.log(json);

  if (outFile) {
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, `${renderMarkdown(report)}\n`, "utf8");
  }

  if (jsonOutFile) {
    fs.mkdirSync(path.dirname(jsonOutFile), { recursive: true });
    fs.writeFileSync(jsonOutFile, `${json}\n`, "utf8");
  }

  if (!automatedOk) process.exit(1);
}

function buildEvidenceConsistency(evidenceReport, migrationSnapshot) {
  const rollbackValues = Array.isArray(evidenceReport?.rollbackValues) ? evidenceReport.rollbackValues : [];
  const values = Object.fromEntries(rollbackValues.map((item) => [item.item, stripMarkdown(item.value)]));
  const currentFingerprint = migrationSnapshot?.sourceFingerprint?.value || "";
  const currentCommit = currentGitCommit();
  const checks = [
    {
      name: "Google Sheet source fingerprint",
      expected: currentFingerprint,
      actual: values["Latest Google Sheet source fingerprint"] || "",
      ok: Boolean(currentFingerprint) && values["Latest Google Sheet source fingerprint"] === currentFingerprint
    },
    {
      name: "Latest commit SHA",
      expected: currentCommit,
      actual: values["Latest commit SHA"] || "",
      ok: Boolean(currentCommit) && currentCommit.startsWith(values["Latest commit SHA"] || "")
    }
  ];
  const failures = checks
    .filter((check) => !check.ok)
    .map((check) => `${check.name} evidence mismatch. expected=${check.expected || "-"} actual=${check.actual || "-"}`);

  return {
    ok: failures.length === 0,
    checks,
    failures
  };
}

function currentGitCommit() {
  const result = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: process.cwd(),
    encoding: "utf8"
  });
  if (result.status === 0 && result.stdout.trim()) return result.stdout.trim();
  return currentGitCommitFromFiles();
}

function currentGitCommitFromFiles() {
  try {
    const gitDir = path.join(process.cwd(), ".git");
    const head = fs.readFileSync(path.join(gitDir, "HEAD"), "utf8").trim();
    if (/^[a-f0-9]{40}$/i.test(head)) return head;
    const ref = head.match(/^ref:\s+(.+)$/)?.[1];
    if (!ref) return "";
    return fs.readFileSync(path.join(gitDir, ref), "utf8").trim();
  } catch {
    return "";
  }
}

function stripMarkdown(value) {
  return String(value || "").replace(/`/g, "").trim();
}

function buildBlockers({ automatedOk, evidenceOk, evidenceCheck, evidenceConsistency, evidenceFile, anyManualFlagProvided, manualGates, noLegacyImportPresent, firestoreTargetOk, dataQualityOk, preCutover }) {
  const blockers = [];
  if (!automatedOk) blockers.push(`Automated pre-cutover report failed: ${preCutover.error || "unknown error"}`);
  if (anyManualFlagProvided && !evidenceFile) blockers.push("Manual gate flags require --evidence-file pointing to a completed UAT evidence file.");
  if (evidenceFile && !evidenceOk) {
    const failures = evidenceCheck?.json?.failures || [evidenceCheck?.error || "unknown evidence check failure"];
    for (const failure of failures) blockers.push(`Evidence file incomplete: ${failure}`);
  }
  if (evidenceFile && evidenceOk && !evidenceConsistency.ok) {
    for (const failure of evidenceConsistency.failures) blockers.push(`Evidence file stale or mismatched: ${failure}`);
  }
  if (automatedOk && !dataQualityOk) blockers.push("Migration dry-run data quality is not okToPreviewImport=true.");
  if (automatedOk && !firestoreTargetOk) blockers.push("Firestore target snapshot is not okToProceedBeforeMigration=true.");
  if (automatedOk && !noLegacyImportPresent) blockers.push("Firestore already contains legacy imported documents; review before writing again.");
  for (const gate of manualGates) {
    if (!gate.pass) blockers.push(`${gate.label} not confirmed. Re-run with ${gate.requiredFlag} only after evidence is recorded.`);
  }
  return blockers;
}

function printHelp() {
  console.log([
    "Final migration readiness packet",
    "",
    "Usage:",
    "  npm run migration:readiness-packet -- --project mydietitian --serviceAccount <path> --smoke-write",
    "",
    "Manual gate flags, pass only after evidence is recorded:",
    "  --manual-line-media-pass",
    "  --manual-liff-auth-pass",
    "  --rollback-reviewed",
    "  --owner-approval",
    "",
    "Optional:",
    "  --evidence-file docs/MANUAL_UAT_EVIDENCE.md",
    "  --json-out docs/FINAL_MIGRATION_READINESS_PACKET.json",
    "  --out docs/FINAL_MIGRATION_READINESS_PACKET.md"
  ].join("\n"));
}

function runNodeJson(name, nodeArgs) {
  const result = spawnSync(process.execPath, nodeArgs, {
    cwd: process.cwd(),
    encoding: "utf8",
    maxBuffer: 30 * 1024 * 1024
  });
  const output = `${result.stdout || ""}\n${result.stderr || ""}`;
  const json = parseLastJsonObject(output);
  return {
    name,
    ok: result.status === 0 && Boolean(json) && Boolean(json.ok ?? true),
    status: result.status,
    json,
    error: result.error ? result.error.message : (result.status === 0 ? null : output.trim())
  };
}

function renderMarkdown(report) {
  const lines = [
    "# Final Migration Readiness Packet",
    "",
    `Generated: ${report.generatedAt}`,
    `Project: ${report.projectId}`,
    `Decision: ${report.decision.status}`,
    `Ready for data migration window: ${report.decision.readyForDataMigrationWindow ? "yes" : "no"}`,
    "",
    "## Blockers",
    ""
  ];

  if (report.decision.blockers.length) {
    for (const blocker of report.decision.blockers) lines.push(`- ${blocker}`);
  } else {
    lines.push("- None.");
  }

  lines.push(
    "",
    "## Automated Checks",
    "",
    "| Check | Status | Summary |",
    "| --- | --- | --- |"
  );

  for (const check of report.automated.checks || []) {
    lines.push(`| ${check.name} | ${check.ok ? "pass" : "fail"} | ${escapeTable(JSON.stringify(check.summary || check.error || {}))} |`);
  }

  lines.push(
    "",
    "## Manual Gates",
    "",
    "| Gate | Status | Required flag | Evidence |",
    "| --- | --- | --- | --- |"
  );

  for (const gate of report.manualGates) {
    lines.push(`| ${gate.label} | ${gate.pass ? "pass" : "missing"} | \`${gate.requiredFlag}\` | ${escapeTable(gate.evidence)} |`);
  }

  lines.push(
    "",
    "## Evidence File",
    "",
    `Evidence file: ${report.evidenceCheck.evidenceFile || "-"}`,
    `Evidence check: ${report.evidenceCheck.ok ? "pass" : "missing/fail"}`
  );

  if (report.evidenceCheck.failures.length) {
    for (const failure of report.evidenceCheck.failures) lines.push(`- ${failure}`);
  }

  lines.push(
    "",
    "Evidence consistency:",
    report.evidenceCheck.consistency?.ok ? "pass" : "missing/fail"
  );

  for (const failure of report.evidenceCheck.consistency?.failures || []) {
    lines.push(`- ${failure}`);
  }

  lines.push(
    "",
    "## Migration Snapshot",
    "",
    `Total planned documents: ${report.migrationSnapshot.totalPlannedDocuments ?? "-"}`,
    `Source fingerprint: ${report.migrationSnapshot.sourceFingerprint?.value ?? "-"}`,
    `Legacy imported documents already present: ${report.migrationSnapshot.firestoreTargetSnapshot?.legacyImportedDocuments ?? "-"}`,
    `Firestore target risk level: ${report.migrationSnapshot.firestoreTargetSnapshot?.riskLevel ?? "-"}`,
    "",
    "Locked final migration command:",
    "",
    "```powershell",
    report.lockedFinalMigrationCommand,
    "```",
    "",
    "Post-migration verification commands:",
    ""
  );

  for (const command of report.postMigrationVerificationCommands || []) {
    lines.push(
      "```powershell",
      command,
      "```",
      ""
    );
  }

  lines.push(
    "",
    "## Next Actions",
    ""
  );

  for (const item of report.nextActions) lines.push(`- ${item}`);

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

function escapeTable(value) {
  return String(value).replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");
}
