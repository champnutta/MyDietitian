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
  const { parsePortionAdjustmentCommand } = await import("../services/backend/lib/portion-adjustment.js");
  const cases = [
    { text: "กิน 2/3", ratio: 0.6667, labelIncludes: "2/3" },
    { text: "กิน 2 ใน 3", ratio: 0.6667, labelIncludes: "2/3" },
    { text: "กินสองในสาม", ratio: 0.6667, labelIncludes: "สอง/สาม" },
    { text: "กินสองส่วนสาม", ratio: 0.6667, labelIncludes: "สอง/สาม" },
    { text: "กินครึ่งเดียว", ratio: 0.5, labelIncludes: "ครึ่ง" },
    { text: "เหลือ 1/4", ratio: 0.25, labelIncludes: "1/4" },
    { text: "ate two thirds", ratio: 0.6667, labelIncludes: "2/3" },
    { text: "กิน 150%", ratio: null, labelIncludes: null },
    { text: "วันนี้อร่อยมาก", ratio: null, labelIncludes: null }
  ];

  const results = cases.map((item) => {
    const actual = parsePortionAdjustmentCommand(item.text);
    const ok = item.ratio === null
      ? actual === null
      : actual !== null &&
        Math.abs(Number(actual.ratio) - item.ratio) < 0.0001 &&
        String(actual.label).includes(item.labelIncludes);
    return {
      text: item.text,
      ok,
      expectedRatio: item.ratio,
      actual
    };
  });
  const failed = results.filter((item) => !item.ok);
  const report = {
    ok: failed.length === 0,
    generatedAt: new Date().toISOString(),
    results,
    summary: {
      total: results.length,
      passed: results.length - failed.length,
      failed: failed.length
    }
  };

  console.log(JSON.stringify(report, null, 2));
  if (failed.length) process.exit(1);
}
