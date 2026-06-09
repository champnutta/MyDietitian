#!/usr/bin/env node

const admin = require("firebase-admin");

const args = parseArgs(process.argv.slice(2));
const projectId = args.project || "mydietitian";
const commit = Boolean(args.commit);

const SUBSCRIPTION_PLANS = [
  {
    planId: "30d",
    labelTh: "30 วัน",
    days: 30,
    priceThb: 59,
    active: true,
    visible: true,
    sortOrder: 10
  },
  {
    planId: "90d",
    labelTh: "90 วัน",
    days: 90,
    priceThb: 150,
    active: true,
    visible: true,
    sortOrder: 20
  },
  {
    planId: "lifetime",
    labelTh: "Lifetime / VIP",
    days: null,
    priceThb: null,
    entitlementType: "lifetime",
    active: true,
    visible: false,
    sortOrder: 999,
    internalOnly: true
  }
];

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
    collection: "subscriptionPlans",
    commit,
    documents: SUBSCRIPTION_PLANS.map((plan) => ({
      documentId: plan.planId,
      payload: {
        ...plan,
        updatedAt: "<serverTimestamp>"
      }
    }))
  }, null, 2));

  if (!commit) {
    console.log("DRY RUN: no Firestore writes were performed. Pass --commit to write.");
    return;
  }

  for (const plan of SUBSCRIPTION_PLANS) {
    const ref = db.collection("subscriptionPlans").doc(plan.planId);
    const snap = await ref.get();
    await ref.set(
      {
        ...plan,
        updatedAt: now,
        createdAt: snap.exists ? snap.data()?.createdAt ?? now : now
      },
      { merge: true }
    );
  }

  console.log("Seeded subscription plans successfully.");
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
