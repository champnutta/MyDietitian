#!/usr/bin/env node

const admin = require("firebase-admin");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_SHEET_ID = "1Yf1yxbBbV7S1nCCtxuSOC1YIdiirFbx3GKKLUv_AUPI";

const args = parseArgs(process.argv.slice(2));
const projectId = args.project || "mydietitian";
const sheetId = args.sheetId || DEFAULT_SHEET_ID;
const commit = Boolean(args.commit);
const finalMigrationConfirmed = Boolean(args.confirmFinalMigration);
const finalConfirmationText = "FINAL_MIGRATION_MYDIETITIAN";
const readinessPacketMaxAgeMs = 6 * 60 * 60 * 1000;
const requiredReadinessCheckNames = [
  "pre-migration audit",
  "migration dry-run",
  "dashboard contract",
  "dashboard parity plan",
  "LINE UAT dry-run",
  "runtime cutover guard",
  "Firestore target snapshot"
];
const requiredManualGateLabels = [
  "Real LINE media UAT",
  "Real LIFF auth UAT",
  "Rollback plan reviewed",
  "Owner approval for migration window"
];
const sampleLimit = positiveInteger(args.sampleLimit, 5);

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

async function main() {
  let readinessPacket = null;
  if (!commit) {
    console.log("DRY RUN: no Firestore writes will be performed. Pass --commit to write.");
  } else if (!finalMigrationConfirmed) {
    throw new Error(
      "Refusing to write. Data migration is reserved for final production cutover. " +
      `Pass --commit --confirmFinalMigration --confirmText ${finalConfirmationText} only during the approved final migration window.`
    );
  } else if (args.confirmText !== finalConfirmationText) {
    throw new Error(
      `Refusing to write. Pass --confirmText ${finalConfirmationText} only during the approved final migration window.`
    );
  } else {
    readinessPacket = validateFinalMigrationReadinessPacket(args.readinessPacket, projectId);
  }

  if (commit) initializeFirebase(projectId, args.serviceAccount);

  const workbook = await fetchWorkbook(sheetId);
  const planned = planMigration(workbook);
  const report = buildReadinessReport(workbook, planned, sampleLimit);
  if (commit) validateCurrentSourceFingerprint(readinessPacket, report);
  const importManifest = buildImportManifest(report, planned, readinessPacket);

  printSummary(planned, report, importManifest);

  if (commit) {
    await writePlannedDocuments(planned, importManifest);
  }
}

function validateFinalMigrationReadinessPacket(readinessPacketPath, expectedProjectId) {
  if (!readinessPacketPath) {
    throw new Error(
      "Refusing to write. Pass --readinessPacket pointing to a JSON packet with decision.status=ready-for-final-data-migration-window."
    );
  }

  let packet;
  try {
    packet = require(require("node:path").resolve(readinessPacketPath));
  } catch (error) {
    throw new Error(`Refusing to write. Unable to read --readinessPacket: ${error.message || String(error)}`);
  }

  const generatedAt = new Date(packet?.generatedAt || "");
  const generatedAtOk = !Number.isNaN(generatedAt.getTime()) &&
    Date.now() - generatedAt.getTime() >= 0 &&
    Date.now() - generatedAt.getTime() <= readinessPacketMaxAgeMs;
  const blockers = Array.isArray(packet?.decision?.blockers) ? packet.decision.blockers : [];
  const manualGates = Array.isArray(packet?.manualGates) ? packet.manualGates : [];
  const automatedChecks = Array.isArray(packet?.automated?.checks) ? packet.automated.checks : [];
  const firestoreTarget = packet?.migrationSnapshot?.firestoreTargetSnapshot || {};
  const sourceFingerprint = packet?.migrationSnapshot?.sourceFingerprint || {};
  const automatedCheckNames = automatedChecks.map((check) => check.name);
  const manualGateLabels = manualGates.map((gate) => gate.label);

  const ready = packet?.packetType === "final-migration-readiness-packet" &&
    packet?.schemaVersion === 1 &&
    packet?.projectId === expectedProjectId &&
    generatedAtOk &&
    packet?.decision?.readyForDataMigrationWindow === true &&
    packet?.decision?.status === "ready-for-final-data-migration-window" &&
    blockers.length === 0 &&
    packet?.evidenceCheck?.ok === true &&
    Boolean(packet?.evidenceCheck?.evidenceFile) &&
    requiredManualGateLabels.every((label) => manualGateLabels.includes(label)) &&
    manualGates.every((gate) => gate.pass === true) &&
    packet?.automated?.preCutoverOk === true &&
    requiredReadinessCheckNames.every((name) => automatedCheckNames.includes(name)) &&
    automatedChecks.every((check) => check.ok === true) &&
    packet?.migrationSnapshot?.dataQuality?.okToPreviewImport === true &&
    Number(packet?.migrationSnapshot?.totalPlannedDocuments || 0) > 0 &&
    sourceFingerprint.algorithm === "sha256" &&
    typeof sourceFingerprint.value === "string" &&
    sourceFingerprint.value.length === 64 &&
    typeof sourceFingerprint.sheetId === "string" &&
    firestoreTarget.legacyImportAlreadyPresent === false &&
    firestoreTarget.okToProceedBeforeMigration === true &&
    firestoreTarget.riskLevel !== "high";

  if (!ready) {
    throw new Error(
      "Refusing to write. Readiness packet must be generated by migration:readiness-packet, fresh, project-matched, blocker-free, ready-for-final-data-migration-window, with an evidence file, all manual gates, all automated checks, data quality, and Firestore target snapshot passing."
    );
  }

  return packet;
}

