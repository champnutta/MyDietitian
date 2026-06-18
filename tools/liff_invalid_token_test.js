#!/usr/bin/env node

const args = parseArgs(process.argv.slice(2));
const endpoint = args.endpoint || "https://asia-southeast1-mydietitian.cloudfunctions.net/saveSettingsFromWeb";
const userId = args.user || args.userId || "U_STAGING_INVALID_TOKEN_TEST";
const lineUserId = args.lineUserId || userId;
const invalidToken = args.invalidToken || args["invalid-token"] || "invalid-line-id-token-for-negative-uat";

if (args.help || args.h) {
  printHelp();
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

async function main() {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Line-Id-Token": invalidToken
    },
    body: JSON.stringify(buildSafeSettingsPayload(userId, lineUserId))
  });
  const text = await response.text();
  const json = parseJson(text);
  const ok = response.status === 401 && json?.ok === false && json?.error === "profile-auth-failed";
  const report = {
    ok,
    generatedAt: new Date().toISOString(),
    endpoint,
    userId,
    lineUserId,
    expectedStatus: 401,
    actualStatus: response.status,
    expectedError: "profile-auth-failed",
    actualError: json?.error ?? null,
    message: json?.message ?? text.slice(0, 500),
    evidenceText: ok
      ? `pass: saveSettingsFromWeb rejected invalid LINE ID token with 401 profile-auth-failed for ${lineUserId}`
      : `fail: expected 401 profile-auth-failed, got status=${response.status} error=${json?.error ?? "-"}`
  };

  console.log(JSON.stringify(report, null, 2));
  if (!ok) process.exit(1);
}

function buildSafeSettingsPayload(canonicalUserId, lineUserId) {
  return {
    userId: lineUserId,
    canonicalUserId,
    lineUserId,
    displayName: "Invalid Token UAT",
    config: {
      mode: "custom",
      tdee: 1800,
      p: 30,
      c: 40,
      f: 30,
      fiberG: 25
    }
  };
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
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

function printHelp() {
  console.log([
    "LIFF invalid token negative test",
    "",
    "Usage:",
    "  npm run uat:liff-invalid-token -- --user <TEST_LINE_USER_ID>",
    "",
    "This sends a safe settings payload with an intentionally invalid X-Line-Id-Token.",
    "Expected result: HTTP 401 with error=profile-auth-failed before any profile write."
  ].join("\n"));
}
