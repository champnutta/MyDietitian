#!/usr/bin/env node

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const args = parseArgs(process.argv.slice(2));
const projectId = args.project || "mydietitian";
const serviceAccount = args.serviceAccount;
const evidenceFile = args.evidenceFile || args["evidence-file"] || "docs/MANUAL_UAT_EVIDENCE.md";
const useLineSecretManager = Boolean(args.useLineSecretManager || args["use-line-secret-manager"]);
const includeSmokeWrite = Boolean(args.smokeWrite || args["smoke-write"]);
const jsonOnly = Boolean(args.json);
const outFile = args.out ? path.resolve(args.out) : null;
const jsonOutFile = args.jsonOut || args["json-out"] ? path.resolve(args.jsonOut || args["json-out"]) : null;

const REQUIRED_FUNCTIONS = [
  "health",
  "updateProfile",
  "saveSettingsFromWeb",
  "getDashboardData",
  "analyzeMeal",
  "analyzeExercise",
  "lineWebhook"
];

if (args.help || args.h) {
  printHelp();
  process.exit(0);
}

main();

function main() {
  const report = buildStatusPack();
  const output = jsonOnly ? JSON.stringify(report, null, 2) : renderMarkdown(report);
  console.log(output);

  if (outFile) writeText(outFile, `${renderMarkdown(report)}\n`);
  if (jsonOutFile) writeText(jsonOutFile, `${JSON.stringify(report, null, 2)}\n`);

  if (!report.okForPreMigrationWork) process.exit(1);
}

function buildStatusPack() {
  const gitStatus = run("git", ["status", "--short", "--branch"]);
  const gitHead = run("git", ["rev-parse", "HEAD"]);
  const functionsList = runJson("firebase functions:list", ["firebase", "functions:list", "--project", projectId, "--json"]);
  const aiConfig = runNodeJson("AI agent runtime config", [
    "tools/check_ai_agent_runtime_config.js",
    "--project",
    projectId,
    ...(serviceAccount ? ["--serviceAccount", serviceAccount] : []),
    "--require-anthropic-fallback"
  ]);
  const lineUat = runNodeJson("LINE text UAT", ["tools/line_staging_uat_report.js", "--json"]);
  const portionAdjustment = runNodeJson("portion adjustment contract", ["tools/portion_adjustment_contract_check.js"]);
  const dryRun = runNodeJson("Google Sheet migration dry-run", [
    "tools/migrate_sheet_to_firestore.js",
    "--project",
    projectId,
    ...(serviceAccount ? ["--serviceAccount", serviceAccount] : [])
  ]);
  const gateArgs = [
    "tools/pre_migration_gate_summary.js",
    "--project",
    projectId,
    "--evidence-file",
    evidenceFile,
    "--json"
  ];
  if (serviceAccount) gateArgs.push("--serviceAccount", serviceAccount);
  if (includeSmokeWrite) gateArgs.push("--smoke-write");
  if (useLineSecretManager) gateArgs.push("--useLineSecretManager");
  const gate = runNodeJson("pre-migration gate", gateArgs);

  const deployedFunctions = summarizeFunctions(functionsList.json?.result || []);
  const missingFunctions = REQUIRED_FUNCTIONS.filter((id) => !deployedFunctions.some((item) => item.id === id && item.state === "ACTIVE"));
  const migrationSnapshot = dryRun.json?.importManifest || {};
  const gateReport = gate.json || {};
  const blockers = buildBlockers({
    commands: [functionsList, aiConfig, lineUat, portionAdjustment, dryRun, gate],
    missingFunctions,
    aiConfig: aiConfig.json,
    lineUat: lineUat.json,
    portionAdjustment: portionAdjustment.json,
    dryRun: dryRun.json,
    gateReport
  });

  return {
    okForPreMigrationWork: blockers.critical.length === 0,
    readyForFinalDataMigration: Boolean(gateReport.readyForDataMigrationWindow),
    generatedAt: new Date().toISOString(),
    projectId,
    git: {
      head: gitHead.ok ? gitHead.stdout.trim() : null,
      clean: gitStatus.ok && gitStatus.stdout.trim() === `## ${currentBranchFromStatus(gitStatus.stdout)}`,
      status: gitStatus.stdout.trim().split(/\r?\n/).filter(Boolean)
    },
    deployedFunctions,
    requiredFunctions: REQUIRED_FUNCTIONS,
    missingFunctions,
    ai: summarizeAi(aiConfig.json),
    lineTextUat: {
      ok: Boolean(lineUat.json?.ok),
      passed: lineUat.json?.summary?.textScenarioPassed ?? null,
      failed: lineUat.json?.summary?.textScenarioFailed ?? null,
      realLineRequiredCount: lineUat.json?.summary?.realLineRequiredCount ?? null
    },
    portionAdjustment: {
      ok: Boolean(portionAdjustment.json?.ok),
      passed: portionAdjustment.json?.summary?.passed ?? null,
      failed: portionAdjustment.json?.summary?.failed ?? null
    },
    migrationDryRun: {
      ok: Boolean(dryRun.json?.migrationReadiness?.dataQuality?.okToPreviewImport),
      totalPlannedDocuments: migrationSnapshot.totalPlannedDocuments ?? dryRun.json?.total ?? null,
      importRunId: migrationSnapshot.importRunId || null,
      sourceFingerprint: migrationSnapshot.sourceFingerprint?.value || dryRun.json?.migrationReadiness?.sourceFingerprint?.value || null,
      countByCollection: migrationSnapshot.countByCollection || dryRun.json?.countByCollection || {},
      warnings: dryRun.json?.migrationReadiness?.dataQuality?.warnings || []
    },
    preMigrationGate: {
      status: gateReport.status || "unknown",
      readyForDataMigrationWindow: Boolean(gateReport.readyForDataMigrationWindow),
      blockerCount: gateReport.blockerCount ?? null,
      automated: gateReport.automated || {},
      evidence: gateReport.evidence || {},
      nextActions: gateReport.operatorChecklist?.nextActions || []
    },
    blockers,
    commandStatus: [functionsList, aiConfig, lineUat, portionAdjustment, dryRun, gate].map((item) => ({
      name: item.name,
      ok: item.ok,
      status: item.status,
      error: item.error || null
    })),
    guardrail: "Do not run final data migration and do not switch the production LINE webhook from GAS until readyForFinalDataMigration is true and the owner explicitly approves the migration window."
  };
}

