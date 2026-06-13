#!/usr/bin/env node

const admin = require("firebase-admin");

const args = parseArgs(process.argv.slice(2));
const projectId = args.project || "mydietitian";
const serviceAccount = args.serviceAccount;

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

async function main() {
  initializeFirebase(projectId, serviceAccount);
  const db = admin.firestore();
  const snap = await db.collection("appConfig").doc("runtime").get();
  const data = snap.exists ? snap.data() || {} : null;
  const checks = buildChecks(data);
  const failures = checks.filter((check) => !check.ok);
  const report = {
    ok: failures.length === 0,
    generatedAt: new Date().toISOString(),
    projectId,
    runtimeExists: Boolean(data),
    summary: {
      productionLineWebhookReady: data?.productionLineWebhookReady ?? null,
      legacyGasDashboardUrlHost: urlHost(data?.legacyGasDashboardUrl),
      liffSettingsUrlHost: urlHost(data?.liffSettingsUrl),
      paymentQrImageHost: urlHost(data?.paymentQrImage)
    },
    checks,
    failures
  };

  console.log(JSON.stringify(report, null, 2));
  if (failures.length) process.exit(1);
}

function buildChecks(data) {
  if (!data) {
    return [{
      name: "appConfig/runtime exists",
      ok: false,
      details: "missing"
    }];
  }

  const dashboardUrl = String(data.legacyGasDashboardUrl || "");
  return [
    {
      name: "production webhook flag remains locked",
      ok: data.productionLineWebhookReady === false,
      details: `productionLineWebhookReady=${String(data.productionLineWebhookReady)}`
    },
    {
      name: "legacy dashboard bridge remains GAS",
      ok: dashboardUrl.includes("script.google.com/macros/") && !dashboardUrl.includes("mydietitian.web.app/dashboard"),
      details: dashboardUrl || "missing"
    },
    {
      name: "LIFF settings URL is supported",
      ok: isSupportedLiffSettingsUrl(data.liffSettingsUrl),
      details: String(data.liffSettingsUrl || "missing")
    },
    {
      name: "payment QR image URL is HTTPS",
      ok: isHttpsUrl(data.paymentQrImage),
      details: String(data.paymentQrImage || "missing")
    }
  ];
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

function isHttpsUrl(value) {
  try {
    return new URL(String(value)).protocol === "https:";
  } catch {
    return false;
  }
}

function isSupportedLiffSettingsUrl(value) {
  try {
    const url = new URL(String(value));
    return url.protocol === "https:" &&
      (url.host === "liff.line.me" || (url.host === "mydietitian.web.app" && url.pathname === "/settings"));
  } catch {
    return false;
  }
}

function urlHost(value) {
  try {
    return new URL(String(value)).host;
  } catch {
    return null;
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