function validateCurrentSourceFingerprint(packet, report) {
  const packetFingerprint = packet?.migrationSnapshot?.sourceFingerprint;
  const currentFingerprint = report?.sourceFingerprint;
  const matches = packetFingerprint?.algorithm === currentFingerprint?.algorithm &&
    packetFingerprint?.sheetId === currentFingerprint?.sheetId &&
    packetFingerprint?.value === currentFingerprint?.value;

  if (!matches) {
    throw new Error(
      "Refusing to write. Google Sheet source fingerprint changed after readiness packet generation. Re-run migration:readiness-packet during the approved migration window."
    );
  }
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--commit") {
      out.commit = true;
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

async function fetchWorkbook(sheetId) {
  const url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:json`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Unable to fetch spreadsheet metadata: ${response.status}`);
  }

  const text = await response.text();
  const json = parseGoogleVizJson(text);
  const sheets = json.table?.cols ? [{ name: "Log", rows: parseRows(json.table) }] : [];

  // The public gviz endpoint returns the first sheet by default. Use explicit sheet
  // names for the important tabs so dry-runs can inspect all available data.
  const sheetNames = ["Log", "Users", "Codes", "Weight_Log"];
  const archiveNames = ["Logs_Archive_2026", "Logs_Archive_2025", "Logs_Archive_2024"];
  const tabs = [...new Set([...sheetNames, ...archiveNames])];
  const workbook = {};
  const meta = {
    sheetId,
    fetchedAt: new Date().toISOString(),
    requestedTabs: tabs,
    fetchErrors: []
  };

  for (const tab of tabs) {
    try {
      workbook[tab] = await fetchSheetRows(sheetId, tab);
    } catch (error) {
      workbook[tab] = [];
      meta.fetchErrors.push({ tab, message: error.message || String(error) });
    }
  }

  for (const sheet of sheets) {
    if (!workbook[sheet.name]?.length) {
      workbook[sheet.name] = sheet.rows;
    }
  }

  Object.defineProperty(workbook, "__meta", {
    value: meta,
    enumerable: false
  });

  return workbook;
}