function buildBlockers({ commands, missingFunctions, aiConfig, lineUat, portionAdjustment, dryRun, gateReport }) {
  const critical = [];
  const beforeMigration = [];

  for (const command of commands) {
    if (!command.json && command.status !== 0) critical.push(`${command.name} failed or returned non-JSON output.`);
  }
  if (missingFunctions.length) critical.push(`Missing active Firebase Functions: ${missingFunctions.join(", ")}.`);
  if (!aiConfig?.ok) critical.push("AI agent runtime config is not ready with required Anthropic fallback.");
  if (!lineUat?.ok) critical.push("LINE text UAT dry-run is not passing.");
  if (!portionAdjustment?.ok) critical.push("Portion adjustment contract is not passing.");
  if (!dryRun?.migrationReadiness?.dataQuality?.okToPreviewImport) critical.push("Google Sheet migration dry-run is not safe to preview/import.");

  if (!gateReport.readyForDataMigrationWindow) {
    beforeMigration.push(`Pre-migration gate status is ${gateReport.status || "unknown"} with ${gateReport.blockerCount ?? "unknown"} blocker(s).`);
  }
  for (const group of gateReport.evidence?.remainingGroups || []) {
    beforeMigration.push(`${group.name}: ${group.missingCount} missing.`);
  }
  for (const action of gateReport.operatorChecklist?.nextActions || []) {
    beforeMigration.push(`Next action: ${action}.`);
  }

  return { critical, beforeMigration };
}

