#!/usr/bin/env node

const admin = require("firebase-admin");
const { spawnSync } = require("node:child_process");

const args = parseArgs(process.argv.slice(2));
const projectId = args.project || "mydietitian";
const serviceAccount = args.serviceAccount;
const smokeWrite = Boolean(args.smokeWrite);

const HOSTING_ORIGIN = "https://mydietitian.web.app";
const FUNCTIONS_BASE = "https://asia-southeast1-mydietitian.cloudfunctions.net";
const REQUIRED_AI_AGENTS = ["mealAnalysis", "exerciseAnalysis", "biaAnalysis", "coachConsultation"];
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

  if (smokeWrite) {
    await checkSettingsSmoke();
    await checkDashboardSmoke("test-readiness-audit");
  } else {
    record("settings smoke write", "skip", "Pass --smoke-write to create/update a test profile.");
  }

  await checkFirestoreConfig();
  await checkAiAgents();
  await checkSubscriptionPlans();
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

async function checkAiAgents() {
  const db = admin.firestore();
  const missing = [];
  const disabled = [];
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
  }
  record("aiAgents config", missing.length === 0 && disabled.length === 0 ? "pass" : "fail", `models=${JSON.stringify(models)} missing=${missing.join(",")} disabled=${disabled.join(",")}`);
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
  const result = spawnSync(process.execPath, ["tools/migrate_sheet_to_firestore.js", "--commit"], {
    cwd: process.cwd(),
    encoding: "utf8"
  });
  const output = `${result.stdout || ""}\n${result.stderr || ""}`;
  const locked = result.status !== 0 && output.includes("Refusing to write");
  record("migration write lock", locked ? "pass" : "fail", locked ? "write requires --confirmFinalMigration" : `status=${result.status}`);
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
