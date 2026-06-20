import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { defineSecret } from "firebase-functions/params";
import { setGlobalOptions } from "firebase-functions/v2/options";

initializeApp();
// Firestore lives in asia-southeast3 (Bangkok), but Cloud Functions v2 (which
// Firebase Functions deploys through) does not offer asia-southeast3 yet — the
// cloudfunctions.googleapis.com control plane only exposes asia-southeast1,
// asia-southeast2, australia-southeast1 for this project. So Functions stay in
// asia-southeast1 (the closest supported region) and accept cross-region reads
// to Firestore. Revisit if Cloud Functions v2 adds Bangkok. See
// docs/REGION_MIGRATION_RUNBOOK.md.
setGlobalOptions({ region: "asia-southeast1" });

export const db = getFirestore();
export const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");
export const ANTHROPIC_API_KEY = defineSecret("ANTHROPIC_API_KEY");
export const LINE_CHANNEL_SECRET = defineSecret("LINE_CHANNEL_SECRET");
export const LINE_CHANNEL_ACCESS_TOKEN = defineSecret("LINE_CHANNEL_ACCESS_TOKEN");
export const ADMIN_LINE_USER_ID = defineSecret("ADMIN_LINE_USER_ID");
