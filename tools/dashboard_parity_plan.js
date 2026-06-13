#!/usr/bin/env node

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const args = parseArgs(process.argv.slice(2));
const sampleLimit = positiveInteger(args.sampleLimit || args.limit, 10);
const outFile = args.out ? path.resolve(args.out) : null;
const firestoreDashboardBaseUrl = args.firestoreDashboardBaseUrl || "https://mydietitian.web.app/dashboard";
const gasDashboardBaseUrl = args.gasDashboardBaseUrl || "https://script.google.com/macros/s/AKfycbwDDjb0vMO6kA_8GDxC51PuDzBplDh1d1dx5NPOCbY_Ho5bQvK-W0QfiNL28WUA5fpMCA/exec";
const dashboardApiUrl = args.dashboardApiUrl || "https://asia-southeast1-mydietitian.cloudfunctions.net/getDashboardData";
const windows = parseWindows(args.windows || "7,30,90,365");

main();

function main() {
  const migration = runMigrationDryRun(sampleLimit);
  const readiness = migration.migrationReadiness || {};
  const users = readiness.sampleUsersForDashboardParity || [];
  const plan = {
    ok: Boolean(readiness.dataQuality?.okToPreviewImport) && users.length > 0,
    generatedAt: new Date().toISOString(),
    sourceSheetId: readiness.sheetId || null,
    totalPlannedDocuments: migration.total ?? null,
    countByCollection: migration.countByCollection || null,
    dataQuality: readiness.dataQuality || null,
    parityWindows: windows,
    sampleUsers: users.map((user) => buildUserPlan(user)),
    manualChecks: [
      "Open the GAS dashboard and Firestore dashboard for the same LINE user.",
      "Compare calories, protein, carbs, fat, fiber, burned calories, weight, body fat, and muscle for each parity window.",
      "Confirm recent meal/exercise/weight history ordering and date ranges match.",
      "Record pass/fail evidence in docs/MANUAL_UAT_EVIDENCE_TEMPLATE.md before switching dashboard links."
    ]
  };

  const json = JSON.stringify(plan, null, 2);
  console.log(json);

  if (outFile) {
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, `${renderMarkdown(plan)}\n`, "utf8");
  }

  if (!plan.ok) process.exit(1);
}

function runMigrationDryRun(limit) {
  const result = spawnSync(process.execPath, ["tools/migrate_sheet_to_firestore.js", "--sampleLimit", String(limit)], {
    cwd: process.cwd(),
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024
  });
  const output = `${result.stdout || ""}\n${result.stderr || ""}`;
  const json = parseLastJsonObject(output);
  if (result.status !== 0 || !json) {
    const spawnError = result.error ? `\nChild process error: ${result.error.message}` : "";
    throw new Error(`Unable to build dashboard parity plan from migration dry-run.${spawnError}\n${output.trim()}`);
  }
  return json;
}

function buildUserPlan(user) {
  const firestoreDashboardUrl = appendQuery(firestoreDashboardBaseUrl, { uid: user.userId });
  const gasDashboardUrl = appendQuery(gasDashboardBaseUrl, { uid: user.userId });
  return {
    userId: user.userId,
    name: user.name,
    activeSubscription: Boolean(user.activeSubscription),
    expiresAt: user.expiresAt || null,
    sourceCoverage: {
      tdee: user.tdee,
      macroPct: user.macroPct,
      mealRows: user.mealRows,
      exerciseRows: user.exerciseRows,
      weightRows: user.weightRows,
      firstLogAt: user.firstLogAt,
      lastLogAt: user.lastLogAt,
      latestWeightAt: user.latestWeightAt
    },
    links: {
      firestoreDashboardUrl,
      gasDashboardUrl
    },
    apiChecks: windows.map((days) => ({
      days,
      firestoreApiPayload: {
        method: "POST",
        url: dashboardApiUrl,
        body: { userId: user.userId, option: days }
      },
      compare: [
        "range.start/range.end/timezone",
        "stats.avgCal/stats.successDays/stats.totalDays",
        "daily calories/proteinG/carbsG/fatG/fiberG/burnedCalories",
        "bodyData weight/fat/muscle/devices",
        "history meals/exercises/weights counts and latest rows"
      ]
    }))
  };
}

function renderMarkdown(plan) {
  const lines = [
    "# Dashboard Parity Plan",
    "",
    `Generated: ${plan.generatedAt}`,
    `Source sheet: ${plan.sourceSheetId || "-"}`,
    `Total planned documents: ${plan.totalPlannedDocuments ?? "-"}`,
    `Data quality ready: ${plan.dataQuality?.okToPreviewImport ?? false}`,
    `Parity windows: ${plan.parityWindows.join(", ")} days`,
    "",
    "Use this after preview/final import and before changing LINE dashboard links from GAS to Firebase.",
    "",
    "## Sample Users",
    "",
    "| User | Active | Logs | Weights | Firestore dashboard | GAS dashboard |",
    "| --- | --- | --- | --- | --- | --- |"
  ];

  for (const user of plan.sampleUsers) {
    const coverage = user.sourceCoverage;
    lines.push([
      `${escapeTable(user.name)}<br>${user.userId}`,
      user.activeSubscription ? "yes" : "no",
      `meals=${coverage.mealRows}, exercise=${coverage.exerciseRows}<br>${coverage.firstLogAt || "-"} to ${coverage.lastLogAt || "-"}`,
      `${coverage.weightRows}<br>latest=${coverage.latestWeightAt || "-"}`,
      `[Firestore](${user.links.firestoreDashboardUrl})`,
      `[GAS](${user.links.gasDashboardUrl})`
    ].join(" | ").replace(/^/, "| ").concat(" |"));
  }

  lines.push(
    "",
    "## API Windows",
    "",
    "For each sample user, compare these windows against the GAS dashboard: " + plan.parityWindows.join(", ") + " days.",
    "",
    "Firestore API endpoint:",
    "",
    "```text",
    dashboardApiUrl,
    "```",
    "",
    "POST body template:",
    "",
    "```json",
    JSON.stringify({ userId: "{LINE_USER_ID}", option: 7 }, null, 2),
    "```",
    "",
    "## Manual Checks",
    ""
  );

  for (const check of plan.manualChecks) lines.push(`- ${check}`);

  return lines.join("\n");
}

function appendQuery(url, params) {
  const target = new URL(url);
  for (const [key, value] of Object.entries(params)) {
    target.searchParams.set(key, value);
  }
  return target.toString();
}

function parseWindows(value) {
  return String(value)
    .split(",")
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isInteger(item) && item > 0);
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
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

function escapeTable(value) {
  return String(value).replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");
}
