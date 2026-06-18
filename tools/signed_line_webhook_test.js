#!/usr/bin/env node

const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");

const args = parseArgs(process.argv.slice(2));
const endpoint = args.endpoint || "https://asia-southeast1-mydietitian.cloudfunctions.net/lineWebhook";
const projectId = args.project || "mydietitian";
const useLineSecretManager = Boolean(args.useLineSecretManager || args["use-line-secret-manager"]);
const lineSecretName = args.lineSecretName || args["line-secret-name"] || "LINE_CHANNEL_SECRET";
const channelSecret = args.secret || process.env.LINE_CHANNEL_SECRET || (useLineSecretManager ? accessSecret(lineSecretName) : "");
const lineUserId = args.user || "U_STAGING_TEST_USER";
const dryRun = Boolean(args.dryRun);
const webhookDryRun = Boolean(args.webhookDryRun || args.contractDryRun || args["webhook-dry-run"] || args["contract-dry-run"]);
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

if (args.list) {
  console.log(SCENARIOS.join("\n"));
  process.exit(0);
}

if (!channelSecret) {
  console.error("Missing LINE channel secret. Set LINE_CHANNEL_SECRET in the environment or pass --useLineSecretManager.");
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
      "x-line-signature": signature,
      ...(webhookDryRun ? { "x-mydietitian-line-dry-run": "true" } : {})
    },
    body
  });
  const text = await response.text();
  const parsed = parseMaybeJson(text);
  const ok = response.ok && (!webhookDryRun || parsed?.ok === true);
  console.log(JSON.stringify({
    status: response.status,
    ok,
    mode: webhookDryRun ? "line-webhook-contract-dry-run" : "live-webhook",
    response: parsed
  }, null, 2));

  if (!ok) {
    process.exit(1);
  }
}

function buildScenarioEvents(selectedScenario, userId, input) {
  if (selectedScenario === "follow") {
    return [baseEvent({ type: "follow", userId })];
  }
  const text = input.text || DEFAULT_TEXT[selectedScenario];
  if (!text) {
    throw new Error(`Unknown scenario: ${selectedScenario}`);
  }
  return [textEvent(userId, text)];
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

function accessSecret(secretName) {
  const command = [
    "gcloud",
    "secrets",
    "versions",
    "access",
    "latest",
    "--secret",
    secretName,
    "--project",
    projectId
  ];
  const result = spawnCommand(command);
  if (result.status !== 0) return "";
  return String(result.stdout || "").trim();
}

function spawnCommand(command) {
  if (process.platform === "win32" && needsCmdShim(command[0])) {
    const commandLine = command.map(quoteCmdArg).join(" ");
    return spawnSync("cmd.exe", ["/d", "/s", "/c", commandLine], {
      cwd: process.cwd(),
      encoding: "utf8",
      shell: false,
      maxBuffer: 1024 * 1024
    });
  }
  return spawnSync(command[0], command.slice(1), {
    cwd: process.cwd(),
    encoding: "utf8",
    shell: false,
    maxBuffer: 1024 * 1024
  });
}

function needsCmdShim(command) {
  return ["gcloud"].includes(command) || /\.(cmd|bat)$/i.test(command);
}

function quoteCmdArg(value) {
  const text = String(value || "");
  if (!text) return "\"\"";
  if (!/[\s"&|<>^]/.test(text)) return text;
  return `"${text.replace(/"/g, "\"\"")}"`;
}

function parseMaybeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
