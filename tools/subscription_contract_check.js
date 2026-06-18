#!/usr/bin/env node

const { spawnSync } = require("node:child_process");
const os = require("node:os");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const buildCommand = os.platform() === "win32" ? "cmd.exe" : "npm";
const buildArgs = os.platform() === "win32"
  ? ["/d", "/s", "/c", "npm", "--workspace", "@mydietitian/backend", "run", "build"]
  : ["--workspace", "@mydietitian/backend", "run", "build"];
const build = spawnSync(buildCommand, buildArgs, {
  cwd: repoRoot,
  encoding: "utf8",
  shell: false,
  maxBuffer: 20 * 1024 * 1024
});

if (build.status !== 0) {
  console.error(build.stdout || "");
  console.error(build.stderr || "");
  process.exit(build.status || 1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});

async function main() {
  const utils = await import("../services/backend/lib/subscription-utils.js");
  const checks = [
    checkCommand(utils, "approve U123 30d", { action: "approve", target: "U123", grantInput: "30d" }),
    checkCommand(utils, "อนุมัติ U123 90d", { action: "approve", target: "U123", grantInput: "90d" }),
    checkCommand(utils, "approve U123 lifetime", { action: "approve", target: "U123", grantInput: "lifetime" }),
    checkCommand(utils, "reject U123 duplicate slip", { action: "reject", target: "U123", reason: "duplicate slip" }),
    checkGrant(utils, null, { planId: "30d", days: 30, lifetime: false }),
    checkGrant(utils, "30", { planId: null, days: 30, lifetime: false }),
    checkGrant(utils, "90d", { planId: "90d", days: 90, lifetime: false }),
    checkGrant(utils, "lifetime", { planId: "lifetime", days: null, lifetime: true }),
    checkGrant(utils, "infinite", { planId: "lifetime", days: null, lifetime: true }),
    checkGrant(utils, "free", { planId: "lifetime", days: null, lifetime: true }),
    checkGrant(utils, "0", null),
    checkGrant(utils, "3661", null),
    checkPlan(utils, {
      planId: "promo120",
      labelTh: "โปร 120 วัน",
      days: 120,
      priceThb: 199,
      active: true,
      visible: true,
      sortOrder: 30,
      promoTag: "promo"
    }, { lifetime: false, days: 120, lineIncludes: "โปร 120 วัน (promo) = 199 บาท" }),
    checkPlan(utils, {
      planId: "family",
      labelTh: "ครอบครัว/เพื่อน",
      days: null,
      priceThb: null,
      active: true,
      visible: false,
      sortOrder: 999
    }, { lifetime: true, days: null, lineIncludes: "ครอบครัว/เพื่อน = free" })
  ];
  const failed = checks.filter((item) => !item.ok);
  const report = {
    ok: failed.length === 0,
    generatedAt: new Date().toISOString(),
    checks,
    summary: {
      total: checks.length,
      passed: checks.length - failed.length,
      failed: failed.length
    }
  };
  console.log(JSON.stringify(report, null, 2));
  if (failed.length) process.exit(1);
}

function checkCommand(utils, text, expected) {
  const actual = utils.parseAdminSubscriptionCommand(text);
  return {
    type: "admin-command",
    text,
    ok: objectMatches(actual, expected),
    expected,
    actual
  };
}

function checkGrant(utils, input, expected) {
  const actual = utils.subscriptionGrantFromRawInput(input);
  return {
    type: "subscription-grant",
    input,
    ok: expected === null ? actual === null : objectMatches(actual, expected),
    expected,
    actual
  };
}

function checkPlan(utils, plan, expected) {
  const grant = utils.subscriptionGrantFromPlan(plan);
  const line = utils.formatSubscriptionPlanLine(plan);
  return {
    type: "subscription-plan",
    planId: plan.planId,
    ok: Boolean(grant) &&
      grant.lifetime === expected.lifetime &&
      grant.days === expected.days &&
      line.includes(expected.lineIncludes),
    expected,
    actual: { grant, line }
  };
}

function objectMatches(actual, expected) {
  if (actual === null || typeof actual !== "object") return false;
  for (const [key, value] of Object.entries(expected)) {
    if (actual[key] !== value) return false;
  }
  return true;
}
