#!/usr/bin/env node

const admin = require("firebase-admin");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const args = parseArgs(process.argv.slice(2));
const projectId = args.project || "mydietitian";
const serviceAccount = args.serviceAccount;
const smokeWrite = Boolean(args.smokeWrite);
const lineChannelSecret = args.lineChannelSecret || args["line-channel-secret"] || process.env.LINE_CHANNEL_SECRET;

const HOSTING_ORIGIN = "https://mydietitian.web.app";
const FUNCTIONS_BASE = "https://asia-southeast1-mydietitian.cloudfunctions.net";
const REQUIRED_AI_AGENTS = ["mealAnalysis", "exerciseAnalysis", "biaAnalysis", "coachConsultation"];
const EXPECTED_GEMINI_MODEL = "gemini-3.5-flash";
const EXPECTED_ANTHROPIC_MODEL = "claude-sonnet-4-6";
const REQUIRED_PLANS = ["30d", "90d", "lifetime"];

const checks = [];

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

async function main() {
  initializeFirebase(projectId, serviceAccount);

  await checkHttp("health endpoint", `${FUNCTIONS_BASE}/health`, { expectStatus: 200, expectJsonOk: true });
  await checkHostingPage("LIFF settings page", `${HOSTING_ORIGIN}/settings`, ["MyDietitian setup", "SAVE_SETTINGS_URL", "X-Line-Id-Token"]);
  await checkHostingPage("Firestore dashboard page", `${HOSTING_ORIGIN}/dashboard?uid=test-readiness-audit`, ["Firestore dashboard", "DASHBOARD_URL", "mealHistory"]);
  await checkCors("saveSettingsFromWeb CORS", `${FUNCTIONS_BASE}/saveSettingsFromWeb`, "content-type,x-line-id-token");
  await checkCors("getDashboardData CORS", `${FUNCTIONS_BASE}/getDashboardData`, "content-type");
  await checkDashboardContract("test-readiness-audit", 7);

  if (smokeWrite) {
    await checkSettingsSmoke();
    await checkDashboardSmoke("test-readiness-audit");
  } else {
    record("settings smoke write", "skip", "Pass --smoke-write to create/update a test profile.");
  }

  await checkFirestoreConfig();
  await checkDashboardBridgeGuard();
  await checkLegacyGasDashboardBridge();
  await checkAiAgents();
  await checkSubscriptionPlans();
  checkLineUatDryRunReport();
  checkSignedLineWebhookContract();
  checkFirestoreIndexCoverage();
  checkMigrationDryRunMapping();
  checkMigrationWriteLock();

  printSummary();
}

async function checkHttp(name, url, options = {}) {
  try {
    const response = await fetch(url, { method: options.method || "GET", headers: options.headers, body: options.body });
    const text = await response.text();
    const statusOk = response.status === (options.expectStatus || 200);
    let jsonOk = true;
    if (options.expectJsonOk) {
      const json = parseMaybeJson(text);
      jsonOk = Boolean(json?.ok);
    }
    record(name, statusOk && jsonOk ? "pass" : "fail", `status=${response.status}`);
  } catch (error) {
    record(name, "fail", error.message || String(error));
  }
}

async function checkHostingPage(name, url, requiredText) {
  try {
    const response = await fetch(url);
    const text = await response.text();
    const missing = requiredText.filter((item) => !text.includes(item));
    record(name, response.ok && missing.length === 0 ? "pass" : "fail", missing.length ? `missing=${missing.join(",")}` : `status=${response.status}`);
  } catch (error) {
    record(name, "fail", error.message || String(error));
  }
}

async function checkCors(name, url, requestHeaders) {
  try {
    const response = await fetch(url, {
      method: "OPTIONS",
      headers: {
        Origin: HOSTING_ORIGIN,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": requestHeaders
      }
    });
    const allowOrigin = response.headers.get("access-control-allow-origin");
    const allowHeaders = response.headers.get("access-control-allow-headers") || "";
    const ok = response.status === 204 &&
      allowOrigin === HOSTING_ORIGIN &&
      requestHeaders.split(",").every((header) => allowHeaders.toLowerCase().includes(header.toLowerCase()));
    record(name, ok ? "pass" : "fail", `status=${response.status}; origin=${allowOrigin}; headers=${allowHeaders}`);
  } catch (error) {
    record(name, "fail", error.message || String(error));
  }
}

