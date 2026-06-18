#!/usr/bin/env node

const admin = require("firebase-admin");

const args = parseArgs(process.argv.slice(2));
const projectId = args.project || "mydietitian";
const serviceAccount = args.serviceAccount || "C:\\Users\\champ\\AppData\\Roaming\\firebase\\znak_iiz_gmail.com_application_default_credentials.json";
const userId = args.user || args.userId || args.canonicalUserId || "";
const lineUserId = args.lineUserId || userId;
const sinceHours = positiveNumber(args.sinceHours || args["since-hours"], 24);
const limit = positiveInteger(args.limit, 8);
const requireAll = Boolean(args.requireAll || args["require-all"]);
const outFile = args.out;

const COLLECTIONS = [
  {
    name: "mealLogs",
    fields: ["canonicalUserId", "userId"],
    timeFields: ["createdAt", "loggedAt", "updatedAt"],
    pick: ["source", "inputType", "mealNameTh", "mealNameEn", "ai", "adjustments"]
  },
  {
    name: "aiRuns",
    fields: ["canonicalUserId", "userId", "lineUserId"],
    timeFields: ["createdAt", "completedAt", "failedAt"],
    pick: ["status", "source", "inputType", "provider", "model", "primaryProvider", "primaryModel", "fallbackUsed", "error"]
  },
  {
    name: "paymentReviews",
    fields: ["canonicalUserId", "userId", "lineUserId"],
    timeFields: ["createdAt", "updatedAt", "reviewedAt"],
    pick: ["status", "amount", "planId", "adminDecision", "lineMessageId"]
  },
  {
    name: "biaReports",
    fields: ["canonicalUserId", "userId", "lineUserId"],
    timeFields: ["createdAt", "updatedAt", "reportedAt"],
    pick: ["status", "source", "analysis", "confirmed"]
  },
  {
    name: "subscriptionEvents",
    fields: ["canonicalUserId", "userId", "lineUserId"],
    timeFields: ["createdAt"],
    pick: ["type", "planId", "days", "expiresAt", "adminLineUserId"]
  },
  {
    name: "profileEvents",
    fields: ["canonicalUserId", "userId", "lineUserId"],
    timeFields: ["createdAt"],
    pick: ["type", "status", "source"]
  },
  {
    name: "profileAuthEvents",
    fields: ["canonicalUserId", "userId", "lineUserId"],
    timeFields: ["createdAt"],
    pick: ["type", "status", "authVerified", "reason"]
  },
  {
    name: "exerciseLogs",
    fields: ["canonicalUserId", "userId"],
    timeFields: ["createdAt", "loggedAt"],
    pick: ["source", "activityName", "caloriesBurned", "ai"]
  }
];

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

async function main() {
  if (!userId) {
    throw new Error("Pass --user <canonical-or-line-user-id> for the staging LINE user you tested.");
  }

  initializeFirebase(projectId, serviceAccount);
  const db = admin.firestore();
  const sinceMs = Date.now() - sinceHours * 60 * 60 * 1000;
  const summary = [];

  for (const spec of COLLECTIONS) {
    const docs = await collectCollectionEvidence(db, spec, sinceMs);
    summary.push({
      collection: spec.name,
      count: docs.length,
      latest: docs.slice(0, limit)
    });
  }

  const checklistHints = buildChecklistHints(summary);
  const missingHints = checklistHints.filter((hint) => !hint.ok);
  const report = {
    ok: requireAll ? missingHints.length === 0 : true,
    projectId,
    userId,
    lineUserId,
    sinceHours,
    requireAll,
    generatedAt: new Date().toISOString(),
    summary,
    checklistHints,
    missingHints
  };

  const json = JSON.stringify(report, null, 2);
  console.log(json);
  if (outFile) {
    const fs = require("node:fs");
    const path = require("node:path");
    fs.mkdirSync(path.dirname(path.resolve(outFile)), { recursive: true });
    fs.writeFileSync(path.resolve(outFile), `${json}\n`, "utf8");
  }
  if (!report.ok) process.exit(1);
}

async function collectCollectionEvidence(db, spec, sinceMs) {
  const byId = new Map();
  const values = Array.from(new Set([userId, lineUserId].filter(Boolean)));

  for (const field of spec.fields) {
    for (const value of values) {
      try {
        const snap = await db.collection(spec.name).where(field, "==", value).limit(50).get();
        for (const doc of snap.docs) {
          const item = formatDoc(doc, spec);
          if (item.lastTimestampMs >= sinceMs) byId.set(doc.id, item);
        }
      } catch (error) {
        byId.set(`${field}:${value}:error`, {
          id: null,
          error: error.message || String(error),
          lastTimestamp: null,
          lastTimestampMs: 0,
          fields: {}
        });
      }
    }
  }

  return Array.from(byId.values())
    .sort((a, b) => b.lastTimestampMs - a.lastTimestampMs)
    .map(({ lastTimestampMs, ...item }) => item);
}

function formatDoc(doc, spec) {
  const data = doc.data() || {};
  const timestamps = spec.timeFields
    .map((field) => toDate(data[field]))
    .filter(Boolean)
    .sort((a, b) => b.getTime() - a.getTime());
  const latest = timestamps[0] || null;
  return {
    id: doc.id,
    lastTimestamp: latest ? latest.toISOString() : null,
    lastTimestampMs: latest ? latest.getTime() : 0,
    fields: Object.fromEntries(spec.pick.map((field) => [field, simplify(data[field])]))
  };
}

function buildChecklistHints(summary) {
  const count = (collection) => summary.find((item) => item.collection === collection)?.count || 0;
  return [
    checklist("Food image / text food", count("mealLogs") > 0 && count("aiRuns") > 0, "present", "missing mealLogs or aiRuns"),
    checklist("Leftover image", hasMealAdjustment(summary), "present", "missing leftover adjustment in mealLogs.adjustments[]"),
    checklist("Payment slip/admin review", count("paymentReviews") > 0, "present", "missing paymentReviews"),
    checklist("Admin approve/reject", count("subscriptionEvents") > 0, "present", "missing subscriptionEvents"),
    checklist("BIA image/PDF", count("biaReports") > 0, "present", "missing biaReports"),
    checklist("LIFF auth", count("profileAuthEvents") > 0, "present", "missing profileAuthEvents")
  ];
}

function checklist(testCase, ok, presentText, missingText) {
  return {
    case: testCase,
    ok,
    evidence: ok ? presentText : missingText
  };
}

function hasMealAdjustment(summary) {
  const mealLogs = summary.find((item) => item.collection === "mealLogs")?.latest || [];
  return mealLogs.some((item) => Array.isArray(item.fields.adjustments) && item.fields.adjustments.length > 0);
}

function toDate(value) {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function simplify(value) {
  if (value == null) return null;
  if (typeof value.toDate === "function") return value.toDate().toISOString();
  if (Array.isArray(value)) return value.slice(0, 3).map(simplify);
  if (typeof value === "object") {
    const out = {};
    for (const [key, entry] of Object.entries(value).slice(0, 8)) {
      out[key] = simplify(entry);
    }
    return out;
  }
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

function positiveInteger(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : fallback;
}

function positiveNumber(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
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