function summarizeFunctions(functions) {
  return functions
    .map((fn) => ({
      id: fn.id,
      region: fn.region,
      runtime: fn.runtime,
      state: fn.state,
      uri: fn.uri,
      secrets: Array.isArray(fn.secretEnvironmentVariables)
        ? fn.secretEnvironmentVariables.map((secret) => secret.key).sort()
        : []
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

function summarizeAi(report) {
  const checks = Array.isArray(report?.checks) ? report.checks : [];
  return {
    ok: Boolean(report?.ok),
    expected: report?.expected || null,
    agents: checks.map((item) => ({
      agentId: item.agentId,
      ok: Boolean(item.ok),
      primary: item.primary,
      anthropicFallback: item.anthropicFallback
    }))
  };
}

function renderMarkdown(report) {
  const lines = [
    "# Backend Migration Status Pack",
    "",
    `Generated: ${report.generatedAt}`,
    `Project: ${report.projectId}`,
    `Git HEAD: ${report.git.head || "-"}`,
    `Safe for continued pre-migration work: ${report.okForPreMigrationWork ? "yes" : "no"}`,
    `Ready for final data migration: ${report.readyForFinalDataMigration ? "yes" : "no"}`,
    "",
    "## Backend",
    "",
    "| Function | Region | Runtime | State | Secrets |",
    "| --- | --- | --- | --- | --- |"
  ];

  for (const fn of report.deployedFunctions) {
    lines.push(`| ${fn.id} | ${fn.region} | ${fn.runtime} | ${fn.state} | ${fn.secrets.join(", ") || "-"} |`);
  }
  if (report.missingFunctions.length) lines.push("", `Missing required functions: ${report.missingFunctions.join(", ")}`);

  lines.push(
    "",
    "## AI",
    "",
    `AI config: ${report.ai.ok ? "pass" : "fail"}`,
    `Expected Gemini: ${report.ai.expected?.geminiModel || "-"}`,
    `Expected Anthropic fallback: ${report.ai.expected?.anthropicModel || "-"}`
  );
  for (const agent of report.ai.agents) {
    lines.push(`- ${agent.agentId}: ${agent.ok ? "pass" : "fail"} (${agent.primary?.provider}/${agent.primary?.model} -> anthropic/${agent.anthropicFallback?.model || "-"})`);
  }

  lines.push(
    "",
    "## Checks",
    "",
    `LINE text UAT: ${report.lineTextUat.ok ? "pass" : "fail"} (${report.lineTextUat.passed}/${Number(report.lineTextUat.passed || 0) + Number(report.lineTextUat.failed || 0)} text scenarios, ${report.lineTextUat.realLineRequiredCount} real LINE/LIFF cases still require manual evidence)`,
    `Portion adjustment contract: ${report.portionAdjustment.ok ? "pass" : "fail"} (${report.portionAdjustment.passed}/${Number(report.portionAdjustment.passed || 0) + Number(report.portionAdjustment.failed || 0)} cases)`,
    `Migration dry-run: ${report.migrationDryRun.ok ? "pass" : "fail"} (${report.migrationDryRun.totalPlannedDocuments} planned docs, importRunId=${report.migrationDryRun.importRunId || "-"})`,
    `Source fingerprint: ${report.migrationDryRun.sourceFingerprint || "-"}`,
    `Pre-migration gate: ${report.preMigrationGate.status} (${report.preMigrationGate.blockerCount ?? "-"} blockers)`,
    "",
    "## Remaining Before Final Migration",
    ""
  );

  if (!report.blockers.beforeMigration.length) {
    lines.push("- None.");
  } else {
    for (const blocker of report.blockers.beforeMigration) lines.push(`- ${blocker}`);
  }

  lines.push("", "## Critical Issues For Staging Work", "");
  if (!report.blockers.critical.length) {
    lines.push("- None.");
  } else {
    for (const blocker of report.blockers.critical) lines.push(`- ${blocker}`);
  }

  lines.push(
    "",
    "## Guardrail",
    "",
    report.guardrail
  );
  return lines.join("\n");
}

function runNodeJson(name, nodeArgs) {
  return runJson(name, [process.execPath, ...nodeArgs]);
}

function runJson(name, command) {
  const result = run(command[0], command.slice(1));
  return {
    ...result,
    name,
    json: parseLastJsonObject(`${result.stdout || ""}\n${result.stderr || ""}`)
  };
}

function run(command, commandArgs) {
  const invocation = buildInvocation(command, commandArgs);
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: process.cwd(),
    encoding: "utf8",
    maxBuffer: 80 * 1024 * 1024,
    shell: false
  });
  return {
    name: command,
    ok: result.status === 0,
    status: result.status,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    error: result.error ? result.error.message : null
  };
}

function buildInvocation(command, commandArgs) {
  if (os.platform() === "win32" && command === "firebase") {
    return { command: "cmd.exe", args: ["/d", "/s", "/c", "firebase", ...commandArgs] };
  }
  return { command, args: commandArgs };
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

function writeText(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, "utf8");
}

function currentBranchFromStatus(statusText) {
  const first = statusText.trim().split(/\r?\n/)[0] || "";
  return first.replace(/^##\s+/, "").split("...")[0] || "master";
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
    "Backend migration status pack",
    "",
    "Usage:",
    "  node tools/backend_migration_status_pack.js --project mydietitian --serviceAccount <path> --smoke-write --useLineSecretManager",
    "",
    "Options:",
    "  --json                 Print JSON instead of Markdown.",
    "  --out <file>           Write Markdown report.",
    "  --json-out <file>      Write JSON report.",
    "  --evidence-file <file> Manual UAT evidence file path."
  ].join("\n"));
}