async function checkSettingsSmoke() {
  const body = {
    userId: "test-readiness-audit",
    displayName: "Readiness Audit",
    config: {
      mode: "custom",
      tdee: 2000,
      p: 40,
      c: 30,
      f: 30,
      fiberG: 25
    }
  };
  try {
    const response = await fetch(`${FUNCTIONS_BASE}/saveSettingsFromWeb`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: HOSTING_ORIGIN },
      body: JSON.stringify(body)
    });
    const json = await response.json();
    record("settings smoke write", response.ok && json.ok && json.canonicalUserId === body.userId ? "pass" : "fail", `status=${response.status}; canonical=${json.canonicalUserId}`);
  } catch (error) {
    record("settings smoke write", "fail", error.message || String(error));
  }
}

async function checkDashboardSmoke(userId) {
  try {
    const response = await fetch(`${FUNCTIONS_BASE}/getDashboardData`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: HOSTING_ORIGIN },
      body: JSON.stringify({ userId, option: 7 })
    });
    const json = await response.json();
    const ok = response.ok && json.ok && Array.isArray(json.labels) && json.profile && json.stats;
    record("dashboard API smoke", ok ? "pass" : "fail", `status=${response.status}; labels=${json.labels?.length ?? 0}`);
  } catch (error) {
    record("dashboard API smoke", "fail", error.message || String(error));
  }
}

async function checkDashboardContract(userId, option) {
  try {
    const response = await fetch(`${FUNCTIONS_BASE}/getDashboardData`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: HOSTING_ORIGIN },
      body: JSON.stringify({ userId, option })
    });
    const json = await response.json();
    const failures = validateDashboardContract(json, option).filter((check) => !check.ok);
    const ok = response.ok && failures.length === 0;
    record(
      "dashboard contract",
      ok ? "pass" : "fail",
      ok ? `status=${response.status}; labels=${json.labels?.length ?? 0}` : `status=${response.status}; failures=${failures.map((item) => item.name).join(",")}`
    );
  } catch (error) {
    record("dashboard contract", "fail", error.message || String(error));
  }
}

function validateDashboardContract(data, expectedDays) {
  const labels = Array.isArray(data?.labels) ? data.labels : [];
  const expectedLength = Number.isFinite(expectedDays) && expectedDays > 0 ? expectedDays : labels.length;
  return [
    { name: "ok flag", ok: data?.ok === true },
    { name: "canonical user id", ok: typeof data?.canonicalUserId === "string" && data.canonicalUserId.length > 0 },
    { name: "range", ok: isIsoDate(data?.range?.start) && isIsoDate(data?.range?.end) && data?.range?.timezone === "Asia/Bangkok" },
    { name: "profile target", ok: isFiniteNumber(data?.profile?.target?.cal) && isFiniteNumber(data?.profile?.target?.p) },
    { name: "current object", ok: data?.current && typeof data.current === "object" },
    { name: "labels length", ok: labels.length === expectedLength },
    { name: "calories length", ok: sameLength(data?.calories, labels) },
    { name: "tdeeLine length", ok: sameLength(data?.tdeeLine, labels) },
    { name: "macro p length", ok: sameLength(data?.macros?.p, labels) },
    { name: "macro c length", ok: sameLength(data?.macros?.c, labels) },
    { name: "macro f length", ok: sameLength(data?.macros?.f, labels) },
    { name: "macro fiber length", ok: sameLength(data?.macros?.fib, labels) },
    { name: "body weight length", ok: sameLength(data?.bodyData?.weight, labels) },
    { name: "body fat length", ok: sameLength(data?.bodyData?.fat, labels) },
    { name: "body muscle length", ok: sameLength(data?.bodyData?.muscle, labels) },
    { name: "body devices length", ok: sameLength(data?.bodyData?.devices, labels) },
    { name: "stats", ok: isFiniteNumber(data?.stats?.avgCal) && isFiniteNumber(data?.stats?.totalDays) && isFiniteNumber(data?.stats?.successDays) },
    { name: "daily length", ok: sameLength(data?.daily, labels) },
    { name: "daily shape", ok: Array.isArray(data?.daily) && data.daily.every(isDailyRow) },
    { name: "history meals array", ok: Array.isArray(data?.history?.meals) },
    { name: "history exercises array", ok: Array.isArray(data?.history?.exercises) },
    { name: "history weights array", ok: Array.isArray(data?.history?.weights) },
    { name: "history adjustments array", ok: Array.isArray(data?.history?.adjustments) }
  ];
}

