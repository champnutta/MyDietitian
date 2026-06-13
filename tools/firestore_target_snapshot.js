#!/usr/bin/env node

const admin = require("firebase-admin");

const args = parseArgs(process.argv.slice(2));
const projectId = args.project || "mydietitian";
const serviceAccount = args.serviceAccount;

const TARGET_COLLECTIONS = [
  "users",
  "profiles",
  "subscriptions",
  "lineLinks",
  "authLinks",
  "mealLogs",
  "exerciseLogs",
  "weightLogs",
  "redeemCodes",
  "aiRuns",
  "paymentReviews",
  "biaReports",
  "coachConsultations",
  "profileEvents",
  "subscriptionEvents",
  "adminAuditLogs",
  "lineEvents",
  "lineEventDedup"
];

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

async function main() {
  initializeFirebase(projectId, serviceAccount);
  const db = admin.firestore();
  const collections = {};

  for (const collection of TARGET_COLLECTIONS) {
    const ref = db.collection(collection);
    const [total, legacyImported, testLike] = await Promise.all([
      countQuery(ref),
      countQuery(ref.where("legacy.importedFrom", "==", "google-sheet")),
      countTestLikeDocs(ref)
    ]);
    const productionLooking = Math.max(0, total - testLike - legacyImported);
    collections[collection] = { total, legacyImported, testLike, productionLooking };
  }

  const summary = summarizeCollections(collections);
  const report = {
    ok: true,
    projectId,
    generatedAt: new Date().toISOString(),
    collections,
    summary
  };

  console.log(JSON.stringify(report, null, 2));
}

async function countQuery(query) {
  if (typeof query.count === "function") {
    const snapshot = await query.count().get();
    return Number(snapshot.data().count || 0);
  }
  const snapshot = await query.get();
  return snapshot.size;
}

async function countTestLikeDocs(collectionRef) {
  const snapshot = await collectionRef.limit(500).get();
  let count = 0;
  snapshot.forEach((doc) => {
    const data = doc.data() || {};
    const id = doc.id.toLowerCase();
    const userId = String(data.userId || data.canonicalUserId || data.lineUserId || "").toLowerCase();
    if (id.startsWith("test") || userId.startsWith("test")) count += 1;
  });
  return count;
}

function summarizeCollections(collections) {
  const totals = Object.values(collections).reduce((acc, item) => {
    acc.total += item.total;
    acc.legacyImported += item.legacyImported;
    acc.testLike += item.testLike;
    acc.productionLooking += item.productionLooking;
    return acc;
  }, { total: 0, legacyImported: 0, testLike: 0, productionLooking: 0 });

  const warnings = buildWarnings(collections, totals);
  const riskLevel = warnings.some((warning) => warning.severity === "high")
    ? "high"
    : warnings.some((warning) => warning.severity === "medium")
      ? "medium"
      : "low";

  return {
    totalDocumentsInTrackedCollections: totals.total,
    legacyImportedDocuments: totals.legacyImported,
    testLikeDocumentsInFirst500PerCollection: totals.testLike,
    productionLookingDocumentsEstimate: totals.productionLooking,
    legacyImportAlreadyPresent: totals.legacyImported > 0,
    okToProceedBeforeMigration: riskLevel !== "high",
    riskLevel,
    warnings
  };
}

function buildWarnings(collections, totals) {
  const warnings = [];

  if (totals.legacyImported > 0) {
    warnings.push({
      severity: "high",
      type: "legacy-import-already-present",
      message: "Firestore already contains documents marked as imported from Google Sheet. Confirm whether this was a controlled preview/final import before writing again."
    });
  }

  for (const [collection, item] of Object.entries(collections)) {
    if (item.productionLooking <= 0) continue;
    warnings.push({
      severity: "medium",
      type: "production-looking-documents",
      collection,
      count: item.productionLooking,
      message: `${collection} has documents that do not look like test records or legacy imports in the sampled snapshot. Review before final migration.`
    });
  }

  return warnings;
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
