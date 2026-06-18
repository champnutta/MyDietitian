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
const markdownOutFile = args.markdownOut || args["markdown-out"];

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
    pick: ["status", "amount", "days", "planId", "adminDecision", "lineMessageId", "reviewedBy", "reason"]
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
    pick: ["type", "planId", "days", "expiresAt", "adminLineUserId", "reason"]
  },
  {
    name: "subscriptions",
    fields: ["canonicalUserId", "userId"],
    timeFields: ["createdAt", "updatedAt", "lastApprovedAt"],
    pick: ["status", "entitlementType", "lifetime", "expiresAt", "lastApprovedDays", "lastApprovedPlanId", "lastApprovedBy"]
  },
  {
    name: "profiles",
    fields: ["canonicalUserId", "userId", "lineUserId"],
    timeFields: ["createdAt", "updatedAt"],
    pick: ["target", "expiresAt", "lifetime", "authVerified", "weightKg"]
  },
  {
    name: "profileEvents",
    fields: ["canonicalUserId", "userId", "lineUserId"],
    timeFields: ["createdAt"],
    pick: ["type", "status", "source", "target", "biaReportId"]
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
  },
  {
    name: "weightLogs",
    fields: ["canonicalUserId", "userId"],
    timeFields: ["createdAt", "loggedAt", "updatedAt"],
    pick: ["source", "weightKg", "bodyFatPct", "muscleMassKg", "deviceName"]
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
  if (markdownOutFile) {
    const fs = require("node:fs");
    const path = require("node:path");
    fs.mkdirSync(path.dirname(path.resolve(markdownOutFile)), { recursive: true });
    fs.writeFileSync(path.resolve(markdownOutFile), `${renderMarkdown(report)}\n`, "utf8");
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
    checklist("Food image", hasMealImageEvidence(summary), evidenceIds(summary, ["mealLogs", "aiRuns"]), "missing image mealLogs or completed image aiRuns"),
    checklist("Leftover image", hasMealAdjustment(summary), evidenceIds(summary, ["mealLogs", "aiRuns"]), "missing leftover adjustment in mealLogs.adjustments[]"),
    checklist("Payment slip image", hasPaymentReview(summary, "pending-admin-review"), evidenceIds(summary, ["paymentReviews", "subscriptionEvents"]), "missing pending paymentReviews evidence"),
    checklist("Admin approve", hasSubscriptionEvent(summary, "admin-approve") && count("subscriptions") > 0, evidenceIds(summary, ["subscriptionEvents", "subscriptions", "paymentReviews"]), "missing admin-approve subscriptionEvents or subscriptions update"),
    checklist("Admin reject", hasSubscriptionEvent(summary, "admin-reject") && hasPaymentReview(summary, "rejected"), evidenceIds(summary, ["subscriptionEvents", "paymentReviews"]), "missing admin-reject subscriptionEvents or rejected paymentReviews"),
    checklist("BIA image/PDF", count("biaReports") > 0 && (hasProfileEvent(summary, "bia-analysis") || count("weightLogs") > 0), evidenceIds(summary, ["biaReports", "profileEvents", "weightLogs"]), "missing biaReports plus bia-analysis/weight evidence"),
    checklist("BIA confirm", hasProfileEvent(summary, "target-update-confirmed") && hasProfileTarget(summary), evidenceIds(summary, ["profileEvents", "profiles"]), "missing target-update-confirmed profileEvents or profiles.target"),
    checklist("LIFF settings opens", count("profiles") > 0, evidenceIds(summary, ["profiles"]), "missing profile/settings write evidence"),
    checklist("LINE ID token sent", count("profileAuthEvents") > 0, evidenceIds(summary, ["profileAuthEvents"]), "missing profileAuthEvents")
  ];
}

function checklist(testCase, ok, presentText, missingText) {
  return {
    case: testCase,
    ok,
    evidence: ok ? presentText : missingText
  };
}

function latestFor(summary, collection) {
  return summary.find((item) => item.collection === collection)?.latest || [];
}

function hasMealImageEvidence(summary) {
  const mealLogs = latestFor(summary, "mealLogs");
  const aiRuns = latestFor(summary, "aiRuns");
  return mealLogs.some((item) => item.fields.inputType === "image") &&
    aiRuns.some((item) => item.fields.inputType === "image" && item.fields.status === "completed");
}

function hasMealAdjustment(summary) {
  const mealLogs = latestFor(summary, "mealLogs");
  return mealLogs.some((item) => Array.isArray(item.fields.adjustments) && item.fields.adjustments.length > 0);
}

