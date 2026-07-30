#!/usr/bin/env node

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});

async function main() {
  const { parseConfirmUpdateTargetCommand } = await import("../services/backend/lib/target-confirmation.js");
  const cases = [
    {
      text: "CONFIRM_UPDATE_TARGET 2200 150-200-60",
      expected: { calories: 2200, proteinG: 150, carbsG: 200, fatG: 60, fiberG: 25 }
    },
    {
      text: "confirm_update_target 1800.4 120.6-150.2-50.8",
      expected: { calories: 1800, proteinG: 121, carbsG: 150, fatG: 51, fiberG: 25 }
    },
    { text: "CONFIRM_UPDATE_TARGET 799 150-200-60", expected: null },
    { text: "CONFIRM_UPDATE_TARGET 6001 150-200-60", expected: null },
    { text: "CONFIRM_UPDATE_TARGET 2200 150-200", expected: null },
    { text: "CONFIRM_UPDATE_TARGET 2200 150-0-60", expected: null },
    { text: "UPDATE_TARGET 2200 150-200-60", expected: null }
  ];
  const results = cases.map((item) => {
    const actual = parseConfirmUpdateTargetCommand(item.text);
    const ok = item.expected === null ? actual === null : objectMatches(actual, item.expected);
    return { text: item.text, ok, expected: item.expected, actual };
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

function objectMatches(actual, expected) {
  if (actual === null || typeof actual !== "object") return false;
  return Object.entries(expected).every(([key, value]) => actual[key] === value);
}
