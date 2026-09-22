#!/usr/bin/env node
/**
 * Cross-platform Firebase deploy wrapper.
 * Raises FUNCTIONS_DISCOVERY_TIMEOUT so large backends do not fail the
 * default 10s CLI discovery window on slower Windows machines.
 */
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const args = process.argv.slice(2);
if (!args.length) {
  console.error("Usage: node tools/firebase_deploy.js --only functions,hosting");
  process.exit(1);
}

const env = {
  ...process.env,
  FUNCTIONS_DISCOVERY_TIMEOUT: process.env.FUNCTIONS_DISCOVERY_TIMEOUT || "60"
};

const result = spawnSync(
  "npx",
  ["firebase", "deploy", "--project", "mydietitian", ...args],
  {
    cwd: path.resolve(__dirname, ".."),
    env,
    stdio: "inherit",
    shell: process.platform === "win32"
  }
);

process.exit(result.status ?? 1);