async function fetchSheetRows(sheetId, sheetName) {
  const url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(sheetName)}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Unable to fetch ${sheetName}: ${response.status}`);
  }
  const text = await response.text();
  const json = parseGoogleVizJson(text);
  return normalizeSheetRows(sheetName, parseRows(json.table));
}

function parseGoogleVizJson(text) {
  const match = text.match(/google\.visualization\.Query\.setResponse\((.*)\);?$/s);
  if (!match) throw new Error("Unexpected Google Visualization response");
  return JSON.parse(match[1]);
}

function parseRows(table) {
  const headers = table.cols.map((col, index) => col.label || `Column_${index + 1}`);
  return table.rows.map((row, rowIndex) => {
    const record = { __rowNumber: rowIndex + 2 };
    row.c.forEach((cell, index) => {
      record[headers[index]] = cell?.v ?? "";
    });
    return record;
  });
}

function normalizeSheetRows(sheetName, rows) {
  const mapping = columnMappingForSheet(sheetName);
  if (!mapping) return rows;

  return rows
    .filter((row) => !isHeaderLikeRow(sheetName, row))
    .map((row) => {
      const normalized = { ...row };
      for (const [target, source] of Object.entries(mapping)) {
        if (normalized[target] == null || normalized[target] === "") {
          normalized[target] = row[source] ?? "";
        }
      }
      return normalized;
    });
}

function columnMappingForSheet(sheetName) {
  if (sheetName === "Users") {
    return {
      UserID: "Column_1",
      Name: "Column_2",
      TDEE: "Column_3",
      "P_%": "Column_4",
      "C_%": "Column_5",
      "F_%": "Column_6",
      Expire_Date: "Column_7",
      Last_Update: "Column_8",
      Streak: "Column_9"
    };
  }

  if (sheetName === "Log" || sheetName.startsWith("Logs_Archive")) {
    return {
      Date: "Column_1",
      UserID: "Column_2",
      Dish_TH: "Column_3",
      Dish_EN_or_Type: "Column_4",
      Portion: "Column_5",
      Calories: "Column_6",
      Protein: "Column_7",
      Carbs: "Column_8",
      Fat: "Column_9",
      Fiber: "Column_10",
      Sugar: "Column_11",
      Score: "Column_12",
      Comment: "Column_13"
    };
  }

  return null;
}

function isHeaderLikeRow(sheetName, row) {
  if (sheetName === "Users") {
    return stringValue(row.Column_1).toLowerCase() === "userid" &&
      stringValue(row.Column_2).toLowerCase() === "name";
  }

  if (sheetName === "Log" || sheetName.startsWith("Logs_Archive")) {
    return stringValue(row.Column_2).toLowerCase() === "userid" &&
      stringValue(row.Column_3).toLowerCase() === "dish_th";
  }

  return false;
}

function planMigration(workbook) {
  const docs = [];

  for (const row of workbook.Users || []) {
    const lineUserId = stringValue(row.UserID);
    if (!lineUserId) continue;
    const canonicalUserId = lineUserId;
    const target = targetFromUserRow(row);

    docs.push(doc("users", canonicalUserId, {
      userId: canonicalUserId,
      canonicalUserId,
      status: "active",
      roles: ["user"],
      source: { line: true, app: false },
      legacy: legacyMeta("Users", row)
    }));

    docs.push(doc("profiles", canonicalUserId, {
      userId: canonicalUserId,
      canonicalUserId,
      displayName: stringValue(row.Name) || "Member",
      lineUserId,
      target,
      legacy: legacyMeta("Users", row)
    }));

    docs.push(doc("subscriptions", canonicalUserId, {
      userId: canonicalUserId,
      canonicalUserId,
      status: isFutureDate(row.Expire_Date) ? "active" : "expired",
      expiresAt: dateOrNull(row.Expire_Date),
      legacy: legacyMeta("Users", row)
    }));

    docs.push(doc("lineLinks", lineUserId, {
      lineUserId,
      canonicalUserId,
      status: "legacy-line-primary",
      legacy: legacyMeta("Users", row)
    }));
  }

  for (const [sheetName, rows] of Object.entries(workbook)) {
    if (sheetName !== "Log" && !sheetName.startsWith("Logs_Archive")) continue;
    for (const row of rows) {
      const userId = stringValue(row.UserID);
      if (!userId) continue;
      const canonicalUserId = userId;
      const type = stringValue(row.Dish_EN_or_Type || row.Column_4);
      const collection = type === "Exercise" || type === "Burn" ? "exerciseLogs" : "mealLogs";
      docs.push(doc(collection, stableId(sheetName, row.__rowNumber), mapLogRow(sheetName, row, collection, canonicalUserId)));
    }
  }

  for (const row of workbook.Weight_Log || []) {
    const userId = stringValue(row.UserID);
    if (!userId) continue;
    const canonicalUserId = userId;
    docs.push(doc("weightLogs", stableId("Weight_Log", row.__rowNumber), {
      userId: canonicalUserId,
      canonicalUserId,
      weightKg: numberValue(row.Weight_kg),
      bodyFatPct: numberValue(row["BodyFat_%"]),
      muscleMassKg: numberValue(row.MuscleMass_kg),
      deviceName: stringValue(row.Device) || "Legacy Sheet",
      loggedAt: dateOrNull(row.Date),
      legacy: legacyMeta("Weight_Log", row)
    }));
  }

  for (const row of workbook.Codes || []) {
    const code = stringValue(row.Code);
    if (!code) continue;
    docs.push(doc("redeemCodes", code, {
      code,
      days: numberValue(row.Days),
      status: stringValue(row.Status),
      usedBy: stringValue(row.Used_By) || null,
      usedDate: dateOrNull(row.Used_Date),
      legacy: legacyMeta("Codes", row)
    }));
  }

  return docs;
}

function targetFromUserRow(row) {
  const calories = numberValue(row.TDEE);
  const proteinPct = numberValue(row["P_%"]);
  const carbsPct = numberValue(row["C_%"]);
  const fatPct = numberValue(row["F_%"]);
  return {
    calories,
    proteinPct,
    carbsPct,
    fatPct,
    proteinG: Math.round((calories * proteinPct / 100) / 4) || 0,
    carbsG: Math.round((calories * carbsPct / 100) / 4) || 0,
    fatG: Math.round((calories * fatPct / 100) / 9) || 0,
    fiberG: 25
  };
}

function mapLogRow(sheetName, row, collection, canonicalUserId) {
  const userId = stringValue(row.UserID);
  const loggedAt = dateOrNull(row.Date);

  if (collection === "exerciseLogs") {
    return {
      userId: canonicalUserId,
      canonicalUserId,
      legacyLineUserId: userId,
      source: "legacy-sheet",
      exerciseName: stringValue(row.Dish_TH || row.Column_3) || "Exercise",
      caloriesBurned: numberValue(row.Calories || row.Column_6),
      loggedAt,
      legacy: legacyMeta(sheetName, row)
    };
  }

  return {
    userId: canonicalUserId,
    canonicalUserId,
    legacyLineUserId: userId,
    source: "legacy-sheet",
    inputType: "legacy",
    mealNameTh: stringValue(row.Dish_TH || row.Column_3) || "Unknown",
    mealNameEn: stringValue(row.Dish_EN_or_Type || row.Column_4) || "-",
    portionDescription: stringValue(row.Portion || row.Column_5) || "1 Serving",
    nutrients: {
      caloriesKcal: numberValue(row.Calories || row.Column_6),
      proteinG: numberValue(row.Protein || row.Column_7),
      carbsG: numberValue(row.Carbs || row.Column_8),
      fatG: numberValue(row.Fat || row.Column_9),
      fiberG: numberValue(row.Fiber || row.Column_10),
      sugarG: numberValue(row.Sugar || row.Column_11)
    },
    healthRating: {
      score: numberValue(row.Score || row.Column_12) || 5,
      commentTh: stringValue(row.Comment || row.Column_13) || "-"
    },
    loggedAt,
    createdAt: loggedAt,
    updatedAt: loggedAt,
    legacy: legacyMeta(sheetName, row)
  };
}

function doc(collection, id, data) {
  return { collection, id, data };
}

function stableId(sheetName, rowNumber) {
  return `${sheetName.replace(/[^A-Za-z0-9_-]/g, "_")}_${rowNumber}`;
}

function legacyMeta(sheetName, row) {
  return {
    sheetName,
    rowNumber: row.__rowNumber,
    importedFrom: "google-sheet"
  };
}

function buildReadinessReport(workbook, docs, limit) {
  const tabStats = {};
  const warnings = [];

  for (const [tab, rows] of Object.entries(workbook)) {
    const requiredHeaders = requiredHeadersForTab(tab);
    const headers = rows[0] ? Object.keys(rows[0]).filter((key) => key !== "__rowNumber") : [];
    const missingHeaders = requiredHeaders.filter((header) => !headers.includes(header));
    const nonEmptyRows = rows.filter((row) => rowHasAnyValue(row)).length;

    tabStats[tab] = {
      rows: rows.length,
      nonEmptyRows,
      headers,
      missingHeaders
    };

    if (requiredHeaders.length && rows.length > 0 && missingHeaders.length) {
      warnings.push({
        severity: "high",
        type: "missing_headers",
        tab,
        message: `Missing expected headers: ${missingHeaders.join(", ")}`
      });
    }

  }

  const countByCollection = countDocumentsByCollection(docs);
  const userIds = (workbook.Users || []).map((row) => stringValue(row.UserID)).filter(Boolean);
  const duplicateUsers = findDuplicates(userIds).slice(0, limit);

  if (!tabStats.Users?.nonEmptyRows) {
    warnings.push({ severity: "high", type: "missing_users", tab: "Users", message: "Users tab has no readable rows." });
  }

  if (duplicateUsers.length) {
    warnings.push({
      severity: "medium",
      type: "duplicate_users",
      tab: "Users",
      message: `Duplicate UserID values detected: ${duplicateUsers.join(", ")}`
    });
  }

  const anomalySamples = collectAnomalySamples(workbook, limit);
  warnings.push(...anomalySamples.warnings);

  const fetchErrors = workbook.__meta?.fetchErrors || [];
  for (const error of fetchErrors) {
    warnings.push({
      severity: ["Log", "Users", "Codes", "Weight_Log"].includes(error.tab) ? "high" : "medium",
      type: "tab_fetch_error",
      tab: error.tab,
      message: error.message
    });
  }

  const severityCounts = warnings.reduce((acc, warning) => {
    acc[warning.severity] = (acc[warning.severity] || 0) + 1;
    return acc;
  }, {});

  return {
    sheetId: workbook.__meta?.sheetId || sheetId,
    fetchedAt: workbook.__meta?.fetchedAt || new Date().toISOString(),
    dryRun: !commit,
    sourceFingerprint: buildSourceFingerprint(workbook),
    tabStats,
    sourceSummary: summarizeSourceRows(workbook),
    sampleUsersForDashboardParity: buildSampleUsersForDashboardParity(workbook, limit),
    countByCollection,
    totalPlannedDocuments: docs.length,
    dataQuality: {
      okToPreviewImport: !warnings.some((warning) => warning.severity === "high"),
      severityCounts,
      warnings
    }
  };
}

function buildSourceFingerprint(workbook) {
  const tabs = Object.keys(workbook)
    .filter((tab) => tab !== "__meta")
    .sort();
  const tabRowCounts = {};
  const payload = {
    sheetId: workbook.__meta?.sheetId || sheetId,
    tabs: {}
  };

  for (const tab of tabs) {
    const rows = Array.isArray(workbook[tab]) ? workbook[tab] : [];
    tabRowCounts[tab] = rows.length;
    payload.tabs[tab] = rows.map(canonicalizeRow);
  }

  const value = crypto
    .createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex");

  return {
    algorithm: "sha256",
    value,
    sheetId: payload.sheetId,
    tabRowCounts
  };
}

function canonicalizeRow(row) {
  return Object.keys(row)
    .sort()
    .reduce((acc, key) => {
      acc[key] = row[key];
      return acc;
    }, {});
}

function collectAnomalySamples(workbook, limit) {
  const warnings = [];

  for (const row of workbook.Users || []) {
    const where = rowRef("Users", row);
    const tdee = numberValue(row.TDEE);
    const macroTotal = numberValue(row["P_%"]) + numberValue(row["C_%"]) + numberValue(row["F_%"]);
    if (!stringValue(row.UserID)) pushWarning(warnings, "high", "missing_user_id", where, "User row has no UserID.", limit);
    if (tdee <= 0) pushWarning(warnings, "medium", "invalid_tdee", where, `TDEE is ${row.TDEE || "blank"}.`, limit);
    if (macroTotal && Math.abs(macroTotal - 100) > 1) pushWarning(warnings, "medium", "macro_sum", where, `Macro percent total is ${macroTotal}.`, limit);
    if (row.Expire_Date && !dateOrNull(row.Expire_Date)) pushWarning(warnings, "medium", "invalid_expiry", where, `Expire_Date is ${row.Expire_Date}.`, limit);
  }

  for (const [tab, rows] of Object.entries(workbook)) {
    if (tab !== "Log" && !tab.startsWith("Logs_Archive")) continue;
    for (const row of rows) {
      const where = rowRef(tab, row);
      if (!rowHasAnyValue(row)) continue;
      if (!stringValue(row.UserID)) pushWarning(warnings, "high", "missing_user_id", where, "Log row has no UserID.", limit);
      if (row.Date && !dateOrNull(row.Date)) pushWarning(warnings, "medium", "invalid_log_date", where, `Date is ${row.Date}.`, limit);
      for (const field of ["Calories", "Protein", "Carbs", "Fat", "Fiber", "Sugar"]) {
        if (row[field] !== "" && Number.isNaN(Number(row[field]))) {
          pushWarning(warnings, "medium", "invalid_number", where, `${field} is ${row[field]}.`, limit);
        }
      }
    }
  }

  for (const row of workbook.Weight_Log || []) {
    const where = rowRef("Weight_Log", row);
    if (!rowHasAnyValue(row)) continue;
    if (!stringValue(row.UserID)) pushWarning(warnings, "high", "missing_user_id", where, "Weight row has no UserID.", limit);
    if (row.Date && !dateOrNull(row.Date)) pushWarning(warnings, "medium", "invalid_weight_date", where, `Date is ${row.Date}.`, limit);
    if (row.Weight_kg !== "" && Number(row.Weight_kg) <= 0) pushWarning(warnings, "medium", "invalid_weight", where, `Weight_kg is ${row.Weight_kg}.`, limit);
  }

  for (const row of workbook.Codes || []) {
    const where = rowRef("Codes", row);
    if (!rowHasAnyValue(row)) continue;
    if (!stringValue(row.Code)) pushWarning(warnings, "medium", "missing_code", where, "Code row has no Code.", limit);
    if (row.Days !== "" && Number(row.Days) <= 0) pushWarning(warnings, "medium", "invalid_code_days", where, `Days is ${row.Days}.`, limit);
  }

  return { warnings };
}

function pushWarning(warnings, severity, type, where, message, limit) {
  const existing = warnings.filter((warning) => warning.type === type && warning.tab === where.tab);
  if (existing.length >= limit) return;
  warnings.push({ severity, type, tab: where.tab, rowNumber: where.rowNumber, message });
}

function summarizeSourceRows(workbook) {
  const summary = {
    users: countNonEmpty(workbook.Users || []),
    activeLogRows: countNonEmpty(workbook.Log || []),
    archiveLogRows: 0,
    exerciseLikeRows: 0,
    mealLikeRows: 0,
    weightRows: countNonEmpty(workbook.Weight_Log || []),
    codeRows: countNonEmpty(workbook.Codes || [])
  };

  for (const [tab, rows] of Object.entries(workbook)) {
    if (tab.startsWith("Logs_Archive")) summary.archiveLogRows += countNonEmpty(rows);
    if (tab !== "Log" && !tab.startsWith("Logs_Archive")) continue;
    for (const row of rows) {
      if (!rowHasAnyValue(row)) continue;
      const type = stringValue(row.Dish_EN_or_Type || row.Column_4);
      if (type === "Exercise" || type === "Burn") summary.exerciseLikeRows += 1;
      else summary.mealLikeRows += 1;
    }
  }

  return summary;
}

function buildSampleUsersForDashboardParity(workbook, limit) {
  const users = new Map();

  for (const row of workbook.Users || []) {
    const userId = stringValue(row.UserID);
    if (!userId) continue;
    users.set(userId, {
      userId,
      name: stringValue(row.Name) || "Member",
      tdee: numberValue(row.TDEE),
      macroPct: {
        p: numberValue(row["P_%"]),
        c: numberValue(row["C_%"]),
        f: numberValue(row["F_%"])
      },
      expiresAt: dateToIso(row.Expire_Date),
      activeSubscription: isFutureDate(row.Expire_Date),
      logRows: 0,
      exerciseRows: 0,
      mealRows: 0,
      weightRows: 0,
      firstLogAt: null,
      lastLogAt: null,
      latestWeightAt: null,
      score: 0
    });
  }

  for (const [tab, rows] of Object.entries(workbook)) {
    if (tab !== "Log" && !tab.startsWith("Logs_Archive")) continue;
    for (const row of rows) {
      const userId = stringValue(row.UserID);
      if (!userId) continue;
      const user = ensureSampleUser(users, userId);
      const loggedAt = dateOrNull(row.Date);
      const type = stringValue(row.Dish_EN_or_Type || row.Column_4);
      user.logRows += 1;
      if (type === "Exercise" || type === "Burn") user.exerciseRows += 1;
      else user.mealRows += 1;
      updateDateRange(user, loggedAt);
    }
  }

  for (const row of workbook.Weight_Log || []) {
    const userId = stringValue(row.UserID);
    if (!userId) continue;
    const user = ensureSampleUser(users, userId);
    user.weightRows += 1;
    const loggedAt = dateOrNull(row.Date);
    if (loggedAt && (!user.latestWeightAt || loggedAt.getTime() > new Date(user.latestWeightAt).getTime())) {
      user.latestWeightAt = loggedAt.toISOString();
    }
  }

  for (const user of users.values()) {
    user.score =
      user.logRows +
      (user.weightRows * 5) +
      (user.exerciseRows * 3) +
      (user.activeSubscription ? 20 : 0) +
      (user.firstLogAt && user.lastLogAt && user.firstLogAt !== user.lastLogAt ? 10 : 0);
  }

  return [...users.values()]
    .filter((user) => user.logRows || user.weightRows || user.activeSubscription)
    .sort((a, b) => b.score - a.score || b.logRows - a.logRows || a.userId.localeCompare(b.userId))
    .slice(0, limit)
    .map(({ score, ...user }) => user);
}

function ensureSampleUser(users, userId) {
  if (!users.has(userId)) {
    users.set(userId, {
      userId,
      name: "Legacy user missing from Users tab",
      tdee: 0,
      macroPct: { p: 0, c: 0, f: 0 },
      expiresAt: null,
      activeSubscription: false,
      logRows: 0,
      exerciseRows: 0,
      mealRows: 0,
      weightRows: 0,
      firstLogAt: null,
      lastLogAt: null,
      latestWeightAt: null,
      score: 0
    });
  }
  return users.get(userId);
}

function updateDateRange(user, date) {
  if (!date) return;
  const iso = date.toISOString();
  if (!user.firstLogAt || date.getTime() < new Date(user.firstLogAt).getTime()) user.firstLogAt = iso;
  if (!user.lastLogAt || date.getTime() > new Date(user.lastLogAt).getTime()) user.lastLogAt = iso;
}

function requiredHeadersForTab(tab) {
  if (tab === "Users") return ["UserID", "Name", "TDEE", "P_%", "C_%", "F_%", "Expire_Date"];
  if (tab === "Log" || tab.startsWith("Logs_Archive")) {
    return ["Date", "UserID", "Dish_TH", "Dish_EN_or_Type", "Portion", "Calories", "Protein", "Carbs", "Fat"];
  }
  if (tab === "Weight_Log") return ["Date", "UserID", "Weight_kg"];
  if (tab === "Codes") return ["Code", "Days", "Status"];
  return [];
}

function countDocumentsByCollection(docs) {
  const counts = {};
  for (const item of docs) {
    counts[item.collection] = (counts[item.collection] || 0) + 1;
  }
  return counts;
}

function buildImportManifest(report, docs, readinessPacket) {
  const sourceFingerprint = report.sourceFingerprint || {};
  const fingerprintValue = sourceFingerprint.value || "unknown";
  const generatedAt = new Date().toISOString();
  const readinessGeneratedAt = readinessPacket?.generatedAt || null;
  const importRunId = `google_sheet_${fingerprintValue.slice(0, 12)}`;

  return {
    importRunId,
    status: commit ? "ready-to-write" : "dry-run-preview",
    projectId,
    sheetId: sourceFingerprint.sheetId || report.sheetId || sheetId,
    sourceFingerprint,
    readinessPacketGeneratedAt: readinessGeneratedAt,
    readinessPacketDecision: readinessPacket?.decision?.status || null,
    migrationCommit: currentGitCommit(),
    plannedAt: generatedAt,
    countByCollection: countDocumentsByCollection(docs),
    totalPlannedDocuments: docs.length,
    dataQuality: report.dataQuality,
    tabStats: Object.fromEntries(Object.entries(report.tabStats || {}).map(([tab, stat]) => [
      tab,
      {
        rows: stat.rows,
        nonEmptyRows: stat.nonEmptyRows,
        missingHeaders: stat.missingHeaders
      }
    ]))
  };
}

function currentGitCommit() {
  const result = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: process.cwd(),
    encoding: "utf8"
  });
  if (result.status === 0 && result.stdout.trim()) return result.stdout.trim();
  return currentGitCommitFromFiles();
}

function currentGitCommitFromFiles() {
  try {
    const gitDir = path.join(process.cwd(), ".git");
    const head = fs.readFileSync(path.join(gitDir, "HEAD"), "utf8").trim();
    if (/^[a-f0-9]{40}$/i.test(head)) return head;
    const ref = head.match(/^ref:\s+(.+)$/)?.[1];
    if (!ref) return "";
    return fs.readFileSync(path.join(gitDir, ref), "utf8").trim();
  } catch {
    return "";
  }
}

function printSummary(docs, report, importManifest) {
  console.log(JSON.stringify({
    countByCollection: countDocumentsByCollection(docs),
    total: docs.length,
    importManifest,
    migrationReadiness: report
  }, null, 2));
}

async function writePlannedDocuments(docs, importManifest) {
  const db = admin.firestore();
  let batch = db.batch();
  let pending = 0;
  let written = 0;
  const startedAt = admin.firestore.Timestamp.now();
  const manifestRef = db.collection("migrationRuns").doc(importManifest.importRunId);
  const runningManifest = {
    ...importManifest,
    status: "running",
    startedAt,
    updatedAt: startedAt,
    writtenDocuments: 0
  };

  await manifestRef.set(runningManifest, { merge: true });

  try {
    for (const item of docs) {
      batch.set(db.collection(item.collection).doc(item.id), withImportProvenance(item.data, runningManifest), { merge: true });
      pending += 1;

      if (pending >= 450) {
        await batch.commit();
        written += pending;
        await manifestRef.set({ writtenDocuments: written, updatedAt: admin.firestore.Timestamp.now() }, { merge: true });
        pending = 0;
        batch = db.batch();
      }
    }

    if (pending) {
      await batch.commit();
      written += pending;
    }

    const completedAt = admin.firestore.Timestamp.now();
    await manifestRef.set({
      status: "completed",
      writtenDocuments: written,
      completedAt,
      importedAt: completedAt,
      updatedAt: completedAt
    }, { merge: true });

    console.log(`Wrote ${written} documents.`);
  } catch (error) {
    const failedAt = admin.firestore.Timestamp.now();
    await manifestRef.set({
      status: "failed",
      writtenDocuments: written,
      failedAt,
      updatedAt: failedAt,
      error: error instanceof Error ? error.message : String(error)
    }, { merge: true });

    throw error;
  }
}

function withImportProvenance(data, manifest) {
  return {
    ...data,
    legacy: {
      ...(data.legacy || {}),
      importRunId: manifest.importRunId,
      sourceFingerprint: manifest.sourceFingerprint?.value || null,
      sourceSheetId: manifest.sheetId,
      readinessPacketGeneratedAt: manifest.readinessPacketGeneratedAt,
      migrationCommit: manifest.migrationCommit,
      importedAt: manifest.importedAt
    }
  };
}

function stringValue(value) {
  return value == null ? "" : String(value).trim();
}

function numberValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function dateOrNull(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === "string" && value.startsWith("Date(")) {
    const parts = value.slice(5, -1).split(",").map(Number);
    return new Date(parts[0], parts[1], parts[2] || 1, parts[3] || 0, parts[4] || 0, parts[5] || 0);
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function dateToIso(value) {
  const date = dateOrNull(value);
  return date ? date.toISOString() : null;
}

function isFutureDate(value) {
  const date = dateOrNull(value);
  return date ? date.getTime() > Date.now() : false;
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function countNonEmpty(rows) {
  return rows.filter((row) => rowHasAnyValue(row)).length;
}

function rowHasAnyValue(row) {
  return Object.entries(row).some(([key, value]) => key !== "__rowNumber" && stringValue(value));
}

function rowRef(tab, row) {
  return { tab, rowNumber: row.__rowNumber || null };
}

function findDuplicates(values) {
  const seen = new Set();
  const dupes = new Set();
  for (const value of values) {
    if (seen.has(value)) dupes.add(value);
    seen.add(value);
  }
  return [...dupes];
}
