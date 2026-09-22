import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { defineSecret } from "firebase-functions/params";
import { onInit } from "firebase-functions/v2/core";
import { setGlobalOptions } from "firebase-functions/v2/options";

// Firestore lives in asia-southeast3 (Bangkok), but Cloud Functions v2 (which
// Firebase Functions deploys through) does not offer asia-southeast3 yet — the
// cloudfunctions.googleapis.com control plane only exposes asia-southeast1,
// asia-southeast2, australia-southeast1 for this project. So Functions stay in
// asia-southeast1 (the closest supported region) and accept cross-region reads
// to Firestore. Revisit if Cloud Functions v2 adds Bangkok. See
// docs/REGION_MIGRATION_RUNBOOK.md.
setGlobalOptions({ region: "asia-southeast1" });

// Defer Admin SDK init so Firebase CLI discovery does not hang on credential /
// network work during `firebase deploy` (default 10s timeout).
// See https://firebase.google.com/docs/functions/tips#avoid_deployment_timeouts_during_initialization
let firestore: Firestore | null = null;

function ensureAdminApp(): Firestore {
  if (!getApps().length) {
    initializeApp();
  }
  if (!firestore) {
    firestore = getFirestore();
  }
  return firestore;
}

onInit(() => {
  ensureAdminApp();
});

export const db: Firestore = new Proxy({} as Firestore, {
  get(_target, property) {
    const instance = ensureAdminApp();
    // Resolve against the real instance (not the proxy) so getters and any
    // private state inside the SDK see the genuine Firestore object.
    const value = Reflect.get(instance as object, property, instance);
    return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(instance) : value;
  }
});

export const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");
export const ANTHROPIC_API_KEY = defineSecret("ANTHROPIC_API_KEY");
export const LINE_CHANNEL_SECRET = defineSecret("LINE_CHANNEL_SECRET");
export const LINE_CHANNEL_ACCESS_TOKEN = defineSecret("LINE_CHANNEL_ACCESS_TOKEN");
export const ADMIN_LINE_USER_ID = defineSecret("ADMIN_LINE_USER_ID");
