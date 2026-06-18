#!/usr/bin/env node

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const args = parseArgs(process.argv.slice(2));
const projectId = args.project || "mydietitian";
const secretName = args.secret || args.secretName || args["secret-name"] || "LINE_CHANNEL_SECRET";
const lineUserId = args.user || args.userId || "U_SECRET_ROTATION_CONTRACT_TEST";
const outFile = args.out ? path.resolve(args.out) : null;
const markdownOutFile = args.markdownOut || args["markdown-out"] ? path.resolve(args.markdownOut || args["markdown-out"]) : null;

if (args.help || args.h) {
  printHelp();
  process.exit(0);
}

main();

function main() {
  const versions = listSecretVersions();
  const contract = runSignedWebhookContract();
  const enabledVersions = versions.ok
    ? versions.items.filter((item) => String(item.state || "").toUpperCase() === "ENABLED")
    : [];
  const latestEnabled = enabledVersions[0] || null;
  const report = {
    ok: versions.ok && contract.ok && Boolean(latestEnabled),
    generatedAt: new Date().toISOString(),
    projectId,
    secretName,
    secretValuePrinted: false,
    latestEnabledVersion: latestEnabled,
    versions: versions.items,
    versionListError: versions.error,
    signedWebhookContract: contract,
    evidenceText: versions.ok && contract.ok && latestEnabled
      ? `pass: ${secretName} has enabled version ${latestEnabled.versionId} and signed webhook contract returned mode=line-webhook-contract-dry-run`
      : "fail: secret version metadata or signed webhook contract did not pass"
  };

  const json = JSON.stringify(report, null, 2);
  console.log(json);
  if (outFile) writeFile(outFile, `${json}\n`);
  if (markdownOutFile) writeFile(markdownOutFile, `${renderMarkdown(report)}\n`);
  if (!report.ok) process.exit(1);
}

function listSecretVersions() {
  const result = spawnCommand([
    "gcloud",
    "secrets",
    "versions",
    "list",
    secretName,
    "--project",
    projectId,
    "--format=json"
  ]);
  if (result.status !== 0) {
    return {
      ok: false,
      items: [],
      error: summarize(`${result.stdout || ""}\n${result.stderr || ""}`) || result.error?.message || "gcloud failed"
    };
  }
  const parsed = parseJson(result.stdout);
  if (!Array.isArray(parsed)) {
    return {
      ok: false,
      items: [],
      error: "Unable to parse gcloud versions list JSON."
    };
  }
  return {
    ok: true,
    items: parsed.map(normalizeVersion).sort((a, b) => Number(b.versionId || 0) - Number(a.versionId || 0)),
    error: null
  };
}

function normalizeVersion(item) {
  const name = String(item.name || "");
  return {
    versionId: name.split("/").pop() || null,
    state: item.state || null,
    createTime: item.createTime || null,
    destroyTime: item.destroyTime || null,
    etag: item.etag || null
  };
}

function runSignedWebhookContract() {
  const result = spawnCommand([
    "node",
    "tools/signed_line_webhook_test.js",
    "--project",
    projectId,
    "--scenario",
    "text",
    "--user",
    lineUserId,
    "--webhook-dry-run",
    "--useLineSecretManager",
    "--lineSecretName",
    secretName
  ]);
  const output = `${result.stdout || ""}\n${result.stderr || ""}`;
  const json = parseLastJsonObject(output);
  const ok = result.status === 0 &&
    json?.ok === true &&
    json?.mode === "line-webhook-contract-dry-run" &&
    json?.response?.mode === "line-webhook-contract-dry-run";
  return {
    ok,
    status: result.status,
    mode: json?.mode || null,
    httpStatus: json?.status || null,
    received: json?.response?.received ?? null,
    error: ok ? null : summarize(output)
  };
}

function renderMarkdown(report) {
  const lines = [
    "# LINE Secret Rotation Evidence",
    "",
    `Generated: ${report.generatedAt}`,
    `Project: ${report.projectId}`,
    `Secret: ${report.secretName}`,
    `Secret value printed: ${report.secretValuePrinted ? "yes" : "no"}`,
    `Overall: ${report.ok ? "pass" : "fail"}`,
    "",
    "## Evidence Text",
    "",
    report.evidenceText,
    "",
    "## Latest Enabled Version",
    "",
    report.latestEnabledVersion
      ? `Version ${report.latestEnabledVersion.versionId}, state=${report.latestEnabledVersion.state}, created=${report.latestEnabledVersion.createTime || "-"}`
      : "No enabled version detected.",
    "",
    "## Signed Webhook Contract",
    "",
    `Status: ${report.signedWebhookContract.ok ? "pass" : "fail"}`,
    `Mode: ${report.signedWebhookContract.mode || "-"}`,
    `HTTP status: ${report.signedWebhookContract.httpStatus || "-"}`,
    `Received events: ${report.signedWebhookContract.received ?? "-"}`,
    "",
    "## Secret Versions Metadata",
    "",
    "| Version | State | Created | Destroy time |",
    "| --- | --- | --- | --- |"
  ];

  for (const version of report.versions) {
    lines.push(`| ${version.versionId || "-"} | ${version.state || "-"} | ${version.createTime || "-"} | ${version.destroyTime || "-"} |`);
  }

  lines.push(
    "",
    "Copy the evidence text and latest enabled version metadata into the Security Preflight row of `docs/MANUAL_UAT_EVIDENCE.md` after rotating the LINE channel secret."
  );

  return lines.join("\n");
}

function spawnCommand(command) {
  if (process.platform === "win32" && needsCmdShim(command[0])) {
    const commandLine = command.map(quoteCmdArg).join(" ");
    return spawnSync("cmd.exe", ["/d", "/s", "/c", commandLine], {
      cwd: process.cwd(),
      encoding: "utf8",
      shell: false,
      maxBuffer: 10 * 1024 * 1024
    });
  }
  return spawnSync(command[0], command.slice(1), {
    cwd: process.cwd(),
    encoding: "utf8",
    shell: false,
    maxBuffer: 10 * 1024 * 1024
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

function writeFile(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, "utf8");
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function parseLastJsonObject(text) {
  const end = text.lastIndexOf("}");
  if (end < 0) return null;
  for (let start = text.lastIndexOf("{", end); start >= 0; start = text.lastIndexOf("{", start - 1)) {
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      // Continue scanning left.
    }
  }
  return null;
}

function summarize(text) {
  return String(text || "").split(/\r?\n/).filter(Boolean).slice(-8).join(" ").slice(0, 1000);
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
    "LINE secret rotation evidence",
    "",
    "Usage:",
    "  npm run uat:line-secret-evidence -- --project mydietitian --markdown-out docs\\LINE_SECRET_ROTATION_EVIDENCE.md",
    "",
    "This prints Secret Manager version metadata only, never the secret value.",
    "It also runs a signed LINE webhook contract dry-run using --useLineSecretManager."
  ].join("\n"));
}
