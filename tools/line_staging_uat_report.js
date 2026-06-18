#!/usr/bin/env node

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const args = parseArgs(process.argv.slice(2));
const userId = args.user || "U_STAGING_UAT_USER";
const secret = args.secret || process.env.LINE_CHANNEL_SECRET || "uat-dummy-secret";
const endpoint = args.endpoint || "https://asia-southeast1-mydietitian.cloudfunctions.net/lineWebhook";
const outFile = args.out ? path.resolve(args.out) : null;

const TEXT_SCENARIOS = [
  "follow",
  "setup",
  "food",
  "exercise",
  "menu",
  "portion",
  "correction",
  "dashboard",
  "summary",
  "weight",
  "subscribe",
  "contact",
  "text"
];

const DEFAULT_TEXT = {
  setup: "\u0e15\u0e31\u0e49\u0e07\u0e04\u0e48\u0e32 Test 2000 40-30-30",
  food: "\u0e44\u0e02\u0e48\u0e15\u0e49\u0e21 2 \u0e1f\u0e2d\u0e07",
  exercise: "\u0e27\u0e34\u0e48\u0e07 30 \u0e19\u0e32\u0e17\u0e35",
  menu: "\u0e01\u0e34\u0e19\u0e2d\u0e30\u0e44\u0e23\u0e14\u0e35",
  portion: "\u0e01\u0e34\u0e19 2/3",
  correction: "\u0e44\u0e21\u0e48\u0e43\u0e0a\u0e48\u0e44\u0e02\u0e48\u0e15\u0e49\u0e21 \u0e40\u0e1b\u0e47\u0e19\u0e2d\u0e01\u0e44\u0e01\u0e48\u0e22\u0e48\u0e32\u0e07",
  dashboard: "dashboard",
  summary: "\u0e2a\u0e23\u0e38\u0e1b",
  weight: "\u0e2b\u0e19\u0e31\u0e01 70 fat 20 muscle 30",
  subscribe: "\u0e2a\u0e21\u0e31\u0e04\u0e23",
  contact: "\u0e15\u0e34\u0e14\u0e15\u0e48\u0e2d admin \u0e02\u0e2d\u0e04\u0e27\u0e32\u0e21\u0e0a\u0e48\u0e27\u0e22\u0e40\u0e2b\u0e25\u0e37\u0e2d",
  text: "hello"
};

const REAL_LINE_MEDIA_CASES = [
  {
    scenario: "food-image",
    reason: "LINE content download requires a real image messageId and channel token.",
    expected: "Creates mealLogs and aiRuns, then replies with meal summary.",
    firestoreEvidence: ["mealLogs", "aiRuns", "lineEvents"]
  },
  {
    scenario: "leftover-image",
    reason: "Classifier and leftover analysis require a real leftover image from LINE.",
    expected: "Creates a leftover-subtraction adjustment and updates the latest meal log.",
    firestoreEvidence: ["mealAdjustments", "mealLogs", "aiRuns"]
  },
  {
    scenario: "payment-slip-image",
    reason: "Slip classification/review requires real LINE image content.",
    expected: "Creates pending paymentReviews, notifies admin, and supports approve/reject.",
    firestoreEvidence: ["paymentReviews", "subscriptionRequests", "adminAuditLogs"]
  },
  {
    scenario: "bia-image-or-file",
    reason: "BIA image/PDF download requires a real LINE image/file messageId.",
    expected: "Creates biaReports, runs biaAnalysis, and waits for target confirmation.",
    firestoreEvidence: ["biaReports", "aiRuns", "weightLogs", "profileEvents"]
  },
  {
    scenario: "real-liff-settings",
    reason: "authVerified=true can only be proven from a real LIFF session with LINE ID token.",
    expected: "saveSettingsFromWeb returns ok=true and authVerified=true.",
    firestoreEvidence: ["profiles", "profileAuthEvents", "profileEvents"]
  }
];

