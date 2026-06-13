#!/usr/bin/env node

const admin = require("firebase-admin");
const fs = require("node:fs");
const path = require("node:path");

const args = parseArgs(process.argv.slice(2));
const projectId = args.project || "mydietitian";
const serviceAccount = args.serviceAccount;
const readinessPacketPath = args.readinessPacket ? path.resolve(args.readinessPacket) : null;
const readinessPacket = readinessPacketPath ? readJson(readinessPacketPath) : null;
const importRunId = args.importRunId || readinessPacket?.migrationSnapshot?.importManifest?.importRunId ||
  importRunIdFromFingerprint(readinessPacket?.migrationSnapshot?.sourceFingerprint?.value);

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

async function main() {
  if (!importRunId) {
    throw new Error("Pass --importRunId or --readinessPacket with migrationSnapshot.sourceFingerprint.");
  }

  initializeFirebase(projectId, serviceAccount);
  const db = admin.firestore();
  const manifestSnap = await db.collection("migrationRuns").doc(importRunId).get();
  const manifest = manifestSnap.exists ? manifestSnap.data() || {} : null;
  const expectedCounts = expectedCountsFrom(manifest, readinessPacket);
  const legacyCounts = {};

  for (const collection of Object.keys(expectedCounts)) {
    legacyCounts[collection] = await countQuery(
      db.collection(collection).where("legacy.importRunId", "==", importRunId)
    );
  }

  const checks = buildChecks({ manifest, expectedCounts, legacyCounts, readinessPacket });
  const failures = checks.filter((check) => !check.ok);
  const report = {
    ok: failures.length === 0,
    generatedAt: new Date().toISOString(),
    projectId,
    importRunId,
    manifestExists: Boolean(manifest),
    manifest: summarizeManifest(manifest),
    expectedCounts,
    legacyCounts,
    checks,
    failures
  };

  console.log(JSON.stringify(report, null, 2));
  if (failures.length) process.exit(1);
}

function buildChecks({ manifest, expectedCounts, legacyCounts, readinessPacket }) {
  const totalExpected = sumValues(expectedCounts);
  const totalLegacy = sumValues(legacyCounts);
  const checks = [
    {
      name: "manifest exists",
      ok: Boolean(manifest),
      details: manifest ? "found" : "missing"
    },
    {
      name: "manifest completed",
      ok: manifest?.status === "completed",
      details: `status=${manifest?.status || "missing"}`
    },
    {
      name: "written document total",
      ok: Number(manifest?.writtenDocuments ?? -1) === totalExpected,
      details: `written=${manifest?.writtenDocuments ?? "missing"} expected=${totalExpected}`
    },
    {
      name: "legacy provenance total",
      ok: totalLegacy === totalExpected,
      details: `legacy=${totalLegacy} expected=${totalExpected}`
    }
  ];

  for (const [collection, expected] of Object.entries(expectedCounts)) {
    checks.push({
      name: `legacy count ${collection}`,
      ok: legacyCounts[collection] === expected,
      details: `legacy=${legacyCounts[collection] ?? 0} expected=${expected}`
    });
  }

  if (readinessPacket) {
    const expectedFingerprint = readinessPacket.migrationSnapshot?.sourceFingerprint?.value || "";
    checks.push({
      name: "source fingerprint matches readiness packet",
      ok: Boolean(expectedFingerprint) && manifest?.sourceFingerprint?.value === expectedFingerprint,
      details: `manifest=${manifest?.sourceFingerprint?.value || "missing"} readiness=${expectedFingerprint || "missing"}`
    });
    checks.push({
      name: "planned total matches readiness packet",
      ok: Number(manifest?.totalPlannedDocuments ?? -1) === Number(readinessPacket.migrationSnapshot?.totalPlannedDocuments ?? -2),
      details: `manifest=${manifest?.totalPlannedDocuments ?? "missing"} readiness=${readinessPacket.migrationSnapshot?.totalPlannedDocuments ?? "missing"}`
    });
  }

  return checks;
}

function expectedCountsFrom(manifest, readinessPacket) {
  return manifest?.countByCollection || readinessPacket?.migrationSnapshot?.countByCollection || {};
}

function summarizeManifest(manifest) {
  if (!manifest) return null;
  return {
    status: manifest.status || null,
    importRunId: manifest.importRunId || null,
    sheetId: manifest.sheetId || null,
    sourceFingerprint: manifest.sourceFingerprint || null,
    readinessPacketGeneratedAt: manifest.readinessPacketGeneratedAt || null,
    migrationCommit: manifest.migrationCommit || null,
    totalPlannedDocuments: manifest.totalPlannedDocuments ?? null,
    writtenDocuments: manifest.writtenDocuments ?? null,
    countByCollection: manifest.countByCollection || null,
    startedAt: timestampToIso(manifest.startedAt),
    completedAt: timestampToIso(manifest.completedAt),
    failedAt: timestampToIso(manifest.failedAt),
    error: manifest.error || null
  };
}

async function countQuery(query) {
  if (typeof query.count === "function") {
    const snapshot = await query.count().get();
    return Number(snapshot.data().count || 0);
  }
  const snapshot = await query.get();
  return snapshot.size;
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

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function importRunIdFromFingerprint(value) {
  return value ? `google_sheet_${String(value).slice(0, 12)}` : "";
}

function sumValues(value) {
  return Object.values(value || {}).reduce((sum, item) => sum + Number(item || 0), 0);
}

function timestampToIso(value) {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate().toISOString();
  return value;
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
