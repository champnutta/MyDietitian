#!/usr/bin/env node

const crypto = require("node:crypto");

const args = parseArgs(process.argv.slice(2));
const endpoint = args.endpoint || "https://asia-southeast1-mydietitian.cloudfunctions.net/lineWebhook";
const channelSecret = args.secret || process.env.LINE_CHANNEL_SECRET;
const lineUserId = args.user || "U_STAGING_TEST_USER";
const dryRun = Boolean(args.dryRun);
const scenario = args.scenario || "text";

const SCENARIOS = [
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

if (args.list) {
  console.log(SCENARIOS.join("\n"));
  process.exit(0);
}

if (!channelSecret) {
  console.error("Missing LINE channel secret. Pass --secret or set LINE_CHANNEL_SECRET.");
  process.exit(1);
}

const events = buildScenarioEvents(scenario, lineUserId, args);
const body = JSON.stringify({
  destination: args.destination || "STAGING_DESTINATION",
  events
});
const signature = crypto.createHmac("sha256", channelSecret).update(body).digest("base64");

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

async function main() {
  if (dryRun) {
    console.log(JSON.stringify({
      endpoint,
      signature,
      body: JSON.parse(body)
    }, null, 2));
    return;
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-line-signature": signature
    },
    body
  });
  const text = await response.text();
  console.log(JSON.stringify({
    status: response.status,
    ok: response.ok,
    response: parseMaybeJson(text)
  }, null, 2));

  if (!response.ok) {
    process.exit(1);
  }
}

function buildScenarioEvents(scenario, userId, input) {
  switch (scenario) {
    case "follow":
      return [baseEvent({ type: "follow", userId })];
    case "setup":
      return [textEvent(userId, input.text || "ตั้งค่า Test 2000 40-30-30")];
    case "food":
      return [textEvent(userId, input.text || "boiled egg 2 pieces")];
    case "exercise":
      return [textEvent(userId, input.text || "walking 20 minutes")];
    case "menu":
      return [textEvent(userId, input.text || "กินอะไรดี")];
    case "portion":
      return [textEvent(userId, input.text || "กิน 2/3")];
    case "correction":
      return [textEvent(userId, input.text || "ไม่ใช่ไข่ต้ม เป็นอกไก่ย่าง")];
    case "dashboard":
      return [textEvent(userId, input.text || "dashboard")];
    case "summary":
      return [textEvent(userId, input.text || "สรุป")];
    case "weight":
      return [textEvent(userId, input.text || "หนัก 70 fat 20 muscle 30")];
    case "subscribe":
      return [textEvent(userId, input.text || "สมัคร")];
    case "contact":
      return [textEvent(userId, input.text || "ติดต่อ admin ขอความช่วยเหลือ")];
    case "text":
      return [textEvent(userId, input.text || "hello")];
    default:
      throw new Error(`Unknown scenario: ${scenario}`);
  }
}

function textEvent(userId, text) {
  return baseEvent({
    type: "message",
    userId,
    message: {
      id: `test-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      type: "text",
      text
    }
  });
}

function baseEvent({ type, userId, message }) {
  return {
    type,
    replyToken: `reply-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    timestamp: Date.now(),
    source: {
      type: "user",
      userId
    },
    ...(message ? { message } : {})
  };
}

function parseArgs(argv) {
  const out = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") {
      out.dryRun = true;
      continue;
    }
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

function parseMaybeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
