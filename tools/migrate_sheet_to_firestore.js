#!/usr/bin/env node

const admin = require("firebase-admin");

const DEFAULT_SHEET_ID = "1Yf1yxbBbV7S1nCCtxuSOC1YIdiirFbx3GKKLUv_AUPI";

const args = parseArgs(process.argv.slice(2));
const projectId = args.project || "mydietitian";
const sheetId = args.sheetId || DEFAULT_SHEET_ID;
const commit = Boolean(args.commit);
const finalMigrationConfirmed = Boolean(args.confirmFinalMigration);

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

async function main() {
  if (!commit) {
    console.log("DRY RUN: no Firestore writes will be performed. Pass --commit to write.");
  } else if (!finalMigrationConfirmed) {
    throw new Error(
      "Refusing to write. Data migration is reserved for final production cutover. " +
      "Pass --commit --confirmFinalMigration only during the approved final migration window."
    );
  }

  initializeFirebase(projectId, args.serviceAccount);

  const workbook = await fetchWorkbook(sheetId);
  const planned = planMigration(workbook);

  printSummary(planned);

  if (commit) {
    await writePlannedDocuments(planned);
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

  for (const tab of tabs) {
    try {
      workbook[tab] = await fetchSheetRows(sheetId, tab);
    } catch (error) {
      workbook[tab] = [];
    }
  }

  for (const sheet of sheets) {
    if (!workbook[sheet.name]?.length) {
      workbook[sheet.name] = sheet.rows;
    }
  }

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
  return parseRows(json.table);
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

function printSummary(docs) {
  const counts = {};
  for (const item of docs) {
    counts[item.collection] = (counts[item.collection] || 0) + 1;
  }
  console.log(JSON.stringify({ countByCollection: counts, total: docs.length }, null, 2));
}

async function writePlannedDocuments(docs) {
  const db = admin.firestore();
  let batch = db.batch();
  let pending = 0;
  let written = 0;

  for (const item of docs) {
    batch.set(db.collection(item.collection).doc(item.id), item.data, { merge: true });
    pending += 1;

    if (pending >= 450) {
      await batch.commit();
      written += pending;
      pending = 0;
      batch = db.batch();
    }
  }

  if (pending) {
    await batch.commit();
    written += pending;
  }

  console.log(`Wrote ${written} documents.`);
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

function isFutureDate(value) {
  const date = dateOrNull(value);
  return date ? date.getTime() > Date.now() : false;
}