function sameLength(value, labels) {
  return Array.isArray(value) && value.length === labels.length;
}

function isDailyRow(row) {
  return row &&
    typeof row.date === "string" &&
    isFiniteNumber(row.calories) &&
    isFiniteNumber(row.proteinG) &&
    isFiniteNumber(row.carbsG) &&
    isFiniteNumber(row.fatG) &&
    isFiniteNumber(row.fiberG) &&
    isFiniteNumber(row.burnedCalories) &&
    isFiniteNumber(row.dynamicTargetCalories) &&
    isFiniteNumber(row.remainingCalories);
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function isIsoDate(value) {
  return typeof value === "string" && !Number.isNaN(new Date(value).getTime());
}

async function checkFirestoreConfig() {
  const db = admin.firestore();
  const snap = await db.collection("appConfig").doc("runtime").get();
  if (!snap.exists) {
    record("appConfig/runtime", "fail", "missing");
    return;
  }
  const data = snap.data() || {};
  const requiredUrls = ["legacyGasDashboardUrl", "liffSettingsUrl", "paymentQrImage"];
  const invalid = requiredUrls.filter((key) => !isHttpsUrl(data[key]));
  const readyFlag = data.productionLineWebhookReady === false;
  record("appConfig/runtime", invalid.length === 0 && readyFlag ? "pass" : "fail", invalid.length ? `invalid=${invalid.join(",")}` : "productionLineWebhookReady=false");
}

async function checkDashboardBridgeGuard() {
  const db = admin.firestore();
  const snap = await db.collection("appConfig").doc("runtime").get();
  if (!snap.exists) {
    record("dashboard bridge guard", "fail", "appConfig/runtime missing");
    return;
  }

  const data = snap.data() || {};
  const dashboardUrl = String(data.legacyGasDashboardUrl || "");
  const pointsToGas = dashboardUrl.includes("script.google.com/macros/");
  const pointsToFirestorePreview = dashboardUrl.includes("mydietitian.web.app/dashboard");
  record(
    "dashboard bridge guard",
    pointsToGas && !pointsToFirestorePreview ? "pass" : "fail",
    pointsToGas
      ? "legacyGasDashboardUrl still points to GAS before migration"
      : `legacyGasDashboardUrl must remain GAS before data migration; current=${dashboardUrl || "missing"}`
  );
}

async function checkLegacyGasDashboardBridge() {
  const db = admin.firestore();
  const snap = await db.collection("appConfig").doc("runtime").get();
  if (!snap.exists) {
    record("legacy GAS dashboard bridge", "fail", "appConfig/runtime missing");
    return;
  }

  const dashboardUrl = String(snap.data()?.legacyGasDashboardUrl || "");
  if (!dashboardUrl) {
    record("legacy GAS dashboard bridge", "fail", "legacyGasDashboardUrl missing");
    return;
  }

  try {
    const target = new URL(dashboardUrl);
    target.searchParams.set("uid", "test-readiness-audit");
    const response = await fetch(target.toString(), { redirect: "follow" });
    const reachable = response.status >= 200 && response.status < 400;
    record(
      "legacy GAS dashboard bridge",
      reachable ? "pass" : "fail",
      `status=${response.status}; url=${target.origin}${target.pathname}`
    );
  } catch (error) {
    record("legacy GAS dashboard bridge", "fail", error.message || String(error));
  }
}

async function checkAiAgents() {
  const db = admin.firestore();
  const missing = [];
  const disabled = [];
  const misconfigured = [];
  const models = {};
  for (const id of REQUIRED_AI_AGENTS) {
    const snap = await db.collection("aiAgents").doc(id).get();
    if (!snap.exists) {
      missing.push(id);
      continue;
    }
    const data = snap.data() || {};
    if (data.enabled !== true) disabled.push(id);
    models[id] = `${data.provider || "unknown"}/${data.model || "unknown"}`;
    const fallback = Array.isArray(data.fallbacks)
      ? data.fallbacks.find((item) => item?.provider === "anthropic")
      : null;
    const primaryOk = data.provider === "gemini" &&
      data.model === EXPECTED_GEMINI_MODEL &&
      Number(data.maxAttempts) === 1;
    const fallbackOk = Boolean(fallback) &&
      fallback.model === EXPECTED_ANTHROPIC_MODEL &&
      Number(fallback.maxAttempts) === 1;
    if (!primaryOk || !fallbackOk) misconfigured.push(id);
  }
  record(
    "aiAgents config",
    missing.length === 0 && disabled.length === 0 && misconfigured.length === 0 ? "pass" : "fail",
    `models=${JSON.stringify(models)} expectedPrimary=gemini/${EXPECTED_GEMINI_MODEL} expectedFallback=anthropic/${EXPECTED_ANTHROPIC_MODEL} missing=${missing.join(",")} disabled=${disabled.join(",")} misconfigured=${misconfigured.join(",")}`
  );
}

async function checkSubscriptionPlans() {
  const db = admin.firestore();
  const missing = [];
  for (const id of REQUIRED_PLANS) {
    const snap = await db.collection("subscriptionPlans").doc(id).get();
    if (!snap.exists) missing.push(id);
  }
  record("subscriptionPlans config", missing.length === 0 ? "pass" : "fail", missing.length ? `missing=${missing.join(",")}` : REQUIRED_PLANS.join(","));
}

function checkMigrationWriteLock() {
  const missingFinalFlag = spawnSync(process.execPath, ["tools/migrate_sheet_to_firestore.js", "--commit"], {
    cwd: process.cwd(),
    encoding: "utf8"
  });
  const missingFinalFlagOutput = `${missingFinalFlag.stdout || ""}\n${missingFinalFlag.stderr || ""}`;
  const finalFlagLocked = missingFinalFlag.status !== 0 && missingFinalFlagOutput.includes("Refusing to write");

  const missingConfirmText = spawnSync(process.execPath, ["tools/migrate_sheet_to_firestore.js", "--commit", "--confirmFinalMigration"], {
    cwd: process.cwd(),
    encoding: "utf8"
  });
  const missingConfirmTextOutput = `${missingConfirmText.stdout || ""}\n${missingConfirmText.stderr || ""}`;
  const confirmTextLocked = missingConfirmText.status !== 0 && missingConfirmTextOutput.includes("--confirmText FINAL_MIGRATION_MYDIETITIAN");
  const missingReadinessPacket = spawnSync(process.execPath, ["tools/migrate_sheet_to_firestore.js", "--commit", "--confirmFinalMigration", "--confirmText", "FINAL_MIGRATION_MYDIETITIAN"], {
    cwd: process.cwd(),
    encoding: "utf8"
  });
  const missingReadinessPacketOutput = `${missingReadinessPacket.stdout || ""}\n${missingReadinessPacket.stderr || ""}`;
  const readinessPacketLocked = missingReadinessPacket.status !== 0 && missingReadinessPacketOutput.includes("--readinessPacket");
  const staleReadinessPacket = checkStaleReadinessPacketLock();

  const locked = finalFlagLocked && confirmTextLocked && readinessPacketLocked && staleReadinessPacket.locked;
  record(
    "migration write lock",
    locked ? "pass" : "fail",
    locked
      ? "write requires --confirmFinalMigration, typed --confirmText, fresh readiness packet, and post-migration verification commands"
      : `finalFlagLocked=${finalFlagLocked}; confirmTextLocked=${confirmTextLocked}; readinessPacketLocked=${readinessPacketLocked}; staleReadinessPacketLocked=${staleReadinessPacket.locked}; staleReason=${staleReadinessPacket.reason}`
  );
}

function checkStaleReadinessPacketLock() {
  const stalePacketPath = path.join(os.tmpdir(), `mydietitian-stale-readiness-${Date.now()}.json`);
  fs.writeFileSync(stalePacketPath, JSON.stringify(buildStaleReadyPacket(), null, 2), "utf8");
  try {
    const result = spawnSync(process.execPath, [
      "tools/migrate_sheet_to_firestore.js",
      "--sheetId", "guard-test-no-write",
      "--commit",
      "--confirmFinalMigration",
      "--confirmText", "FINAL_MIGRATION_MYDIETITIAN",
      "--readinessPacket", stalePacketPath
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
      maxBuffer: 5 * 1024 * 1024
    });
    const output = `${result.stdout || ""}\n${result.stderr || ""}`;
    return {
      locked: result.status !== 0 && output.includes("post-migration verification commands"),
      reason: output.trim().split(/\r?\n/).slice(-1)[0] || `status=${result.status}`
    };
  } finally {
    try {
      fs.unlinkSync(stalePacketPath);
    } catch {
      // Best-effort cleanup for local temp guard fixture.
    }
  }
}

function buildStaleReadyPacket() {
  return {
    packetType: "final-migration-readiness-packet",
    schemaVersion: 1,
    ok: true,
    generatedAt: new Date().toISOString(),
    projectId,
    decision: {
      status: "ready-for-final-data-migration-window",
      readyForDataMigrationWindow: true,
      blockers: []
    },
    automated: {
      preCutoverOk: true,
      noSkippedChecks: true,
      skippedChecks: [],
      checks: [
        "pre-migration audit",
        "migration dry-run",
        "dashboard contract",
        "dashboard parity plan",
        "LINE UAT dry-run",
        "runtime cutover guard",
        "Firestore target snapshot"
      ].map((name) => ({ name, ok: true }))
    },
    evidenceCheck: {
      ok: true,
      evidenceFile: "docs/MANUAL_UAT_EVIDENCE.md"
    },
    manualGates: [
      "Real LINE media UAT",
      "Real LIFF auth UAT",
      "Rollback plan reviewed",
      "Security Preflight",
      "Owner approval for migration window"
    ].map((label) => ({ label, pass: true })),
    migrationSnapshot: {
      totalPlannedDocuments: 1,
      dataQuality: { okToPreviewImport: true },
      sourceFingerprint: {
        algorithm: "sha256",
        value: "a".repeat(64),
        sheetId: "guard-test-no-write"
      },
      firestoreTargetSnapshot: {
        legacyImportAlreadyPresent: false,
        okToProceedBeforeMigration: true,
        riskLevel: "low"
      }
    }
  };
}

function checkMigrationDryRunMapping() {
  const result = spawnSync(process.execPath, ["tools/migrate_sheet_to_firestore.js", "--sampleLimit", "1"], {
    cwd: process.cwd(),
    encoding: "utf8"
  });

  if (result.status !== 0) {
    record("migration dry-run mapping", "fail", `status=${result.status}; ${result.stderr || result.stdout}`);
    return;
  }

  const json = parseFirstJsonObject(result.stdout || "");
  const counts = json?.countByCollection || {};
  const requiredCollections = ["users", "profiles", "subscriptions", "lineLinks", "mealLogs", "weightLogs", "redeemCodes"];
  const missing = requiredCollections.filter((collection) => !counts[collection]);
  const hasExerciseField = Object.prototype.hasOwnProperty.call(counts, "exerciseLogs");
  const readinessOk = json?.migrationReadiness?.dataQuality?.okToPreviewImport === true;
  const ok = missing.length === 0 && hasExerciseField && readinessOk;

  record(
    "migration dry-run mapping",
    ok ? "pass" : "fail",
    ok
      ? `planned=${json.total}; users=${counts.users}; meals=${counts.mealLogs}; exercise=${counts.exerciseLogs || 0}`
      : `missing=${missing.join(",")}; hasExercise=${hasExerciseField}; readinessOk=${readinessOk}`
  );
}

function checkFirestoreIndexCoverage() {
  const result = spawnSync(process.execPath, ["tools/firestore_index_coverage_check.js"], {
    cwd: process.cwd(),
    encoding: "utf8"
  });

  if (result.status !== 0) {
    record("Firestore index coverage", "fail", `status=${result.status}; ${result.stderr || result.stdout}`);
    return;
  }

  const json = parseFirstJsonObject(result.stdout || "");
  record(
    "Firestore index coverage",
    json?.ok === true ? "pass" : "fail",
    `required=${json?.required ?? "unknown"}; configured=${json?.configured ?? "unknown"}`
  );
}

function checkLineUatDryRunReport() {
  const result = spawnSync(process.execPath, ["tools/line_staging_uat_report.js", "--secret", "audit-dummy-secret"], {
    cwd: process.cwd(),
    encoding: "utf8"
  });

  if (result.status !== 0) {
    record("LINE UAT dry-run report", "fail", `status=${result.status}; ${result.stderr || result.stdout}`);
    return;
  }

  const json = parseFirstJsonObject(result.stdout || "");
  const failed = Number(json?.summary?.textScenarioFailed ?? 999);
  const passed = Number(json?.summary?.textScenarioPassed ?? 0);
  const realLineRequired = Number(json?.summary?.realLineRequiredCount ?? 0);
  const ok = json?.ok === true && failed === 0 && passed >= 13 && realLineRequired >= 5;
  record(
    "LINE UAT dry-run report",
    ok ? "pass" : "fail",
    `textPassed=${passed}; textFailed=${failed}; realLineRequired=${realLineRequired}`
  );
}

function checkSignedLineWebhookContract() {
  if (!lineChannelSecret) {
    record("signed LINE webhook contract", "skip", "Set LINE_CHANNEL_SECRET in the environment to verify the deployed endpoint signature contract.");
    return;
  }

  const result = spawnSync(process.execPath, [
    "tools/signed_line_webhook_test.js",
    "--scenario", "text",
    "--user", "U_READINESS_CONTRACT_TEST",
    "--webhook-dry-run"
  ], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      LINE_CHANNEL_SECRET: lineChannelSecret
    }
  });

  const json = parseFirstJsonObject(result.stdout || "");
  const ok = result.status === 0 &&
    json?.ok === true &&
    json?.mode === "line-webhook-contract-dry-run" &&
    json?.response?.mode === "line-webhook-contract-dry-run" &&
    json?.response?.received === 1;

  record(
    "signed LINE webhook contract",
    ok ? "pass" : "fail",
    ok
      ? `status=${json.status}; received=${json.response.received}`
      : `status=${result.status}; ${result.stderr || result.stdout}`
  );
}

