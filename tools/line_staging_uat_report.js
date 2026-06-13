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

  const json = JSON.stringify(report, null, 2);
  console.log(json);

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
  switch (scenario) {
    case "follow":
      return [baseEvent({ type: "follow", userId: lineUserId })];
    case "setup":
      return [textEvent(lineUserId, "ตั้งค่า Test 2000 40-30-30")];
    case "food":
      return [textEvent(lineUserId, "ไข่ต้ม 2 ฟอง")];
    case "exercise":
      return [textEvent(lineUserId, "วิ่ง 30 นาที")];
    case "menu":
      return [textEvent(lineUserId, "กินอะไรดี")];
    case "portion":
      return [textEvent(lineUserId, "กิน 2/3")];
    case "correction":
      return [textEvent(lineUserId, "ไม่ใช่ไข่ต้ม เป็นอกไก่ย่าง")];
    case "dashboard":
      return [textEvent(lineUserId, "dashboard")];
    case "summary":
      return [textEvent(lineUserId, "สรุป")];
    case "weight":
      return [textEvent(lineUserId, "หนัก 70 fat 20 muscle 30")];
    case "subscribe":
      return [textEvent(lineUserId, "สมัคร")];
    case "contact":
      return [textEvent(lineUserId, "ติดต่อ admin ขอความช่วยเหลือ")];
    case "text":
      return [textEvent(lineUserId, "hello")];
    default:
      throw new Error(`Unknown scenario: ${scenario}`);
  }
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
      } else {
        out[key] = value;
        index += 1;
      }
    }
  }
  return out;
}

function escapeTable(value) {
  return String(value).replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");
}