main();

function main() {
  const textResults = TEXT_SCENARIOS.map((scenario) => runDryScenario(scenario));
  const failed = textResults.filter((result) => !result.ok);
  const report = {
    ok: failed.length === 0,
    generatedAt: new Date().toISOString(),
    endpoint,
    userId,
    textScenarios: textResults,
    realLineMediaCases: REAL_LINE_MEDIA_CASES,
    summary: {
      textScenarioCount: textResults.length,
      textScenarioPassed: textResults.length - failed.length,
      textScenarioFailed: failed.length,
      realLineRequiredCount: REAL_LINE_MEDIA_CASES.length
    }
  };

  console.log(JSON.stringify(report, null, 2));

  if (outFile) {
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, `${renderMarkdown(report)}\n`, "utf8");
  }

  if (failed.length) process.exit(1);
}

function runDryScenario(scenario) {
  const payload = buildSignedDryRunPayload(scenario);
  const event = payload?.body?.events?.[0];
  const message = event?.message;
  const ok = Boolean(payload?.signature && event?.type);

  return {
    scenario,
    ok,
    eventType: event?.type || null,
    messageType: message?.type || null,
    sampleText: message?.text || null,
    hasSignature: Boolean(payload?.signature),
    replyTokenShapeOk: typeof event?.replyToken === "string" && event.replyToken.startsWith("reply-")
  };
}

function buildSignedDryRunPayload(scenario) {
  const body = {
    destination: "STAGING_DESTINATION",
    events: buildScenarioEvents(scenario, userId)
  };
  const rawBody = JSON.stringify(body);
  return {
    endpoint,
    signature: crypto.createHmac("sha256", secret).update(rawBody).digest("base64"),
    body
  };
}

function buildScenarioEvents(scenario, lineUserId) {
  if (scenario === "follow") {
    return [baseEvent({ type: "follow", userId: lineUserId })];
  }
  const text = DEFAULT_TEXT[scenario];
  if (!text) {
    throw new Error(`Unknown scenario: ${scenario}`);
  }
  return [textEvent(lineUserId, text)];
}

function textEvent(lineUserId, text) {
  return baseEvent({
    type: "message",
    userId: lineUserId,
    message: {
      id: `test-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      type: "text",
      text
    }
  });
}

function baseEvent({ type, userId: lineUserId, message }) {
  return {
    type,
    replyToken: `reply-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    timestamp: Date.now(),
    source: {
      type: "user",
      userId: lineUserId
    },
    ...(message ? { message } : {})
  };
}

function renderMarkdown(report) {
  const lines = [
    "# LINE Staging UAT Report",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    "## Dry-Run Signed Text Scenarios",
    "",
    "| Scenario | Status | Event | Message | Sample text |",
    "| --- | --- | --- | --- | --- |"
  ];

  for (const item of report.textScenarios) {
    lines.push(`| ${item.scenario} | ${item.ok ? "pass" : "fail"} | ${item.eventType || "-"} | ${item.messageType || "-"} | ${escapeTable(item.sampleText || "-")} |`);
  }

  lines.push(
    "",
    "## Real LINE Required",
    "",
    "| Scenario | Why local dry-run is not enough | Expected result | Firestore evidence |",
    "| --- | --- | --- | --- |"
  );

  for (const item of report.realLineMediaCases) {
    lines.push(`| ${item.scenario} | ${escapeTable(item.reason)} | ${escapeTable(item.expected)} | ${escapeTable((item.firestoreEvidence || []).join(", "))} |`);
  }

  lines.push(
    "",
    "## Cutover Note",
    "",
    "Passing this report only proves local signed payload generation for text scenarios. Production LINE OA must remain on GAS until real LINE media, LIFF auth, dashboard parity, and final data migration verification pass."
  );

  return lines.join("\n");
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

function escapeTable(value) {
  return String(value).replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");
}
