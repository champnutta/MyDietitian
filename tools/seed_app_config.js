#!/usr/bin/env node

const admin = require("firebase-admin");

const args = parseArgs(process.argv.slice(2));
const projectId = args.project || "mydietitian";
const commit = Boolean(args.commit);

const APP_RUNTIME_CONFIG = {
  legacyGasDashboardUrl: "https://script.google.com/macros/s/AKfycbwDDjb0vMO6kA_8GDxC51PuDzBplDh1d1dx5NPOCbY_Ho5bQvK-W0QfiNL28WUA5fpMCA/exec",
  liffSettingsUrl: "https://liff.line.me/2009365288-Ux31tFWT?page=form",
  paymentQrImage: "https://img2.pic.in.th/1613478.jpg",
  profileAuthMode: "optional",
  productionLineWebhookReady: false
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

async function main() {
  initializeFirebase(projectId, args.serviceAccount);

  const db = admin.firestore();
  const now = admin.firestore.FieldValue.serverTimestamp();

  console.log(JSON.stringify({
    projectId,
    collection: "appConfig",
    documentId: "runtime",
    commit,
    payload: {
      ...APP_RUNTIME_CONFIG,
      updatedAt: "<serverTimestamp>"
    }
  }, null, 2));

  if (!commit) {
    console.log("DRY RUN: no Firestore writes were performed. Pass --commit to write.");
    return;
  }

  const ref = db.collection("appConfig").doc("runtime");
  const snap = await ref.get();
  await ref.set(
    {
      ...APP_RUNTIME_CONFIG,
      updatedAt: now,
      createdAt: snap.exists ? snap.data()?.createdAt ?? now : now
    },
    { merge: true }
  );

  console.log("Seeded app runtime config successfully.");
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
