#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const args = parseArgs(process.argv.slice(2));
const indexesPath = path.resolve(args.file || "firestore.indexes.json");

const REQUIRED_INDEXES = [
  requiredIndex("mealLogs", [["userId", "ASCENDING"], ["loggedAt", "ASCENDING"]], "dashboard range meals asc"),
  requiredIndex("mealLogs", [["userId", "ASCENDING"], ["loggedAt", "DESCENDING"]], "latest meal and dashboard meals desc"),
  requiredIndex("exerciseLogs", [["userId", "ASCENDING"], ["loggedAt", "ASCENDING"]], "dashboard range exercise asc"),
  requiredIndex("exerciseLogs", [["userId", "ASCENDING"], ["loggedAt", "DESCENDING"]], "dashboard exercise desc"),
  requiredIndex("weightLogs", [["userId", "ASCENDING"], ["loggedAt", "ASCENDING"]], "dashboard range weights asc"),
  requiredIndex("weightLogs", [["userId", "ASCENDING"], ["loggedAt", "DESCENDING"]], "dashboard weights desc"),
  requiredIndex("paymentReviews", [["canonicalUserId", "ASCENDING"], ["status", "ASCENDING"], ["createdAt", "DESCENDING"]], "latest pending payment review"),
  requiredIndex("users", [["legacy.importRunId", "ASCENDING"]], "post-migration import verification"),
  requiredIndex("profiles", [["legacy.importRunId", "ASCENDING"]], "post-migration import verification"),
  requiredIndex("subscriptions", [["legacy.importRunId", "ASCENDING"]], "post-migration import verification"),
  requiredIndex("lineLinks", [["legacy.importRunId", "ASCENDING"]], "post-migration import verification"),
  requiredIndex("mealLogs", [["legacy.importRunId", "ASCENDING"]], "post-migration import verification"),
  requiredIndex("exerciseLogs", [["legacy.importRunId", "ASCENDING"]], "post-migration import verification"),
  requiredIndex("weightLogs", [["legacy.importRunId", "ASCENDING"]], "post-migration import verification"),
  requiredIndex("redeemCodes", [["legacy.importRunId", "ASCENDING"]], "post-migration import verification")
];

main();

function main() {
  const config = JSON.parse(fs.readFileSync(indexesPath, "utf8"));
  const actual = Array.isArray(config.indexes) ? config.indexes : [];
  const checks = REQUIRED_INDEXES.map((required) => {
    const builtIn = isBuiltInSingleFieldIndex(required);
    const match = builtIn || actual.find((index) => sameIndex(index, required));
    return {
      collectionGroup: required.collectionGroup,
      purpose: required.purpose,
      fields: required.fields,
      source: builtIn ? "built-in-single-field" : "configured-composite",
      ok: Boolean(match)
    };
  });
  const failures = checks.filter((check) => !check.ok);
  const report = {
    ok: failures.length === 0,
    generatedAt: new Date().toISOString(),
    indexesPath,
    required: REQUIRED_INDEXES.length,
    configured: actual.length,
    checks,
    failures
  };

  console.log(JSON.stringify(report, null, 2));
  if (failures.length) process.exit(1);
}

function requiredIndex(collectionGroup, fieldPairs, purpose) {
  return {
    collectionGroup,
    queryScope: "COLLECTION",
    fields: fieldPairs.map(([fieldPath, order]) => ({ fieldPath, order })),
    purpose
  };
}

function sameIndex(actual, required) {
  return actual.collectionGroup === required.collectionGroup &&
    actual.queryScope === required.queryScope &&
    sameFields(actual.fields, required.fields);
}

function isBuiltInSingleFieldIndex(required) {
  return required.fields.length === 1 && required.fields[0]?.order === "ASCENDING";
}

function sameFields(actualFields = [], requiredFields = []) {
  if (actualFields.length !== requiredFields.length) return false;
  return requiredFields.every((field, index) =>
    actualFields[index]?.fieldPath === field.fieldPath &&
    actualFields[index]?.order === field.order
  );
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
