#!/usr/bin/env node

const admin = require("firebase-admin");

const args = parseArgs(process.argv.slice(2));
const projectId = args.project || "mydietitian";
const commit = Boolean(args.commit);

const MEAL_AGENT_CONFIG = {
  agentId: "mealAnalysis",
  provider: "gemini",
  model: "gemini-3-flash-preview",
  promptVersion: "meal-v1",
  temperature: 0.2,
  enabled: true
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

async function main() {
  initializeFirebase(projectId, args.serviceAccount);

  const db = admin.firestore();
  const ref = db.collection("aiAgents").doc(MEAL_AGENT_CONFIG.agentId);
  const now = admin.firestore.FieldValue.serverTimestamp();
  const payload = {
    ...MEAL_AGENT_CONFIG,
    updatedAt: now
  };

  console.log(JSON.stringify({
    projectId,
    collection: "aiAgents",
    documentId: MEAL_AGENT_CONFIG.agentId,
    commit,
    payload: {
      ...MEAL_AGENT_CONFIG,
      updatedAt: "<serverTimestamp>"
    }
  }, null, 2));

  if (!commit) {
    console.log("DRY RUN: no Firestore writes were performed. Pass --commit to write.");
    return;
  }

  const snap = await ref.get();
  await ref.set(
    {
      ...payload,
      createdAt: snap.exists ? snap.data()?.createdAt ?? now : now
    },
    { merge: true }
  );

  console.log("Seeded aiAgents/mealAnalysis successfully.");
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