function hasPaymentReview(summary, status) {
  return latestFor(summary, "paymentReviews").some((item) => item.fields.status === status);
}

function hasSubscriptionEvent(summary, type) {
  return latestFor(summary, "subscriptionEvents").some((item) => item.fields.type === type);
}

function hasProfileEvent(summary, type) {
  return latestFor(summary, "profileEvents").some((item) => item.fields.type === type);
}

function hasProfileTarget(summary) {
  return latestFor(summary, "profiles").some((item) => {
    const target = item.fields.target;
    return target && typeof target === "object" && Object.keys(target).length > 0;
  });
}

function evidenceIds(summary, collections) {
  return collections
    .map((collection) => {
      const ids = latestFor(summary, collection)
        .map((doc) => doc.id)
        .filter(Boolean)
        .slice(0, 3);
      return ids.length ? `${collection}: ${ids.join(", ")}` : null;
    })
    .filter(Boolean)
    .join("; ") || "present";
}

function renderMarkdown(report) {
  const lines = [
    "# Firestore UAT Evidence Summary",
    "",
    `Generated: ${report.generatedAt}`,
    `Project: ${report.projectId}`,
    `User: ${report.userId}`,
    `Window: last ${report.sinceHours} hours`,
    `Require all: ${report.requireAll ? "yes" : "no"}`,
    `Overall: ${report.requireAll ? (report.ok ? "pass" : "missing evidence") : "informational"}`,
    "",
    "## Checklist Hints",
    "",
    "| Case | Status | Evidence hint |",
    "| --- | --- | --- |"
  ];

  for (const hint of report.checklistHints) {
    lines.push(`| ${escapeTable(hint.case)} | ${hint.ok ? "pass" : "missing"} | ${escapeTable(hint.evidence)} |`);
  }

  lines.push(
    "",
    "## Latest Documents",
    "",
    "| Collection | Count | Latest document IDs | Evidence notes to copy |",
    "| --- | ---: | --- | --- |"
  );

  for (const item of report.summary) {
    const latestIds = item.latest.map((doc) => doc.id || "query-error").slice(0, 5).join(", ") || "-";
    const notes = item.latest.slice(0, 3).map((doc) => formatEvidenceNote(doc)).filter(Boolean).join("<br>") || "-";
    lines.push(`| ${item.collection} | ${item.count} | ${escapeTable(latestIds)} | ${escapeTable(notes)} |`);
  }

  if (report.missingHints.length) {
    lines.push("", "## Missing Before Pre-Migration Approval", "");
    for (const hint of report.missingHints) {
      lines.push(`- ${hint.case}: ${hint.evidence}`);
    }
  }

  lines.push(
    "",
    "## Evidence File Usage",
    "",
    "Copy the relevant latest document IDs and notes into `docs/MANUAL_UAT_EVIDENCE.md`. This report is supporting evidence only; the evidence checker still reads `docs/MANUAL_UAT_EVIDENCE.md` as the approval source."
  );

  return lines.join("\n");
}

function formatEvidenceNote(doc) {
  if (doc.error) return `error: ${doc.error}`;
  const fields = doc.fields || {};
  const parts = [
    doc.id ? `id=${doc.id}` : null,
    doc.lastTimestamp ? `time=${doc.lastTimestamp}` : null,
    fields.status ? `status=${stringifyBrief(fields.status)}` : null,
    fields.type ? `type=${stringifyBrief(fields.type)}` : null,
    fields.source ? `source=${stringifyBrief(fields.source)}` : null,
    fields.inputType ? `inputType=${stringifyBrief(fields.inputType)}` : null,
    fields.provider ? `provider=${stringifyBrief(fields.provider)}` : null,
    fields.model ? `model=${stringifyBrief(fields.model)}` : null,
    fields.planId ? `planId=${stringifyBrief(fields.planId)}` : null,
    fields.expiresAt ? `expiresAt=${stringifyBrief(fields.expiresAt)}` : null,
    fields.target ? `target=${stringifyBrief(fields.target)}` : null,
    fields.biaReportId ? `biaReportId=${stringifyBrief(fields.biaReportId)}` : null,
    typeof fields.fallbackUsed === "boolean" ? `fallbackUsed=${fields.fallbackUsed}` : null,
    Array.isArray(fields.adjustments) && fields.adjustments.length ? `adjustments=${fields.adjustments.length}` : null
  ].filter(Boolean);
  return parts.join("; ");
}

function stringifyBrief(value) {
  if (value == null) return "";
  if (typeof value === "object") return JSON.stringify(value).slice(0, 80);
  return String(value);
}

function escapeTable(value) {
  return String(value).replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");
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
