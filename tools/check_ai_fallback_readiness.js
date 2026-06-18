#!/usr/bin/env node

const { spawnSync } = require("node:child_process");

const args = parseArgs(process.argv.slice(2));
const projectId = args.project || "mydietitian";
const requiredSecrets = ["GEMINI_API_KEY", "ANTHROPIC_API_KEY"];

main();

function main() {
  const checks = [];

  checks.push(runCheck("backend-build", "npm", ["run", "build"], {
    cwd: "services/backend"
  }));

  for (const secretName of requiredSecrets) {
    checks.push(runCheck(
      `secret:${secretName}`,
      "firebase",
      ["functions:secrets:describe", secretName, "--project", projectId],
      { redactOutput: true }
    ));
  }

  checks.push(runCheck("firebase-login", "firebase", ["login:list"], {
    redactOutput: true
  }));

  const ok = checks.every((check) => check.ok);
  console.log(JSON.stringify({
    ok,
    projectId,
    checks: checks.map(({ name, ok, status, error }) => ({ name, ok, status, error }))
  }, null, 2));

  if (!ok) process.exit(1);
}

function runCheck(name, command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: options.cwd || process.cwd(),
    encoding: "utf8",
    shell: process.platform === "win32"
  });
  const ok = result.status === 0;
  return {
    name,
    ok,
    status: result.status,
    error: ok ? null : summarizeError(result.stderr || result.stdout)
  };
}

function summarizeError(raw) {
  const cleaned = String(raw || "")
    .replace(/\u001b\[[0-9;]*m/g, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return cleaned.slice(-3).join(" ");
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
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