function parseFirstJsonObject(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  return parseMaybeJson(text.slice(start, end + 1));
}

function initializeFirebase(projectId, serviceAccountPath) {
  if (admin.apps.length) return;

  if (serviceAccountPath) {
    const credentialJson = require(serviceAccountPath);
    if (!credentialJson.project_id) {
      process.env.GOOGLE_APPLICATION_CREDENTIALS = serviceAccountPath;
      admin.initializeApp({
        credential: admin.credential.applicationDefault(),
        projectId
      });
      return;
    }

    admin.initializeApp({
      credential: admin.credential.cert(credentialJson),
      projectId
    });
    return;
  }

  admin.initializeApp({ projectId });
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--smoke-write") {
      out.smokeWrite = true;
      continue;
    }
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) {
        out[key] = true;
      } else {
        out[key] = value;
        i += 1;
      }
    }
  }
  return out;
}

function record(name, status, details) {
  checks.push({ name, status, details });
  const marker = status === "pass" ? "PASS" : status === "skip" ? "SKIP" : "FAIL";
  console.log(`${marker} ${name}: ${details}`);
}

function printSummary() {
  const failed = checks.filter((check) => check.status === "fail");
  const skipped = checks.filter((check) => check.status === "skip");
  console.log(JSON.stringify({
    ok: failed.length === 0,
    passed: checks.filter((check) => check.status === "pass").length,
    failed: failed.length,
    skipped: skipped.length,
    failures: failed
  }, null, 2));
  if (failed.length) process.exit(1);
}

function parseMaybeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function isHttpsUrl(value) {
  try {
    return new URL(String(value)).protocol === "https:";
  } catch {
    return false;
  }
}
