#!/usr/bin/env node

const admin = require("firebase-admin");

const args = parseArgs(process.argv.slice(2));
const projectId = args.project || "mydietitian";
const commit = Boolean(args.commit);
const serviceAccount = args.serviceAccount;
const anthropicModel = String(args.anthropicModel || "").trim();
const geminiModel = String(args.geminiModel || "gemini-3.5-flash").trim();
const agents = String(args.agents || "mealAnalysis,exerciseAnalysis,biaAnalysis,coachConsultation")
  .split(",")
  .map((agent) => agent.trim())
  .filter(Boolean);
const primaryMaxAttempts = normalizePositiveInt(args.primaryMaxAttempts, 1);
const primaryTimeoutMs = normalizePositiveInt(args.primaryTimeoutMs, 12000);
const fallbackTimeoutMs = normalizePositiveInt(args.fallbackTimeoutMs, 20000);
const fallbackMaxAttempts = normalizePositiveInt(args.fallbackMaxAttempts, 1);

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

async function main() {
  if (!anthropicModel) {
    throw new Error("Missing --anthropicModel. Pass the exact Anthropic model ID from the Anthropic Console/API docs.");
  }
  if (!geminiModel) {
    throw new Error("Missing --geminiModel.");
  }
  if (!agents.length) {
    throw new Error("Missing agents. Pass --agents mealAnalysis,biaAnalysis,coachConsultation");
  }

  initializeFirebase(projectId, serviceAccount);

  const db = admin.firestore();
  const now = admin.firestore.FieldValue.serverTimestamp();
  const updates = [];

  for (const agentId of agents) {
    const ref = db.collection("aiAgents").doc(agentId);
    const snap = await ref.get();
    const current = snap.exists ? snap.data() || {} : {};
    const temperature = Number(current.temperature ?? defaultTemperature(agentId));
    const update = {
      provider: String(current.provider || "gemini"),
      model: geminiModel,
      promptVersion: String(current.promptVersion || `${agentId}-v1`),
      temperature,
      enabled: current.enabled !== false,
      timeoutMs: primaryTimeoutMs,
      maxAttempts: primaryMaxAttempts,
      fallbacks: [
        {
          provider: "anthropic",
          model: anthropicModel,
          temperature,
          timeoutMs: fallbackTimeoutMs,
          maxAttempts: fallbackMaxAttempts
        }
      ],
      updatedBy: "configure_ai_provider_fallbacks",
      updatedAt: now
    };

    updates.push({
      agentId,
      before: redactTimestamps(current),
      after: redactTimestamps({ ...update, updatedAt: "<serverTimestamp>" }),
      ref,
      update
    });
  }

  console.log(JSON.stringify({
    projectId,
    commit,
    collection: "aiAgents",
    agents: updates.map(({ agentId, before, after }) => ({ agentId, before, after }))
  }, null, 2));

  if (!commit) {
    console.log("DRY RUN: no Firestore writes were performed. Pass --commit to write.");
    return;
  }

  for (const { ref, update } of updates) {
    const snap = await ref.get();
    await ref.set(
      {
        ...update,
        createdAt: snap.exists ? snap.data()?.createdAt ?? now : now
      },
      { merge: true }
    );
  }

  console.log("Configured AI provider fallbacks successfully.");
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--commit") {
      out.commit = true;
      continue;
    }
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

function normalizePositiveInt(value, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 1) return fallback;
  return Math.floor(numeric);
}

function defaultTemperature(agentId) {
  if (agentId === "coachConsultation") return 0.4;
  if (agentId === "biaAnalysis") return 0.1;
  return 0.2;
}

function redactTimestamps(value) {
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => {
      if (key.endsWith("At")) return [key, "<timestamp>"];
      return [key, entry];
    })
  );
}
