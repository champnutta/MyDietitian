#!/usr/bin/env node

const admin = require("firebase-admin");

const args = parseArgs(process.argv.slice(2));
const projectId = args.project || "mydietitian";
const serviceAccount = args.serviceAccount;
const expectedGeminiModel = args.geminiModel || "gemini-3.5-flash";
const expectedAnthropicModel = args.anthropicModel || "claude-sonnet-4-6";
const requireAnthropicFallback = Boolean(args.requireAnthropicFallback || args["require-anthropic-fallback"]);

const REQUIRED_AGENTS = [
  "mealAnalysis",
  "exerciseAnalysis",
  "biaAnalysis",
  "coachConsultation"
];

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

async function main() {
  initializeFirebase(projectId, serviceAccount);
  const db = admin.firestore();
  const checks = [];

  for (const agentId of REQUIRED_AGENTS) {
    const snap = await db.collection("aiAgents").doc(agentId).get();
    if (!snap.exists) {
      checks.push({
        agentId,
        ok: false,
        error: "missing aiAgents document"
      });
      continue;
    }

    const data = snap.data() || {};
    const fallback = Array.isArray(data.fallbacks)
      ? data.fallbacks.find((item) => item?.provider === "anthropic")
      : null;
    const primaryOk = data.enabled === true &&
      data.provider === "gemini" &&
      data.model === expectedGeminiModel &&
      Number(data.maxAttempts) === 1;
    const fallbackOk = Boolean(fallback) &&
      fallback.model === expectedAnthropicModel &&
      Number(fallback.maxAttempts) === 1;

    checks.push({
      agentId,
      ok: primaryOk && (!requireAnthropicFallback || fallbackOk),
      primary: {
        provider: data.provider || null,
        model: data.model || null,
        maxAttempts: data.maxAttempts ?? null,
        timeoutMs: data.timeoutMs ?? null,
        ok: primaryOk
      },
      anthropicFallback: {
        present: Boolean(fallback),
        model: fallback?.model || null,
        maxAttempts: fallback?.maxAttempts ?? null,
        timeoutMs: fallback?.timeoutMs ?? null,
        ok: fallbackOk
      },
      error: primaryOk
        ? (requireAnthropicFallback && !fallbackOk ? "Anthropic fallback is missing or not using the expected model/maxAttempts." : null)
        : "Primary AI agent config must be enabled gemini with expected model and maxAttempts=1."
    });
  }

  const failures = checks.filter((check) => !check.ok);
  const report = {
    ok: failures.length === 0,
    projectId,
    expected: {
      geminiModel: expectedGeminiModel,
      anthropicModel: expectedAnthropicModel,
      requireAnthropicFallback
    },
    checks,
    failures: failures.map((failure) => ({
      agentId: failure.agentId,
      error: failure.error
    }))
  };

  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exit(1);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) {
      out[key] = true;
      out[toCamelCase(key)] = true;
    } else {
      out[key] = value;
      out[toCamelCase(key)] = value;
      i += 1;
    }
  }
  return out;
}

function toCamelCase(value) {
  return value.replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
}

function initializeFirebase(projectId, serviceAccountPath) {
  if (admin.apps.length) return;

  if (serviceAccountPath) {
    const credentialJson = require(serviceAccountPath);
    if (!credentialJson.project_id) {
      process.env.GOOGLE_APPLICATION_CREDENTIALS = serviceAccountPath;
      admin.initializeApp({
        credential: admin.credential.applicationDefault(),
        projectId
      });
      return;
    }

    admin.initializeApp({
      credential: admin.credential.cert(credentialJson),
      projectId
    });
    return;
  }

  admin.initializeApp({ projectId });
}
